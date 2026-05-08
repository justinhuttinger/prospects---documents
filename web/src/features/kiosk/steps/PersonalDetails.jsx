import StepShell, { inputClass } from '../StepShell'

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]

function FieldLabel({ children, required }) {
  return (
    <label className="block text-xs font-semibold text-text-primary mb-1.5">
      {children}{required && <span className="ml-1 text-wcs-red font-bold">*</span>}
    </label>
  )
}

export default function PersonalDetails({ state, dispatch, location, progress, onBack, onNext }) {
  const m = state.member
  function set(key, value) {
    dispatch({ type: 'patch', key: 'member', value: { [key]: value } })
  }
  const valid = m.dob && m.address1.trim() && m.city.trim() && m.state && m.postalCode.trim()

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="A little more about you"
      subtitle="We need this for your liability waiver."
      onBack={onBack} onNext={onNext}
      nextDisabled={!valid}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <FieldLabel required>Date of Birth</FieldLabel>
          <input className={inputClass} type="date" value={m.dob} onChange={e => set('dob', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <FieldLabel required>Address</FieldLabel>
          <input className={inputClass} type="text" autoComplete="address-line1" placeholder="123 Main St"
            value={m.address1} onChange={e => set('address1', e.target.value)} />
        </div>
        <div>
          <FieldLabel required>City</FieldLabel>
          <input className={inputClass} type="text" autoComplete="address-level2"
            value={m.city} onChange={e => set('city', e.target.value)} />
        </div>
        <div>
          <FieldLabel required>State</FieldLabel>
          <select className={inputClass + ' appearance-none pr-9'} value={m.state}
            onChange={e => set('state', e.target.value)}>
            <option value="">Select…</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <FieldLabel required>ZIP</FieldLabel>
          <input className={inputClass} type="text" inputMode="tel" pattern="[0-9]*" autoComplete="postal-code" maxLength={5}
            value={m.postalCode} onChange={e => set('postalCode', e.target.value)} />
        </div>
      </div>
    </StepShell>
  )
}
