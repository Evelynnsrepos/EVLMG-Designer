/**
 * Transform math (Sketch Pro): the lifted pixels are a rectangle `src` mapped onto
 * a quad (freeform, uniform, distort: a perspective mapping) or onto a 4×4 Bézier
 * warp mesh. All pure.
 */

export type Pt = { x: number; y: number }
export interface Box {
  x: number
  y: number
  w: number
  h: number
}
export type Quad = [Pt, Pt, Pt, Pt]
/** a, b, c, d, e, f: x' = a·x + c·y + e, y' = b·x + d·y + f (like DOMMatrix). */
export type Affine = [number, number, number, number, number, number]

export interface XfState {
  src: Box
  /** Corners: top left, top right, bottom right, bottom left. */
  quad: Quad
  /** 16 control points of the warp mesh (row by row), or null when not warped. */
  warp: Pt[] | null
  /** Mold: an (n + 1) × (n + 1) grid of points, each cell cut into two triangles; wins over quad and warp. */
  mold?: Mold | null
}

export interface Mold {
  n: number
  pts: Pt[]
  /** The points before any molding (Keep shape bends back towards these shapes). */
  rest?: Pt[]
  /** Per cell (row by row): does it hold paint? Empty cells are left out, so the mesh follows the drawing. */
  on?: boolean[]
  /** Pinned points: they stay where they are. */
  pins?: number[]
}

export const initialState = (src: Box): XfState => ({
  src,
  quad: [
    { x: src.x, y: src.y },
    { x: src.x + src.w, y: src.y },
    { x: src.x + src.w, y: src.y + src.h },
    { x: src.x, y: src.y + src.h },
  ],
  warp: null,
})

export const apply = (m: Affine, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })

export function mul(m: Affine, n: Affine): Affine {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
}

export const translate = (dx: number, dy: number): Affine => [1, 0, 0, 1, dx, dy]

export function rotateAbout(c: Pt, angle: number): Affine {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return mul(translate(c.x, c.y), mul([cos, sin, -sin, cos, 0, 0], translate(-c.x, -c.y)))
}

/** Scale by (sx, sy) along the axes `ux` (unit) and its perpendicular, about point `c`. */
export function scaleAlong(c: Pt, ux: Pt, sx: number, sy: number): Affine {
  const r: Affine = [ux.x, ux.y, -ux.y, ux.x, 0, 0]
  const rInv: Affine = [ux.x, -ux.y, ux.y, ux.x, 0, 0]
  return mul(translate(c.x, c.y), mul(r, mul([sx, 0, 0, sy, 0, 0], mul(rInv, translate(-c.x, -c.y)))))
}

export function transformState(s: XfState, m: Affine): XfState {
  return mapAll(s, (p) => apply(m, p))
}

/** Send every point of the state (corners, warp and mold points) through `f`. */
export function mapAll(s: XfState, f: (p: Pt) => Pt): XfState {
  return { src: s.src, quad: s.quad.map(f) as Quad, warp: s.warp && s.warp.map(f), mold: s.mold && { ...s.mold, pts: s.mold.pts.map(f), rest: s.mold.rest?.map(f) } }
}

/** Perspective mapping of the unit square onto a quad (corners TL, TR, BR, BL). */
export function squareToQuad(q: Quad): (u: number, v: number) => Pt {
  const [p0, p1, p2, p3] = q
  const sx = p0.x - p1.x + p2.x - p3.x
  const sy = p0.y - p1.y + p2.y - p3.y
  let a, b, c, d, e, f, g, h
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    ;[a, b, c, d, e, f, g, h] = [p1.x - p0.x, p2.x - p1.x, p0.x, p1.y - p0.y, p2.y - p1.y, p0.y, 0, 0]
  } else {
    const dx1 = p1.x - p2.x
    const dx2 = p3.x - p2.x
    const dy1 = p1.y - p2.y
    const dy2 = p3.y - p2.y
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9
    g = (sx * dy2 - dx2 * sy) / den
    h = (dx1 * sy - sx * dy1) / den
    a = p1.x - p0.x + g * p1.x
    b = p3.x - p0.x + h * p3.x
    c = p0.x
    d = p1.y - p0.y + g * p1.y
    e = p3.y - p0.y + h * p3.y
    f = p0.y
  }
  return (u, v) => {
    const w = g * u + h * v + 1
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w }
  }
}

const bern = (t: number) => [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3]

/** A point of the 4×4 Bézier warp mesh. */
export function bezierPatch(ctrl: Pt[], u: number, v: number): Pt {
  const bu = bern(u)
  const bv = bern(v)
  let x = 0
  let y = 0
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++) {
      const w = bu[i] * bv[j]
      x += w * ctrl[j * 4 + i].x
      y += w * ctrl[j * 4 + i].y
    }
  return { x, y }
}

/** A point of the mold grid: flat inside each triangle, like the mesh that is drawn. */
export function moldPoint(m: Mold, u: number, v: number): Pt {
  const { n, pts } = m
  const i = Math.min(n - 1, Math.max(0, Math.floor(u * n)))
  const j = Math.min(n - 1, Math.max(0, Math.floor(v * n)))
  const fu = u * n - i
  const fv = v * n - j
  const at = (di: number, dj: number) => pts[(j + dj) * (n + 1) + i + di]
  const [o, a, b, ku, kv] = fu + fv <= 1 ? [at(0, 0), at(1, 0), at(0, 1), fu, fv] : [at(1, 1), at(0, 1), at(1, 0), 1 - fu, 1 - fv]
  return { x: o.x + ku * (a.x - o.x) + kv * (b.x - o.x), y: o.y + ku * (a.y - o.y) + kv * (b.y - o.y) }
}

/** Where the point (u, v) of the source (0..1 each) lands. */
export function mapPoint(s: XfState, u: number, v: number): Pt {
  return s.mold ? moldPoint(s.mold, u, v) : s.warp ? bezierPatch(s.warp, u, v) : squareToQuad(s.quad)(u, v)
}

/** Bent (warp or mold): needs a finer mesh to draw. */
export const curved = (s: XfState) => !!(s.warp || s.mold)

/** Start molding: an n × n cell grid that follows the current shape; `on` leaves out cells without paint. */
export function toMold(s: XfState, n: number, on?: boolean[]): XfState {
  const pts: Pt[] = []
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pts.push(mapPoint(s, i / n, j / n))
  return { ...s, mold: { n, pts, rest: pts, on, pins: [] } }
}

/** Which of the n × n cells over `src` hold any paint (`alpha(x, y)` 0..255). */
export function paintedCells(alpha: (x: number, y: number) => number, src: Box, n: number): boolean[] {
  const on = new Array<boolean>(n * n).fill(false)
  for (let y = Math.floor(src.y); y < src.y + src.h; y++)
    for (let x = Math.floor(src.x); x < src.x + src.w; x++)
      if (alpha(x, y) > 0) on[Math.min(n - 1, Math.floor(((y - src.y) / src.h) * n)) * n + Math.min(n - 1, Math.floor(((x - src.x) / src.w) * n))] = true
  return on
}

/** True for the points that belong to a cell with paint (the ones shown and dragged). */
export function moldLive(m: Mold): boolean[] {
  const n = m.n
  const live = new Array<boolean>((n + 1) * (n + 1)).fill(!m.on)
  if (m.on)
    m.on.forEach((c, k) => {
      if (!c) return
      const i = k % n
      const j = (k - i) / n
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) live[(j + dj) * (n + 1) + i + di] = true
    })
  return live
}

const neighbourCache = new WeakMap<object, number[][]>()
/** For each point, the points it shares a triangle edge with (only in cells with paint). */
export function moldNeighbours(m: Mold): number[][] {
  const key = m.on ?? m.pts
  const hit = neighbourCache.get(key)
  if (hit) return hit
  const n = m.n
  const sets = Array.from({ length: (n + 1) * (n + 1) }, () => new Set<number>())
  const id = (i: number, j: number) => j * (n + 1) + i
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      if (m.on && !m.on[j * n + i]) continue
      for (const [a, b] of [[id(i, j), id(i + 1, j)], [id(i, j), id(i, j + 1)], [id(i + 1, j), id(i, j + 1)], [id(i + 1, j), id(i + 1, j + 1)], [id(i, j + 1), id(i + 1, j + 1)]]) {
        sets[a].add(b)
        sets[b].add(a)
      }
    }
  const out = sets.map((x) => [...x])
  neighbourCache.set(key, out)
  return out
}

/**
 * Keep shape (as-rigid-as-possible, like a puppet warp; no AI): the `fixed` points (pins and the
 * dragged point) go where they are told, and every other point moves so each little piece of
 * the mesh keeps its shape as well as it can, only turning. So a leg bends instead of stretching.
 * Starts from `m.pts` and runs a few rounds; called on every pointer move, so it keeps improving.
 */
export function moldKeepShape(m: Mold, fixed: Map<number, Pt>, rounds = 12): Mold {
  const rest = m.rest ?? m.pts
  const nb = moldNeighbours(m)
  const N = m.pts.length
  const px = Float64Array.from(m.pts, (p) => p.x)
  const py = Float64Array.from(m.pts, (p) => p.y)
  for (const [i, p] of fixed) [px[i], py[i]] = [p.x, p.y]
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
        // Each edge counts by its relative change, so short edges (a thin limb's width) hold as well as long ones.
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
  }
  return { ...m, pts: m.pts.map((_, i) => ({ x: px[i], y: py[i] })) }
}

/**
 * Mold drag: the grabbed point moves by (dx, dy); every other point follows by `pull` (0..1),
 * less the further away it is, and not at all past `reach` pixels.
 */
export function moldDrag(m: Mold, index: number, dx: number, dy: number, reach: number, pull: number): Mold {
  const g = m.pts[index]
  const pinned = new Set(m.pins)
  const pts = m.pts.map((p, i) => {
    let w = 1
    if (i !== index && pinned.has(i)) w = 0
    else if (i !== index) {
      const t = reach > 0 ? Math.hypot(p.x - g.x, p.y - g.y) / reach : 1
      w = t >= 1 ? 0 : pull * (1 - t * t) ** 2
    }
    return w ? { x: p.x + dx * w, y: p.y + dy * w } : p
  })
  return { ...m, pts }
}

export interface Turn {
  /** Degrees around the across (tilt forward/back), up (turn left/right) and view (spin) axes. */
  x: number
  y: number
  z: number
  /** 0 flat (no vanishing), 1 strong perspective. */
  depth: number
}

/**
 * 3D turn: the flat picture is a card in space, turned about its centre and seen through a
 * camera in front of it, so the result is a perspective quad. No AI: plain 3D maths.
 */
export function turn3d(base: XfState, t: Turn): XfState {
  const c = mapPoint(base, 0.5, 0.5)
  const b = outerBounds(base)
  const size = Math.max(b.w, b.h, 1)
  const r = Math.PI / 180
  const [sx, cx] = [Math.sin(t.x * r), Math.cos(t.x * r)]
  const [sy, cy] = [Math.sin(t.y * r), Math.cos(t.y * r)]
  const [sz, cz] = [Math.sin(t.z * r), Math.cos(t.z * r)]
  // Camera distance: far away (nearly flat) at depth 0, about one picture size at depth 1.
  const f = size * (1 + 20 * (1 - t.depth) ** 2)
  return mapAll(base, (p) => {
    let x = p.x - c.x
    let y = p.y - c.y
    let z = 0
    ;[y, z] = [y * cx - z * sx, y * sx + z * cx]
    ;[x, z] = [x * cy + z * sy, -x * sy + z * cy]
    ;[x, y] = [x * cz - y * sz, x * sz + y * cz]
    const k = f / Math.max(f * 0.1, f - z)
    return { x: c.x + x * k, y: c.y + y * k }
  })
}

/** Start warping: a mesh that matches the current quad. */
export function toWarp(s: XfState): XfState {
  if (s.warp && !s.mold) return s
  // shortcut: from a mold the 4×4 mesh only goes through 16 of its points, so fine mold bends smooth out.
  const warp: Pt[] = []
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) warp.push(mapPoint(s, i / 3, j / 3))
  return { ...s, warp, mold: null }
}

/** Triangle mesh for drawing: positions (canvas px) and source uvs (0..1), `n` cells per side. */
export function buildMesh(s: XfState, n = 24): { pos: Float32Array; uv: Float32Array } {
  const map = s.warp ? (u: number, v: number) => bezierPatch(s.warp!, u, v) : squareToQuad(s.quad)
  let grid: Pt[] = []
  // A mold is drawn with exactly its own triangles (only the cells with paint).
  const on = s.mold?.on
  if (s.mold) [n, grid] = [s.mold.n, s.mold.pts]
  else for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) grid.push(map(i / n, j / n))
  const pos = new Float32Array(n * n * 12)
  const uv = new Float32Array(n * n * 12)
  let k = 0
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      if (on && !on[j * n + i]) continue
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 0], [1, 1], [0, 1]]) {
        const p = grid[(j + dj) * (n + 1) + i + di]
        pos[k] = p.x
        pos[k + 1] = p.y
        uv[k] = (i + di) / n
        uv[k + 1] = (j + dj) / n
        k += 2
      }
    }
  return k === pos.length ? { pos, uv } : { pos: pos.slice(0, k), uv: uv.slice(0, k) }
}

/** Axis-aligned bounds of the transformed picture (sampled along the edges). */
export function outerBounds(s: XfState): Box {
  // A mold's points can be dragged anywhere, so all of them count.
  const pts: Pt[] = s.mold ? [...s.mold.pts] : []
  for (let t = 0; t <= 8; t++) pts.push(mapPoint(s, t / 8, 0), mapPoint(s, t / 8, 1), mapPoint(s, 0, t / 8), mapPoint(s, 1, t / 8))
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/**
 * Snapping: shift (dx, dy) so the picture's edges or centre land on the canvas edges or centre
 * when they come within `dist`. Returns the new shift and the guide lines hit.
 */
export function snapShift(b: Box, dx: number, dy: number, w: number, h: number, dist: number): { dx: number; dy: number; gx: number[]; gy: number[] } {
  const axis = (start: number, size: number, d: number, total: number) => {
    let best: { d: number; at: number } | null = null
    for (const target of [0, total / 2, total])
      for (const edge of [start, start + size / 2, start + size]) {
        const off = target - (edge + d)
        if (Math.abs(off) <= dist && (!best || Math.abs(off) < Math.abs(best.d))) best = { d: off, at: target }
      }
    return best
  }
  const sx = axis(b.x, b.w, dx, w)
  const sy = axis(b.y, b.h, dy, h)
  return { dx: dx + (sx?.d ?? 0), dy: dy + (sy?.d ?? 0), gx: sx ? [sx.at] : [], gy: sy ? [sy.at] : [] }
}

/** Magnetics: keep a move on the nearest 45° line. */
export function magnetMove(dx: number, dy: number): [number, number] {
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  const len = dx * Math.cos(a) + dy * Math.sin(a)
  return [Math.round(len * Math.cos(a) * 1000) / 1000, Math.round(len * Math.sin(a) * 1000) / 1000]
}

/** Magnetics: angles snap to 15° steps. */
export const magnetAngle = (a: number) => Math.round(a / (Math.PI / 12)) * (Math.PI / 12)

/** Scale that makes the picture fit the canvas (centred, keeping its shape). */
export function fitAffine(b: Box, w: number, h: number): Affine {
  const s = Math.min(w / b.w, h / b.h)
  return mul(translate(w / 2, h / 2), mul([s, 0, 0, s, 0, 0], translate(-(b.x + b.w / 2), -(b.y + b.h / 2))))
}
