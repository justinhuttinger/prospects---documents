import StepShell, { inputClass } from '../StepShell'

export default function TourSummary({ state, dispatch, location, progress, onBack, onNext, loading, error }) {
  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="Tour summary"
      subtitle="Quick notes on how the tour went — for follow-up."
      onBack={onBack} onNext={onNext}
      nextLabel="Finish tour"
      loading={loading}
      error={error}
    >
      <textarea
        className={inputClass + ' min-h-[140px]'}
        rows={6}
        placeholder="Highlights, objections, next steps…"
        value={state.tourSummary}
        onChange={e => dispatch({ type: 'set', key: 'tourSummary', value: e.target.value })}
      />
    </StepShell>
  )
}
