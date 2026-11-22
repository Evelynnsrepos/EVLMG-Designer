import { useEffect, useMemo, useRef, useState } from 'react'
import type { Id } from '@/core/model'
import type { SketchEngine } from './engine'
import type { Growth } from './growth'
import { renderMesh, type Interpolation } from './meshRender'
import { buildModel, depthField, ModelRenderer, type DepthField, type Shape3d } from './model3d'
import { alphaBounds } from './selection'
import type { Selector } from './selector'
import {
  fitAffine,
  initialState,
  magnetAngle,
  magnetMove,
  mapPoint,
  moldDrag,
  moldKeepShape,
  moldLive,
  paintedCells,
  outerBounds,
  rotateAbout,
  scaleAlong,
  snapShift,
  toMold,
  toWarp,
  transformState,
  turn3d,
  translate,
  type Pt,
  type Turn,
  type XfState,
} from './transform'

export type XfMode = 'free' | 'uniform' | 'distort' | 'warp' | 'turn' | 'mold'

const FLAT: Turn = { x: 0, y: 0, z: 0, depth: 0.5 }

/** (u, v) of the free/uniform handles: corners, then edge middles. */
const HANDLES: [number, number][] = [
  [0, 0], [1, 0], [1, 1], [0, 1],
  [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5],
]

type Drag =
  | { kind: 'move'; from: Pt; s0: XfState; b0?: XfState | null }
  | { kind: 'scale' | 'corner' | 'mesh'; index: number; from: Pt; s0: XfState }
  | { kind: 'rotate'; from: Pt; s0: XfState }
  | { kind: 'turn'; from: Pt; t0: Turn }

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
  /** 3D turn (mode 'turn'): angles, applied to `turnBase`, the shape when the mode was picked. */
  turn: Turn = { ...FLAT }
  private turnBase: XfState | null = null
  /** Rotate object as a 3D model: thickness, roundness, light. Thickness 0 is a flat card. */
  shape: Shape3d = { thick: 0.25, round: 1, light: 0.5 }
  private field3d: DepthField | null = null
  private gl3d: ModelRenderer | null | undefined
  private uploaded3d = false
  private model3d: { base: XfState; shape: Shape3d; model: ReturnType<typeof buildModel> } | null = null
  private shown3d = false
  /** Mold: cells per side, how far (canvas px) and how strongly (0..1) other points follow a drag. */
  moldGrid = 12
  moldReach = 100
  moldPull = 0.6
  /** Keep shape: pieces of the mesh only turn, never stretch (a puppet warp). Off: nearby points follow by Reach and Follow. */
  moldKeep = true
  /** What a click on a mold point does: drag it, or pin it in place. */
  moldTool: 'drag' | 'pin' = 'drag'
  private settle: Map<number, Pt> | null = null
  private alpha: { data: Uint8ClampedArray; w: number } | null = null
  state: XfState | null = null
  layerId: Id | null = null
  guides: { gx: number[]; gy: number[] } = { gx: [], gy: [] }
  version = 0
  private first: XfState | null = null
  /** Steps inside one transform (Ctrl+Z before Done): the shape and turn before each change. */
  private past: { s: XfState; turn: Turn; base: XfState | null }[] = []
  private future: { s: XfState; turn: Turn; base: XfState | null }[] = []
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
    if (this.engine.refuseEdit?.(layerId)) return false
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
    this.field3d = null
    this.model3d = null
    this.uploaded3d = false
    this.turn = { ...FLAT }
    this.turnBase = null
    if (this.mode === 'turn') this.turnBase = this.state
    this.alpha = null
    if (this.mode === 'mold') this.state = this.moldOf(this.state, this.moldGrid)
    this.uploaded = false
    this.out = this.engine.canvas()
    this.changed()
    return true
  }

  private show() {
    const piece = this.engine.floatingPiece
    if (!piece || !this.state || !this.out) return
    this.shown3d = this.mode === 'turn' && this.shape.thick > 0 && this.draw3d(piece, this.out.ctx)
    if (this.shown3d) {
      this.engine.setFloatingView(this.out.canvas)
      return this.changed()
    }
    // With a GPU the engine draws the mesh itself; the picture is only made when the pixels are dropped.
    if (!this.engine.setFloatingMesh(this.state, this.interp)) this.bake()
    this.changed()
  }

  /** Draw the 3D model of `src` (the lifted pixels or the selection mask) into `out`. False without WebGL2. */
  private draw3d(src: HTMLCanvasElement, out: CanvasRenderingContext2D, upload = false): boolean {
    const base = this.turnBase
    if (!base) return false
    if (this.gl3d === undefined) this.gl3d = ModelRenderer.create()
    const gl = this.gl3d
    if (!gl) return false
    if (!this.field3d) {
      const data = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data
      this.field3d = depthField((x, y) => data[(y * src.width + x) * 4 + 3], base.src)
    }
    if (upload || !this.uploaded3d) gl.upload(src)
    this.uploaded3d = !upload
    const m = this.model3d
    if (!m || m.base !== base || m.shape !== this.shape) this.model3d = { base, shape: this.shape, model: buildModel(base, this.field3d, this.shape) }
    gl.draw(this.model3d!.model, base.src, this.turn, this.shape.light, this.engine.width, this.engine.height)
    out.clearRect(0, 0, this.engine.width, this.engine.height)
    out.drawImage(gl.canvas, 0, 0)
    return true
  }

  /** A mold over `s` with n cells per side, leaving out the cells without paint. */
  private moldOf(s: XfState, n: number): XfState {
    const piece = this.engine.floatingPiece
    if (piece && !this.alpha) this.alpha = { data: piece.getContext('2d')!.getImageData(0, 0, piece.width, piece.height).data, w: piece.width }
    const a = this.alpha
    return toMold({ ...s, mold: null }, n, a ? paintedCells((x, y) => a.data[(y * a.w + x) * 4 + 3], (this.first ?? s).src, n) : undefined)
  }

  /** Take every pin off the mold. */
  clearPins() {
    const s = this.state
    if (!s?.mold?.pins?.length) return
    this.mark()
    this.set({ ...s, mold: { ...s.mold, pins: [] } })
  }

  /** Change the 3D model's thickness, roundness or light. */
  setShape(p: Partial<Shape3d>) {
    this.shape = { ...this.shape, ...p }
    if (this.state) this.show()
    else this.changed()
  }

  /** Render the transformed pixels into a picture the engine can drop onto the layer. */
  private bake() {
    const piece = this.engine.floatingPiece
    if (!piece || !this.state || !this.out) return
    renderMesh(piece, this.state, this.out.ctx, this.interp, !this.uploaded)
    this.uploaded = true
    this.engine.setFloatingView(this.out.canvas)
  }

  set(state: XfState) {
    this.state = state
    this.show()
  }

  patch(p: Partial<Pick<Transformer, 'mode' | 'interp' | 'snapping' | 'snapDistance' | 'magnetics' | 'moldReach' | 'moldPull' | 'moldKeep' | 'moldTool'>>) {
    const s = this.state
    if (s && p.mode && p.mode !== this.mode) {
      this.mark()
      if (p.mode === 'warp') this.state = toWarp(s)
      if (p.mode === 'mold' && !s.mold) this.state = this.moldOf(s, this.moldGrid)
    }
    Object.assign(this, p)
    if (p.mode) {
      // Each visit to 3D starts flat from the shape it has now.
      this.turn = { ...FLAT }
      this.turnBase = p.mode === 'turn' ? this.state : null
    }
    if (this.state) this.show()
    else this.changed()
  }

  /** Change the 3D turn (sliders or dragging outside the picture). */
  setTurn(t: Partial<Turn>) {
    if (!this.state) return
    this.turnBase ??= this.state
    this.turn = { ...this.turn, ...t }
    this.set(turn3d(this.turnBase, this.turn))
  }

  /** A new mold grid (n cells per side), laid over the shape as it is now. */
  setMoldGrid(n: number) {
    this.moldGrid = n
    if (!this.state) return this.changed()
    this.mark()
    this.set(this.moldOf(this.state, n))
  }

  /** Remember the shape before a change, for Ctrl+Z while transforming. */
  mark() {
    if (!this.state) return
    this.past.push({ s: this.state, turn: this.turn, base: this.turnBase })
    if (this.past.length > 100) this.past.shift()
    this.future = []
  }

  private step(from: Transformer['past'], to: Transformer['past']): boolean {
    const e = from.pop()
    if (!e || !this.state) return false
    to.push({ s: this.state, turn: this.turn, base: this.turnBase })
    this.turn = e.turn
    this.turnBase = e.base
    this.set(e.s)
    return true
  }

  /** Undo one change of this transform. False when there is none (then the engine's undo puts the pixels back). */
  undo = () => this.step(this.past, this.future)
  redo = () => this.step(this.future, this.past)
  get canRedo() {
    return this.future.length > 0
  }

  /** Where the lifted pixels are now (their outer box), or null when nothing is lifted. */
  get bounds() {
    return this.active && this.state ? outerBounds(this.state) : null
  }

  /** The working area grew (0.31): the lifted pixels moved `g.left`, `g.top` in with everything else. */
  grow(g: Growth) {
    if (!this.state || !this.first) return
    const move = (s: XfState): XfState => ({ ...transformState(s, [1, 0, 0, 1, g.left, g.top]), src: { ...s.src, x: s.src.x + g.left, y: s.src.y + g.top } })
    this.state = move(this.state)
    this.first = move(this.first)
    if (this.turnBase) this.turnBase = move(this.turnBase)
    this.field3d = null
    this.uploaded3d = false
    this.alpha = null
    this.past = this.future = []
    this.out = this.engine.canvas()
    this.uploaded = false
    this.show()
  }

  /** Drop the pixels where they are now (moving the selection along). */
  commit(sel: Selector | null): Id | null {
    if (!this.active) return this.reset()
    const s = this.state!
    // Lost the GPU while moving: make the picture to drop the usual way.
    if (this.engine.floatingOnGpu && !this.engine.gpuActive) this.bake()
    const id = this.engine.endMove()
    if (sel && id) {
      const first = this.first!
      const as3d = this.shown3d
      sel.transformed((mask) => {
        const out = this.engine.canvas()
        // The selection follows the pixels through the same mapping.
        if (!(as3d && this.draw3d(mask, out.ctx, true))) renderMesh(mask, { ...s, src: first.src }, out.ctx, 'bilinear')
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
    this.turnBase = null
    this.past = []
    this.future = []
    this.field3d = null
    this.model3d = null
    this.uploaded3d = this.shown3d = false
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
    if (this.mode === 'mold' && s.mold) return s.mold.pts
    if (this.mode === 'turn') return []
    if (this.mode === 'distort') return HANDLES.slice(0, 4).map(([u, v]) => mapPoint(s, u, v))
    return HANDLES.map(([u, v]) => mapPoint(s, u, v))
  }

  rotateHandle(scale: number): Pt | null {
    const s = this.state
    if (!s || this.mode !== 'free' && this.mode !== 'uniform') return null
    const top = mapPoint(s, 0.5, 0)
    const c = mapPoint(s, 0.5, 0.5)
    const l = Math.hypot(top.x - c.x, top.y - c.y) || 1
    return { x: top.x + ((top.x - c.x) / l) * (28 / scale), y: top.y + ((top.y - c.y) / l) * (28 / scale) }
  }

  down(p: Pt, scale: number, alt = false) {
    const s = this.state
    if (!s) return
    this.mark()
    const near = (q: Pt) => Math.hypot(q.x - p.x, q.y - p.y) * scale < 10
    if (this.mode === 'turn') return void (this.drag = inside(s, p) ? { kind: 'move', from: p, s0: s, b0: this.turnBase } : { kind: 'turn', from: p, t0: this.turn })
    if (this.mode === 'mold') {
      // The nearest mold point within reach of the pointer, so small grids are easy to grab.
      const m = s.mold
      const live = m ? moldLive(m) : []
      let best = -1
      let bd = 14 / scale
      m?.pts.forEach((q, i) => {
        const d = Math.hypot(q.x - p.x, q.y - p.y)
        if (live[i] && d < bd) [best, bd] = [i, d]
      })
      if (m && best >= 0 && (this.moldTool === 'pin' || alt)) {
        const pins = m.pins ?? []
        this.set({ ...s, mold: { ...m, pins: pins.includes(best) ? pins.filter((i) => i !== best) : [...pins, best] } })
        return void (this.drag = null)
      }
      return void (this.drag = best >= 0 ? { kind: 'mesh', index: best, from: p, s0: s } : { kind: 'move', from: p, s0: s })
    }
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
    if (d.kind === 'turn') {
      // Like orbiting in Blender: sideways turns around the up axis, up/down tilts.
      let y = d.t0.y + (p.x - d.from.x) * scale * 0.5
      let x = d.t0.x - (p.y - d.from.y) * scale * 0.5
      if (this.magnetics || shift) [x, y] = [Math.round(x / 15) * 15, Math.round(y / 15) * 15]
      const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180
      return this.setTurn({ x: wrap(x), y: wrap(y) })
    }
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
      if (d.b0) this.turnBase = transformState(d.b0, translate(dx, dy))
      return this.set(transformState(s0, translate(dx, dy)))
    }
    if (d.kind === 'rotate') {
      const c = mapPoint(s0, 0.5, 0.5)
      let a = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(d.from.y - c.y, d.from.x - c.x)
      if (this.magnetics || shift) a = magnetAngle(a)
      return this.set(transformState(s0, rotateAbout(c, a)))
    }
    if (d.kind === 'mesh' && s0.mold) {
      const m0 = s0.mold
      if (!this.moldKeep) return this.set({ ...s0, mold: moldDrag(m0, d.index, dx, dy, this.moldReach, this.moldPull) })
      // Keep shape: pins stay, the grabbed point follows the pointer, the rest bends along (starting from the last result).
      const fixed = new Map((m0.pins ?? []).map((i) => [i, m0.pts[i]]))
      fixed.set(d.index, { x: m0.pts[d.index].x + dx, y: m0.pts[d.index].y + dy })
      const now = this.state?.mold ?? m0
      this.settle = fixed
      return this.set({ ...s0, mold: moldKeepShape({ ...m0, pts: now.pts }, fixed, 20 + m0.n * 2) })
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
      const m = s0.mold
      const mold = m && { n: m.n, pts: m.pts.map((q, i) => {
        const w = (1 - Math.abs(cu - (i % (m.n + 1)) / m.n)) * (1 - Math.abs(cv - Math.floor(i / (m.n + 1)) / m.n))
        return { x: q.x + dx * w, y: q.y + dy * w }
      }) }
      return this.set({ ...s0, quad, warp, mold })
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
    // Keep shape: a few more rounds on release, so the far end of a long piece catches up too.
    const m = this.state?.mold
    if (this.settle && m) this.set({ ...this.state!, mold: moldKeepShape(m, this.settle, 150) })
    this.settle = null
    // A click that changed nothing is no undo step.
    if (this.past.at(-1)?.s === this.state) this.past.pop()
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
    this.button(transformState(s, scaleAlong(c, ux, -1, 1)))
  }

  rotate45() {
    const s = this.state
    if (s) this.button(transformState(s, rotateAbout(mapPoint(s, 0.5, 0.5), Math.PI / 4)))
  }

  fit() {
    const s = this.state
    if (s) this.button(transformState(s, fitAffine(outerBounds(s), this.engine.width, this.engine.height)))
  }

  /** A button's change: one undo step; in 3D the turned shape becomes the new flat start. */
  private button(next: XfState) {
    this.mark()
    if (this.mode === 'turn') [this.turnBase, this.turn] = [next, { ...FLAT, depth: this.turn.depth }]
    this.set(next)
  }

  resetShape() {
    if (!this.first) return
    this.mark()
    this.turn = { ...FLAT }
    this.turnBase = this.mode === 'turn' ? this.first : null
    this.set(this.mode === 'warp' ? toWarp(this.first) : this.mode === 'mold' ? this.moldOf(this.first, this.moldGrid) : this.first)
  }
}

const XF_TOOLS = new Set(['move', 'rotate3d', 'mold'])

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
    // Move, Rotate object and Mold object share one lifted picture: switching between them keeps working on it.
    if (xf.layerId && (!XF_TOOLS.has(opts.tool) || opts.layerId !== xf.layerId)) done.current(xf.commit(sel))
    const mode = opts.tool === 'rotate3d' ? 'turn' : opts.tool === 'mold' ? 'mold' : xf.mode === 'turn' || xf.mode === 'mold' ? 'free' : null
    if (XF_TOOLS.has(opts.tool) && mode && mode !== xf.mode) xf.patch({ mode })
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
