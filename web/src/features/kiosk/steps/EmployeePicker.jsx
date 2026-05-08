import { useEffect, useState } from 'react'
import StepShell, { selectClass } from '../StepShell'
import { fetchEmployees } from '../../../lib/api'

export default function EmployeePicker({ state, dispatch, location, progress, onNext }) {
  const [employees, setEmployees] = useState([])
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchEmployees(location)
      .then(list => { if (!cancelled) setEmployees(list || []) })
      .catch(e => { if (!cancelled) setErr(e.message) })
    return () => { cancelled = true }
  }, [location])

  function handleNext() {
    const emp = employees.find(e => String(e.id) === String(state.employee.id))
    if (!emp) return
    dispatch({ type: 'patch', key: 'employee', value: { id: emp.id, name: emp.name } })
    onNext()
  }

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="Welcome — who's giving the tour?"
      subtitle="Pick yourself from the list. You'll get credit for the tour and any VIP referrals."
      onNext={handleNext}
      nextDisabled={!state.employee.id}
      showBack={false}
      error={err}
    >
      <select
        className={selectClass}
        value={state.employee.id}
        onChange={e => dispatch({ type: 'patch', key: 'employee', value: { id: e.target.value } })}
      >
        <option value="">{employees.length ? 'Select team member…' : 'Loading team members…'}</option>
        {employees.map(e => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
    </StepShell>
  )
}
