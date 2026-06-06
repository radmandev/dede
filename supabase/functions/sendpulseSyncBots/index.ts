import { handleCors, jsonResponse, textResponse } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { ensureSendPulseToken } from '../lib/sendpulse.ts'
import { makeJsonResponse } from '../lib/bitrix24.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Webhook URL is always the Supabase functions endpoint — never the app's frontend URL
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/sendpulseWebhook`
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const CHANNELS = [
  { key: 'whatsapp', list: 'whatsapp/bots', webhook: 'whatsapp/webhooks' },
  { key: 'telegram', list: 'telegram/bots', webhook: 'telegram/webhooks' },
  { key: 'instagram', list: 'instagram/bots', webhook: 'instagram/webhooks' },
  { key: 'facebook', list: 'messenger/bots', webhook: 'messenger/webhooks' },
  { key: 'live_chat', list: 'live-chat/bots', webhook: 'live-chat/webhooks' },
]

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
    const { sendpulse_account_id, origin } = body || {}
    if (!sendpulse_account_id) return makeJsonResponse({ error: 'Missing sendpulse_account_id' }, 400)

    const { data: accounts, error: accountErr } = await supabase.from('sendpulse_accounts').select('*').eq('id', sendpulse_account_id).limit(1)
    if (accountErr) throw accountErr
    const account = accounts?.[0]
    if (!account?.client_id) return makeJsonResponse({ error: 'Account not configured' }, 400)

    const token = await ensureSendPulseToken(supabase, account.id)
    if (!token) return makeJsonResponse({ error: 'Failed to authenticate with SendPulse' }, 400)

    const webhookUrl = WEBHOOK_URL

    const { data: existingBots = [], error: existingErr } = await supabase.from('sendpulse_bots').select('*').eq('sendpulse_account_id', sendpulse_account_id)
    if (existingErr) throw existingErr
    const existingByKey = {}
    for (const bot of existingBots) {
      existingByKey[`${bot.channel}_${bot.bot_id}`] = bot
    }

    const bots = []
    const webhooks = []

    for (const ch of CHANNELS) {
      const listRes = await fetch(`https://api.sendpulse.com/${ch.list}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } })
      if (!listRes.ok) continue
      const listData = await listRes.json().catch(() => null)
      const arr = Array.isArray(listData?.data) ? listData.data : (Array.isArray(listData) ? listData : [])
      if (!arr.length) continue

      for (const bot of arr) {
        const botId = String(bot.id || bot.bot_id || '')
        if (!botId) continue
        const name = bot.name || bot.channel_data?.name || bot.title || `${ch.key} bot`
        const key = `${ch.key}_${botId}`

        // Register webhook per-bot — more reliable than channel-level registration
        let webhookOk = false
        if (webhookUrl) {
          // Try per-bot endpoint first (e.g. /whatsapp/bots/{id}/webhook)
          const perBotEndpoint = `https://api.sendpulse.com/${ch.key === 'live_chat' ? 'live-chat' : ch.key}/bots/${botId}/webhook`
          const perBotRes = await fetch(perBotEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ url: webhookUrl }),
          })
          const perBotBody = await perBotRes.text().catch(() => '')
          console.log(`[sync] per-bot webhook ${ch.key}/${botId}: ${perBotRes.status} ${perBotBody}`)

          if (perBotRes.ok) {
            webhookOk = true
          } else {
            // Fallback: channel-level registration
            const chRes = await fetch(`https://api.sendpulse.com/${ch.webhook}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ url: webhookUrl, event: 'new_message' }),
            })
            const chBody = await chRes.text().catch(() => '')
            console.log(`[sync] channel webhook ${ch.key}: ${chRes.status} ${chBody}`)
            webhookOk = chRes.ok
          }
          webhooks.push({ channel: ch.key, bot_id: botId, ok: webhookOk })
        }

        const payload = {
          owner_id: account.owner_id || null,
          organization_id: account.organization_id || null,
          name,
          sendpulse_account_id,
          bot_id: botId,
          channel: ch.key,
          webhook_active: webhookOk,
        }
        if (existingByKey[key]) {
          await supabase.from('sendpulse_bots').update(payload).eq('id', existingByKey[key].id)
        } else {
          await supabase.from('sendpulse_bots').insert([payload])
        }
        bots.push({ bot_id: botId, name, channel: ch.key, webhook_active: webhookOk })
      }
    }

    return makeJsonResponse({ success: true, count: bots.length, bots, webhooks, webhookUrl })
  } catch (error) {
    console.error('sendpulseSyncBots error:', error)
    return makeJsonResponse({ error: String(error) }, 500)
  }
})
