import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { detectLocation, clubName } from '../lib/clubs'

const LINKS = [
  { to: '/vip',       label: 'VIP Referrals',          subtitle: 'Internal — with team member credit' },
  { to: '/vipx',      label: 'VIP Referrals (member)', subtitle: 'Member-facing version' },
  { to: '/form-page', label: 'PT Intake',              subtitle: 'Personal training program intake' },
]

export default function HomePage() {
  const location = detectLocation()
  return (
    <AppShell>
      <div className="bg-surface rounded-2xl border border-border p-8 sm:p-10">
        <div className="mb-8">
          <h1 className="text-2xl font-black text-text-primary">West Coast Strength</h1>
          <p className="text-sm text-text-muted mt-1">{clubName(location)}</p>
        </div>
        <div className="flex flex-col gap-3">
          {LINKS.map(l => (
            <Link
              key={l.to}
              to={l.to}
              className="flex items-center justify-between rounded-lg border border-border bg-bg px-4 py-3 hover:bg-wcs-red/5 hover:border-wcs-red/30 transition-colors"
            >
              <div>
                <div className="text-sm font-semibold text-text-primary">{l.label}</div>
                <div className="text-xs text-tile-sub mt-0.5">{l.subtitle}</div>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-text-muted">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  )
}
