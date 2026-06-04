import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { performSendPulseDelivery, enqueueDelivery } from '../lib/sendpulse.ts'
import { uploadRemoteAttachment } from '../lib/storage.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
    const body = await req.json().catch(() => null)
    const { conversation_id, text, attachments, sendpulse_account_id, sendpulse_bot_id } = body || {}

    // Persist outbound message
    const { data: inserted, error } = await supabase.from('messages').insert([{
      conversation_id: conversation_id || null,
      message_text: text || null,
      message_type: attachments && attachments.length ? 'file' : 'text',
      direction: 'outbound',
      channel: null,
    }]).select().limit(1).single()

    if (error) {
      console.error('insert message error', error)
      return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 500 })
    }

    // Attempt delivery via SendPulse
    try {
      // resolve sendpulse account and contact
      let accountId = sendpulse_account_id
      let contactId = null
      if (!accountId && conversation_id) {
        const { data: conv } = await supabase.from('conversations').select('*').eq('id', conversation_id).limit(1)
        if (conv && conv[0]) {
          accountId = conv[0].sendpulse_account_id
          contactId = conv[0].sendpulse_contact_id
        }
      }
      if (!contactId && body.contact_id) contactId = body.contact_id

      if (accountId && contactId) {
        try {
          // if attachments include external links, upload them to storage first and update attachment metadata
          const resolvedAttachments = []
          for (const att of (attachments || [])) {
            if (att.link && !att.link.startsWith('https://') ) {
              // skip non-HTTP links
              continue
            }
            try {
              if (att.link && !att.link.includes('/storage/v1/object/')) {
                const uploaded = await uploadRemoteAttachment(supabase, att.link)
                resolvedAttachments.push({ link: uploaded.url, name: uploaded.filename, type: att.type || 'document' })
              } else {
                resolvedAttachments.push(att)
              }
            } catch (e) {
              console.error('attachment upload failed', e)
            }
          }
          await performSendPulseDelivery(supabase, accountId, body.channel || 'whatsapp', contactId, text || '', resolvedAttachments || [])
        } catch (e) {
          console.error('delivery failed, enqueuing', e)
          await enqueueDelivery(supabase, { sendpulse_account_id: accountId, conversation_id: conversation_id, message_id: inserted?.id, contact_id: contactId, channel: body.channel || 'whatsapp', text, attachments })
        }
      }
    } catch (e) {
      console.error('SendPulse delivery error', e)
    }

    return new Response(JSON.stringify({ ok: true, message: inserted }), { status: 200 })
  } catch (err) {
    console.error('sendMessage error', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 })
  }
})
