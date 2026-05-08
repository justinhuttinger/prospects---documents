import { useEffect, useRef, useState } from 'react'
import StepShell from '../StepShell'
import { checkDayOneAppointment } from '../../../lib/api'
import { digits } from '../../../lib/utils'

// TODO: paste the GHL Day One booking calendar embed URL here. Until then,
// staff sees a placeholder; the polling logic below still runs and will
// detect a booking made through any other channel for this contact.
const GHL_DAY_ONE_EMBED_URL = ''

const POLL_MS    = 5000
const SINCE_MIN  = 30
const MAX_POLLS  = 90 // ~7.5 minutes of polling at 5s intervals

function formatStart(s) {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function DayOne({ state, dispatch, location, progress, onBack, onNext }) {
  const d = state.dayOne
  const member = state.member
  const [polling, setPolling]   = useState(true)
  const [appointment, setAppointment] = useState(null)
  const [pollErr, setPollErr]   = useState('')
  const pollsRef = useRef(0)

  function setDayOne(value) {
    dispatch({ type: 'patch', key: 'dayOne', value })
  }

  useEffect(() => {
    if (!polling) return
    let cancelled = false

    async function tick() {
      pollsRef.current += 1
      if (pollsRef.current > MAX_POLLS) {
        if (!cancelled) setPolling(false)
        return
      }
      try {
        const result = await checkDayOneAppointment({
          location,
          phone: digits(member.phone),
          email: member.email.trim().toLowerCase(),
          sinceMinutes: SINCE_MIN,
        })
        if (cancelled) return
        const appts = (result && result.appointments) || []
        const next = appts.find(a => a && a.start) || appts[0]
        if (next) {
          setAppointment(next)
          setDayOne({
            booked:        'yes',
            datetime:      next.start || '',
            employeeName:  next.assignedUserName || '',
            appointmentId: next.id || '',
          })
          setPolling(false)
        }
      } catch (e) {
        if (cancelled) return
        // Don't surface a hard error — keep polling silently in the background.
        setPollErr(e.message || 'check failed')
      }
    }

    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, location, member.phone, member.email])

  function skipForNow() {
    setDayOne({ booked: 'no', datetime: '', employeeName: '', appointmentId: '' })
    onNext()
  }

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="Book your Day One"
      subtitle="Pick a time for your first session — we'll detect the booking automatically once it's confirmed."
      onBack={onBack} onNext={onNext}
      nextDisabled={!appointment}
      nextLabel={appointment ? 'Continue' : 'Waiting for booking…'}
    >
      <div className="rounded-lg border border-border bg-bg overflow-hidden mb-4">
        {GHL_DAY_ONE_EMBED_URL ? (
          <iframe
            src={GHL_DAY_ONE_EMBED_URL}
            title="Day One booking"
            className="w-full"
            style={{ height: 520, border: 0 }}
          />
        ) : (
          <div className="p-8 text-center text-sm text-text-muted">
            <div className="font-semibold text-text-primary mb-1">GHL calendar embed goes here</div>
            <div>Paste the Day One widget URL into <code>GHL_DAY_ONE_EMBED_URL</code> in <code>steps/DayOne.jsx</code>.</div>
          </div>
        )}
      </div>

      {appointment ? (
        <div className="rounded-lg border border-ok/30 bg-ok/5 p-4 mb-2">
          <div className="flex items-start gap-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5 text-ok flex-none mt-0.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <div>
              <div className="text-sm font-semibold text-text-primary">Day One confirmed</div>
              <div className="text-sm text-text-primary mt-1">{formatStart(appointment.start)}</div>
              {appointment.assignedUserName && (
                <div className="text-xs text-tile-sub mt-0.5">With {appointment.assignedUserName}</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="loading-card mx-0 my-2">Watching for the booking…</div>
      )}

      <button
        type="button"
        onClick={skipForNow}
        className="mt-3 w-full text-xs text-tile-sub hover:text-wcs-red font-semibold uppercase tracking-wider py-2"
      >
        Skip this step
      </button>

      {pollErr && pollsRef.current > 4 && (
        <p className="mt-2 text-center text-xs text-tile-sub">
          (Auto-detect having trouble — that's fine, you can skip this step and we'll record it manually.)
        </p>
      )}
    </StepShell>
  )
}
