import { serve } from 'std/server'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

serve(async (req: Request) => {
  try {
    const token = req.headers.get('authorization')?.replace('Bearer ', '')
    if (!token) return new Response('unauthorized', { status: 401 })

    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user) return new Response('unauthorized', { status: 401 })
    const uid = userData.user.id

    const { data: profile } = await supabase.from('profiles').select('role').eq('auth_uid', uid).limit(1).single()
    if (!profile || profile.role !== 'admin') return new Response('forbidden', { status: 403 })

    const q = await supabase.from('delivery_queue').select('*').order('created_at', { ascending: false }).limit(200)
    const e = await supabase.from('delivery_errors').select('*').order('created_at', { ascending: false }).limit(200)

    return new Response(JSON.stringify({ queue: q.data || [], errors: e.data || [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  } catch (err) {
    console.error('adminGetDelivery error', err)
    return new Response('error', { status: 500 })
  }
})
