import AppShell from '../components/AppShell'
import KioskApp from '../features/kiosk/KioskApp'

export default function KioskPage() {
  return (
    <AppShell maxWidth="max-w-2xl">
      <KioskApp />
    </AppShell>
  )
}
