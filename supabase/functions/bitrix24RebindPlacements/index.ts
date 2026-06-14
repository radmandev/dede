import { handleCors, jsonResponse } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { normalizeConfigRow, callBitrix, ensureBitrixToken } from '../lib/bitrix24.ts'

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
      return jsonResponse({ error: 'app_base_url is not set or is invalid. Set it in Settings first.' }, 400)
    }

    const functionsBase = `${SUPABASE_URL}/functions/v1`
    const installerUrl = `${functionsBase}/bitrix24Installer`
    const handlerUrl = `${functionsBase}/bitrix24Handler`
    const dashboardUrl = `${appBaseUrl}/`
    const crmChatUrl = `${appBaseUrl}/crm-chat`

    const { data: accounts = [], error: accountErr } = await supabase
      .from('bitrix24_accounts').select('*').eq('status', 'connected')
    if (accountErr) throw accountErr
    if (!accounts.length) return jsonResponse({ error: 'No connected Bitrix24 portals found.' }, 404)

    const results = []
    for (const account of accounts) {
      const endpoint = account.domain || ''
      const token = await ensureBitrixToken(supabase, account)
      if (!token || !endpoint) {
        results.push({ account: account.name, ok: false, reason: 'Missing token or portal endpoint' })
        continue
      }

      // imconnector.register — re-register with correct PLACEMENT_HANDLER
      const connectorId = account.member_id ? `whatsapp_sp_${account.member_id.substring(0, 10)}` : 'whatsapp_sendpulse'
      await callBitrix(endpoint, token, 'imconnector.register', {
        ID: connectorId,
        NAME: 'WhatsApp (SendPulse)',
        PLACEMENT_HANDLER: installerUrl,
      })

      // ONIMCONNECTORMESSAGEADD event — rebind outgoing message handler
      const existingEventsRes = await callBitrix(endpoint, token, 'event.get', {})
      const existingHandlers = Array.isArray(existingEventsRes?.result) ? existingEventsRes.result : []
      const existingImConnectorHandlers = existingHandlers.filter((h: any) => h.event === 'ONIMCONNECTORMESSAGEADD')
      console.log(`[rebind] existing ONIMCONNECTORMESSAGEADD handlers:`, JSON.stringify(existingImConnectorHandlers))
      for (const h of existingImConnectorHandlers) {
        const unbind = await callBitrix(endpoint, token, 'event.unbind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: h.handler })
        console.log(`[rebind] unbind ${h.handler}:`, JSON.stringify(unbind))
      }
      const eventBind = await callBitrix(endpoint, token, 'event.bind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: handlerUrl })
      console.log(`[rebind] event.bind for ${account.name}:`, JSON.stringify(eventBind))

      // Verify registration immediately after binding
      const verifyEventsRes = await callBitrix(endpoint, token, 'event.get', {})
      const verifyHandlers = Array.isArray(verifyEventsRes?.result) ? verifyEventsRes.result : []
      const registeredEventHandlers = verifyHandlers
        .filter((h: any) => h.event === 'ONIMCONNECTORMESSAGEADD')
        .map((h: any) => h.handler)

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

      // CRM detail tab placements — point to /crm-chat, not the dashboard root
      const crmPlacements = ['CRM_LEAD_DETAIL_TAB', 'CRM_DEAL_DETAIL_TAB', 'CRM_CONTACT_DETAIL_TAB', 'CRM_COMPANY_DETAIL_TAB']
      for (const pl of crmPlacements) {
        await callBitrix(endpoint, token, 'placement.unbind', { PLACEMENT: pl, HANDLER: dashboardUrl })
        await callBitrix(endpoint, token, 'placement.unbind', { PLACEMENT: pl, HANDLER: crmChatUrl })
        await callBitrix(endpoint, token, 'placement.bind', { PLACEMENT: pl, HANDLER: crmChatUrl, TITLE: 'noqtaChat' })
      }

      // IM_TEXTAREA — template sender button in the open channel chat compose bar
      const imTemplateUrl = `${appBaseUrl}/im-template`
      // Remove old (invalid) placement registrations for all previous handler URLs
      await callBitrix(endpoint, token, 'placement.unbind', { PLACEMENT: 'IM_SMILES_PANEL', HANDLER: imTemplateUrl })
      await callBitrix(endpoint, token, 'placement.unbind', { PLACEMENT: 'IM_TEXTAREA', HANDLER: imTemplateUrl })
      const imBind = await callBitrix(endpoint, token, 'placement.bind', {
        PLACEMENT: 'IM_TEXTAREA',
        HANDLER: imTemplateUrl,
        TITLE: 'noqtaChat: Send WA Template',
        DESCRIPTION: 'Send WhatsApp template messages via noqtaChat',
        OPTIONS: {
          iconName: 'fa-paper-plane',
          context: 'LINES',
          color: 'GREEN',
          width: '420',
          height: '560',
        },
      })
      console.log(`[rebind] IM_TEXTAREA for ${account.name}:`, JSON.stringify(imBind))

      // Fetch current registered placements for diagnostics
      const placementGetRes = await callBitrix(endpoint, token, 'placement.get', { PLACEMENT: 'IM_TEXTAREA' })
      const registeredImPlacements = Array.isArray(placementGetRes?.result)
        ? placementGetRes.result.map((p: any) => ({ handler: p.handler, title: p.title, options: p.options }))
        : placementGetRes?.result

      results.push({
        account: account.name,
        ok: lmBind?.result === true,
        handlerUrl,
        dashboardUrl,
        crmChatUrl,
        imTemplateUrl,
        left_menu: lmBind?.result === true ? '✓' : (lmBind?.error_description || lmBind?.error || '?'),
        contact_center: ccBind?.result === true ? '✓' : (ccBind?.error_description || ccBind?.error || '?'),
        event_bind: eventBind?.result === true ? '✓' : (eventBind?.error_description || eventBind?.error || JSON.stringify(eventBind)),
        event_registered_handlers: registeredEventHandlers,
        event_handler_matches: registeredEventHandlers.includes(handlerUrl),
        im_textarea: imBind?.result === true ? '✓' : (imBind?.error_description || imBind?.error || JSON.stringify(imBind)),
        im_textarea_registered: registeredImPlacements,
      })
    }

    return jsonResponse({ success: true, dashboardUrl, crmChatUrl, results })
  } catch (error) {
    console.error('bitrix24RebindPlacements error:', error)
    return jsonResponse({ error: String(error) }, 500)
  }
})
