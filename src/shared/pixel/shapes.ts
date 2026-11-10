import { newId, type Id } from '@/core/model'
import type { Shape } from '@/shared/sketch/quickshape'
import { outline, simplify } from '@/shared/sketch/quickshape'
import { blank, brushOffsets, hexToRgba, line, setPx, type Img } from './model'

/**
 * Live shapes (v0.29): a shape layer keeps editable shapes instead of pixels. Every change draws
 * the shapes again into the layer's cel, so exports, onion skin and older app versions just see
 * pixels. Shapes are kept per frame; frames between two keys can be filled in by tweening.
 * Pure: no canvas, no React.
 */

export interface VPoint {
  x: number
  y: number
}

export interface VShape {
  id: Id
  points: VPoint[]
  closed: boolean
  /** Round the corners into a smooth curve through the points. */
  smooth?: boolean
  /** '#rrggbb', missing = no fill. */
  fillColor?: string
  /** '#rrggbb', missing = no outline. */
  strokeColor?: string
  /** Outline width in pixels. */
  width: number
}

/** The shapes of one layer on one frame; `key` = drawn by hand (in-betweens are not keys). */
export interface ShapeCel {
  key: boolean
  list: VShape[]
}

export const newShape = (points: VPoint[], closed: boolean, look: Partial<VShape> = {}): VShape => ({ id: newId(), points, closed, width: 1, ...look })

const dist = (a: VPoint, b: VPoint) => Math.hypot(a.x - b.x, a.y - b.y)

/** The outline as a dense polyline (smooth shapes through Catmull-Rom curves). Closed shapes end where they start. */
export function trace(s: VShape): VPoint[] {
  const p = s.points
  if (p.length < 2) return [...p]
  if (!s.smooth || p.length < 3) return s.closed ? [...p, p[0]] : [...p]
  const n = p.length
  const at = (i: number) => (s.closed ? p[((i % n) + n) % n] : p[Math.max(0, Math.min(n - 1, i))])
  const out: VPoint[] = []
  const spans = s.closed ? n : n - 1
  for (let i = 0; i < spans; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    const steps = Math.max(4, Math.ceil(dist(p1, p2) / 1.5))
    for (let k = 0; k < steps; k++) {
      const t = k / steps
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) })
    }
  }
  out.push(s.closed ? out[0] : p[n - 1])
  return out
}

/** Is the point inside the closed outline (even-odd)? Point x,y is the centre of pixel x,y. */
function inside(poly: VPoint[], x: number, y: number): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

/** Shapes drawn into a fresh picture: fills first, then outlines, bottom shape first. */
export function drawShapes(list: VShape[], width: number, height: number): Img {
  const img = blank(width, height)
  for (const s of list) {
    const poly = trace(s)
    if (s.closed && s.fillColor && poly.length > 2) {
      const c = hexToRgba(s.fillColor)
      const xs = poly.map((q) => q.x)
      const ys = poly.map((q) => q.y)
      for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(height - 1, Math.ceil(Math.max(...ys))); y++)
        for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(width - 1, Math.ceil(Math.max(...xs))); x++) if (inside(poly, x, y)) setPx(img, x, y, c)
    }
    if (s.strokeColor && s.width > 0 && poly.length) {
      const c = hexToRgba(s.strokeColor)
      const brush = brushOffsets(Math.round(s.width), true)
      const r = poly.map((q): [number, number] => [Math.round(q.x), Math.round(q.y)])
      const px: [number, number][] = r.length === 1 ? r : r.slice(1).flatMap((b, i) => line(r[i][0], r[i][1], b[0], b[1]))
      for (const [x, y] of px) for (const [bx, by] of brush) if (x + bx >= 0 && y + by >= 0 && x + bx < width && y + by < height) setPx(img, x + bx, y + by, c)
    }
  }
  return img
}

/** A QuickShape (or a rough stroke) as a live shape with a few editable points. */
export function fromQuickShape(q: Shape): VShape {
  if (q.kind === 'circle' || q.kind === 'ellipse') {
    // Eight points on a smooth curve: round, yet every bit can still be pulled.
    const o = outline(q, 1)
    const pts = Array.from({ length: 8 }, (_, i) => o[Math.floor((i * (o.length - 1)) / 8)])
    return newShape(pts.map(round), true, { smooth: true })
  }
  if (q.kind === 'arc') return newShape(q.points.map(round), false, { smooth: true })
  return newShape(q.points.map(round), q.kind !== 'line' && q.kind !== 'polyline')
}

/** A freehand stroke as a live shape: its corners, closed when it ends near where it started. */
export function fromStroke(pts: VPoint[]): VShape | null {
  if (pts.length < 2) return null
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  let corners = simplify(pts, Math.max(1, diag * 0.04)).map(round)
  const closed = corners.length > 3 && dist(corners[0], corners[corners.length - 1]) <= Math.max(2, diag * 0.12)
  if (closed) corners = corners.slice(0, -1)
  return newShape(corners, closed, { smooth: corners.length > 3 })
}

const round = (p: VPoint): VPoint => ({ x: Math.round(p.x), y: Math.round(p.y) })

// ---- Editing ---------------------------------------------------------------------

function segDist(p: VPoint, a: VPoint, b: VPoint) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2)) : 0
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
}

export type ShapeHit = { shape: number; point: number } | { shape: number; edge: number } | { shape: number; inside: true }

/** What is under the pointer, top shape first: a point, an edge (insert after `edge`), or the inside. `r` = reach in pixels. */
export function hitShape(list: VShape[], p: VPoint, r: number): ShapeHit | null {
  for (let s = list.length - 1; s >= 0; s--) {
    const pt = list[s].points.findIndex((q) => dist(q, p) <= r)
    if (pt >= 0) return { shape: s, point: pt }
  }
  for (let s = list.length - 1; s >= 0; s--) {
    const sh = list[s]
    const n = sh.points.length
    for (let i = 0; i < (sh.closed ? n : n - 1); i++) if (segDist(p, sh.points[i], sh.points[(i + 1) % n]) <= r) return { shape: s, edge: i }
  }
  for (let s = list.length - 1; s >= 0; s--) {
    const poly = trace(list[s])
    if (list[s].closed && poly.length > 2 && inside(poly, p.x, p.y)) return { shape: s, inside: true }
  }
  return null
}

// ---- In-betweens ---------------------------------------------------------------------

export type Ease = 'even' | 'in' | 'out' | 'inout'
export const easeOf = (e: Ease, t: number) => (e === 'in' ? t * t : e === 'out' ? 1 - (1 - t) ** 2 : e === 'inout' ? (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2) : t)

/** `n` points spread evenly along the outline, starting at the first point. */
function resamplePoints(s: VShape, n: number): VPoint[] {
  const ring = s.closed ? [...s.points, s.points[0]] : s.points
  const lens = ring.slice(1).map((q, i) => dist(q, ring[i]))
  const total = lens.reduce((a, b) => a + b, 0) || 1
  const out: VPoint[] = []
  const count = s.closed ? n : n - 1
  for (let k = 0; k < n; k++) {
    let want = (total * k) / Math.max(1, count)
    let i = 0
    while (i < lens.length - 1 && want > lens[i]) want -= lens[i++]
    const t = lens[i] ? Math.min(1, want / lens[i]) : 0
    out.push({ x: ring[i].x + (ring[i + 1].x - ring[i].x) * t, y: ring[i].y + (ring[i + 1].y - ring[i].y) * t })
  }
  return out
}

const mixHex = (a: string | undefined, b: string | undefined, t: number) => {
  if (!a || !b) return t < 0.5 ? a : b
  const [ra, ga, ba] = hexToRgba(a)
  const [rb, gb, bb] = hexToRgba(b)
  const m = (x: number, y: number) => Math.round(x + (y - x) * t)
  return `#${((1 << 24) | (m(ra, rb) << 16) | (m(ga, gb) << 8) | m(ba, bb)).toString(16).slice(1)}`
}

/**
 * The shapes part way (t 0..1) from key `a` to key `b`. Shapes are matched by id; a shape only in one key
 * shows until halfway (or from halfway). Different point counts are spread evenly along both outlines.
 * Points land on whole pixels.
 */
export function tween(a: VShape[], b: VShape[], t: number): VShape[] {
  const byId = new Map(b.map((s) => [s.id, s]))
  const out: VShape[] = []
  for (const sa of a) {
    const sb = byId.get(sa.id)
    if (!sb) {
      if (t < 0.5) out.push(sa)
      continue
    }
    const same = sa.points.length === sb.points.length
    const n = Math.max(sa.points.length, sb.points.length)
    const pa = same ? sa.points : resamplePoints(sa, n)
    const pb = same ? sb.points : resamplePoints(sb, n)
    out.push({
      ...(t < 0.5 ? sa : sb),
      points: pa.map((p, i) => round({ x: p.x + (pb[i].x - p.x) * t, y: p.y + (pb[i].y - p.y) * t })),
      width: Math.round(sa.width + (sb.width - sa.width) * t),
      fillColor: mixHex(sa.fillColor, sb.fillColor, t),
      strokeColor: mixHex(sa.strokeColor, sb.strokeColor, t),
    })
  }
  const inA = new Set(a.map((s) => s.id))
  for (const sb of b) if (!inA.has(sb.id) && t >= 0.5) out.push(sb)
  return out
}

/**
 * Every frame between two keys of one layer gets the tweened shapes. `cels` = frame index → its shapes (or none).
 * Returns the frames to change. Frames before the first key and after the last stay as they are.
 */
export function fillInBetweens(cels: (ShapeCel | undefined)[], ease: Ease = 'even'): Map<number, ShapeCel> {
  const keys = cels.flatMap((c, i) => (c?.key ? [i] : []))
  const out = new Map<number, ShapeCel>()
  for (let k = 0; k < keys.length - 1; k++) {
    const [i, j] = [keys[k], keys[k + 1]]
    for (let f = i + 1; f < j; f++) out.set(f, { key: false, list: tween(cels[i]!.list, cels[j]!.list, easeOf(ease, (f - i) / (j - i))) })
  }
  return out
}
