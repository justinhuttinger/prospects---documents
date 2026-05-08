import StepShell from '../StepShell'
import SignaturePad from '../components/SignaturePad'

export default function Waiver({ state, dispatch, location, progress, onBack, onNext, loading, error }) {
  const m = state.member
  function setField(key, value) {
    dispatch({ type: 'patch', key: 'member', value: { [key]: value } })
  }

  const hasSignature = !!m.signatureDataUrl
  const valid = m.waiverAgreed && hasSignature

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="Liability waiver"
      subtitle="Quick read, then sign below."
      onBack={onBack} onNext={onNext}
      nextDisabled={!valid}
      nextLabel="Sign and continue"
      loading={loading}
      error={error}
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
          A fully detailed waiver PDF is generated when you finish — your signature below is embedded into it.
        </p>
      </div>

      <label className="flex items-start gap-3 mb-4">
        <input
          type="checkbox"
          checked={m.waiverAgreed}
          onChange={e => setField('waiverAgreed', e.target.checked)}
          className="mt-1 h-5 w-5 accent-wcs-red"
        />
        <span className="text-sm text-text-primary">
          I have read, understand, and agree to the waiver above.
        </span>
      </label>

      <div className="mb-2 text-xs font-semibold text-text-primary">
        Signature <span className="ml-1 text-wcs-red font-bold">*</span>
      </div>
      <SignaturePad
        value={m.signatureDataUrl}
        onChange={dataUrl => setField('signatureDataUrl', dataUrl)}
      />
    </StepShell>
  )
}
