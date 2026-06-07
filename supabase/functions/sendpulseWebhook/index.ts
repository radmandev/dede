import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') || ''

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-webhook-secret',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// ---------- Media re-hosting ----------

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/aac': '.aac',
  'video/mp4': '.mp4', 'video/ogg': '.ogv',
  'application/pdf': '.pdf',
}

function extFromContentType(ct: string): string {
  return CONTENT_TYPE_EXT[(ct.split(';')[0] || '').trim().toLowerCase()] || ''
}

function extFromMsgType(msgType: string): string {
  if (msgType === 'image') return '.jpg'
  if (msgType === 'audio') return '.mp3'
  if (msgType === 'file') return '.bin'
  return ''
}

// Returns { url, filename } — filename includes the proper extension so Bitrix24 can identify the type
async function reHostMedia(opts: {
  channel: string
  spMessageId: string
  platformMediaId: string
  fallbackUrl: string
  filename: string      // hint — may be empty; extension is derived from content-type
  msgType: string       // 'image' | 'audio' | 'file' — fallback when content-type is generic
  spToken: string | null
}): Promise<{ url: string; filename: string }> {
  const { channel, spMessageId, platformMediaId, fallbackUrl, filename, msgType, spToken } = opts

  async function uploadBuffer(buffer: ArrayBuffer, contentType: string): Promise<{ url: string; filename: string }> {
    // Derive the best filename with a proper extension
    let ext = extFromContentType(contentType)
    if (!ext) ext = extFromMsgType(msgType)
    const base = (filename || 'media').replace(/[^\x00-\x7F]/g, '_').replace(/\s+/g, '_').replace(/_{2,}/g, '_').substring(0, 60)
    const finalName = base.includes('.') ? base : base + ext
    const storagePath = `media/${Date.now()}_${finalName}`
    const { error } = await supabase.storage
      .from('attachments')
      .upload(storagePath, new Uint8Array(buffer), { contentType, upsert: false })
    if (error) throw error

    // Always use a signed URL — Edge Functions run inside Supabase's network so a public-URL probe
    // returns 200 even for private buckets. Bitrix24 is external and would get 403 on a private bucket.
    const { data: signed, error: signErr } = await supabase.storage.from('attachments').createSignedUrl(storagePath, 604800)
    if (signed?.signedUrl) {
      console.log(`[media] using signed URL (7d): ${signed.signedUrl.substring(0, 80)}`)
      return { url: signed.signedUrl, filename: finalName }
    }
    // Signed URL failed — fall back to public URL (works if bucket is actually public)
    console.warn('[media] signed URL failed, falling back to public URL:', signErr?.message)
    const publicUrl = supabase.storage.from('attachments').getPublicUrl(storagePath).data?.publicUrl || ''
    return { url: publicUrl, filename: finalName }
  }

  const channelSlug = channel === 'live_chat' ? 'live-chat' : channel
  const spBase = `https://login.sendpulse.com/api/chatbots-service/${channelSlug}/messages/media`

  async function tryFetch(label: string, url: string, headers: Record<string, string> = {}): Promise<{ buf: ArrayBuffer; ct: string } | null> {
    try {
      const res = await fetch(url, { headers })
      console.log(`[media] ${label} → ${res.status}`)
      if (res.ok) return { buf: await res.arrayBuffer(), ct: res.headers.get('content-type') || 'application/octet-stream' }
    } catch (e: any) { console.error(`[media] ${label} error:`, e.message) }
    return null
  }

  const spAuthHeader = spToken ? { Authorization: `Bearer ${spToken}` } : {}

  // Strategy A: fallbackUrl exactly as SP provided it, with auth (avoids extra params we might be adding)
  if (spToken && fallbackUrl && fallbackUrl.includes('sendpulse.com')) {
    const r = await tryFetch('sp-url-with-auth', fallbackUrl, spAuthHeader)
    if (r) return await uploadBuffer(r.buf, r.ct)
  }

  // Strategy B: media ID only (no message_id) — simplest possible SP proxy call
  if (spToken && platformMediaId) {
    const r = await tryFetch('sp-id-only', `${spBase}?id=${encodeURIComponent(platformMediaId)}`, spAuthHeader)
    if (r) return await uploadBuffer(r.buf, r.ct)
  }

  // Strategy C: message_id only (no &id param — avoids double-param 422)
  if (spToken && spMessageId) {
    const r = await tryFetch('sp-msgid-only', `${spBase}?message_id=${encodeURIComponent(spMessageId)}`, spAuthHeader)
    if (r) return await uploadBuffer(r.buf, r.ct)
  }

  // Strategy D: message_id + id (original attempt)
  if (spToken && spMessageId) {
    const idParam = platformMediaId ? `&id=${encodeURIComponent(platformMediaId)}` : ''
    const r = await tryFetch('sp-msgid-and-id', `${spBase}?message_id=${encodeURIComponent(spMessageId)}${idParam}`, spAuthHeader)
    if (r) return await uploadBuffer(r.buf, r.ct)
  }

  // Strategy E: direct URL without auth (public CDN fallback)
  if (fallbackUrl) {
    const r = await tryFetch('direct-no-auth', encodeURI(decodeURI(fallbackUrl)))
    if (r) return await uploadBuffer(r.buf, r.ct)
  }

  throw new Error('all media fetch strategies failed')
}

// ---------- Bitrix24 helpers ----------

async function refreshBitrix24Token(account: any) {
  if (!account.app_client_id || !account.app_client_secret || !account.refresh_token) return null
  const res = await fetch('https://oauth.bitrix.info/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: account.app_client_id,
      client_secret: account.app_client_secret,
      refresh_token: account.refresh_token,
    }),
  })
  const data = await res.json()
  if (data?.access_token) {
    await supabase.from('bitrix24_accounts').update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || account.refresh_token,
      token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
    }).eq('id', account.id)
  }
  return data
}

async function sendToBitrix24(
  account: any, channelCfg: any, conversation: any,
  messageText: string, messageId: string, msgType: string,
  mediaUrl: string, mediaFilename: string, contactPhone: string
) {
  // Repair domain if bitrix24Handler corrupted it with the generic OAuth endpoint
  let accountDomain = account.domain || ''
  if (accountDomain.includes('oauth.bitrix.info') && account.name) {
    const host = account.name.includes('.') ? account.name : null
    if (host) {
      accountDomain = `https://${host}/rest/`
      await supabase.from('bitrix24_accounts').update({ domain: accountDomain }).eq('id', account.id)
      console.log(`[b24] repaired domain from oauth.bitrix.info to ${accountDomain}`)
    }
  }
  if (!accountDomain || accountDomain.includes('oauth.bitrix.info') || !channelCfg.bitrix24_line_id) return

  let token = account.access_token
  const expires = account.token_expires_at ? new Date(account.token_expires_at) : null
  const needsRefresh = !token || !expires || expires < new Date(Date.now() + 30000)
  console.log(`[b24] token check: hasToken=${!!token} expires=${expires?.toISOString()} needsRefresh=${needsRefresh} hasClientId=${!!account.app_client_id} hasClientSecret=${!!account.app_client_secret} hasRefreshToken=${!!account.refresh_token}`)
  if (needsRefresh) {
    const refreshed = await refreshBitrix24Token(account)
    if (refreshed?.access_token) {
      token = refreshed.access_token
      console.log('[b24] token refreshed successfully')
    } else {
      console.warn('[b24] token refresh failed — attempting with current token anyway')
      // Try with current token even if expired (Bitrix24 may still accept briefly)
      if (!token) { console.error('[b24] no token at all — giving up'); return }
    }
  }

  const CONNECTOR_ID = channelCfg.bitrix24_connector_id || 'whatsapp_sendpulse'
  const LINE_ID = Number(channelCfg.bitrix24_line_id)
  const endpoint = accountDomain.endsWith('/') ? accountDomain : accountDomain + '/'
  console.log(`[b24] forwarding to connector=${CONNECTOR_ID} line=${LINE_ID} domain=${accountDomain}`)

  const unixNow = Math.floor(Date.now() / 1000)
  const messageObj: any = { id: messageId || String(Date.now()), date: unixNow, text: messageText || '', type: 'message' }

  // Phone: prefer current message phone, fallback to conversation record
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

  if (mediaUrl) {
    const isImage = msgType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(mediaFilename || '')
    const isAudio = msgType === 'audio' || /\.(mp3|ogg|wav|aac|m4a)$/i.test(mediaFilename || '')
    const fileType = isImage ? 'IMAGE' : isAudio ? 'AUDIO' : 'DOCUMENT'
    let fname = mediaFilename || 'file'
    if (!fname.includes('.')) fname += (isImage ? '.jpg' : isAudio ? '.mp3' : '.bin')
    console.log(`[b24] media: type=${fileType} fname=${fname} url=${mediaUrl.substring(0, 120)}`)
    // Keep a text fallback — Bitrix24 still shows this alongside the file
    if (!messageObj.text) messageObj.text = isImage ? '📷 Image' : isAudio ? '🎵 Audio' : '📎 File'
    // Use proper array format — uppercase FILES with PHP-style keys is silently ignored by Bitrix24
    messageObj.files = [{ link: mediaUrl, name: fname, type: fileType, size: 0 }]
  }

  const payload = {
    CONNECTOR: CONNECTOR_ID,
    LINE: LINE_ID,
    MESSAGES: [msgItem],
  }

  const res = await fetch(`${endpoint}imconnector.send.messages?auth=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await res.json()
  if (result?.error) {
    console.error('[b24] imconnector.send.messages error:', JSON.stringify(result))
  } else {
    const msgResult = result?.result?.DATA?.RESULT?.[0] || result?.result?.[0] || result?.result
    console.log('[b24] sent ok, files in result:', JSON.stringify(msgResult?.message?.files ?? msgResult?.files ?? 'n/a'))
    if (mediaUrl) console.log('[b24] full result:', JSON.stringify(result?.result).substring(0, 500))
  }

  const returnedChatId =
    result?.result?.DATA?.RESULT?.[0]?.session?.CHAT_ID ||
    result?.result?.DATA?.RESULT_MESSAGE?.[0]?.chat_id ||
    result?.result?.[0]?.chat_id ||
    result?.result?.chat_id
  if (returnedChatId && String(conversation.bitrix24_chat_id) !== String(returnedChatId)) {
    await supabase.from('conversations').update({ bitrix24_chat_id: Number(returnedChatId) }).eq('id', conversation.id)
  }
}

// ---------- Main handler ----------

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    if (WEBHOOK_SECRET) {
      const incoming = req.headers.get('x-webhook-secret') || req.headers.get('X-Webhook-Secret')
      if (incoming !== WEBHOOK_SECRET) return new Response('invalid secret', { status: 401, headers: CORS })
    }

    let raw: any = await req.json().catch(() => null)
    if (typeof raw === 'string') raw = JSON.parse(raw)
    await supabase.from('webhook_logs').insert([{ provider: 'sendpulse', payload: raw, headers: Object.fromEntries(req.headers) }])

    const item = Array.isArray(raw) ? raw[0] : raw
    if (!item) return json({ ok: true })

    const service = (item?.service || '').toLowerCase()
    const channelMap: Record<string, string> = { telegram: 'telegram', whatsapp: 'whatsapp', instagram: 'instagram', facebook: 'facebook', messenger: 'facebook', live_chat: 'live_chat' }
    const channel = channelMap[service] || 'whatsapp'

    const bot = item?.bot || {}
    const contact = item?.contact || {}
    const infoMsg = item?.info?.message || {}
    const lastMsgData = item?.contact?.last_message_data?.message || {}
    const channelMsg = infoMsg?.channel_data?.message || {}

    const botId: string = bot.id || ''
    const contactId: string = contact.id || String(contact.phone || '')
    const contactName: string = contact.name || contact.username || String(contact.phone || '') || 'Unknown'
    const rawPhone = String(contact.phone || contact.variables?.phone || channelMsg?.from || '').replace(/[^\d]/g, '')
    const contactPhone = rawPhone ? '+' + rawPhone : ''

    // Normalise message type first — needed to correctly extract text vs media URL.
    // Instagram sends type=null with media inside channelMsg.attachments[].type
    const rawMsgType: string =
      channelMsg?.type ||
      channelMsg?.attachments?.[0]?.type ||
      channelMsg?.attachment?.type ||
      lastMsgData?.type || 'text'
    const msgTypeMap: Record<string, string> = { image: 'image', audio: 'audio', voice: 'audio', video: 'file', document: 'file', file: 'file', text: 'text', template: 'template' }
    const msgType: string = msgTypeMap[rawMsgType] || 'text'
    const isMediaMsg = msgType === 'image' || msgType === 'audio' || msgType === 'file'

    // Extract text — never use contact.last_message as text when it's a media message
    const infoText = infoMsg?.text
    const liveChatText = (typeof infoText === 'string' ? infoText : '') || channelMsg?.text?.text || ''
    const messageText: string = isMediaMsg ? '' :
      channelMsg?.text?.body ||
      (typeof channelMsg?.text === 'string' ? channelMsg.text : '') ||
      liveChatText ||
      (typeof contact.last_message === 'string' && !contact.last_message.startsWith('http') ? contact.last_message : '') || ''

    // Extract media URL:
    // live_chat sends a relative path in channelMsg.url; the full S3 URL is in contact.last_message
    const lastMsgUrl = (typeof contact.last_message === 'string' && contact.last_message.startsWith('http'))
      ? contact.last_message : ''

    const mediaUrl: string =
      // WhatsApp-style nested objects (.url / .link)
      channelMsg?.image?.url || channelMsg?.image?.link ||
      channelMsg?.document?.url || channelMsg?.document?.link ||
      channelMsg?.audio?.url || channelMsg?.audio?.link ||
      channelMsg?.video?.url || channelMsg?.video?.link ||
      // Telegram: photo array (pick last/largest)
      (Array.isArray(channelMsg?.photo) ? channelMsg.photo[channelMsg.photo.length - 1]?.file_url : null) ||
      channelMsg?.photo?.file_url ||
      // Facebook/Instagram
      channelMsg?.attachment?.payload?.url ||
      (Array.isArray(channelMsg?.attachments) ? channelMsg.attachments[0]?.payload?.url : null) ||
      // last_message_data fallbacks
      lastMsgData?.image?.url || lastMsgData?.image?.link ||
      lastMsgData?.document?.url || lastMsgData?.document?.link ||
      lastMsgData?.audio?.url || lastMsgData?.audio?.link ||
      lastMsgData?.video?.url || lastMsgData?.video?.link ||
      // live_chat: full URL is in contact.last_message when message is media
      (isMediaMsg ? lastMsgUrl : '') || ''

    const mediaFilename: string =
      channelMsg?.document?.filename || channelMsg?.image?.filename ||
      lastMsgData?.document?.filename || lastMsgData?.image?.filename ||
      // derive filename from URL path if nothing else
      (mediaUrl ? decodeURIComponent(mediaUrl.split('/').pop()?.split('?')[0] || '') : '') || ''

    // Platform media ID — WhatsApp/Instagram/Facebook assign numeric IDs to media objects.
    // Used with login.sendpulse.com/api/chatbots-service/{channel}/messages/media endpoint.
    const platformMediaId: string =
      channelMsg?.image?.id || channelMsg?.document?.id ||
      channelMsg?.audio?.id || channelMsg?.video?.id ||
      channelMsg?.sticker?.id || ''

    const messageId: string = channelMsg?.id || item?.info?.message?.id || ''
    const title: string = item?.title || ''
    const direction = (title === 'agent_reply' || title === 'outgoing_message') ? 'outbound' : 'inbound'
    // Use contact.id as conversation key — matches the format set by the original webhook handler
    const conversationKey = contactId

    // Friendly preview for conversation list when message is media-only
    const mediaPreviewText = msgType === 'image' ? '📷 Image' : msgType === 'audio' ? '🎵 Audio' : msgType === 'file' ? '📎 File' : ''
    const effectiveText = messageText || (mediaUrl ? mediaPreviewText : '')

    // Skip outbound echoes — stored by bitrix24Handler
    if (direction === 'outbound') return json({ success: true, skipped: 'outbound' })

    // Dedup: skip if already stored
    if (messageId) {
      const { data: existing } = await supabase.from('messages').select('id').eq('sendpulse_message_id', messageId).limit(1)
      if (existing && existing.length > 0) return json({ success: true, skipped: 'duplicate' })
    }

    // Resolve bot UUID + owner/account from sendpulse_bots (botId is a Mongo hex ID, not a UUID)
    // Prefer org-linked bot rows — duplicate bot_ids exist when account was migrated to org system
    let botUuid: string | null = null
    let ownerId: string | null = null
    let orgId: string | null = null
    let sendpulseAccountId: string | null = null

    console.log(`[webhook] channel=${channel} botId=${botId} contactId=${contactId} direction=${direction}`)

    if (botId) {
      // First try: bot with an org attached (maybeSingle returns null without error on 0 rows)
      const { data: orgBot } = await supabase
        .from('sendpulse_bots')
        .select('id, owner_id, sendpulse_account_id, organization_id')
        .eq('bot_id', botId)
        .not('organization_id', 'is', null)
        .limit(1)
        .maybeSingle()

      // Fall back to any bot row if none has an org
      const { data: anyBot } = orgBot ? { data: orgBot } : await supabase
        .from('sendpulse_bots')
        .select('id, owner_id, sendpulse_account_id, organization_id')
        .eq('bot_id', botId)
        .limit(1)
        .maybeSingle()

      const botRow = orgBot ?? anyBot
      console.log(`[webhook] botRow=${JSON.stringify(botRow)}`)
      if (botRow) {
        botUuid = botRow.id
        ownerId = botRow.owner_id
        orgId = botRow.organization_id
        sendpulseAccountId = botRow.sendpulse_account_id
      }
    }

    // Fall back to account lookup if bot not found in our DB yet
    if (!sendpulseAccountId) {
      console.warn(`[webhook] bot_id=${botId} not found in sendpulse_bots — falling back to account lookup`)
      const { data: acc } = await supabase
        .from('sendpulse_accounts')
        .select('id, owner_id, organization_id')
        .not('organization_id', 'is', null)   // prefer org-aware accounts
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (acc) {
        ownerId = ownerId || acc.owner_id
        orgId = orgId || acc.organization_id
        sendpulseAccountId = acc.id
      }
    }

    // If org still not resolved from bot row, read it from the account
    if (!orgId && sendpulseAccountId) {
      const { data: acc } = await supabase
        .from('sendpulse_accounts')
        .select('organization_id, owner_id')
        .eq('id', sendpulseAccountId)
        .maybeSingle()
      if (acc) {
        orgId = orgId || acc.organization_id
        ownerId = ownerId || acc.owner_id
      }
    }

    console.log(`[webhook] resolved orgId=${orgId} ownerId=${ownerId} sendpulseAccountId=${sendpulseAccountId}`)

    // ── Phase 2: three independent operations in parallel ───────────────────
    // a) Upsert conversation
    // b) Lookup Bitrix24 channel + account (uses botUuid)
    // c) Re-host media to Supabase Storage (uses sendpulseAccountId)
    // All three are independent of each other and can run simultaneously.

    const upsertPayload: any = {
      sendpulse_conversation_id: conversationKey,
      sendpulse_contact_id: contactId,
      contact_name: contactName,
      channel,
      last_message_text: effectiveText.substring(0, 200),
      last_message_at: new Date().toISOString(),
    }
    if (contactPhone) upsertPayload.contact_phone = contactPhone
    if (botUuid) upsertPayload.sendpulse_bot_id = botUuid
    if (ownerId) upsertPayload.owner_id = ownerId
    if (orgId) upsertPayload.organization_id = orgId
    if (sendpulseAccountId) upsertPayload.sendpulse_account_id = sendpulseAccountId

    const [convResult, b24Result, mediaResult] = await Promise.all([

      // a) Conversation upsert
      supabase.from('conversations')
        .upsert([upsertPayload], { onConflict: 'sendpulse_conversation_id', ignoreDuplicates: false })
        .select().limit(1).single()
        .then(({ data, error }) => {
          if (error) console.error('[webhook] conversation upsert error:', JSON.stringify(error))
          else console.log(`[webhook] conversation id=${data?.id} org=${data?.organization_id}`)
          return data
        }),

      // b) Bitrix24 channel + account lookup
      (async () => {
        if (!botUuid) return { channelCfg: null, bxAccount: null }
        const { data: cfgs } = await supabase.from('bitrix24_open_channels').select('*').eq('sendpulse_bot_id', botUuid).limit(1)
        const channelCfg = cfgs?.[0] || null
        if (!channelCfg?.bitrix24_account_id) {
          if (!channelCfg) console.log(`[webhook] no b24 channel mapped to botUuid=${botUuid}`)
          return { channelCfg, bxAccount: null }
        }
        const { data: accs } = await supabase.from('bitrix24_accounts').select('*').eq('id', channelCfg.bitrix24_account_id).limit(1)
        return { channelCfg, bxAccount: accs?.[0] || null }
      })(),

      // c) Media re-hosting (only for media messages)
      (async () => {
        if (!isMediaMsg || (!mediaUrl && !(messageId && platformMediaId))) return { url: mediaUrl, filename: mediaFilename }
        try {
          let spToken: string | null = null
          if (sendpulseAccountId) {
            const { data: accRow } = await supabase.from('sendpulse_accounts')
              .select('access_token, token_expires_at, client_id, client_secret')
              .eq('id', sendpulseAccountId).single()
            if (accRow) {
              if (accRow.access_token && accRow.token_expires_at && new Date(accRow.token_expires_at) > new Date(Date.now() + 60000)) {
                spToken = accRow.access_token
              } else if (accRow.client_id && accRow.client_secret) {
                const tr = await fetch('https://api.sendpulse.com/oauth/access_token', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ grant_type: 'client_credentials', client_id: accRow.client_id, client_secret: accRow.client_secret }),
                })
                const td = await tr.json()
                if (td?.access_token) {
                  spToken = td.access_token
                  await supabase.from('sendpulse_accounts').update({
                    access_token: td.access_token,
                    token_expires_at: new Date(Date.now() + (td.expires_in || 3600) * 1000).toISOString(),
                  }).eq('id', sendpulseAccountId)
                }
              }
            }
          }
          return await reHostMedia({ channel, spMessageId: messageId, platformMediaId, fallbackUrl: mediaUrl, filename: mediaFilename, msgType, spToken })
        } catch (e: any) {
          console.error('[webhook] reHostMedia failed, using original URL:', e.message)
          return { url: mediaUrl, filename: mediaFilename }
        }
      })(),
    ])

    const conversation = convResult
    const { channelCfg, bxAccount } = b24Result
    const finalMediaUrl = mediaResult.url
    const effectiveFilename = mediaResult.filename

    // ── Phase 3: message insert + unread + Bitrix24 forward in parallel ─────
    const tasks: Promise<any>[] = []

    if (effectiveText || finalMediaUrl) {
      tasks.push(
        supabase.from('messages').insert([{
          conversation_id: conversation?.id || null,
          sendpulse_message_id: messageId || null,
          sender_name: contactName,
          message_text: messageText || null,
          message_type: msgType,
          media_url: finalMediaUrl || null,
          media_name: effectiveFilename || null,
          direction,
          channel,
          sent_at: new Date().toISOString(),
        }]).then(({ error: msgErr }) => {
          if (msgErr) console.error('[webhook] message insert error:', JSON.stringify(msgErr))
        })
      )
    }

    if (conversation?.id) {
      tasks.push(
        supabase.from('conversations').select('unread_count').eq('id', conversation.id).single()
          .then(({ data: cur }) =>
            supabase.from('conversations').update({ unread_count: (cur?.unread_count || 0) + 1 }).eq('id', conversation.id)
          )
      )
    }

    if (conversation?.id && bxAccount && channelCfg) {
      tasks.push(
        sendToBitrix24(bxAccount, channelCfg, conversation, messageText, messageId, msgType, finalMediaUrl, effectiveFilename, contactPhone)
          .catch((bxErr: any) => console.error('[webhook] Bitrix24 forward error:', bxErr))
      )
    }

    await Promise.all(tasks)

    return json({ success: true, conversation_id: conversation?.id })
  } catch (err: any) {
    console.error('sendpulseWebhook error:', err.message, err.stack)
    return json({ error: err.message }, 500)
  }
})
