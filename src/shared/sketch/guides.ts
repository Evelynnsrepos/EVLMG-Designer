import { accentNow } from '@/shared/canvas/theme'
import type { Id } from '@/core/model'
import type { PenPoint, PointConstraint } from './pen'

/**
 * Drawing guides (Sketch Pro): 2D grid, isometric, perspective and symmetry,
 * plus Drawing Assist, which bends strokes onto the active guide. Pure
 * geometry; the editor draws the lines and the engine uses the mirror copies.
 */

export interface Pt {
  x: number
  y: number
}

export type GuideKind = 'off' | 'grid' | 'isometric' | 'perspective' | 'symmetry'
export type SymmetryKind = 'vertical' | 'horizontal' | 'quadrant' | 'radial'

export interface DrawingGuide {
  kind: GuideKind
  /** Hidden guides keep their settings but do nothing. */
  visible: boolean
  /** Grid cell / triangle side in canvas pixels. */
  size: number
  /** Line color and opacity 0..1. */
  color: string
  opacity: number
  /** Perspective: how many vanishing points are used (1-3) and where they are. */
  points: 1 | 2 | 3
  vanishing: Pt[]
  symmetry: SymmetryKind
  /** Rotational: copies turn around the center instead of mirroring. */
  rotational: boolean
  /** Radial symmetry: number of segments, 2..16. */
  segments: number
  /** Symmetry center. */
  center: Pt
  /** Layers with Drawing Assist on. */
  assist: Id[]
}

export function defaultGuide(width: number, height: number): DrawingGuide {
  return {
    kind: 'off',
    visible: true,
    size: Math.max(16, Math.round(Math.min(width, height) / 16)),
    color: accentNow(),
    opacity: 0.5,
    points: 2,
    vanishing: [
      { x: width * 0.12, y: height * 0.4 },
      { x: width * 0.88, y: height * 0.4 },
      { x: width * 0.5, y: height * 1.5 },
    ],
    symmetry: 'vertical',
    rotational: false,
    segments: 6,
    center: { x: width / 2, y: height / 2 },
    assist: [],
  }
}

/** A saved guide with every field present (documents saved before guides have none). */
export function normalizeGuide(g: Partial<DrawingGuide> | undefined, width: number, height: number): DrawingGuide {
  const d = defaultGuide(width, height)
  const s = { ...d, ...g }
  const vanishing = d.vanishing.map((p, i) => s.vanishing?.[i] ?? p)
  return {
    ...s,
    size: Math.max(4, s.size || d.size),
    points: ([1, 2, 3] as const).includes(s.points) ? s.points : d.points,
    segments: Math.max(2, Math.min(16, Math.round(s.segments || d.segments))),
    vanishing,
    assist: Array.isArray(s.assist) ? s.assist : [],
  }
}

// ---- Symmetry -------------------------------------------------------------------

const rotate = (p: Pt, c: Pt, a: number): Pt => {
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return { x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos }
}

/** All copies of a point for the symmetry guide, the point itself first. */
export function symmetryCopies(g: Pick<DrawingGuide, 'symmetry' | 'rotational' | 'segments' | 'center'>, p: Pt): Pt[] {
  const c = g.center
  const mx = (q: Pt) => ({ x: 2 * c.x - q.x, y: q.y })
  const my = (q: Pt) => ({ x: q.x, y: 2 * c.y - q.y })
  const turns = (n: number) => Array.from({ length: n }, (_, i) => rotate(p, c, (i * Math.PI * 2) / n))
  switch (g.symmetry) {
    case 'vertical':
      return g.rotational ? turns(2) : [p, mx(p)]
    case 'horizontal':
      return g.rotational ? turns(2) : [p, my(p)]
    case 'quadrant':
      return g.rotational ? turns(4) : [p, mx(p), my(p), mx(my(p))]
    case 'radial': {
      const n = g.segments
      if (g.rotational) return turns(n)
      // Mirror: each segment also has its reflection across the segment's middle line.
      const m = mx(p)
      return [...turns(n), ...Array.from({ length: n }, (_, i) => rotate(m, c, (i * Math.PI * 2) / n))]
    }
  }
}

/** The guide when it is shown and does something, else null. */
export function activeGuide(g: DrawingGuide | null | undefined): DrawingGuide | null {
  return g && g.visible && g.kind !== 'off' ? g : null
}

/** The mirror function for the engine: symmetry paints on layers with Drawing Assist on. */
export function symmetryMirror(g: DrawingGuide | null, layerId: Id): ((p: Pt) => Pt[]) | null {
  if (!g || g.kind !== 'symmetry' || !g.assist.includes(layerId)) return null
  return (p) => symmetryCopies(g, p)
}

// ---- Lines to draw ------------------------------------------------------------------

export interface GuideLine {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Axes and horizon lines are drawn stronger. */
  strong?: boolean
}

/** The guide's lines in canvas pixels (the overlay clips them to the canvas). */
export function guideLines(g: DrawingGuide, width: number, height: number): GuideLine[] {
  const out: GuideLine[] = []
  const s = g.size
  if (g.kind === 'grid') {
    for (let x = s; x < width; x += s) out.push({ x1: x, y1: 0, x2: x, y2: height })
    for (let y = s; y < height; y += s) out.push({ x1: 0, y1: y, x2: width, y2: y })
  } else if (g.kind === 'isometric') {
    // Equilateral triangles with side s: vertical lines and lines at 30° and 150°.
    const dx = (s * Math.sqrt(3)) / 2
    for (let x = dx; x < width; x += dx) out.push({ x1: x, y1: 0, x2: x, y2: height })
    const k = 1 / Math.sqrt(3)
    const reach = width * k
    for (let c = -reach - (-reach % s); c < height + reach; c += s) {
      out.push({ x1: 0, y1: c, x2: width, y2: c + width * k })
      out.push({ x1: 0, y1: c, x2: width, y2: c - width * k })
    }
  } else if (g.kind === 'perspective') {
    const vps = g.vanishing.slice(0, g.points)
    const far = Math.hypot(width, height) * 3
    for (const v of vps) {
      for (let i = 0; i < 36; i++) {
        const a = (i * Math.PI * 2) / 36
        out.push({ x1: v.x, y1: v.y, x2: v.x + Math.cos(a) * far, y2: v.y + Math.sin(a) * far })
      }
    }
    // Horizon through the first two points (level for one point).
    const [a, b] = vps
    if (g.points === 1) out.push({ x1: -far, y1: a.y, x2: far, y2: a.y, strong: true })
    else {
      const dir = { x: b.x - a.x, y: b.y - a.y }
      const l = Math.hypot(dir.x, dir.y) || 1
      out.push({ x1: a.x - (dir.x / l) * far, y1: a.y - (dir.y / l) * far, x2: a.x + (dir.x / l) * far, y2: a.y + (dir.y / l) * far, strong: true })
    }
  } else if (g.kind === 'symmetry') {
    const c = g.center
    const far = Math.hypot(width, height) * 2
    const ray = (a: number) => out.push({ x1: c.x, y1: c.y, x2: c.x + Math.cos(a) * far, y2: c.y + Math.sin(a) * far, strong: true })
    if (g.symmetry === 'vertical' || g.symmetry === 'quadrant') out.push({ x1: c.x, y1: -far, x2: c.x, y2: far, strong: true })
    if (g.symmetry === 'horizontal' || g.symmetry === 'quadrant') out.push({ x1: -far, y1: c.y, x2: far, y2: c.y, strong: true })
    if (g.symmetry === 'radial') for (let i = 0; i < g.segments; i++) ray(-Math.PI / 2 + (i * Math.PI * 2) / g.segments)
  }
  return out
}

/** Points that can be dragged to change the guide (vanishing points or the symmetry center). */
export function guideHandles(g: DrawingGuide): Pt[] {
  if (g.kind === 'perspective') return g.vanishing.slice(0, g.points)
  if (g.kind === 'symmetry') return [g.center]
  return []
}

export function moveHandle(g: DrawingGuide, index: number, to: Pt): DrawingGuide {
  if (g.kind === 'perspective') return { ...g, vanishing: g.vanishing.map((p, i) => (i === index ? to : p)) }
  if (g.kind === 'symmetry') return { ...g, center: to }
  return g
}

// ---- Drawing Assist ----------------------------------------------------------------

/** Directions a stroke starting at `start` may follow (unit vectors). */
export function assistDirections(g: DrawingGuide, start: Pt): Pt[] {
  const deg = (d: number) => ({ x: Math.cos((d * Math.PI) / 180), y: Math.sin((d * Math.PI) / 180) })
  const toward = (v: Pt) => {
    const l = Math.hypot(v.x - start.x, v.y - start.y)
    return l < 1e-6 ? null : { x: (v.x - start.x) / l, y: (v.y - start.y) / l }
  }
  switch (g.kind) {
    case 'grid':
      return [deg(0), deg(90)]
    case 'isometric':
      return [deg(30), deg(90), deg(150)]
    case 'perspective': {
      const vps = g.vanishing.slice(0, g.points).map(toward).filter((d): d is Pt => !!d)
      if (g.points === 1) return [...vps, deg(0), deg(90)]
      if (g.points === 2) return [...vps, deg(90)]
      return vps
    }
    default:
      return []
  }
}

/** Of `dirs`, the line (either way along it) closest to the motion `v`. */
export function closestDirection(dirs: Pt[], v: Pt): Pt | null {
  const l = Math.hypot(v.x, v.y)
  if (!l || !dirs.length) return null
  let best = dirs[0]
  let bestDot = -1
  for (const d of dirs) {
    const dot = Math.abs((d.x * v.x + d.y * v.y) / l)
    if (dot > bestDot) {
      bestDot = dot
      best = d
    }
  }
  return best
}

/**
 * Drawing Assist for one stroke: once the stroke has moved `lockAfter`
 * canvas pixels it picks the guide line closest to that direction and keeps
 * the rest of the stroke on it.
 */
export class LineAssist implements PointConstraint {
  private start: PenPoint | null = null
  private dir: Pt | null = null
  private g: DrawingGuide
  private lockAfter: number

  constructor(g: DrawingGuide, lockAfter: number) {
    this.g = g
    this.lockAfter = lockAfter
  }

  apply(p: PenPoint, commit: boolean): PenPoint | null {
    if (!this.start) {
      if (commit) this.start = p
      return p
    }
    const s = this.start
    let dir = this.dir
    if (!dir) {
      if (Math.hypot(p.x - s.x, p.y - s.y) < this.lockAfter) return null
      dir = closestDirection(assistDirections(this.g, s), { x: p.x - s.x, y: p.y - s.y })
      if (!dir) return p
      if (commit) this.dir = dir
    }
    const t = (p.x - s.x) * dir.x + (p.y - s.y) * dir.y
    return { ...p, x: s.x + dir.x * t, y: s.y + dir.y * t }
  }
}

/** Drawing Assist for a stroke on `layerId`, or null when it is off there (symmetry needs no line assist). */
export function assistFor(g: DrawingGuide | null, layerId: Id, lockAfter: number): PointConstraint | null {
  if (!g || !g.visible || g.kind === 'off' || g.kind === 'symmetry' || !g.assist.includes(layerId)) return null
  return new LineAssist(g, lockAfter)
}
