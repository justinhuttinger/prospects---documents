import { detectLocation } from '../lib/clubs'

// Centered card on top of a per-club background photo. Same pattern the
// staff portal uses on its LoginScreen — fixed photo, dark overlay, then
// the card sits in normal flow on top.
export default function AppShell({ children, maxWidth = 'max-w-xl' }) {
  const slug = detectLocation()
  const bgUrl = `/bg-${slug}.jpg`

  return (
    <div className="min-h-screen relative">
      <div
        className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${bgUrl})` }}
      />
      <div className="fixed inset-0 z-0 bg-black/60" />
      <div className="relative z-10 flex items-start sm:items-center justify-center min-h-screen p-4 sm:p-6">
        <div className={`${maxWidth} w-full`}>{children}</div>
      </div>
    </div>
  )
}
