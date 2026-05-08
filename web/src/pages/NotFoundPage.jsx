import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'

export default function NotFoundPage() {
  return (
    <AppShell>
      <div className="bg-surface rounded-2xl border border-border p-8 sm:p-10 text-center">
        <h1 className="text-2xl font-black text-text-primary">Page not found</h1>
        <p className="text-sm text-text-muted mt-2">That URL isn't part of this site.</p>
        <Link to="/" className="inline-block mt-6 rounded-lg bg-wcs-red text-white font-semibold text-sm px-5 py-2.5 hover:bg-wcs-red-hover transition-colors">
          Back to home
        </Link>
      </div>
    </AppShell>
  )
}
