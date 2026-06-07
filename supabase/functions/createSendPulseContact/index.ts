import { handleCors, jsonResponse, textResponse } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { ensureSendPulseToken } from '../lib/sendpulse.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  try {
    if (req.method !== 'POST') return textResponse('method not allowed', 405)

    const authToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!authToken) return textResponse('unauthorized', 401)
    const { data: userData, error: userErr } = await supabase.auth.getUser(authToken)
    if (userErr || !userData?.user) return textResponse('unauthorized', 401)

    const body = await req.json().catch(() => ({}))
    const { botId, name, phone } = body || {}
    if (!botId) return jsonResponse({ error: 'botId is required' }, 400)
    if (!phone) return jsonResponse({ error: 'phone is required' }, 400)

    // Look up bot by UUID id first, fall back to bot_id text
    let { data: bots } = await supabase.from('sendpulse_bots').select('*').eq('id', String(botId)).limit(1)
    if (!bots?.length) {
      const { data: bots2 } = await supabase.from('sendpulse_bots').select('*').eq('bot_id', String(botId)).limit(1)
      bots = bots2
    }
    const bot = bots?.[0]
    if (!bot) return jsonResponse({ error: 'Bot not found' }, 404)

    const spToken = await ensureSendPulseToken(supabase, bot.sendpulse_account_id)
    if (!spToken) return jsonResponse({ error: 'Failed to obtain SendPulse token' }, 500)

    // Normalize phone: ensure it starts with +
    const normalizedPhone = phone.trim().startsWith('+') ? phone.trim() : `+${phone.trim()}`

    // Try to find existing contact by phone
    let contactId: string | null = null
    let contactName = name || normalizedPhone

    try {
      const searchRes = await fetch(
        `https://api.sendpulse.com/whatsapp/contacts?bot_id=${encodeURIComponent(bot.bot_id)}&search=${encodeURIComponent(normalizedPhone)}`,
        { headers: { Authorization: `Bearer ${spToken}` } }
      )
      const searchData = await searchRes.json().catch(() => null)
      console.log(`[createContact] search response: ${searchRes.status} ${JSON.stringify(searchData)}`)
      const found = Array.isArray(searchData?.data) ? searchData.data[0] : Array.isArray(searchData) ? searchData[0] : null
      if (found?.id) {
        contactId = String(found.id)
        contactName = found.name || found.first_name || contactName
        console.log(`[createContact] found existing contact id=${contactId}`)
      }
    } catch (e) {
      console.warn('[createContact] search failed:', e)
    }

    // If no existing contact found, try to create one
    if (!contactId) {
      try {
        const createRes = await fetch('https://api.sendpulse.com/whatsapp/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${spToken}` },
          body: JSON.stringify({ bot_id: bot.bot_id, phone: normalizedPhone, name: contactName }),
        })
        const createData = await createRes.json().catch(() => null)
        console.log(`[createContact] create response: ${createRes.status} ${JSON.stringify(createData)}`)
        const created = createData?.data || createData
        if (created?.id) {
          contactId = String(created.id)
          contactName = created.name || created.first_name || contactName
          console.log(`[createContact] created contact id=${contactId}`)
        }
      } catch (e) {
        console.warn('[createContact] create failed:', e)
      }
    }

    // Fall back to phone as the contact key if SP API didn't return an ID
    if (!contactId) {
      contactId = normalizedPhone
      console.log(`[createContact] using phone as contact key: ${contactId}`)
    }

    // Resolve owner + org from bot
    const ownerId = bot.owner_id || null
    const orgId = bot.organization_id || null

    // Check if a conversation already exists for this contact + bot
    const { data: existing } = await supabase
      .from('conversations')
      .select('*')
      .eq('sendpulse_contact_id', contactId)
      .eq('sendpulse_bot_id', bot.id)
      .limit(1)
      .maybeSingle()

    if (existing) {
      console.log(`[createContact] returning existing conversation id=${existing.id}`)
      return jsonResponse({ conversation: existing })
    }

    // Create new conversation
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .insert([{
        sendpulse_contact_id: contactId,
        sendpulse_conversation_id: contactId,
        contact_name: contactName,
        contact_phone: normalizedPhone,
        sendpulse_bot_id: bot.id,
        sendpulse_account_id: bot.sendpulse_account_id,
        channel: bot.channel || 'whatsapp',
        status: 'open',
        owner_id: ownerId,
        organization_id: orgId,
        last_message_at: new Date().toISOString(),
      }])
      .select().limit(1).single()

    if (convErr) {
      console.error('[createContact] insert conversation error:', convErr)
      return jsonResponse({ error: String(convErr.message) }, 500)
    }

    console.log(`[createContact] created conversation id=${conversation.id}`)
    return jsonResponse({ conversation })
  } catch (error) {
    console.error('createSendPulseContact error:', error)
    return jsonResponse({ error: String(error) }, 500)
  }
})
