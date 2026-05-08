import { useMemo, useReducer } from 'react'
import { detectLocation } from '../../lib/clubs'
import { submitGhlForm, submitTourCompleted } from '../../lib/api'
import { digits } from '../../lib/utils'

import { initialState, nextStep, prevStep, progress, reducer, STEPS } from './state'
import EmployeePicker from './steps/EmployeePicker'
import MemberInfo from './steps/MemberInfo'
import LookupResult from './steps/LookupResult'
import PersonalDetails from './steps/PersonalDetails'
import Photo from './steps/Photo'
import HowHeard from './steps/HowHeard'
import Waiver from './steps/Waiver'
import TourQuestions from './steps/TourQuestions'
import VipStep from './steps/VipStep'
import DayOne from './steps/DayOne'
import TourSummary from './steps/TourSummary'
import Done from './steps/Done'

export default function KioskApp() {
  const location = useMemo(detectLocation, [])
  const [state, dispatch] = useReducer(reducer, initialState)

  function go(step) { dispatch({ type: 'setStep', step }) }
  function next() { go(nextStep(state)) }
  function back() { go(prevStep(state)) }
  function reset() { dispatch({ type: 'reset' }) }

  // After the waiver step finishes for a NEW member, fire the existing
  // /webhook/ghl-form pipeline (creates ABC prospect + waiver PDF + photo
  // + alert + check-in). This is the only step that hits the existing
  // backend in the same way the legacy GHL survey does today.
  async function finalizeWaiverThenAdvance() {
    if (state.lookup.found) { next(); return }
    dispatch({ type: 'setLoading', value: true })
    try {
      const result = await submitGhlForm({
        first_name:     state.member.firstName,
        last_name:      state.member.lastName,
        email:          state.member.email.trim().toLowerCase(),
        phone:          digits(state.member.phone),
        date_of_birth:  state.member.dob,
        address1:       state.member.address1,
        city:           state.member.city,
        state:          state.member.state,
        postal_code:    state.member.postalCode,
        Gender:         '',
        location: {
          name: `West Coast Strength - ${location.charAt(0).toUpperCase() + location.slice(1)}`,
        },
        member_profile_photo: state.member.photoBase64 || null,
        'Trial Start Date':   new Date().toISOString().split('T')[0],
        'Service Employee':   state.employee.name || '',
        // Waiver fields — typed signature for v1, swap to drawn signature
        // when the SignaturePad component lands.
        'Legal Signature': null,
        signed_by:         state.member.waiverSignatureName,
      })
      dispatch({
        type: 'set',
        key: 'lookup',
        value: { ...state.lookup, abcMemberId: result?.prospectId || state.lookup.abcMemberId },
      })
      dispatch({ type: 'setLoading', value: false })
      next()
    } catch (err) {
      dispatch({ type: 'error', message: `ABC submission failed: ${err.message}. You can still continue the tour.` })
    }
  }

  async function finishTour() {
    dispatch({ type: 'setLoading', value: true })
    try {
      await submitTourCompleted({
        location,
        member: {
          firstName:    state.member.firstName,
          lastName:     state.member.lastName,
          phone:        digits(state.member.phone),
          email:        state.member.email.trim().toLowerCase(),
          abcMemberId:  state.lookup.abcMemberId || '',
          wasExisting:  state.lookup.found,
        },
        employee: { id: state.employee.id, name: state.employee.name },
        vip: state.vip,
        dayOne: state.dayOne,
        tourQuestions: state.tourQuestions,
        tourOutcome: state.tourOutcome,
        tourSummary: state.tourSummary,
        submittedAt: new Date().toISOString(),
      })
      dispatch({ type: 'setLoading', value: false })
      go(STEPS.DONE)
    } catch (err) {
      dispatch({ type: 'error', message: `Final submission failed: ${err.message}.` })
    }
  }

  const p = progress(state)
  const common = { state, dispatch, location, progress: p, onBack: back }

  switch (state.step) {
    case STEPS.EMPLOYEE:
      return <EmployeePicker {...common} onNext={next} />
    case STEPS.MEMBER_INFO:
      return <MemberInfo {...common} onNext={next} />
    case STEPS.LOOKUP_RESULT:
      return <LookupResult {...common} onNext={next} />
    case STEPS.PERSONAL_DETAILS:
      return <PersonalDetails {...common} onNext={next} />
    case STEPS.PHOTO:
      return <Photo {...common} onNext={next} />
    case STEPS.HOW_HEARD:
      return <HowHeard {...common} onNext={next} />
    case STEPS.WAIVER:
      return <Waiver {...common} onNext={finalizeWaiverThenAdvance} />
    case STEPS.TOUR_QUESTIONS:
      return <TourQuestions {...common} onNext={next} />
    case STEPS.VIP:
      return <VipStep {...common} onNext={next} />
    case STEPS.DAY_ONE:
      return <DayOne {...common} onNext={next} />
    case STEPS.SUMMARY:
      return <TourSummary {...common} onNext={finishTour} loading={state.loading} error={state.error} />
    case STEPS.DONE:
      return <Done onReset={reset} />
    default:
      return null
  }
}
