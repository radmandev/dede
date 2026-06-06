import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { handleCors, corsHeaders } from '../lib/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  try {
    const { token } = await req.json().catch(() => ({}))
    if (!token) return json({ error: 'Missing token' }, 400)

    const { data: invitation } = await supabase
      .from('invitations')
      .select('id, status, expires_at, email, organizations(id, name)')
      .eq('token', token)
      .single()

    if (!invitation) return json({ error: 'Invitation not found' }, 404)
    if (invitation.status !== 'pending') return json({ error: 'This invitation has already been used or expired.' }, 400)
    if (new Date(invitation.expires_at) < new Date()) return json({ error: 'This invitation has expired.' }, 400)

    return json({ organization: invitation.organizations, email: invitation.email })
  } catch (error) {
    console.error('getInvitationInfo error:', error)
    return json({ error: String(error) }, 500)
  }
})
