import StepShell, { inputClass, selectClass } from '../StepShell'

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]

const MONTHS = [
  ['01', 'Jan'], ['02', 'Feb'], ['03', 'Mar'], ['04', 'Apr'],
  ['05', 'May'], ['06', 'Jun'], ['07', 'Jul'], ['08', 'Aug'],
  ['09', 'Sep'], ['10', 'Oct'], ['11', 'Nov'], ['12', 'Dec'],
]
function daysInMonth(m, y) {
  const mm = parseInt(m, 10), yy = parseInt(y, 10) || 2000
  if (!mm) return 31
  return new Date(yy, mm, 0).getDate()
}
const THIS_YEAR = new Date().getFullYear()
const YEARS = []
for (let y = THIS_YEAR - 13; y >= THIS_YEAR - 100; y -= 1) YEARS.push(String(y))

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

  const dobValid = !!(m.dobMonth && m.dobDay && m.dobYear)
  const valid = dobValid && m.address1.trim() && m.city.trim() && m.state && m.postalCode.trim()

  const dayMax = daysInMonth(m.dobMonth, m.dobYear)
  const days = []
  for (let d = 1; d <= dayMax; d += 1) days.push(String(d).padStart(2, '0'))

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="A little more about you"
      subtitle="We need this for your liability waiver."
      onBack={onBack} onNext={onNext}
      nextDisabled={!valid}
    >
      <div className="grid grid-cols-1 gap-3">
        <div>
          <FieldLabel required>Date of Birth</FieldLabel>
          <div className="grid grid-cols-3 gap-2">
            <select
              className={selectClass}
              value={m.dobMonth}
              onChange={e => set('dobMonth', e.target.value)}
              aria-label="Birth month"
            >
              <option value="">Month</option>
              {MONTHS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
            <select
              className={selectClass}
              value={m.dobDay}
              onChange={e => set('dobDay', e.target.value)}
              aria-label="Birth day"
            >
              <option value="">Day</option>
              {days.map(d => <option key={d} value={d}>{parseInt(d, 10)}</option>)}
            </select>
            <select
              className={selectClass}
              value={m.dobYear}
              onChange={e => set('dobYear', e.target.value)}
              aria-label="Birth year"
            >
              <option value="">Year</option>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div>
          <FieldLabel required>Address</FieldLabel>
          <input className={inputClass} type="text" autoComplete="address-line1" placeholder="123 Main St"
            value={m.address1} onChange={e => set('address1', e.target.value)} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <FieldLabel required>City</FieldLabel>
            <input className={inputClass} type="text" autoComplete="address-level2"
              value={m.city} onChange={e => set('city', e.target.value)} />
          </div>
          <div>
            <FieldLabel required>State</FieldLabel>
            <select className={selectClass} value={m.state} onChange={e => set('state', e.target.value)}>
              <option value="">Select…</option>
              {STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div>
          <FieldLabel required>ZIP</FieldLabel>
          <input className={inputClass} type="text" inputMode="tel" pattern="[0-9]*" autoComplete="postal-code" maxLength={5}
            value={m.postalCode} onChange={e => set('postalCode', e.target.value)} />
        </div>
      </div>
    </StepShell>
  )
}
