import { corsHeaders, handleCors } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { callBitrix, parseNestedForm, normalizeConfigRow } from '../lib/bitrix24.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const WA_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='10' fill='%2325D366'/%3E%3Cpath fill='%23fff' d='M24 8C15 8 8 15 8 24c0 3 .8 5.8 2.2 8.2L10 40l8.1-2.1C20.2 39 22 39.5 24 39.5c9 0 16-7 16-16S33 8 24 8zm0 28c-2 0-3.9-.6-5.5-1.7l-.3-.2-4.8 1.2 1.3-4.7-.2-.3C13.5 28.6 13 26.3 13 24c0-6.1 4.9-11 11-11s11 4.9 11 11-4.9 11-11 11z'/%3E%3C/svg%3E"

// Bitrix24 sends SETTING_CONNECTOR (not CONTACT_CENTER) when configuring a connector in an open line
const CONNECTOR_PLACEMENTS = ['CONTACT_CENTER', 'SETTING_CONNECTOR']

function isConnectorPlacement(placement: string) {
  return CONNECTOR_PLACEMENTS.includes(placement)
}

function parsePlacementOptions(raw: any): any {
  if (raw && typeof raw === 'object') return raw
  try { return JSON.parse(raw || '{}') } catch { return {} }
}

function makeHtml(placement: string, dashboardUrl = '') {
  const jsAction = placement === 'DEFAULT'
    ? `BX24.init(function() { BX24.installFinish(); });`
    : `BX24.init(function() { BX24.closeApplication(); });`
  const dashLink = (placement === 'DEFAULT' && dashboardUrl)
    ? `<p style="margin-top:20px"><a href="${dashboardUrl}" target="_blank" style="display:inline-block;padding:10px 24px;background:#25D366;color:#fff;border-radius:8px;font-size:14px;font-weight:500;text-decoration:none;">Open Dashboard →</a></p>`
    : ''
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>WhatsApp Connector</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5;}
.box{text-align:center;padding:40px;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.1);}
h2{color:#25D366;margin:0 0 8px;}p{color:#555;margin:0;}</style>
</head>
<body><div class="box"><h2>✅ WhatsApp (SendPulse)</h2><p>Connector configured successfully.</p>${dashLink}</div>
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

function connectorSetupHtml(lineId: string, connectorId: string, dashboardUrl: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>WhatsApp (SendPulse)</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f8fa;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;}
.card{background:#fff;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.08);padding:32px 28px;max-width:420px;width:100%;text-align:center;}
.icon{width:56px;height:56px;background:#25D366;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;}
.icon svg{width:32px;height:32px;fill:#fff;}
h2{font-size:18px;font-weight:600;color:#1a1a2e;margin-bottom:8px;}
p{font-size:13px;color:#666;line-height:1.5;margin-bottom:6px;}
.line-id{font-family:monospace;background:#f0f4f8;border-radius:6px;padding:6px 10px;font-size:12px;color:#444;margin:12px 0;}
.btn{display:inline-block;margin-top:20px;padding:10px 24px;background:#25D366;color:#fff;border-radius:8px;font-size:14px;font-weight:500;text-decoration:none;cursor:pointer;border:none;}
.note{font-size:11px;color:#999;margin-top:14px;}
</style>
</head>
<body>
<div class="card">
  <div class="icon"><svg viewBox="0 0 48 48"><path d="M24 8C15 8 8 15 8 24c0 3 .8 5.8 2.2 8.2L10 40l8.1-2.1C20.2 39 22 39.5 24 39.5c9 0 16-7 16-16S33 8 24 8zm0 28c-2 0-3.9-.6-5.5-1.7l-.3-.2-4.8 1.2 1.3-4.7-.2-.3C13.5 28.6 13 26.3 13 24c0-6.1 4.9-11 11-11s11 4.9 11 11-4.9 11-11 11z"/></svg></div>
  <h2>WhatsApp (SendPulse) Connected</h2>
  <p>This open line has been linked to your connector.</p>
  ${lineId ? `<div class="line-id">Line ID: ${lineId}</div>` : ''}
  <p>Open the dashboard and map this line to a SendPulse bot under <strong>Open Channels</strong>.</p>
  ${dashboardUrl ? `<a class="btn" href="${dashboardUrl}" target="_blank">Open Dashboard</a>` : ''}
  <p class="note">You can close this window.</p>
</div>
<script src="//api.bitrix24.com/api/v1/"></script>
<script>
function f(){
  if(typeof BX24!=='undefined'){
    BX24.init(function(){ if(BX24.fitWindow) BX24.fitWindow(); });
  } else { setTimeout(f,200); }
}
f();
</script>
</body>
</html>`
}

serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method === 'GET') {
    const urlParams = new URL(req.url).searchParams
    const pl = urlParams.get('PLACEMENT') || 'DEFAULT'
    return new Response(makeHtml(pl), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  let placement = 'DEFAULT'
  try {
    const bodyText = await req.text()
    let data: any = {}
    const ct = req.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      try { data = JSON.parse(bodyText) } catch { data = {} }
    } else {
      data = parseNestedForm(bodyText)
    }

    const accessToken = data.AUTH_ID || data.auth?.access_token || ''
    const refreshToken = data.REFRESH_ID || data.auth?.refresh_token || ''
    const memberId = data.member_id || data.MEMBER_ID || data.auth?.member_id || ''
    const expiresIn = parseInt(data.AUTH_EXPIRES || data.auth?.expires_in || '3600', 10)
    placement = data.PLACEMENT || 'DEFAULT'

    console.log(`[installer] method=POST placement=${placement} memberId=${memberId} hasToken=${!!accessToken}`)

    if (!accessToken) {
      console.error('[installer] No access token')
      return new Response(makeHtml(placement), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    const { data: configs = [] } = await supabase.from('global_config').select('*').limit(1)
    const globalConfig = normalizeConfigRow(configs?.[0])
    const rawBaseUrl = globalConfig.app_base_url || ''
    const appBaseUrl = rawBaseUrl.replace(/^https:\/\/preview--/, 'https://').replace(/\/+$/, '')
    const functionsBase = `${SUPABASE_URL}/functions/v1`
    const installerUrl = `${functionsBase}/bitrix24Installer`
    const handlerUrl = `${functionsBase}/bitrix24Handler`
    const isValidAppUrl = appBaseUrl && !appBaseUrl.includes('/functions/v1')
    console.log(`[installer] appBaseUrl=${appBaseUrl} isValid=${isValidAppUrl}`)
    const dashboardUrl = isValidAppUrl ? `${appBaseUrl}/` : ''
    const crmChatUrl = isValidAppUrl ? `${appBaseUrl}/crm-chat` : ''

    // Build serverEndpoint — try referer first, then POST body fields
    const referer = req.headers.get('referer') || req.headers.get('origin') || ''
    let serverEndpoint = ''
    if (referer) {
      try {
        const u = new URL(referer)
        serverEndpoint = `${u.protocol}//${u.host}/rest/`
      } catch { /* ignore */ }
    }
    if (!serverEndpoint) {
      serverEndpoint = data.SERVER_ENDPOINT || data.auth?.server_endpoint || ''
    }

    // Look up account by member_id
    let account: any = null
    if (memberId) {
      const { data: existing = [] } = await supabase.from('bitrix24_accounts').select('*').eq('member_id', memberId).limit(1)
      account = existing[0] || null
    }

    // Fallback: connector placements don't send referer; use the domain saved during DEFAULT install
    if (!serverEndpoint && account?.domain) {
      serverEndpoint = account.domain
    }
    console.log(`[installer] serverEndpoint=${serverEndpoint}`)

    const accountData: any = {
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
      const portalName = serverEndpoint
        ? (() => { try { return new URL(serverEndpoint).host } catch { return `Portal ${memberId}` } })()
        : `Portal ${memberId}`
      const { data: inserted = [] } = await supabase.from('bitrix24_accounts').insert([{ name: portalName, ...accountData }]).select('*').limit(1)
      account = inserted?.[0] || null
    }

    const connectorId = memberId ? `whatsapp_sp_${memberId.substring(0, 10)}` : 'whatsapp_sendpulse'

    // ── DEFAULT: register connector + bind placements ────────────────────────
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
        for (const h of existingHandlers.filter((h: any) => h.event === 'ONIMCONNECTORMESSAGEADD' && h.handler === handlerUrl)) {
          await callBitrix(serverEndpoint, accessToken, 'event.unbind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: h.handler })
        }
        await callBitrix(serverEndpoint, accessToken, 'event.bind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: handlerUrl })
      }

      await callBitrix(serverEndpoint, accessToken, 'placement.unbind', { PLACEMENT: 'CONTACT_CENTER', HANDLER: installerUrl })
      await callBitrix(serverEndpoint, accessToken, 'placement.bind', {
        PLACEMENT: 'CONTACT_CENTER',
        HANDLER: installerUrl,
        TITLE: 'WhatsApp (SendPulse)',
        DESCRIPTION: 'WhatsApp channel via SendPulse',
      })

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
          await callBitrix(serverEndpoint, accessToken, 'placement.bind', { PLACEMENT: pl, HANDLER: crmChatUrl, TITLE: 'WhatsApp Chat' })
        }
      }
    }

    // ── SETTING_CONNECTOR / CONTACT_CENTER: activate connector for a line ────
    if (isConnectorPlacement(placement) && serverEndpoint) {
      const placementOptions = parsePlacementOptions(data.PLACEMENT_OPTIONS)
      const lineId = String(placementOptions.LINE || placementOptions.CONNECTOR_LINE || placementOptions.ACTIVE_LINE || '')
      console.log(`[installer] connector setup placement=${placement} rawPO=${JSON.stringify(data.PLACEMENT_OPTIONS)} lineId=${lineId}`)

      if (lineId) {
        const lineNum = Number(lineId)

        const activateRes = await callBitrix(serverEndpoint, accessToken, 'imconnector.activate', {
          CONNECTOR: connectorId, LINE: lineNum, ACTIVE: 'Y',
        })
        console.log('[installer] imconnector.activate:', JSON.stringify(activateRes))

        const dataSetRes = await callBitrix(serverEndpoint, accessToken, 'imconnector.connector.data.set', {
          CONNECTOR: connectorId,
          LINE: lineNum,
          DATA: { ID: `whatsapp_sendpulse_line_${lineId}`, NAME: 'WhatsApp (SendPulse)', URL: 'https://wa.me/', URL_IM: 'https://wa.me/' },
        })
        console.log('[installer] imconnector.connector.data.set:', JSON.stringify(dataSetRes))

        // Insert channel record in our DB (visible in dashboard)
        const { data: existingChannels = [] } = await supabase
          .from('bitrix24_open_channels')
          .select('*')
          .eq('bitrix24_account_id', account?.id)
          .eq('bitrix24_line_id', lineId)
          .limit(1)

        if (!existingChannels.length) {
          const { error: insertErr } = await supabase.from('bitrix24_open_channels').insert([{
            owner_id: account?.owner_id || null,
            organization_id: account?.organization_id || null,
            name: `${account?.name || 'Portal'} — Line ${lineId}`,
            bitrix24_account_id: account?.id,
            sendpulse_account_id: null,
            bitrix24_line_id: lineId,
            bitrix24_connector_id: connectorId,
            channel: 'whatsapp',
            status: 'active',
          }])
          if (insertErr) console.error('[installer] insert open channel error:', JSON.stringify(insertErr))
          else console.log(`[installer] inserted channel for line ${lineId}`)
        } else {
          const ch = existingChannels[0]
          if (!ch.organization_id && account?.organization_id) {
            await supabase.from('bitrix24_open_channels').update({
              organization_id: account.organization_id,
              owner_id: ch.owner_id || account?.owner_id || null,
            }).eq('id', ch.id)
          }
          console.log(`[installer] channel for line ${lineId} already exists`)
        }
      } else {
        console.warn('[installer] PLACEMENT_OPTIONS missing LINE — skipping activation')
      }
    }

    // ── Build response HTML ──────────────────────────────────────────────────
    let finalHtml: string
    if (isConnectorPlacement(placement)) {
      const placementOptions = parsePlacementOptions(data.PLACEMENT_OPTIONS)
      const lineId = String(placementOptions.LINE || placementOptions.CONNECTOR_LINE || placementOptions.ACTIVE_LINE || '')
      finalHtml = connectorSetupHtml(lineId, connectorId, dashboardUrl)
    } else {
      finalHtml = makeHtml(placement, dashboardUrl)
    }
    return new Response(finalHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

  } catch (error) {
    console.error('[installer] error:', error)
    return new Response(makeHtml(placement), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
})
