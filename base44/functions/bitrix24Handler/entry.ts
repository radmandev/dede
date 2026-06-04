import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Retry a DB call when Base44 returns a transient 429 rate-limit, so replies aren't dropped.
async function withRetry(fn, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      const is429 = /429|rate limit/i.test(e?.message || '') || e?.response?.status === 429;
      if (!is429 || i === attempts - 1) { lastErr = e; break; }
      await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

function parseNestedForm(bodyText) {
  const flat = Object.fromEntries(new URLSearchParams(bodyText));
  const result = {};
  for (const [key, val] of Object.entries(flat)) {
    const parts = key.replace(/\]/g, '').split('[');
    let cur = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }
  return result;
}

async function callBitrix(endpoint, token, method, params = {}) {
  const base = endpoint.endsWith('/') ? endpoint : endpoint + '/';
  const url = `${base}${method}?auth=${encodeURIComponent(token)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function resolveFileAttachments(endpoint, token, fileIds) {
  const result = [];
  for (const fileId of fileIds) {
    const res = await callBitrix(endpoint, token, 'disk.file.get', { id: fileId });
    const f = res?.result;
    if (!f) continue;
    const link = f.DOWNLOAD_URL || f.urlDownload || f.url || '';
    const name = f.NAME || f.name || 'file';
    const mime = (f.MIME_TYPE || f.mimeType || '').toLowerCase();
    const type = mime.startsWith('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(name) ? 'IMAGE'
      : mime.startsWith('audio') || /\.(mp3|ogg|wav|m4a)$/i.test(name) ? 'AUDIO'
      : mime.startsWith('video') ? 'VIDEO'
      : 'DOCUMENT';
    result.push({ link, name, type, id: fileId });
  }
  return result;
}

async function refreshSendPulseToken(base44, spAccount) {
  const tokenRes = await fetch('https://api.sendpulse.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: spAccount.client_id, client_secret: spAccount.client_secret }),
  });
  const tokenData = await tokenRes.json();
  if (tokenData.access_token) {
    await base44.asServiceRole.entities.SendPulseAccount.update(spAccount.id, {
      access_token: tokenData.access_token,
      token_expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
    });
    return tokenData.access_token;
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const bodyText = await req.text();

    let data;
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json') || bodyText.trim().startsWith('{')) data = JSON.parse(bodyText);
    else data = parseNestedForm(bodyText);

    const event = data.event;
    const accessToken = data.AUTH_ID || data.auth?.access_token;
    const serverEndpoint = data.SERVER_ENDPOINT || data.auth?.server_endpoint || '';
    const expiresIn = parseInt(data.AUTH_EXPIRES || data.auth?.expires_in || '3600', 10);
    const memberId = data.auth?.member_id || data.member_id || '';
    const lineId = data.data?.LINE || data.LINE;

    console.log('bitrix24Handler — event:', event, '| line:', lineId, '| member:', memberId);

    // ROUTING: find the Bitrix24 account (prefer member_id) and the open channel (by line)
    let bxAccount = null;
    if (memberId) {
      const byMember = await base44.asServiceRole.entities.Bitrix24Account.filter({ member_id: memberId });
      bxAccount = byMember[0] || null;
    }

    // Keep this account's token fresh (Bitrix24 sends a new token on each call)
    if (bxAccount && accessToken) {
      const updates = { access_token: accessToken, token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString() };
      if (serverEndpoint) updates.domain = serverEndpoint;
      await base44.asServiceRole.entities.Bitrix24Account.update(bxAccount.id, updates);
      bxAccount = { ...bxAccount, ...updates };
    }

    if (event === 'ONIMCONNECTORMESSAGEADD') {
      const messages = data.data?.MESSAGES;
      if (!messages) return new Response('OK', { status: 200 });

      // Resolve the open channel by line id (scoped to this account if known)
      let channelCfg = null;
      if (lineId) {
        const chans = await base44.asServiceRole.entities.Bitrix24OpenChannel.filter({ bitrix24_line_id: String(lineId) });
        channelCfg = bxAccount ? (chans.find(c => c.bitrix24_account_id === bxAccount.id) || chans[0]) : chans[0];
      }

      const b24Endpoint = serverEndpoint || bxAccount?.domain || '';
      const b24Token = accessToken || bxAccount?.access_token || '';

      // SendPulse account from the channel
      let spAccount = null;
      if (channelCfg?.sendpulse_account_id) {
        const sp = await base44.asServiceRole.entities.SendPulseAccount.filter({ id: channelCfg.sendpulse_account_id });
        spAccount = sp[0] || null;
      }

      const msgList = Object.values(messages);
      for (const msg of msgList) {
        const chatId = msg.im?.chat_id;
        const rawText = msg.message?.text || '';
        const imgMatches = [...rawText.matchAll(/\[IMG\](https?:\/\/[^\[]+)\[\/IMG\]/gi)];
        const bbCodeImages = imgMatches.map(m => ({ link: m[1].trim(), name: 'image.jpg', type: 'IMAGE' }));
        const messageText = rawText
          .replace(/\[IMG\][^\[]*\[\/IMG\]/gi, '')
          .replace(/\[b\][^\[]*\[\/b\]/gi, '')
          .replace(/\[br\]/gi, '\n')
          .trim();
        const fileIdList = Array.isArray(msg.message?.params?.FILE_ID)
          ? msg.message.params.FILE_ID
          : (msg.message?.params?.FILE_ID ? [msg.message.params.FILE_ID] : []);
        const filesFromParams = msg.message?.params?.FILES ? Object.values(msg.message.params.FILES) : [];
        const filesFromAttach = Array.isArray(msg.message?.attach) ? msg.message.attach : [];

        const hasContent = messageText || fileIdList.length > 0 || filesFromParams.length > 0 || filesFromAttach.length > 0 || bbCodeImages.length > 0;
        if (!chatId || !hasContent) continue;

        // Shared dedup key so the backup poller (bitrix24PollReplies) won't re-forward this same message
        const bitrixMsgId = String(msg.im?.message_id || msg.message?.id || '');
        const dedupId = bitrixMsgId ? `b24_${bitrixMsgId}` : '';
        if (dedupId) {
          const dupe = await withRetry(() => base44.asServiceRole.entities.Message.filter({ sendpulse_message_id: dedupId }));
          if (dupe.length > 0) continue;
        }

        // Find conversation, scoped to the channel when known
        let convs = await withRetry(() => base44.asServiceRole.entities.Conversation.filter({ bitrix24_chat_id: Number(chatId) }));
        if (convs.length === 0) {
          const origChatId = msg.chat?.id;
          if (origChatId) convs = await withRetry(() => base44.asServiceRole.entities.Conversation.filter({ sendpulse_contact_id: origChatId }));
        }
        if (convs.length === 0) { console.warn('No conversation for chatId:', chatId); continue; }
        const conv = convs[0];

        // Resolve attachments
        let resolvedFiles = [];
        if (fileIdList.length > 0 && b24Endpoint && b24Token) {
          resolvedFiles = await resolveFileAttachments(b24Endpoint, b24Token, fileIdList);
        }
        for (const f of filesFromParams) {
          const link = f.link || f.LINK || f.urlDownload || f.url || '';
          if (link) resolvedFiles.push({ link, name: f.name || f.NAME || 'file', type: (f.type || f.TYPE || '').toUpperCase() });
        }
        resolvedFiles.push(...bbCodeImages);
        const attachments = resolvedFiles;

        const firstAtt = attachments[0];
        const savedText = messageText || (firstAtt ? firstAtt.name : '');
        const msgType = firstAtt ? (firstAtt.type === 'IMAGE' ? 'image' : firstAtt.type === 'AUDIO' ? 'audio' : 'file') : 'text';
        await withRetry(() => base44.asServiceRole.entities.Message.create({
          conversation_id: conv.id,
          sendpulse_message_id: dedupId || null,
          sender_name: 'Agent',
          message_text: savedText,
          message_type: msgType,
          media_url: firstAtt?.link || null,
          media_name: firstAtt?.name || null,
          direction: 'outbound',
          channel: conv.channel || 'whatsapp',
          sent_at: new Date().toISOString(),
        }));
        await withRetry(() => base44.asServiceRole.entities.Conversation.update(conv.id, {
          last_message_text: messageText || (firstAtt ? `[${msgType}]` : ''),
          last_message_at: new Date().toISOString(),
        }));

        // Deliver via the channel's SendPulse account
        const account = spAccount;
        if (account && conv.sendpulse_contact_id) {
          let token = account.access_token;
          const spExpires = account.token_expires_at ? new Date(account.token_expires_at) : null;
          if (!token || !spExpires || spExpires < new Date()) {
            token = await refreshSendPulseToken(base44, account);
          }
          if (token) {
            const ch = conv.channel || 'whatsapp';
            const pathMap = { whatsapp: 'whatsapp', telegram: 'telegram', instagram: 'instagram', facebook: 'fb' };
            const path = pathMap[ch] || 'whatsapp';
            const spBaseUrl = ch === 'live_chat' ? 'https://api.sendpulse.com/live-chat/contacts/send' : `https://api.sendpulse.com/${path}/contacts/send`;
            const spHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

            if (messageText) {
              const spPayload = ch === 'live_chat'
                ? { contact_id: conv.sendpulse_contact_id, messages: [{ type: 'text', text: { text: messageText } }] }
                : { contact_id: conv.sendpulse_contact_id, message: { type: 'text', text: { body: messageText } } };
              const spRes = await fetch(spBaseUrl, { method: 'POST', headers: spHeaders, body: JSON.stringify(spPayload) });
              console.log('SendPulse text delivery:', spRes.status);
            }

            for (const att of attachments) {
              const attType = (att.type || att.TYPE || '').toLowerCase();
              const attLink = att.link || att.LINK || att.urlDownload || att.url || '';
              const attName = att.name || att.NAME || 'file';
              if (!attLink) continue;
              let spPayload;
              if (attType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(attName)) {
                spPayload = { contact_id: conv.sendpulse_contact_id, message: { type: 'image', image: { link: attLink } } };
              } else if (attType === 'audio' || /\.(mp3|ogg|wav|m4a)$/i.test(attName)) {
                spPayload = { contact_id: conv.sendpulse_contact_id, message: { type: 'audio', audio: { link: attLink } } };
              } else {
                spPayload = { contact_id: conv.sendpulse_contact_id, message: { type: 'document', document: { link: attLink, filename: attName } } };
              }
              const spRes = await fetch(spBaseUrl, { method: 'POST', headers: spHeaders, body: JSON.stringify(spPayload) });
              console.log(`SendPulse attach delivery (${attType}):`, spRes.status);
            }
          }
        }
      }
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Handler error:', error.message, error.stack);
    return new Response('OK', { status: 200 });
  }
});