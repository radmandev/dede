import { serve } from 'std/server'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { loadFirstGlobalConfig, callBitrix, ensureBitrixToken, makeJsonResponse } from '../lib/bitrix24.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const authToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!authToken) return new Response('unauthorized', { status: 401 })

    const { data: userData, error: userErr } = await supabase.auth.getUser(authToken)
    if (userErr || !userData?.user) return new Response('unauthorized', { status: 401 })

    const body = await req.json().catch(() => ({}))
    const accountId = body.accountId

    let query = supabase.from('bitrix24_accounts').select('*').eq('status', 'connected')
    if (accountId) query = query.eq('id', accountId)
    const { data: accounts, error: accountErr } = await query
    if (accountErr) throw accountErr
    if (!accounts?.length) return makeJsonResponse({ error: 'No connected Bitrix24 portals found.' }, 404)

    const globalConfig = await loadFirstGlobalConfig(supabase)
    const appBaseUrl = (globalConfig.app_base_url || '').replace(/^https:\/\/preview--/, 'https://')
    if (!appBaseUrl) return makeJsonResponse({ error: 'Set the App Production URL in Settings first.' }, 400)
    const handlerUrl = `${appBaseUrl}/api/functions/bitrix24Handler`

    const results = []
    for (const account of accounts) {
      const endpoint = account.domain || ''
      const token = await ensureBitrixToken(supabase, account)
      if (!token || !endpoint) {
        results.push({ account: account.name, ok: false, reason: 'Missing token or portal endpoint — reinstall the app.' })
        continue
      }

      const before = await callBitrix(endpoint, token, 'event.get', {})
      const handlers = Array.isArray(before?.result) ? before.result : []
      for (const h of handlers.filter((h) => h.event === 'ONIMCONNECTORMESSAGEADD' && /\/api\/functions\/bitrix24Handler/.test(h.handler || ''))) {
        await callBitrix(endpoint, token, 'event.unbind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: h.handler })
      }

      const bind = await callBitrix(endpoint, token, 'event.bind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: handlerUrl })
      const after = await callBitrix(endpoint, token, 'event.get', {})
      const bound = (Array.isArray(after?.result) ? after.result : []).some((h) => h.event === 'ONIMCONNECTORMESSAGEADD' && h.handler === handlerUrl)

      results.push({
        account: account.name,
        ok: bind?.result === true || bound,
        bound,
        error: bind?.error_description || bind?.error || null,
      })
    }

    return makeJsonResponse({ success: true, handlerUrl, results })
  } catch (error) {
    console.error('bitrix24BindReplyWebhook error:', error)
    return makeJsonResponse({ error: String(error) }, 500)
  }
})
