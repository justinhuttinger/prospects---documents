import SuccessCard from '../../../components/SuccessCard'

export default function Done({ onReset }) {
  return (
    <div className="flex flex-col gap-4">
      <SuccessCard
        title="Tour complete!"
        message="Thanks — everything's been logged. Hand the iPad back to the team."
      />
      <button type="button" onClick={onReset}
        className="w-full py-3 rounded-lg border border-border bg-bg text-text-primary text-sm font-semibold hover:border-wcs-red/40">
        Start a new tour
      </button>
    </div>
  )
}
