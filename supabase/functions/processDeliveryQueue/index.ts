import { corsHeaders, handleCors } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { performSendPulseDelivery, recordDeliveryError } from '../lib/sendpulse.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

function nextAttemptDate(attempts: number) {
  const seconds = Math.pow(2, attempts) * 30
  return new Date(Date.now() + seconds * 1000).toISOString()
}

serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  try {
    // Fetch due items — compare attempts < max_attempts in JS since PostgREST
    // can't compare two columns directly with the client filter API
    const { data: items, error } = await supabase
      .from('delivery_queue')
      .select('*')
      .lte('next_attempt_at', new Date().toISOString())
      .limit(20)

    if (error) throw error

    const eligible = (items || []).filter(it => (it.attempts || 0) < (it.max_attempts || 5))

    let processed = 0
    for (const it of eligible) {
      try {
        const payload = it.payload || {}
        await performSendPulseDelivery(supabase, it.sendpulse_account_id, it.channel, it.contact_id, payload.text, payload.attachments)
        await supabase.from('delivery_queue').delete().eq('id', it.id)
        processed++
      } catch (e) {
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
