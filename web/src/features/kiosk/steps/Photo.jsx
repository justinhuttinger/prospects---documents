import { useRef, useState } from 'react'
import StepShell from '../StepShell'

export default function Photo({ state, dispatch, location, progress, onBack, onNext }) {
  const inputRef = useRef(null)
  const [preview, setPreview] = useState(state.member.photoBase64 || null)
  const [err, setErr] = useState('')

  function onFile(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setErr('Photo too big — keep it under 10 MB.')
      return
    }
    setErr('')
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      setPreview(dataUrl)
      dispatch({ type: 'patch', key: 'member', value: { photoBase64: dataUrl } })
    }
    reader.readAsDataURL(file)
  }

  function clearPhoto() {
    setPreview(null)
    dispatch({ type: 'patch', key: 'member', value: { photoBase64: null } })
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <StepShell
      location={location}
      current={progress.current} total={progress.total}
      title="Profile photo"
      subtitle="Snap a quick photo so the front desk can recognize you on check-in."
      onBack={onBack} onNext={onNext}
      nextLabel={preview ? 'Continue' : 'Skip for now'}
      error={err}
    >
      {preview ? (
        <div className="flex flex-col items-center gap-3">
          <img src={preview} alt="Captured" className="max-h-64 rounded-lg border border-border" />
          <button type="button" onClick={clearPhoto}
            className="text-xs font-semibold uppercase tracking-wider text-tile-sub hover:text-wcs-red">
            Retake
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-lg border-2 border-dashed border-border bg-bg p-10 text-center hover:border-wcs-red/40"
        >
          <div className="text-sm font-semibold text-text-primary">Take a photo</div>
          <div className="text-xs text-text-muted mt-1">Tap to open the camera</div>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={onFile}
      />
    </StepShell>
  )
}
