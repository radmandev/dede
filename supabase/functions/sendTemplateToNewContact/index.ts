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
    const {
      botId, phone, name,
      templateName, templateLanguage,
      templateParams, templateHeaderType, templateMediaUrl,
    } = body || {}

    if (!botId)        return jsonResponse({ error: 'botId is required' }, 400)
    if (!phone)        return jsonResponse({ error: 'phone is required' }, 400)
    if (!templateName) return jsonResponse({ error: 'templateName is required' }, 400)

    // Resolve bot row
    let { data: bots } = await supabase.from('sendpulse_bots').select('*').eq('id', String(botId)).limit(1)
    if (!bots?.length) {
      const { data: b2 } = await supabase.from('sendpulse_bots').select('*').eq('bot_id', String(botId)).limit(1)
      bots = b2
    }
    const bot = bots?.[0]
    if (!bot) return jsonResponse({ error: 'Bot not found' }, 404)

    const spToken = await ensureSendPulseToken(supabase, bot.sendpulse_account_id)
    if (!spToken) return jsonResponse({ error: 'Failed to obtain SendPulse token' }, 500)

    // SP expects phone in E.164 WITHOUT the leading + (e.g. 9665551234)
    const normalized = phone.trim().startsWith('+') ? phone.trim() : `+${phone.trim()}`
    const phoneDigits = normalized.replace(/^\+/, '')
    const contactName = name?.trim() || normalized

    const langCode = (templateLanguage || 'en').toLowerCase()

    // Build template components following the SP spec
    const components: any[] = []
    const headerType = (templateHeaderType || '').toUpperCase()

    if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) && templateMediaUrl) {
      const paramType = headerType.toLowerCase()
      components.push({
        type: 'header',
        parameters: [{
          type: paramType,
          [paramType]: paramType === 'document'
            ? { link: templateMediaUrl, filename: 'document' }
            : { link: templateMediaUrl },
        }],
      })
    }

    const bodyParams = Array.isArray(templateParams)
      ? templateParams.filter((p: string) => p && p.trim())
      : []
    if (bodyParams.length > 0) {
      components.push({
        type: 'body',
        parameters: bodyParams.map((v: string) => ({ type: 'text', text: v })),
      })
    }

    const spPayload = {
      bot_id: bot.bot_id,
      phone: phoneDigits,
      template: {
        name: templateName,
        language: { code: langCode },
        ...(components.length > 0 ? { components } : {}),
      },
    }

    console.log(`[sendTemplateToNewContact] sendTemplateByPhone phone=${phoneDigits} bot_id=${bot.bot_id} template=${templateName}`)
    console.log(`[sendTemplateToNewContact] payload: ${JSON.stringify(spPayload)}`)

    // Single SP call: creates/finds contact AND sends template
    const spRes = await fetch('https://api.sendpulse.com/whatsapp/contacts/sendTemplateByPhone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${spToken}` },
      body: JSON.stringify(spPayload),
    })
    const spData = await spRes.json().catch(() => null)
    console.log(`[sendTemplateToNewContact] SP response: ${spRes.status} ${JSON.stringify(spData)}`)

    if (!spRes.ok || spData?.success === false) {
      const errMsg = spData?.message || spData?.error || `SendPulse returned ${spRes.status}`
      console.error(`[sendTemplateToNewContact] SP error: ${errMsg}`)
      return jsonResponse({ error: errMsg }, 422)
    }

    // SP returns message.contact_id — use that as the canonical SP contact identifier
    const spContactId: string = spData?.data?.contact_id || phoneDigits

    // Check for existing conversation with this contact+bot
    const { data: existing } = await supabase
      .from('conversations')
      .select('*')
      .eq('sendpulse_contact_id', spContactId)
      .eq('sendpulse_bot_id', bot.id)
      .limit(1)
      .maybeSingle()

    if (existing) {
      const updated = { ...existing, last_message_at: new Date().toISOString() }
      await supabase.from('conversations').update({ last_message_at: updated.last_message_at }).eq('id', existing.id)
      await supabase.from('messages').insert([{
        conversation_id: existing.id,
        message_text: templateName,
        message_type: 'template',
        direction: 'outbound',
        channel: 'whatsapp',
      }])
      return jsonResponse({ conversation: updated })
    }

    // Create conversation
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .insert([{
        sendpulse_contact_id: spContactId,
        sendpulse_conversation_id: spContactId,
        contact_name: contactName,
        contact_phone: normalized,
        sendpulse_bot_id: bot.id,
        sendpulse_account_id: bot.sendpulse_account_id,
        channel: bot.channel || 'whatsapp',
        status: 'open',
        owner_id: bot.owner_id || null,
        organization_id: bot.organization_id || null,
        last_message_at: new Date().toISOString(),
      }])
      .select()
      .limit(1)
      .single()

    if (convErr) {
      console.error('[sendTemplateToNewContact] conversation insert error:', convErr)
      return jsonResponse({ error: String(convErr.message) }, 500)
    }

    // Insert outbound message record
    await supabase.from('messages').insert([{
      conversation_id: conversation.id,
      message_text: templateName,
      message_type: 'template',
      direction: 'outbound',
      channel: 'whatsapp',
    }])

    console.log(`[sendTemplateToNewContact] done. conversation=${conversation.id} contact=${spContactId}`)
    return jsonResponse({ conversation })

  } catch (err) {
    console.error('[sendTemplateToNewContact] unhandled error:', err)
    return jsonResponse({ error: String(err) }, 500)
  }
})
