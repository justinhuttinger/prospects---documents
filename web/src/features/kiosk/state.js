// Single source of truth for the kiosk session. Reducer-driven so step
// transitions are predictable and we can render the right step from one
// state.step value. The actual conditional flow (skip-if-existing-and-
// has-photo, etc.) lives in `nextStep` below.

export const STEPS = {
  EMPLOYEE:         'employee',
  MEMBER_INFO:      'memberInfo',
  LOOKUP_RESULT:    'lookupResult',
  PERSONAL_DETAILS: 'personalDetails',
  PHOTO:            'photo',
  HOW_HEARD:        'howHeard',
  WAIVER:           'waiver',
  TOUR_QUESTIONS:   'tourQuestions',
  VIP:              'vip',
  DAY_ONE:          'dayOne',
  SUMMARY:          'summary',
  DONE:             'done',
}

// Sequence for a brand-new member (full tour intake).
const NEW_MEMBER_FLOW = [
  STEPS.EMPLOYEE,
  STEPS.MEMBER_INFO,
  STEPS.LOOKUP_RESULT,
  STEPS.PERSONAL_DETAILS,
  STEPS.PHOTO,
  STEPS.HOW_HEARD,
  STEPS.WAIVER,
  STEPS.TOUR_QUESTIONS,
  STEPS.VIP,
  STEPS.DAY_ONE,
  STEPS.SUMMARY,
  STEPS.DONE,
]

// Sequence for an existing member — skip prospect-creation steps.
const RETURNING_MEMBER_FLOW = [
  STEPS.EMPLOYEE,
  STEPS.MEMBER_INFO,
  STEPS.LOOKUP_RESULT,
  STEPS.PHOTO,            // only shown if !hasPhoto (UI-level skip)
  STEPS.TOUR_QUESTIONS,
  STEPS.VIP,
  STEPS.DAY_ONE,
  STEPS.SUMMARY,
  STEPS.DONE,
]

export const initialState = {
  step: STEPS.EMPLOYEE,

  employee: { id: '', name: '' },

  member: {
    firstName: '', lastName: '', phone: '', email: '',
    dob: '',
    address1: '', city: '', state: '', postalCode: '',
    photoBase64: null,
    howHeard: '',
    waiverAgreed: false,
    waiverSignatureName: '',
  },

  // Populated by the lookup step. `match` is 'exact' | 'partial' | 'none'.
  // candidates is whatever the backend returned, kept as-is so the
  // LookupResult step can render an "is this you?" picker for partial.
  // After the user confirms (or declines), we set `found` + the chosen
  // candidate's fields.
  lookup: {
    match: 'none',
    candidates: [],
    found: false,
    abcMemberId: null,
    lastVisit: null,
    hasPhoto: false,
    memberStatus: null,
  },

  tourQuestions: {
    currentlyAtAnotherGym: '',
    otherGymName: '',
    primaryGoal: '',
    timeline: '',
    referralSource: '',
  },

  // Populated after the VIP step submits
  vip: { count: 0, names: [], phones: [] },

  dayOne: { booked: 'no', datetime: '', employeeName: '', appointmentId: '' },

  tourOutcome: '', // 'started_trial' | 'day_pass' | 'just_a_tour' | 'sold_membership'
  tourSummary: '',

  // For inline UX feedback at the kiosk shell level
  loading: false,
  error: null,
}

export function reducer(state, action) {
  switch (action.type) {
    case 'set':
      return { ...state, [action.key]: action.value }
    case 'patch':
      return { ...state, [action.key]: { ...state[action.key], ...action.value } }
    case 'setStep':
      return { ...state, step: action.step, error: null }
    case 'setLoading':
      return { ...state, loading: !!action.value, error: action.value ? null : state.error }
    case 'error':
      return { ...state, loading: false, error: action.message }
    case 'reset':
      return { ...initialState }
    default:
      return state
  }
}

/** Pick the next step based on current state. Encodes the new vs returning
 *  member branch and the "skip photo if has_photo" rule. */
export function nextStep(state) {
  const flow = state.lookup.found ? RETURNING_MEMBER_FLOW : NEW_MEMBER_FLOW
  const idx = flow.indexOf(state.step)
  if (idx === -1) return state.step

  for (let i = idx + 1; i < flow.length; i += 1) {
    const candidate = flow[i]
    // Skip photo if returning member already has one
    if (candidate === STEPS.PHOTO && state.lookup.found && state.lookup.hasPhoto) continue
    return candidate
  }
  return STEPS.DONE
}

export function prevStep(state) {
  const flow = state.lookup.found ? RETURNING_MEMBER_FLOW : NEW_MEMBER_FLOW
  const idx = flow.indexOf(state.step)
  if (idx <= 0) return state.step
  for (let i = idx - 1; i >= 0; i -= 1) {
    const candidate = flow[i]
    if (candidate === STEPS.PHOTO && state.lookup.found && state.lookup.hasPhoto) continue
    return candidate
  }
  return state.step
}

export function progress(state) {
  const flow = state.lookup.found ? RETURNING_MEMBER_FLOW : NEW_MEMBER_FLOW
  const visible = flow.filter(s => !(s === STEPS.PHOTO && state.lookup.found && state.lookup.hasPhoto) && s !== STEPS.DONE)
  const idx = visible.indexOf(state.step)
  return { current: idx + 1, total: visible.length }
}
