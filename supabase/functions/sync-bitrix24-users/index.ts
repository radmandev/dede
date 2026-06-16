import { handleCors, jsonResponse } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { ensureBitrixToken, callBitrix } from '../lib/bitrix24.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    // Verify caller identity from the Authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401)

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: callerUser } } = await callerClient.auth.getUser()
    if (!callerUser) return jsonResponse({ error: 'Unauthorized' }, 401)

    const body = await req.json().catch(() => ({}))
    const { bitrix24_account_id } = body
    if (!bitrix24_account_id) {
      return jsonResponse({ error: 'Missing bitrix24_account_id' }, 400)
    }

    // Load the account
    const { data: account, error: accErr } = await supabase
      .from('bitrix24_accounts')
      .select('*')
      .eq('id', bitrix24_account_id)
      .single()
    if (accErr || !account) return jsonResponse({ error: 'Account not found' }, 404)

    // Verify caller is an admin of the org that owns this account
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('organization_id, org_role, role')
      .eq('auth_uid', callerUser.id)
      .single()

    const isSuperAdmin = callerProfile?.role === 'admin'
    const isOrgAdmin = callerProfile?.organization_id === account.organization_id
      && callerProfile?.org_role === 'admin'

    if (!isSuperAdmin && !isOrgAdmin) {
      return jsonResponse({ error: 'Admin access required' }, 403)
    }

    // Refresh the B24 access token if needed
    const token = await ensureBitrixToken(supabase, account)
    if (!token) return jsonResponse({ error: 'Could not obtain Bitrix24 token. Reconnect the account.' }, 500)

    // Normalize domain — stored values may be 'host', 'https://host', or 'https://host/rest/'
    let domainRaw = account.domain || ''
    if (!domainRaw.startsWith('http')) domainRaw = `https://${domainRaw}`
    const domainUrl = new URL(domainRaw)
    const restBase = `${domainUrl.protocol}//${domainUrl.host}/rest/`

    // Fetch ALL users from Bitrix24 (paginated, 50 per page)
    // No ACTIVE filter — import everyone so the admin can decide who gets access.
    const allUsers: any[] = []
    let start = 0
    for (let page = 0; page < 100; page++) { // cap at 100 pages (5000 users)
      const res = await callBitrix(restBase, token, 'user.get', { start })
      if (res?.error) {
        console.error('[sync-bitrix24-users] user.get error:', res.error, res.error_description)
        break
      }
      const batch: any[] = res?.result ?? []
      allUsers.push(...batch)
      if (!res?.next || batch.length === 0) break
      start = res.next
    }

    if (allUsers.length === 0) {
      return jsonResponse({ users: [], synced: 0 })
    }

    // Build upsert rows — `permission` and `auth_user_id` are NOT included so
    // the DB INSERT...ON CONFLICT DO UPDATE only touches the profile columns.
    const now = new Date().toISOString()
    const rows = allUsers.map(u => ({
      organization_id: account.organization_id,
      bitrix24_account_id: account.id,
      b24_user_id: parseInt(u.ID, 10),
      name: [u.NAME, u.LAST_NAME].filter(Boolean).join(' ').trim() || u.EMAIL || `User ${u.ID}`,
      email: u.EMAIL || null,
      department: Array.isArray(u.UF_DEPARTMENT) ? (u.UF_DEPARTMENT[0] ?? null) : null,
      title: u.WORK_POSITION || null,
      photo_url: u.PERSONAL_PHOTO || null,
      is_b24_admin: u.IS_ADMIN === 'Y' || u.IS_ADMIN === true,
      is_active: u.ACTIVE === 'Y' || u.ACTIVE === true,
      updated_at: now,
    }))

    // Upsert in batches of 200 to stay within request size limits
    const BATCH = 200
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const { error: upsertErr } = await supabase
        .from('bitrix24_portal_users')
        .upsert(batch, {
          onConflict: 'bitrix24_account_id,b24_user_id',
          ignoreDuplicates: false,
        })
      if (upsertErr) throw upsertErr
    }

    // Return the full updated list
    const { data: fullList, error: listErr } = await supabase
      .from('bitrix24_portal_users')
      .select('*')
      .eq('bitrix24_account_id', bitrix24_account_id)
      .order('name')

    if (listErr) throw listErr

    return jsonResponse({ users: fullList ?? [], synced: rows.length })
  } catch (err: any) {
    console.error('[sync-bitrix24-users]', err)
    return jsonResponse({ error: err.message || 'Internal server error' }, 500)
  }
})
