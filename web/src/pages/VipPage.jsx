import AppShell from '../components/AppShell'
import VipForm from '../features/vip/VipForm'

export default function VipPage({ variant }) {
  return (
    <AppShell>
      <VipForm variant={variant} />
    </AppShell>
  )
}
