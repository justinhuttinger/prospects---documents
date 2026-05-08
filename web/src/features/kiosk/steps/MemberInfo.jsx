import StepShell, { inputClass } from '../StepShell'
import { lookupMember } from '../../../lib/api'
import { digits, formatPhone, isValidEmail, isValidPhone } from '../../../lib/utils'

function FieldLabel({ children, required }) {
  return (
    <label className="block text-xs font-semibold text-text-primary mb-1.5">
      {children}{required && <span className="ml-1 text-wcs-red font-bold">*</span>}
    </label>
  )
}

export default function MemberInfo({ state, dispatch, location, progress, onBack, onNext }) {
  const m = state.member

  function set(key, value) {
    dispatch({
      type: 'patch',
      key: 'member',
      value: { [key]: key === 'phone' ? formatPhone(value) : value },
    })
  }

  const valid =
    m.firstName.trim() &&
    m.lastName.trim() &&
    isValidPhone(m.phone) &&
    isValidEmail(m.email)

  async function handleNext() {
    dispatch({ type: 'setLoading', value: true })
    try {
      const result = await lookupMember({
        location,
        phone: digits(m.phone),
        email: m.email.trim().toLowerCase(),
      })
      dispatch({
        type: 'set',
        key: 'lookup',
        value: {
          found:         !!result.found,
          abcMemberId:   result.abc_member_id || null,
          lastVisit:     result.last_visit || null,
          hasPhoto:      !!result.has_photo,
          memberStatus:  result.member_status || null,
        },
      })
      // If the lookup returned member name and we don't have one entered, fill it in.
      if (result.found && (result.first_name || result.last_name)) {
        dispatch({
          type: 'patch',
          key: 'member',
          value: {
            firstName: m.firstName || result.first_name || '',
            lastName:  m.lastName  || result.last_name  || '',
          },
        })
      }
      dispatch({ type: 'setLoading', value: false })
      onNext()
    } catch (err) {
      dispatch({ type: 'error', message: `Lookup failed: ${err.message}. Try again or continue without.` })
      // Still allow continuing — they can complete the tour as a new member
      onNext()
    }
  }

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="Tell us about yourself"
      subtitle="We'll use this to find your account or set up a new one."
      onBack={onBack} onNext={handleNext}
      nextDisabled={!valid}
      nextLabel="Continue"
      loading={state.loading}
      error={state.error}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <FieldLabel required>First Name</FieldLabel>
          <input className={inputClass} type="text" autoComplete="given-name"
            value={m.firstName} onChange={e => set('firstName', e.target.value)} />
        </div>
        <div>
          <FieldLabel required>Last Name</FieldLabel>
          <input className={inputClass} type="text" autoComplete="family-name"
            value={m.lastName} onChange={e => set('lastName', e.target.value)} />
        </div>
        <div>
          <FieldLabel required>Phone</FieldLabel>
          <input className={inputClass} type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 555-5555"
            value={m.phone} onChange={e => set('phone', e.target.value)} />
        </div>
        <div>
          <FieldLabel required>Email</FieldLabel>
          <input className={inputClass} type="email" inputMode="email" autoComplete="email"
            value={m.email} onChange={e => set('email', e.target.value)} />
        </div>
      </div>
    </StepShell>
  )
}
