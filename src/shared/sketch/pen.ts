import type { InputPoint } from './model'

/**
 * Pen input (Sketch Pro): pressure curve, tilt, eraser end, motion filtering
 * and stabilization. Pure functions and small classes, no DOM.
 */

/** A point the pen reported, with tilt where the device has it. Extra fields are optional so plain points still work. */
export interface PenPoint extends InputPoint {
  /** Degrees, -90..90. */
  tiltX?: number
  tiltY?: number
  /** Radians: 0 = pen lying flat, π/2 = pen upright. */
  altitude?: number
  /** Radians, 0..2π, direction the pen leans to. */
  azimuth?: number
  /** Barrel rotation in degrees, 0..359 (only some pens). */
  twist?: number
}

export interface CurvePoint {
  x: number
  y: number
}

/** The straight line: output = input. */
export const LINEAR: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
]

/** Most handles a curve can have, ends included. */
export const MAX_CURVE_POINTS = 6

/**
 * Value of a curve at `x` (0..1). The curve goes smoothly through its points
 * (monotone cubic, so it never overshoots between handles) and is flat
 * before the first and after the last point. Used for the app-wide pressure
 * curve and by brushes for their own pressure and tilt graphs.
 */
export function applyCurve(points: readonly CurvePoint[], x: number): number {
  const p = [...points].sort((a, b) => a.x - b.x)
  if (!p.length) return x
  if (x <= p[0].x) return p[0].y
  const last = p[p.length - 1]
  if (x >= last.x) return last.y
  const n = p.length
  // Secant slopes, then tangents (Fritsch-Carlson).
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1].y - p[i].y) / (p[i + 1].x - p[i].x || 1e-9))
  const m: number[] = [d[0]]
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2)
  m.push(d[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }
  let i = 0
  while (x > p[i + 1].x) i++
  const h = p[i + 1].x - p[i].x
  const t = (x - p[i].x) / h
  const t2 = t * t
  const t3 = t2 * t
  const y = (2 * t3 - 3 * t2 + 1) * p[i].y + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1].y + (t3 - t2) * h * m[i + 1]
  return Math.min(1, Math.max(0, y))
}

// ---- Reading the pen ----------------------------------------------------------

/** The fields of a PointerEvent the pen code reads (so tests can pass plain objects). */
export interface PenEventLike {
  pointerType: string
  pressure: number
  button: number
  buttons: number
  tiltX?: number
  tiltY?: number
  twist?: number
  altitudeAngle?: number
  azimuthAngle?: number
}

/** Set once any pen reports a real pressure value; pens without pressure send only 0.5 (or 0/1). */
let pressureSeen = false

/** A pen with real pressure was seen: the pen's own lift thins the stroke end, so brushes skip their end taper. */
export const hasRealPressure = () => pressureSeen

/** For tests. */
export function resetPressureDetection() {
  pressureSeen = false
}

/**
 * Pressure 0.05..1 through the curve. Only pens with changing pressure count;
 * mice, touch and pens without pressure draw at full pressure.
 */
export function pressureOf(e: Pick<PenEventLike, 'pointerType' | 'pressure'>, curve: readonly CurvePoint[] = LINEAR): number {
  if (e.pointerType !== 'pen') return 1
  if (e.pressure > 0 && e.pressure !== 0.5 && e.pressure !== 1) pressureSeen = true
  if (!pressureSeen) return 1
  return Math.max(0.05, applyCurve(curve, e.pressure))
}

/** Altitude and azimuth from tiltX/tiltY when the browser doesn't give them. */
export function tiltToAngles(tiltX: number, tiltY: number): { altitude: number; azimuth: number } {
  if (!tiltX && !tiltY) return { altitude: Math.PI / 2, azimuth: 0 }
  const tx = Math.tan((Math.max(-89.9, Math.min(89.9, tiltX)) * Math.PI) / 180)
  const ty = Math.tan((Math.max(-89.9, Math.min(89.9, tiltY)) * Math.PI) / 180)
  let azimuth = Math.atan2(ty, tx)
  if (azimuth < 0) azimuth += Math.PI * 2
  return { altitude: Math.atan(1 / Math.hypot(tx, ty)), azimuth }
}

/**
 * Linux: the web engine passes a pen on as a mouse, so the app reads pressure and tilt from GTK
 * (graphics.rs `forward_pen`) into `window.__nativePen`, sent just before the pointer event.
 */
export function withNativePen(e: PenEventLike): PenEventLike {
  const n = (globalThis as { __nativePen?: { pressure: number; tiltX: number; tiltY: number; t: number } }).__nativePen
  if (!n || e.pointerType === 'touch' || performance.now() - n.t > 100) return e
  // As the pen lifts, GTK reports pressure 0 while the page still sees the tip down: keep the last real pressure,
  // or every stroke ends in a sudden hair-thin tail.
  if (e.buttons && n.pressure > 0) lastDownPressure = n.pressure
  const pressure = e.buttons && n.pressure === 0 ? lastDownPressure : n.pressure
  if (!e.buttons) lastDownPressure = 0
  return { pointerType: 'pen', pressure, tiltX: n.tiltX, tiltY: n.tiltY, button: e.button, buttons: e.buttons }
}
let lastDownPressure = 0

/** Pressure, tilt and twist of an event (tilt only for pens). */
export function penData(event: PenEventLike, curve: readonly CurvePoint[] = LINEAR): Omit<PenPoint, 'x' | 'y'> {
  const e = withNativePen(event)
  const pressure = pressureOf(e, curve)
  if (e.pointerType !== 'pen') return { pressure }
  const tiltX = e.tiltX ?? 0
  const tiltY = e.tiltY ?? 0
  const angles = typeof e.altitudeAngle === 'number' && typeof e.azimuthAngle === 'number' ? { altitude: e.altitudeAngle, azimuth: e.azimuthAngle } : tiltToAngles(tiltX, tiltY)
  return { pressure, tiltX, tiltY, ...angles, twist: e.twist ?? 0 }
}

/** Pen buttons as the `buttons` bit mask reports them. */
export const PEN_BITS = { tip: 1, barrel: 2, middle: 4, eraser: 32 } as const

/** True when the pen's eraser end touches (some drivers report it as pointerType 'eraser'). */
export function isEraserEnd(e: Pick<PenEventLike, 'pointerType' | 'button' | 'buttons'>): boolean {
  return e.pointerType === 'eraser' || (e.pointerType === 'pen' && (e.button === 5 || (e.buttons & PEN_BITS.eraser) !== 0))
}

/** Which side button a pen pointerdown is ('barrel' = lower button, 'middle' = upper button on many pens), or null for the tip. */
export function penButton(e: Pick<PenEventLike, 'pointerType' | 'button'>): 'barrel' | 'middle' | null {
  if (e.pointerType !== 'pen') return null
  return e.button === 2 ? 'barrel' : e.button === 1 ? 'middle' : null
}

// ---- Smoothing ------------------------------------------------------------------

/**
 * Motion filtering: a 1€ filter. Slow, shaky movement is smoothed a lot,
 * fast deliberate movement hardly at all, so jitter goes away without lag.
 */
export class MotionFilter {
  private last: { x: number; y: number; dx: number; dy: number; t: number } | null = null
  private minCutoff: number
  private beta = 0.04
  readonly amount: number

  /** `amount` 0..1: 0 = off. */
  constructor(amount: number) {
    this.amount = amount
    this.minCutoff = 12 * Math.pow(1 - Math.min(0.97, amount), 2) + 0.15
  }

  filter(x: number, y: number, t: number): { x: number; y: number } {
    if (this.amount <= 0) return { x, y }
    const l = this.last
    if (!l) {
      this.last = { x, y, dx: 0, dy: 0, t }
      return { x, y }
    }
    const dt = Math.max(1, t - l.t) / 1000
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt))
    const ad = alpha(1)
    const dx = l.dx + ad * ((x - l.x) / dt - l.dx)
    const dy = l.dy + ad * ((y - l.y) / dt - l.dy)
    const a = alpha(this.minCutoff + this.beta * Math.hypot(dx, dy))
    const out = { x: l.x + a * (x - l.x), y: l.y + a * (y - l.y) }
    this.last = { ...out, dx, dy, t }
    return out
  }

  clone(): MotionFilter {
    const c = new MotionFilter(this.amount)
    c.last = this.last && { ...this.last }
    return c
  }
}

/** Something that can bend points onto a guide (Drawing Assist); see guides.ts. */
export interface PointConstraint {
  /** The point on the guide, or null while it is still deciding. `commit` false = a look-ahead that must not change any state. */
  apply(p: PenPoint, commit: boolean): PenPoint | null
}

export interface PipelineOptions {
  /** 0..1, the brush's own StreamLine. */
  streamline: number
  /** 0..1, app-wide stabilization (averages the last points). */
  stabilization: number
  /** 0..1, app-wide motion filtering (removes jitter). */
  motionFilter: number
  /**
   * Tether length in canvas pixels (the brush's Stabilization): the brush tip
   * only moves once the pen is farther away than this, and is pulled along
   * behind it like on a string. 0 = off.
   */
  tether?: number
  constraint?: PointConstraint | null
}

/**
 * How far the smoothed point moves toward the pen in `dt` ms (0..1). It depends on
 * time, not on how many points arrive, so a pen sending 200 points a second is
 * smoothed as much as a mouse sending 60.
 */
export function followFor(streamline: number, dt: number): number {
  const s = Math.max(0, Math.min(1, streamline))
  if (s <= 0) return 1
  // Time constant from 0 (off) to 180 ms (very smooth); the curve gives finer control at the low end.
  const tau = 180 * s * s
  return 1 - Math.exp(-Math.max(1, Math.min(50, dt)) / tau)
}

/**
 * One stroke's input path: motion filter → stabilization → StreamLine → Drawing Assist.
 * `push` returns the points to draw; `peek` does the same for predicted points
 * without changing anything, so they can be shown and then thrown away.
 */
export class PenPipeline {
  private filter: MotionFilter
  private window: PenPoint[] = []
  private size: number
  private smooth: PenPoint | null = null
  private tip: PenPoint | null = null
  private lastT: number | null = null
  private lastRaw: { p: PenPoint; t: number } | null = null
  private opts: PipelineOptions

  constructor(opts: PipelineOptions) {
    this.opts = opts
    this.filter = new MotionFilter(opts.motionFilter)
    this.size = 1 + Math.round(Math.max(0, Math.min(1, opts.stabilization)) * 20)
  }

  /** `commit` false only keeps Drawing Assist from locking; the caller saves and restores the rest. */
  private step(raw: PenPoint, t: number, commit: boolean): PenPoint | null {
    const f = this.filter.filter(raw.x, raw.y, t)
    this.window = [...this.window, { ...raw, ...f }].slice(-this.size)
    const win = this.window
    const avg = { ...raw, x: win.reduce((s, q) => s + q.x, 0) / win.length, y: win.reduce((s, q) => s + q.y, 0) / win.length }
    const prev = this.smooth
    const k = followFor(this.opts.streamline, t - (this.lastT ?? t))
    this.smooth = prev ? { ...avg, x: prev.x + (avg.x - prev.x) * k, y: prev.y + (avg.y - prev.y) * k, pressure: prev.pressure + (avg.pressure - prev.pressure) * k } : avg
    if (commit) this.lastT = t
    let out: PenPoint = this.smooth
    const len = this.opts.tether ?? 0
    if (len > 0) {
      if (!this.tip) this.tip = out
      else {
        const dx = out.x - this.tip.x
        const dy = out.y - this.tip.y
        const d = Math.hypot(dx, dy)
        // Inside the tether nothing is drawn; the pen only pulls the tip once the string is tight.
        if (d <= len) return null
        const k = (d - len) / d
        this.tip = { ...out, x: this.tip.x + dx * k, y: this.tip.y + dy * k }
      }
      out = this.tip
    }
    return this.opts.constraint ? this.opts.constraint.apply(out, commit) : out
  }

  /** Where the brush is while a tether is on (for drawing the string to the pen); null without one. */
  get tetherTip(): PenPoint | null {
    return (this.opts.tether ?? 0) > 0 ? this.tip : null
  }

  /** Feed one real input point (`t` in ms); returns 0 or 1 points to draw. */
  push(raw: PenPoint, t: number): PenPoint[] {
    this.lastRaw = { p: raw, t }
    const out = this.step(raw, t, true)
    return out ? [out] : []
  }

  /** Predicted points to preview; nothing is remembered. */
  peek(raws: { p: PenPoint; t: number }[]): PenPoint[] {
    const saved = { filter: this.filter, window: this.window, smooth: this.smooth, lastT: this.lastT, tip: this.tip }
    this.filter = this.filter.clone()
    const out: PenPoint[] = []
    for (const r of raws) {
      const q = this.step(r.p, r.t, false)
      if (q) out.push(q)
    }
    this.filter = saved.filter
    this.window = saved.window
    this.smooth = saved.smooth
    this.lastT = saved.lastT
    this.tip = saved.tip
    return out
  }

  /** At pen up: let the smoothing catch up, so the stroke still ends where the pen was lifted. */
  flush(): PenPoint[] {
    if (!this.lastRaw || (this.opts.tether ?? 0) > 0 || (this.size <= 1 && this.opts.streamline <= 0)) return []
    const out: PenPoint[] = []
    const end = this.lastRaw.p
    for (let i = 1; i <= 60; i++) {
      const q = this.step(end, this.lastRaw.t + i * 16, true)
      if (q) out.push(q)
      if (i >= this.size && this.smooth && Math.hypot(this.smooth.x - end.x, this.smooth.y - end.y) < 0.5) break
    }
    return out
  }
}
