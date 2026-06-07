const SP_TOKEN_ENDPOINT = 'https://api.sendpulse.com/oauth/access_token'
const BASE_BACKOFF_SECONDS = 30
const MAX_ATTEMPTS_DEFAULT = 5

export async function ensureSendPulseToken(supabase: any, accountId: string) {
  // read account
  const { data: accounts, error: aerr } = await supabase.from('sendpulse_accounts').select('*').eq('id', accountId).limit(1)
  if (aerr) throw aerr
  const account = accounts?.[0]
  if (!account) return null
  const now = new Date()
  if (account.access_token && account.token_expires_at) {
    const exp = new Date(account.token_expires_at)
    if (exp > new Date(now.getTime() + 60000)) return account.access_token
  }

  if (!account.client_id || !account.client_secret) return null
  const res = await fetch(SP_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: account.client_id, client_secret: account.client_secret })
  })
  const data = await res.json().catch(() => null)
  if (!data || !data.access_token) return null
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  await supabase.from('sendpulse_accounts').update({ access_token: data.access_token, token_expires_at: expiresAt }).eq('id', accountId)
  return data.access_token
}

// A contactId that looks like a phone number means the SP contact wasn't resolved yet.
// In that case we send using phone + bot_id instead of contact_id.
function isPhoneContactId(id: string): boolean {
  const s = (id || '').trim()
  return s.startsWith('+') || /^\d{7,15}$/.test(s)
}

async function resolveExternalBotId(supabase: any, botRowId: string): Promise<string> {
  if (!botRowId) return ''
  const { data } = await supabase.from('sendpulse_bots').select('bot_id').eq('id', botRowId).limit(1).maybeSingle()
  return data?.bot_id || ''
}

export async function performSendPulseDelivery(supabase: any, accountId: string, channel: string, contactId: string, cleanText: string, attachments: any[], botRowId = '') {
  if (!accountId || !contactId) throw new Error('missing accountId or contactId')
  const spToken = await ensureSendPulseToken(supabase, accountId)
  if (!spToken) throw new Error('unable to obtain sendpulse token')

  const pathMap: Record<string, string> = { whatsapp: 'whatsapp', telegram: 'telegram', instagram: 'instagram', facebook: 'fb' }
  const path = pathMap[channel] || 'whatsapp'
  const spUrl = channel === 'live_chat' ? 'https://api.sendpulse.com/live-chat/contacts/send' : `https://api.sendpulse.com/${path}/contacts/send`
  const spHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${spToken}` }

  // Determine contact key: use phone+bot_id if contactId looks like a phone number
  const usePhone = isPhoneContactId(contactId)
  let externalBotId = ''
  if (usePhone) {
    externalBotId = await resolveExternalBotId(supabase, botRowId)
    console.log(`[delivery] phone-based send phone=${contactId} bot_id=${externalBotId}`)
  }
  const contactKey = usePhone
    ? { phone: contactId, ...(externalBotId ? { bot_id: externalBotId } : {}) }
    : { contact_id: contactId }

  // Build payload — each channel has its own API shape
  function buildTextPayload(text: string) {
    if (channel === 'live_chat') {
      return { ...contactKey, messages: [{ type: 'text', text: { text } }] }
    }
    if (channel === 'instagram' || channel === 'facebook') {
      return { ...contactKey, messages: [{ type: 'text', message: { type: 'text', text } }] }
    }
    return { ...contactKey, message: { type: 'text', text: { body: text } } }
  }

  function buildAttachPayload(attType: string, attLink: string, attName: string) {
    if (channel === 'instagram' || channel === 'facebook') {
      if (attType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(attName)) {
        return { ...contactKey, messages: [{ type: 'image', message: { type: 'image', url: attLink } }] }
      }
      return { ...contactKey, messages: [{ type: 'file', message: { type: 'file', url: attLink, filename: attName } }] }
    }
    if (channel === 'live_chat') {
      return { ...contactKey, messages: [{ type: attType === 'image' ? 'image' : 'file', url: attLink }] }
    }
    if (attType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(attName)) {
      return { ...contactKey, message: { type: 'image', image: { link: attLink } } }
    }
    if (attType === 'audio' || /\.(mp3|ogg|wav|m4a)$/i.test(attName)) {
      return { ...contactKey, message: { type: 'audio', audio: { link: attLink } } }
    }
    return { ...contactKey, message: { type: 'document', document: { link: attLink, filename: attName } } }
  }

  const results = []
  if (cleanText) {
    const spPayload = buildTextPayload(cleanText)
    const r = await fetch(spUrl, { method: 'POST', headers: spHeaders, body: JSON.stringify(spPayload) })
    const body = await r.text().catch(() => null)
    if (!r.ok) throw new Error(`sendpulse text failed: ${r.status} ${body}`)
    results.push({ type: 'text', status: r.status, body })
  }
  for (const att of attachments || []) {
    const attType = (att.type || '').toLowerCase()
    const attLink = att.link || ''
    const attName = att.name || 'file'
    if (!attLink) continue
    const spPayload = buildAttachPayload(attType, attLink, attName)
    const r = await fetch(spUrl, { method: 'POST', headers: spHeaders, body: JSON.stringify(spPayload) })
    const body = await r.text().catch(() => null)
    if (!r.ok) throw new Error(`sendpulse attach failed: ${r.status} ${body}`)
    results.push({ type: 'attach', status: r.status, body })
  }
  return results
}

export async function sendTemplateMessage(supabase: any, accountId: string, contactId: string, templateName: string, templateLanguage: string, bodyParams: string[], headerType: string, headerMediaUrl: string, botRowId = '') {
  const spToken = await ensureSendPulseToken(supabase, accountId)
  if (!spToken) throw new Error('unable to obtain sendpulse token')

  const langCode = (templateLanguage || 'en').toLowerCase()

  // Determine contact key: use phone+bot_id if contactId looks like a phone number
  const usePhone = isPhoneContactId(contactId)
  let externalBotId = ''
  if (usePhone) {
    externalBotId = await resolveExternalBotId(supabase, botRowId)
  }
  const contactKey = usePhone
    ? { phone: contactId, ...(externalBotId ? { bot_id: externalBotId } : {}) }
    : { contact_id: contactId }

  // Build WhatsApp-native components array
  const components: any[] = []
  const mediaHeaderType = (headerType || '').toUpperCase()

  if ((mediaHeaderType === 'IMAGE' || mediaHeaderType === 'VIDEO' || mediaHeaderType === 'DOCUMENT') && headerMediaUrl) {
    const paramType = mediaHeaderType.toLowerCase() as 'image' | 'video' | 'document'
    components.push({
      type: 'header',
      parameters: [{ type: paramType, [paramType]: { link: headerMediaUrl } }],
    })
  }

  if (bodyParams && bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((value) => ({ type: 'text', text: value })),
    })
  }

  const payload: any = {
    ...contactKey,
    template: {
      name: templateName,
      language: { policy: 'deterministic', code: langCode },
      ...(components.length > 0 ? { components } : {}),
    },
  }

  console.log(`[template] POST sendTemplate ${usePhone ? `phone=${contactId} bot_id=${externalBotId}` : `contact_id=${contactId}`} name=${templateName} lang=${langCode} payload=${JSON.stringify(payload)}`)

  const r = await fetch('https://api.sendpulse.com/whatsapp/contacts/sendTemplate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${spToken}` },
    body: JSON.stringify(payload),
  })
  const respBody = await r.text().catch(() => null)
  console.log(`[template] sendpulse response: ${r.status} ${respBody}`)
  if (!r.ok) throw new Error(`sendpulse template failed: ${r.status} ${respBody}`)
  return { status: r.status, body: respBody }
}

export async function enqueueDelivery(supabase: any, opts: any) {
  const accountId = opts.sendpulse_account_id || null
  const conversationId = opts.conversation_id || null
  const messageId = opts.message_id || null
  const contactId = opts.contact_id || null
  const channel = opts.channel || null
  const payload = { text: opts.text || null, attachments: opts.attachments || [] }
  const maxAttempts = opts.max_attempts || MAX_ATTEMPTS_DEFAULT
  const { data, error } = await supabase.from('delivery_queue').insert([{ sendpulse_account_id: accountId, conversation_id: conversationId, message_id: messageId, contact_id: contactId, channel, payload, attempts: 0, max_attempts: maxAttempts, next_attempt_at: new Date().toISOString() }])
  if (error) throw error
  return data && data[0]
}

export async function recordDeliveryError(supabase: any, deliveryId: string, opts: any) {
  const { error_text, response_body } = opts || {}
  await supabase.from('delivery_errors').insert([{ delivery_id: deliveryId || null, sendpulse_account_id: opts?.sendpulse_account_id || null, conversation_id: opts?.conversation_id || null, message_id: opts?.message_id || null, contact_id: opts?.contact_id || null, channel: opts?.channel || null, error_text: error_text || null, response_body: response_body || null }])
}

