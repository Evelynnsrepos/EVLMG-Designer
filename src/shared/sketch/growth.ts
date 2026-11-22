import { mapWiggle } from './animatedLayers'
import type { LayerWiggle } from './model'
import type { Rect } from './tiles'

/**
 * Painting and moving beyond the canvas (0.31): the drawing's working area grows behind the scenes, in big steps,
 * when paint gets near its edge. The canvas the person picked stays a frame inside it (SketchDoc.frame). Pure.
 */

/** How the working area grows: its new size, and where the old area lands in it. */
export interface Growth {
  left: number
  top: number
  width: number
  height: number
}

/** Growth comes in steps of this many pixels, so a few strokes past the edge don't grow it every time. */
export const GROW_STEP = 512

/** Largest working area per side (as the canvas size picker). */
const MAX_SIDE = 8192

/**
 * How a w×h working area must grow so `r` plus `margin` fits inside it, or null when it fits already.
 * Each side grows by whole steps; the area never passes `max` per side (paint beyond that is cut, as before).
 */
export function growFor(w: number, h: number, r: Rect, margin: number, max = MAX_SIDE): Growth | null {
  const need = (short: number) => (short > 0 ? Math.ceil(short / GROW_STEP) * GROW_STEP : 0)
  let left = need(margin - r.x)
  let top = need(margin - r.y)
  let right = need(r.x + r.w + margin - w)
  let bottom = need(r.y + r.h + margin - h)
  // Within the limit: keep what fits, the far side first.
  const fit = (a: number, b: number, size: number) => {
    let room = Math.max(0, max - size)
    const bb = Math.min(b, room)
    room -= bb
    return [Math.min(a, room), bb]
  }
  ;[left, right] = fit(left, right, w)
  ;[top, bottom] = fit(top, bottom, h)
  if (!left && !top && !right && !bottom) return null
  return { left, top, width: w + left + right, height: h + top + bottom }
}

/** Move a rectangle with the growth (its pixels are `left`, `top` further in). */
export const shiftRect = <R extends { x: number; y: number }>(r: R, g: Growth): R => ({ ...r, x: r.x + g.left, y: r.y + g.top })

type Pt = { x: number; y: number }
const movePt = (p: Pt, g: Growth): Pt => ({ ...p, x: p.x + g.left, y: p.y + g.top })

/** Text boxes, the guide and the frame of a drawing (or of an undo step's copy of them) moved with the growth. */
export function shiftDocData<T>(v: T, g: Growth, depth = 0): T {
  if (!v || typeof v !== 'object' || depth > 4) return v
  if (Array.isArray(v)) return v.map((x) => shiftDocData(x, g, depth + 1)) as T
  const o = v as Record<string, unknown>
  const out: Record<string, unknown> = { ...o }
  if (o.text && typeof o.text === 'object' && 'x' in (o.text as object)) out.text = movePt(o.text as Pt, g)
  if (o.guide && typeof o.guide === 'object') {
    const gd = o.guide as { center?: Pt; vanishing?: Pt[] }
    out.guide = { ...gd, ...(gd.center ? { center: movePt(gd.center, g) } : {}), ...(gd.vanishing ? { vanishing: gd.vanishing.map((p) => movePt(p, g)) } : {}) }
  }
  if (o.frame && typeof o.frame === 'object') out.frame = shiftRect(o.frame as Rect, g)
  // 0.35: an Animated layer's strokes move along, so its other frames are painted in the same place.
  if (o.wiggle && typeof o.wiggle === 'object' && Array.isArray((o.wiggle as LayerWiggle).strokes)) out.wiggle = mapWiggle(o.wiggle as LayerWiggle, (p) => movePt(p, g))
  for (const k of ['before', 'after', 'doc', 'layers', 'meta']) if (k in o) out[k] = shiftDocData(o[k], g, depth + 1)
  return out as T
}

/** The drawing after its working area grew: new size, the frame (the picked canvas) and everything placed on it moved. */
export function growDoc<D extends { width: number; height: number; frame?: Rect }>(d: D, g: Growth): D {
  const frame = d.frame ?? { x: 0, y: 0, w: d.width, h: d.height }
  return { ...shiftDocData(d, g), width: g.width, height: g.height, frame: shiftRect(frame, g) }
}

/** The canvas the person picked (0.31): the frame, or the whole drawing when it never grew. */
export const frameOf = (d: { width: number; height: number; frame?: Rect }): Rect => d.frame ?? { x: 0, y: 0, w: d.width, h: d.height }

/** A picture cut to the frame (exports, stickers and previews show only the canvas). */
export function toFrame(src: CanvasImageSource, d: { width: number; height: number; frame?: Rect }): HTMLCanvasElement {
  const f = frameOf(d)
  const c = document.createElement('canvas')
  c.width = f.w
  c.height = f.h
  c.getContext('2d')!.drawImage(src, -f.x, -f.y)
  return c
}

/** Remove everything outside the frame from a layer of a w×h working area (turning Draw beyond the canvas off). */
export function clearOutside(ctx: CanvasRenderingContext2D, f: Rect, w: number, h: number) {
  ctx.beginPath()
  ctx.rect(0, 0, w, h)
  ctx.rect(f.x, f.y, f.w, f.h)
  ctx.clip('evenodd')
  ctx.clearRect(0, 0, w, h)
}
