import { handleCors, jsonResponse } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { callBitrix } from '../lib/bitrix24.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Set B24_WIDGET_SECRET in Supabase project secrets. Used to derive per-user passwords.
const WIDGET_SECRET = Deno.env.get('B24_WIDGET_SECRET') || 'change-me-in-supabase-secrets'

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// Derive a deterministic password for a virtual Supabase user.
// Only computable server-side (WIDGET_SECRET is never exposed to clients).
async function derivePassword(b24UserId: number, accountId: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(WIDGET_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${b24UserId}:${accountId}`))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function sanitizeDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
}

serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { b24_auth_token, b24_domain } = await req.json().catch(() => ({}))
    if (!b24_auth_token || !b24_domain) {
      return jsonResponse({ error: 'Missing b24_auth_token or b24_domain' }, 400)
    }

    const cleanDomain = sanitizeDomain(b24_domain)

    // 1. Verify the B24 auth token by calling user.current from the server side.
    //    This proves the request genuinely comes from that Bitrix24 portal.
    const endpoint = `https://${cleanDomain}/rest/`
    const b24Result = await callBitrix(endpoint, b24_auth_token, 'user.current')
    const b24User = b24Result?.result
    if (!b24User?.ID) {
      return jsonResponse({ error: 'Invalid Bitrix24 auth token', unauthorized: true }, 401)
    }
    const b24UserId = parseInt(b24User.ID, 10)

    // 2. Find the Bitrix24 account by domain
    const { data: account } = await supabase
      .from('bitrix24_accounts')
      .select('id, organization_id')
      .or(`domain.ilike.%${cleanDomain}%,domain.ilike.%${b24_domain}%`)
      .maybeSingle()

    if (!account) {
      return jsonResponse({
        error: 'This Bitrix24 portal is not registered in the system. Contact your administrator.',
        unauthorized: true,
      }, 403)
    }

    // 3. Find this user's portal record and check permission
    const { data: portalUser } = await supabase
      .from('bitrix24_portal_users')
      .select('*')
      .eq('bitrix24_account_id', account.id)
      .eq('b24_user_id', b24UserId)
      .maybeSingle()

    if (!portalUser || portalUser.permission !== 'active') {
      return jsonResponse({
        error: 'You do not have access to this application. Contact your administrator.',
        unauthorized: true,
      }, 403)
    }

    // 4. Provision or sign in the virtual Supabase user for this B24 user
    const virtualEmail = `b24_${b24UserId}@${cleanDomain}`
    const password = await derivePassword(b24UserId, account.id)

    // Try to create the user (safe to call even if they already exist)
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: virtualEmail,
      password,
      email_confirm: true,
    })

    if (created?.user?.id) {
      // Newly created — set up their profile with the correct org
      await supabase.from('profiles').upsert({
        auth_uid: created.user.id,
        display_name: portalUser.name || b24User.NAME || virtualEmail,
        role: 'user',
        organization_id: account.organization_id,
        org_role: 'member',
      }, { onConflict: 'auth_uid' })

      await supabase.from('bitrix24_portal_users')
        .update({ auth_user_id: created.user.id, updated_at: new Date().toISOString() })
        .eq('id', portalUser.id)
    } else if (createErr && !createErr.message?.toLowerCase().includes('already registered')) {
      console.error('[bitrix24-widget-auth] createUser error:', createErr)
      return jsonResponse({ error: 'Failed to provision user account' }, 500)
    }

    // 5. Sign in as the virtual user
    const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
      email: virtualEmail,
      password,
    })

    if (signInErr || !signIn?.session) {
      console.error('[bitrix24-widget-auth] signIn error:', signInErr)
      return jsonResponse({ error: 'Sign-in failed. Try again.' }, 500)
    }

    // Persist auth_user_id if it wasn't stored yet
    if (!portalUser.auth_user_id && signIn.user?.id) {
      await supabase.from('bitrix24_portal_users')
        .update({ auth_user_id: signIn.user.id, updated_at: new Date().toISOString() })
        .eq('id', portalUser.id)

      // Ensure profile exists for this user (idempotent)
      await supabase.from('profiles').upsert({
        auth_uid: signIn.user.id,
        display_name: portalUser.name || virtualEmail,
        role: 'user',
        organization_id: account.organization_id,
        org_role: 'member',
      }, { onConflict: 'auth_uid' })
    }

    // 6. Update last seen timestamp
    await supabase.from('bitrix24_portal_users')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', portalUser.id)

    return jsonResponse({ session: signIn.session })
  } catch (err: any) {
    console.error('[bitrix24-widget-auth] unexpected error:', err)
    return jsonResponse({ error: err.message || 'Internal server error' }, 500)
  }
})
