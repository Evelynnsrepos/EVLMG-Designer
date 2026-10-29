import { X } from 'lucide-react'
import { useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { zoomOf } from '@/shared/zoom'

/**
 * A panel that floats over the canvas (Sketch Pro): drag it by its bar, it snaps
 * to the window edges, and it remembers where it was. It always stays inside the
 * window, even after the window or the tool's zoom got smaller.
 */

export interface Spot {
  x: number
  y: number
}

const SNAP = 24

function remembered(key: string, fallback: Spot): Spot {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Spot | null
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return v
  } catch {
    // Only a convenience.
  }
  return fallback
}

/** `s` moved so the whole panel width and its bar are inside the window (`z` = the tool's zoom). */
export function onScreen(s: Spot, width: number, z = 1): Spot {
  const w = window.innerWidth / z
  const h = window.innerHeight / z
  return { x: Math.max(0, Math.min(w - width, s.x)), y: Math.max(0, Math.min(h - 40, s.y)) }
}

/** Where a floating panel sits, kept per panel in this browser. */
export function useSpot(key: string, fallback: () => Spot): [Spot, (s: Spot) => void] {
  const [spot, setSpot] = useState(() => remembered(key, fallback()))
  const set = (s: Spot) => {
    setSpot(s)
    try {
      localStorage.setItem(key, JSON.stringify(s))
    } catch {
      // Only a convenience.
    }
  }
  return [spot, set]
}

export function FloatingPanel(p: { title: string; at: Spot; onMove(s: Spot): void; onClose?: () => void; actions?: ReactNode; width?: number; children: ReactNode }) {
  const width = p.width ?? 280
  const ref = useRef<HTMLDivElement>(null)
  // Read the tool's zoom once mounted, and draw again whenever the window changes size.
  const [z, setZ] = useState(1)
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  useLayoutEffect(() => {
    const fit = () => {
      setZ(zoomOf(ref.current))
      redraw()
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  const at = onScreen(p.at, width, z)
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const z = zoomOf(e.currentTarget)
    const sx = e.clientX / z - at.x
    const sy = e.clientY / z - at.y
    const move = (ev: PointerEvent) => {
      let { x, y } = onScreen({ x: ev.clientX / z - sx, y: ev.clientY / z - sy }, width, z)
      // Snap to the window edges.
      if (x < SNAP) x = 0
      if (y < SNAP) y = 0
      if (window.innerWidth / z - (x + width) < SNAP) x = window.innerWidth / z - width
      p.onMove(onScreen({ x, y }, width, z))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div ref={ref} className="fp" style={{ left: at.x, top: at.y, width }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="fp-bar" onPointerDown={drag}>
        <span>{p.title}</span>
        <span className="fp-spacer" />
        {p.actions}
        {p.onClose && (
          <button className="icon-btn" title="Close" onClick={p.onClose}>
            <X size={13} />
          </button>
        )}
      </div>
      <div className="fp-body">{p.children}</div>
    </div>
  )
}
