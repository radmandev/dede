import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const base44 = createClientFromRequest(req);

  const {
    conversation_id,
    message_text = '',
    message_type = 'text',
    media_url = '',
    media_name = '',
    template_name = '',
    template_language = 'en',
    template_params = [],
  } = await req.json();

  if (!conversation_id) {
    return Response.json({ error: 'Missing conversation_id' }, { status: 400 });
  }

  const conversation = await base44.asServiceRole.entities.Conversation.get(conversation_id);
  if (!conversation) {
    return Response.json({ error: 'Conversation not found' }, { status: 404 });
  }

  // Resolve the SendPulse account for this conversation
  const spAccountId = conversation.sendpulse_account_id;
  if (!spAccountId) {
    return Response.json({ error: 'Conversation has no SendPulse account mapped' }, { status: 400 });
  }
  const spAccount = await base44.asServiceRole.entities.SendPulseAccount.get(spAccountId);
  if (!spAccount?.client_id) {
    return Response.json({ error: 'SendPulse account not configured' }, { status: 400 });
  }

  // Refresh token if missing or expired
  let accessToken = spAccount.access_token;
  const tokenExpiresAt = spAccount.token_expires_at ? new Date(spAccount.token_expires_at) : null;
  if (!accessToken || !tokenExpiresAt || tokenExpiresAt < new Date()) {
    const tokenResp = await fetch('https://api.sendpulse.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: spAccount.client_id, client_secret: spAccount.client_secret }),
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) {
      return Response.json({ error: 'Failed to refresh SendPulse token' }, { status: 400 });
    }
    accessToken = tokenData.access_token;
    await base44.asServiceRole.entities.SendPulseAccount.update(spAccount.id, {
      access_token: accessToken,
      token_expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
      status: 'connected',
    });
  }

  const contactId = conversation.sendpulse_contact_id;
  const channel = conversation.channel || 'whatsapp';

  // Build SendPulse message payload based on type and channel
  function buildMessage(type, text, mediaUrl, mediaFileName, tmplName, tmplLang, tmplParams) {
    if (channel === 'live_chat') {
      // Live Chat API uses "messages" array format
      switch (type) {
        case 'image':
          return { type: 'image', image: { file: { url: mediaUrl }, caption: text || undefined } };
        case 'file':
          return { type: 'file', file: { file: { url: mediaUrl }, name: mediaFileName || 'file' } };
        case 'audio':
          return { type: 'audio', audio: { file: { url: mediaUrl } } };
        default:
          return { type: 'text', text: { text } };
      }
    }

    if (channel === 'telegram') {
      switch (type) {
        case 'image':
          return { type: 'photo', photo: { url: mediaUrl, caption: text || '' } };
        case 'file':
          return { type: 'document', document: { url: mediaUrl, caption: text || '', filename: mediaFileName || 'file' } };
        case 'audio':
          return { type: 'audio', audio: { url: mediaUrl } };
        default:
          return { type: 'text', text };
      }
    }

    // WhatsApp, Instagram, Facebook
    switch (type) {
      case 'image':
        return { type: 'image', image: { link: mediaUrl, caption: text || '' } };
      case 'file':
        return { type: 'document', document: { link: mediaUrl, filename: mediaFileName || 'document', caption: text || '' } };
      case 'audio':
        return { type: 'audio', audio: { link: mediaUrl } };
      case 'template': {
        const components = [];
        if (tmplParams && tmplParams.length > 0) {
          components.push({
            type: 'body',
            parameters: tmplParams.map(p => ({ type: 'text', text: p })),
          });
        }
        return {
          type: 'template',
          template: { name: tmplName, language: { code: tmplLang }, components },
        };
      }
      default:
        return { type: 'text', text: { body: text } };
    }
  }

  const msgPayload = buildMessage(message_type, message_text, media_url, media_name, template_name, template_language, template_params);
  console.log('Built message payload:', JSON.stringify(msgPayload));

  let spResponse;
  if (channel === 'live_chat') {
    const body = { contact_id: contactId, messages: [msgPayload] };
    spResponse = await fetch('https://api.sendpulse.com/live-chat/contacts/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
  } else {
    const pathMap = { whatsapp: 'whatsapp', telegram: 'telegram', instagram: 'instagram', facebook: 'fb' };
    const path = pathMap[channel] || 'whatsapp';
    const body = { contact_id: contactId, message: msgPayload };
    spResponse = await fetch(`https://api.sendpulse.com/${path}/contacts/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
  }

  const spData = await spResponse.json();
  console.log('SendPulse response:', spResponse.status, JSON.stringify(spData));

  if (!spResponse.ok) {
    return Response.json({ error: spData.message || JSON.stringify(spData) }, { status: 400 });
  }

  const displayText = message_type === 'template' ? `[Template: ${template_name}]`
    : message_type === 'image' ? (message_text || '[Image]')
    : message_type === 'file' ? (media_name || '[File]')
    : message_type === 'audio' ? '[Audio]'
    : message_text;

  await base44.asServiceRole.entities.Message.create({
    conversation_id,
    sender_name: 'Agent',
    message_text: displayText,
    message_type,
    media_url: media_url || undefined,
    media_name: media_name || undefined,
    direction: 'outbound',
    channel,
  });

  await base44.asServiceRole.entities.Conversation.update(conversation_id, {
    last_message_text: displayText.substring(0, 200),
    last_message_at: new Date().toISOString(),
  });

  return Response.json({ success: true });
});