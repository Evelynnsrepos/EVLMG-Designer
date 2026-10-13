import { X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { zoomOf } from '@/shared/zoom'

/**
 * A panel that floats over the canvas (Sketch Pro): drag it by its bar, it snaps
 * to the window edges, and it remembers where it was.
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
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const z = zoomOf(e.currentTarget)
    const sx = e.clientX / z - p.at.x
    const sy = e.clientY / z - p.at.y
    const move = (ev: PointerEvent) => {
      let x = Math.max(0, Math.min(window.innerWidth / z - 80, ev.clientX / z - sx))
      let y = Math.max(0, Math.min(window.innerHeight / z - 40, ev.clientY / z - sy))
      // Snap to the window edges.
      if (x < SNAP) x = 0
      if (y < SNAP) y = 0
      if (window.innerWidth - (x + width) < SNAP) x = window.innerWidth - width
      p.onMove({ x, y })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="fp" style={{ left: p.at.x, top: p.at.y, width }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
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
