import { corsHeaders, handleCors } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { callBitrix, ensureBitrixToken, parseNestedForm } from '../lib/bitrix24.ts'
import { ensureSendPulseToken, performSendPulseDelivery } from '../lib/sendpulse.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function withRetry(fn: () => Promise<any>, attempts = 4) {
  let lastErr: any = null
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (e) {
      const err = e as any
      const is429 = /429|rate limit/i.test(err?.message || '') || err?.response?.status === 429
      if (!is429 || i === attempts - 1) { lastErr = e; break }
      await new Promise((resolve) => setTimeout(resolve, 400 * Math.pow(2, i)))
    }
  }
  throw lastErr
}

async function resolveFileAttachments(endpoint: string, token: string, fileIds: any[]) {
  const result = []
  for (const fileId of fileIds) {
    const res = await callBitrix(endpoint, token, 'disk.file.get', { id: fileId })
    const f = res?.result
    if (!f) continue
    const link = f.DOWNLOAD_URL || f.urlDownload || f.url || ''
    if (!link) continue
    const name = f.NAME || f.name || 'file'
    const mime = (f.MIME_TYPE || f.mimeType || '').toString().toLowerCase()
    const type = mime.startsWith('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(name)
      ? 'IMAGE'
      : mime.startsWith('audio') || /\.(mp3|ogg|wav|m4a)$/i.test(name)
      ? 'AUDIO'
      : 'DOCUMENT'
    result.push({ link, name, type, id: fileId })
  }
  return result
}

serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  try {
    const bodyText = await req.text()
    let data: any
    const contentType = req.headers.get('content-type') || ''
    if (contentType.includes('application/json') || bodyText.trim().startsWith('{')) {
      data = JSON.parse(bodyText)
    } else {
      data = parseNestedForm(bodyText)
    }

    const event = data.event
    const accessToken = data.AUTH_ID || data.auth?.access_token || ''
    // client_endpoint is the actual portal REST URL; server_endpoint is the generic OAuth server — never use it as the portal domain
    const clientEndpoint = data.auth?.client_endpoint || ''
    const serverEndpoint = data.SERVER_ENDPOINT || data.auth?.server_endpoint || ''
    const portalEndpoint = clientEndpoint || serverEndpoint
    const expiresIn = parseInt(data.AUTH_EXPIRES || data.auth?.expires_in || '3600', 10)
    const memberId = data.auth?.member_id || data.member_id || ''
    const lineId = data.data?.LINE || data.LINE

    console.log(`[b24handler] event=${event} memberId=${memberId} lineId=${lineId} clientEndpoint=${clientEndpoint} serverEndpoint=${serverEndpoint}`)

    let bxAccount = null
    if (memberId) {
      const { data: accountRows = [] } = await supabase.from('bitrix24_accounts').select('*').eq('member_id', memberId).limit(1)
      bxAccount = accountRows[0] || null
    }

    if (bxAccount && accessToken) {
      const updates: any = { access_token: accessToken, token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString() }
      // Only store domain if it's a real portal URL — never store the generic OAuth servers
      const isOAuthServer = (ep: string) => ep.includes('oauth.bitrix.info') || ep.includes('oauth.bitrix24.tech')
      if (portalEndpoint && !isOAuthServer(portalEndpoint)) updates.domain = portalEndpoint
      else if (bxAccount.domain && isOAuthServer(bxAccount.domain)) {
        // Repair previously corrupted domain using the portal's own domain field
        const portalHost = data.auth?.domain || ''
        if (portalHost) updates.domain = `https://${portalHost}/rest/`
        console.warn(`[b24handler] repairing corrupted domain: was=${bxAccount.domain} new=${updates.domain}`)
      }
      await supabase.from('bitrix24_accounts').update(updates).eq('id', bxAccount.id)
      bxAccount = { ...bxAccount, ...updates }
    }

    if (event === 'ONIMCONNECTORMESSAGEADD') {
      const messages = data.data?.MESSAGES
      if (!messages) return new Response('OK', { status: 200 })

      const { data: channelRows = [] } = await supabase.from('bitrix24_open_channels').select('*').eq('bitrix24_line_id', String(lineId))
      let channelCfg = null
      if (lineId) {
        channelCfg = channelRows.find((c: any) => bxAccount ? c.bitrix24_account_id === bxAccount.id : true) || channelRows[0] || null
      }

      const b24Endpoint = serverEndpoint || bxAccount?.domain || ''
      const b24Token = accessToken || bxAccount?.access_token || ''

      let spAccount = null
      if (channelCfg?.sendpulse_account_id) {
        const { data: spAccounts = [] } = await supabase.from('sendpulse_accounts').select('*').eq('id', channelCfg.sendpulse_account_id).limit(1)
        spAccount = spAccounts[0] || null
      }

      const msgList = Object.values(messages as any) as any[]
      for (const msg of msgList) {
        const chatId = msg.im?.chat_id
        const rawText = msg.message?.text || ''
        const imgMatches = [...rawText.matchAll(/\[IMG\](https?:\/\/[^\[]+)\[\/IMG\]/gi)]
        const bbCodeImages = imgMatches.map((m) => ({ link: m[1].trim(), name: 'image.jpg', type: 'IMAGE' }))
        const messageText = rawText.replace(/\[IMG\][^\[]*\[\/IMG\]/gi, '').replace(/\[b\][^\[]*\[\/b\]/gi, '').replace(/\[br\]/gi, '\n').trim()
        const fileIdList = Array.isArray(msg.message?.params?.FILE_ID) ? msg.message.params.FILE_ID : (msg.message?.params?.FILE_ID ? [msg.message.params.FILE_ID] : [])
        const filesFromParams = msg.message?.params?.FILES ? Object.values(msg.message?.params?.FILES) : []
        const filesFromAttach = Array.isArray(msg.message?.attach) ? msg.message.attach : []

        const hasContent = messageText || fileIdList.length > 0 || filesFromParams.length > 0 || filesFromAttach.length > 0 || bbCodeImages.length > 0
        console.log(`[b24handler] msg chatId=${chatId} text="${messageText?.substring(0, 60)}" hasContent=${!!hasContent} fileIds=${fileIdList.length}`)
        if (!chatId || !hasContent) continue

        const bitrixMsgId = String(msg.im?.message_id || msg.message?.id || '')
        const dedupId = bitrixMsgId ? `b24_${bitrixMsgId}` : ''
        if (dedupId) {
          const { data: existing = [], error: existingErr } = await supabase.from('messages').select('id').eq('sendpulse_message_id', dedupId).limit(1)
          if (existingErr) throw existingErr
          if (existing.length > 0) { console.log(`[b24handler] dedup skip msgId=${dedupId}`); continue }
        }

        let convs: any[] = []
        const { data: conversationsByChat = [], error: chatsErr } = await supabase.from('conversations').select('*').eq('bitrix24_chat_id', Number(chatId))
        if (chatsErr) throw chatsErr
        convs = conversationsByChat
        console.log(`[b24handler] lookup by bitrix24_chat_id=${chatId} → found=${convs.length}`)
        if (convs.length === 0) {
          const origChatId = msg.chat?.id
          console.log(`[b24handler] fallback lookup by sendpulse_contact_id=${origChatId}`)
          if (origChatId) {
            const { data: conversationsByContact = [], error: contactErr } = await supabase.from('conversations').select('*').eq('sendpulse_contact_id', origChatId)
            if (contactErr) throw contactErr
            convs = conversationsByContact
            console.log(`[b24handler] fallback found=${convs.length}`)
          }
        }
        if (convs.length === 0) {
          console.warn(`[b24handler] no conversation for chatId=${chatId} chat.id=${msg.chat?.id}`)
          continue
        }
        const conv = convs[0]

        let resolvedFiles: any[] = []
        if (fileIdList.length > 0 && b24Endpoint && b24Token) {
          resolvedFiles = await resolveFileAttachments(b24Endpoint, b24Token, fileIdList)
        }
        for (const f of filesFromParams as any[]) {
          const link = f.link || f.LINK || f.urlDownload || f.url || ''
          if (link) resolvedFiles.push({ link, name: f.name || f.NAME || 'file', type: (f.type || f.TYPE || '').toString().toUpperCase() || 'DOCUMENT' })
        }
        resolvedFiles.push(...bbCodeImages)
        const attachments = resolvedFiles

        const firstAtt = attachments[0]
        const savedText = messageText || (firstAtt ? firstAtt.name : '')
        const msgType = firstAtt ? (firstAtt.type === 'IMAGE' ? 'image' : firstAtt.type === 'AUDIO' ? 'audio' : 'file') : 'text'
        const { error: insertErr } = await supabase.from('messages').insert([{
          conversation_id: conv.id,
          sendpulse_message_id: dedupId || null,
          sender_name: 'Agent',
          message_text: savedText,
          message_type: msgType,
          media_url: firstAtt?.link || null,
          media_name: firstAtt?.name || null,
          direction: 'outbound',
          channel: conv.channel || 'whatsapp',
          sent_at: new Date().toISOString(),
        }])
        if (insertErr) throw insertErr
        const { error: updateConvErr } = await supabase.from('conversations').update({ last_message_text: messageText || (firstAtt ? `[${msgType}]` : ''), last_message_at: new Date().toISOString() }).eq('id', conv.id)
        if (updateConvErr) throw updateConvErr

        if (spAccount && conv.sendpulse_contact_id) {
          let spToken = spAccount.access_token
          const spExpires = spAccount.token_expires_at ? new Date(spAccount.token_expires_at) : null
          if (!spToken || !spExpires || spExpires < new Date()) {
            spToken = await ensureSendPulseToken(supabase, spAccount.id)
          }
          if (spToken) {
            try {
              await performSendPulseDelivery(supabase, spAccount.id, conv.channel || 'whatsapp', conv.sendpulse_contact_id, messageText, attachments)
            } catch (err) {
              console.error('SendPulse delivery failed:', err)
            }
          }
        }
      }
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error('bitrix24Handler error:', error)
    return new Response('OK', { status: 200 })
  }
})
