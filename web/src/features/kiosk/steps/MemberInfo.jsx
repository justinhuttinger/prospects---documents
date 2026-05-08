import { useState } from 'react'
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
  const [searching, setSearching] = useState(false)

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
    setSearching(true)
    // Make sure the searching screen shows for at least ~700ms even on
    // a fast lookup, so it feels like a real action and not a flicker.
    const minDelay = new Promise(r => setTimeout(r, 700))
    try {
      const lookupP = lookupMember({
        location,
        phone:     digits(m.phone),
        email:     m.email.trim().toLowerCase(),
        firstName: m.firstName.trim(),
        lastName:  m.lastName.trim(),
      })
      const [result] = await Promise.all([lookupP, minDelay])
      const candidates = Array.isArray(result.candidates) ? result.candidates : []
      const matchKind  = result.match || (candidates.length ? 'partial' : 'none')

      let chosen = null
      if (matchKind === 'exact' && candidates.length === 1) chosen = candidates[0]

      // Atomic state-and-advance so the new flow is used for the next step.
      dispatch({
        type: 'setAndAdvance',
        lookup: {
          match:        matchKind,
          candidates,
          found:        !!chosen,
          abcMemberId:  chosen ? chosen.abc_member_id : null,
          lastVisit:    chosen ? chosen.last_visit    : null,
          hasPhoto:     chosen ? !!chosen.has_photo   : false,
          memberStatus: chosen ? chosen.member_status : null,
        },
      })
      setSearching(false)
    } catch (err) {
      await minDelay
      // Lookup failed entirely — log, continue as a new member.
      dispatch({
        type: 'setAndAdvance',
        lookup: { match: 'none', candidates: [], found: false, abcMemberId: null, lastVisit: null, hasPhoto: false, memberStatus: null },
      })
      setSearching(false)
    }
  }

  if (searching) {
    return (
      <StepShell
        location={location}
        current={progress.current} total={progress.total}
        title="Looking up your account…"
        subtitle={`${m.firstName.trim()} ${m.lastName.trim()}`.trim() || 'Searching ABC by phone, email, and name.'}
        showBack={false}
        showNext={false}
      >
        <div className="loading-card mx-0 my-2">Searching ABC for an existing account…</div>
        <p className="mt-3 text-center text-xs text-tile-sub">This usually takes 1–3 seconds.</p>
      </StepShell>
    )
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
