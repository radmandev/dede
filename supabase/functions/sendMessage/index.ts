import { handleCors, jsonResponse, textResponse } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { performSendPulseDelivery, enqueueDelivery, sendTemplateMessage } from '../lib/sendpulse.ts'
import { uploadRemoteAttachment } from '../lib/storage.ts'

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
      message_type, template_name, template_language, template_params, template_header_type, template_media_url,
    } = body || {}
    const text = rawText || message_text || ''
    const isTemplate = message_type === 'template'

    // Persist outbound message
    let convChannel: string | null = null
    let convRow: any = null
    if (conversation_id) {
      const { data: cr } = await supabase.from('conversations').select('*').eq('id', conversation_id).limit(1).single()
      convRow = cr
      convChannel = cr?.channel || null
    }

    const savedText = isTemplate ? (template_name || '') : (text || null)
    const savedType = isTemplate ? 'template' : (attachments?.length ? 'file' : 'text')

    const { data: inserted, error } = await supabase.from('messages').insert([{
      conversation_id: conversation_id || null,
      message_text: savedText,
      message_type: savedType,
      direction: 'outbound',
      channel: convChannel,
    }]).select().limit(1).single()

    if (error) {
      console.error('insert message error', error)
      return jsonResponse({ ok: false, error: String(error) }, 500)
    }

    // Attempt SendPulse delivery
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

      console.log(`[sendMessage] accountId=${accountId} contactId=${contactId} botRowId=${botRowId} channel=${channel} isTemplate=${isTemplate}`)

      if (accountId && contactId) {
        if (isTemplate) {
          const bodyParams = Array.isArray(template_params) ? template_params.filter((p: string) => p && p.trim()) : []
          try {
            await sendTemplateMessage(supabase, accountId, contactId, template_name, template_language || 'en', bodyParams, template_header_type || '', template_media_url || '', botRowId)
          } catch (e) {
            console.error('[sendMessage] template delivery failed:', String(e))
          }
        } else {
          const resolvedAttachments = []
          for (const att of (attachments || [])) {
            if (!att?.link) continue
            try {
              if (!att.link.includes('/storage/v1/object/')) {
                const uploaded = await uploadRemoteAttachment(supabase, att.link)
                resolvedAttachments.push({ link: uploaded.url, name: uploaded.filename, type: att.type || 'document' })
              } else {
                resolvedAttachments.push(att)
              }
            } catch (e) { console.error('attachment upload failed', e) }
          }
          try {
            await performSendPulseDelivery(supabase, accountId, channel, contactId, text, resolvedAttachments, botRowId)
          } catch (e) {
            console.error('delivery failed, enqueuing', e)
            await enqueueDelivery(supabase, { sendpulse_account_id: accountId, conversation_id, message_id: inserted?.id, contact_id: contactId, channel, text, attachments })
          }
        }
      }
    } catch (e) {
      console.error('[sendMessage] delivery setup error:', e)
    }

    return jsonResponse({ ok: true, message: inserted })
  } catch (err) {
    console.error('sendMessage error', err)
    return jsonResponse({ ok: false, error: String(err) }, 500)
  }
})
