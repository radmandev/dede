export const BITRIX_TOKEN_ENDPOINT = 'https://oauth.bitrix.info/oauth/token/'

export function normalizeConfigRow(row: any) {
  if (!row) return {}
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  return { ...data, ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'data')) }
}

export async function loadFirstGlobalConfig(supabase: any) {
  const { data, error } = await supabase.from('global_config').select('*').limit(1).maybeSingle()
  if (error) throw error
  return normalizeConfigRow(data)
}

export async function callBitrix(endpoint: string, token: string, method: string, params: any = {}) {
  const base = endpoint.endsWith('/') ? endpoint : endpoint + '/'
  const url = `${base}${method}?auth=${encodeURIComponent(token)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { raw: text } }
}

export async function refreshBitrixToken(supabase: any, account: any) {
  if (!account?.app_client_id || !account?.app_client_secret || !account?.refresh_token) return null
  const res = await fetch(BITRIX_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: account.app_client_id,
      client_secret: account.app_client_secret,
      refresh_token: account.refresh_token,
    }),
  })
  const data = await res.json().catch(() => null)
  if (!data?.access_token) return null
  const newToken = data.access_token
  const refreshToken = data.refresh_token || account.refresh_token
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  await supabase.from('bitrix24_accounts').update({ access_token: newToken, refresh_token: refreshToken, token_expires_at: expiresAt }).eq('id', account.id)
  return newToken
}

export async function ensureBitrixToken(supabase: any, account: any) {
  if (!account) return null
  const token = account.access_token
  const expires = account.token_expires_at ? new Date(account.token_expires_at) : null
  if (token && expires && expires > new Date(Date.now() + 60000)) return token
  return await refreshBitrixToken(supabase, account)
}

export function parseNestedForm(bodyText: string) {
  const flat = Object.fromEntries(new URLSearchParams(bodyText))
  const result: any = {}
  for (const [key, val] of Object.entries(flat)) {
    const parts = key.replace(/\]/g, '').split('[')
    let cur: any = result
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {}
      cur = cur[parts[i]]
    }
    cur[parts[parts.length - 1]] = val
  }
  return result
}

export function makeJsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Forward a message to a Bitrix24 open channel via imconnector.send.messages.
 * Updates conversation.bitrix24_chat_id if the API returns a new chat ID.
 */
export async function sendToBitrix24(
  supabase: any,
  account: any,
  channelCfg: any,
  conversation: any,
  messageText: string,
  messageId: string,
  msgType: string,
  mediaUrl: string,
  mediaFilename: string,
  contactPhone: string
) {
  const isOAuthServer = (ep: string) => ep.includes('oauth.bitrix.info') || ep.includes('oauth.bitrix24.tech')
  let accountDomain = account.domain || ''
  if (isOAuthServer(accountDomain) && account.name) {
    const host = account.name.includes('.') ? account.name : null
    if (host) {
      accountDomain = `https://${host}/rest/`
      await supabase.from('bitrix24_accounts').update({ domain: accountDomain }).eq('id', account.id)
      console.log(`[b24] repaired domain to ${accountDomain}`)
    }
  }
  if (!accountDomain || isOAuthServer(accountDomain) || !channelCfg?.bitrix24_line_id) return

  const token = await ensureBitrixToken(supabase, account)
  if (!token) { console.error('[b24] no token — skipping'); return }

  const CONNECTOR_ID = channelCfg.bitrix24_connector_id || 'whatsapp_sendpulse'
  const LINE_ID = Number(channelCfg.bitrix24_line_id)
  const endpoint = accountDomain.endsWith('/') ? accountDomain : accountDomain + '/'
  const unixNow = Math.floor(Date.now() / 1000)

  const messageObj: any = { id: messageId || String(Date.now()), date: unixNow, text: messageText || '', type: 'message' }

  if (mediaUrl) {
    const isImage = msgType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(mediaFilename || '')
    const isAudio = msgType === 'audio' || /\.(mp3|ogg|wav|aac|m4a)$/i.test(mediaFilename || '')
    const label = isImage ? 'image' : isAudio ? 'audio' : 'file'
    messageObj.text = messageText ? `${messageText}\n[URL=${mediaUrl}]${label}[/URL]` : `[URL=${mediaUrl}]${label}[/URL]`
  }

  const phone = contactPhone || conversation.contact_phone || ''
  const msgItem: any = {
    user: {
      id: String(conversation.sendpulse_contact_id),
      name: conversation.contact_name || 'Customer',
      phone,
      avatar: '',
      online: true,
    },
    message: messageObj,
    chat: { id: String(conversation.sendpulse_contact_id) },
  }

  const payload = { CONNECTOR: CONNECTOR_ID, LINE: LINE_ID, MESSAGES: [msgItem] }
  const res = await fetch(`${endpoint}imconnector.send.messages?auth=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await res.json().catch(() => null)
  if (result?.error) {
    console.error('[b24] imconnector.send.messages error:', JSON.stringify(result))
  } else {
    const returnedChatId =
      result?.result?.DATA?.RESULT_SESSION?.CHAT_ID ||
      result?.result?.DATA?.RESULT_MESSAGE?.[0]?.chat_id ||
      result?.result?.DATA?.RESULT_MESSAGE?.[0]?.CHAT_ID ||
      result?.result?.DATA?.RESULT?.[0]?.session?.CHAT_ID ||
      result?.result?.[0]?.chat_id ||
      result?.result?.chat_id
    console.log(`[b24] sent ok returnedChatId=${returnedChatId}`)
    if (returnedChatId && String(conversation.bitrix24_chat_id) !== String(returnedChatId)) {
      await supabase.from('conversations').update({ bitrix24_chat_id: Number(returnedChatId) }).eq('id', conversation.id)
    }
  }
}
