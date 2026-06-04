import { handleCors, jsonResponse, textResponse } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { ensureSendPulseToken } from '../lib/sendpulse.ts'
import { makeJsonResponse } from '../lib/bitrix24.ts'

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
    const { botId } = body || {}
    if (!botId) return makeJsonResponse({ error: 'botId is required' }, 400)

    const { data: bots, error: botErr } = await supabase.from('sendpulse_bots').select('*').eq('bot_id', String(botId)).limit(1)
    if (botErr) throw botErr
    const bot = bots?.[0]
    if (!bot?.sendpulse_account_id) return makeJsonResponse({ error: 'Bot not found' }, 404)

    const { data: accounts, error: accountErr } = await supabase.from('sendpulse_accounts').select('*').eq('id', bot.sendpulse_account_id).limit(1)
    if (accountErr) throw accountErr
    const account = accounts?.[0]
    if (!account) return makeJsonResponse({ error: 'SendPulse account not found' }, 404)

    const token = await ensureSendPulseToken(supabase, account.id)
    if (!token) return makeJsonResponse({ error: 'Failed to obtain SendPulse token' }, 500)

    const res = await fetch(`https://api.sendpulse.com/whatsapp/templates?bot_id=${encodeURIComponent(botId)}`, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      console.error('SendPulse templates error:', JSON.stringify(data))
      return makeJsonResponse({ error: data?.message || 'Failed to fetch templates' }, res.status)
    }

    const raw = Array.isArray(data) ? data : (data.data || data.templates || [])
    const templates = (Array.isArray(raw) ? raw : [])
      .filter((template) => {
        const status = (template.status || template.template?.status || '').toString().toUpperCase()
        return !status || status === 'APPROVED' || status === 'ACTIVE'
      })
      .map((template) => ({
        name: template.name || template.template?.name,
        language: template.language || template.language_code || template.template?.language || 'en',
        category: template.category || template.template?.category || '',
        paramCount: (() => {
          const comps = template.components || template.template?.components || []
          const body = (Array.isArray(comps) ? comps : []).find((c) => (c.type || '').toString().toUpperCase() === 'BODY')
          const text = body?.text || ''
          const matches = text.match(/\{\{\s*\d+\s*\}\}/g)
          return matches ? new Set(matches).size : 0
        })(),
      }))
      .filter((template) => template.name)

    return makeJsonResponse({ templates })
  } catch (error) {
    console.error('getSendPulseTemplates error:', error)
    return makeJsonResponse({ error: String(error) }, 500)
  }
})
