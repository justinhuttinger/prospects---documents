import StepShell, { inputClass } from '../StepShell'

// TODO: replace this with a real signature pad (canvas-based, captures a
// PNG data URL and submits via the existing /webhook/ghl-form pipeline).
// For v1 the kiosk collects a typed-name "I agree" + a checkbox, which the
// existing webhook can render into the waiver PDF as a textual signature.
export default function Waiver({ state, dispatch, location, progress, onBack, onNext }) {
  const m = state.member
  function set(key, value) {
    dispatch({ type: 'patch', key: 'member', value: { [key]: value } })
  }
  const valid = m.waiverAgreed && m.waiverSignatureName.trim().length >= 3

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="Liability waiver"
      subtitle="Quick read, then sign below."
      onBack={onBack} onNext={onNext}
      nextDisabled={!valid}
      nextLabel="Sign and continue"
    >
      <div className="rounded-lg border border-border bg-bg p-4 text-xs text-text-primary leading-relaxed max-h-56 overflow-y-auto mb-4">
        <p className="font-semibold mb-2">West Coast Strength Liability Waiver</p>
        <p>
          I recognize that the program may involve strenuous physical activity. I am in good physical
          condition and do not suffer from any known disability or condition that would prevent or
          limit my full participation. I assume full responsibility for any risk of property damage
          or personal injury sustained while participating, and I release West Coast Strength, LLC and
          its officers, agents, and employees from any liability arising out of my participation.
        </p>
        <p className="mt-2">
          <span className="font-semibold">Note:</span> a fully detailed waiver PDF is generated when
          you finish — this short summary is what's shown at the kiosk. (TODO: pad component for
          drawn signature; for now we collect a typed signature.)
        </p>
      </div>

      <label className="flex items-start gap-3 mb-4">
        <input
          type="checkbox"
          checked={m.waiverAgreed}
          onChange={e => set('waiverAgreed', e.target.checked)}
          className="mt-1 h-4 w-4 accent-wcs-red"
        />
        <span className="text-sm text-text-primary">
          I have read, understand, and agree to the waiver above.
        </span>
      </label>

      <label className="block text-xs font-semibold text-text-primary mb-1.5">
        Signature (type your full legal name)
        <span className="ml-1 text-wcs-red font-bold">*</span>
      </label>
      <input
        className={inputClass}
        type="text"
        autoComplete="off"
        value={m.waiverSignatureName}
        onChange={e => set('waiverSignatureName', e.target.value)}
        placeholder="Full legal name"
      />
    </StepShell>
  )
}
