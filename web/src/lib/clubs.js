// Hostname → club slug. Same slug list used by the prospects---documents
// backend (`clubs-config.json`).
const HOST_MAP = {
  'wcssalem.app':       'salem',
  'wcskeizer.app':      'keizer',
  'wcseugene.app':      'eugene',
  'wcsmilwaukie.app':   'milwaukie',
  'wcsclackamas.app':   'clackamas',
  'wcsspringfield.app': 'springfield',
  'wcsmedford.app':     'medford',
}

const CLUB_NAMES = {
  salem:       'Salem',
  keizer:      'Keizer',
  eugene:      'Eugene',
  milwaukie:   'Milwaukie',
  clackamas:   'Clackamas',
  springfield: 'Springfield',
  medford:     'Medford',
}

/**
 * Detect which gym this page is being served for. Resolution order:
 *   1. window.WCS_LOCATION (set by an inline script for testing/embeds)
 *   2. Hostname match against HOST_MAP (apex or subdomain of an apex)
 *   3. ?location=<slug> query param
 *   4. Fallback to 'salem'
 */
export function detectLocation() {
  if (typeof window === 'undefined') return 'salem'
  if (window.WCS_LOCATION) return String(window.WCS_LOCATION).toLowerCase().trim()

  const host = window.location.hostname.toLowerCase().replace(/^www\./, '')
  if (HOST_MAP[host]) return HOST_MAP[host]
  for (const apex of Object.keys(HOST_MAP)) {
    if (host.endsWith('.' + apex)) return HOST_MAP[apex]
  }

  const qp = new URLSearchParams(window.location.search).get('location')
  if (qp) return String(qp).toLowerCase().trim()

  return 'salem'
}

export function clubName(slug) {
  return CLUB_NAMES[slug] || slug
}
