import { handleCors, jsonResponse, textResponse } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { performSendPulseDelivery, enqueueDelivery } from '../lib/sendpulse.ts'
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
    const { conversation_id, text: rawText, message_text, attachments, sendpulse_account_id } = body || {}
    const text = rawText || message_text || ''

    // Persist outbound message
    const { data: inserted, error } = await supabase.from('messages').insert([{
      conversation_id: conversation_id || null,
      message_text: text || null,
      message_type: attachments?.length ? 'file' : 'text',
      direction: 'outbound',
      channel: null,
    }]).select().limit(1).single()

    if (error) {
      console.error('insert message error', error)
      return jsonResponse({ ok: false, error: String(error) }, 500)
    }

    // Attempt SendPulse delivery
    try {
      let accountId = sendpulse_account_id
      let contactId = null

      if (conversation_id) {
        const { data: conv } = await supabase.from('conversations').select('*').eq('id', conversation_id).limit(1)
        if (conv?.[0]) {
          if (!accountId) accountId = conv[0].sendpulse_account_id
          contactId = conv[0].sendpulse_contact_id
        }
      }
      if (!contactId && body?.contact_id) contactId = body.contact_id

      if (accountId && contactId) {
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
          await performSendPulseDelivery(supabase, accountId, body?.channel || 'live_chat', contactId, text, resolvedAttachments)
        } catch (e) {
          console.error('delivery failed, enqueuing', e)
          await enqueueDelivery(supabase, { sendpulse_account_id: accountId, conversation_id, message_id: inserted?.id, contact_id: contactId, channel: body?.channel || 'live_chat', text, attachments })
        }
      }
    } catch (e) {
      console.error('SendPulse delivery error', e)
    }

    return jsonResponse({ ok: true, message: inserted })
  } catch (err) {
    console.error('sendMessage error', err)
    return jsonResponse({ ok: false, error: String(err) }, 500)
  }
})
