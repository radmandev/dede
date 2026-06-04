import { serve } from 'std/server'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { callBitrix, ensureBitrixToken, makeJsonResponse } from '../lib/bitrix24.ts'
import { performSendPulseDelivery } from '../lib/sendpulse.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

function normalizeText(text) {
  return (text || '')
    .replace(/\[b\][^\[]*\[\/b\]/gi, '')
    .replace(/\[br\]/gi, '\n')
    .replace(/\[[^\]]+\]/g, '')
    .trim()
}

function mapAttachmentType(att, name) {
  const rawType = (att.type || att.TYPE || '').toString().toLowerCase()
  const mime = (att.mimeType || att.mime || '').toString().toLowerCase()
  const filename = name || att.name || att.NAME || 'file'
  if (rawType === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(filename)) return 'IMAGE'
  if (rawType === 'audio' || /\.(mp3|ogg|wav|m4a)$/i.test(filename)) return 'AUDIO'
  return 'DOCUMENT'
}

async function resolveFileAttachments(endpoint, token, fileIds) {
  const result = []
  for (const fileId of fileIds) {
    const res = await callBitrix(endpoint, token, 'disk.file.get', { id: fileId })
    const f = res?.result
    if (!f) continue
    const link = f.DOWNLOAD_URL || f.urlDownload || f.url || ''
    if (!link) continue
    const name = f.NAME || f.name || 'file'
    const mime = (f.MIME_TYPE || f.mimeType || '').toString().toLowerCase()
    const type = mime.startsWith('image') || /\.(jpg|jpeg|png|gif|webp)$/i.test(name)
      ? 'IMAGE'
      : mime.startsWith('audio') || /\.(mp3|ogg|wav|m4a)$/i.test(name)
      ? 'AUDIO'
      : 'DOCUMENT'
    result.push({ link, name, type })
  }
  return result
}

async function pollAccount(account) {
  const token = await ensureBitrixToken(supabase, account)
  if (!token) {
    console.warn('No valid token for account', account.name)
    return 0
  }
  const endpoint = account.domain || ''
  if (!endpoint) return 0

  const { data: channels = [], error: channelErr } = await supabase.from('bitrix24_open_channels').select('*').eq('bitrix24_account_id', account.id)
  if (channelErr) throw channelErr

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const { data: conversations = [], error: convErr } = await supabase.from('conversations').select('*').eq('status', 'open').eq('bitrix24_account_id', account.id)
  if (convErr) throw convErr

  const activeConvs = conversations.filter((conv) => conv.bitrix24_chat_id && (!conv.last_message_at || new Date(conv.last_message_at) > sevenDaysAgo))
  if (activeConvs.length === 0) return 0

  let totalNew = 0
  for (const conv of activeConvs) {
    const chatId = conv.bitrix24_chat_id
    const msgRes = await callBitrix(endpoint, token, 'im.dialog.messages.get', { DIALOG_ID: `chat${chatId}`, LIMIT: 50 })
    const messages = msgRes?.result?.messages
    if (!Array.isArray(messages)) continue

    const isOpenLineChat = messages.some((m) => !!(m.params?.CONNECTOR_MID))
    if (!isOpenLineChat) continue

    const agentMsgs = messages.filter((m) => {
      const isConnectorMsg = !!(m.params?.CONNECTOR_MID)
      const isAgent = !isConnectorMsg && m.author_id > 0
      const cls = (m.params?.CLASS || '').toString().toLowerCase()
      const isSystem = m.system === 'Y' || /system/.test(cls)
      const isWhisper = m.params?.IS_COMMENT === 'Y' || m.params?.COMPONENT_ID === 'bx-messenger-message-comment' || /comment/.test(cls)
      const hasText = !!(m.text && m.text.trim().length > 0)
      const hasFiles = (Array.isArray(m.params?.FILE_ID) && m.params.FILE_ID.length > 0) || (m.params?.FILES && Object.keys(m.params.FILES).length > 0) || (Array.isArray(m.attach) && m.attach.length > 0)
      return isAgent && !isSystem && !isWhisper && (hasText || hasFiles)
    })

    agentMsgs.sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())

    const { data: existingMsgs = [], error: existingErr } = await supabase.from('messages').select('sendpulse_message_id').eq('conversation_id', conv.id).limit(200)
    if (existingErr) throw existingErr
    const knownIds = new Set(existingMsgs.map((m) => m.sendpulse_message_id).filter(Boolean))

    let spToken = null
    let spAccount = null
    let openChannel = channels.find((c) => c.id === conv.open_channel_id)
    if (openChannel?.sendpulse_account_id) {
      const { data: spAccounts = [], error: spAccountErr } = await supabase.from('sendpulse_accounts').select('*').eq('id', openChannel.sendpulse_account_id).limit(1)
      if (spAccountErr) throw spAccountErr
      spAccount = spAccounts?.[0] || null
    }

    for (const msg of agentMsgs) {
      const bitrixMsgId = String(msg.id)
      const dedupId = bitrixMsgId ? `b24_${bitrixMsgId}` : ''
      if (dedupId && knownIds.has(dedupId)) continue

      const cleanText = normalizeText(msg.text || '')
      const fileIdList = Array.isArray(msg.params?.FILE_ID) ? msg.params?.FILE_ID : (msg.params?.FILE_ID ? [msg.params.FILE_ID] : [])
      const filesFromParams = msg.params?.FILES ? Object.values(msg.params?.FILES) : []
      const filesFromAttach = Array.isArray(msg.attach) ? msg.attach : []

      let attachments = []
      if (fileIdList.length && endpoint && token) {
        attachments = attachments.concat(await resolveFileAttachments(endpoint, token, fileIdList))
      }
      for (const f of filesFromParams) {
        const link = f.link || f.LINK || f.urlDownload || f.url || ''
        if (link) attachments.push({ link, name: f.name || f.NAME || 'file', type: mapAttachmentType(f, f.name || f.NAME || 'file') })
      }
      for (const a of filesFromAttach) {
        const link = a.link || a.LINK || a.urlDownload || a.url || ''
        if (link) attachments.push({ link, name: a.name || a.NAME || 'file', type: mapAttachmentType(a, a.name || a.NAME || 'file') })
      }

      if (!cleanText && attachments.length === 0) continue

      const originalDate = msg.date ? new Date(msg.date).toISOString() : new Date().toISOString()
      const firstAtt = attachments[0]
      const msgType = firstAtt ? (firstAtt.type === 'IMAGE' ? 'image' : firstAtt.type === 'AUDIO' ? 'audio' : 'file') : 'text'

      await supabase.from('messages').insert([{
        conversation_id: conv.id,
        sendpulse_message_id: dedupId || null,
        sender_name: 'Agent',
        message_text: cleanText || (firstAtt ? firstAtt.name : ''),
        message_type: msgType,
        media_url: firstAtt?.link || null,
        media_name: firstAtt?.name || null,
        direction: 'outbound',
        channel: conv.channel || 'whatsapp',
        sent_at: originalDate,
      }])

      await supabase.from('conversations').update({ last_message_text: (cleanText || '').substring(0, 200), last_message_at: new Date().toISOString() }).eq('id', conv.id)

      if (spAccount && conv.sendpulse_contact_id) {
        try {
          await performSendPulseDelivery(supabase, spAccount.id, conv.channel || 'whatsapp', conv.sendpulse_contact_id, cleanText, attachments)
        } catch (err) {
          console.error('Forward to SendPulse failed:', err)
        }
      }
      totalNew++
    }
  }

  return totalNew
}

serve(async (req: Request) => {
  try {
    const authToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!authToken) return new Response('unauthorized', { status: 401 })

    const { data: userData, error: userErr } = await supabase.auth.getUser(authToken)
    if (userErr || !userData?.user) return new Response('unauthorized', { status: 401 })

    const { data: accounts = [], error: accountsErr } = await supabase.from('bitrix24_accounts').select('*').eq('status', 'connected')
    if (accountsErr) throw accountsErr

    let totalNew = 0
    let polled = 0

    for (const account of accounts) {
      const lastPoll = account._last_poll_at ? new Date(account._last_poll_at) : null
      if (lastPoll && Date.now() - lastPoll.getTime() < 90000) continue
      await supabase.from('bitrix24_accounts').update({ _last_poll_at: new Date().toISOString() }).eq('id', account.id)
      try {
        totalNew += await pollAccount(account)
        polled++
      } catch (err) {
        console.error('Error polling account', account.name, err)
      }
    }

    return makeJsonResponse({ accounts: polled, newMessages: totalNew })
  } catch (error) {
    console.error('bitrix24PollReplies error:', error)
    return makeJsonResponse({ error: String(error) }, 500)
  }
})
