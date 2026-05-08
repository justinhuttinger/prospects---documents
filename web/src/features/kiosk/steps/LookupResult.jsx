import StepShell from '../StepShell'

function formatLastVisit(s) {
  if (!s) return 'No prior check-in on file'
  // ABC returns "YYYY-MM-DD HH:mm:ss.fff..." style; keep it readable
  const d = new Date(String(s).replace(' ', 'T'))
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export default function LookupResult({ state, location, progress, onBack, onNext }) {
  const found = state.lookup.found
  const fullName = `${state.member.firstName} ${state.member.lastName}`.trim()

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title={found ? `Welcome back, ${state.member.firstName || 'friend'}!` : `Nice to meet you${state.member.firstName ? ', ' + state.member.firstName : ''}`}
      subtitle={
        found
          ? "We've got you on file — we'll skip the new-member paperwork and jump straight to your tour."
          : "We'll get a few quick details and set up your account before the tour starts."
      }
      onBack={onBack} onNext={onNext}
      nextLabel={found ? 'Start Tour' : "Let's go"}
    >
      {found ? (
        <div className="rounded-lg border border-border bg-bg p-4">
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <div className="text-tile-sub">Name</div>
            <div className="font-semibold text-text-primary">{fullName || '—'}</div>
            <div className="text-tile-sub">ABC Member ID</div>
            <div className="font-mono text-xs text-text-primary">{state.lookup.abcMemberId || '—'}</div>
            <div className="text-tile-sub">Last Check-In</div>
            <div className="text-text-primary">{formatLastVisit(state.lookup.lastVisit)}</div>
            <div className="text-tile-sub">Profile Photo</div>
            <div className="text-text-primary">{state.lookup.hasPhoto ? 'On file' : 'None — we\'ll grab one'}</div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-bg p-4 text-sm text-text-muted">
          We didn't find a matching account by phone or email, so we'll set you up as a new member.
        </div>
      )}
    </StepShell>
  )
}
