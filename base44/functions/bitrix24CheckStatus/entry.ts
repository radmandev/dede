import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';



async function callBitrix(endpoint, token, method, params = {}) {
  const base = endpoint.endsWith('/') ? endpoint : endpoint + '/';
  const url = `${base}${method}?auth=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const configs = await base44.asServiceRole.entities.AppConfig.list('-updated_date');
    const config = configs[0];
    if (!config) return Response.json({ error: 'No config' }, { status: 400 });

    const CONNECTOR_ID = config.bitrix24_connector_id || 'whatsapp_sendpulse';
    let token = config.bitrix24_access_token;
    const endpoint = config.bitrix24_domain;
    const lineId = config.bitrix24_line_id || '33';

    // Refresh token if expired
    const expires = config.bitrix24_token_expires_at ? new Date(config.bitrix24_token_expires_at) : null;
    if (!expires || expires < new Date()) {
      if (config.bitrix24_app_client_id && config.bitrix24_app_client_secret && config.bitrix24_refresh_token) {
        const r = await fetch('https://oauth.bitrix.info/oauth/token/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: config.bitrix24_app_client_id,
            client_secret: config.bitrix24_app_client_secret,
            refresh_token: config.bitrix24_refresh_token,
          }),
        });
        const rd = await r.json();
        if (rd.access_token) token = rd.access_token;
      }
    }

    // List all open lines
    const linesRes = await callBitrix(endpoint, token, 'imopenlines.config.list', {});
    console.log('imopenlines.config.list:', JSON.stringify(linesRes?.result));
    const allLines = Array.isArray(linesRes?.result) ? linesRes.result.map(l => ({ id: l.ID, name: l.LINE_NAME || l.LINE_ID })) : [];

    // Check imconnector.status for the line
    const statusRes = await callBitrix(endpoint, token, 'imconnector.status', {
      CONNECTOR: CONNECTOR_ID,
      LINE: String(lineId),
    });
    console.log('imconnector.status:', JSON.stringify(statusRes));

    // Check if connector is in imconnector.list
    const listRes = await callBitrix(endpoint, token, 'imconnector.list', {});
    const inList = !!(listRes?.result?.[CONNECTOR_ID]);
    console.log('connector in imconnector.list:', inList);
    console.log('all connector keys:', JSON.stringify(Object.keys(listRes?.result || {})));

    // Check registered event handlers
    const eventGetRes = await callBitrix(endpoint, token, 'event.get', {});
    console.log('event.get:', JSON.stringify(eventGetRes));
    const events = eventGetRes?.result || {};
    const allHandlers = Array.isArray(events) ? events : [];
    const msgHandlers = allHandlers.filter(h => h.event === 'ONIMCONNECTORMESSAGEADD').map(h => h.handler);

    // Check placements
    const placementsRes = await callBitrix(endpoint, token, 'placement.get', {});
    const placements = (placementsRes?.result || []).map(p => ({ id: p.id, placement: p.placement, handler: p.handler, title: p.title }));

    return Response.json({
      connector_id: CONNECTOR_ID,
      line_id: lineId,
      all_open_lines: allLines,
      status: statusRes?.result,
      in_list: inList,
      event_handlers: { ONIMCONNECTORMESSAGEADD: msgHandlers },
      placements,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});