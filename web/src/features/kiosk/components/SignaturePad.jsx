import { useEffect, useRef, useState } from 'react'

// Canvas-based signature pad. Captures mouse, touch, and Apple Pencil
// strokes via Pointer Events. Returns a base64 PNG data URL via the
// onChange callback (or null when the pad is cleared).
export default function SignaturePad({ value, onChange, height = 220 }) {
  const wrapRef   = useRef(null)
  const canvasRef = useRef(null)
  const drawing   = useRef(false)
  const last      = useRef({ x: 0, y: 0 })
  const [empty, setEmpty] = useState(!value)

  // Resize the canvas to its CSS size + devicePixelRatio whenever the
  // wrapper changes width. Keeps strokes crisp on retina iPads.
  useEffect(() => {
    function resize() {
      const wrap = wrapRef.current
      const canvas = canvasRef.current
      if (!wrap || !canvas) return
      const dpr = window.devicePixelRatio || 1
      const cssW = wrap.clientWidth
      canvas.width  = Math.round(cssW * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width  = cssW + 'px'
      canvas.style.height = height + 'px'
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      ctx.lineCap     = 'round'
      ctx.lineJoin    = 'round'
      ctx.strokeStyle = '#0a0a0a'
      ctx.lineWidth   = 2.2
      // Re-paint existing signature if one was passed in
      if (value) {
        const img = new Image()
        img.onload = () => ctx.drawImage(img, 0, 0, cssW, height)
        img.src = value
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height])

  function pointFromEvent(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function start(e) {
    e.preventDefault()
    const canvas = canvasRef.current
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId) } catch (_) {}
    }
    drawing.current = true
    last.current = pointFromEvent(e)
    setEmpty(false)
  }

  function move(e) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const p = pointFromEvent(e)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
  }

  function end(e) {
    if (!drawing.current) return
    drawing.current = false
    const dataUrl = canvasRef.current.toDataURL('image/png')
    onChange && onChange(dataUrl)
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
    setEmpty(true)
    onChange && onChange(null)
  }

  return (
    <div ref={wrapRef} className="w-full">
      <div className="relative rounded-lg border border-border bg-bg overflow-hidden" style={{ height }}>
        <canvas
          ref={canvasRef}
          className="block touch-none w-full h-full"
          style={{ touchAction: 'none' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        />
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-tile-sub uppercase tracking-wider font-semibold">
            Sign here
          </div>
        )}
      </div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-[11px] text-tile-sub">Use your finger or Apple Pencil.</span>
        <button
          type="button"
          onClick={clear}
          className="text-[11px] font-semibold uppercase tracking-wider text-tile-sub hover:text-wcs-red"
        >
          Clear
        </button>
      </div>
    </div>
  )
}
