import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole;
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const openChannelId = body.openChannelId;
    if (!openChannelId) return Response.json({ error: 'openChannelId is required' }, { status: 400 });

    const channels = await db.entities.Bitrix24OpenChannel.filter({ id: openChannelId });
    const channel = channels[0];
    if (!channel) return Response.json({ error: 'Open Channel not found' }, { status: 404 });

    const accounts = await db.entities.Bitrix24Account.filter({ id: channel.bitrix24_account_id });
    const account = accounts[0];
    if (!account) return Response.json({ error: 'Bitrix24 account not found' }, { status: 404 });

    const lineId = channel.bitrix24_line_id;
    if (!lineId) return Response.json({ error: 'Open Channel has no Line ID configured' }, { status: 400 });

    const endpoint = account.domain;
    if (!endpoint) return Response.json({ error: 'Bitrix24 account has no domain. Reinstall the app on the portal.' }, { status: 400 });
    const CONNECTOR_ID = channel.bitrix24_connector_id ||
      (account.member_id ? `whatsapp_sp_${account.member_id.substring(0, 10)}` : 'whatsapp_sendpulse');

    // Ensure a valid token (refresh if needed)
    let token = account.access_token;
    const expires = account.token_expires_at ? new Date(account.token_expires_at) : null;
    if (!token || !expires || expires < new Date(Date.now() + 60000)) {
      if (!account.app_client_id || !account.app_client_secret || !account.refresh_token) {
        return Response.json({ error: 'Token expired and no refresh credentials. Reinstall the app on the portal.' }, { status: 400 });
      }
      const refreshRes = await fetch('https://oauth.bitrix.info/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: account.app_client_id,
          client_secret: account.app_client_secret,
          refresh_token: account.refresh_token,
        }),
      });
      const refreshData = await refreshRes.json();
      if (!refreshData.access_token) {
        return Response.json({ error: 'Token refresh failed: ' + (refreshData.error_description || refreshData.error || 'reinstall the app') }, { status: 400 });
      }
      token = refreshData.access_token;
      await db.entities.Bitrix24Account.update(account.id, {
        access_token: token,
        refresh_token: refreshData.refresh_token || account.refresh_token,
        token_expires_at: new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString(),
      });
    }

    // Global config for handler/installer URLs
    const globalConfig = (await db.entities.GlobalConfig.list('-updated_date'))[0] || {};
    const appBaseUrl = (globalConfig.app_base_url || '').replace(/^https:\/\/preview--/, 'https://');
    if (!appBaseUrl) return Response.json({ error: 'App Production URL not set in Settings.' }, { status: 400 });
    const installerUrl = `${appBaseUrl}/api/functions/bitrix24Installer`;
    const handlerUrl = `${appBaseUrl}/api/functions/bitrix24Handler`;

    // Persist connector id on the channel
    if (!channel.bitrix24_connector_id) {
      await db.entities.Bitrix24OpenChannel.update(channel.id, { bitrix24_connector_id: CONNECTOR_ID });
    }

    // Register
    const registerRes = await callBitrix(endpoint, token, 'imconnector.register', {
      ID: CONNECTOR_ID,
      NAME: 'WhatsApp (SendPulse)',
      PLACEMENT_HANDLER: installerUrl,
      ICON: { DATA_IMAGE: WA_ICON, COLOR: '#25D366', SIZE: '90%', POSITION: 'center' },
      ICON_DISABLED: { DATA_IMAGE: WA_ICON, COLOR: '#99adb3', SIZE: '90%', POSITION: 'center' },
    });
    console.log('imconnector.register:', JSON.stringify(registerRes?.result));

    // Activate on this line
    const activateRes = await callBitrix(endpoint, token, 'imconnector.activate', { CONNECTOR: CONNECTOR_ID, LINE: lineId, ACTIVE: 'Y' });
    await callBitrix(endpoint, token, 'imconnector.connector.data.set', {
      CONNECTOR: CONNECTOR_ID, LINE: Number(lineId),
      DATA: { ID: `whatsapp_sendpulse_line_${lineId}`, NAME: 'WhatsApp (SendPulse)', URL: 'https://wa.me/', URL_IM: 'https://wa.me/' },
    });

    // Bind handler (clean only our URL first)
    const existingEventsRes = await callBitrix(endpoint, token, 'event.get', {});
    const existingHandlers = Array.isArray(existingEventsRes?.result) ? existingEventsRes.result : [];
    for (const h of existingHandlers.filter(h => h.event === 'ONIMCONNECTORMESSAGEADD' && h.handler === handlerUrl)) {
      await callBitrix(endpoint, token, 'event.unbind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: h.handler });
    }
    const bindRes = await callBitrix(endpoint, token, 'event.bind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: handlerUrl });

    await callBitrix(endpoint, token, 'placement.unbind', { PLACEMENT: 'CONTACT_CENTER', HANDLER: installerUrl });
    await callBitrix(endpoint, token, 'placement.bind', {
      PLACEMENT: 'CONTACT_CENTER', HANDLER: installerUrl,
      TITLE: 'WhatsApp (SendPulse)', DESCRIPTION: 'WhatsApp channel via SendPulse',
    });

    const statusRes = await callBitrix(endpoint, token, 'imconnector.status', { CONNECTOR: CONNECTOR_ID, LINE: Number(lineId) });
    const connectorActive = statusRes?.result?.ACTIVE === 'Y' || statusRes?.result?.active === true;
    const bindSuccess = bindRes?.result === true;

    return Response.json({
      success: true,
      connector_id: CONNECTOR_ID,
      line_id: lineId,
      event_bind_success: bindSuccess,
      connector_active: connectorActive,
      msg: `✓ Connector registered on Line ${lineId}. event.bind: ${bindSuccess ? '✓' : '⚠️'}`,
    });
  } catch (error) {
    console.error('Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});