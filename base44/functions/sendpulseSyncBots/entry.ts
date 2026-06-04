import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CHANNELS = [
  { key: 'whatsapp', list: 'whatsapp/bots', webhook: 'whatsapp/webhooks' },
  { key: 'telegram', list: 'telegram/bots', webhook: 'telegram/webhooks' },
  { key: 'instagram', list: 'instagram/bots', webhook: 'instagram/webhooks' },
  { key: 'facebook', list: 'messenger/bots', webhook: 'messenger/webhooks' },
  { key: 'live_chat', list: 'live-chat/bots', webhook: 'live-chat/webhooks' },
];

async function ensureToken(base44, account) {
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
    status: 'connected',
  });
  return data.access_token;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { sendpulse_account_id, origin } = await req.json();
    if (!sendpulse_account_id) return Response.json({ error: 'Missing sendpulse_account_id' }, { status: 400 });

    const account = await base44.asServiceRole.entities.SendPulseAccount.get(sendpulse_account_id);
    if (!account?.client_id) return Response.json({ error: 'Account not configured' }, { status: 400 });

    const token = await ensureToken(base44, account);
    if (!token) return Response.json({ error: 'Failed to authenticate with SendPulse' }, { status: 400 });

    // Resolve the public webhook URL (GlobalConfig overrides the caller origin)
    const globalConfig = (await base44.asServiceRole.entities.GlobalConfig.list('-updated_date'))[0] || {};
    const rawBase = globalConfig.app_base_url || origin || '';
    const baseUrl = rawBase.replace(/^https:\/\/preview--/, 'https://').replace(/\/$/, '');
    const webhookUrl = baseUrl ? `${baseUrl}/api/functions/sendpulseWebhook` : '';

    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
    const existing = await base44.asServiceRole.entities.SendPulseBot.filter({ sendpulse_account_id });
    const existingByKey = {};
    for (const b of existing) existingByKey[`${b.channel}_${b.bot_id}`] = b;

    const bots = [];
    const webhooks = [];

    for (const ch of CHANNELS) {
      const listRes = await fetch(`https://api.sendpulse.com/${ch.list}`, { headers });
      if (!listRes.ok) continue;
      const listData = await listRes.json();
      const arr = Array.isArray(listData?.data) ? listData.data : (Array.isArray(listData) ? listData : []);
      if (arr.length === 0) continue;

      // Set the webhook for this channel (covers all its bots)
      let webhookOk = false;
      if (webhookUrl) {
        const whRes = await fetch(`https://api.sendpulse.com/${ch.webhook}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ url: webhookUrl, events: ['incoming_message', 'message'] }),
        });
        webhookOk = whRes.ok;
        webhooks.push({ channel: ch.key, ok: webhookOk });
        console.log(`Webhook ${ch.key}:`, whRes.status);
      }

      for (const bot of arr) {
        const botId = String(bot.id || bot.bot_id || '');
        if (!botId) continue;
        const name = bot.name || bot.channel_data?.name || bot.title || `${ch.key} bot`;
        const key = `${ch.key}_${botId}`;
        const payload = { name, sendpulse_account_id, bot_id: botId, channel: ch.key, webhook_active: webhookOk };
        if (existingByKey[key]) {
          await base44.asServiceRole.entities.SendPulseBot.update(existingByKey[key].id, payload);
        } else {
          await base44.asServiceRole.entities.SendPulseBot.create(payload);
        }
        bots.push({ bot_id: botId, name, channel: ch.key });
      }
    }

    return Response.json({ success: true, count: bots.length, bots, webhooks, webhookUrl });
  } catch (error) {
    console.error('sendpulseSyncBots error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});