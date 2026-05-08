import { useRef, useState } from 'react'
import StepShell, { inputClass } from '../StepShell'
import { submitVipReferrals } from '../../../lib/api'
import { digits, formatPhone, isValidPhone } from '../../../lib/utils'

const MAX = 5

export default function VipStep({ state, dispatch, location, progress, onBack, onNext }) {
  const [rows, setRows] = useState([{ id: 1, firstName: '', lastName: '', phone: '' }])
  const nextId = useRef(2)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  function set(id, key, value) {
    setRows(list => list.map(v =>
      v.id === id ? { ...v, [key]: key === 'phone' ? formatPhone(value) : value } : v
    ))
  }
  function add() {
    if (rows.length >= MAX) return
    setRows(list => [...list, { id: nextId.current++, firstName: '', lastName: '', phone: '' }])
  }
  function remove(id) {
    setRows(list => list.filter(v => v.id !== id))
  }

  const validRows = rows.filter(r => r.firstName.trim() && r.lastName.trim() && isValidPhone(r.phone))

  async function handleSubmitAndContinue() {
    if (validRows.length === 0) {
      // Skipping — record an empty VIP outcome and move on
      dispatch({ type: 'set', key: 'vip', value: { count: 0, names: [], phones: [] } })
      onNext()
      return
    }
    setErr('')
    setSubmitting(true)
    try {
      const body = {
        location,
        member: {
          firstName: state.member.firstName.trim(),
          lastName:  state.member.lastName.trim(),
          phone:     digits(state.member.phone),
          email:     state.member.email.trim().toLowerCase() || null,
        },
        employee: { id: state.employee.id, name: state.employee.name },
        vips: validRows.map(v => ({
          firstName: v.firstName.trim(),
          lastName:  v.lastName.trim(),
          phone:     digits(v.phone),
        })),
        submittedAt: new Date().toISOString(),
      }
      const result = await submitVipReferrals(body)
      const fired = result?.fired ?? validRows.length
      dispatch({
        type: 'set',
        key: 'vip',
        value: {
          count: fired,
          names: validRows.map(v => `${v.firstName} ${v.lastName}`.trim()),
          phones: validRows.map(v => digits(v.phone)),
        },
      })
      onNext()
    } catch (e) {
      setSubmitting(false)
      setErr(`Submission failed: ${e.message}.`)
    }
  }

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="Refer your VIPs"
      subtitle="Know up to 5 friends who'd love this place? Add them now and we'll reach out."
      onBack={onBack} onNext={handleSubmitAndContinue}
      nextLabel={validRows.length ? `Send ${validRows.length} & continue` : 'Skip'}
      loading={submitting}
      error={err}
    >
      <div className="flex flex-col gap-3">
        {rows.map((r, idx) => (
          <div key={r.id} className="rounded-lg border border-border bg-bg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-text-primary">VIP #{idx + 1}</span>
              {rows.length > 1 && (
                <button type="button" onClick={() => remove(r.id)}
                  className="text-[11px] font-semibold uppercase tracking-wider text-tile-sub hover:text-wcs-red">
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input className={inputClass} type="text" placeholder="First name"
                value={r.firstName} onChange={e => set(r.id, 'firstName', e.target.value)} />
              <input className={inputClass} type="text" placeholder="Last name"
                value={r.lastName} onChange={e => set(r.id, 'lastName', e.target.value)} />
              <input className={inputClass + ' sm:col-span-2'} type="tel" inputMode="tel"
                placeholder="(555) 555-5555"
                value={r.phone} onChange={e => set(r.id, 'phone', e.target.value)} />
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} disabled={rows.length >= MAX}
        className="mt-3 w-full py-3 rounded-lg border border-dashed border-border bg-transparent text-xs font-semibold uppercase tracking-wider text-text-primary hover:border-wcs-red hover:bg-wcs-red/5 disabled:opacity-40">
        + Add another VIP
      </button>
    </StepShell>
  )
}
