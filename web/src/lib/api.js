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

export async function submitPtIntake(body) {
  const res = await fetch(`${API_BASE}/webhooks/pt-intake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return jsonOrThrow(res)
}

export async function lookupMember({ location, phone, email, firstName, lastName }) {
  const params = new URLSearchParams({ location })
  if (phone)     params.set('phone', phone)
  if (email)     params.set('email', email)
  if (firstName) params.set('firstName', firstName)
  if (lastName)  params.set('lastName', lastName)
  const res = await fetch(`${API_BASE}/api/kiosk/lookup?${params}`, { credentials: 'omit' })
  return jsonOrThrow(res)
}

export async function checkDayOneBooked({ location, phone, email }) {
  const params = new URLSearchParams({ location })
  if (phone) params.set('phone', phone)
  if (email) params.set('email', email)
  const res = await fetch(`${API_BASE}/api/kiosk/check-day-one?${params}`, { credentials: 'omit' })
  return jsonOrThrow(res)
}

export async function submitTourCompleted(body) {
  const res = await fetch(`${API_BASE}/webhooks/tour-completed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return jsonOrThrow(res)
}

// Submits the existing /webhook/ghl-form pipeline (creates ABC prospect +
// waiver + alert + photo + check-in). Fired once at the end of the waiver
// step, only for new (non-existing) members.
export async function submitGhlForm(body) {
  const res = await fetch(`${API_BASE}/webhook/ghl-form`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return jsonOrThrow(res)
}
