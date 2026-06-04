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

export async function performSendPulseDelivery(supabase: any, accountId: string, channel: string, contactId: string, cleanText: string, attachments: any[]) {
  if (!accountId || !contactId) throw new Error('missing accountId or contactId')
  const spToken = await ensureSendPulseToken(supabase, accountId)
  if (!spToken) throw new Error('unable to obtain sendpulse token')

  const pathMap = { whatsapp: 'whatsapp', telegram: 'telegram', instagram: 'instagram', facebook: 'fb' }
  const path = pathMap[channel] || 'whatsapp'
  const spUrl = channel === 'live_chat' ? 'https://api.sendpulse.com/live-chat/contacts/send' : `https://api.sendpulse.com/${path}/contacts/send`
  const spHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${spToken}` }

  // collect responses for diagnostics
  const results = []
  if (cleanText) {
    const spPayload = channel === 'live_chat'
      ? { contact_id: contactId, messages: [{ type: 'text', text: { text: cleanText } }] }
      : { contact_id: contactId, message: { type: 'text', text: { body: cleanText } } }
    const r = await fetch(spUrl, { method: 'POST', headers: spHeaders, body: JSON.stringify(spPayload) })
    const body = await r.text().catch(() => null)
    if (!r.ok) throw new Error(`sendpulse text failed: ${r.status} ${body}`)
    results.push({ type: 'text', status: r.status, body: body })
  }
  for (const att of attachments || []) {
    const attType = (att.type || '').toLowerCase()
    const attLink = att.link || ''
    const attName = att.name || 'file'
    if (!attLink) continue
    let spPayload
    if (attType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(attName)) {
      spPayload = { contact_id: contactId, message: { type: 'image', image: { link: attLink } } }
    } else if (attType === 'audio' || /\.(mp3|ogg|wav|m4a)$/i.test(attName)) {
      spPayload = { contact_id: contactId, message: { type: 'audio', audio: { link: attLink } } }
    } else {
      spPayload = { contact_id: contactId, message: { type: 'document', document: { link: attLink, filename: attName } } }
    }
    const r = await fetch(spUrl, { method: 'POST', headers: spHeaders, body: JSON.stringify(spPayload) })
    const body = await r.text().catch(() => null)
    if (!r.ok) throw new Error(`sendpulse attach failed: ${r.status} ${body}`)
    results.push({ type: 'attach', status: r.status, body: body })
  }
  return results
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

