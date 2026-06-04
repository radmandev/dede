import { serve } from 'std/server'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { performSendPulseDelivery, enqueueDelivery } from '../lib/sendpulse.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') || ''

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

serve(async (req: Request) => {
  try {
    const headers = Object.fromEntries(req.headers)
    if (WEBHOOK_SECRET) {
      const incoming = req.headers.get('x-webhook-secret') || req.headers.get('X-Webhook-Secret')
      if (incoming !== WEBHOOK_SECRET) return new Response('invalid secret', { status: 401 })
    }

    const body = await req.json().catch(() => null)

    // store raw payload for debugging/replay
    await supabase.from('webhook_logs').insert([{ provider: 'sendpulse', payload: body, headers }])

    // Basic mapping: adapt to SendPulse payload shape used by your app
    if (body && (body.message || body.event)) {
      // Upsert conversation by sendpulse_conversation_id
      const convKey = body.conversation_id || body.chat_id || null
      let conversation = null
      if (convKey) {
        const { data: convData, error: convErr } = await supabase.from('conversations').upsert([{ sendpulse_conversation_id: convKey, contact_name: body.contact_name || null, contact_phone: body.contact_phone || null, channel: body.channel || null }], { onConflict: 'sendpulse_conversation_id' }).select().limit(1).single()
        if (convErr && convErr.code !== 'PGRST116') console.error('conv upsert err', convErr)
        conversation = convData
      }

      // Insert message
      const messagePayload = body.message || body.event || body
      const { data: inserted } = await supabase.from('messages').insert([{
        conversation_id: conversation ? conversation.id : null,
        sendpulse_message_id: messagePayload.id || null,
        sender_name: messagePayload.from || messagePayload.sender || null,
        message_text: messagePayload.text || messagePayload.body || null,
        message_type: messagePayload.type || 'text',
        direction: 'inbound',
        channel: body.channel || null,
        sent_at: messagePayload.sent_at || messagePayload.timestamp || null
      }]).select().limit(1).single()

      // If message has attachments with external links, upload them to storage and record attachments
      try {
        const attachments = messagePayload.attachments || messagePayload.files || []
        for (const att of attachments) {
          if (!att || !att.link) continue
          try {
            const uploaded = await import('../lib/storage.ts').then(m => m.uploadRemoteAttachment(supabase, att.link))
            // associate attachment row with conversation/message
            await supabase.from('attachments').update({ conversation_id: conversation ? conversation.id : null, message_id: inserted?.id }).eq('id', uploaded.id)
          } catch (e) { console.error('attachment upload error', e) }
        }
      } catch (e) { console.error('attachments processing error', e) }

      // If conversation has linked sendpulse_account and contact, attempt immediate delivery; otherwise queue
      try {
        if (conversation && conversation.sendpulse_account_id && conversation.sendpulse_contact_id) {
          try {
            await performSendPulseDelivery(supabase, conversation.sendpulse_account_id, conversation.channel || 'whatsapp', conversation.sendpulse_contact_id, messagePayload.text || messagePayload.body || '', [])
          } catch (e) {
            console.error('delivery failed, enqueuing', e)
            await enqueueDelivery(supabase, { sendpulse_account_id: conversation.sendpulse_account_id, conversation_id: conversation.id, message_id: null, contact_id: conversation.sendpulse_contact_id, channel: conversation.channel || 'whatsapp', text: messagePayload.text || messagePayload.body || '', attachments: [] })
          }
        }
      } catch (e) { console.error('ensure token/delivery error', e) }
    }

    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error('sendpulseWebhook error', err)
    return new Response('error', { status: 500 })
  }
})
