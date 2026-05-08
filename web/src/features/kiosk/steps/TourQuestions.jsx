import StepShell, { inputClass } from '../StepShell'

// TODO: confirm the actual question list with WCS before launch. These are
// placeholders that already submit through to GHL as flat tour_q_* keys
// via routes/kiosk.js.
const QUESTIONS = [
  {
    key: 'currentlyAtAnotherGym',
    label: 'Are you currently at another gym?',
    type: 'yesNo',
    followUp: { whenYes: 'otherGymName', label: 'Which one?', placeholder: 'Gym name' },
  },
  {
    key: 'primaryGoal',
    label: 'Primary fitness goal?',
    type: 'choice',
    options: ['Lose weight', 'Build muscle', 'Get stronger', 'Improve health', 'Other'],
  },
  {
    key: 'timeline',
    label: 'When do you want to start?',
    type: 'choice',
    options: ['Today', 'This week', 'This month', 'Just exploring'],
  },
  {
    key: 'referralSource',
    label: 'Anyone we should thank for sending you?',
    type: 'text',
    placeholder: 'Name (optional)',
    optional: true,
  },
]

function YesNo({ value, onChange }) {
  return (
    <div className="flex gap-2">
      {['no', 'yes'].map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={
            'flex-1 px-4 py-3 rounded-lg border text-sm font-semibold uppercase tracking-wider transition-colors ' +
            (value === opt
              ? 'bg-wcs-red text-white border-wcs-red'
              : 'bg-bg text-text-primary border-border hover:border-wcs-red/40')
          }
        >
          {opt === 'yes' ? 'Yes' : 'No'}
        </button>
      ))}
    </div>
  )
}

function ChoiceGroup({ value, options, onChange }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={
            'rounded-lg border px-4 py-3 text-sm font-semibold transition-colors text-left ' +
            (value === opt
              ? 'bg-wcs-red text-white border-wcs-red'
              : 'bg-bg text-text-primary border-border hover:border-wcs-red/40')
          }
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

export default function TourQuestions({ state, dispatch, location, progress, onBack, onNext }) {
  const q = state.tourQuestions
  function set(key, value) {
    dispatch({ type: 'patch', key: 'tourQuestions', value: { [key]: value } })
  }
  const allAnswered = QUESTIONS.every(qi => qi.optional || q[qi.key])

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="A few quick questions"
      subtitle="Helps us tailor the tour."
      onBack={onBack} onNext={onNext}
      nextDisabled={!allAnswered}
    >
      <div className="flex flex-col gap-5">
        {QUESTIONS.map(qi => (
          <div key={qi.key}>
            <div className="text-sm font-semibold text-text-primary mb-2">
              {qi.label}
              {!qi.optional && <span className="ml-1 text-wcs-red font-bold">*</span>}
            </div>
            {qi.type === 'yesNo' && (
              <>
                <YesNo value={q[qi.key]} onChange={v => set(qi.key, v)} />
                {qi.followUp && q[qi.key] === 'yes' && (
                  <input
                    className={inputClass + ' mt-2'}
                    type="text"
                    placeholder={qi.followUp.placeholder}
                    value={q[qi.followUp.whenYes] || ''}
                    onChange={e => set(qi.followUp.whenYes, e.target.value)}
                  />
                )}
              </>
            )}
            {qi.type === 'choice' && (
              <ChoiceGroup value={q[qi.key]} options={qi.options} onChange={v => set(qi.key, v)} />
            )}
            {qi.type === 'text' && (
              <input
                className={inputClass}
                type="text"
                placeholder={qi.placeholder}
                value={q[qi.key] || ''}
                onChange={e => set(qi.key, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>
    </StepShell>
  )
}
