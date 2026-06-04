import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

export async function uploadRemoteAttachment(supabase: any, url: string, opts: any = {}) {
  const bucket = opts.bucket || 'attachments'
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    const arrayBuffer = await res.arrayBuffer()
    const data = new Uint8Array(arrayBuffer)

    // try to extract filename from URL
    let filename = opts.filename || null
    try {
      const u = new URL(url)
      filename = filename || (u.pathname.split('/').pop() || `file_${Date.now()}`)
    } catch (e) {
      filename = filename || `file_${Date.now()}`
    }

    const path = `attachments/${Date.now()}_${filename}`

    // upload to Supabase Storage (service role client expected)
    const uploadRes = await supabase.storage.from(bucket).upload(path, data, { upsert: false })
    if (uploadRes.error) throw uploadRes.error

    const publicUrl = supabase.storage.from(bucket).getPublicUrl(path).data?.publicUrl || null

    // insert metadata row
    const { data: attRow, error: attErr } = await supabase.from('attachments').insert([{ storage_path: path, url: publicUrl, filename, content_type: res.headers.get('content-type') || null, size: Number(res.headers.get('content-length') || data.length), uploaded_at: new Date().toISOString() }]).select().limit(1).single()
    if (attErr) throw attErr
    return attRow
  } catch (err) {
    console.error('uploadRemoteAttachment error', err)
    throw err
  }
}
