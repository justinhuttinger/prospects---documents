import StepShell, { inputClass } from '../StepShell'

const SOURCES = [
  'Google search',
  'Friend / referral',
  'Drove by',
  'Social media',
  'Yelp / review',
  'Already a member somewhere',
  'Other',
]

export default function HowHeard({ state, dispatch, location, progress, onBack, onNext }) {
  const v = state.member.howHeard
  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="How did you hear about us?"
      subtitle="Helps us know what's working."
      onBack={onBack} onNext={onNext}
      nextDisabled={!v}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SOURCES.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => dispatch({ type: 'patch', key: 'member', value: { howHeard: s } })}
            className={
              'rounded-lg border px-4 py-3 text-sm font-semibold transition-colors text-left ' +
              (v === s
                ? 'bg-wcs-red text-white border-wcs-red'
                : 'bg-bg text-text-primary border-border hover:border-wcs-red/40')
            }
          >
            {s}
          </button>
        ))}
      </div>
    </StepShell>
  )
}
