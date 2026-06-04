import { serve } from 'std/server'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { performSendPulseDelivery, recordDeliveryError } from '../lib/sendpulse.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// simple exponential backoff helper
function nextAttemptDate(attempts) {
  const base = 30 // seconds
  const seconds = Math.pow(2, attempts) * base
  return new Date(Date.now() + seconds * 1000).toISOString()
}

serve(async (req: Request) => {
  try {
    // pick a small batch to process
    const { data: items, error } = await supabase.from('delivery_queue').select('*').lte('next_attempt_at', new Date().toISOString()).lt('attempts', 'max_attempts').limit(20)
    if (error) throw error
    let processed = 0
    for (const it of items || []) {
      try {
        const payload = it.payload || {}
        await performSendPulseDelivery(supabase, it.sendpulse_account_id, it.channel, it.contact_id, payload.text, payload.attachments)
        // remove from queue on success
        await supabase.from('delivery_queue').delete().eq('id', it.id)
        processed++
      } catch (e) {
        // increment attempts, schedule next_attempt_at, log error
        const attempts = (it.attempts || 0) + 1
        const nextAt = nextAttemptDate(attempts)
        await supabase.from('delivery_queue').update({ attempts, next_attempt_at: nextAt, last_error: String(e), updated_at: new Date().toISOString() }).eq('id', it.id)
        await recordDeliveryError(supabase, it.id, { error_text: String(e), response_body: null, sendpulse_account_id: it.sendpulse_account_id, conversation_id: it.conversation_id, message_id: it.message_id, contact_id: it.contact_id, channel: it.channel })
      }
    }
    return new Response(JSON.stringify({ ok: true, processed }), { status: 200 })
  } catch (err) {
    console.error('processDeliveryQueue error', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500 })
  }
})
