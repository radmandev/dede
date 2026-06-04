import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { callBitrix, ensureBitrixToken, makeJsonResponse } from '../lib/bitrix24.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const authToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!authToken) return new Response('unauthorized', { status: 401 })

    const { data: userData, error: userErr } = await supabase.auth.getUser(authToken)
    if (userErr || !userData?.user) return new Response('unauthorized', { status: 401 })

    const body = await req.json().catch(() => ({}))
    const { bitrix24_account_id } = body || {}
    if (!bitrix24_account_id) return makeJsonResponse({ error: 'Missing bitrix24_account_id' }, 400)

    const { data: accounts, error: accountErr } = await supabase.from('bitrix24_accounts').select('*').eq('id', bitrix24_account_id).limit(1)
    if (accountErr) throw accountErr
    const account = accounts?.[0]
    if (!account?.domain) return makeJsonResponse({ error: 'Account has no endpoint' }, 400)

    const token = await ensureBitrixToken(supabase, account)
    if (!token) return makeJsonResponse({ error: 'No valid token for this account' }, 400)

    const result = await callBitrix(account.domain, token, 'imopenlines.config.list.get', {})
    const raw = Array.isArray(result?.result) ? result.result : []
    const lines = raw
      .map((line) => ({
        id: String(line.ID || line.id || ''),
        name: line.LINE_NAME || line.NAME || `Line ${line.ID || line.id || '?'}`,
      }))
      .filter((l) => l.id)

    return makeJsonResponse({ lines })
  } catch (error) {
    console.error('bitrix24ListLines error:', error)
    return makeJsonResponse({ error: String(error) }, 500)
  }
})
