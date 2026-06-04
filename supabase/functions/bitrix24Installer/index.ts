import { serve } from 'std/server'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { callBitrix, parseNestedForm, normalizeConfigRow } from '../lib/bitrix24.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const WA_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='10' fill='%2325D366'/%3E%3Cpath fill='%23fff' d='M24 8C15 8 8 15 8 24c0 3 .8 5.8 2.2 8.2L10 40l8.1-2.1C20.2 39 22 39.5 24 39.5c9 0 16-7 16-16S33 8 24 8zm0 28c-2 0-3.9-.6-5.5-1.7l-.3-.2-4.8 1.2 1.3-4.7-.2-.3C13.5 28.6 13 26.3 13 24c0-6.1 4.9-11 11-11s11 4.9 11 11-4.9 11-11 11z'/%3E%3C/svg%3E"

function makeHtml(placement) {
  const jsAction = placement === 'DEFAULT'
    ? `BX24.init(function() { BX24.installFinish(); });`
    : `BX24.init(function() { BX24.closeApplication(); });`
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>WhatsApp Connector</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5;}
.box{text-align:center;padding:40px;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.1);}
h2{color:#25D366;margin:0 0 8px;}p{color:#555;margin:0;}</style>
</head>
<body><div class="box"><h2>✅ WhatsApp (SendPulse)</h2><p>Connector configured successfully.</p></div>
<script src="//api.bitrix24.com/api/v1/"></script>
<script>
function tryAction() {
  if (typeof BX24 !== 'undefined') {
    ${jsAction}
  } else { setTimeout(tryAction, 200); }
}
tryAction();
</script>
</body>
</html>`
}

function embedHtml(appBaseUrl, path) {
  const src = `${appBaseUrl}${path}`
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>WhatsApp (SendPulse)</title>
<style>html,body{margin:0;height:100%;}iframe{border:0;width:100%;height:100vh;display:block;}</style>
</head>
<body>
<iframe src="${src}" allow="clipboard-write; microphone; camera"></iframe>
<script src="//api.bitrix24.com/api/v1/"></script>
<script>function f(){if(typeof BX24!=='undefined'){BX24.init(function(){if(BX24.fitWindow)BX24.fitWindow();});}else{setTimeout(f,200);}}f();</script>
</body>
</html>`
}

serve(async (req: Request) => {
  if (req.method === 'GET') {
    const urlParams = new URL(req.url).searchParams
    const pl = urlParams.get('PLACEMENT') || 'DEFAULT'
    return new Response(makeHtml(pl), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  let placement = 'DEFAULT'
  try {
    const bodyText = await req.text()
    const data = parseNestedForm(bodyText)

    const accessToken = data.AUTH_ID || data.auth?.access_token || ''
    const refreshToken = data.REFRESH_ID || data.auth?.refresh_token || ''
    const memberId = data.member_id || data.MEMBER_ID || data.auth?.member_id || ''
    const expiresIn = parseInt(data.AUTH_EXPIRES || data.auth?.expires_in || '3600', 10)
    placement = data.PLACEMENT || 'DEFAULT'

    const referer = req.headers.get('referer') || req.headers.get('origin') || ''
    let portalEndpoint = ''
    if (referer) {
      try {
        const u = new URL(referer)
        portalEndpoint = `${u.protocol}//${u.host}/rest/`
      } catch {
        portalEndpoint = ''
      }
    }
    const serverEndpoint = portalEndpoint || data.SERVER_ENDPOINT || data.auth?.server_endpoint || ''

    if (!accessToken) {
      console.error('No access token in installer POST')
      return new Response(makeHtml(placement), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    const { data: configs = [] } = await supabase.from('global_config').select('*').limit(1)
    const globalConfig = normalizeConfigRow(configs?.[0])
    const rawBaseUrl = globalConfig.app_base_url || ''
    const appBaseUrl = rawBaseUrl.replace(/^https:\/\/preview--/, 'https://')
    const installerUrl = appBaseUrl ? `${appBaseUrl}/api/functions/bitrix24Installer` : ''
    const handlerUrl = appBaseUrl ? `${appBaseUrl}/api/functions/bitrix24Handler` : ''
    const dashboardUrl = appBaseUrl ? `${appBaseUrl}/` : ''
    const crmChatUrl = appBaseUrl ? `${appBaseUrl}/` : ''

    let account = null
    if (memberId) {
      const { data: existing = [] } = await supabase.from('bitrix24_accounts').select('*').eq('member_id', memberId).limit(1)
      account = existing[0] || null
    }

    const accountData = {
      domain: serverEndpoint || account?.domain || '',
      member_id: memberId,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      app_client_id: globalConfig.bitrix24_app_client_id || account?.app_client_id || '',
      app_client_secret: globalConfig.bitrix24_app_client_secret || account?.app_client_secret || '',
      status: 'connected',
      owner_id: account?.owner_id || null,
    }

    if (account) {
      await supabase.from('bitrix24_accounts').update(accountData).eq('id', account.id)
      account = { ...account, ...accountData }
    } else {
      const portalName = serverEndpoint ? (() => { try { return new URL(serverEndpoint).host } catch { return `Portal ${memberId}` } })() : `Portal ${memberId}`
      const { data: inserted = [] } = await supabase.from('bitrix24_accounts').insert([{ name: portalName, ...accountData }]).select('*').limit(1)
      account = inserted?.[0] || null
    }

    const connectorId = memberId ? `whatsapp_sp_${memberId.substring(0, 10)}` : 'whatsapp_sendpulse'

    if (placement === 'DEFAULT' && serverEndpoint) {
      await callBitrix(serverEndpoint, accessToken, 'imconnector.register', {
        ID: connectorId,
        NAME: 'WhatsApp (SendPulse)',
        PLACEMENT_HANDLER: installerUrl,
        ICON: { DATA_IMAGE: WA_ICON, COLOR: '#25D366', SIZE: '90%', POSITION: 'center' },
        ICON_DISABLED: { DATA_IMAGE: WA_ICON, COLOR: '#99adb3', SIZE: '90%', POSITION: 'center' },
      })

      if (handlerUrl) {
        const existingEventsRes = await callBitrix(serverEndpoint, accessToken, 'event.get', {})
        const existingHandlers = Array.isArray(existingEventsRes?.result) ? existingEventsRes.result : []
        for (const h of existingHandlers.filter((h) => h.event === 'ONIMCONNECTORMESSAGEADD' && h.handler === handlerUrl)) {
          await callBitrix(serverEndpoint, accessToken, 'event.unbind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: h.handler })
        }
        await callBitrix(serverEndpoint, accessToken, 'event.bind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: handlerUrl })
      }

      if (installerUrl) {
        await callBitrix(serverEndpoint, accessToken, 'placement.unbind', { PLACEMENT: 'CONTACT_CENTER', HANDLER: installerUrl })
        await callBitrix(serverEndpoint, accessToken, 'placement.bind', {
          PLACEMENT: 'CONTACT_CENTER',
          HANDLER: installerUrl,
          TITLE: 'WhatsApp (SendPulse)',
          DESCRIPTION: 'WhatsApp channel via SendPulse',
        })
      }

      if (dashboardUrl) {
        await callBitrix(serverEndpoint, accessToken, 'placement.unbind', { PLACEMENT: 'LEFT_MENU', HANDLER: dashboardUrl })
        await callBitrix(serverEndpoint, accessToken, 'placement.bind', {
          PLACEMENT: 'LEFT_MENU',
          HANDLER: dashboardUrl,
          TITLE: 'WhatsApp (SendPulse)',
        })
      }

      if (crmChatUrl) {
        for (const pl of ['CRM_LEAD_DETAIL_TAB', 'CRM_DEAL_DETAIL_TAB', 'CRM_CONTACT_DETAIL_TAB', 'CRM_COMPANY_DETAIL_TAB']) {
          await callBitrix(serverEndpoint, accessToken, 'placement.unbind', { PLACEMENT: pl, HANDLER: crmChatUrl })
          await callBitrix(serverEndpoint, accessToken, 'placement.bind', {
            PLACEMENT: pl,
            HANDLER: crmChatUrl,
            TITLE: 'WhatsApp Chat',
          })
        }
      }
    }

    if (placement === 'CONTACT_CENTER' && serverEndpoint) {
      let placementOptions = {}
      try { placementOptions = JSON.parse(data.PLACEMENT_OPTIONS || '{}') } catch {}
      const lineId = String(placementOptions.LINE || placementOptions.CONNECTOR_LINE || placementOptions.ACTIVE_LINE || '')
      if (lineId) {
        await callBitrix(serverEndpoint, accessToken, 'imconnector.activate', { CONNECTOR: connectorId, LINE: lineId, ACTIVE: 'Y' })
        await callBitrix(serverEndpoint, accessToken, 'imconnector.connector.data.set', {
          CONNECTOR: connectorId,
          LINE: Number(lineId),
          DATA: { ID: `whatsapp_sendpulse_line_${lineId}`, NAME: 'WhatsApp (SendPulse)', URL: 'https://wa.me/', URL_IM: 'https://wa.me/' },
        })

        const { data: existingChannels = [] } = await supabase.from('bitrix24_open_channels').select('*').eq('bitrix24_account_id', account?.id).eq('bitrix24_line_id', lineId).limit(1)
        if (!existingChannels.length) {
          await supabase.from('bitrix24_open_channels').insert([{ owner_id: account?.owner_id || null, name: `${account?.name || 'Portal'} — Line ${lineId}`, bitrix24_account_id: account?.id, sendpulse_account_id: '', bitrix24_line_id: lineId, bitrix24_connector_id: connectorId, channel: 'whatsapp', status: 'active' }])
        }
      }
    }

    const finalHtml = placement !== 'DEFAULT' && appBaseUrl ? embedHtml(appBaseUrl, '/') : makeHtml(placement)
    return new Response(finalHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  } catch (error) {
    console.error('bitrix24Installer error:', error)
    return new Response(makeHtml('DEFAULT'), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
})
