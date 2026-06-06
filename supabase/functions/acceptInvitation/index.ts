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
    // Require auth
    const authToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!authToken) return json({ error: 'Unauthorized' }, 401)

    const { data: userData, error: userErr } = await supabase.auth.getUser(authToken)
    if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)
    const authUser = userData.user

    const { token } = await req.json().catch(() => ({}))
    if (!token) return json({ error: 'Missing token' }, 400)

    // Look up invitation
    const { data: invitation } = await supabase
      .from('invitations')
      .select('id, status, expires_at, email, organization_id, organizations(id, name)')
      .eq('token', token)
      .single()

    if (!invitation) return json({ error: 'Invitation not found' }, 404)
    if (invitation.status !== 'pending') return json({ error: 'This invitation has already been used.' }, 400)
    if (new Date(invitation.expires_at) < new Date()) return json({ error: 'This invitation has expired.' }, 400)

    // Get or create profile for this user
    let { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('auth_uid', authUser.id)
      .single()

    if (!profile) {
      const { data: newProfile } = await supabase
        .from('profiles')
        .insert([{ auth_uid: authUser.id, role: 'user', display_name: authUser.email }])
        .select('id')
        .single()
      profile = newProfile
    }

    if (!profile?.id) return json({ error: 'Failed to resolve user profile' }, 500)

    // Check if already a member
    const { data: existing } = await supabase
      .from('organization_members')
      .select('id')
      .eq('organization_id', invitation.organization_id)
      .eq('profile_id', profile.id)
      .single()

    if (!existing) {
      const { error: memberErr } = await supabase
        .from('organization_members')
        .insert([{
          organization_id: invitation.organization_id,
          profile_id: profile.id,
          role: 'member',
        }])
      if (memberErr) {
        console.error('member insert error:', memberErr)
        return json({ error: 'Failed to join organization' }, 500)
      }
    }

    // Denormalize org onto profile so RLS helpers work without recursion
    await supabase
      .from('profiles')
      .update({ organization_id: invitation.organization_id, org_role: 'member' })
      .eq('id', profile.id)

    // Mark invitation as accepted
    await supabase
      .from('invitations')
      .update({ status: 'accepted' })
      .eq('id', invitation.id)

    return json({ success: true, organization: invitation.organizations })
  } catch (error) {
    console.error('acceptInvitation error:', error)
    return json({ error: String(error) }, 500)
  }
})
