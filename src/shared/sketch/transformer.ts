import { useEffect, useMemo, useRef, useState } from 'react'
import type { Id } from '@/core/model'
import type { SketchEngine } from './engine'
import { renderMesh, type Interpolation } from './meshRender'
import { alphaBounds } from './selection'
import type { Selector } from './selector'
import {
  fitAffine,
  initialState,
  magnetAngle,
  magnetMove,
  mapPoint,
  outerBounds,
  rotateAbout,
  scaleAlong,
  snapShift,
  toWarp,
  transformState,
  translate,
  type Pt,
  type XfState,
} from './transform'

export type XfMode = 'free' | 'uniform' | 'distort' | 'warp'

/** (u, v) of the free/uniform handles: corners, then edge middles. */
const HANDLES: [number, number][] = [
  [0, 0], [1, 0], [1, 1], [0, 1],
  [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5],
]

type Drag =
  | { kind: 'move'; from: Pt; s0: XfState }
  | { kind: 'scale' | 'corner' | 'mesh'; index: number; from: Pt; s0: XfState }
  | { kind: 'rotate'; from: Pt; s0: XfState }

/**
 * Transform (Sketch Pro): lifts the selection (or layer) and maps it through a quad or
 * warp mesh with live preview; the result lands on the layer as one undo step.
 */
export class Transformer {
  mode: XfMode = 'free'
  interp: Interpolation = 'bilinear'
  /** Off by default (v0.13): sticking to the middle line got in the way of placing things near it. */
  snapping = false
  /** Snap distance in screen pixels. */
  snapDistance = 10
  magnetics = false
  state: XfState | null = null
  layerId: Id | null = null
  guides: { gx: number[]; gy: number[] } = { gx: [], gy: [] }
  version = 0
  private first: XfState | null = null
  private drag: Drag | null = null
  private out: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null
  private uploaded = false
  private onChange: () => void = () => {}
  private engine: SketchEngine

  constructor(engine: SketchEngine) {
    this.engine = engine
  }

  listen(fn: () => void) {
    this.onChange = fn
  }

  private changed() {
    this.version++
    this.onChange()
  }

  get active() {
    return !!this.state && this.engine.moving
  }

  /** Lift the layer's selected pixels. False when there is nothing to transform. */
  begin(layerId: Id): boolean {
    if (this.engine.moving) this.engine.cancelMove()
    this.engine.beginMove(layerId)
    const piece = this.engine.floatingPiece!
    const data = piece.getContext('2d')!.getImageData(0, 0, piece.width, piece.height).data
    const b = alphaBounds((p) => data[p * 4 + 3], piece.width, piece.height)
    if (!b) {
      this.engine.cancelMove()
      return false
    }
    this.layerId = layerId
    this.state = this.first = initialState(b)
    this.uploaded = false
    this.out = this.engine.canvas()
    this.changed()
    return true
  }

  private show() {
    const piece = this.engine.floatingPiece
    if (!piece || !this.state || !this.out) return
    renderMesh(piece, this.state, this.out.ctx, this.interp, !this.uploaded)
    this.uploaded = true
    this.engine.setFloatingView(this.out.canvas)
    this.changed()
  }

  set(state: XfState) {
    this.state = state
    this.show()
  }

  patch(p: Partial<Pick<Transformer, 'mode' | 'interp' | 'snapping' | 'snapDistance' | 'magnetics'>>) {
    Object.assign(this, p)
    if (p.mode === 'warp' && this.state) this.state = toWarp(this.state)
    if (this.state) this.show()
    else this.changed()
  }

  /** Drop the pixels where they are now (moving the selection along). */
  commit(sel: Selector | null): Id | null {
    if (!this.active) return this.reset()
    const s = this.state!
    const id = this.engine.endMove()
    if (sel && id) {
      const first = this.first!
      sel.transformed((mask) => {
        const out = this.engine.canvas()
        // The selection follows the pixels through the same mapping.
        renderMesh(mask, { ...s, src: first.src }, out.ctx, 'bilinear')
        return out.canvas
      })
    }
    this.reset()
    return id
  }

  cancel() {
    if (this.engine.moving) this.engine.cancelMove()
    this.reset()
  }

  private reset(): null {
    this.state = this.first = null
    this.layerId = null
    this.drag = null
    this.out = null
    this.guides = { gx: [], gy: [] }
    this.changed()
    return null
  }

  // ---- Handles --------------------------------------------------------------

  /** Handle points in canvas pixels for the current mode. */
  handles(): Pt[] {
    const s = this.state
    if (!s) return []
    if (this.mode === 'warp' && s.warp) return s.warp
    if (this.mode === 'distort') return HANDLES.slice(0, 4).map(([u, v]) => mapPoint(s, u, v))
    return HANDLES.map(([u, v]) => mapPoint(s, u, v))
  }

  rotateHandle(scale: number): Pt | null {
    const s = this.state
    if (!s || this.mode === 'warp' || this.mode === 'distort') return null
    const top = mapPoint(s, 0.5, 0)
    const c = mapPoint(s, 0.5, 0.5)
    const l = Math.hypot(top.x - c.x, top.y - c.y) || 1
    return { x: top.x + ((top.x - c.x) / l) * (28 / scale), y: top.y + ((top.y - c.y) / l) * (28 / scale) }
  }

  down(p: Pt, scale: number) {
    const s = this.state
    if (!s) return
    const near = (q: Pt) => Math.hypot(q.x - p.x, q.y - p.y) * scale < 10
    const rot = this.rotateHandle(scale)
    if (rot && near(rot)) return void (this.drag = { kind: 'rotate', from: p, s0: s })
    const i = this.handles().findIndex(near)
    if (i >= 0) {
      const kind = this.mode === 'warp' ? 'mesh' : this.mode === 'distort' ? 'corner' : 'scale'
      this.drag = { kind, index: i, from: p, s0: kind === 'mesh' ? toWarp(s) : s }
    } else if (this.mode !== 'warp' && this.mode !== 'distort' && !inside(s, p) && HANDLES.slice(0, 4).some(([u, v]) => Math.hypot(mapPoint(s, u, v).x - p.x, mapPoint(s, u, v).y - p.y) * scale < 40)) {
      // v0.13: drag just outside any corner to turn, not only from the handle above the box.
      this.drag = { kind: 'rotate', from: p, s0: s }
    } else this.drag = { kind: 'move', from: p, s0: s }
  }

  move(p: Pt, scale: number, shift: boolean) {
    const d = this.drag
    if (!d) return
    const s0 = d.s0
    let dx = p.x - d.from.x
    let dy = p.y - d.from.y
    this.guides = { gx: [], gy: [] }
    if (d.kind === 'move') {
      if (this.magnetics || shift) [dx, dy] = magnetMove(dx, dy)
      if (this.snapping) {
        const r = snapShift(outerBounds(s0), dx, dy, this.engine.width, this.engine.height, this.snapDistance / scale)
        ;({ dx, dy } = r)
        this.guides = { gx: r.gx, gy: r.gy }
      }
      return this.set(transformState(s0, translate(dx, dy)))
    }
    if (d.kind === 'rotate') {
      const c = mapPoint(s0, 0.5, 0.5)
      let a = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(d.from.y - c.y, d.from.x - c.x)
      if (this.magnetics || shift) a = magnetAngle(a)
      return this.set(transformState(s0, rotateAbout(c, a)))
    }
    if (d.kind === 'mesh') {
      const warp = s0.warp!.map((q, i) => (i === d.index ? { x: q.x + dx, y: q.y + dy } : q))
      return this.set({ ...s0, warp })
    }
    if (d.kind === 'corner') {
      const quad = s0.quad.map((q, i) => (i === d.index ? { x: q.x + dx, y: q.y + dy } : q)) as XfState['quad']
      // A warped picture bends along: each mesh point follows by how close it is to that corner.
      const [cu, cv] = HANDLES[d.index]
      const warp = s0.warp && s0.warp.map((q, i) => {
        const w = (1 - Math.abs(cu - (i % 4) / 3)) * (1 - Math.abs(cv - Math.floor(i / 4) / 3))
        return { x: q.x + dx * w, y: q.y + dy * w }
      })
      return this.set({ ...s0, quad, warp })
    }
    // Scale from the opposite handle, along the picture's own axes.
    const [u, v] = HANDLES[d.index]
    const anchor = mapPoint(s0, 1 - u, 1 - v)
    const l = mapPoint(s0, 0, 0.5)
    const r = mapPoint(s0, 1, 0.5)
    const len = Math.hypot(r.x - l.x, r.y - l.y) || 1
    const ux = { x: (r.x - l.x) / len, y: (r.y - l.y) / len }
    const uy = { x: -ux.y, y: ux.x }
    const d0 = { x: d.from.x - anchor.x, y: d.from.y - anchor.y }
    const d1 = { x: p.x - anchor.x, y: p.y - anchor.y }
    const ratio = (axis: Pt) => {
      const a = d0.x * axis.x + d0.y * axis.y
      return Math.abs(a) < 1e-6 ? 1 : (d1.x * axis.x + d1.y * axis.y) / a
    }
    let sx = u === 0.5 ? 1 : ratio(ux)
    let sy = v === 0.5 ? 1 : ratio(uy)
    if (this.mode === 'uniform' || shift) {
      const k = u === 0.5 ? sy : v === 0.5 ? sx : (d1.x * d0.x + d1.y * d0.y) / (d0.x * d0.x + d0.y * d0.y || 1)
      sx = sy = k
    }
    this.set(transformState(s0, scaleAlong(anchor, ux, sx, sy)))
  }

  up() {
    this.drag = null
    this.guides = { gx: [], gy: [] }
    this.changed()
  }

  // ---- Buttons --------------------------------------------------------------

  flip(axis: 'x' | 'y') {
    const s = this.state
    if (!s) return
    const c = mapPoint(s, 0.5, 0.5)
    const m = mapPoint(s, axis === 'x' ? 1 : 0.5, axis === 'x' ? 0.5 : 1)
    const len = Math.hypot(m.x - c.x, m.y - c.y) || 1
    const ux = { x: (m.x - c.x) / len, y: (m.y - c.y) / len }
    this.set(transformState(s, scaleAlong(c, ux, -1, 1)))
  }

  rotate45() {
    const s = this.state
    if (s) this.set(transformState(s, rotateAbout(mapPoint(s, 0.5, 0.5), Math.PI / 4)))
  }

  fit() {
    const s = this.state
    if (s) this.set(transformState(s, fitAffine(outerBounds(s), this.engine.width, this.engine.height)))
  }

  resetShape() {
    if (this.first) this.set(this.mode === 'warp' ? toWarp(this.first) : this.first)
  }
}

/**
 * One Transformer per engine. It lifts pixels when the Move tool is used and drops them
 * (one undo step) when another tool or layer is picked, on Enter, or Done; Escape puts them back.
 */
export function useTransformer(engine: SketchEngine, sel: Selector, opts: { active: boolean; tool: string; layerId: Id | undefined; done(id: Id | null): void }): Transformer {
  const xf = useMemo(() => new Transformer(engine), [engine])
  const [, setVersion] = useState(0)
  const done = useRef(opts.done)
  useEffect(() => {
    done.current = opts.done
  })
  useEffect(() => {
    xf.listen(() => setVersion(xf.version))
  }, [xf])
  useEffect(() => {
    if (xf.layerId && (opts.tool !== 'move' || opts.layerId !== xf.layerId)) done.current(xf.commit(sel))
  }, [xf, sel, opts.tool, opts.layerId])
  useEffect(() => {
    if (!opts.active) return
    const down = (e: KeyboardEvent) => {
      if (!xf.layerId || (e.target as HTMLElement).closest?.('input, textarea, select')) return
      if (e.key === 'Enter') done.current(xf.commit(sel))
      else if (e.key === 'Escape') {
        xf.cancel()
        done.current(null)
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [xf, sel, opts.active])
  return xf
}

/** True when `p` is inside the transformed box (its corners form a convex shape). */
function inside(s: XfState, p: Pt): boolean {
  const q = HANDLES.slice(0, 4).map(([u, v]) => mapPoint(s, u, v))
  const sides = q.map((a, i) => {
    const b = q[(i + 1) % 4]
    return Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))
  })
  return sides.every((x) => x >= 0) || sides.every((x) => x <= 0)
}
