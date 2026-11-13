import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { resolveAssetPath } from '@/core/assets'
import { getFs } from '@/core/fs'
import { useProjectStore } from '@/core/state'
import { zoomOf } from '@/shared/zoom'

/** A reference image floating over a canvas (Draw, Pixel Art): drag its bar to move it, its corner to resize it. */
export function ReferenceWindow(p: { image: string; x: number; y: number; width: number; onChange(patch: { x?: number; y?: number; width?: number }): void; onClose(): void }) {
  const root = useProjectStore((s) => s.root)
  const [url, setUrl] = useState<string | null>(null)
  // Where it is while being dragged: the owner hears only the end, so one drag is one undo step.
  const [live, setLive] = useState<{ x?: number; y?: number; width?: number } | null>(null)
  useEffect(() => {
    if (!root) return
    let gone = false
    let made: string | null = null
    void resolveAssetPath(root, p.image)
      .then((abs) => getFs().readBinary(abs))
      .then((bytes) => {
        made = URL.createObjectURL(new Blob([bytes as BlobPart]))
        if (!gone) setUrl(made)
      })
      .catch(() => {})
    return () => {
      gone = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [root, p.image])

  const drag = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX
    const sy = e.clientY
    const start = { x: p.x, y: p.y, width: p.width }
    const z = zoomOf(e.currentTarget)
    let last: { x?: number; y?: number; width?: number } | null = null
    const move = (ev: PointerEvent) => {
      last = mode === 'move' ? { x: start.x + (ev.clientX - sx) / z, y: start.y + (ev.clientY - sy) / z } : { width: Math.max(80, start.width + (ev.clientX - sx) / z) }
      setLive(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (last) p.onChange(last)
      setLive(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="sketch-ref" style={{ left: live?.x ?? p.x, top: live?.y ?? p.y, width: live?.width ?? p.width }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="sketch-ref-bar" onPointerDown={drag('move')}>
        <button className="icon-btn" title="Close reference" onPointerDown={(e) => e.stopPropagation()} onClick={p.onClose}>
          <X size={12} />
        </button>
      </div>
      {url ? <img src={url} alt="" draggable={false} /> : <div className="placeholder-image sketch-ref-missing" />}
      <div className="sketch-ref-resize" onPointerDown={drag('resize')} />
    </div>
  )
}
