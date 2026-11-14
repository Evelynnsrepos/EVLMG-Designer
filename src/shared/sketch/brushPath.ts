/**
 * Per-brush stroke smoothing, applied on top of the editor's StreamLine:
 * - Stabilization averages the last few points (steadier, slightly behind the pen).
 * - Motion filtering removes small shakes sideways to the stroke direction;
 *   expression brings part of them back so lines keep some life.
 * Both catch up with the pen when the stroke ends (`flush`).
 */

interface Pt {
  x: number
  y: number
  pressure: number
}

export class PathSmoother<P extends Pt> {
  private window: P[] = []
  private last: P | null = null
  private dir: { x: number; y: number } | null = null
  private size: number
  private filter: number
  private expression: number

  constructor(stabilization: number, motionFilter: number, expression: number) {
    this.size = 1 + Math.round(Math.max(0, stabilization) * 24)
    this.filter = Math.max(0, motionFilter)
    this.expression = Math.max(0, Math.min(1, expression))
  }

  get active() {
    return this.size > 1 || this.filter > 0
  }

  /** The smoothed point for a new pen point. */
  push(p: P): P {
    if (!this.active) return p
    let q = p
    if (this.filter > 0 && this.last && this.dir) {
      // Sideways offset from the current direction, damped up to `filter * 6` px.
      const dx = p.x - this.last.x
      const dy = p.y - this.last.y
      const along = dx * this.dir.x + dy * this.dir.y
      const side = { x: dx - this.dir.x * along, y: dy - this.dir.y * along }
      const sideLen = Math.hypot(side.x, side.y)
      const limit = this.filter * 6
      const keep = sideLen > limit ? 1 - limit / sideLen : 0
      const k = keep + (1 - keep) * this.expression
      q = { ...p, x: this.last.x + this.dir.x * along + side.x * k, y: this.last.y + this.dir.y * along + side.y * k }
    }
    if (this.last) {
      const dx = q.x - this.last.x
      const dy = q.y - this.last.y
      const len = Math.hypot(dx, dy)
      if (len > 0.5) {
        const nx = dx / len
        const ny = dy / len
        // Direction follows slowly so one shaky point can't turn it.
        const d = this.dir ? { x: this.dir.x * 0.7 + nx * 0.3, y: this.dir.y * 0.7 + ny * 0.3 } : { x: nx, y: ny }
        const dl = Math.hypot(d.x, d.y) || 1
        this.dir = { x: d.x / dl, y: d.y / dl }
      }
    }
    this.last = q
    this.window.push(q)
    if (this.window.length > this.size) this.window.shift()
    return this.average()
  }

  /** Points that walk from the smoothed position to the pen's last point. */
  flush(): P[] {
    const out: P[] = []
    if (!this.last || this.size <= 1) return out
    while (this.window.length > 1) {
      this.window.shift()
      out.push(this.average())
    }
    return out
  }

  private average(): P {
    const w = this.window
    let x = 0
    let y = 0
    let pressure = 0
    for (const p of w) {
      x += p.x
      y += p.y
      pressure += p.pressure
    }
    return { ...w[w.length - 1], x: x / w.length, y: y / w.length, pressure: pressure / w.length }
  }
}

/**
 * Round curves between pen points. When points arrive far apart (a fast circle, or a webview that
 * sends few moves), straight lines between them turn circles into polygons. The stroke instead follows
 * a Catmull-Rom curve through every pen point, filled in every ~2 px. A segment is drawn once the
 * point after it is known, so it trails the pen by one move; `flush` draws the rest at the end.
 */
export class CurveFill<P extends Pt> {
  private pts: P[] = []

  push(p: P): P[] {
    const q = this.pts
    q.push(p)
    if (q.length === 1) return [p]
    if (q.length === 2) return []
    if (q.length > 4) q.shift()
    // Segment q[-3] -> q[-2], with the points around it as handles (the first one is its own handle).
    const [p0, p1, p2, p3] = q.length === 3 ? [q[0], q[0], q[1], q[2]] : q
    return segment(p0, p1, p2, p3)
  }

  flush(): P[] {
    const q = this.pts
    this.pts = []
    if (q.length < 2) return []
    const [p0, p1, p2] = q.length === 2 ? [q[0], q[0], q[1]] : q.slice(-3)
    return segment(p0, p1, p2, p2)
  }
}

function segment<P extends Pt>(p0: P, p1: P, p2: P, p3: P): P[] {
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  // Short segments stay straight: nothing to round, and slow strokes stay exact.
  if (len < 6) return [p2]
  const n = Math.min(64, Math.ceil(len / 2))
  const cr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t)
  const out: P[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    // Position follows the curve; pressure, tilt, time and the rest change evenly along it.
    out.push(i === n ? p2 : { ...mix(p1, p2, t), x: cr(p0.x, p1.x, p2.x, p3.x, t), y: cr(p0.y, p1.y, p2.y, p3.y, t) })
  }
  return out
}

/** `a` to `b` at `t`, for every number the point carries. */
function mix<P extends Pt>(a: P, b: P, t: number): P {
  const out = { ...b } as Record<string, unknown>
  for (const k in b) {
    const va = (a as Record<string, unknown>)[k]
    const vb = (b as Record<string, unknown>)[k]
    if (typeof va === 'number' && typeof vb === 'number') out[k] = va + (vb - va) * t
  }
  return out as P
}
