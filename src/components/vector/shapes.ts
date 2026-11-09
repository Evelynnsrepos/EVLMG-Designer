/**
 * Live shapes for the Vector tool: every shape is stored as its kind plus a few sliders and turned into
 * SVG path data here. The canvas (Konva Path) and the SVG export both draw from this one function.
 */

export const SHAPES = ['rect', 'ellipse', 'polygon', 'star', 'ring', 'heart', 'shield', 'cross', 'gear', 'bubble'] as const
export type ShapeKind = (typeof SHAPES)[number]

export const SHAPE_LABEL: Record<ShapeKind, string> = {
  rect: 'Box',
  ellipse: 'Circle',
  polygon: 'Polygon',
  star: 'Star',
  ring: 'Ring',
  heart: 'Heart',
  shield: 'Shield',
  cross: 'Cross',
  gear: 'Gear',
  bubble: 'Speech bubble',
}

export interface ShapeGeometry {
  shapeId: ShapeKind
  width: number
  height: number
  /** Rounded corners, 0–100 % of the most rounding the shape allows. */
  corner?: number
  /** Polygon sides, star points or gear teeth. */
  sides?: number
  /** Star inner size, ring and cross thickness, gear tooth depth: 5–95 %. */
  inner?: number
}

/** Which sliders a shape has, with plain names and defaults. */
export const SHAPE_SLIDERS: Record<ShapeKind, { corner?: boolean; sides?: { label: string; min: number; max: number }; inner?: string }> = {
  rect: { corner: true },
  ellipse: {},
  polygon: { corner: true, sides: { label: 'Sides', min: 3, max: 12 } },
  star: { corner: true, sides: { label: 'Points', min: 3, max: 16 }, inner: 'Inner size' },
  ring: { inner: 'Thickness' },
  heart: {},
  shield: {},
  cross: { corner: true, inner: 'Thickness' },
  gear: { corner: true, sides: { label: 'Teeth', min: 4, max: 24 }, inner: 'Tooth depth' },
  bubble: { corner: true },
}

export const SHAPE_DEFAULTS: Record<ShapeKind, Pick<ShapeGeometry, 'corner' | 'sides' | 'inner'>> = {
  rect: { corner: 20 },
  ellipse: {},
  polygon: { corner: 0, sides: 6 },
  star: { corner: 0, sides: 5, inner: 45 },
  ring: { inner: 30 },
  heart: {},
  shield: {},
  cross: { corner: 0, inner: 34 },
  gear: { corner: 20, sides: 10, inner: 22 },
  bubble: { corner: 40 },
}

interface P {
  x: number
  y: number
}

const n = (v: number) => String(Math.round(v * 100) / 100)
const pt = (p: P) => `${n(p.x)} ${n(p.y)}`

/** Points on a unit circle (angle 0 = top), stretched so their bounding box fills w × h exactly. */
function fitBox(unit: P[], w: number, h: number): P[] {
  const xs = unit.map((p) => p.x)
  const ys = unit.map((p) => p.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  return unit.map((p) => ({ x: ((p.x - x0) / (x1 - x0 || 1)) * w, y: ((p.y - y0) / (y1 - y0 || 1)) * h }))
}

const onCircle = (angle: number, r: number): P => ({ x: Math.sin(angle) * r, y: -Math.cos(angle) * r })

/** A closed polygon whose corners are cut back by `r` and bent with a curve through the corner. */
export function roundedPolygon(points: P[], r: number): string {
  if (points.length < 3) return ''
  if (r <= 0) return `M ${points.map(pt).join(' L ')} Z`
  const cuts = points.map((cur, i) => {
    const prev = points[(i - 1 + points.length) % points.length]
    const next = points[(i + 1) % points.length]
    const l1 = Math.hypot(prev.x - cur.x, prev.y - cur.y) || 1
    const l2 = Math.hypot(next.x - cur.x, next.y - cur.y) || 1
    const rr = Math.min(r, l1 / 2, l2 / 2)
    return {
      a: { x: cur.x + ((prev.x - cur.x) * rr) / l1, y: cur.y + ((prev.y - cur.y) * rr) / l1 },
      c: cur,
      b: { x: cur.x + ((next.x - cur.x) * rr) / l2, y: cur.y + ((next.y - cur.y) * rr) / l2 },
    }
  })
  return `M ${pt(cuts[0].a)} ${cuts.map((k, i) => `${i ? `L ${pt(k.a)} ` : ''}Q ${pt(k.c)} ${pt(k.b)}`).join(' ')} Z`
}

/** Full ellipse as two arcs; `reverse` runs the other way round so it cuts a hole in the shape around it. */
function ellipse(cx: number, cy: number, rx: number, ry: number, reverse = false) {
  const s = reverse ? 0 : 1
  return `M ${n(cx - rx)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 1 ${s} ${n(cx + rx)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 1 ${s} ${n(cx - rx)} ${n(cy)} Z`
}

function roundedRect(w: number, h: number, r: number) {
  if (r <= 0) return `M 0 0 H ${n(w)} V ${n(h)} H 0 Z`
  const a = `A ${n(r)} ${n(r)} 0 0 1`
  return `M ${n(r)} 0 H ${n(w - r)} ${a} ${n(w)} ${n(r)} V ${n(h - r)} ${a} ${n(w - r)} ${n(h)} H ${n(r)} ${a} 0 ${n(h - r)} V ${n(r)} ${a} ${n(r)} 0 Z`
}

/** Unit-box (0..1) path commands scaled to w × h. */
function scaled(cmds: (string | number)[][], w: number, h: number) {
  return cmds.map(([c, ...v]) => `${c} ${v.map((x, i) => n((x as number) * (i % 2 ? h : w))).join(' ')}`).join(' ') + ' Z'
}

const clampPct = (v: number | undefined, d: number) => Math.min(95, Math.max(5, v ?? d)) / 100

/** SVG path data for a shape, in its own box from (0, 0) to (width, height). */
export function shapePath(g: ShapeGeometry): string {
  const w = Math.max(1, g.width)
  const h = Math.max(1, g.height)
  const d = SHAPE_DEFAULTS[g.shapeId] ?? {}
  const corner = Math.min(100, Math.max(0, g.corner ?? d.corner ?? 0)) / 100
  const sides = Math.round(g.sides ?? d.sides ?? 5)
  const inner = clampPct(g.inner, d.inner ?? 50)
  const small = Math.min(w, h)

  switch (g.shapeId) {
    case 'rect':
      return roundedRect(w, h, (corner * small) / 2)
    case 'ellipse':
      return ellipse(w / 2, h / 2, w / 2, h / 2)
    case 'polygon': {
      const pts = fitBox(Array.from({ length: Math.max(3, sides) }, (_, i) => onCircle((i * 2 * Math.PI) / Math.max(3, sides), 1)), w, h)
      return roundedPolygon(pts, (corner * small) / 3)
    }
    case 'star': {
      const k = Math.max(3, sides)
      const pts = fitBox(Array.from({ length: k * 2 }, (_, i) => onCircle((i * Math.PI) / k, i % 2 ? inner : 1)), w, h)
      return roundedPolygon(pts, (corner * small) / 8)
    }
    case 'ring': {
      const t = inner
      return `${ellipse(w / 2, h / 2, w / 2, h / 2)} ${ellipse(w / 2, h / 2, (w / 2) * (1 - t), (h / 2) * (1 - t), true)}`
    }
    case 'heart':
      return scaled(
        [
          ['M', 0.5, 0.22],
          ['C', 0.5, 0.08, 0.38, 0, 0.26, 0],
          ['C', 0.1, 0, 0, 0.13, 0, 0.3],
          ['C', 0, 0.56, 0.28, 0.76, 0.5, 1],
          ['C', 0.72, 0.76, 1, 0.56, 1, 0.3],
          ['C', 1, 0.13, 0.9, 0, 0.74, 0],
          ['C', 0.62, 0, 0.5, 0.08, 0.5, 0.22],
        ],
        w,
        h,
      )
    case 'shield':
      return scaled(
        [
          ['M', 0, 0.08],
          ['Q', 0.5, -0.08, 1, 0.08],
          ['L', 1, 0.46],
          ['C', 1, 0.75, 0.76, 0.91, 0.5, 1],
          ['C', 0.24, 0.91, 0, 0.75, 0, 0.46],
        ],
        w,
        h,
      )
    case 'cross': {
      const tx = (w * inner) / 2
      const ty = (h * inner) / 2
      const [cx, cy] = [w / 2, h / 2]
      const pts = [
        [cx - tx, 0], [cx + tx, 0], [cx + tx, cy - ty], [w, cy - ty], [w, cy + ty], [cx + tx, cy + ty],
        [cx + tx, h], [cx - tx, h], [cx - tx, cy + ty], [0, cy + ty], [0, cy - ty], [cx - tx, cy - ty],
      ].map(([x, y]) => ({ x, y }))
      return roundedPolygon(pts, corner * Math.min(tx, ty))
    }
    case 'gear': {
      const k = Math.max(4, sides)
      const step = (2 * Math.PI) / k
      const root = 1 - inner
      const unit = Array.from({ length: k }, (_, i) => {
        const a = i * step
        return [onCircle(a - step * 0.3, root), onCircle(a - step * 0.16, 1), onCircle(a + step * 0.16, 1), onCircle(a + step * 0.3, root)]
      }).flat()
      const pts = fitBox(unit, w, h)
      return `${roundedPolygon(pts, (corner * small) / 10)} ${ellipse(w / 2, h / 2, w * 0.17, h * 0.17, true)}`
    }
    case 'bubble': {
      const bh = h * 0.8
      const r = Math.min((corner * Math.min(w, bh)) / 2, w * 0.2)
      const a = `A ${n(r)} ${n(r)} 0 0 1`
      return `M ${n(r)} 0 H ${n(w - r)} ${a} ${n(w)} ${n(r)} V ${n(bh - r)} ${a} ${n(w - r)} ${n(bh)} H ${n(w * 0.38)} L ${n(w * 0.18)} ${n(h)} L ${n(w * 0.22)} ${n(bh)} H ${n(r)} ${a} 0 ${n(bh - r)} V ${n(r)} ${a} ${n(r)} 0 Z`
    }
  }
}
