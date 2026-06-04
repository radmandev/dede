import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

async function callBitrix(endpoint, token, method, params = {}) {
  const base = endpoint.endsWith('/') ? endpoint : endpoint + '/';
  const url = `${base}${method}?auth=${encodeURIComponent(token)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function ensureToken(db, account) {
  let token = account.access_token;
  const expires = account.token_expires_at ? new Date(account.token_expires_at) : null;
  if (token && expires && expires > new Date(Date.now() + 60000)) return token;
  if (!account.app_client_id || !account.app_client_secret || !account.refresh_token) return null;
  const res = await fetch('https://oauth.bitrix.info/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: account.app_client_id,
      client_secret: account.app_client_secret,
      refresh_token: account.refresh_token,
    }),
  });
  const data = await res.json();
  if (!data.access_token) return null;
  await db.entities.Bitrix24Account.update(account.id, {
    access_token: data.access_token,
    refresh_token: data.refresh_token || account.refresh_token,
    token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
  });
  return data.access_token;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole;
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const globalConfig = (await db.entities.GlobalConfig.list('-updated_date'))[0] || {};
    const appBaseUrl = (globalConfig.app_base_url || '').replace(/^https:\/\/preview--/, 'https://');
    if (!appBaseUrl) return Response.json({ error: 'Set the App Production URL in Settings first.' }, { status: 400 });
    const handlerUrl = `${appBaseUrl}/api/functions/bitrix24Handler`;

    const body = await req.json().catch(() => ({}));
    const accounts = body.accountId
      ? await db.entities.Bitrix24Account.filter({ id: body.accountId })
      : await db.entities.Bitrix24Account.filter({ status: 'connected' });

    if (accounts.length === 0) return Response.json({ error: 'No connected Bitrix24 portals found.' }, { status: 404 });

    const results = [];
    for (const account of accounts) {
      const endpoint = account.domain || '';
      const token = await ensureToken(db, account);
      if (!token || !endpoint) {
        results.push({ account: account.name, ok: false, reason: 'Missing token or portal endpoint — reinstall the app.' });
        continue;
      }

      // Remove any stale bindings that point at our handler (e.g. an old preview URL)
      const before = await callBitrix(endpoint, token, 'event.get', {});
      const handlers = Array.isArray(before?.result) ? before.result : [];
      for (const h of handlers.filter(h => h.event === 'ONIMCONNECTORMESSAGEADD' && /\/api\/functions\/bitrix24Handler/.test(h.handler || ''))) {
        await callBitrix(endpoint, token, 'event.unbind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: h.handler });
      }

      // Bind the current production handler
      const bind = await callBitrix(endpoint, token, 'event.bind', { EVENT: 'ONIMCONNECTORMESSAGEADD', HANDLER: handlerUrl });

      // Verify
      const after = await callBitrix(endpoint, token, 'event.get', {});
      const bound = (Array.isArray(after?.result) ? after.result : [])
        .some(h => h.event === 'ONIMCONNECTORMESSAGEADD' && h.handler === handlerUrl);

      results.push({
        account: account.name,
        ok: bind?.result === true || bound,
        bound,
        error: bind?.error_description || bind?.error || null,
      });
    }

    return Response.json({ success: true, handlerUrl, results });
  } catch (error) {
    console.error('bindReplyWebhook error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});