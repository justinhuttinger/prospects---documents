export default function SuccessCard({ title = 'Thanks!', message }) {
  return (
    <div className="bg-surface rounded-2xl border border-border p-8 sm:p-10 text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-wcs-red text-white">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-7 w-7">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-text-primary mb-2">{title}</h2>
      {message && <p className="text-sm text-text-muted">{message}</p>}
    </div>
  )
}
