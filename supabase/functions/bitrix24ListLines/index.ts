import { handleCors, jsonResponse, textResponse } from '../lib/cors.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
import { callBitrix, ensureBitrixToken, makeJsonResponse } from '../lib/bitrix24.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

serve(async (req: Request) => {
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  try {
    if (req.method !== 'POST') return textResponse('method not allowed', 405)

    const authToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!authToken) return textResponse('unauthorized', 401)

    const { data: userData, error: userErr } = await supabase.auth.getUser(authToken)
    if (userErr || !userData?.user) return textResponse('unauthorized', 401)

    const body = await req.json().catch(() => ({}))
    const { bitrix24_account_id } = body || {}
    if (!bitrix24_account_id) return makeJsonResponse({ error: 'Missing bitrix24_account_id' }, 400)

    const { data: accounts, error: accountErr } = await supabase.from('bitrix24_accounts').select('*').eq('id', bitrix24_account_id).limit(1)
    if (accountErr) throw accountErr
    const account = accounts?.[0]
    if (!account?.domain) return makeJsonResponse({ error: 'Account has no endpoint' }, 400)

    const token = await ensureBitrixToken(supabase, account)
    if (!token) return makeJsonResponse({ error: 'No valid token for this account' }, 400)

    // Repair channels that were created before auto-claim set organization_id
    if (account.organization_id) {
      await supabase.from('bitrix24_open_channels')
        .update({ organization_id: account.organization_id, owner_id: account.owner_id || null })
        .eq('bitrix24_account_id', bitrix24_account_id)
        .is('organization_id', null)
    }

    // imopenlines.config.list requires the 'imopenlines' scope.
    // If the app lacks it, fall back to lines already captured in our DB.
    const result = await callBitrix(account.domain, token, 'imopenlines.config.list', {})

    let lines: { id: string; name: string }[] = []

    if (!result?.error) {
      let raw: any[] = []
      if (Array.isArray(result?.result)) {
        raw = result.result
      } else if (Array.isArray(result?.result?.items)) {
        raw = result.result.items
      } else if (Array.isArray(result?.result?.lines)) {
        raw = result.result.lines
      }
      lines = raw
        .map((line: any) => ({
          id: String(line.ID || line.id || ''),
          name: line.LINE_NAME || line.NAME || `Line ${line.ID || line.id || '?'}`,
        }))
        .filter((l) => l.id)
    }

    // Fallback: read lines captured in our DB when CONTACT_CENTER placement fired
    if (lines.length === 0) {
      const { data: dbChannels } = await supabase
        .from('bitrix24_open_channels')
        .select('bitrix24_line_id, name')
        .eq('bitrix24_account_id', bitrix24_account_id)
        .not('bitrix24_line_id', 'is', null)

      lines = (dbChannels || [])
        .filter((ch: any) => ch.bitrix24_line_id)
        .map((ch: any) => ({
          id: String(ch.bitrix24_line_id),
          name: ch.name || `Line ${ch.bitrix24_line_id}`,
        }))
    }

    return makeJsonResponse({ lines })
  } catch (error) {
    console.error('bitrix24ListLines error:', error)
    return makeJsonResponse({ error: String(error) }, 500)
  }
})
