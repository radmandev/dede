import { corsHeaders, handleCors } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { ensureSendPulseToken } from '../lib/sendpulse.ts'
import { loadFirstGlobalConfig, makeJsonResponse } from '../lib/bitrix24.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const authToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!authToken) return new Response('unauthorized', { status: 401 })

    const { data: userData, error: userErr } = await supabase.auth.getUser(authToken)
    if (userErr || !userData?.user) return new Response('unauthorized', { status: 401 })

    const body = await req.json().catch(() => ({}))
    const { sendpulse_account_id, origin } = body || {}
    if (!sendpulse_account_id) return makeJsonResponse({ error: 'Missing sendpulse_account_id' }, 400)

    const { data: accounts, error: accountErr } = await supabase.from('sendpulse_accounts').select('*').eq('id', sendpulse_account_id).limit(1)
    if (accountErr) throw accountErr
    const account = accounts?.[0]
    if (!account?.client_id) return makeJsonResponse({ error: 'Account not configured' }, 400)

    const token = await ensureSendPulseToken(supabase, account.id)
    if (!token) return makeJsonResponse({ error: 'Failed to authenticate with SendPulse' }, 400)

    const globalConfig = await loadFirstGlobalConfig(supabase)
    const rawBase = globalConfig.app_base_url || origin || ''
    const baseUrl = rawBase.replace(/^https:\/\/preview--/, 'https://').replace(/\/$/, '')
    const webhookUrl = baseUrl ? `${baseUrl}/api/functions/sendpulseWebhook` : ''

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

      let webhookOk = false
      if (webhookUrl) {
        const whRes = await fetch(`https://api.sendpulse.com/${ch.webhook}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ url: webhookUrl, events: ['incoming_message', 'message'] }),
        })
        webhookOk = whRes.ok
        webhooks.push({ channel: ch.key, ok: webhookOk })
      }

      for (const bot of arr) {
        const botId = String(bot.id || bot.bot_id || '')
        if (!botId) continue
        const name = bot.name || bot.channel_data?.name || bot.title || `${ch.key} bot`
        const key = `${ch.key}_${botId}`
        const payload = {
          owner_id: account.owner_id || null,
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
        bots.push({ bot_id: botId, name, channel: ch.key })
      }
    }

    return makeJsonResponse({ success: true, count: bots.length, bots, webhooks, webhookUrl })
  } catch (error) {
    console.error('sendpulseSyncBots error:', error)
    return makeJsonResponse({ error: String(error) }, 500)
  }
})
