import { useRef, useState } from 'react'
import StepShell from '../StepShell'

const MAX_DIM   = 1024  // px — max width or height after downscale
const JPEG_Q    = 0.85  // 0–1
const MAX_INPUT = 25 * 1024 * 1024 // 25 MB raw camera shot ceiling

// iPhones sometimes hand us HEIC, which ABC's /pictures endpoint rejects
// silently. Re-encode every capture through a canvas to JPEG so the
// upstream upload is always portable.
function fileToJpegDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read photo'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error("Couldn't decode photo — please pick a different one."))
      img.onload = () => {
        let { width, height } = img
        const scale = Math.min(1, MAX_DIM / Math.max(width, height))
        width  = Math.round(width  * scale)
        height = Math.round(height * scale)
        const canvas = document.createElement('canvas')
        canvas.width  = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        try {
          resolve(canvas.toDataURL('image/jpeg', JPEG_Q))
        } catch (e) {
          reject(e)
        }
      }
      img.src = String(reader.result || '')
    }
    reader.readAsDataURL(file)
  })
}

export default function Photo({ state, dispatch, location, progress, onBack, onNext }) {
  const inputRef = useRef(null)
  const [preview, setPreview] = useState(state.member.photoBase64 || null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function onFile(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    if (file.size > MAX_INPUT) {
      setErr('Photo too big — keep it under 25 MB.')
      return
    }
    setErr('')
    setBusy(true)
    try {
      const jpegDataUrl = await fileToJpegDataUrl(file)
      setPreview(jpegDataUrl)
      dispatch({ type: 'patch', key: 'member', value: { photoBase64: jpegDataUrl } })
    } catch (ex) {
      setErr(ex.message || 'Could not process photo')
    } finally {
      setBusy(false)
    }
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
      loading={busy}
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
          disabled={busy}
        >
          <div className="text-sm font-semibold text-text-primary">{busy ? 'Processing…' : 'Take a photo'}</div>
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
