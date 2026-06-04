import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function ensureSendPulseToken(base44, account) {
  let token = account.access_token;
  const expires = account.token_expires_at ? new Date(account.token_expires_at) : null;
  if (token && expires && expires > new Date()) return token;
  const res = await fetch('https://api.sendpulse.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: account.client_id, client_secret: account.client_secret }),
  });
  const data = await res.json();
  if (!data.access_token) return null;
  await base44.asServiceRole.entities.SendPulseAccount.update(account.id, {
    access_token: data.access_token,
    token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
  });
  return data.access_token;
}

// Count {{n}} placeholders in the template's BODY component
function countParams(template) {
  const comps = template.components || template.template?.components || [];
  const body = (Array.isArray(comps) ? comps : []).find(c => (c.type || '').toUpperCase() === 'BODY');
  const text = body?.text || '';
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g);
  return matches ? new Set(matches).size : 0;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { botId } = await req.json();
    if (!botId) return Response.json({ error: 'botId is required' }, { status: 400 });

    // Resolve the SendPulse account that owns this bot
    const bots = await base44.asServiceRole.entities.SendPulseBot.filter({ bot_id: String(botId) });
    if (!bots.length) return Response.json({ error: 'Bot not found' }, { status: 404 });
    const accounts = await base44.asServiceRole.entities.SendPulseAccount.filter({ id: bots[0].sendpulse_account_id });
    if (!accounts.length) return Response.json({ error: 'SendPulse account not found' }, { status: 404 });

    const spToken = await ensureSendPulseToken(base44, accounts[0]);
    if (!spToken) return Response.json({ error: 'Failed to obtain SendPulse token' }, { status: 500 });

    const res = await fetch(`https://api.sendpulse.com/whatsapp/templates?bot_id=${encodeURIComponent(botId)}`, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${spToken}` },
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('SendPulse templates error:', JSON.stringify(data));
      return Response.json({ error: data.message || 'Failed to fetch templates' }, { status: res.status });
    }

    const raw = Array.isArray(data) ? data : (data.data || data.templates || []);
    const templates = raw
      .filter(t => {
        const status = (t.status || t.template?.status || '').toUpperCase();
        return !status || status === 'APPROVED' || status === 'ACTIVE';
      })
      .map(t => ({
        name: t.name || t.template?.name,
        language: t.language || t.language_code || t.template?.language || 'en',
        category: t.category || t.template?.category || '',
        paramCount: countParams(t),
      }))
      .filter(t => t.name);

    return Response.json({ templates });
  } catch (error) {
    console.error('getSendPulseTemplates error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});