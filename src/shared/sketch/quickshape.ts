/**
 * QuickShape (v0.5): draw a rough shape, keep holding at the
 * end, and it snaps to a clean line, arc, polyline, triangle, rectangle, circle or
 * ellipse. Keep holding a little longer and it turns perfect (circle, square, 15° line).
 * v0.28: circles and ellipses are fitted to every point, so going round several times
 * averages the loops; ellipses and rectangles can be tilted; open curves become arcs.
 * Pure geometry, no canvas.
 */

export interface Pt {
  x: number
  y: number
}

export type ShapeKind = 'line' | 'polyline' | 'arc' | 'triangle' | 'rectangle' | 'quad' | 'circle' | 'ellipse'

export interface Shape {
  kind: ShapeKind
  /** Corner points (line/polyline/polygons), [start, middle, end] for arcs, or [center, radius x/y as a point] for ellipses. */
  points: Pt[]
  /** Ellipses only: tilt in radians; missing = level. */
  angle?: number
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

function segDist(p: Pt, a: Pt, b: Pt): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  if (!l2) return dist(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2))
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
}

/** Ramer-Douglas-Peucker: the corners of a rough line. */
export function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts
  let max = 0
  let idx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1])
    if (d > max) {
      max = d
      idx = i
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]]
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)]
}

function bounds(pts: Pt[]) {
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Total signed turning angle along the stroke; about 2π per loop. */
function turning(pts: Pt[]): number {
  // Use every few points so jitter does not add up.
  const step = Math.max(1, Math.floor(pts.length / 80))
  const s = pts.filter((_, i) => i % step === 0)
  let total = 0
  for (let i = 2; i < s.length; i++) {
    const a1 = Math.atan2(s[i - 1].y - s[i - 2].y, s[i - 1].x - s[i - 2].x)
    const a2 = Math.atan2(s[i].y - s[i - 1].y, s[i].x - s[i - 1].x)
    let d = a2 - a1
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    total += d
  }
  return total
}

const pathLength = (pts: Pt[]) => pts.slice(1).reduce((s, p, i) => s + dist(p, pts[i]), 0)

/** The same stroke with points every `step` px, so fits weigh the drawing, not the pen speed. */
function resample(pts: Pt[], step: number): Pt[] {
  const out = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const d = dist(a, b)
    let t = step - carry
    while (t <= d) {
      out.push({ x: a.x + ((b.x - a.x) * t) / d, y: a.y + ((b.y - a.y) * t) / d })
      t += step
    }
    carry = d - (t - step)
  }
  if (dist(out[out.length - 1], pts[pts.length - 1]) > step / 4) out.push(pts[pts.length - 1])
  return out
}

/** Least-squares circle through all points (algebraic fit); err = mean distance off the circle / radius. */
export function fitCircle(pts: Pt[]): { c: Pt; r: number; err: number } | null {
  const n = pts.length
  if (n < 3) return null
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0
  for (const p of pts) {
    const u = p.x - mx
    const v = p.y - my
    suu += u * u
    svv += v * v
    suv += u * v
    suuu += u * u * u
    svvv += v * v * v
    suvv += u * v * v
    svuu += v * u * u
  }
  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-9) return null
  const bu = (suuu + suvv) / 2
  const bv = (svvv + svuu) / 2
  const uc = (bu * svv - bv * suv) / det
  const vc = (bv * suu - bu * suv) / det
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n)
  const c = { x: mx + uc, y: my + vc }
  const err = pts.reduce((s, p) => s + Math.abs(dist(p, c) - r), 0) / n / (r || 1)
  return { c, r, err }
}

/** Ellipse from the spread of the points (works for one loop or several); err like fitCircle. */
function fitEllipse(pts: Pt[]): { c: Pt; rx: number; ry: number; angle: number; err: number } {
  const n = pts.length
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n }
  let sxx = 0, syy = 0, sxy = 0
  for (const p of pts) {
    sxx += (p.x - c.x) ** 2
    syy += (p.y - c.y) ** 2
    sxy += (p.x - c.x) * (p.y - c.y)
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
  let su = 0, sv = 0
  for (const p of pts) {
    su += ((p.x - c.x) * cos + (p.y - c.y) * sin) ** 2
    sv += (-(p.x - c.x) * sin + (p.y - c.y) * cos) ** 2
  }
  // Points spread evenly round an ellipse have rms = radius / √2 along each axis.
  const rx = Math.sqrt((2 * su) / n) || 1
  const ry = Math.sqrt((2 * sv) / n) || 1
  const err = pts.reduce((s, p) => {
    const u = (p.x - c.x) * cos + (p.y - c.y) * sin
    const v = -(p.x - c.x) * sin + (p.y - c.y) * cos
    return s + Math.abs(Math.hypot(u / rx, v / ry) - 1)
  }, 0) / n
  return { c, rx, ry, angle, err }
}

/** Four rough corners as a clean rectangle, tilted like the drawing (level when nearly level), or null. */
function fitRect(corners: Pt[]): Pt[] | null {
  const edges = corners.map((c, i) => Math.atan2(corners[(i + 1) % 4].y - c.y, corners[(i + 1) % 4].x - c.x))
  // Average edge direction modulo 90°.
  let phi = Math.atan2(edges.reduce((s, a) => s + Math.sin(4 * a), 0), edges.reduce((s, a) => s + Math.cos(4 * a), 0)) / 4
  const off = (a: number) => {
    const d = (((a - phi) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)
    return Math.min(d, Math.PI / 2 - d)
  }
  if (!edges.every((a) => off(a) < 0.22)) return null
  if (Math.abs(phi) < (6 * Math.PI) / 180) phi = 0
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)]
  const local = corners.map((p) => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos }))
  const b = bounds(local)
  const back = (p: Pt) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos })
  return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }].map(back)
}

/** Points on circle `c` from angle a0 sweeping `sweep` (signed). */
const onCircle = (c: Pt, r: number, a: number): Pt => ({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r })

/** The clean shape for a rough stroke, or null if it is too small or too wiggly to guess. */
export function recognize(raw: Pt[]): Shape | null {
  if (raw.length < 2) return null
  const b0 = bounds(raw)
  const diag = Math.hypot(b0.w, b0.h)
  if (diag < 8) return null
  const pts = resample(raw, Math.max(0.5, diag / 120))
  const start = pts[0]
  const end = pts[pts.length - 1]
  const length = pathLength(pts)
  const turn = turning(pts)

  // Going round more than once (scribbling a circle a few times) counts as closed too.
  const closed = (dist(start, end) < Math.max(12, diag * 0.22) && length > diag * 1.6) || Math.abs(turn) > Math.PI * 1.8
  if (!closed) {
    const straight = Math.max(...pts.map((p) => segDist(p, start, end)))
    if (straight < Math.max(4, dist(start, end) * 0.08)) return { kind: 'line', points: [start, end] }
    // A smooth bend that follows one circle: an arc through start, middle and end.
    const fit = Math.abs(turn) > 0.5 ? fitCircle(pts) : null
    if (fit && fit.err < 0.05) {
      const a0 = Math.atan2(start.y - fit.c.y, start.x - fit.c.x)
      return { kind: 'arc', points: [onCircle(fit.c, fit.r, a0), onCircle(fit.c, fit.r, a0 + turn / 2), onCircle(fit.c, fit.r, a0 + turn)] }
    }
    const corners = simplify(pts, diag * 0.06)
    if (corners.length <= 5) return { kind: 'polyline', points: corners }
    return null
  }

  // Closed and round: circle or (tilted) ellipse, fitted to every point of every loop.
  const e = fitEllipse(pts)
  if (e.err < 0.1) {
    if (Math.min(e.rx, e.ry) / Math.max(e.rx, e.ry) > 0.82) {
      const c = fitCircle(pts)
      const r = c && c.err < 0.12 ? c.r : (e.rx + e.ry) / 2
      const center = c && c.err < 0.12 ? c.c : e.c
      return { kind: 'circle', points: [center, { x: r, y: r }] }
    }
    // Nearly level or upright: make it exactly so.
    let { rx, ry, angle } = e
    const q = Math.round(angle / (Math.PI / 2))
    if (Math.abs(angle - q * (Math.PI / 2)) < (8 * Math.PI) / 180) {
      if (q % 2) [rx, ry] = [ry, rx]
      angle = 0
    }
    return angle ? { kind: 'ellipse', points: [e.c, { x: rx, y: ry }], angle } : { kind: 'ellipse', points: [e.c, { x: rx, y: ry }] }
  }

  // Closed strokes: count corners on the loop (start and end joined).
  const loop = [...pts, start]
  let corners = simplify(loop, diag * 0.09).slice(0, -1)
  // Merge corners that ended up next to each other at the seam.
  corners = corners.filter((c, i) => i === 0 || dist(c, corners[i - 1]) > diag * 0.12)
  if (corners.length > 1 && dist(corners[0], corners[corners.length - 1]) < diag * 0.12) corners = corners.slice(0, -1)

  if (corners.length === 3) return { kind: 'triangle', points: corners }
  if (corners.length === 4) {
    const rect = fitRect(corners)
    return rect ? { kind: 'rectangle', points: rect } : { kind: 'quad', points: corners }
  }

  // Many corners but not round enough: keep it as the cleaned-up polygon.
  return corners.length >= 5 && corners.length <= 8 ? { kind: 'quad', points: corners } : null
}

/** The circle through three points, or null when they lie on one line. */
function circle3(a: Pt, b: Pt, c: Pt): { c: Pt; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-6) return null
  const s = (p: Pt) => p.x * p.x + p.y * p.y
  const center = { x: (s(a) * (b.y - c.y) + s(b) * (c.y - a.y) + s(c) * (a.y - b.y)) / d, y: (s(a) * (c.x - b.x) + s(b) * (a.x - c.x) + s(c) * (b.x - a.x)) / d }
  return { c: center, r: dist(center, a) }
}

/** An arc's circle and its signed sweep from the start point, through the middle point, to the end. */
function arcOf(p: Pt[]): { c: Pt; r: number; a0: number; sweep: number } | null {
  const k = circle3(p[0], p[1], p[2])
  if (!k || k.r > 1e5) return null
  const ang = (q: Pt) => Math.atan2(q.y - k.c.y, q.x - k.c.x)
  const norm = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  const a0 = ang(p[0])
  const toMid = norm(ang(p[1]) - a0)
  const toEnd = norm(ang(p[2]) - a0)
  return { ...k, a0, sweep: toMid < toEnd ? toEnd : toEnd - Math.PI * 2 }
}

/** Points along the shape, about every `step` px, starting where the user started. */
export function outline(shape: Shape, step = 2, startNear?: Pt): Pt[] {
  const out: Pt[] = []
  const along = (a: Pt, b: Pt) => {
    const n = Math.max(1, Math.ceil(dist(a, b) / step))
    for (let i = 0; i < n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n })
  }
  const p = shape.points
  if (shape.kind === 'circle' || shape.kind === 'ellipse') {
    const [c, r] = p
    const [cos, sin] = [Math.cos(shape.angle ?? 0), Math.sin(shape.angle ?? 0)]
    const near = startNear && { x: (startNear.x - c.x) * cos + (startNear.y - c.y) * sin, y: -(startNear.x - c.x) * sin + (startNear.y - c.y) * cos }
    const a0 = near ? Math.atan2(near.y / (r.y || 1), near.x / (r.x || 1)) : 0
    const n = Math.max(24, Math.ceil((Math.PI * 2 * Math.max(r.x, r.y)) / step))
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * Math.PI * 2
      const [u, v] = [Math.cos(a) * r.x, Math.sin(a) * r.y]
      out.push({ x: c.x + u * cos - v * sin, y: c.y + u * sin + v * cos })
    }
    return out
  }
  if (shape.kind === 'arc') {
    const k = arcOf(p)
    if (!k) {
      along(p[0], p[2])
      out.push(p[2])
      return out
    }
    const n = Math.max(8, Math.ceil((Math.abs(k.sweep) * k.r) / step))
    for (let i = 0; i <= n; i++) out.push(onCircle(k.c, k.r, k.a0 + (k.sweep * i) / n))
    return out
  }
  const closed = shape.kind !== 'line' && shape.kind !== 'polyline'
  const pts = closed ? [...p, p[0]] : p
  for (let i = 0; i < pts.length - 1; i++) along(pts[i], pts[i + 1])
  out.push(pts[pts.length - 1])
  return out
}

/** Resize while still holding: lines follow the pointer, other shapes scale around their center. */
export function resize(shape: Shape, from: Pt, to: Pt): Shape {
  const p = shape.points
  if (shape.kind === 'line') return { ...shape, points: [p[0], to] }
  if (shape.kind === 'polyline') return { ...shape, points: [...p.slice(0, -1), to] }
  if (shape.kind === 'arc') {
    // The end follows the pointer; the bend keeps its depth relative to the chord.
    const chord = { x: p[2].x - p[0].x, y: p[2].y - p[0].y }
    const len = Math.hypot(chord.x, chord.y) || 1
    const m = { x: (p[0].x + p[2].x) / 2, y: (p[0].y + p[2].y) / 2 }
    const along = ((p[1].x - m.x) * chord.x + (p[1].y - m.y) * chord.y) / len / len
    const bend = ((p[1].x - m.x) * -chord.y + (p[1].y - m.y) * chord.x) / len / len
    const nc = { x: to.x - p[0].x, y: to.y - p[0].y }
    const nm = { x: (p[0].x + to.x) / 2, y: (p[0].y + to.y) / 2 }
    return { ...shape, points: [p[0], { x: nm.x + nc.x * along - nc.y * bend, y: nm.y + nc.y * along + nc.x * bend }, to] }
  }
  const c = shape.kind === 'circle' || shape.kind === 'ellipse' ? p[0] : { x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length }
  const k = dist(to, c) / Math.max(1, dist(from, c))
  if (shape.kind === 'circle' || shape.kind === 'ellipse') return { ...shape, points: [c, { x: p[1].x * k, y: p[1].y * k }] }
  return { ...shape, points: p.map((q) => ({ x: c.x + (q.x - c.x) * k, y: c.y + (q.y - c.y) * k })) }
}

const snapAngle = (a: Pt, b: Pt, stepDeg = 15): Pt => {
  const len = dist(a, b)
  const step = (stepDeg * Math.PI) / 180
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / step) * step
  return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len }
}

/**
 * The "perfect" version (Shift): lines snap
 * to 15° steps, ellipses become circles, rectangles squares, triangles equilateral.
 */
export function perfect(shape: Shape): Shape {
  const p = shape.points
  switch (shape.kind) {
    case 'line':
      return { ...shape, points: [p[0], snapAngle(p[0], p[1])] }
    case 'polyline': {
      const out = [p[0]]
      for (let i = 1; i < p.length; i++) out.push(snapAngle(out[i - 1], p[i]))
      return { ...shape, points: out }
    }
    case 'arc': {
      // Level chord, and the middle point exactly halfway along the arc.
      const end = snapAngle(p[0], p[2])
      const chord = { x: end.x - p[0].x, y: end.y - p[0].y }
      const len = Math.hypot(chord.x, chord.y) || 1
      const m = { x: (p[0].x + p[2].x) / 2, y: (p[0].y + p[2].y) / 2 }
      const bend = ((p[1].x - m.x) * -(p[2].y - p[0].y) + (p[1].y - m.y) * (p[2].x - p[0].x)) / (dist(p[0], p[2]) || 1)
      const nm = { x: (p[0].x + end.x) / 2, y: (p[0].y + end.y) / 2 }
      return { ...shape, points: [p[0], { x: nm.x - (chord.y / len) * bend, y: nm.y + (chord.x / len) * bend }, end] }
    }
    case 'ellipse':
    case 'circle': {
      const r = (p[1].x + p[1].y) / 2
      return { kind: 'circle', points: [p[0], { x: r, y: r }] }
    }
    case 'rectangle': {
      // A square, tilted like the rectangle.
      const c = { x: p.reduce((s, q) => s + q.x, 0) / 4, y: p.reduce((s, q) => s + q.y, 0) / 4 }
      const half = (dist(p[0], p[1]) + dist(p[1], p[2])) / 4
      const a = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x)
      const u = { x: Math.cos(a) * half, y: Math.sin(a) * half }
      const v = { x: -u.y, y: u.x }
      return { kind: 'rectangle', points: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: c.x + u.x * i + v.x * j, y: c.y + u.y * i + v.y * j })) }
    }
    case 'quad': {
      const c = { x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length }
      const half = p.reduce((s, q) => s + Math.max(Math.abs(q.x - c.x), Math.abs(q.y - c.y)), 0) / p.length
      return {
        kind: 'rectangle',
        points: [
          { x: c.x - half, y: c.y - half },
          { x: c.x + half, y: c.y - half },
          { x: c.x + half, y: c.y + half },
          { x: c.x - half, y: c.y + half },
        ],
      }
    }
    case 'triangle': {
      const c = { x: (p[0].x + p[1].x + p[2].x) / 3, y: (p[0].y + p[1].y + p[2].y) / 3 }
      const r = (dist(p[0], c) + dist(p[1], c) + dist(p[2], c)) / 3
      // Point up, like a drawn warning sign.
      return { kind: 'triangle', points: [0, 1, 2].map((i) => ({ x: c.x + Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 3) * r, y: c.y + Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 3) * r })) }
    }
  }
}

/** Lines within `tolDeg` of a 15° step snap to it even without Shift (level, upright, 45°...). */
export function gentle(shape: Shape, tolDeg = 3): Shape {
  if (shape.kind !== 'line') return shape
  const [a, b] = shape.points
  const snapped = snapAngle(a, b)
  const off = Math.abs(Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(snapped.y - a.y, snapped.x - a.x)) % (Math.PI * 2)
  return Math.min(off, Math.PI * 2 - off) <= (tolDeg * Math.PI) / 180 ? { ...shape, points: [a, snapped] } : shape
}

// ---- Edit Shape: draggable nodes after a shape snapped -------------------------------

/** The points that can be dragged: corners, or center + radius handles for round shapes. */
export function shapeNodes(shape: Shape): Pt[] {
  const p = shape.points
  if (shape.kind === 'circle') return [p[0], { x: p[0].x + p[1].x, y: p[0].y }]
  if (shape.kind === 'ellipse') {
    const [cos, sin] = [Math.cos(shape.angle ?? 0), Math.sin(shape.angle ?? 0)]
    return [p[0], { x: p[0].x + p[1].x * cos, y: p[0].y + p[1].x * sin }, { x: p[0].x - p[1].y * sin, y: p[0].y + p[1].y * cos }]
  }
  return p
}

/** The shape with node `i` dragged to `to`. Rectangles become free four-cornered shapes. */
export function moveNode(shape: Shape, i: number, to: Pt): Shape {
  const p = shape.points
  if (shape.kind === 'circle' || shape.kind === 'ellipse') {
    const c = p[0]
    if (i === 0) return { ...shape, points: [to, p[1]] }
    if (shape.kind === 'circle') {
      const r = Math.max(1, dist(c, to))
      return { ...shape, points: [c, { x: r, y: r }] }
    }
    // Radius along the ellipse's own (maybe tilted) axis.
    const [cos, sin] = [Math.cos(shape.angle ?? 0), Math.sin(shape.angle ?? 0)]
    const u = Math.abs((to.x - c.x) * cos + (to.y - c.y) * sin)
    const v = Math.abs(-(to.x - c.x) * sin + (to.y - c.y) * cos)
    return { ...shape, points: [c, i === 1 ? { x: Math.max(1, u), y: p[1].y } : { x: p[1].x, y: Math.max(1, v) }] }
  }
  return { kind: shape.kind === 'rectangle' ? 'quad' : shape.kind, points: p.map((q, j) => (j === i ? to : q)) }
}

/** Shift is tracked app-wide so tools can ask for the perfect shape without a key event of their own. */
export const keys = { shift: false }
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => e.key === 'Shift' && (keys.shift = true))
  window.addEventListener('keyup', (e) => e.key === 'Shift' && (keys.shift = false))
  window.addEventListener('blur', () => (keys.shift = false))
}

/** How long the pointer must rest at the end of a stroke before it snaps. */
export const HOLD_MS = 550
/** Keep resting this much longer after the snap and the shape turns perfect (like holding Shift). */
export const PERFECT_MS = 650
