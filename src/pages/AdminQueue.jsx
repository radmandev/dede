import React, { useEffect, useState } from 'react'
import supabase from '@/api/base44Client'

export default function AdminQueue() {
  const [data, setData] = useState({ queue: [], errors: [] })
  const [loading, setLoading] = useState(false)

  async function fetchData() {
    setLoading(true)
    const res = await supabase.functions.invoke('adminGetDelivery')
    try {
      const json = typeof res === 'string' ? JSON.parse(res) : res
      setData(json)
    } catch (e) {
      console.error('parse', e, res)
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  async function action(action, id) {
    await supabase.functions.invoke('adminManageDelivery', { body: { action, id } })
    fetchData()
  }

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold">Delivery Queue</h2>
      <button onClick={fetchData} disabled={loading}>Refresh</button>
      <div className="mt-4">
        {data.queue.length === 0 ? <div>No queued deliveries</div> : (
          <table className="w-full text-sm">
            <thead><tr><th>id</th><th>contact</th><th>attempts</th><th>next</th><th>actions</th></tr></thead>
            <tbody>
              {data.queue.map(q => (
                <tr key={q.id}>
                  <td>{q.id}</td>
                  <td>{q.contact_id}</td>
                  <td>{q.attempts}/{q.max_attempts}</td>
                  <td>{new Date(q.next_attempt_at).toLocaleString()}</td>
                  <td>
                    <button onClick={() => action('retry', q.id)}>Retry</button>
                    <button onClick={() => action('delete', q.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="text-xl font-bold mt-8">Delivery Errors</h2>
      <div className="mt-4">
        {data.errors.length === 0 ? <div>No errors</div> : (
          <ul>
            {data.errors.map(e => (
              <li key={e.id}><strong>{e.error_text}</strong> — {e.created_at}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
