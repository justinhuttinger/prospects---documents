export function digits(s) { return String(s || '').replace(/\D+/g, '') }

export function isValidPhone(s) {
  const d = digits(s)
  return d.length === 10 || (d.length === 11 && d[0] === '1')
}

export function isValidEmail(s) {
  if (!s) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s).trim())
}

export function formatPhone(s) {
  let d = digits(s)
  if (d.length > 11) d = d.slice(0, 11)
  if (d.length === 11 && d[0] === '1') d = d.slice(1)
  if (!d) return ''
  if (d.length < 4) return `(${d}`
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`
}
