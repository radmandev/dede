import { handleCors } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { parseNestedForm } from '../lib/bitrix24.ts'
import { performSendPulseDelivery, sendTemplateMessage } from '../lib/sendpulse.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// Normalise whatever phone string B24 resolves to → plain digits (no + prefix) for SendPulse
function normalizePhone(raw: string): string {
  const cleaned = raw.trim().replace(/[\s\-().]/g, '')
  return cleaned.startsWith('+') ? cleaned.slice(1) : cleaned
}

// Find an existing conversation by SP contact_id or by phone number
async function findConversation(botId: string, spContactId: string | null, phoneDigits: string) {
  if (spContactId) {
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .eq('sendpulse_contact_id', spContactId)
      .eq('sendpulse_bot_id', botId)
      .limit(1)
    if (data?.[0]) return data[0]
  }

  // Fallback: match by phone stored with or without leading +
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('sendpulse_bot_id', botId)
    .or(`contact_phone.eq.+${phoneDigits},contact_phone.eq.${phoneDigits}`)
    .limit(1)
  return data?.[0] || null
}

// Persist the outbound message and update conversation timestamps
async function persistMessage(conversationId: string, text: string, msgType: string, channel: string) {
  await supabase.from('messages').insert([{
    conversation_id: conversationId,
    message_text: text,
    message_type: msgType,
    direction: 'outbound',
    channel,
  }])
  await supabase.from('conversations').update({
    last_message_text: text,
    last_message_at: new Date().toISOString(),
  }).eq('id', conversationId)
}

serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  try {
    // type=message (default) | type=template — set as query param on the HANDLER URL at registration time
    const url = new URL(req.url)
    const type = url.searchParams.get('type') || 'message'

    const contentType = req.headers.get('content-type') || ''
    const bodyText = await req.text()
    let data: any
    if (contentType.includes('application/json') || bodyText.trim().startsWith('{')) {
      try { data = JSON.parse(bodyText) } catch { data = parseNestedForm(bodyText) }
    } else {
      data = parseNestedForm(bodyText)
    }

    const memberId: string = data.auth?.member_id || data.member_id || ''
    const properties: any = data.properties || {}

    // Phone is filled in the rule editor — B24 resolves {=Document:PHONE} before calling us
    const rawPhone = (properties.PHONE || '').trim()
    const messageText = (properties.MESSAGE_TEXT || '').trim()
    const templateName = (properties.TEMPLATE_NAME || '').trim()
    const templateLanguage = (properties.TEMPLATE_LANGUAGE || 'en').trim() || 'en'
    const templateParamsRaw = (properties.TEMPLATE_PARAMS || '').trim()
    const templateParams = templateParamsRaw
      ? templateParamsRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
      : []
    const botIdOverride = (properties.BOT_ID || '').trim()

    console.log(`[b24automation] type=${type} memberId=${memberId} phone=${rawPhone} botIdOverride=${botIdOverride}`)

    if (!rawPhone) {
      console.warn('[b24automation] no phone — skipping')
      return new Response('OK', { status: 200 })
    }
    if (type === 'message' && !messageText) {
      console.warn('[b24automation] no message text — skipping')
      return new Response('OK', { status: 200 })
    }
    if (type === 'template' && !templateName) {
      console.warn('[b24automation] no template name — skipping')
      return new Response('OK', { status: 200 })
    }
    if (!memberId) {
      console.warn('[b24automation] no member_id — skipping')
      return new Response('OK', { status: 200 })
    }

    // Resolve Bitrix24 account
    const { data: accountRows } = await supabase
      .from('bitrix24_accounts')
      .select('*')
      .eq('member_id', memberId)
      .limit(1)
    const bxAccount = accountRows?.[0]
    if (!bxAccount) {
      console.warn(`[b24automation] no B24 account for memberId=${memberId}`)
      return new Response('OK', { status: 200 })
    }

    // Resolve SendPulse bot
    let bot: any = null
    if (botIdOverride) {
      const { data: rows } = await supabase
        .from('sendpulse_bots')
        .select('*')
        .eq('id', botIdOverride)
        .limit(1)
      bot = rows?.[0] || null
    }
    if (!bot) {
      const { data: channels } = await supabase
        .from('bitrix24_open_channels')
        .select('*')
        .eq('bitrix24_account_id', bxAccount.id)
        .not('sendpulse_bot_id', 'is', null)
        .limit(1)
      const linkedChannel = channels?.[0]
      if (linkedChannel?.sendpulse_bot_id) {
        const { data: bots } = await supabase
          .from('sendpulse_bots')
          .select('*')
          .eq('id', linkedChannel.sendpulse_bot_id)
          .limit(1)
        bot = bots?.[0] || null
      }
    }
    if (!bot) {
      console.warn(`[b24automation] no SendPulse bot found for B24 account ${bxAccount.id}`)
      return new Response('OK', { status: 200 })
    }

    const phone = normalizePhone(rawPhone)
    const channel = bot.channel || 'whatsapp'
    console.log(`[b24automation] sending type=${type} phone=${phone} bot=${bot.id} template=${templateName || '-'}`)

    // Always resolve the conversation first — we need sendpulse_contact_id for text sends,
    // and we need the conversation id for message persistence either way
    const conversation = await findConversation(bot.id, null, phone)
    const spContactId = conversation?.sendpulse_contact_id || null
    console.log(`[b24automation] conversation=${conversation?.id || 'none'} spContactId=${spContactId || 'none'}`)

    if (type === 'template') {
      // Templates can be sent by phone via sendTemplateByPhone — no existing contact needed
      const sendId = spContactId || phone  // prefer known contact_id, fall back to phone
      await sendTemplateMessage(
        supabase, bot.sendpulse_account_id, sendId,
        templateName, templateLanguage, templateParams, '', '', bot.id,
      )
    } else {
      // Plain-text sends REQUIRE a contact_id — SP rejects phone-based text sends
      if (!spContactId) {
        console.warn(`[b24automation] no SP contact_id for phone=${phone} — cannot send text without an existing conversation (use a template to re-engage)`)
        return new Response('OK', { status: 200 })
      }
      await performSendPulseDelivery(
        supabase, bot.sendpulse_account_id, channel, spContactId, messageText, [], bot.id,
      )
    }

    console.log(`[b24automation] sent ok`)

    // Persist to DB so the message shows in the app
    if (conversation) {
      const msgText = type === 'template' ? templateName : messageText
      const msgType = type === 'template' ? 'template' : 'text'
      await persistMessage(conversation.id, msgText, msgType, channel)
      console.log(`[b24automation] message persisted to conversation=${conversation.id}`)
    } else {
      console.warn(`[b24automation] no conversation found for phone=${phone} bot=${bot.id} — message sent but not shown in app`)
    }

    return new Response('OK', { status: 200 })

  } catch (err) {
    console.error('[b24automation] error:', err)
    // Always return 200 so Bitrix24 doesn't retry endlessly
    return new Response('OK', { status: 200 })
  }
})
