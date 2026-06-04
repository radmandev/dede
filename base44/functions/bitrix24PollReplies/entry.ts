import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function callBitrix(endpoint, token, method, params = {}) {
  const base = endpoint.endsWith('/') ? endpoint : endpoint + '/';
  const url = `${base}${method}?auth=${encodeURIComponent(token)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function ensureBitrixToken(base44, account) {
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
  await base44.asServiceRole.entities.Bitrix24Account.update(account.id, {
    access_token: data.access_token,
    refresh_token: data.refresh_token || account.refresh_token,
    token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
  });
  return data.access_token;
}

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

async function forwardToSendPulse(spToken, channel, contactId, cleanText, attachments) {
  const pathMap = { whatsapp: 'whatsapp', telegram: 'telegram', instagram: 'instagram', facebook: 'fb' };
  const path = pathMap[channel] || 'whatsapp';
  const spUrl = channel === 'live_chat' ? 'https://api.sendpulse.com/live-chat/contacts/send' : `https://api.sendpulse.com/${path}/contacts/send`;
  const spHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${spToken}` };

  if (cleanText) {
    const spPayload = channel === 'live_chat'
      ? { contact_id: contactId, messages: [{ type: 'text', text: { text: cleanText } }] }
      : { contact_id: contactId, message: { type: 'text', text: { body: cleanText } } };
    const r = await fetch(spUrl, { method: 'POST', headers: spHeaders, body: JSON.stringify(spPayload) });
    console.log('SendPulse text delivery:', r.status);
  }
  for (const att of attachments) {
    const attType = (att.type || '').toLowerCase();
    const attLink = att.link || '';
    const attName = att.name || 'file';
    if (!attLink) continue;
    let spPayload;
    if (attType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(attName)) {
      spPayload = { contact_id: contactId, message: { type: 'image', image: { link: attLink } } };
    } else if (attType === 'audio' || /\.(mp3|ogg|wav|m4a)$/i.test(attName)) {
      spPayload = { contact_id: contactId, message: { type: 'audio', audio: { link: attLink } } };
    } else {
      spPayload = { contact_id: contactId, message: { type: 'document', document: { link: attLink, filename: attName } } };
    }
    const r = await fetch(spUrl, { method: 'POST', headers: spHeaders, body: JSON.stringify(spPayload) });
    console.log(`SendPulse attach delivery (${attType}):`, r.status);
  }
}

async function pollAccount(base44, account) {
  const token = await ensureBitrixToken(base44, account);
  if (!token) { console.warn('No valid token for account', account.name); return 0; }
  const endpoint = account.domain || '';
  if (!endpoint) return 0;

  // Channels for this account, plus a cache of their SendPulse tokens
  const channels = await base44.asServiceRole.entities.Bitrix24OpenChannel.filter({ bitrix24_account_id: account.id });
  const spTokenCache = {};

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const conversations = await base44.asServiceRole.entities.Conversation.filter({ status: 'open', bitrix24_account_id: account.id });
  const activeConvs = conversations.filter(c => c.bitrix24_chat_id && (!c.last_message_at || c.last_message_at > sevenDaysAgo));
  if (activeConvs.length === 0) return 0;

  let totalNew = 0;
  for (const conv of activeConvs) {
    const chatId = conv.bitrix24_chat_id;
    const msgRes = await callBitrix(endpoint, token, 'im.dialog.messages.get', { DIALOG_ID: `chat${chatId}`, LIMIT: 50 });
    const messages = msgRes?.result?.messages;
    if (!Array.isArray(messages)) continue;

    const isOpenLineChat = messages.some(m => !!(m.params?.CONNECTOR_MID));
    if (!isOpenLineChat) continue;

    // TEMP DEBUG: dump agent (non-connector) messages so we can identify whisper markers
    for (const m of messages) {
      if (!m.params?.CONNECTOR_MID && m.author_id > 0) {
        console.log('B24_DEBUG_MSG', JSON.stringify({ id: m.id, text: m.text, system: m.system, params: m.params }));
      }
    }

    const agentMsgs = messages.filter(m => {
      const isConnectorMsg = !!(m.params?.CONNECTOR_MID);
      const isAgent = !isConnectorMsg && m.author_id > 0;
      // Skip Bitrix24 system notifications and whisper/internal comments (never sent to client)
      const cls = (m.params?.CLASS || '').toLowerCase();
      const isSystem = m.system === 'Y' || /system/.test(cls);
      const isWhisper =
        m.params?.IS_COMMENT === 'Y' ||
        m.params?.COMPONENT_ID === 'bx-messenger-message-comment' ||
        /comment/.test(cls);
      if (isSystem || isWhisper) return false;
      const hasText = !!(m.text && m.text.trim().length > 0);
      const hasFiles =
        (Array.isArray(m.params?.FILE_ID) && m.params.FILE_ID.length > 0) ||
        (m.params?.FILES && Object.keys(m.params.FILES).length > 0) ||
        (Array.isArray(m.attach) && m.attach.length > 0);
      return isAgent && (hasText || hasFiles);
    });

    // im.dialog.messages.get returns newest-first; forward oldest-first to preserve send order
    agentMsgs.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

    const existingMsgs = await base44.asServiceRole.entities.Message.filter({ conversation_id: conv.id }, '-created_date', 200);
    const knownIds = new Set(existingMsgs.map(m => m.sendpulse_message_id).filter(Boolean));

    // Resolve the SendPulse token for this conversation's channel
    let spToken = spTokenCache[conv.open_channel_id];
    if (spToken === undefined) {
      const ch = channels.find(c => c.id === conv.open_channel_id);
      if (ch) {
        const sp = await base44.asServiceRole.entities.SendPulseAccount.filter({ id: ch.sendpulse_account_id });
        spToken = sp[0] ? await ensureSendPulseToken(base44, sp[0]) : null;
      } else { spToken = null; }
      spTokenCache[conv.open_channel_id] = spToken;
    }

    for (const msg of agentMsgs) {
      const bitrixMsgId = String(msg.id);
      if (knownIds.has(`b24_${bitrixMsgId}`)) continue;

      const cleanText = (msg.text || '')
        .replace(/\[b\][^\[]*\[\/b\]/gi, '')
        .replace(/\[br\]/gi, '\n')
        .replace(/\[[^\]]+\]/g, '')
        .trim();

      const fileIdList = Array.isArray(msg.params?.FILE_ID) ? msg.params.FILE_ID : [];
      const filesFromParams = msg.params?.FILES ? Object.values(msg.params.FILES) : [];
      const filesFromAttach = Array.isArray(msg.attach) ? msg.attach : [];

      let attachments = [];
      for (const fileId of fileIdList) {
        const res = await callBitrix(endpoint, token, 'disk.file.get', { id: fileId });
        const f = res?.result;
        if (!f) continue;
        const link = f.DOWNLOAD_URL || f.urlDownload || f.url || '';
        const name = f.NAME || f.name || 'file';
        const mime = (f.MIME_TYPE || f.mimeType || '').toLowerCase();
        const type = mime.startsWith('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(name) ? 'IMAGE'
          : mime.startsWith('audio') || /\.(mp3|ogg|wav|m4a)$/i.test(name) ? 'AUDIO'
          : 'DOCUMENT';
        if (link) attachments.push({ link, name, type });
      }
      for (const f of filesFromParams) {
        const link = f.link || f.LINK || f.urlDownload || f.url || f.urlShow || '';
        const name = f.name || f.NAME || 'file';
        const rawType = (f.type || f.TYPE || '').toUpperCase();
        const mime = (f.mimeType || f.mime || '').toLowerCase();
        const type = rawType || (mime.startsWith('image') ? 'IMAGE' : mime.startsWith('audio') ? 'AUDIO' : 'DOCUMENT');
        if (link) attachments.push({ link, name, type });
      }
      for (const a of filesFromAttach) {
        const link = a.link || a.LINK || a.urlDownload || a.url || '';
        if (link) attachments.push({ link, name: a.name || a.NAME || 'file', type: (a.type || a.TYPE || '').toUpperCase() || 'DOCUMENT' });
      }

      if (!cleanText && attachments.length === 0) continue;

      const originalDate = msg.date ? new Date(msg.date).toISOString() : new Date().toISOString();
      const firstAtt = attachments[0];
      const msgType = firstAtt ? (firstAtt.type === 'IMAGE' ? 'image' : firstAtt.type === 'AUDIO' ? 'audio' : 'file') : 'text';
      await base44.asServiceRole.entities.Message.create({
        conversation_id: conv.id,
        sendpulse_message_id: `b24_${bitrixMsgId}`,
        sender_name: 'Agent',
        message_text: cleanText || (firstAtt ? firstAtt.name : ''),
        direction: 'outbound',
        channel: conv.channel || 'whatsapp',
        message_type: msgType,
        media_url: firstAtt?.link || null,
        media_name: firstAtt?.name || null,
        sent_at: originalDate,
      });
      await base44.asServiceRole.entities.Conversation.update(conv.id, {
        last_message_text: cleanText.substring(0, 200),
        last_message_at: new Date().toISOString(),
      });

      if (spToken && conv.sendpulse_contact_id) {
        await forwardToSendPulse(spToken, conv.channel || 'whatsapp', conv.sendpulse_contact_id, cleanText, attachments);
      }
      totalNew++;
    }
  }
  return totalNew;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const accounts = await base44.asServiceRole.entities.Bitrix24Account.filter({ status: 'connected' });
    if (accounts.length === 0) return Response.json({ checked: 0, newMessages: 0 });

    let totalNew = 0;
    let polled = 0;
    for (const account of accounts) {
      // Per-account concurrency lock — skip if polled within last 90s
      const lastPoll = account._last_poll_at ? new Date(account._last_poll_at) : null;
      if (lastPoll && (Date.now() - lastPoll.getTime()) < 90000) continue;
      await base44.asServiceRole.entities.Bitrix24Account.update(account.id, { _last_poll_at: new Date().toISOString() });
      try {
        totalNew += await pollAccount(base44, account);
        polled++;
      } catch (e) {
        console.error('Error polling account', account.name, ':', e.message);
      }
    }
    return Response.json({ accounts: polled, newMessages: totalNew });
  } catch (error) {
    console.error('Poll error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});