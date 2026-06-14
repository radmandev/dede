import { handleCors, jsonResponse, textResponse } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { performSendPulseDelivery, enqueueDelivery, sendTemplateMessage } from '../lib/sendpulse.ts'
import { uploadRemoteAttachment } from '../lib/storage.ts'
import { sendToBitrix24 } from '../lib/bitrix24.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  try {
    if (req.method !== 'POST') return textResponse('method not allowed', 405)

    const body = await req.json().catch(() => null)
    const {
      conversation_id, text: rawText, message_text, attachments, sendpulse_account_id,
      message_type, media_url, media_name,
      template_name, template_language, template_params, template_header_type, template_media_url,
    } = body || {}
    const text = rawText || message_text || ''
    const isTemplate = message_type === 'template'

    // Build effective attachments: frontend sends media_url/media_name directly (no attachments array)
    let effectiveAttachments: any[] = attachments || []
    if (media_url && effectiveAttachments.length === 0) {
      const attType = message_type === 'image' ? 'image'
                    : message_type === 'audio' ? 'audio'
                    : message_type === 'voice' ? 'voice'
                    : 'document'
      effectiveAttachments = [{ link: media_url, name: media_name || 'file', type: attType }]
    }

    // Persist outbound message
    let convChannel: string | null = null
    let convRow: any = null
    if (conversation_id) {
      const { data: cr } = await supabase.from('conversations').select('*').eq('id', conversation_id).limit(1).single()
      convRow = cr
      convChannel = cr?.channel || null
    }

    const savedText = isTemplate ? (template_name || '') : (text || null)
    const savedType = isTemplate ? 'template' : (message_type || (effectiveAttachments.length ? 'file' : 'text'))

    const { data: inserted, error } = await supabase.from('messages').insert([{
      conversation_id: conversation_id || null,
      message_text: savedText,
      message_type: savedType,
      media_url: media_url || null,
      media_name: media_name || null,
      direction: 'outbound',
      channel: convChannel,
    }]).select().limit(1).single()

    if (error) {
      console.error('insert message error', error)
      return jsonResponse({ ok: false, error: String(error) }, 500)
    }

    // Attempt SendPulse delivery — track every step so diagnostics are returned to the caller
    const delivery: any = { status: 'pending' }
    try {
      let accountId = sendpulse_account_id
      let contactId = null
      let channel = body?.channel || null

      let botRowId = ''
      if (convRow) {
        if (!accountId) accountId = convRow.sendpulse_account_id
        contactId = convRow.sendpulse_contact_id
        if (!channel) channel = convRow.channel
        botRowId = convRow.sendpulse_bot_id || ''
      }
      if (!contactId && body?.contact_id) contactId = body.contact_id
      channel = channel || 'live_chat'

      delivery.accountId = accountId || null
      delivery.contactId = contactId || null
      delivery.channel = channel
      delivery.botRowId = botRowId || null

      console.log(`[sendMessage] accountId=${accountId} contactId=${contactId} botRowId=${botRowId} channel=${channel} isTemplate=${isTemplate}`)

      if (!accountId || !contactId) {
        delivery.status = 'skipped'
        delivery.reason = !accountId ? 'no-account-id' : 'no-contact-id'
        console.warn(`[sendMessage] delivery skipped: ${delivery.reason}`)
      } else if (isTemplate) {
        const bodyParams = Array.isArray(template_params) ? template_params.filter((p: string) => p && p.trim()) : []
        const deliveryResult = await sendTemplateMessage(supabase, accountId, contactId, template_name, template_language || 'en', bodyParams, template_header_type || '', template_media_url || '', botRowId)
          .catch((e: any) => ({ error: String(e) }))
        if ((deliveryResult as any)?.error) {
          console.error('[sendMessage] template delivery failed:', (deliveryResult as any).error)
          await supabase.from('messages').update({ message_text: `[delivery failed] ${template_name}` }).eq('id', inserted?.id)
          return jsonResponse({ ok: false, error: (deliveryResult as any).error, message: inserted, delivery }, 200)
        }
        delivery.status = 'ok'
      } else {
        const resolvedAttachments: any[] = []
        for (const att of effectiveAttachments) {
          if (!att?.link) continue
          try {
            if (att.link.includes('/storage/v1/object/public/')) {
              // Create a signed URL so external services can access regardless of bucket policy
              const bucketMatch = att.link.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)/)
              if (bucketMatch) {
                const [, bucketName, storagePath] = bucketMatch
                const { data: signedData, error: signErr } = await supabase.storage
                  .from(bucketName).createSignedUrl(storagePath, 604800) // 7 days
                const signedUrl = signedData?.signedUrl
                console.log(`[sendMessage] signed url bucket=${bucketName} path=${storagePath} ok=${!!signedUrl} err=${signErr?.message}`)
                delivery.signedUrl = signedUrl ? signedUrl.substring(0, 120) + '…' : null
                delivery.signErr = signErr?.message || null
                resolvedAttachments.push({ link: signedUrl || att.link, name: att.name, type: att.type || 'document' })
              } else {
                resolvedAttachments.push(att)
              }
            } else if (att.link.includes('/storage/v1/object/')) {
              resolvedAttachments.push(att)
            } else {
              const uploaded = await uploadRemoteAttachment(supabase, att.link)
              resolvedAttachments.push({ link: uploaded.url, name: uploaded.filename, type: att.type || 'document' })
            }
          } catch (e) { console.error('attachment upload failed', e) }
        }
        delivery.resolvedCount = resolvedAttachments.length
        try {
          const spResults = await performSendPulseDelivery(supabase, accountId, channel, contactId, text, resolvedAttachments, botRowId)
          delivery.status = 'ok'
          delivery.spResults = spResults
        } catch (e: any) {
          delivery.status = 'queued'
          delivery.error = String(e)
          console.error('delivery failed, enqueuing', e)
          await enqueueDelivery(supabase, { sendpulse_account_id: accountId, conversation_id, message_id: inserted?.id, contact_id: contactId, channel, text, attachments: effectiveAttachments })
        }
      }
    } catch (e: any) {
      delivery.status = 'error'
      delivery.error = String(e)
      console.error('[sendMessage] delivery setup error:', e)
    }

    // Forward to Bitrix24 open channel if conversation is linked
    if (convRow?.sendpulse_bot_id) {
      try {
        const { data: cfgs } = await supabase.from('bitrix24_open_channels')
          .select('*').eq('sendpulse_bot_id', convRow.sendpulse_bot_id).limit(1)
        const channelCfg = cfgs?.[0]
        if (channelCfg?.bitrix24_account_id && channelCfg?.bitrix24_line_id) {
          const { data: accs } = await supabase.from('bitrix24_accounts')
            .select('*').eq('id', channelCfg.bitrix24_account_id).limit(1)
          const bxAccount = accs?.[0]
          if (bxAccount) {
            const fwdText = isTemplate ? (template_name || '') : text
            const fwdType = isTemplate ? 'text' : (message_type || '')
            await sendToBitrix24(supabase, bxAccount, channelCfg, convRow, fwdText, String(inserted.id), fwdType, media_url || '', media_name || '', convRow.contact_phone || '')
            console.log(`[sendMessage] forwarded to Bitrix24 conv=${convRow.id}`)
          }
        }
      } catch (b24err) {
        console.error('[sendMessage] Bitrix24 forward error:', b24err)
      }
    }

    return jsonResponse({ ok: true, message: inserted, delivery })
  } catch (err) {
    console.error('sendMessage error', err)
    return jsonResponse({ ok: false, error: String(err) }, 500)
  }
})
