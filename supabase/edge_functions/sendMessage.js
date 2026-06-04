/**
 * Minimal sendMessage Edge Function scaffold.
 * Expects POST { conversation_id?, text, attachments?, sendpulse_account_id?, sendpulse_bot_id? }
 * This function persists the outbound message row and should call SendPulse API to actually deliver.
 * Use SUPABASE_SERVICE_ROLE_KEY for DB operations.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

export async function handler(req, res) {
  try {
    const body = req.body || (req._body && req._body.parsed) || await new Promise(r => { let d=''; req.on('data',c=>d+=c); req.on('end', ()=>r(JSON.parse(d))); });

    const { conversation_id, text, sendpulse_account_id, sendpulse_bot_id, attachments } = body;

    // Persist outbound message
    const { data: msg, error } = await supabase.from('messages').insert([{
      conversation_id: conversation_id || null,
      message_text: text || null,
      message_type: attachments && attachments.length ? 'file' : 'text',
      direction: 'outbound',
      channel: null,
    }]).select().single();

    if (error) throw error;

    // TODO: call SendPulse API using stored credentials for sendpulse_account_id
    // Example: fetch SendPulse endpoint with client credentials and deliver message.

    res.statusCode = 200; res.end(JSON.stringify({ ok: true, message: msg }));
  } catch (err) {
    console.error('sendMessage handler error', err);
    res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(err) }));
  }
}

export default handler;
