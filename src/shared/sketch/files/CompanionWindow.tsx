import { ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAssetUrl } from '@/core/assets'
import type { SketchEngine } from '../engine'
import { exportLayers } from '../layers'
import type { SketchDoc } from '../model'
import { ReferencePicker } from '../ReferencePicker'
import { zoomOf } from '@/shared/zoom'

const UI = {
  canvas: 'Canvas',
  image: 'Image',
  pick: 'Pick an image',
  close: 'Close the Reference Companion',
  noImage: 'Pick an image to show here.',
}

/** How often the live canvas view redraws at most, in ms. */
const REDRAW_MS = 250

type Companion = NonNullable<SketchDoc['companion']>

/**
 * Reference Companion (Sketch Pro): a small floating window that shows the whole
 * picture while you work zoomed in, or any image to draw from.
 */
export function CompanionWindow(p: { doc: SketchDoc; engine: SketchEngine; companion: Companion; onChange(patch: Partial<Companion>): void; onClose(): void }) {
  const { companion: c, doc, engine } = p
  const [picking, setPicking] = useState(false)
  const url = useAssetUrl(c.mode === 'image' ? c.image : null)
  const view = useRef<HTMLCanvasElement>(null)
  const last = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ doc, engine })
  useEffect(() => {
    latest.current = { doc, engine }
  })

  // The live canvas, redrawn now and then (never during a stroke, which keeps drawing fast).
  useEffect(() => {
    if (c.mode !== 'canvas') return
    const draw = () => {
      timer.current = null
      const canvas = view.current
      const { doc: d, engine: e } = latest.current
      if (!canvas) return
      if (e.stroking) {
        timer.current = setTimeout(draw, REDRAW_MS)
        return
      }
      last.current = Date.now()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(c.width * dpr)
      canvas.height = Math.round(((c.width * d.height) / d.width) * dpr)
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingQuality = 'high'
      if (d.backgroundColor) {
        ctx.fillStyle = d.backgroundColor
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      ctx.drawImage(e.render({ ...d, layers: exportLayers(d.layers) }, false), 0, 0, canvas.width, canvas.height)
    }
    if (timer.current) return
    const wait = REDRAW_MS - (Date.now() - last.current)
    if (wait <= 0) draw()
    else timer.current = setTimeout(draw, wait)
  })
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const drag = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX
    const sy = e.clientY
    const start = { x: c.x, y: c.y, width: c.width }
    const z = zoomOf(e.currentTarget)
    const move = (ev: PointerEvent) =>
      p.onChange(mode === 'move' ? { x: start.x + (ev.clientX - sx) / z, y: start.y + (ev.clientY - sy) / z } : { width: Math.max(120, start.width + (ev.clientX - sx) / z) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="sketch-ref sketch-companion" style={{ left: c.x, top: c.y, width: c.width }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="sketch-ref-bar sketch-companion-bar" onPointerDown={drag('move')}>
        {(['canvas', 'image'] as const).map((m) => (
          <button key={m} className={`sketch-companion-tab${c.mode === m ? ' is-active' : ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => p.onChange({ mode: m })}>
            {m === 'canvas' ? UI.canvas : UI.image}
          </button>
        ))}
        <span className="sketch-spacer" />
        {c.mode === 'image' && (
          <button className="icon-btn" title={UI.pick} onPointerDown={(e) => e.stopPropagation()} onClick={() => setPicking(true)}>
            <ImagePlus size={12} />
          </button>
        )}
        <button className="icon-btn" title={UI.close} onPointerDown={(e) => e.stopPropagation()} onClick={p.onClose}>
          <X size={12} />
        </button>
      </div>
      {c.mode === 'canvas' ? (
        <canvas ref={view} className="sketch-companion-view" style={{ width: c.width, height: (c.width * doc.height) / doc.width }} />
      ) : url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <button className="sketch-companion-empty" onClick={() => setPicking(true)}>
          {UI.noImage}
        </button>
      )}
      <div className="sketch-ref-resize" onPointerDown={drag('resize')} />
      {picking && (
        <ReferencePicker
          onPick={(image) => {
            setPicking(false)
            if (image) p.onChange({ image, mode: 'image' })
          }}
        />
      )}
    </div>
  )
}
