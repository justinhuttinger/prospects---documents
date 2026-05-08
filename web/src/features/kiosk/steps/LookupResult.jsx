import StepShell from '../StepShell'

function formatLastVisit(s) {
  if (!s) return 'No prior check-in on file'
  const d = new Date(String(s).replace(' ', 'T'))
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export default function LookupResult({ state, dispatch, location, progress, onBack, onNext }) {
  const { match, candidates, found } = state.lookup
  const fullName = `${state.member.firstName} ${state.member.lastName}`.trim()

  // Atomic dispatch: switch lookup AND advance in one action so the new
  // step is computed against the freshly-set lookup (otherwise React's
  // async state batching means the flow array still treats the user as
  // a new member when nextStep runs).
  function pickCandidate(c) {
    dispatch({
      type: 'setAndAdvance',
      lookup: {
        match:        'exact',
        candidates,
        found:        true,
        abcMemberId:  c.abc_member_id,
        lastVisit:    c.last_visit || null,
        hasPhoto:     !!c.has_photo,
        memberStatus: c.member_status || null,
      },
      member: {
        firstName: state.member.firstName || c.first_name || '',
        lastName:  state.member.lastName  || c.last_name  || '',
      },
    })
  }

  function declineAndProceedAsNew() {
    dispatch({
      type: 'setAndAdvance',
      lookup: { match: 'none', candidates: [], found: false, abcMemberId: null, lastVisit: null, hasPhoto: false, memberStatus: null },
    })
  }

  // EXACT match: phone + email + name all agree on a single record.
  if (match === 'exact' && found) {
    return (
      <StepShell
        location={location}
        current={progress.current} total={progress.total}
        title={`Welcome back, ${state.member.firstName || 'friend'}!`}
        subtitle="We've got you on file — we'll skip the new-member paperwork and jump straight to your tour."
        onBack={onBack} onNext={onNext}
        nextLabel="Start Tour"
      >
        <div className="rounded-lg border border-border bg-bg p-4">
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <div className="text-tile-sub">Name</div>
            <div className="font-semibold text-text-primary">{fullName || '—'}</div>
            <div className="text-tile-sub">Last Check-In</div>
            <div className="text-text-primary">{formatLastVisit(state.lookup.lastVisit)}</div>
            <div className="text-tile-sub">Profile Photo</div>
            <div className="text-text-primary">{state.lookup.hasPhoto ? 'On file' : "None — we'll grab one"}</div>
          </div>
        </div>
      </StepShell>
    )
  }

  // PARTIAL match: at least one candidate, but we couldn't auto-confirm.
  // Show "Is this you?" picker.
  if (match === 'partial' && candidates && candidates.length > 0) {
    return (
      <StepShell
        location={location}
        current={progress.current} total={progress.total}
        title="Is this you?"
        subtitle="We found a possible match but want to be sure before continuing."
        showNext={false}
        onBack={onBack}
      >
        <div className="flex flex-col gap-2">
          {candidates.map(c => (
            <button
              key={c.abc_member_id}
              type="button"
              onClick={() => pickCandidate(c)}
              className="w-full text-left rounded-lg border border-border bg-bg hover:border-wcs-red/40 p-4 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">
                    {c.first_name} {c.last_name}
                  </div>
                  <div className="text-xs text-tile-sub mt-0.5">
                    Last check-in: {formatLastVisit(c.last_visit)}
                  </div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-text-muted flex-none">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={declineAndProceedAsNew}
            className="w-full mt-2 rounded-lg border border-dashed border-border bg-transparent text-text-primary hover:border-wcs-red/40 hover:bg-bg p-4 text-center text-sm font-semibold"
          >
            None of these — set me up as new
          </button>
        </div>
      </StepShell>
    )
  }

  // NONE: brand-new member.
  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title={`Nice to meet you${state.member.firstName ? ', ' + state.member.firstName : ''}`}
      subtitle="We'll get a few quick details and set up your account before the tour starts."
      onBack={onBack} onNext={onNext}
      nextLabel="Let's go"
    >
      <div className="rounded-lg border border-border bg-bg p-4 text-sm text-text-muted">
        We didn't find a matching account by phone or email, so we'll set you up as a new member.
      </div>
    </StepShell>
  )
}
