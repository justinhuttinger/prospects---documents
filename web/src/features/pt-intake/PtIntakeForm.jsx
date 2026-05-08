import { useMemo, useState } from 'react'
import SuccessCard from '../../components/SuccessCard'
import { detectLocation, clubName } from '../../lib/clubs'
import { submitPtIntake } from '../../lib/api'
import { digits, formatPhone, isValidEmail, isValidPhone } from '../../lib/utils'

const inputClass =
  'w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red placeholder:text-tile-sub'
const selectClass = inputClass + ' appearance-none pr-9'

const EXPERIENCE_LEVELS = ['Beginner', 'Intermediate', 'Advanced']
const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say']
const LIMITATIONS = [
  { key: 'limitNeck',       label: 'Neck' },
  { key: 'limitShoulder',   label: 'Shoulder' },
  { key: 'limitElbowWrist', label: 'Elbow / Wrist' },
  { key: 'limitHip',        label: 'Hip' },
  { key: 'limitLowerBack',  label: 'Lower Back' },
  { key: 'limitKnee',       label: 'Knee' },
  { key: 'limitAnkle',      label: 'Ankle' },
]

const INIT = {
  firstName: '', lastName: '', phone: '', email: '',
  gender: '',
  experienceLevel: '',
  weightLbs: '', height: '',
  programGoal: '', durationWeeks: '', daysPerWeek: '',
  day1Focus: '', day2Focus: '', day3Focus: '', day4Focus: '',
  day5Focus: '', day6Focus: '', day7Focus: '',
  limitNeck: 'no', limitShoulder: 'no', limitElbowWrist: 'no',
  limitHip: 'no', limitLowerBack: 'no', limitKnee: 'no', limitAnkle: 'no',
  ptNotes: '',
}

function FieldLabel({ children, required }) {
  return (
    <label className="block text-xs font-semibold text-text-primary mb-1.5">
      {children}
      {required && <span className="ml-1 text-wcs-red font-bold">*</span>}
    </label>
  )
}

function FieldError({ msg }) {
  return msg ? <p className="mt-1 text-xs text-wcs-red">{msg}</p> : null
}

function SectionTitle({ children, optional }) {
  return (
    <h2 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-3 pb-2 border-b border-border">
      {children}
      {optional && <span className="text-tile-sub font-medium normal-case tracking-normal"> (optional)</span>}
    </h2>
  )
}

function YesNo({ value, onChange, name }) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label={name}>
      {['no', 'yes'].map(opt => (
        <button
          key={opt}
          type="button"
          role="radio"
          aria-checked={value === opt}
          onClick={() => onChange(opt)}
          className={
            'flex-1 px-3 py-2 rounded-lg border text-xs font-semibold uppercase tracking-wider transition-colors ' +
            (value === opt
              ? 'bg-wcs-red text-white border-wcs-red'
              : 'bg-bg text-text-primary border-border hover:border-wcs-red/40')
          }
        >
          {opt === 'yes' ? 'Yes' : 'No'}
        </button>
      ))}
    </div>
  )
}

export default function PtIntakeForm() {
  const location = useMemo(detectLocation, [])
  const [form, setForm] = useState(INIT)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [statusKind, setStatusKind] = useState('')
  const [done, setDone] = useState(false)

  function set(key, value) {
    setForm(f => ({ ...f, [key]: key === 'phone' ? formatPhone(value) : value }))
  }

  // Required-field validation
  const errs = {
    firstName:       !form.firstName.trim()           ? 'Required' : '',
    lastName:        !form.lastName.trim()            ? 'Required' : '',
    phone:           !isValidPhone(form.phone)        ? (form.phone ? 'Enter a valid phone' : 'Required') : '',
    email:           !isValidEmail(form.email)        ? (form.email ? 'Enter a valid email' : 'Required') : '',
    experienceLevel: !form.experienceLevel             ? 'Required' : '',
    weightLbs:       !form.weightLbs.trim()           ? 'Required' : '',
    height:          !form.height.trim()              ? 'Required' : '',
    programGoal:     !form.programGoal.trim()         ? 'Required' : '',
    durationWeeks:   !form.durationWeeks.trim()       ? 'Required' : '',
    daysPerWeek:     !form.daysPerWeek.trim()         ? 'Required' : '',
  }

  function getValidationErrors() {
    const out = []
    if (errs.firstName)       out.push('first name')
    if (errs.lastName)        out.push('last name')
    if (errs.phone)           out.push('phone')
    if (errs.email)           out.push('email')
    if (errs.experienceLevel) out.push('experience level')
    if (errs.weightLbs)       out.push('weight')
    if (errs.height)          out.push('height')
    if (errs.programGoal)     out.push('program goal')
    if (errs.durationWeeks)   out.push('duration')
    if (errs.daysPerWeek)     out.push('days per week')
    return out
  }

  async function onSubmit() {
    setSubmitAttempted(true)
    const list = getValidationErrors()
    if (list.length) {
      const listed = list.slice(0, 5).join(', ')
      const more   = list.length > 5 ? ` (+${list.length - 5} more)` : ''
      setStatusMsg(`Required: ${listed}${more}.`)
      setStatusKind('error')
      return
    }
    setSubmitting(true)
    setStatusMsg('Sending...')
    setStatusKind('')
    try {
      await submitPtIntake({
        location,
        ...form,
        phone: digits(form.phone),
        email: form.email.trim().toLowerCase(),
        submittedAt: new Date().toISOString(),
      })
      setDone(true)
    } catch (err) {
      setSubmitting(false)
      setStatusMsg(`Submission failed: ${err.message}. Please try again.`)
      setStatusKind('error')
    }
  }

  if (done) {
    return (
      <SuccessCard
        title="Got it — thanks!"
        message="Your PT intake has been received. Your trainer will follow up shortly."
      />
    )
  }

  const show = submitAttempted

  return (
    <div className="bg-surface rounded-2xl border border-border p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-text-primary">PT Intake</h1>
        <p className="text-sm text-text-muted mt-1">
          Personal training program intake — {clubName(location)}.
        </p>
      </div>

      {/* Member info */}
      <section className="mb-6">
        <SectionTitle>Your Info</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <FieldLabel required>First Name</FieldLabel>
            <input className={inputClass} type="text" autoComplete="given-name"
              value={form.firstName} onChange={e => set('firstName', e.target.value)} />
            {show && <FieldError msg={errs.firstName} />}
          </div>
          <div>
            <FieldLabel required>Last Name</FieldLabel>
            <input className={inputClass} type="text" autoComplete="family-name"
              value={form.lastName} onChange={e => set('lastName', e.target.value)} />
            {show && <FieldError msg={errs.lastName} />}
          </div>
          <div>
            <FieldLabel required>Phone</FieldLabel>
            <input className={inputClass} type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 555-5555"
              value={form.phone} onChange={e => set('phone', e.target.value)} />
            {show && <FieldError msg={errs.phone} />}
          </div>
          <div>
            <FieldLabel required>Email</FieldLabel>
            <input className={inputClass} type="email" inputMode="email" autoComplete="email"
              value={form.email} onChange={e => set('email', e.target.value)} />
            {show && <FieldError msg={errs.email} />}
          </div>
          <div className="sm:col-span-2">
            <FieldLabel>Gender</FieldLabel>
            <select className={selectClass} value={form.gender} onChange={e => set('gender', e.target.value)}>
              <option value="">Select…</option>
              {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* Profile */}
      <section className="mb-6">
        <SectionTitle>Fitness Profile</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <FieldLabel required>Experience Level</FieldLabel>
            <div className="flex gap-2">
              {EXPERIENCE_LEVELS.map(lvl => (
                <button key={lvl} type="button"
                  onClick={() => set('experienceLevel', lvl)}
                  className={
                    'flex-1 px-3 py-2 rounded-lg border text-xs font-semibold uppercase tracking-wider transition-colors ' +
                    (form.experienceLevel === lvl
                      ? 'bg-wcs-red text-white border-wcs-red'
                      : 'bg-bg text-text-primary border-border hover:border-wcs-red/40')
                  }>
                  {lvl}
                </button>
              ))}
            </div>
            {show && <FieldError msg={errs.experienceLevel} />}
          </div>
          <div>
            <FieldLabel required>Weight (lbs)</FieldLabel>
            <input className={inputClass} type="number" inputMode="numeric"
              value={form.weightLbs} onChange={e => set('weightLbs', e.target.value)} />
            {show && <FieldError msg={errs.weightLbs} />}
          </div>
          <div>
            <FieldLabel required>Height</FieldLabel>
            <input className={inputClass} type="text" placeholder={`5'10" or 70`}
              value={form.height} onChange={e => set('height', e.target.value)} />
            {show && <FieldError msg={errs.height} />}
          </div>
          <div className="sm:col-span-2">
            <FieldLabel required>Program Goal</FieldLabel>
            <input className={inputClass} type="text" placeholder="e.g., lose weight, build strength"
              value={form.programGoal} onChange={e => set('programGoal', e.target.value)} />
            {show && <FieldError msg={errs.programGoal} />}
          </div>
          <div>
            <FieldLabel required>Duration (weeks)</FieldLabel>
            <input className={inputClass} type="number" inputMode="numeric"
              value={form.durationWeeks} onChange={e => set('durationWeeks', e.target.value)} />
            {show && <FieldError msg={errs.durationWeeks} />}
          </div>
          <div>
            <FieldLabel required>Days Per Week</FieldLabel>
            <input className={inputClass} type="number" inputMode="numeric" min="1" max="7"
              value={form.daysPerWeek} onChange={e => set('daysPerWeek', e.target.value)} />
            {show && <FieldError msg={errs.daysPerWeek} />}
          </div>
        </div>
      </section>

      {/* Day-by-day focus */}
      <section className="mb-6">
        <SectionTitle optional>Day Focus</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2, 3, 4, 5, 6, 7].map(d => (
            <div key={d}>
              <FieldLabel>Day {d}</FieldLabel>
              <input className={inputClass} type="text" placeholder="e.g., upper body, legs, rest"
                value={form[`day${d}Focus`]}
                onChange={e => set(`day${d}Focus`, e.target.value)} />
            </div>
          ))}
        </div>
      </section>

      {/* Limitations */}
      <section className="mb-6">
        <SectionTitle>Limitations</SectionTitle>
        <p className="text-xs text-text-muted mb-3">Any of these areas you can't load heavily?</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {LIMITATIONS.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-2">
              <span className="text-sm font-semibold text-text-primary">{label}</span>
              <div className="w-32"><YesNo value={form[key]} onChange={v => set(key, v)} name={label} /></div>
            </div>
          ))}
        </div>
      </section>

      {/* Notes */}
      <section className="mb-6">
        <SectionTitle optional>PT Notes</SectionTitle>
        <textarea className={inputClass + ' min-h-[100px]'} rows={4}
          placeholder="Anything else your trainer should know"
          value={form.ptNotes} onChange={e => set('ptNotes', e.target.value)} />
      </section>

      <button type="button" onClick={onSubmit} disabled={submitting}
        className="w-full py-3.5 rounded-lg bg-wcs-red text-white font-bold text-sm tracking-wider uppercase hover:bg-wcs-red-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        {submitting ? 'Sending…' : 'Submit'}
      </button>

      {statusMsg && (
        <p className={`mt-3 text-center text-xs ${statusKind === 'error' ? 'text-wcs-red' : 'text-text-muted'}`}>
          {statusMsg}
        </p>
      )}
    </div>
  )
}
