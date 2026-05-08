import { clubName } from '../../lib/clubs'

// Wraps a step's content with consistent header (progress) + footer (Back
// + Next/Continue buttons). Each step renders its own form fields inside.
export default function StepShell({
  location,
  current, total,
  title, subtitle,
  children,
  onBack, onNext,
  nextLabel = 'Continue',
  nextDisabled = false,
  showBack = true,
  showNext = true,
  loading = false,
  error = null,
}) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-6 sm:p-8">
      {(current && total) ? (
        <div className="flex items-center justify-between mb-4">
          <span className="text-[11px] font-bold uppercase tracking-wider text-tile-sub">
            {clubName(location)} · Step {current} of {total}
          </span>
          <div className="flex gap-1">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className={
                  'h-1 w-4 rounded-full ' +
                  (i + 1 <= current ? 'bg-wcs-red' : 'bg-border')
                }
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-5">
        <h1 className="text-2xl font-black text-text-primary">{title}</h1>
        {subtitle && <p className="text-sm text-text-muted mt-1">{subtitle}</p>}
      </div>

      <div className="mb-6">{children}</div>

      {error && <p className="mb-4 text-center text-xs text-wcs-red">{error}</p>}

      <div className="flex gap-3">
        {showBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={loading}
            className="flex-none px-5 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm font-semibold hover:border-wcs-red/40 disabled:opacity-50"
          >
            Back
          </button>
        )}
        {showNext && (
          <button
            type="button"
            onClick={onNext}
            disabled={nextDisabled || loading}
            className="flex-1 py-3 rounded-lg bg-wcs-red text-white font-bold text-sm tracking-wider uppercase hover:bg-wcs-red-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Working…' : nextLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export const inputClass =
  'w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red placeholder:text-tile-sub'

export const selectClass = inputClass + ' appearance-none pr-9'
