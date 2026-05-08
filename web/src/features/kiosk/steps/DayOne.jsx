import StepShell, { inputClass } from '../StepShell'

// TODO: replace this iframe placeholder with the actual GHL Day One booking
// widget snippet. The kiosk just needs the iframe to render — staff or
// member books inside it — then the confirm fields below capture the
// outcome for the final tour-completed webhook.
const GHL_DAY_ONE_EMBED_URL = '' // TODO: paste the GHL calendar embed URL here

export default function DayOne({ state, dispatch, location, progress, onBack, onNext }) {
  const d = state.dayOne
  function set(key, value) {
    dispatch({ type: 'patch', key: 'dayOne', value: { [key]: value } })
  }

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="Book your Day One"
      subtitle="Pick a time for your first session — or skip and book later."
      onBack={onBack} onNext={onNext}
    >
      <div className="rounded-lg border border-border bg-bg overflow-hidden mb-4">
        {GHL_DAY_ONE_EMBED_URL ? (
          <iframe
            src={GHL_DAY_ONE_EMBED_URL}
            title="Day One booking"
            className="w-full"
            style={{ height: 480, border: 0 }}
          />
        ) : (
          <div className="p-8 text-center text-sm text-text-muted">
            <div className="font-semibold text-text-primary mb-1">GHL calendar embed goes here</div>
            <div>Paste the Day One widget URL into <code>GHL_DAY_ONE_EMBED_URL</code> in <code>steps/DayOne.jsx</code>.</div>
          </div>
        )}
      </div>

      <div className="text-sm font-semibold text-text-primary mb-2">Did they book?</div>
      <div className="flex gap-2 mb-3">
        {[
          { v: 'yes', label: 'Booked' },
          { v: 'no', label: 'Not yet' },
          { v: 'skipped', label: 'Skip' },
        ].map(opt => (
          <button key={opt.v} type="button" onClick={() => set('booked', opt.v)}
            className={
              'flex-1 px-4 py-3 rounded-lg border text-sm font-semibold transition-colors ' +
              (d.booked === opt.v
                ? 'bg-wcs-red text-white border-wcs-red'
                : 'bg-bg text-text-primary border-border hover:border-wcs-red/40')
            }>
            {opt.label}
          </button>
        ))}
      </div>

      {d.booked === 'yes' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1.5">Date / time</label>
            <input className={inputClass} type="datetime-local"
              value={d.datetime} onChange={e => set('datetime', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1.5">With (optional)</label>
            <input className={inputClass} type="text" placeholder="Trainer name"
              value={d.employeeName} onChange={e => set('employeeName', e.target.value)} />
          </div>
        </div>
      )}
    </StepShell>
  )
}
