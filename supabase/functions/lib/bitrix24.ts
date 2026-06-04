export const BITRIX_TOKEN_ENDPOINT = 'https://oauth.bitrix.info/oauth/token/'

export function normalizeConfigRow(row: any) {
  if (!row) return {}
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  return { ...data, ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'data')) }
}

export async function loadFirstGlobalConfig(supabase: any) {
  const { data, error } = await supabase.from('global_config').select('*').limit(1).maybeSingle()
  if (error) throw error
  return normalizeConfigRow(data)
}

export async function callBitrix(endpoint: string, token: string, method: string, params: any = {}) {
  const base = endpoint.endsWith('/') ? endpoint : endpoint + '/'
  const url = `${base}${method}?auth=${encodeURIComponent(token)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { raw: text } }
}

export async function refreshBitrixToken(supabase: any, account: any) {
  if (!account?.app_client_id || !account?.app_client_secret || !account?.refresh_token) return null
  const res = await fetch(BITRIX_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: account.app_client_id,
      client_secret: account.app_client_secret,
      refresh_token: account.refresh_token,
    }),
  })
  const data = await res.json().catch(() => null)
  if (!data?.access_token) return null
  const newToken = data.access_token
  const refreshToken = data.refresh_token || account.refresh_token
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  await supabase.from('bitrix24_accounts').update({ access_token: newToken, refresh_token: refreshToken, token_expires_at: expiresAt }).eq('id', account.id)
  return newToken
}

export async function ensureBitrixToken(supabase: any, account: any) {
  if (!account) return null
  const token = account.access_token
  const expires = account.token_expires_at ? new Date(account.token_expires_at) : null
  if (token && expires && expires > new Date(Date.now() + 60000)) return token
  return await refreshBitrixToken(supabase, account)
}

export function parseNestedForm(bodyText: string) {
  const flat = Object.fromEntries(new URLSearchParams(bodyText))
  const result: any = {}
  for (const [key, val] of Object.entries(flat)) {
    const parts = key.replace(/\]/g, '').split('[')
    let cur: any = result
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {}
      cur = cur[parts[i]]
    }
    cur[parts[parts.length - 1]] = val
  }
  return result
}

export function makeJsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
