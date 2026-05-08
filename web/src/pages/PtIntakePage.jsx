import AppShell from '../components/AppShell'
import PtIntakeForm from '../features/pt-intake/PtIntakeForm'

export default function PtIntakePage() {
  return (
    <AppShell maxWidth="max-w-2xl">
      <PtIntakeForm />
    </AppShell>
  )
}
