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

async function uploadToStorage(buffer: ArrayBuffer, contentType: string, filename: string): Promise<string> {
  const safeBase = (filename || `media_${Date.now()}`)
    .replace(/[^\x00-\x7F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 80)
  const storagePath = `attachments/${Date.now()}_${safeBase}`
  const { error } = await supabase.storage
    .from('attachments')
    .upload(storagePath, new Uint8Array(buffer), { contentType, upsert: false })
  if (error) throw error
  return supabase.storage.from('attachments').getPublicUrl(storagePath).data?.publicUrl || ''
}

async function reHostMedia(opts: {
  channel: string
  spMessageId: string       // SendPulse internal message ID
  platformMediaId: string   // WhatsApp/Instagram/Facebook numeric media ID
  fallbackUrl: string       // S3 or other direct URL
  filename: string
  spToken: string | null
}): Promise<string> {
  const { channel, spMessageId, platformMediaId, fallbackUrl, filename, spToken } = opts

  // Strategy 1: login.sendpulse.com media proxy — works for all channels with a Bearer token.
  // URL shape: /api/chatbots-service/{channel}/messages/media?message_id=...&id=...
  if (spToken && spMessageId) {
    const channelSlug = channel === 'live_chat' ? 'live-chat' : channel
    const idParam = platformMediaId ? `&id=${encodeURIComponent(platformMediaId)}` : ''
    const proxyUrl = `https://login.sendpulse.com/api/chatbots-service/${channelSlug}/messages/media?message_id=${spMessageId}${idParam}`
    try {
      const res = await fetch(proxyUrl, { headers: { 'Authorization': `Bearer ${spToken}` } })
      if (res.ok) {
        const buffer = await res.arrayBuffer()
        const contentType = res.headers.get('content-type') || 'application/octet-stream'
        return await uploadToStorage(buffer, contentType, filename)
      }
      console.log(`proxy ${proxyUrl} → ${res.status}`)
    } catch (e: any) { console.error('proxy fetch error:', e.message) }
  }

  // Strategy 2: direct URL (works for public CDN files, fails for private S3)
  if (fallbackUrl) {
    let encodedUrl = fallbackUrl
    try { encodedUrl = encodeURI(decodeURI(fallbackUrl)) } catch { /* keep */ }
    try {
      const res = await fetch(encodedUrl)
      if (res.ok) {
        const buffer = await res.arrayBuffer()
        const contentType = res.headers.get('content-type') || 'application/octet-stream'
        return await uploadToStorage(buffer, contentType, filename)
      }
    } catch (e: any) { console.error('direct fetch error:', e.message) }
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
  if (!account.domain || !channelCfg.bitrix24_line_id) return

  let token = account.access_token
  const expires = account.token_expires_at ? new Date(account.token_expires_at) : null
  if (!token || !expires || expires < new Date()) {
    const refreshed = await refreshBitrix24Token(account)
    if (refreshed?.access_token) token = refreshed.access_token
    else { console.warn('Bitrix24 token refresh failed — skipping forward'); return }
  }

  const CONNECTOR_ID = channelCfg.bitrix24_connector_id || 'whatsapp_sendpulse'
  const unixNow = Math.floor(Date.now() / 1000)
  const messageObj: any = { id: messageId || String(Date.now()), date: unixNow, text: messageText, type: 'text' }

  if (mediaUrl) {
    const isImage = msgType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(mediaFilename || '')
    const isAudio = msgType === 'audio'
    const fileType = isImage ? 'IMAGE' : isAudio ? 'AUDIO' : 'DOCUMENT'
    messageObj.FILES = { '0': { link: mediaUrl, name: mediaFilename || 'file', type: fileType } }
    if (!messageText) messageObj.type = fileType.toLowerCase()
  }

  const payload = {
    CONNECTOR: CONNECTOR_ID,
    LINE: Number(channelCfg.bitrix24_line_id),
    MESSAGES: [{
      user: {
        id: conversation.sendpulse_contact_id,
        name: conversation.contact_name || 'Customer',
        phone: contactPhone || conversation.contact_phone || '',
        avatar: '', online: true,
      },
      message: messageObj,
      chat: { id: conversation.sendpulse_contact_id },
    }],
  }

  const endpoint = account.domain.endsWith('/') ? account.domain : account.domain + '/'
  const res = await fetch(`${endpoint}imconnector.send.messages?auth=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = await res.json()
  console.log('Bitrix24 forward result:', JSON.stringify(result))

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

    // Re-host media to Supabase Storage for a stable public URL.
    // Primary strategy: SendPulse's own media proxy at login.sendpulse.com (requires Bearer token).
    // Fallback: direct URL fetch (works for public CDN files, not private S3).
    let finalMediaUrl = mediaUrl
    if (isMediaMsg && (mediaUrl || (messageId && platformMediaId))) {
      try {
        // Get SendPulse access token
        let spToken: string | null = null
        if (sendpulseAccountId) {
          const { data: accRow } = await supabase
            .from('sendpulse_accounts')
            .select('access_token, token_expires_at, client_id, client_secret')
            .eq('id', sendpulseAccountId)
            .single()
          if (accRow) {
            if (accRow.access_token && accRow.token_expires_at && new Date(accRow.token_expires_at) > new Date(Date.now() + 60000)) {
              spToken = accRow.access_token
            } else if (accRow.client_id && accRow.client_secret) {
              const tr = await fetch('https://api.sendpulse.com/oauth/access_token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
        finalMediaUrl = await reHostMedia({ channel, spMessageId: messageId, platformMediaId, fallbackUrl: mediaUrl, filename: mediaFilename, spToken })
      } catch (e: any) {
        console.error('reHostMedia failed, storing original URL:', e.message)
      }
    }

    // Upsert conversation — always, regardless of Bitrix24 mapping
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

    const { data: convData, error: convErr } = await supabase
      .from('conversations')
      .upsert([upsertPayload], { onConflict: 'sendpulse_conversation_id', ignoreDuplicates: false })
      .select()
      .limit(1)
      .single()

    if (convErr) console.error('[webhook] conversation upsert error:', JSON.stringify(convErr))
    else console.log(`[webhook] conversation id=${convData?.id} org=${convData?.organization_id}`)
    const conversation = convData

    // Increment unread count
    if (conversation?.id) {
      const { data: cur } = await supabase.from('conversations').select('unread_count').eq('id', conversation.id).single()
      await supabase.from('conversations').update({ unread_count: (cur?.unread_count || 0) + 1 }).eq('id', conversation.id)
    }

    // Insert message
    if (effectiveText || finalMediaUrl) {
      const { error: msgErr } = await supabase.from('messages').insert([{
        conversation_id: conversation?.id || null,
        sendpulse_message_id: messageId || null,
        sender_name: contactName,
        message_text: messageText || null,
        message_type: msgType,
        media_url: finalMediaUrl || null,
        media_name: mediaFilename || null,
        direction,
        channel,
        sent_at: new Date().toISOString(),
      }])
      if (msgErr) console.error('[webhook] message insert error:', JSON.stringify(msgErr))
    }

    // Optionally forward to Bitrix24 if this bot is mapped to an open channel
    if (conversation?.id && botId) {
      const { data: channelCfgs } = await supabase
        .from('bitrix24_open_channels')
        .select('*')
        .eq('sendpulse_bot_id', botId)
        .limit(1)
      const channelCfg = channelCfgs?.[0]

      if (channelCfg?.bitrix24_account_id) {
        const { data: bxAccounts } = await supabase
          .from('bitrix24_accounts')
          .select('*')
          .eq('id', channelCfg.bitrix24_account_id)
          .limit(1)
        const bxAccount = bxAccounts?.[0]
        if (bxAccount) {
          try {
            await sendToBitrix24(bxAccount, channelCfg, conversation, messageText, messageId, msgType, mediaUrl, mediaFilename, contactPhone)
          } catch (bxErr: any) {
            console.error('Bitrix24 forward error:', bxErr)
          }
        }
      }
    }

    return json({ success: true, conversation_id: conversation?.id })
  } catch (err: any) {
    console.error('sendpulseWebhook error:', err.message, err.stack)
    return json({ error: err.message }, 500)
  }
})
