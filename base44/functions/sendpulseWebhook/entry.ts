import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Retry a DB call when Base44 returns a transient 429 rate-limit, so messages aren't dropped.
async function withRetry(fn, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = (e?.message || '') + (e?.response?.status || '');
      const is429 = msg.includes('429') || /rate limit/i.test(e?.message || '');
      if (!is429 || i === attempts - 1) { lastErr = e; break; }
      await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

async function refreshBitrix24Token(base44, account) {
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
  if (data?.access_token) {
    await base44.asServiceRole.entities.Bitrix24Account.update(account.id, {
      access_token: data.access_token,
      refresh_token: data.refresh_token || account.refresh_token,
      token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
    });
  }
  return data;
}

async function sendToBitrix24(base44, account, channelCfg, conversation, messageText, messageId, msgType, mediaUrl, mediaFilename, contactPhone) {
  if (!account.domain) { console.warn('Bitrix24 account has no domain'); return; }
  if (!channelCfg.bitrix24_line_id) { console.warn('Open channel has no line ID'); return; }
  const CONNECTOR_ID = channelCfg.bitrix24_connector_id || 'whatsapp_sendpulse';

  // Refresh token if expired
  let token = account.access_token;
  const expires = account.token_expires_at ? new Date(account.token_expires_at) : null;
  if (!token || !expires || expires < new Date()) {
    const refreshData = await refreshBitrix24Token(base44, account);
    if (refreshData?.access_token) token = refreshData.access_token;
    else { console.warn('Bitrix24 token refresh failed — skipping forward'); return; }
  }

  const unixNow = Math.floor(Date.now() / 1000);
  const messageObj = { id: messageId || String(Date.now()), date: unixNow, text: messageText, type: 'text' };
  if (mediaUrl) {
    const isImage = msgType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(mediaFilename || '');
    const isAudio = msgType === 'audio' || msgType === 'voice';
    const fileType = isImage ? 'IMAGE' : isAudio ? 'AUDIO' : 'DOCUMENT';
    messageObj.FILES = { '0': { link: mediaUrl, name: mediaFilename || 'file', type: fileType } };
    if (!messageText) messageObj.type = fileType.toLowerCase();
  }
  const payload = {
    CONNECTOR: CONNECTOR_ID,
    LINE: Number(channelCfg.bitrix24_line_id),
    MESSAGES: [{
      user: { id: conversation.sendpulse_contact_id, name: conversation.contact_name || 'Customer', phone: contactPhone || conversation.contact_phone || '', avatar: '', online: true },
      message: messageObj,
      chat: { id: conversation.sendpulse_contact_id },
    }],
  };

  const endpoint = account.domain.endsWith('/') ? account.domain : account.domain + '/';
  const res = await fetch(`${endpoint}imconnector.send.messages?auth=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await res.json();
  console.log('Bitrix24 imconnector.send.messages:', JSON.stringify(result));
  const returnedChatId =
    result?.result?.DATA?.RESULT?.[0]?.session?.CHAT_ID ||
    result?.result?.DATA?.RESULT_MESSAGE?.[0]?.chat_id ||
    result?.result?.[0]?.chat_id ||
    result?.result?.chat_id;
  if (returnedChatId && String(conversation.bitrix24_chat_id) !== String(returnedChatId)) {
    await base44.asServiceRole.entities.Conversation.update(conversation.id, { bitrix24_chat_id: Number(returnedChatId) });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  try {
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole;
    let raw = await req.json();
    if (typeof raw === 'string') raw = JSON.parse(raw);
    const item = Array.isArray(raw) ? raw[0] : raw;

    const service = (item?.service || '').toLowerCase();
    const channelMap = { telegram: 'telegram', whatsapp: 'whatsapp', instagram: 'instagram', facebook: 'facebook', messenger: 'facebook', live_chat: 'live_chat' };
    const channel = channelMap[service] || 'whatsapp';

    const bot = item?.bot || {};
    const contact = item?.contact || {};
    const infoMsg = item?.info?.message || {};
    const lastMsgData = item?.contact?.last_message_data?.message || {};
    const channelMsg = infoMsg?.channel_data?.message || {};

    const botId = bot.id || '';
    const contactId = contact.id || String(contact.phone || '');
    const contactName = contact.name || contact.username || String(contact.phone || '') || 'Unknown';
    const rawPhone = String(contact.phone || contact.variables?.phone || channelMsg?.from || '').replace(/[^\d]/g, '');
    const contactPhone = rawPhone ? '+' + rawPhone : '';

    // ROUTING: find the Open Channel mapped to this SendPulse bot
    const channels = await withRetry(() => db.entities.Bitrix24OpenChannel.filter({ sendpulse_bot_id: botId }));
    const channelCfg = channels[0];
    if (!channelCfg) {
      console.warn('No Open Channel mapped to SendPulse bot:', botId);
      return Response.json({ success: false, reason: 'unmapped_bot', bot_id: botId }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    const bxAccounts = await withRetry(() => db.entities.Bitrix24Account.filter({ id: channelCfg.bitrix24_account_id }));
    const bxAccount = bxAccounts[0];

    const infoText = infoMsg?.text;
    const liveChatText = (typeof infoText === 'string' ? infoText : '') || channelMsg?.text?.text || '';
    const messageText =
      channelMsg?.text?.body ||
      (typeof channelMsg?.text === 'string' ? channelMsg.text : '') ||
      liveChatText ||
      (typeof contact.last_message === 'string' && contact.last_message ? contact.last_message : '') || '';

    const rawMsgType = channelMsg?.type || lastMsgData?.type || 'text';
    // Normalise to the types our UI understands
    const msgTypeMap: Record<string, string> = { image: 'image', audio: 'audio', voice: 'audio', video: 'file', document: 'file', file: 'file', text: 'text', template: 'template' };
    const msgType = msgTypeMap[rawMsgType] || 'text';

    const mediaUrl =
      channelMsg?.image?.url || channelMsg?.image?.link ||
      channelMsg?.document?.url || channelMsg?.document?.link ||
      channelMsg?.audio?.url || channelMsg?.audio?.link ||
      channelMsg?.video?.url || channelMsg?.video?.link ||
      // Telegram: photo is an array, pick the last (largest) element
      (Array.isArray(channelMsg?.photo) ? channelMsg.photo[channelMsg.photo.length - 1]?.file_url : null) ||
      channelMsg?.photo?.file_url ||
      // Facebook/Instagram attachments
      channelMsg?.attachment?.payload?.url ||
      (Array.isArray(channelMsg?.attachments) ? channelMsg.attachments[0]?.payload?.url : null) ||
      lastMsgData?.image?.url || lastMsgData?.image?.link ||
      lastMsgData?.document?.url || lastMsgData?.document?.link ||
      lastMsgData?.audio?.url || lastMsgData?.audio?.link ||
      lastMsgData?.video?.url || lastMsgData?.video?.link || '';

    const mediaFilename =
      channelMsg?.document?.filename || channelMsg?.image?.filename ||
      lastMsgData?.document?.filename || lastMsgData?.image?.filename || '';

    const messageId = channelMsg?.id || item?.info?.message?.id || '';
    const title = item?.title || '';
    const direction = (title === 'agent_reply' || title === 'outgoing_message') ? 'outbound' : 'inbound';
    const conversationKey = `${botId}_${contactId}`;

    // Friendly preview for media-only messages shown in the conversation list
    const mediaPreviewText = msgType === 'image' ? '📷 Image' : msgType === 'audio' ? '🎵 Audio' : msgType === 'file' ? '📎 File' : '';
    const effectiveText = messageText || (mediaUrl ? mediaPreviewText : '');

    // Outbound echoes are persisted by bitrix24Handler — skip them here to cut DB load and avoid duplicates.
    if (direction === 'outbound') {
      return Response.json({ success: true, skipped: 'outbound' }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // Early dedup before any writes — avoids spending DB calls on a message we've already stored.
    if (messageId) {
      const existing = await withRetry(() => db.entities.Message.filter({ sendpulse_message_id: messageId }));
      if (existing.length > 0) {
        return Response.json({ success: true, skipped: true }, { headers: { 'Access-Control-Allow-Origin': '*' } });
      }
    }

    let conversations = await withRetry(() => db.entities.Conversation.filter({ sendpulse_conversation_id: conversationKey }));
    let conversation;
    if (conversations.length > 0) {
      conversation = conversations[0];
      await withRetry(() => db.entities.Conversation.update(conversation.id, {
        last_message_text: effectiveText.substring(0, 200),
        last_message_at: new Date().toISOString(),
        unread_count: (conversation.unread_count || 0) + 1,
        contact_name: contactName,
        contact_phone: contactPhone || conversation.contact_phone || '',
      }));
    } else {
      conversation = await withRetry(() => db.entities.Conversation.create({
        open_channel_id: channelCfg.id,
        sendpulse_account_id: channelCfg.sendpulse_account_id,
        bitrix24_account_id: channelCfg.bitrix24_account_id,
        sendpulse_conversation_id: conversationKey,
        sendpulse_bot_id: botId,
        sendpulse_contact_id: contactId,
        contact_name: contactName,
        contact_phone: contactPhone,
        channel,
        status: 'open',
        unread_count: 1,
        last_message_text: effectiveText.substring(0, 200),
        last_message_at: new Date().toISOString(),
      }));
    }

    if (effectiveText || mediaUrl) {
      await withRetry(() => db.entities.Message.create({
        conversation_id: conversation.id,
        sendpulse_message_id: messageId,
        sender_name: contactName,
        message_text: messageText,
        message_type: msgType,
        media_url: mediaUrl || null,
        media_name: mediaFilename || null,
        direction,
        channel,
      }));

      if (bxAccount) {
        await sendToBitrix24(base44, bxAccount, channelCfg, conversation, messageText, messageId, msgType, mediaUrl, mediaFilename, contactPhone);
      }
    }

    return Response.json({ success: true, contact_name: contactName, conversation_id: conversation.id }, { headers: { 'Access-Control-Allow-Origin': '*' } });
  } catch (error) {
    console.error('Webhook error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
  }
});