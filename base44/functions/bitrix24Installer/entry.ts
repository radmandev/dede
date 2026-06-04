import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Parse Bitrix24's form-encoded nested body (e.g. auth[access_token]=xxx)
function parseNestedForm(bodyText) {
  const flat = Object.fromEntries(new URLSearchParams(bodyText));
  const result = {};
  for (const [key, val] of Object.entries(flat)) {
    const parts = key.replace(/\]/g, '').split('[');
    let cur = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }
  return result;
}

async function callBitrix(serverEndpoint, token, method, params = {}) {
  const base = serverEndpoint.endsWith('/') ? serverEndpoint : serverEndpoint + '/';
  const url = `${base}${method}?auth=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

const WA_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='10' fill='%2325D366'/%3E%3Cpath fill='%23fff' d='M24 8C15 8 8 15 8 24c0 3 .8 5.8 2.2 8.2L10 40l8.1-2.1C20.2 39 22 39.5 24 39.5c9 0 16-7 16-16S33 8 24 8zm0 28c-2 0-3.9-.6-5.5-1.7l-.3-.2-4.8 1.2 1.3-4.7-.2-.3C13.5 28.6 13 26.3 13 24c0-6.1 4.9-11 11-11s11 4.9 11 11-4.9 11-11 11z'/%3E%3C/svg%3E";

function makeHtml(placement) {
  const jsAction = placement === 'DEFAULT'
    ? `BX24.init(function() { BX24.installFinish(); });`
    : `BX24.init(function() { BX24.closeApplication(); });`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>WhatsApp Connector</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5;}
.box{text-align:center;padding:40px;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.1);}
h2{color:#25D366;margin:0 0 8px;}p{color:#555;margin:0;}</style>
</head>
<body><div class="box"><h2>\u2705 WhatsApp (SendPulse)</h2><p>Connector configured successfully.</p></div>
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
</html>`;
}

// Embeds the app's SPA inside the Bitrix24 iframe (used for placements instead of a status screen)
function embedHtml(appBaseUrl, path) {
  const src = `${appBaseUrl}${path}`;
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
</html>`;
}

Deno.serve(async (req) => {
  // GET — Bitrix24 opens the installer page in an iframe
  if (req.method === 'GET') {
    const urlParams = new URL(req.url).searchParams;
    const pl = urlParams.get('PLACEMENT') || 'DEFAULT';
    return new Response(makeHtml(pl), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  let placement = 'DEFAULT';
  try {
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole;
    const bodyText = await req.text();
    const data = parseNestedForm(bodyText);

    console.log('Installer POST keys:', Object.keys(data).join(', '));

    const accessToken = data.AUTH_ID || data.auth?.access_token || '';
    const refreshToken = data.REFRESH_ID || data.auth?.refresh_token || '';
    const memberId = data.member_id || data.MEMBER_ID || data.auth?.member_id || '';
    const expiresIn = parseInt(data.AUTH_EXPIRES || data.auth?.expires_in || '3600', 10);
    placement = data.PLACEMENT || 'DEFAULT';

    // Derive portal REST endpoint from Referer header
    const referer = req.headers.get('referer') || req.headers.get('origin') || '';
    let portalEndpoint = '';
    if (referer) {
      try { const u = new URL(referer); portalEndpoint = `${u.protocol}//${u.host}/rest/`; } catch {}
    }
    const serverEndpoint = portalEndpoint || data.SERVER_ENDPOINT || data.auth?.server_endpoint || '';

    console.log('placement:', placement, '| serverEndpoint:', serverEndpoint, '| member:', memberId, '| hasToken:', !!accessToken);

    if (!accessToken) {
      console.error('No access token in installer POST');
      return new Response(makeHtml(placement), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // Global config: app URL + marketplace app credentials (shared across all portals)
    const globalConfig = (await db.entities.GlobalConfig.list('-updated_date'))[0] || {};
    const rawBaseUrl = globalConfig.app_base_url || '';
    const appBaseUrl = rawBaseUrl.replace(/^https:\/\/preview--/, 'https://');
    const installerUrl = appBaseUrl ? `${appBaseUrl}/api/functions/bitrix24Installer` : '';
    const handlerUrl = appBaseUrl ? `${appBaseUrl}/api/functions/bitrix24Handler` : '';
    const dashboardUrl = appBaseUrl ? `${appBaseUrl}/` : '';
    const crmChatUrl = appBaseUrl ? `${appBaseUrl}/crm-chat` : '';

    // Find or create the Bitrix24Account for this portal (keyed by member_id)
    let account = null;
    if (memberId) {
      const existing = await db.entities.Bitrix24Account.filter({ member_id: memberId });
      account = existing[0] || null;
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
    };
    if (account) {
      await db.entities.Bitrix24Account.update(account.id, accountData);
      account = { ...account, ...accountData };
    } else {
      let portalName = serverEndpoint;
      try { portalName = new URL(serverEndpoint).host; } catch {}
      account = await db.entities.Bitrix24Account.create({ name: portalName || `Portal ${memberId}`, ...accountData });
    }
    console.log('Bitrix24Account saved:', account.id);

    const CONNECTOR_ID = memberId ? `whatsapp_sp_${memberId.substring(0, 10)}` : 'whatsapp_sendpulse';

    // On DEFAULT install — register the connector + placement only.
    // The admin chooses which Open Line to connect from the Contact Center afterwards.
    if (placement === 'DEFAULT' && serverEndpoint) {
      console.log('DEFAULT install — registering connector (no line auto-pick)');

      // Register the connector (available to bind to any line via Contact Center)
      await callBitrix(serverEndpoint, accessToken, 'imconnector.register', {
        ID: CONNECTOR_ID,
        NAME: 'WhatsApp (SendPulse)',
        PLACEMENT_HANDLER: installerUrl,
        ICON: { DATA_IMAGE: WA_ICON, COLOR: '#25D366', SIZE: '90%', POSITION: 'center' },
        ICON_DISABLED: { DATA_IMAGE: WA_ICON, COLOR: '#99adb3', SIZE: '90%', POSITION: 'center' },
      });

      // Bind the message event handler
      if (handlerUrl) {
        const existingEventsRes = await callBitrix(serverEndpoint, accessToken, 'event.get', {});
        const existingHandlers = Array.isArray(existingEventsRes?.result) ? existingEventsRes.result : [];
        for (const h of existingHandlers.filter(h => h.event === 'ONIMCONNECTORMESSAGEADD' && h.handler === handlerUrl)) {
          await callBitrix(serverEndpoint, accessToken, 'event.unbind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: h.handler });
        }
        await callBitrix(serverEndpoint, accessToken, 'event.bind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: handlerUrl });
      }

      // Register Contact Center placement card — admin connects a line from here
      if (installerUrl) {
        await callBitrix(serverEndpoint, accessToken, 'placement.unbind', { PLACEMENT: 'CONTACT_CENTER', HANDLER: installerUrl });
        await callBitrix(serverEndpoint, accessToken, 'placement.bind', {
          PLACEMENT: 'CONTACT_CENTER', HANDLER: installerUrl,
          TITLE: 'WhatsApp (SendPulse)', DESCRIPTION: 'WhatsApp channel via SendPulse',
        });
      }

      // Left menu — opens the full dashboard
      if (dashboardUrl) {
        await callBitrix(serverEndpoint, accessToken, 'placement.unbind', { PLACEMENT: 'LEFT_MENU', HANDLER: dashboardUrl });
        await callBitrix(serverEndpoint, accessToken, 'placement.bind', {
          PLACEMENT: 'LEFT_MENU', HANDLER: dashboardUrl, TITLE: 'WhatsApp (SendPulse)',
        });
      }

      // CRM element tabs — chat for the element's contact (matched by phone)
      if (crmChatUrl) {
        for (const pl of ['CRM_LEAD_DETAIL_TAB', 'CRM_DEAL_DETAIL_TAB', 'CRM_CONTACT_DETAIL_TAB', 'CRM_COMPANY_DETAIL_TAB']) {
          await callBitrix(serverEndpoint, accessToken, 'placement.unbind', { PLACEMENT: pl, HANDLER: crmChatUrl });
          await callBitrix(serverEndpoint, accessToken, 'placement.bind', {
            PLACEMENT: pl, HANDLER: crmChatUrl, TITLE: 'WhatsApp Chat',
          });
        }
      }

      console.log('Connector registered. Awaiting Contact Center connection.');
    }

    // CONTACT_CENTER placement — admin connects this connector to a specific Open Line.
    // We retrieve the chosen line ID here and create/update the Open Channel record.
    if (placement === 'CONTACT_CENTER' && serverEndpoint) {
      let placementOptions = {};
      try { placementOptions = JSON.parse(data.PLACEMENT_OPTIONS || '{}'); } catch {}
      const lineId = String(placementOptions.LINE || placementOptions.CONNECTOR_LINE || placementOptions.ACTIVE_LINE || '');

      if (lineId) {
        await callBitrix(serverEndpoint, accessToken, 'imconnector.activate', { CONNECTOR: CONNECTOR_ID, LINE: lineId, ACTIVE: 'Y' });
        await callBitrix(serverEndpoint, accessToken, 'imconnector.connector.data.set', {
          CONNECTOR: CONNECTOR_ID, LINE: Number(lineId),
          DATA: { ID: `whatsapp_sendpulse_line_${lineId}`, NAME: 'WhatsApp (SendPulse)', URL: 'https://wa.me/', URL_IM: 'https://wa.me/' },
        });
        console.log('Activated connector for line', lineId);

        // Create the Open Channel record for the connected line (admin maps SendPulse later)
        const existingChans = await db.entities.Bitrix24OpenChannel.filter({ bitrix24_account_id: account.id, bitrix24_line_id: lineId });
        if (existingChans.length === 0) {
          await db.entities.Bitrix24OpenChannel.create({
            name: `${account.name} — Line ${lineId}`,
            bitrix24_account_id: account.id,
            sendpulse_account_id: '',
            bitrix24_line_id: lineId,
            bitrix24_connector_id: CONNECTOR_ID,
            channel: 'whatsapp',
            status: 'active',
          });
          console.log('Created Open Channel record for connected line', lineId);
        }
      } else {
        console.warn('CONTACT_CENTER click without a line ID in PLACEMENT_OPTIONS');
      }
    }

    const finalHtml = (placement !== 'DEFAULT' && appBaseUrl) ? embedHtml(appBaseUrl, '/') : makeHtml(placement);
    return new Response(finalHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch (error) {
    console.error('Installer error:', error.message);
    return new Response(makeHtml(placement), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
});