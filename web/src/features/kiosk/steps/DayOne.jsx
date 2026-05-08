import { useEffect, useRef, useState } from 'react'
import StepShell from '../StepShell'
import { checkDayOneBooked } from '../../../lib/api'
import { digits } from '../../../lib/utils'

// TODO: paste the GHL Day One booking calendar embed URL here. Until then,
// staff sees a placeholder; the polling logic below still runs and will
// detect the booking via the GHL custom field that WCS workflows set when
// a Day One is booked.
const GHL_DAY_ONE_EMBED_URL = ''

const POLL_MS    = 5000
const MAX_POLLS  = 120 // ~10 minutes of polling at 5s intervals

function formatStart(s) {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function DayOne({ state, dispatch, location, progress, onBack, onNext }) {
  const member = state.member
  const [polling, setPolling] = useState(true)
  const [booked, setBooked]   = useState(false)
  const [details, setDetails] = useState({ datetime: '', employeeName: '' })
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
        const result = await checkDayOneBooked({
          location,
          phone: digits(member.phone),
          email: member.email.trim().toLowerCase(),
        })
        if (cancelled) return
        if (result && result.day_one_booked) {
          const next = {
            datetime:     result.day_one_datetime || '',
            employeeName: result.day_one_employee_name || '',
          }
          setDetails(next)
          setBooked(true)
          setDayOne({
            booked:        'yes',
            datetime:      next.datetime,
            employeeName:  next.employeeName,
            appointmentId: '',
          })
          setPolling(false)
        }
      } catch (e) {
        // Silent — keep polling. The skip button is the escape hatch.
      }
    }

    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling, location, member.phone, member.email])

  // The red "Next" bar is BOTH a skip and a complete-step button: if
  // polling has already detected a booking, dayOne is already populated
  // (booked='yes' + datetime + employee). If not, it stays as the
  // initial-state {booked:'no', ...} and we advance as a skip.
  function handleNext() {
    if (!booked) {
      setDayOne({ booked: 'no', datetime: '', employeeName: '', appointmentId: '' })
    }
    onNext()
  }

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="Book your Day One"
      subtitle="Pick a time inside the calendar — we'll detect the booking automatically once it's confirmed."
      onBack={onBack} onNext={handleNext}
      nextLabel="Next"
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

      {booked ? (
        <div className="rounded-lg border border-ok/30 bg-ok/5 p-4 mb-2">
          <div className="flex items-start gap-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5 text-ok flex-none mt-0.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <div>
              <div className="text-sm font-semibold text-text-primary">Day One confirmed</div>
              {details.datetime && <div className="text-sm text-text-primary mt-1">{formatStart(details.datetime)}</div>}
              {details.employeeName && (
                <div className="text-xs text-tile-sub mt-0.5">With {details.employeeName}</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="loading-card mx-0 my-2">Watching for the booking…</div>
      )}
    </StepShell>
  )
}
