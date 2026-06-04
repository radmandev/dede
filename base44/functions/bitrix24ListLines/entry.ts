import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function callBitrix(endpoint, token, method, params = {}) {
  const base = endpoint.endsWith('/') ? endpoint : endpoint + '/';
  const url = `${base}${method}?auth=${encodeURIComponent(token)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function ensureToken(base44, account) {
  let token = account.access_token;
  const expires = account.token_expires_at ? new Date(account.token_expires_at) : null;
  if (token && expires && expires > new Date(Date.now() + 60000)) return token;
  if (!account.app_client_id || !account.app_client_secret || !account.refresh_token) return token;
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
  if (!data.access_token) return token;
  await base44.asServiceRole.entities.Bitrix24Account.update(account.id, {
    access_token: data.access_token,
    refresh_token: data.refresh_token || account.refresh_token,
    token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
  });
  return data.access_token;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { bitrix24_account_id } = await req.json();
    if (!bitrix24_account_id) return Response.json({ error: 'Missing bitrix24_account_id' }, { status: 400 });

    const account = await base44.asServiceRole.entities.Bitrix24Account.get(bitrix24_account_id);
    if (!account?.domain) return Response.json({ error: 'Account has no endpoint' }, { status: 400 });

    const token = await ensureToken(base44, account);
    if (!token) return Response.json({ error: 'No valid token for this account' }, { status: 400 });

    const result = await callBitrix(account.domain, token, 'imopenlines.config.list.get', {});
    const raw = Array.isArray(result?.result) ? result.result : [];
    const lines = raw.map((l) => ({
      id: String(l.ID || l.id || ''),
      name: l.LINE_NAME || l.NAME || `Line ${l.ID}`,
    })).filter((l) => l.id);

    return Response.json({ lines });
  } catch (error) {
    console.error('bitrix24ListLines error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});