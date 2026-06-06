import { handleCors } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { loadFirstGlobalConfig, normalizeConfigRow, callBitrix, ensureBitrixToken } from '../lib/bitrix24.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  try {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const authToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!authToken) return new Response('unauthorized', { status: 401 })
    const { data: userData, error: userErr } = await supabase.auth.getUser(authToken)
    if (userErr || !userData?.user) return new Response('unauthorized', { status: 401 })

    const { data: configs = [] } = await supabase.from('global_config').select('*').limit(1)
    const globalConfig = normalizeConfigRow(configs?.[0])
    const rawBaseUrl = globalConfig.app_base_url || ''
    const appBaseUrl = rawBaseUrl.replace(/^https:\/\/preview--/, 'https://').replace(/\/+$/, '')

    if (!appBaseUrl || appBaseUrl.includes('/functions/v1')) {
      return makeJsonResponse({ error: 'app_base_url is not set or is invalid. Set it in Settings first.' }, 400)
    }

    const functionsBase = `${SUPABASE_URL}/functions/v1`
    const installerUrl = `${functionsBase}/bitrix24Installer`
    const handlerUrl = `${functionsBase}/bitrix24Handler`
    const dashboardUrl = `${appBaseUrl}/`

    const { data: accounts = [], error: accountErr } = await supabase
      .from('bitrix24_accounts').select('*').eq('status', 'connected')
    if (accountErr) throw accountErr
    if (!accounts.length) return makeJsonResponse({ error: 'No connected Bitrix24 portals found.' }, 404)

    const results = []
    for (const account of accounts) {
      const endpoint = account.domain || ''
      const token = await ensureBitrixToken(supabase, account)
      if (!token || !endpoint) {
        results.push({ account: account.name, ok: false, reason: 'Missing token or portal endpoint' })
        continue
      }

      // CONTACT_CENTER placement
      await callBitrix(endpoint, token, 'placement.unbind', { PLACEMENT: 'CONTACT_CENTER', HANDLER: installerUrl })
      const ccBind = await callBitrix(endpoint, token, 'placement.bind', {
        PLACEMENT: 'CONTACT_CENTER',
        HANDLER: installerUrl,
        TITLE: 'WhatsApp (SendPulse)',
        DESCRIPTION: 'WhatsApp channel via SendPulse',
      })

      // LEFT_MENU placement
      // unbind any existing handlers for LEFT_MENU that point to our installer (old bad registrations)
      await callBitrix(endpoint, token, 'placement.unbind', { PLACEMENT: 'LEFT_MENU', HANDLER: installerUrl })
      await callBitrix(endpoint, token, 'placement.unbind', { PLACEMENT: 'LEFT_MENU', HANDLER: dashboardUrl })
      const lmBind = await callBitrix(endpoint, token, 'placement.bind', {
        PLACEMENT: 'LEFT_MENU',
        HANDLER: dashboardUrl,
        TITLE: 'WhatsApp (SendPulse)',
      })

      // CRM detail tab placements
      const crmPlacements = ['CRM_LEAD_DETAIL_TAB', 'CRM_DEAL_DETAIL_TAB', 'CRM_CONTACT_DETAIL_TAB', 'CRM_COMPANY_DETAIL_TAB']
      for (const pl of crmPlacements) {
        await callBitrix(endpoint, token, 'placement.unbind', { PLACEMENT: pl, HANDLER: dashboardUrl })
        await callBitrix(endpoint, token, 'placement.bind', { PLACEMENT: pl, HANDLER: dashboardUrl, TITLE: 'WhatsApp Chat' })
      }

      results.push({
        account: account.name,
        ok: lmBind?.result === true,
        dashboardUrl,
        left_menu: lmBind?.result === true ? '✓' : (lmBind?.error_description || lmBind?.error || '?'),
        contact_center: ccBind?.result === true ? '✓' : (ccBind?.error_description || ccBind?.error || '?'),
      })
    }

    return makeJsonResponse({ success: true, dashboardUrl, results })
  } catch (error) {
    console.error('bitrix24RebindPlacements error:', error)
    return makeJsonResponse({ error: String(error) }, 500)
  }
})
