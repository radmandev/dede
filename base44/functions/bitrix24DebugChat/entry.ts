import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const chatId = body.chatId || 17365;

    const configs = await base44.asServiceRole.entities.AppConfig.list();
    const config = configs[0];
    const token = config.bitrix24_access_token;
    const endpoint = config.bitrix24_domain || 'https://rawajtech.bitrix24.com/rest/';

    const base = endpoint.endsWith('/') ? endpoint : endpoint + '/';

    // Try different DIALOG_ID formats
    const res1 = await fetch(`${base}im.dialog.messages.get?auth=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ DIALOG_ID: `chat${chatId}`, LIMIT: 10 }),
    });
    const data1 = await res1.json();

    // Also try imopenlines chat messages
    const res2 = await fetch(`${base}im.recent.list?auth=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ LIMIT: 20 }),
    });
    const data2 = await res2.json();

    return Response.json({
      chatId,
      dialog_messages: data1,
      recent_list_sample: (data2?.result?.items || []).slice(0, 5),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});