/**
 * Minimal webhook handler scaffold for SendPulse webhooks.
 * Adapt this to your Edge Function runtime (Deno, Node, etc.) and secure with WEBHOOK_SECRET.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

export async function handler(req, res) {
  try {
    const body = req.body || (req._body && req._body.parsed) || await new Promise(r => { let d=''; req.on('data',c=>d+=c); req.on('end', ()=>r(JSON.parse(d))); });

    // optional secret verification
    const incomingSecret = req.headers && (req.headers['x-webhook-secret'] || req.headers['X-Webhook-Secret']);
    if (WEBHOOK_SECRET && incomingSecret !== WEBHOOK_SECRET) {
      res.statusCode = 401; res.end('Invalid webhook secret'); return;
    }

    // store raw payload for debugging/replay
    await supabase.from('webhook_logs').insert([{ provider: 'sendpulse', payload: body, headers: req.headers }]);

    // Basic mapping: if payload contains conversation/message, insert into tables.
    // Customize mapping according to SendPulse webhook payload shape.
    if (body && body.message) {
      // upsert conversation placeholder (user should adapt keys)
      const convRes = await supabase.from('conversations').upsert([{
        sendpulse_conversation_id: body.conversation_id || null,
        contact_name: body.contact_name || null,
        contact_phone: body.contact_phone || null,
        channel: body.channel || null,
      }], { onConflict: ['sendpulse_conversation_id'] });

      const conversation = (convRes.data && convRes.data[0]);

      await supabase.from('messages').insert([{
        conversation_id: conversation ? conversation.id : null,
        sendpulse_message_id: body.message.id || null,
        sender_name: body.message.from || null,
        message_text: body.message.text || null,
        message_type: body.message.type || 'text',
        direction: 'inbound',
        channel: body.channel || null,
        sent_at: body.message.sent_at || null
      }]);
    }

    res.statusCode = 200; res.end('ok');
  } catch (err) {
    console.error('Webhook handler error', err);
    res.statusCode = 500; res.end('error');
  }
}

// For local testing with Node/Express: export default handler
export default handler;
