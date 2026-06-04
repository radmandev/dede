import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return new Response('unauthorized', { status: 401 })

    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user) return new Response('unauthorized', { status: 401 })
    const uid = userData.user.id

    const { data: profile } = await supabase.from('profiles').select('role').eq('auth_uid', uid).limit(1).single()
    if (!profile || profile.role !== 'admin') return new Response('forbidden', { status: 403 })

    const body = await req.json().catch(() => ({}))
    const { action, id } = body || {}
    if (!action || !id) return new Response('bad request', { status: 400 })

    if (action === 'delete') {
      await supabase.from('delivery_queue').delete().eq('id', id)
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (action === 'retry') {
      await supabase.from('delivery_queue').update({ attempts: 0, next_attempt_at: new Date().toISOString() }).eq('id', id)
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    return new Response('unknown action', { status: 400 })
  } catch (err) {
    console.error('adminManageDelivery error', err)
    return new Response('error', { status: 500 })
  }
})
