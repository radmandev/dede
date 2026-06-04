import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

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
    await supabase.from('webhook_logs').insert([{ provider: 'sendpulse', payload: body, headers }])

    // SendPulse sends an array of events
    const events = Array.isArray(body) ? body : [body]

    for (const event of events) {
      if (!event || event.title !== 'incoming_message') continue

      const botId: string = event.bot?.id || null
      const channel: string = (event.bot?.channel || event.service || 'live_chat').toLowerCase()
      const contact = event.contact || {}
      const msgData = event.info?.message?.channel_data?.message || {}
      const messageText: string = msgData.text || msgData.body || ''
      const messageId: string = event.info?.message?.id || null
      const sentAt: string | null = event.date ? new Date(event.date * 1000).toISOString() : null

      // Resolve owner_id from the bot
      let ownerId: string | null = null
      let sendpulseAccountId: string | null = null

      if (botId) {
        const { data: bot } = await supabase
          .from('sendpulse_bots')
          .select('owner_id, sendpulse_account_id')
          .eq('bot_id', botId)
          .limit(1)
          .single()
        if (bot) {
          ownerId = bot.owner_id
          sendpulseAccountId = bot.sendpulse_account_id
        }
      }

      // Fall back to first account if bot not registered yet
      if (!ownerId) {
        const { data: acc } = await supabase
          .from('sendpulse_accounts')
          .select('id, owner_id')
          .order('created_at', { ascending: true })
          .limit(1)
          .single()
        if (acc) {
          ownerId = acc.owner_id
          sendpulseAccountId = acc.id
        }
      }

      // Upsert conversation keyed by contact.id
      const convKey = contact.id || null
      let conversation: any = null

      if (convKey) {
        const upsertPayload: any = {
          sendpulse_conversation_id: convKey,
          contact_name: contact.name || null,
          channel,
          last_message_text: messageText,
          last_message_at: sentAt,
        }
        if (ownerId) upsertPayload.owner_id = ownerId
        if (sendpulseAccountId) upsertPayload.sendpulse_account_id = sendpulseAccountId

        const { data: convData, error: convErr } = await supabase
          .from('conversations')
          .upsert([upsertPayload], { onConflict: 'sendpulse_conversation_id' })
          .select()
          .limit(1)
          .single()

        if (convErr) console.error('conv upsert err', convErr)
        conversation = convData
      }

      // Insert message
      const { error: msgErr } = await supabase.from('messages').insert([{
        conversation_id: conversation?.id || null,
        sendpulse_message_id: messageId,
        sender_name: contact.name || null,
        message_text: messageText,
        message_type: msgData.type || 'text',
        direction: 'inbound',
        channel,
        sent_at: sentAt,
      }])

      if (msgErr) console.error('message insert err', msgErr)
    }

    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error('sendpulseWebhook error', err)
    return new Response('error', { status: 500 })
  }
})
