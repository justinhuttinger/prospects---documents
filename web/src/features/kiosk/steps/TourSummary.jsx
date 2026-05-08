import StepShell, { inputClass } from '../StepShell'

const OUTCOMES = [
  { v: 'started_trial',    label: 'Started Trial' },
  { v: 'day_pass',         label: 'Day Pass' },
  { v: 'just_a_tour',      label: 'Just a Tour' },
  { v: 'sold_membership',  label: 'Sold Membership' },
]

export default function TourSummary({ state, dispatch, location, progress, onBack, onNext, loading, error }) {
  const outcome = state.tourOutcome

  function setOutcome(v) {
    dispatch({ type: 'set', key: 'tourOutcome', value: v })
  }

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="Tour summary"
      subtitle="What was the outcome, plus a few notes for follow-up."
      onBack={onBack} onNext={onNext}
      nextDisabled={!outcome}
      nextLabel="Finish tour"
      loading={loading}
      error={error}
    >
      <div className="mb-4">
        <div className="text-xs font-bold text-text-primary uppercase tracking-wider mb-2 pb-2 border-b border-border">
          Outcome <span className="text-wcs-red font-bold">*</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {OUTCOMES.map(o => (
            <button
              key={o.v}
              type="button"
              onClick={() => setOutcome(o.v)}
              className={
                'rounded-lg border px-4 py-3 text-sm font-semibold transition-colors ' +
                (outcome === o.v
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-bg text-text-primary border-border hover:border-wcs-red/40')
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-bold text-text-primary uppercase tracking-wider mb-2 pb-2 border-b border-border">
          Notes <span className="text-tile-sub font-medium normal-case tracking-normal">(optional)</span>
        </div>
        <textarea
          className={inputClass + ' min-h-[120px]'}
          rows={5}
          placeholder="Highlights, objections, next steps…"
          value={state.tourSummary}
          onChange={e => dispatch({ type: 'set', key: 'tourSummary', value: e.target.value })}
        />
      </div>
    </StepShell>
  )
}
