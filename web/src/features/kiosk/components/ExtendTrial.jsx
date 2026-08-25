import { useState } from 'react'
import { extendTrial } from '../../../lib/api'

/**
 * Give a returning prospect more trial days from the kiosk.
 *
 * Days and visits are the same number on purpose: that is how the front desk
 * already talks about it ("give them another 10 days"), and two separate inputs
 * would just be one more thing to get wrong while somebody stands waiting.
 *
 * Only prospects can be edited — ABC gives us no writable agreement route for
 * real members — so a member comes back as `not_a_prospect` and we say so
 * plainly rather than pretending the button did something.
 */
const PRESETS = [3, 7, 10, 14, 30]
const MAX_DAYS = 90

export default function ExtendTrial({ location, prospectId, currentExpiration, onGranted }) {
  const [days, setDays] = useState('10')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  const n = Number(days)
  const valid = Number.isInteger(n) && n >= 1 && n <= MAX_DAYS

  async function grant() {
    if (!valid || busy) return
    setBusy(true)
    setError('')
    try {
      const r = await extendTrial({ location, prospectId, days: n })
      setResult(r)
      onGranted?.(r)
    } catch (e) {
      const msg = String(e.message || '')
      setError(
        msg.includes('not_a_prospect')
          ? "This is a full member, not a trial — access changes have to be made at the front desk."
          : msg.includes('invalid_days')
            ? `Enter between 1 and ${MAX_DAYS} days.`
            : `Could not update ABC: ${msg}`
      )
    } finally {
      setBusy(false)
    }
  }

  if (result?.ok) {
    return (
      <div className="rounded-lg border border-green-600/40 bg-green-600/10 p-4">
        <div className="text-sm font-semibold text-text-primary">
          {result.days} days granted
        </div>
        <div className="text-xs text-tile-sub mt-1">
          Access through <strong>{result.after.expirationDate}</strong> ·{' '}
          {result.after.visitsAllowed} visits ({result.after.visitsUsed} used)
        </div>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-border bg-transparent p-3 text-sm font-semibold text-text-primary hover:border-wcs-red/40 hover:bg-bg"
      >
        Give trial days
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-bg p-4">
      <div className="text-sm font-semibold text-text-primary">Give trial days</div>
      <div className="text-xs text-tile-sub mt-0.5">
        {currentExpiration
          ? `Current access ends ${currentExpiration}.`
          : 'Sets the expiration and the visit allowance to the same number.'}
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {PRESETS.map(d => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(String(d))}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
              days === String(d)
                ? 'border-wcs-red bg-wcs-red text-white'
                : 'border-border text-text-primary hover:border-wcs-red/40'
            }`}
          >
            {d}
          </button>
        ))}
        <input
          value={days}
          onChange={e => setDays(e.target.value.replace(/\D+/g, '').slice(0, 2))}
          inputMode="numeric"
          aria-label="Number of trial days"
          className="w-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
          placeholder="Days"
        />
      </div>

      {error && <p className="text-xs text-wcs-red mt-3">{error}</p>}

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={grant}
          disabled={!valid || busy}
          className="rounded-lg bg-wcs-red px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Updating ABC…' : `Give ${valid ? n : ''} days`.replace('  ', ' ')}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError('') }}
          className="rounded-lg border border-border px-3 py-2 text-sm text-text-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
