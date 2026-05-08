// API client for the prospects---documents backend.
// Override at build time with VITE_API_BASE if needed.
const API_BASE = (import.meta.env.VITE_API_BASE || 'https://prospects-documents.onrender.com').replace(/\/$/, '')

async function jsonOrThrow(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.message || `http_${res.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data
}

export async function fetchEmployees(location) {
  const url = `${API_BASE}/api/vip-referrals/employees?location=${encodeURIComponent(location)}`
  const res = await fetch(url, { credentials: 'omit' })
  const data = await jsonOrThrow(res)
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.employees)) return data.employees
  return []
}

export async function submitVipReferrals(body) {
  const res = await fetch(`${API_BASE}/webhooks/vip-referrals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return jsonOrThrow(res)
}
