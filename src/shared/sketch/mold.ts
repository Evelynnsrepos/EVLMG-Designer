import type { Box, Pt } from './transform'

/**
 * Mold object (puppet warp, no AI): a triangle mesh over the painted part of the lifted pixels.
 * Built from an n × n cell grid, but each cell joins its neighbours only where the paint itself
 * connects, so parts that only sit close together (two legs, fingers) stay separate and bend on their own.
 * Pins and grabs sit anywhere on a triangle (barycentric), not only on mesh points.
 */

export type Bary = [number, number, number]
/** A spot on the mesh: triangle `t`, weights `b` of its three points. */
export interface Spot {
  t: number
  b: Bary
}
/** A spot that must land on `p` (a pin, or the point being dragged). */
export interface Hold extends Spot {
  p: Pt
}

export interface Mold {
  /** Cells per side the mesh was built with. */
  n: number
  /** Per point: where it sits in the source picture (0..1 each). */
  uv: Pt[]
  /** Per point: where it is now (canvas px). */
  pts: Pt[]
  /** Per point: where it was before molding (Keep shape bends back towards these shapes). */
  rest: Pt[]
  /** Triangles, three point indices each. */
  tris: number[]
  /** Per triangle: higher is drawn on top, so a folded arm can go in front of or behind the body. */
  depth: number[]
  /** Pins: these spots stay where they are. */
  pins: Spot[]
  /** Pins picked to move or turn together (indices into `pins`). */
  sel: number[]
}

/**
 * Which part each of the n × n cells over `src` belongs to (-1: no paint). Cells next to each other are one
 * part only where painted pixels touch across their shared side. Reads two pixel rows at a time.
 */
export function cellParts(alpha: (x: number, y: number) => number, src: Box, n: number): Int32Array {
  const up = new Int32Array(n * n).map((_, i) => i)
  const find = (i: number): number => {
    while (up[i] !== i) i = up[i] = up[up[i]]
    return i
  }
  const join = (a: number, b: number) => {
    if (a !== b) up[find(a)] = find(b)
  }
  const on = new Uint8Array(n * n)
  const x0 = Math.floor(src.x)
  const y0 = Math.floor(src.y)
  const w = Math.ceil(src.x + src.w) - x0
  const h = Math.ceil(src.y + src.h) - y0
  const col = new Int32Array(w).map((_, k) => Math.min(n - 1, Math.max(0, Math.floor(((x0 + k - src.x) / src.w) * n))))
  let prev = new Int32Array(w).fill(-1)
  let row = new Int32Array(w)
  for (let y = 0; y < h; y++) {
    const cj = Math.min(n - 1, Math.max(0, Math.floor(((y0 + y - src.y) / src.h) * n)))
    for (let x = 0; x < w; x++) {
      const c = alpha(x0 + x, y0 + y) > 0 ? cj * n + col[x] : -1
      row[x] = c
      if (c < 0) continue
      on[c] = 1
      if (x > 0 && row[x - 1] >= 0) join(c, row[x - 1])
      if (prev[x] >= 0) join(c, prev[x])
    }
    ;[prev, row] = [row, prev]
  }
  const ids = new Map<number, number>()
  const out = new Int32Array(n * n).fill(-1)
  on.forEach((o, c) => {
    if (!o) return
    const r = find(c)
    if (!ids.has(r)) ids.set(r, ids.size)
    out[c] = ids.get(r)!
  })
  return out
}

/**
 * Lay a mesh: every cell with a part gets two triangles; points are shared only inside one part.
 * `place(u, v, cu, cv)` says where a point goes now and at rest; (cu, cv) is the middle of a cell it belongs to.
 * Without `parts` every cell is used, as one part.
 */
export function buildMold(n: number, place: (u: number, v: number, cu: number, cv: number) => { p: Pt; r: Pt }, parts?: Int32Array): Mold {
  const use = parts && parts.some((p) => p >= 0) ? parts : new Int32Array(n * n)
  const m: Mold = { n, uv: [], pts: [], rest: [], tris: [], depth: [], pins: [], sel: [] }
  const ids = new Map<number, number>()
  const vid = (i: number, j: number, part: number, ci: number, cj: number) => {
    const key = (j * (n + 1) + i) * (n * n + 1) + part
    let k = ids.get(key)
    if (k === undefined) {
      k = m.uv.length
      ids.set(key, k)
      const { p, r } = place(i / n, j / n, (ci + 0.5) / n, (cj + 0.5) / n)
      m.uv.push({ x: i / n, y: j / n })
      m.pts.push(p)
      m.rest.push(r)
    }
    return k
  }
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const part = use[j * n + i]
      if (part < 0) continue
      const [a, b, c, d] = [vid(i, j, part, i, j), vid(i + 1, j, part, i, j), vid(i, j + 1, part, i, j), vid(i + 1, j + 1, part, i, j)]
      m.tris.push(a, b, c, b, d, c)
      m.depth.push(0, 0)
    }
  return m
}

/** Weights of `p` in the triangle a, b, c (can be below 0 outside it). */
export function bary(a: Pt, b: Pt, c: Pt, p: Pt): Bary {
  const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y) || 1e-12
  const wa = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / d
  const wb = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / d
  return [wa, wb, 1 - wa - wb]
}

const cellCache = new WeakMap<number[], Map<number, number[]>>()
/** Triangles by the source cell they sit in. */
function trisByCell(m: Mold): Map<number, number[]> {
  let c = cellCache.get(m.tris)
  if (c) return c
  c = new Map()
  for (let t = 0; t < m.tris.length / 3; t++) {
    const [a, b, d] = [m.uv[m.tris[t * 3]], m.uv[m.tris[t * 3 + 1]], m.uv[m.tris[t * 3 + 2]]]
    const i = Math.floor(((a.x + b.x + d.x) / 3) * m.n)
    const j = Math.floor(((a.y + b.y + d.y) / 3) * m.n)
    const k = j * m.n + i
    const list = c.get(k)
    if (list) list.push(t)
    else c.set(k, [t])
  }
  cellCache.set(m.tris, c)
  return c
}

/** The triangle under source point (u, v), or null over empty cells. */
export function findSpot(m: Mold, u: number, v: number): Spot | null {
  const by = trisByCell(m)
  const ci = Math.floor(u * m.n)
  const cj = Math.floor(v * m.n)
  // Its own cell first, then the ones around it (points on a cell side).
  for (const [di, dj] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]])
    for (const t of by.get((cj + dj) * m.n + ci + di) ?? []) {
      if (ci + di < 0 || ci + di >= m.n) continue
      const b = bary(m.uv[m.tris[t * 3]], m.uv[m.tris[t * 3 + 1]], m.uv[m.tris[t * 3 + 2]], { x: u, y: v })
      if (b.every((w) => w > -1e-6)) return { t, b }
    }
  return null
}

/** The triangle under canvas point `p` as the mesh is now (the topmost one), or null. */
export function spotAt(m: Mold, p: Pt): Spot | null {
  let best: Spot | null = null
  let bd = -Infinity
  for (let t = 0; t < m.tris.length / 3; t++) {
    const b = bary(m.pts[m.tris[t * 3]], m.pts[m.tris[t * 3 + 1]], m.pts[m.tris[t * 3 + 2]], p)
    if (b.every((w) => w > -1e-6) && m.depth[t] > bd) [best, bd] = [{ t, b }, m.depth[t]]
  }
  return best
}

/** Where a spot is, on `pts` (now) or `m.rest`. */
export function spotPos(m: Mold, s: Spot, pts: Pt[] = m.pts): Pt {
  const [a, b, c] = [pts[m.tris[s.t * 3]], pts[m.tris[s.t * 3 + 1]], pts[m.tris[s.t * 3 + 2]]]
  return { x: s.b[0] * a.x + s.b[1] * b.x + s.b[2] * c.x, y: s.b[0] * a.y + s.b[1] * b.y + s.b[2] * c.y }
}

/** Where a spot sits in the source (0..1). */
export const spotUv = (m: Mold, s: Spot) => spotPos(m, s, m.uv)

/** Where source point (u, v) lands, on `pts` (now) or `m.rest`; over empty cells, the nearest point. */
export function moldAt(m: Mold, u: number, v: number, pts: Pt[] = m.pts): Pt {
  const s = findSpot(m, u, v)
  if (s) return spotPos(m, s, pts)
  let k = 0
  let bd = Infinity
  m.uv.forEach((q, i) => {
    const d = (q.x - u) ** 2 + (q.y - v) ** 2
    if (d < bd) [k, bd] = [i, d]
  })
  return pts[k]
}

/**
 * Lay a new mesh (another Points setting) over `old` as it is now: the bend, the rest shape, pins,
 * picked pins and front/back all carry over. Each new point is looked up just inside its own cell,
 * so a point on the side between two parts takes the right part's place.
 */
export function remold(old: Mold, n: number, parts?: Int32Array): Mold {
  const eps = 0.25 / Math.max(n, old.n)
  const m = buildMold(
    n,
    (u, v, cu, cv) => {
      const s = findSpot(old, u + Math.sign(cu - u) * eps, v + Math.sign(cv - v) * eps)
      if (!s) return { p: moldAt(old, u, v), r: moldAt(old, u, v, old.rest) }
      const t = old.tris.slice(s.t * 3, s.t * 3 + 3)
      const b = bary(old.uv[t[0]], old.uv[t[1]], old.uv[t[2]], { x: u, y: v })
      const at = (pts: Pt[]) => ({ x: b[0] * pts[t[0]].x + b[1] * pts[t[1]].x + b[2] * pts[t[2]].x, y: b[0] * pts[t[0]].y + b[1] * pts[t[1]].y + b[2] * pts[t[2]].y })
      return { p: at(old.pts), r: at(old.rest) }
    },
    parts,
  )
  m.depth = depthFrom(m, old)
  const keep: number[] = []
  old.pins.forEach((pin, i) => {
    const uv = spotUv(old, pin)
    const s = findSpot(m, uv.x, uv.y)
    if (!s) return
    if (old.sel.includes(i)) keep.push(m.pins.length)
    m.pins.push(s)
  })
  m.sel = keep
  return m
}

/** Front/back of `m`'s triangles taken from `old` at the same source spots. */
function depthFrom(m: Mold, old: Mold): number[] {
  return m.depth.map((_, t) => {
    const c = spotUv(m, { t, b: [1 / 3, 1 / 3, 1 / 3] })
    const s = findSpot(old, c.x, c.y)
    return s ? old.depth[s.t] : 0
  })
}

const neighbourCache = new WeakMap<number[], number[][]>()
/** For each point, the points it shares a triangle side with. */
export function moldNeighbours(m: Mold): number[][] {
  const hit = neighbourCache.get(m.tris)
  if (hit) return hit
  const sets = Array.from({ length: m.pts.length }, () => new Set<number>())
  for (let t = 0; t < m.tris.length; t += 3)
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      sets[m.tris[t + a]].add(m.tris[t + b])
      sets[m.tris[t + b]].add(m.tris[t + a])
    }
  const out = sets.map((x) => [...x])
  neighbourCache.set(m.tris, out)
  return out
}

/** Move the points of each held triangle as little as possible so the held spot lands on its place. */
function project(m: Mold, holds: Hold[], px: Float64Array, py: Float64Array) {
  for (let r = 0; r < 3; r++)
    for (const h of holds) {
      const t = m.tris.slice(h.t * 3, h.t * 3 + 3)
      const ex = h.p.x - (h.b[0] * px[t[0]] + h.b[1] * px[t[1]] + h.b[2] * px[t[2]])
      const ey = h.p.y - (h.b[0] * py[t[0]] + h.b[1] * py[t[1]] + h.b[2] * py[t[2]])
      const s2 = h.b[0] ** 2 + h.b[1] ** 2 + h.b[2] ** 2 || 1
      t.forEach((k, i) => {
        px[k] += (ex * h.b[i]) / s2
        py[k] += (ey * h.b[i]) / s2
      })
    }
}

const done = (m: Mold, px: Float64Array, py: Float64Array): Mold => ({ ...m, pts: m.pts.map((_, i) => ({ x: px[i], y: py[i] })) })

/**
 * Keep shape (as-rigid-as-possible, like a puppet warp): the held spots (pins and the dragged one) go where
 * they are told, and every other point moves so each little piece of the mesh keeps its shape as well as it
 * can, only turning. So a leg bends instead of stretching. Starts from `m.pts`; called on every pointer move.
 */
export function moldKeepShape(m: Mold, holds: Hold[], rounds = 12): Mold {
  const rest = m.rest
  const nb = moldNeighbours(m)
  const N = m.pts.length
  const px = Float64Array.from(m.pts, (p) => p.x)
  const py = Float64Array.from(m.pts, (p) => p.y)
  // Points held on their own (a spot right on a point) are simply fixed.
  const fixed = new Set<number>()
  for (const h of holds) h.b.forEach((w, i) => w > 0.999 && fixed.add(m.tris[h.t * 3 + i]))
  project(m, holds, px, py)
  const c = new Float64Array(N).fill(1)
  const sn = new Float64Array(N)
  for (let r = 0; r < rounds; r++) {
    // Best turn of each point's neighbourhood from its rest shape to now.
    for (let i = 0; i < N; i++) {
      let a = 0
      let b = 0
      for (const j of nb[i]) {
        const ex = px[i] - px[j]
        const ey = py[i] - py[j]
        const rx = rest[i].x - rest[j].x
        const ry = rest[i].y - rest[j].y
        // Each side counts by its relative change, so short sides (a thin limb's width) hold as well as long ones.
        const w = 1 / (rx * rx + ry * ry || 1)
        a += (ex * rx + ey * ry) * w
        b += (rx * ey - ry * ex) * w
      }
      const l = Math.hypot(a, b) || 1
      ;[c[i], sn[i]] = [a / l, b / l]
    }
    // Each free point moves to where its neighbours, turned that way, say it should be.
    for (let i = 0; i < N; i++) {
      if (fixed.has(i) || !nb[i].length) continue
      let x = 0
      let y = 0
      let ws = 0
      for (const j of nb[i]) {
        const rx = rest[i].x - rest[j].x
        const ry = rest[i].y - rest[j].y
        const w = 1 / (rx * rx + ry * ry || 1)
        const cc = (c[i] + c[j]) / 2
        const ss = (sn[i] + sn[j]) / 2
        x += (px[j] + cc * rx - ss * ry) * w
        y += (py[j] + ss * rx + cc * ry) * w
        ws += w
      }
      px[i] = x / ws
      py[i] = y / ws
    }
    project(m, holds, px, py)
  }
  return done(m, px, py)
}

/**
 * Keep shape off: the points of the `grabbed` triangles go fully through `to` (a move or a turn); every other
 * point goes partly, by `pull` (0..1), less the further it is from the nearest of `from`, not at all past
 * `reach` px. The `holds` (pins that are not moving) are put back afterwards.
 */
export function moldFollow(m: Mold, grabbed: number[], from: Pt[], to: (p: Pt) => Pt, reach: number, pull: number, holds: Hold[]): Mold {
  const hard = new Set(grabbed.flatMap((t) => m.tris.slice(t * 3, t * 3 + 3)))
  const px = new Float64Array(m.pts.length)
  const py = new Float64Array(m.pts.length)
  m.pts.forEach((p, i) => {
    let w = hard.has(i) ? 1 : 0
    if (!w && reach > 0)
      for (const g of from) {
        const t = Math.hypot(p.x - g.x, p.y - g.y) / reach
        if (t < 1) w = Math.max(w, pull * (1 - t * t) ** 2)
      }
    const q = w ? to(p) : p
    px[i] = p.x + (q.x - p.x) * w
    py[i] = p.y + (q.y - p.y) * w
  })
  project(m, holds, px, py)
  return done(m, px, py)
}

/** A pose copied off one mold: how far each source spot moved, scaled to the source size. */
export interface Pose {
  mold: Mold
  src: Box
}

/** Put a copied pose on `m` (over `src`): same source spots move the same way, scaled to this size; pins and front/back come along. */
export function pastePose(m: Mold, src: Box, pose: Pose): Mold {
  const sx = src.w / (pose.src.w || 1)
  const sy = src.h / (pose.src.h || 1)
  const pts = m.uv.map((q, i) => {
    const a = moldAt(pose.mold, q.x, q.y)
    const b = moldAt(pose.mold, q.x, q.y, pose.mold.rest)
    return { x: m.rest[i].x + (a.x - b.x) * sx, y: m.rest[i].y + (a.y - b.y) * sy }
  })
  const pins = pose.mold.pins.map((p) => spotUv(pose.mold, p)).flatMap((uv) => findSpot(m, uv.x, uv.y) ?? [])
  return { ...m, pts, pins, sel: [], depth: depthFrom(m, pose.mold) }
}
