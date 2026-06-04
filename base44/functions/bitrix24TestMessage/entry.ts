import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CONNECTOR_ID = 'whatsapp_sendpulse';

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
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const configs = await base44.asServiceRole.entities.AppConfig.list('-updated_date');
    const config = configs[0];
    if (!config) return Response.json({ error: 'No AppConfig found' }, { status: 400 });

    const diagnostics = {
      bitrix24_domain: config.bitrix24_domain || null,
      bitrix24_status: config.bitrix24_status || null,
      bitrix24_line_id: config.bitrix24_line_id || null,
      has_access_token: !!config.bitrix24_access_token,
      token_expires_at: config.bitrix24_token_expires_at || null,
      token_expired: config.bitrix24_token_expires_at ? new Date(config.bitrix24_token_expires_at) < new Date() : null,
    };

    if (!config.bitrix24_domain || !config.bitrix24_access_token) {
      return Response.json({ ok: false, diagnostics, error: 'Missing domain or access token' });
    }

    // Refresh token if expired
    let token = config.bitrix24_access_token;
    const expires = config.bitrix24_token_expires_at ? new Date(config.bitrix24_token_expires_at) : null;
    if (!expires || expires < new Date()) {
      if (config.bitrix24_app_client_id && config.bitrix24_app_client_secret && config.bitrix24_refresh_token) {
        const refreshRes = await fetch('https://oauth.bitrix.info/oauth/token/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: config.bitrix24_app_client_id,
            client_secret: config.bitrix24_app_client_secret,
            refresh_token: config.bitrix24_refresh_token,
          }),
        });
        const refreshData = await refreshRes.json();
        if (refreshData.access_token) {
          token = refreshData.access_token;
          await base44.asServiceRole.entities.AppConfig.update(config.id, {
            bitrix24_access_token: token,
            bitrix24_refresh_token: refreshData.refresh_token || config.bitrix24_refresh_token,
            bitrix24_token_expires_at: new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString(),
          });
          diagnostics.token_refreshed = true;
        } else {
          diagnostics.token_refresh_error = refreshData.error_description || refreshData.error;
        }
      }
    }

    const endpoint = config.bitrix24_domain;

    // Step 1: Check lines
    const linesRes = await callBitrix(endpoint, token, 'imopenlines.config.list.get', {});
    diagnostics.lines = linesRes;

    // Step 2: Check connector registration
    const connectorRes = await callBitrix(endpoint, token, 'imconnector.list', {});
    diagnostics.connector_registered = !!(connectorRes?.result && connectorRes.result[CONNECTOR_ID]);
    diagnostics.connector_in_list = connectorRes?.result?.[CONNECTOR_ID] || null;

    // Step 2b: Check imconnector.status for the configured line
    const statusRes2 = await callBitrix(endpoint, token, 'imconnector.status', {
      CONNECTOR: CONNECTOR_ID,
      LINE: String(config.bitrix24_line_id),
    });
    diagnostics.connector_status = statusRes2?.result || statusRes2;
    console.log('imconnector.status line 33:', JSON.stringify(statusRes2));

    if (!config.bitrix24_line_id) {
      // Try to auto-detect and save line ID
      const lines = Array.isArray(linesRes?.result) ? linesRes.result : [];
      if (lines.length > 0) {
        const firstId = String(lines[0].ID || lines[0].id || '');
        if (firstId) {
          await base44.asServiceRole.entities.AppConfig.update(config.id, { bitrix24_line_id: firstId });
          diagnostics.auto_saved_line_id = firstId;
        }
      }
      return Response.json({ ok: false, diagnostics, error: 'bitrix24_line_id is not set. Auto-detected above.' });
    }

    // Step 3: Send test message
    const unixNow = Math.floor(Date.now() / 1000);
    const testPayload = {
      CONNECTOR: CONNECTOR_ID,
      LINE: Number(config.bitrix24_line_id),
      MESSAGES: [{
        user: {
          id: 'test_user_001',
          name: 'Test User',
        },
        message: {
          id: `test_${Date.now()}`,
          date: unixNow,
          text: '🔧 Test message from SendPulse bridge',
        },
        chat: {
          id: 'test_chat_001',
        },
      }],
    };

    console.log('Sending payload:', JSON.stringify(testPayload));
    const sendRes = await callBitrix(endpoint, token, 'imconnector.send.messages', testPayload);
    diagnostics.send_test_result = sendRes;
    console.log('send.messages result:', JSON.stringify(sendRes));

    const ok = !sendRes?.error && sendRes?.result !== undefined && sendRes?.result !== null;
    return Response.json({ ok, diagnostics });

  } catch (error) {
    return Response.json({ ok: false, error: error.message, stack: error.stack }, { status: 500 });
  }
});