import { useEffect, useRef } from 'react'
import { drawTile } from '@/shared/tileset'
import type { TileImage } from './images'
import { geometry, parseArt, tileRect, type Tileset } from './model'

/** What the next click would put down: picture tiles, a plan tile's colour, or only an outline (erase, blocked, scatter). */
export interface Ghost {
  tone: 'paint' | 'erase' | 'block' | 'scatter'
  cells: { x: number; y: number; art?: string; color?: string; skip?: boolean }[]
}

const OUTLINE: Record<Ghost['tone'], string> = { paint: '#4dabf7', erase: '#ffffff', block: '#e03131', scatter: '#f5a623' }

interface Props {
  ghost: Ghost | null
  iso?: boolean
  width: number
  height: number
  cellPx: number
  sharp: boolean
  sets: Tileset[]
  images: Record<string, TileImage>
  style: React.CSSProperties
}

/**
 * 0.24: the brush preview, on its own see-through canvas over the level. Moving the mouse only clears and redraws
 * the few cells under it, so big levels don't get slower.
 */
export function Preview({ ghost, iso, width, height, cellPx, sharp, sets, images, style }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // The part drawn last time, in canvas pixels: the only part that needs clearing.
  const dirty = useRef<[number, number, number, number] | null>(null)

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const s = cellPx
    const geo = geometry(iso, width, height, s)
    const ch = geo.cellH
    // Setting the size clears the canvas, so only when it changed.
    if (c.width !== Math.ceil(geo.width) || c.height !== Math.ceil(geo.height)) {
      c.width = Math.ceil(geo.width)
      c.height = Math.ceil(geo.height)
      dirty.current = null
    }
    const ctx = c.getContext('2d')!
    if (dirty.current) ctx.clearRect(...dirty.current)
    dirty.current = null
    if (!ghost?.cells.length) return
    ctx.imageSmoothingEnabled = !sharp
    const box = [Infinity, Infinity, -Infinity, -Infinity]
    const grow = (x: number, y: number, w: number, h: number) => {
      box[0] = Math.min(box[0], x)
      box[1] = Math.min(box[1], y)
      box[2] = Math.max(box[2], x + w)
      box[3] = Math.max(box[3], y + h)
    }
    const shape = (x: number, y: number) => {
      const [bx, by] = geo.box(x, y)
      ctx.beginPath()
      if (!iso) return ctx.rect(bx + 0.5, by + 0.5, s - 1, s - 1)
      ctx.moveTo(bx + s / 2, by)
      ctx.lineTo(bx + s, by + ch / 2)
      ctx.lineTo(bx + s / 2, by + ch)
      ctx.lineTo(bx, by + ch / 2)
      ctx.closePath()
    }
    const byId = new Map(sets.map((t) => [t.id, t]))
    for (const cell of ghost.cells) {
      const [bx, by] = geo.box(cell.x, cell.y)
      grow(bx, by, s, ch)
      // Cells the click would skip (blocked) stay faint.
      ctx.globalAlpha = cell.skip ? 0.2 : 0.6
      if (cell.art) {
        const a = parseArt(cell.art)
        const t = byId.get(a.set)
        const img = images[a.set]
        if (t && img) {
          const r = tileRect(t, a.col, a.row)
          const dh = (s * r.h) / r.size
          drawTile(ctx, img, r.x, r.y, r.size, bx, by + ch - dh, s, a.flags, r.h, dh)
          grow(bx, by + ch - dh, s, dh)
        }
      } else if (cell.color) {
        ctx.fillStyle = cell.color
        shape(cell.x, cell.y)
        ctx.fill()
      }
      ctx.globalAlpha = cell.skip ? 0.35 : 0.9
      ctx.strokeStyle = OUTLINE[ghost.tone]
      ctx.lineWidth = Math.max(1, s / 16)
      shape(cell.x, cell.y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    const pad = 2
    dirty.current = [Math.floor(box[0]) - pad, Math.floor(box[1]) - pad, Math.ceil(box[2] - box[0]) + pad * 2, Math.ceil(box[3] - box[1]) + pad * 2]
  }, [ghost, iso, width, height, cellPx, sharp, sets, images])

  return <canvas ref={canvas} className={`lv-preview${sharp ? ' sharp' : ''}`} style={style} aria-hidden />
}
