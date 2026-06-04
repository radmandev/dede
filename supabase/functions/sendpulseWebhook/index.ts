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

    if (!body || (!body.message && !body.event)) {
      return new Response('ok', { status: 200 })
    }

    // Resolve owner_id from the bot that received this message
    let ownerId: string | null = null
    let sendpulseAccountId: string | null = null
    const botId = body.bot_id || body.chatbot_id || null
    if (botId) {
      const { data: bot } = await supabase
        .from('sendpulse_bots')
        .select('id, owner_id, sendpulse_account_id')
        .eq('bot_id', botId)
        .limit(1)
        .single()
      if (bot) {
        ownerId = bot.owner_id
        sendpulseAccountId = bot.sendpulse_account_id
      }
    }

    // Fall back to first account owner if bot not found
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

    const convKey = body.conversation_id || body.chat_id || null
    let conversation: any = null

    if (convKey) {
      const upsertPayload: any = {
        sendpulse_conversation_id: convKey,
        contact_name: body.contact_name || null,
        contact_phone: body.contact_phone || null,
        channel: body.channel || null,
      }
      if (ownerId) upsertPayload.owner_id = ownerId
      if (sendpulseAccountId) upsertPayload.sendpulse_account_id = sendpulseAccountId

      const { data: convData, error: convErr } = await supabase
        .from('conversations')
        .upsert([upsertPayload], { onConflict: 'sendpulse_conversation_id' })
        .select()
        .limit(1)
        .single()
      if (convErr && convErr.code !== 'PGRST116') console.error('conv upsert err', convErr)
      conversation = convData
    }

    const messagePayload = body.message || body.event || body
    await supabase.from('messages').insert([{
      conversation_id: conversation ? conversation.id : null,
      sendpulse_message_id: messagePayload.id || null,
      sender_name: messagePayload.from || messagePayload.sender || null,
      message_text: messagePayload.text || messagePayload.body || null,
      message_type: messagePayload.type || 'text',
      direction: 'inbound',
      channel: body.channel || null,
      sent_at: messagePayload.sent_at || messagePayload.timestamp || null,
    }])

    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error('sendpulseWebhook error', err)
    return new Response('error', { status: 500 })
  }
})
