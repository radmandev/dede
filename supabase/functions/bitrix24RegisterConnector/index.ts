import { corsHeaders, handleCors } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { loadFirstGlobalConfig, callBitrix, ensureBitrixToken, makeJsonResponse } from '../lib/bitrix24.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const WA_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='10' fill='%2325D366'/%3E%3Cpath fill='%23fff' d='M24 8C15 8 8 15 8 24c0 3 .8 5.8 2.2 8.2L10 40l8.1-2.1C20.2 39 22 39.5 24 39.5c9 0 16-7 16-16S33 8 24 8zm0 28c-2 0-3.9-.6-5.5-1.7l-.3-.2-4.8 1.2 1.3-4.7-.2-.3C13.5 28.6 13 26.3 13 24c0-6.1 4.9-11 11-11s11 4.9 11 11-4.9 11-11 11z'/%3E%3C/svg%3E"

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
    const openChannelId = body.openChannelId
    if (!openChannelId) return makeJsonResponse({ error: 'openChannelId is required' }, 400)

    const { data: channels, error: channelErr } = await supabase.from('bitrix24_open_channels').select('*').eq('id', openChannelId).limit(1)
    if (channelErr) throw channelErr
    const channel = channels?.[0]
    if (!channel) return makeJsonResponse({ error: 'Open Channel not found' }, 404)

    const { data: accounts, error: accountErr } = await supabase.from('bitrix24_accounts').select('*').eq('id', channel.bitrix24_account_id).limit(1)
    if (accountErr) throw accountErr
    const account = accounts?.[0]
    if (!account) return makeJsonResponse({ error: 'Bitrix24 account not found' }, 404)
    if (!channel.bitrix24_line_id) return makeJsonResponse({ error: 'Open Channel has no Line ID configured' }, 400)

    const endpoint = account.domain
    if (!endpoint) return makeJsonResponse({ error: 'Bitrix24 account has no domain. Reinstall the app on the portal.' }, 400)

    const token = await ensureBitrixToken(supabase, account)
    if (!token) return makeJsonResponse({ error: 'Token expired and no refresh credentials. Reinstall the app on the portal.' }, 400)

    const globalConfig = await loadFirstGlobalConfig(supabase)
    const appBaseUrl = (globalConfig.app_base_url || '').replace(/^https:\/\/preview--/, 'https://')
    if (!appBaseUrl) return makeJsonResponse({ error: 'App Production URL not set in Settings.' }, 400)
    const installerUrl = `${appBaseUrl}/api/functions/bitrix24Installer`
    const handlerUrl = `${appBaseUrl}/api/functions/bitrix24Handler`

    const connectorId = channel.bitrix24_connector_id || (account.member_id ? `whatsapp_sp_${account.member_id.substring(0, 10)}` : 'whatsapp_sendpulse')
    if (!channel.bitrix24_connector_id) {
      await supabase.from('bitrix24_open_channels').update({ bitrix24_connector_id: connectorId }).eq('id', channel.id)
    }

    const registerRes = await callBitrix(endpoint, token, 'imconnector.register', {
      ID: connectorId,
      NAME: 'WhatsApp (SendPulse)',
      PLACEMENT_HANDLER: installerUrl,
      ICON: { DATA_IMAGE: WA_ICON, COLOR: '#25D366', SIZE: '90%', POSITION: 'center' },
      ICON_DISABLED: { DATA_IMAGE: WA_ICON, COLOR: '#99adb3', SIZE: '90%', POSITION: 'center' },
    })

    await callBitrix(endpoint, token, 'imconnector.activate', { CONNECTOR: connectorId, LINE: channel.bitrix24_line_id, ACTIVE: 'Y' })
    await callBitrix(endpoint, token, 'imconnector.connector.data.set', {
      CONNECTOR: connectorId,
      LINE: Number(channel.bitrix24_line_id),
      DATA: { ID: `whatsapp_sendpulse_line_${channel.bitrix24_line_id}`, NAME: 'WhatsApp (SendPulse)', URL: 'https://wa.me/', URL_IM: 'https://wa.me/' },
    })

    const existingEventsRes = await callBitrix(endpoint, token, 'event.get', {})
    const existingHandlers = Array.isArray(existingEventsRes?.result) ? existingEventsRes.result : []
    for (const h of existingHandlers.filter((h) => h.event === 'ONIMCONNECTORMESSAGEADD' && h.handler === handlerUrl)) {
      await callBitrix(endpoint, token, 'event.unbind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: h.handler })
    }
    const bindRes = await callBitrix(endpoint, token, 'event.bind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: handlerUrl })

    await callBitrix(endpoint, token, 'placement.unbind', { PLACEMENT: 'CONTACT_CENTER', HANDLER: installerUrl })
    await callBitrix(endpoint, token, 'placement.bind', {
      PLACEMENT: 'CONTACT_CENTER',
      HANDLER: installerUrl,
      TITLE: 'WhatsApp (SendPulse)',
      DESCRIPTION: 'WhatsApp channel via SendPulse',
    })

    const statusRes = await callBitrix(endpoint, token, 'imconnector.status', { CONNECTOR: connectorId, LINE: Number(channel.bitrix24_line_id) })
    const connectorActive = statusRes?.result?.ACTIVE === 'Y' || statusRes?.result?.active === true
    const bindSuccess = bindRes?.result === true

    return makeJsonResponse({
      success: true,
      connector_id: connectorId,
      line_id: channel.bitrix24_line_id,
      event_bind_success: bindSuccess,
      connector_active: connectorActive,
      msg: `✓ Connector registered on Line ${channel.bitrix24_line_id}. event.bind: ${bindSuccess ? '✓' : '⚠️'}`,
    })
  } catch (error) {
    console.error('bitrix24RegisterConnector error:', error)
    return makeJsonResponse({ error: String(error) }, 500)
  }
})
