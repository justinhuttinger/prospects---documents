// Centered card container, matches the staff portal's page layout
// (bg-bg page, white card on top, rounded-2xl border).
export default function AppShell({ children, maxWidth = 'max-w-xl' }) {
  return (
    <div className="min-h-screen bg-bg flex items-start sm:items-center justify-center p-4 sm:p-6">
      <div className={`${maxWidth} w-full`}>{children}</div>
    </div>
  )
}
