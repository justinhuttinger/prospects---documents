import { useEffect, useMemo, useRef, useState } from 'react'
import SuccessCard from '../../components/SuccessCard'
import { detectLocation, clubName } from '../../lib/clubs'
import { fetchEmployees, submitVipReferrals } from '../../lib/api'
import { digits, formatPhone, isValidEmail, isValidPhone } from '../../lib/utils'

const MAX_VIPS = 5

const inputClass =
  'w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red placeholder:text-tile-sub'

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

export default function VipForm({ variant = 'internal' }) {
  const isInternal = variant === 'internal'
  const location = useMemo(detectLocation, [])

  const [member, setMember] = useState({ firstName: '', lastName: '', phone: '', email: '' })
  const [employees, setEmployees] = useState([])
  const [employeeId, setEmployeeId] = useState('')
  const [vips, setVips] = useState([{ id: 1, firstName: '', lastName: '', phone: '' }])
  const nextVipId = useRef(2)

  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [statusKind, setStatusKind] = useState('') // '' | 'error'
  const [doneCount, setDoneCount] = useState(null)

  // Load team members for internal variant
  useEffect(() => {
    if (!isInternal) return
    let cancelled = false
    fetchEmployees(location)
      .then(list => { if (!cancelled) setEmployees(list || []) })
      .catch(() => { if (!cancelled) setEmployees([]) })
    return () => { cancelled = true }
  }, [isInternal, location])

  // Validation
  const memberErr = {
    firstName: !member.firstName.trim()        ? 'Required' : '',
    lastName:  !member.lastName.trim()         ? 'Required' : '',
    phone:     !isValidPhone(member.phone)     ? (member.phone ? 'Enter a valid phone' : 'Required') : '',
    email:     !isValidEmail(member.email)     ? (member.email ? 'Enter a valid email' : 'Required') : '',
  }
  function vipErr(v) {
    return {
      firstName: !v.firstName.trim()    ? 'Required' : '',
      lastName:  !v.lastName.trim()     ? 'Required' : '',
      phone:     !isValidPhone(v.phone) ? (v.phone ? 'Enter a valid phone' : 'Required') : '',
    }
  }

  function getValidationErrors() {
    const out = []
    if (memberErr.firstName) out.push('your first name')
    if (memberErr.lastName)  out.push('your last name')
    if (memberErr.phone)     out.push('your phone')
    if (memberErr.email)     out.push('your email')
    if (vips.length === 0)   out.push('at least one VIP')
    vips.forEach((v, i) => {
      const e = vipErr(v); const n = i + 1
      if (e.firstName) out.push(`VIP #${n} first name`)
      if (e.lastName)  out.push(`VIP #${n} last name`)
      if (e.phone)     out.push(`VIP #${n} phone`)
    })
    return out
  }

  function isFormValid() { return getValidationErrors().length === 0 }

  // Handlers
  function setMemberField(key, value) {
    setMember(m => ({ ...m, [key]: key === 'phone' ? formatPhone(value) : value }))
  }
  function setVipField(id, key, value) {
    setVips(list => list.map(v =>
      v.id === id ? { ...v, [key]: key === 'phone' ? formatPhone(value) : value } : v
    ))
  }
  function addVip() {
    if (vips.length >= MAX_VIPS) return
    const id = nextVipId.current++
    setVips(list => [...list, { id, firstName: '', lastName: '', phone: '' }])
  }
  function removeVip(id) {
    setVips(list => list.filter(v => v.id !== id))
  }

  async function onSubmit() {
    setSubmitAttempted(true)
    if (!isFormValid()) {
      const errs = getValidationErrors()
      const listed = errs.slice(0, 4).join(', ')
      const more   = errs.length > 4 ? ` (+${errs.length - 4} more)` : ''
      setStatusMsg(`Required: ${listed}${more}.`)
      setStatusKind('error')
      return
    }
    setSubmitting(true)
    setStatusMsg('Sending...')
    setStatusKind('')
    const employee = employees.find(e => String(e.id) === String(employeeId))
    const body = {
      location,
      member: {
        firstName: member.firstName.trim(),
        lastName:  member.lastName.trim(),
        phone:     digits(member.phone),
        email:     member.email.trim().toLowerCase() || null,
      },
      employee: { id: employeeId || '', name: employee?.name || '' },
      vips: vips.map(v => ({
        firstName: v.firstName.trim(),
        lastName:  v.lastName.trim(),
        phone:     digits(v.phone),
      })),
      submittedAt: new Date().toISOString(),
    }
    try {
      const data = await submitVipReferrals(body)
      const n = data?.created ?? data?.fired ?? body.vips.length
      setDoneCount(n)
    } catch (err) {
      setSubmitting(false)
      setStatusMsg(`Submission failed: ${err.message}. Please try again.`)
      setStatusKind('error')
    }
  }

  if (doneCount !== null) {
    return (
      <SuccessCard
        title="Thanks for the referrals!"
        message={`We received ${doneCount} VIP referral${doneCount === 1 ? '' : 's'}. We'll reach out soon.`}
      />
    )
  }

  const showFieldErrors = submitAttempted

  return (
    <div className="bg-surface rounded-2xl border border-border p-6 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-text-primary">Refer Your VIPs</h1>
        <p className="text-sm text-text-muted mt-1">
          Know someone who'd love West Coast Strength {clubName(location)}? Refer up to 5 friends below — we'll reach
          out and let them know you sent us their way.
        </p>
      </div>

      {/* Member info */}
      <section className="mb-6">
        <h2 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-3 pb-2 border-b border-border">
          Your Info
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <FieldLabel required>First Name</FieldLabel>
            <input className={inputClass} type="text" autoComplete="given-name" value={member.firstName}
              onChange={e => setMemberField('firstName', e.target.value)} />
            {showFieldErrors && <FieldError msg={memberErr.firstName} />}
          </div>
          <div>
            <FieldLabel required>Last Name</FieldLabel>
            <input className={inputClass} type="text" autoComplete="family-name" value={member.lastName}
              onChange={e => setMemberField('lastName', e.target.value)} />
            {showFieldErrors && <FieldError msg={memberErr.lastName} />}
          </div>
          <div>
            <FieldLabel required>Phone</FieldLabel>
            <input className={inputClass} type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 555-5555"
              value={member.phone} onChange={e => setMemberField('phone', e.target.value)} />
            {showFieldErrors && <FieldError msg={memberErr.phone} />}
          </div>
          <div>
            <FieldLabel required>Email</FieldLabel>
            <input className={inputClass} type="email" inputMode="email" autoComplete="email"
              value={member.email} onChange={e => setMemberField('email', e.target.value)} />
            {showFieldErrors && <FieldError msg={memberErr.email} />}
          </div>
        </div>
      </section>

      {/* Employee — internal only */}
      {isInternal && (
        <section className="mb-6">
          <h2 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-3 pb-2 border-b border-border">
            Who Helped You? <span className="text-tile-sub font-medium normal-case tracking-normal">(optional)</span>
          </h2>
          <div>
            <FieldLabel>Team Member</FieldLabel>
            <select className={inputClass + ' appearance-none pr-9'} value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}>
              <option value="">{employees.length ? 'Select a team member…' : 'Loading…'}</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
        </section>
      )}

      {/* VIP rows */}
      <section className="mb-6">
        <h2 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-3 pb-2 border-b border-border">
          Your VIPs <span className="text-tile-sub font-medium normal-case tracking-normal">(up to 5)</span>
        </h2>
        <div className="flex flex-col gap-3">
          {vips.map((v, idx) => {
            const e = vipErr(v)
            return (
              <div key={v.id} className="rounded-lg border border-border bg-bg p-3 sm:p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-text-primary">VIP #{idx + 1}</span>
                  {vips.length > 1 && (
                    <button type="button" onClick={() => removeVip(v.id)}
                      className="text-[11px] font-semibold uppercase tracking-wider text-tile-sub hover:text-wcs-red">
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <FieldLabel required>First Name</FieldLabel>
                    <input className={inputClass} type="text" autoComplete="off" value={v.firstName}
                      onChange={ev => setVipField(v.id, 'firstName', ev.target.value)} />
                    {showFieldErrors && <FieldError msg={e.firstName} />}
                  </div>
                  <div>
                    <FieldLabel required>Last Name</FieldLabel>
                    <input className={inputClass} type="text" autoComplete="off" value={v.lastName}
                      onChange={ev => setVipField(v.id, 'lastName', ev.target.value)} />
                    {showFieldErrors && <FieldError msg={e.lastName} />}
                  </div>
                  <div className="sm:col-span-2">
                    <FieldLabel required>Phone</FieldLabel>
                    <input className={inputClass} type="tel" inputMode="tel" autoComplete="off" placeholder="(555) 555-5555"
                      value={v.phone} onChange={ev => setVipField(v.id, 'phone', ev.target.value)} />
                    {showFieldErrors && <FieldError msg={e.phone} />}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <button type="button" onClick={addVip} disabled={vips.length >= MAX_VIPS}
          className="mt-3 w-full py-3 rounded-lg border border-dashed border-border bg-transparent text-xs font-semibold uppercase tracking-wider text-text-primary hover:border-wcs-red hover:bg-wcs-red/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          + Add another VIP
        </button>
      </section>

      <button type="button" onClick={onSubmit} disabled={submitting}
        className="w-full py-3.5 rounded-lg bg-wcs-red text-white font-bold text-sm tracking-wider uppercase hover:bg-wcs-red-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
        {submitting ? 'Sending…' : 'Send Referrals'}
      </button>

      {statusMsg && (
        <p className={`mt-3 text-center text-xs ${statusKind === 'error' ? 'text-wcs-red' : 'text-text-muted'}`}>
          {statusMsg}
        </p>
      )}
    </div>
  )
}
