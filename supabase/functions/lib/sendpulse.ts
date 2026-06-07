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

  // Build payload — each channel has its own API shape
  function buildTextPayload(text: string) {
    if (channel === 'live_chat') {
      return { contact_id: contactId, messages: [{ type: 'text', text: { text } }] }
    }
    if (channel === 'instagram' || channel === 'facebook') {
      // Instagram/Facebook: messages array with nested message object, text is a plain string
      return { contact_id: contactId, messages: [{ type: 'text', message: { type: 'text', text } }] }
    }
    // WhatsApp / Telegram: singular message with text.body
    return { contact_id: contactId, message: { type: 'text', text: { body: text } } }
  }

  function buildAttachPayload(attType: string, attLink: string, attName: string) {
    if (channel === 'instagram' || channel === 'facebook') {
      if (attType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(attName)) {
        return { contact_id: contactId, messages: [{ type: 'image', message: { type: 'image', url: attLink } }] }
      }
      return { contact_id: contactId, messages: [{ type: 'file', message: { type: 'file', url: attLink, filename: attName } }] }
    }
    if (channel === 'live_chat') {
      return { contact_id: contactId, messages: [{ type: attType === 'image' ? 'image' : 'file', url: attLink }] }
    }
    // WhatsApp / Telegram
    if (attType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(attName)) {
      return { contact_id: contactId, message: { type: 'image', image: { link: attLink } } }
    }
    if (attType === 'audio' || /\.(mp3|ogg|wav|m4a)$/i.test(attName)) {
      return { contact_id: contactId, message: { type: 'audio', audio: { link: attLink } } }
    }
    return { contact_id: contactId, message: { type: 'document', document: { link: attLink, filename: attName } } }
  }

  // collect responses for diagnostics
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

export async function sendTemplateMessage(supabase: any, accountId: string, contactId: string, templateName: string, templateLanguage: string, bodyParams: string[], headerType: string, headerMediaUrl: string) {
  const spToken = await ensureSendPulseToken(supabase, accountId)
  if (!spToken) throw new Error('unable to obtain sendpulse token')

  const components: any[] = []

  // Header component — only for media headers
  const mediaHeaderType = (headerType || '').toUpperCase()
  if ((mediaHeaderType === 'IMAGE' || mediaHeaderType === 'VIDEO' || mediaHeaderType === 'DOCUMENT') && headerMediaUrl) {
    const paramKey = mediaHeaderType === 'IMAGE' ? 'image' : mediaHeaderType === 'VIDEO' ? 'video' : 'document'
    components.push({
      type: 'header',
      parameters: [{ type: mediaHeaderType.toLowerCase(), [paramKey]: { link: headerMediaUrl } }],
    })
  }

  // Body component — only when there are variable params
  if (bodyParams && bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((text) => ({ type: 'text', text })),
    })
  }

  // Language codes must be lowercase (e.g. "ar" not "AR")
  const langCode = (templateLanguage || 'en').toLowerCase()

  const payload: any = {
    contact_id: contactId,
    message: {
      type: 'template',
      template: {
        name: templateName,
        language: { code: langCode },
      },
    },
  }
  if (components.length > 0) {
    payload.message.template.components = components
  }

  console.log(`[template] sending to contact=${contactId} name=${templateName} lang=${langCode} components=${JSON.stringify(components)}`)

  const r = await fetch('https://api.sendpulse.com/whatsapp/contacts/send', {
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

