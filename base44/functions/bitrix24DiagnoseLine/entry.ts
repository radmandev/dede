import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function callBitrix(endpoint, token, method, params = {}) {
  const base = endpoint.endsWith('/') ? endpoint : endpoint + '/';
  const url = `${base}${method}?auth=${encodeURIComponent(token)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const configs = await base44.asServiceRole.entities.AppConfig.list();
    const config = configs[0];
    if (!config) return Response.json({ error: 'No config' }, { status: 400 });

    let token = config.bitrix24_access_token;
    const endpoint = config.bitrix24_domain;
    const lineId = Number(config.bitrix24_line_id || 35);
    const CONNECTOR_ID = config.bitrix24_connector_id || 'whatsapp_sendpulse';

    // Refresh token if needed
    const expires = config.bitrix24_token_expires_at ? new Date(config.bitrix24_token_expires_at) : null;
    if (!expires || expires < new Date()) {
      if (config.bitrix24_app_client_id && config.bitrix24_refresh_token) {
        const r = await fetch('https://oauth.bitrix.info/oauth/token/', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.bitrix24_app_client_id, client_secret: config.bitrix24_app_client_secret, refresh_token: config.bitrix24_refresh_token }),
        });
        const rd = await r.json();
        if (rd.access_token) token = rd.access_token;
      }
    }

    // Get line config (correct param is CONFIG_ID)
    const lineConfig = await callBitrix(endpoint, token, 'imopenlines.config.get', { CONFIG_ID: lineId });
    console.log('imopenlines.config.get LINE=' + lineId + ':', JSON.stringify(lineConfig?.result || lineConfig?.error));

    // Try different queue methods
    const queueGet = await callBitrix(endpoint, token, 'imopenlines.operator.list', { LINE_ID: lineId });
    console.log('imopenlines.operator.list:', JSON.stringify(queueGet?.result || queueGet?.error));

    // Get current Bitrix24 user
    const curUser = await callBitrix(endpoint, token, 'user.current', {});
    console.log('user.current:', JSON.stringify(curUser?.result));

    // Check connector status
    const connStatus = await callBitrix(endpoint, token, 'imconnector.status', { CONNECTOR: CONNECTOR_ID, LINE: lineId });

    // Try to update the line to ensure QUEUE_TYPE is correct (use CONFIG_ID)
    const updateRes = await callBitrix(endpoint, token, 'imopenlines.config.update', {
      CONFIG_ID: lineId,
      PARAMS: { ACTIVE: 'Y', QUEUE_TYPE: 1 }
    });
    console.log('imopenlines.config.update:', JSON.stringify(updateRes?.result || updateRes?.error));

    // Add current user to queue (try CONFIG_ID)
    if (curUser?.result?.ID) {
      const addQueue1 = await callBitrix(endpoint, token, 'imopenlines.queue.add', {
        CONFIG_ID: lineId,
        USER_ID: Number(curUser.result.ID),
      });
      console.log('imopenlines.queue.add CONFIG_ID:', JSON.stringify(addQueue1?.result || addQueue1?.error));

      const addQueue2 = await callBitrix(endpoint, token, 'imopenlines.operator.add', {
        CONFIG_ID: lineId,
        USER_ID: Number(curUser.result.ID),
      });
      console.log('imopenlines.operator.add:', JSON.stringify(addQueue2?.result || addQueue2?.error));
    }

    return Response.json({
      line_id: lineId,
      line_config: lineConfig?.result || lineConfig?.error,
      operators: queueGet?.result || queueGet?.error,
      current_user_id: curUser?.result?.ID,
      current_user_name: curUser?.result?.NAME,
      connector_status: connStatus?.result,
      line_update: updateRes?.result || updateRes?.error,
    });
  } catch (error) {
    console.error('Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});