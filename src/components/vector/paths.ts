/**
 * Point paths for the Vector tool: what the pen draws, what "Edit points" makes of a shape, and what
 * combining shapes gives back. Stored in VectorCraft's anchor form so the Rust maths reads it as is.
 */

export type XY = [number, number]

/** One point. `in`/`out` are its curve handles (absolute, in the shape's own space); missing = sharp corner. */
export interface Anchor {
  p: XY
  in?: XY
  out?: XY
  /** Smooth: moving one handle turns the other with it. */
  kind?: 'Smooth' | 'Corner'
}

export interface SubPath {
  anchors: Anchor[]
  closed: boolean
}

const r2 = (v: number) => Math.round(v * 100) / 100
const xy = (p: XY) => `${r2(p[0])} ${r2(p[1])}`
const same = (a: XY | undefined, b: XY) => !a || (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9)

function segment(a: Anchor, b: Anchor) {
  if (same(a.out, a.p) && same(b.in, b.p)) return `L ${xy(b.p)}`
  return `C ${xy(a.out ?? a.p)} ${xy(b.in ?? b.p)} ${xy(b.p)}`
}

/** SVG path data for the canvas and the SVG file. */
export function pathD(paths: SubPath[]): string {
  const out: string[] = []
  for (const sp of paths) {
    const a = sp.anchors
    if (!a.length) continue
    out.push(`M ${xy(a[0].p)}`)
    for (let i = 1; i < a.length; i++) out.push(segment(a[i - 1], a[i]))
    if (sp.closed) {
      if (a.length > 1) out.push(segment(a[a.length - 1], a[0]))
      out.push('Z')
    }
  }
  return out.join(' ')
}

/** Every point and handle (the curve never leaves this box). shortcut: handle box, not the tight curve box; fine for icons. */
export function pathBox(paths: SubPath[]) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const sp of paths)
    for (const a of sp.anchors)
      for (const q of [a.p, a.in, a.out])
        if (q) {
          x0 = Math.min(x0, q[0])
          y0 = Math.min(y0, q[1])
          x1 = Math.max(x1, q[0])
          y1 = Math.max(y1, q[1])
        }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function mapPaths(paths: SubPath[], f: (p: XY) => XY): SubPath[] {
  return paths.map((sp) => ({
    closed: sp.closed,
    anchors: sp.anchors.map((a) => ({ ...a, p: f(a.p), ...(a.in ? { in: f(a.in) } : {}), ...(a.out ? { out: f(a.out) } : {}) })),
  }))
}

/** Moves the points so their box starts at (0, 0); returns the shift so the node's x/y can take it. */
export function normalize(paths: SubPath[]) {
  const b = pathBox(paths)
  return { paths: mapPaths(paths, ([x, y]) => [x - b.x, y - b.y]), dx: b.x, dy: b.y, width: Math.max(1, b.width), height: Math.max(1, b.height) }
}

/** Canvas-style matrix [a, b, c, d, e, f] of a node: move, then turn, then scale (Konva's order). */
export function nodeMatrix(n: { x: number; y: number; rotation?: number; scaleX?: number; scaleY?: number }): number[] {
  const r = ((n.rotation ?? 0) * Math.PI) / 180
  const [sx, sy] = [n.scaleX ?? 1, n.scaleY ?? 1]
  const [c, s] = [Math.cos(r), Math.sin(r)]
  return [c * sx, s * sx, -s * sy, c * sy, n.x, n.y]
}

export const applyMatrix = (m: number[], [x, y]: XY): XY => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

export function invertMatrix(m: number[]): number[] {
  const det = m[0] * m[3] - m[1] * m[2] || 1
  const [a, b, c, d] = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det]
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

/** Closest point on a cubic segment to `q`, by sampling: { t, dist }. Good enough for "click on the outline". */
function nearestOnSegment(a: Anchor, b: Anchor, q: XY) {
  const p0 = a.p
  const p1 = a.out ?? a.p
  const p2 = b.in ?? b.p
  const p3 = b.p
  let best = { t: 0, dist: Infinity }
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    const [x, y] = bez(p0, p1, p2, p3, t)
    const dd = Math.hypot(x - q[0], y - q[1])
    if (dd < best.dist) best = { t, dist: dd }
  }
  return best
}

const lerp = (a: XY, b: XY, t: number): XY => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

function bez(p0: XY, p1: XY, p2: XY, p3: XY, t: number): XY {
  const a = lerp(p0, p1, t)
  const b = lerp(p1, p2, t)
  const c = lerp(p2, p3, t)
  return lerp(lerp(a, b, t), lerp(b, c, t), t)
}

/** Where the outline is closest to `q`: sub-path, segment (from anchor i to i+1) and curve position. */
export function nearestSegment(paths: SubPath[], q: XY) {
  let best: { sp: number; i: number; t: number; dist: number } | null = null
  paths.forEach((sp, s) => {
    const n = sp.anchors.length
    const segs = sp.closed ? n : n - 1
    for (let i = 0; i < segs; i++) {
      const r = nearestOnSegment(sp.anchors[i], sp.anchors[(i + 1) % n], q)
      if (!best || r.dist < best.dist) best = { sp: s, i, ...r }
    }
  })
  return best as { sp: number; i: number; t: number; dist: number } | null
}

/** Adds a point on segment i at curve position t without changing the outline (de Casteljau split). */
export function insertAnchor(paths: SubPath[], sp: number, i: number, t: number): SubPath[] {
  return paths.map((s, k) => {
    if (k !== sp) return s
    const n = s.anchors.length
    const a = s.anchors[i]
    const b = s.anchors[(i + 1) % n]
    const [p0, p1, p2, p3] = [a.p, a.out ?? a.p, b.in ?? b.p, b.p]
    const q0 = lerp(p0, p1, t)
    const q1 = lerp(p1, p2, t)
    const q2 = lerp(p2, p3, t)
    const r0 = lerp(q0, q1, t)
    const r1 = lerp(q1, q2, t)
    const m = lerp(r0, r1, t)
    const straight = same(a.out, a.p) && same(b.in, b.p)
    const mid: Anchor = straight ? { p: m } : { p: m, in: r0, out: r1, kind: 'Smooth' }
    const anchors = s.anchors.map((x) => ({ ...x }))
    if (!straight) {
      anchors[i] = { ...anchors[i], out: q0 }
      anchors[(i + 1) % n] = { ...anchors[(i + 1) % n], in: q2 }
    }
    anchors.splice(i + 1, 0, mid)
    return { ...s, anchors }
  })
}

/** Corner ↔ smooth. A smooth point gets handles along the line between its neighbours. */
export function toggleSmooth(paths: SubPath[], sp: number, i: number): SubPath[] {
  return paths.map((s, k) => {
    if (k !== sp) return s
    const n = s.anchors.length
    const anchors = s.anchors.map((x) => ({ ...x }))
    const a = anchors[i]
    if (a.kind === 'Smooth' || !same(a.in, a.p) || !same(a.out, a.p)) {
      anchors[i] = { p: a.p }
      return { ...s, anchors }
    }
    const prev = anchors[(i - 1 + n) % n].p
    const next = anchors[(i + 1) % n].p
    const dir: XY = [next[0] - prev[0], next[1] - prev[1]]
    const len = Math.hypot(dir[0], dir[1]) || 1
    const k1 = Math.hypot(a.p[0] - prev[0], a.p[1] - prev[1]) / 3
    const k2 = Math.hypot(next[0] - a.p[0], next[1] - a.p[1]) / 3
    anchors[i] = { p: a.p, in: [a.p[0] - (dir[0] / len) * k1, a.p[1] - (dir[1] / len) * k1], out: [a.p[0] + (dir[0] / len) * k2, a.p[1] + (dir[1] / len) * k2], kind: 'Smooth' }
    return { ...s, anchors }
  })
}

/** Removes a point; a sub-path left with fewer than 2 points disappears. */
export function removeAnchor(paths: SubPath[], sp: number, i: number): SubPath[] {
  return paths
    .map((s, k) => (k === sp ? { ...s, anchors: s.anchors.filter((_, j) => j !== i) } : s))
    .filter((s) => s.anchors.length >= (s.closed ? 3 : 2))
}

/** Moves a point (its handles come along) or one handle (a smooth point's other handle turns to match). */
export function dragPart(paths: SubPath[], sp: number, i: number, part: 'p' | 'in' | 'out', to: XY, breakHandles = false): SubPath[] {
  return paths.map((s, k) => {
    if (k !== sp) return s
    const anchors = s.anchors.map((x) => ({ ...x }))
    const a = anchors[i]
    if (part === 'p') {
      const [dx, dy] = [to[0] - a.p[0], to[1] - a.p[1]]
      const mv = (q?: XY): XY | undefined => (q ? [q[0] + dx, q[1] + dy] : undefined)
      anchors[i] = { ...a, p: to, ...(a.in ? { in: mv(a.in) } : {}), ...(a.out ? { out: mv(a.out) } : {}) }
    } else {
      const other = part === 'in' ? 'out' : 'in'
      const next: Anchor = { ...a, [part]: to }
      if (a.kind === 'Smooth' && !breakHandles) {
        const o = a[other] ?? a.p
        const len = Math.hypot(o[0] - a.p[0], o[1] - a.p[1]) || Math.hypot(to[0] - a.p[0], to[1] - a.p[1])
        const dir: XY = [a.p[0] - to[0], a.p[1] - to[1]]
        const dl = Math.hypot(dir[0], dir[1]) || 1
        next[other] = [a.p[0] + (dir[0] / dl) * len, a.p[1] + (dir[1] / dl) * len]
      } else if (breakHandles) next.kind = 'Corner'
      anchors[i] = next
    }
    return { ...s, anchors }
  })
}
