import type { Id } from '@/core/model'
import { blendPixel, CANVAS_BLENDS, type BlendMode } from './blend'
import { brushReach, colorStroke, compositeStroke, hasColorDynamics, hasGrain, isShaded, isWet, strokeAlpha, StrokeStamper, type BrushSettings } from './brushes'
import { shiftColor } from './brushColor'
import { grainCanvas } from './brushTextures'
import { WetStamper } from './brushWet'
import { GpuWetStamper } from './brushWetGpu'
import { parseHex } from './gl'
import { clip, GpuPainter, GpuSurface, rgb, type GpuLayer, type StrokeLook, type Tex } from './gpuPaint'
import { layerTree, lockedInTree, shownInTree, type LayerNode } from './layers'
import { mirrored, type InputPoint, type SketchDoc, type SketchLayer, type SymmetryMode } from './model'
import { applyRelief } from './relief'
import { runCpu } from './adjust/cpu'
import { toFrame, type Growth } from './growth'
import { TileHistory, tilesIn, type Rect, type UndoStep } from './tiles'

/**
 * The raster painting engine behind SketchEditor: one offscreen canvas per
 * layer, a stroke buffer so a stroke never gets darker than its opacity
 * (overlapping dabs inside one stroke don't stack), clipping masks, alpha
 * lock, symmetry, a selection that clips painting, and tile-diff undo (250 steps).
 * With a graphics card (0.31) layers live on the GPU too: strokes are painted, blended
 * and shown there (gpuPaint.ts), and the Canvas 2D copy of a layer is brought up to
 * date when the stroke ends. Without WebGL2 everything runs in Canvas 2D.
 */

type Canvas2D = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }

function makeCanvas(w: number, h: number, colorSpace: PredefinedColorSpace = 'srgb'): Canvas2D {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: false, colorSpace })!
  return { canvas, ctx }
}

export interface StrokeOptions {
  layer: SketchLayer
  brush: BrushSettings
  color: string
  symmetry: SymmetryMode
  erase: boolean
  /** Copies of each dab for a symmetry guide; replaces `symmetry` when set (Sketch Pro guides). */
  mirror?: ((p: { x: number; y: number }) => { x: number; y: number }[]) | null
  /** Smudge tool: drag the colours already on the layer with the brush's shape. */
  smudge?: boolean
}

type LayerStack = Pick<SketchDoc, 'layers' | 'backgroundColor'>

/** What a layer-list or document step remembers (`doc`: other document fields that changed). */
export type DocMeta = { before: unknown[]; after: unknown[]; doc?: { before: object; after: object } }

export class SketchEngine {
  /** The working area (0.31: it can grow past the canvas the person picked, see growth.ts). */
  width: number
  height: number
  private layers = new Map<Id, Canvas2D>()
  private composite: Canvas2D
  private scratch: Canvas2D
  /** Alpha mask of the stroke being drawn. */
  private stroke: Canvas2D | null = null
  private stamper: StrokeStamper | null = null
  private strokeOpts: StrokeOptions | null = null
  /** How far the stroke being drawn reaches (dab centers), so undo only keeps those tiles. */
  private strokeBounds: { x0: number; y0: number; x1: number; y1: number } | null = null
  /** Predicted points ahead of the pen, shown for one frame only and never saved (Sketch Pro). */
  private predicted: Canvas2D | null = null
  private joined: Canvas2D | null = null
  /** The stroke colored, ready to composite. */
  private paint: Canvas2D
  /** Pixels being moved with the Move tool, lifted off their layer. */
  private floating: { layerId: Id; piece: Canvas2D; rects: Rect[]; before: ImageData[]; dx: number; dy: number; view?: HTMLCanvasElement | null } | null = null
  private history = new TileHistory()
  /** Bumped per layer whenever its pixels change, so the GPU only uploads changed layers. */
  private layerVersions = new Map<Id, number>()
  private gpu: GpuPainter | null
  /** Each layer's GPU texture and the layer version it holds. */
  private texs = new Map<string, { t: Tex; version: number }>()
  /** The stroke being painted on the GPU: its stamps, predicted points, and the layer with the stroke on it. */
  private g: { surf: GpuSurface; pred: GpuSurface | null; predRect: Rect | null; preview: Tex; look: StrokeLook; layerId: Id; tiles: Map<string, Rect>; points: InputPoint[]; seed: number } | null = null
  /** The GPU worked once here: after a reset it is tried again (a few times, at most once a second). */
  private gpuRetry: { at: number; left: number } | null = null
  /** What the GPU picture shows, so only changes are blended again. */
  private onPicture: { layers: SketchLayer[]; background: string | null | undefined; withBackground: boolean; edits: number } | null = null
  /** Part of the picture the GPU stroke changed since it was last blended. */
  private gpuDirty: Rect | null = null
  /** Counts lifts with the Move tool, so the GPU uploads each lifted piece once. */
  private moves = 0
  /** Bumped by every change that isn't the GPU stroke (CPU edits, moves, layer changes). */
  private edits = 0
  private selPath: Path2D | null = null
  /** The selection as an alpha mask (soft edges allowed); null = everything. */
  private sel: Canvas2D | null = null
  /** Painting only lands inside this path (canvas pixels); null = everywhere. */
  get selection(): Path2D | null {
    return this.selPath
  }
  set selection(path: Path2D | null) {
    this.selPath = path
    this.sel = null
    if (!path) return
    this.sel = this.canvas()
    this.sel.ctx.fillStyle = '#fff'
    this.sel.ctx.fill(path)
  }
  /** The selection as a mask canvas (alpha = how selected); setting it keeps the canvas. */
  get selectionMask(): HTMLCanvasElement | null {
    return this.sel?.canvas ?? null
  }
  set selectionMask(mask: HTMLCanvasElement | null) {
    this.selPath = null
    this.sel = mask ? { canvas: mask, ctx: mask.getContext('2d')! } : null
  }
  readonly colorSpace: PredefinedColorSpace
  /** Bumped on every visible change; the view redraws when it changes. */
  version = 0

  constructor(width: number, height: number, colorSpace: PredefinedColorSpace = 'srgb') {
    this.width = width
    this.height = height
    this.colorSpace = colorSpace
    this.composite = this.canvas()
    this.scratch = this.canvas()
    this.paint = this.canvas()
    this.gpu = GpuPainter.create(width, height, colorSpace)
    if (this.gpu) this.gpuRetry = { at: 0, left: 5 }
  }

  /** The canvas the GPU shows the picture on (the editor puts it under its overlay), or null. */
  get view(): HTMLCanvasElement | null {
    return this.gpuActive ? this.gpu!.canvas : null
  }

  /**
   * Grow the working area (0.31): every layer, the selection, undo steps and lifted pixels move `g.left`, `g.top`
   * in. Only between strokes. The GPU starts over at the new size (its textures fill from the layers again).
   */
  grow(g: Growth, mapMeta?: (m: unknown) => unknown) {
    if (this.stroking || (g.width === this.width && g.height === this.height)) return
    const pad = (c: HTMLCanvasElement | null) => {
      if (!c) return null
      const n = makeCanvas(g.width, g.height, this.colorSpace)
      n.ctx.drawImage(c, g.left, g.top)
      return n.canvas
    }
    this.width = g.width
    this.height = g.height
    for (const [id, c] of this.layers) {
      const n = pad(c.canvas)!
      this.layers.set(id, { canvas: n, ctx: n.getContext('2d')! })
      this.layerVersions.set(id, (this.layerVersions.get(id) ?? 0) + 1)
    }
    const f = this.floating
    if (f) {
      const n = pad(f.piece.canvas)!
      f.piece = { canvas: n, ctx: n.getContext('2d')! }
      f.rects = f.rects.map((r) => ({ ...r, x: r.x + g.left, y: r.y + g.top }))
      f.view = null
    }
    this.history.shift(g.left, g.top, pad, mapMeta)
    if (this.selPath) {
      const p = new Path2D()
      p.addPath(this.selPath, new DOMMatrix().translateSelf(g.left, g.top))
      this.selection = p
    } else if (this.sel) this.selectionMask = pad(this.sel.canvas)
    this.composite = this.canvas()
    this.scratch = this.canvas()
    this.paint = this.canvas()
    this.pool = []
    this.groupBases = []
    this.adjustCache.clear()
    this.maskCache.clear()
    this.lastRender = null
    this.livePreview = null
    this.onPicture = null
    this.gpuDirty = null
    if (this.gpu && !this.gpu.lost) {
      // The layers' GPU copies move along on the GPU: no new context, no shaders built again, nothing uploaded.
      const ids = [...this.texs.keys()].filter((k) => this.layers.has(k))
      for (const k of [...this.texs.keys()]) if (!this.layers.has(k)) this.gpu.free(this.texs.get(k)!.t)
      const moved = this.gpu.resize(g, ids.map((k) => this.texs.get(k)!.t))
      this.texs.clear()
      ids.forEach((k, i) => this.texs.set(k, { t: moved[i], version: this.layerVersions.get(k) ?? 0 }))
    } else this.texs.clear()
    this.edits++
    this.version++
  }

  /** Wait until the GPU has finished drawing (for timing it). */
  finishGpu() {
    this.gpu?.gl.finish()
  }

  /** Give the GPU memory back right away (the editor closed). */
  destroy() {
    this.gpu?.destroy()
    this.gpu = null
  }

  /** The GPU failed or its context was lost: carry on in Canvas 2D (each layer's Canvas 2D copy is up to date). */
  private gpuFailed() {
    // The stroke being painted carries on in Canvas 2D, painted again from its points.
    if (this.g) this.strokeToCpu()
    this.gpu = null
    this.texs.clear()
    this.onPicture = null
    this.edits++
    this.version++
  }

  /** A blank canvas at document size in the document's colour space. */
  canvas(): Canvas2D {
    return makeCanvas(this.width, this.height, this.colorSpace)
  }

  /** Keep only what lies inside the selection (no-op without one). */
  private keepSelected(ctx: CanvasRenderingContext2D) {
    if (!this.sel) return
    ctx.save()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(this.sel.canvas, 0, 0)
    ctx.restore()
  }

  /** True when layers are painted and blended on the GPU. */
  get gpuActive() {
    return !!this.gpu && !this.gpu.lost
  }

  private gpuFor(_doc: LayerStack) {
    if (this.gpu?.lost) this.gpuFailed()
    const r = this.gpuRetry
    if (!this.gpu && r && r.left > 0 && performance.now() - r.at > 1000) {
      // A reset GPU (driver restart, graphics switch, sleep) usually works again a moment later.
      r.at = performance.now()
      r.left--
      this.gpu = GpuPainter.create(this.width, this.height, this.colorSpace)
      if (this.gpu) {
        r.left = 5
        this.edits++
        this.version++
      }
    }
    return this.gpuActive
  }

  /** The GPU went away in the middle of a stroke: paint the stroke again in Canvas 2D (same points, same random numbers) and go on there. */
  private strokeToCpu() {
    const g = this.g!
    const opts = this.strokeOpts
    this.g = null
    if (!opts) return
    this.stroke = this.canvas()
    this.strokeBounds = null
    this.livePreview = null
    this.stamper = this.newStamper(opts, g.seed)
    for (const p of g.points) this.stamper.add(p)
  }

  /** A point with the time it arrived, so a stroke painted again comes out the same. */
  private timed(p: InputPoint): InputPoint {
    return (p as { time?: number }).time === undefined ? ({ ...p, time: performance.now() } as InputPoint) : p
  }

  private touched(id: Id) {
    this.layerVersions.set(id, (this.layerVersions.get(id) ?? 0) + 1)
    this.edits++
    this.version++
  }

  /** A layer's pixels on the GPU, uploaded from its Canvas 2D copy when that changed. */
  private tex(id: Id): Tex {
    const gpu = this.gpu!
    let e = this.texs.get(id)
    if (!e) this.texs.set(id, (e = { t: gpu.target(), version: -1 }))
    const v = this.layerVersions.get(id) ?? 0
    if (e.version !== v) {
      gpu.upload(e.t, this.ensure(id).canvas)
      e.version = v
    }
    return e.t
  }

  /** Changes whenever this layer's saved pixels change (not while a stroke is still being drawn). */
  layerVersion(id: Id): number {
    return this.layerVersions.get(id) ?? 0
  }

  layerCanvas(id: Id): HTMLCanvasElement {
    return this.ensure(id).canvas
  }

  private ensure(id: Id): Canvas2D {
    let c = this.layers.get(id)
    if (!c) {
      c = this.canvas()
      this.layers.set(id, c)
    }
    return c
  }

  /** Replace a layer's pixels with an image (loading a saved document). */
  setLayerImage(id: Id, img: CanvasImageSource | null) {
    const { ctx } = this.ensure(id)
    ctx.clearRect(0, 0, this.width, this.height)
    if (img) ctx.drawImage(img, 0, 0)
    this.touched(id)
  }

  /** Put an image underneath a layer's current pixels (a saved picture that arrived after painting started). */
  underlay(id: Id, img: CanvasImageSource) {
    const { ctx } = this.ensure(id)
    ctx.save()
    ctx.globalCompositeOperation = 'destination-over'
    ctx.drawImage(img, 0, 0)
    ctx.restore()
    this.touched(id)
  }

  dropLayer(id: Id) {
    for (const k of [id, `${id}:live`, `${id}:piece`]) {
      this.gpu?.free(this.texs.get(k)?.t)
      this.texs.delete(k)
    }
    this.edits++
    this.layers.delete(id)
    this.layerVersions.delete(id)
    this.history.dropLayer(id)
    this.version++
  }

  /** Copy all pixels of one layer into another (duplicate layer). */
  copyLayer(from: Id, to: Id) {
    const dst = this.ensure(to)
    dst.ctx.clearRect(0, 0, this.width, this.height)
    dst.ctx.drawImage(this.ensure(from).canvas, 0, 0)
    this.touched(to)
  }

  // ---- Strokes --------------------------------------------------------------

  /** Mirror copies of a dab, remembering how far the stroke reaches. */
  private mirrorFor(opts: StrokeOptions) {
    return (q: { x: number; y: number }) => {
      const pts = opts.mirror ? opts.mirror(q) : mirrored(q, this.width, this.height, opts.symmetry)
      const b = (this.strokeBounds ??= { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
      for (const m of pts) {
        b.x0 = Math.min(b.x0, m.x)
        b.y0 = Math.min(b.y0, m.y)
        b.x1 = Math.max(b.x1, m.x)
        b.y1 = Math.max(b.y1, m.y)
      }
      return pts
    }
  }

  beginStroke(opts: StrokeOptions, p: InputPoint) {
    this.predicted = null
    this.strokeOpts = opts
    this.strokeBounds = null
    this.g = null
    this.stroke = null
    const gpu = this.gpuActive ? this.gpu! : null
    if (gpu) {
      const surf = new GpuSurface(gpu, gpu.temp('stroke'))
      gpu.clear(surf.t, null)
      const preview = gpu.temp('preview')
      gpu.copy(this.tex(opts.layer.id), preview, null)
      const seed = Math.floor(Math.random() * 1e9)
      p = this.timed(p)
      this.g = { surf, pred: null, predRect: null, preview, look: this.strokeLook(opts), layerId: opts.layer.id, tiles: new Map(), points: [p], seed }
      this.stamper = this.gpuStamper(opts, surf, seed)
    } else {
      this.stroke = this.canvas()
      this.stamper = this.newStamper(opts)
    }
    this.stamper.add(p)
    this.version++
  }

  /** Wet brushes and the Smudge tool mix with the layer's pixels; other brushes stamp a mask. */
  private gpuStamper(opts: StrokeOptions, surf: GpuSurface, seed?: number): StrokeStamper {
    if (opts.smudge || (!opts.erase && isWet(opts.brush))) return new GpuWetStamper(surf, opts.brush, this.mirrorFor(opts), seed, opts.color, this.tex(opts.layer.id), !!opts.smudge)
    return new StrokeStamper(surf, opts.brush, this.mirrorFor(opts), seed, opts.color)
  }

  /** The wet working copy, when the GPU stroke is wet paint or smudge. */
  private get wetWork(): Tex | null {
    return this.stamper instanceof GpuWetStamper ? this.stamper.work : null
  }

  /** colorStroke + compositeStroke's settings, for the GPU. */
  private strokeLook(opts: StrokeOptions): StrokeLook {
    const b = opts.brush
    const gray = b.grainBlend !== 'alpha'
    const grain = b.grainMode === 'texturized' && hasGrain(b) ? grainCanvas(b, gray ? 'gray' : 'alpha') : null
    return {
      color: rgb(opts.erase ? '#000000' : opts.color),
      colored: hasColorDynamics(b) || isShaded(b),
      grain: grain && { image: grain, gray, blend: (gray ? b.grainBlend : 'source-over') as BlendMode, scale: b.grainScale * (1 + (b.size / 40 - 1) * b.grainZoom), rotation: b.grainRotation, filtering: b.grainFiltering },
      wetEdges: b.wetEdges,
      burntEdges: b.burntEdges,
      burntColor: rgb(shiftColor(opts.color, 0, 0.1, -0.35)),
      edgeBlur: Math.max(1.5, b.size * 0.12),
      alphaThreshold: b.alphaThreshold,
      height: opts.erase ? 0 : b.height,
      opacity: strokeAlpha(b),
      erase: opts.erase,
      alphaLock: opts.layer.alphaLock,
      luminance: b.luminanceBlend,
      blend: b.blend,
    }
  }

  private growDirty(r: Rect | null) {
    if (!r) return
    const d = this.gpuDirty
    if (!d) return void (this.gpuDirty = { ...r })
    const x1 = Math.max(d.x + d.w, r.x + r.w)
    const y1 = Math.max(d.y + d.h, r.y + r.h)
    d.x = Math.min(d.x, r.x)
    d.y = Math.min(d.y, r.y)
    d.w = x1 - d.x
    d.h = y1 - d.y
  }

  /** Paint what the GPU stroke stamped since last time onto its preview layer. */
  private syncGpuStroke(final = false) {
    const g = this.g
    const opts = this.strokeOpts
    if (!g || !opts) return
    const p = g.pred?.takeChanged() ?? null
    if (p) g.predRect = g.predRect ? union(g.predRect, p) : p
    const changed = g.surf.takeChanged()
    // Undo keeps (and reads back) only the tiles the stroke's stamps touched, not the whole box around it.
    if (changed) for (const t of tilesIn(changed, this.width, this.height)) g.tiles.set(`${t.x},${t.y}`, t)
    // At the end the last predicted points' area is painted again too, so none of them stay on the layer.
    let r = final ? union(this.strokeArea(opts), g.predRect) : union(changed, p)
    if (!r) return
    // Wet and burnt edges and 3D paint look at the mask around a pixel, so a stamp changes a bit more.
    const pad = final ? 0 : Math.ceil(Math.max(g.look.wetEdges || g.look.burntEdges ? g.look.edgeBlur * 3 : 0, g.look.height > 0 ? 6 : 0)) + 1
    r = clip({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }, this.width, this.height)
    if (!r) return
    this.gpu!.applyStroke(this.tex(g.layerId), g.surf.t, final ? null : (g.pred?.t ?? null), g.preview, g.look, r, this.sel?.canvas ?? null, this.wetWork)
    this.growDirty(r)
  }

  strokeTo(p: InputPoint) {
    if (!this.stamper) return
    if (this.g) {
      if (this.gpu?.lost) this.gpuFailed()
      else {
        p = this.timed(p)
        this.g.points.push(p)
      }
    }
    this.stamper!.add(p)
    this.version++
  }

  /** The predicted points of a GPU stroke: stamped into their own texture, which is cleared again each time. */
  private predictGpu(points: InputPoint[], from: InputPoint | null) {
    const g = this.g!
    const opts = this.strokeOpts!
    const gpu = this.gpu!
    if (g.pred && g.predRect) {
      // Where the last guess was must be painted again without it.
      g.pred.clearRect(g.predRect.x, g.predRect.y, g.predRect.w, g.predRect.h)
      this.repaint(g.predRect)
      g.predRect = null
    }
    if (!points.length) {
      if (g.pred) this.version++
      g.pred = null
      return
    }
    if (!g.pred) {
      g.pred = new GpuSurface(gpu, gpu.temp('pred'))
      gpu.clear(g.pred.t, null)
    }
    const mirror = (q: { x: number; y: number }) => (opts.mirror ? opts.mirror(q) : mirrored(q, this.width, this.height, opts.symmetry))
    const s = new StrokeStamper(g.pred, { ...opts.brush, dual: null, tipAnimation: false, stabilization: 0, motionFilter: 0 }, mirror, 3, opts.color)
    if (from) s.add(from)
    for (const p of points) s.add(p)
    g.pred.flush()
    this.version++
  }

  /** Paint the GPU stroke again inside `r` (after predicted points there went away). */
  private repaint(r: Rect) {
    const g = this.g!
    const pad = Math.ceil(g.look.wetEdges || g.look.burntEdges ? g.look.edgeBlur * 3 : 0) + 8
    const c = clip({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }, this.width, this.height)
    if (!c) return
    this.gpu!.applyStroke(this.tex(g.layerId), g.surf.t, g.pred?.t ?? null, g.preview, g.look, c, this.sel?.canvas ?? null, this.wetWork)
    this.growDirty(c)
  }

  /**
   * Show predicted points ahead of the stroke (pointer prediction). They are
   * drawn for the live view only: the next call, the end of the stroke or a
   * restroke throws them away, so they never reach the layer or undo.
   */
  predict(points: InputPoint[], from: InputPoint | null) {
    if (this.g && this.strokeOpts) return this.wetWork ? undefined : this.predictGpu(points, from)
    if (!this.stroke || !this.strokeOpts || this.stamper instanceof WetStamper) return
    if (!points.length) {
      if (this.predicted) this.version++
      this.predicted = null
      return
    }
    const pred = (this.predicted ??= this.canvas())
    pred.ctx.clearRect(0, 0, this.width, this.height)
    const opts = this.strokeOpts
    const mirror = (q: { x: number; y: number }) => (opts.mirror ? opts.mirror(q) : mirrored(q, this.width, this.height, opts.symmetry))
    // No dual brush or live taper here: those need full-size canvases of their own.
    const s = new StrokeStamper(pred.ctx, { ...opts.brush, dual: null, tipAnimation: false, stabilization: 0, motionFilter: 0 }, mirror, 3, opts.color)
    if (from) s.add(from)
    for (const p of points) s.add(p)
    this.version++
  }

  /** Replace the stroke being drawn with new points (QuickShape). */
  restroke(points: InputPoint[]) {
    const g = this.g
    if (g && this.strokeOpts) {
      // Start the stroke over: its texture and preview go back to the plain layer where it was.
      const old = union(this.strokeArea(this.strokeOpts), g.predRect)
      const r = old && clip(old, this.width, this.height)
      const gpu = this.gpu!
      gpu.clear(g.surf.t, null)
      g.surf.changed = null
      if (g.pred) gpu.clear(g.pred.t, null)
      g.pred = null
      g.predRect = null
      if (r) {
        gpu.copy(this.tex(g.layerId), g.preview, r)
        this.growDirty(r)
      }
      this.strokeBounds = null
      g.points = points.map((p) => this.timed(p))
      g.seed = 1
      this.stamper = this.gpuStamper(this.strokeOpts, g.surf, 1)
      for (const p of g.points) this.stamper.add(p)
      this.version++
      return
    }
    if (!this.stroke || !this.strokeOpts) return
    this.stroke.ctx.clearRect(0, 0, this.width, this.height)
    this.predicted = null
    this.strokeBounds = null
    this.stamper = this.newStamper(this.strokeOpts, 1)
    for (const p of points) this.stamper.add(p)
    this.version++
  }

  /** Wet brushes and the Smudge tool mix with the layer's pixels; other brushes stamp a mask. */
  private newStamper(opts: StrokeOptions, seed?: number): StrokeStamper {
    if (opts.smudge || (!opts.erase && isWet(opts.brush)))
      return new WetStamper(this.stroke!.ctx, opts.brush, this.mirrorFor(opts), seed, opts.color, this.ensure(opts.layer.id).canvas, !!opts.smudge)
    return new StrokeStamper(this.stroke!.ctx, opts.brush, this.mirrorFor(opts), seed, opts.color)
  }

  /** Where the stroke being drawn can have paint. */
  private strokeArea(opts: StrokeOptions): Rect | null {
    const b = this.strokeBounds
    const reach = brushReach(opts.brush)
    return b ? { x: b.x0 - reach, y: b.y0 - reach, w: b.x1 - b.x0 + 2 * reach, h: b.y1 - b.y0 + 2 * reach } : null
  }

  /** Draw the stroke into `ctx` the way it will land on the layer (with predicted points for the live view only). */
  private applyStroke(ctx: CanvasRenderingContext2D, opts: StrokeOptions, live = false) {
    if (this.stamper instanceof WetStamper) {
      // The wet copy of the layer replaces the layer, inside the selection.
      const p = this.paint.ctx
      p.save()
      p.globalCompositeOperation = 'copy'
      p.drawImage(this.stamper.result, 0, 0)
      p.restore()
      if (opts.brush.height > 0) applyRelief(p, this.stroke!.canvas, this.strokeArea(opts) ?? undefined, opts.brush.height)
      this.keepSelected(p)
      ctx.save()
      if (this.sel) {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.drawImage(this.sel.canvas, 0, 0)
        ctx.globalCompositeOperation = 'source-over'
      } else ctx.clearRect(0, 0, this.width, this.height)
      ctx.drawImage(p.canvas, 0, 0)
      ctx.restore()
      return
    }
    let mask = this.stroke!.canvas
    if (live && this.predicted) {
      // The prediction joins the stroke mask the same way dabs do, so the preview has no seam.
      const m = (this.joined ??= this.canvas()).ctx
      m.clearRect(0, 0, this.width, this.height)
      m.drawImage(mask, 0, 0)
      m.drawImage(this.predicted.canvas, 0, 0)
      mask = m.canvas
    }
    const area = this.strokeArea(opts) ?? undefined
    colorStroke(mask, this.paint.ctx, opts.erase ? '#000' : opts.color, opts.brush, area)
    if (opts.brush.height > 0 && !opts.erase) applyRelief(this.paint.ctx, mask, area, opts.brush.height)
    this.keepSelected(this.paint.ctx)
    compositeStroke(ctx, this.paint.canvas, opts.brush, { erase: opts.erase, alphaLock: opts.layer.alphaLock, selection: null, area })
  }

  /** Finish the stroke: merge it into the layer and record undo. Returns the changed layer. */
  endStroke(): Id | null {
    const opts = this.strokeOpts
    if (this.g && this.gpu?.lost) this.gpuFailed()
    if (this.g && opts) return this.endGpuStroke(opts)
    if (!this.stroke || !opts) return null
    this.predicted = null
    this.stamper?.finish()
    const layer = this.ensure(opts.layer.id)
    const area = this.strokeArea(opts)
    this.withUndo(opts.layer.id, area, () => this.applyStroke(layer.ctx, opts))
    this.stroke = null
    this.stamper = null
    this.strokeOpts = null
    this.strokeBounds = null
    return opts.layer.id
  }

  /** The GPU stroke lands on its layer; the touched tiles are read back into the Canvas 2D copy and undo. */
  private endGpuStroke(opts: StrokeOptions): Id | null {
    const g = this.g!
    const gpu = this.gpu!
    const id = opts.layer.id
    try {
      this.stamper?.finish()
      const area = this.strokeArea(opts)
      const r = area && clip(area, this.width, this.height)
      if (r && !gpu.lost) {
        g.pred = null
        this.syncGpuStroke(true)
        const rects = g.tiles.size ? [...g.tiles.values()] : tilesIn(r, this.width, this.height)
        const before = this.snapshot(id, rects)
        // The preview (layer + stroke) becomes the layer; the old texture is the next stroke's preview.
        const e = this.texs.get(id)!
        const old = e.t
        e.t = g.preview
        gpu.swapTemp('preview', old)
        const ctx = this.ensure(id).ctx
        for (const t of rects) ctx.putImageData(gpu.read(e.t, t, this.colorSpace), t.x, t.y)
        this.pushTiles(id, rects, before)
        this.layerVersions.set(id, (this.layerVersions.get(id) ?? 0) + 1)
        e.version = this.layerVersions.get(id)!
        this.growDirty(r)
        this.version++
      }
    } catch {
      this.gpuFailed()
    }
    this.g = null
    this.stamper = null
    this.strokeOpts = null
    this.strokeBounds = null
    return id
  }

  cancelStroke() {
    if (this.g && this.strokeOpts) {
      const a = this.strokeArea(this.strokeOpts)
      this.growDirty(a && clip(a, this.width, this.height))
      this.g = null
    }
    this.predicted = null
    this.stroke = null
    this.stamper = null
    this.strokeOpts = null
    this.strokeBounds = null
    this.version++
  }

  get stroking() {
    return !!this.stroke || !!this.g
  }

  // ---- Pixel edits ----------------------------------------------------------

  private snapshot(layerId: Id, rects: Rect[]) {
    const { ctx } = this.ensure(layerId)
    return rects.map((r) => ctx.getImageData(r.x, r.y, r.w, r.h))
  }

  /** Run `fn` and keep the tiles it changed inside `area` (null = whole layer) for undo. */
  private withUndo(layerId: Id, area: Rect | null, fn: () => void) {
    const rects = tilesIn(area ?? { x: 0, y: 0, w: this.width, h: this.height }, this.width, this.height)
    const before = this.snapshot(layerId, rects)
    fn()
    this.pushTiles(layerId, rects, before)
    this.touched(layerId)
  }

  /** Record a pixel step; it remembers the selection, so undoing the edit brings that selection back. */
  private pushTiles(layerId: Id, rects: Rect[], before: ImageData[]) {
    if (!this.history.push(layerId, rects, before, this.snapshot(layerId, rects))) return
    this.history.last!.sel = { before: this.selectionMask, after: this.selectionMask }
    this.freshPush = true
    queueMicrotask(() => (this.freshPush = false))
  }
  /** A pixel step was made in the code running right now (so a layer-list change from the same action joins it). */
  private freshPush = false
  private lastLayerStep: { meta: DocMeta; at: number; tweak: boolean } | null = null

  /**
   * Any other change to the layer list (add, rename, reorder, opacity, blend, visibility, lock, text...) or to `doc`
   * fields (background, guides) as an undo step: joined to the pixel step the same action just made, and quick
   * repeats of the same kind of change (a slider drag, typing) stay one step.
   */
  layersChanged<L extends { id: Id }>(before: L[], after: L[], doc?: { before: object; after: object }) {
    const last = this.history.last
    if (this.freshPush && last?.tiles.length && !last.meta) {
      last.meta = { before, after, doc } satisfies DocMeta
      return
    }
    const now = performance.now()
    const prev = this.lastLayerStep
    const sameIds = before.length === after.length && before.every((l, i) => l.id === after[i].id)
    if (prev?.tweak && last?.meta === prev.meta && prev.meta.after === before && sameIds && now - prev.at < 800) {
      prev.meta.after = after
      if (doc) prev.meta.doc = { before: prev.meta.doc?.before ?? doc.before, after: doc.after }
      prev.at = now
      return
    }
    const meta: DocMeta = { before, after, doc }
    this.history.pushMeta('', meta)
    this.lastLayerStep = { meta, at: now, tweak: sameIds }
  }

  /**
   * The Selector changed the selection: a step of its own, or (`withLast`) part of the step just made,
   * e.g. the selection following pixels a transform moved.
   */
  selectionChanged(before: HTMLCanvasElement | null, withLast = false) {
    const after = this.selectionMask
    const last = this.history.last
    if (withLast && last?.sel) last.sel.after = after
    else if (before !== after) this.history.pushSelection(before, after)
  }

  /** Run a pixel edit on a layer with undo, e.g. clear or fill. */
  edit(layerId: Id, fn: (ctx: CanvasRenderingContext2D) => void): Id {
    const layer = this.ensure(layerId)
    this.withUndo(layerId, null, () => {
      layer.ctx.save()
      fn(layer.ctx)
      layer.ctx.restore()
    })
    return layerId
  }

  /** Clear the selection (or the whole layer). */
  clear(layerId: Id): Id {
    return this.edit(layerId, (ctx) => {
      if (!this.sel) return ctx.clearRect(0, 0, this.width, this.height)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.drawImage(this.sel.canvas, 0, 0)
    })
  }

  /** Fill the selection (or the whole layer) with a color. */
  fill(layerId: Id, color: string, alphaLock: boolean): Id {
    const paint = this.canvas()
    paint.ctx.fillStyle = color
    paint.ctx.fillRect(0, 0, this.width, this.height)
    this.keepSelected(paint.ctx)
    return this.edit(layerId, (ctx) => {
      ctx.globalCompositeOperation = alphaLock ? 'source-atop' : 'source-over'
      ctx.drawImage(paint.canvas, 0, 0)
    })
  }

  /** Flip the selection (or the whole layer) horizontally or vertically. */
  flip(layerId: Id, axis: 'x' | 'y'): Id {
    return this.edit(layerId, (ctx) => {
      const src = this.canvas()
      src.ctx.drawImage(ctx.canvas, 0, 0)
      ctx.clearRect(0, 0, this.width, this.height)
      ctx.translate(axis === 'x' ? this.width : 0, axis === 'y' ? this.height : 0)
      ctx.scale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1)
      ctx.drawImage(src.canvas, 0, 0)
    })
  }

  /** Lift the selected pixels (or the whole layer) so they can be dragged with a live preview. */
  beginMove(layerId: Id) {
    const layer = this.ensure(layerId)
    const rects = tilesIn({ x: 0, y: 0, w: this.width, h: this.height }, this.width, this.height)
    const before = this.snapshot(layerId, rects)
    const piece = this.canvas()
    piece.ctx.drawImage(layer.canvas, 0, 0)
    this.keepSelected(piece.ctx)
    layer.ctx.save()
    if (this.sel) {
      layer.ctx.globalCompositeOperation = 'destination-out'
      layer.ctx.drawImage(this.sel.canvas, 0, 0)
    } else layer.ctx.clearRect(0, 0, this.width, this.height)
    layer.ctx.restore()
    this.floating = { layerId, piece, rects, before, dx: 0, dy: 0 }
    this.moves++
    this.touched(layerId)
  }

  moveTo(dx: number, dy: number) {
    if (!this.floating) return
    this.floating.dx = dx
    this.floating.dy = dy
    this.edits++
    this.version++
  }

  /** Drop the lifted pixels at their new place. Returns the changed layer. */
  endMove(): Id | null {
    const f = this.floating
    if (!f) return null
    this.floating = null
    const layer = this.ensure(f.layerId)
    if (!f.dx && !f.dy && !f.view) {
      f.rects.forEach((r, i) => layer.ctx.putImageData(f.before[i], r.x, r.y))
      this.touched(f.layerId)
      return null
    }
    if (f.view) layer.ctx.drawImage(f.view, 0, 0)
    else layer.ctx.drawImage(f.piece.canvas, Math.round(f.dx), Math.round(f.dy))
    this.pushTiles(f.layerId, f.rects, f.before)
    this.touched(f.layerId)
    return f.layerId
  }

  get moving() {
    return !!this.floating
  }

  /** The lifted pixels (at their original place) while moving or transforming. */
  get floatingPiece(): HTMLCanvasElement | null {
    return this.floating?.piece.canvas ?? null
  }

  /** Show (and later drop) the lifted pixels as this document-size picture instead (transform). */
  setFloatingView(view: HTMLCanvasElement | null) {
    if (!this.floating) return
    this.floating.view = view
    this.edits++
    this.version++
  }

  /** Put the lifted pixels back where they were, without an undo step. */
  cancelMove() {
    const f = this.floating
    if (!f) return
    this.floating = null
    const { ctx } = this.ensure(f.layerId)
    f.rects.forEach((r, i) => ctx.putImageData(f.before[i], r.x, r.y))
    this.touched(f.layerId)
  }

  /** Pixels of one layer, or of the flattened picture (no background) when `layerId` is null. */
  pixels(doc: LayerStack, layerId: Id | null): ImageData {
    if (layerId) return this.ensure(layerId).ctx.getImageData(0, 0, this.width, this.height)
    const c = this.canvas()
    c.ctx.drawImage(this.render(doc, false), 0, 0)
    return c.ctx.getImageData(0, 0, this.width, this.height)
  }

  /** Paint a colour where `mask` (one byte per pixel) is set, inside the selection. keepAlpha recolours existing pixels only. */
  fillMask(layerId: Id, mask: Uint8Array, color: string, keepAlpha: boolean): Id {
    const alpha = this.canvas()
    const img = alpha.ctx.createImageData(this.width, this.height)
    for (let p = 0; p < mask.length; p++) img.data[p * 4 + 3] = mask[p]
    alpha.ctx.putImageData(img, 0, 0)
    const paint = this.canvas()
    paint.ctx.fillStyle = color
    paint.ctx.fillRect(0, 0, this.width, this.height)
    paint.ctx.globalCompositeOperation = 'destination-in'
    paint.ctx.drawImage(alpha.canvas, 0, 0)
    this.keepSelected(paint.ctx)
    return this.edit(layerId, (ctx) => {
      ctx.globalCompositeOperation = keepAlpha ? 'source-atop' : 'source-over'
      ctx.drawImage(paint.canvas, 0, 0)
    })
  }

  /** Invert the colours of the selection (or the whole layer). */
  invert(layerId: Id): Id {
    const inv = this.canvas()
    const src = this.ensure(layerId)
    const img = src.ctx.getImageData(0, 0, this.width, this.height)
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 255 - img.data[i]
      img.data[i + 1] = 255 - img.data[i + 1]
      img.data[i + 2] = 255 - img.data[i + 2]
    }
    inv.ctx.putImageData(img, 0, 0)
    this.keepSelected(inv.ctx)
    return this.edit(layerId, (ctx) => {
      if (this.sel) {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.drawImage(this.sel.canvas, 0, 0)
        ctx.globalCompositeOperation = 'source-over'
      } else ctx.clearRect(0, 0, this.width, this.height)
      ctx.drawImage(inv.canvas, 0, 0)
    })
  }

  /** Flatten `stack` (bottom to top, groups and masks included) into one layer's pixels, with undo. */
  mergeInto(stack: SketchLayer[], targetId: Id): Id {
    const merged = this.canvas()
    merged.ctx.drawImage(this.render({ layers: stack, backgroundColor: null }, false), 0, 0)
    return this.edit(targetId, (ctx) => {
      ctx.clearRect(0, 0, this.width, this.height)
      ctx.drawImage(merged.canvas, 0, 0)
    })
  }

  /** Merge `upper` into `lower` with the upper layer's opacity and blend mode. */
  mergeDown(upper: SketchLayer, lowerId: Id): Id {
    const lower: SketchLayer = { ...upper, id: lowerId, opacity: 1, blend: 'source-over', clip: false, visible: true }
    const merged = this.canvas()
    merged.ctx.drawImage(this.render({ layers: [lower, { ...upper, clip: false, visible: true }], backgroundColor: null }, false), 0, 0)
    return this.edit(lowerId, (ctx) => {
      ctx.clearRect(0, 0, this.width, this.height)
      ctx.drawImage(merged.canvas, 0, 0)
    })
  }

  /** The layer-list change of the step undone or redone last (v0.17), for the editor to apply. */
  lastMeta: { meta: unknown; which: 'before' | 'after' } | null = null

  get pushes() {
    return this.history.pushes
  }

  /**
   * Tie a layer-list change (merge, flatten, delete) to undo: onto the pixel step the change made,
   * or a step of its own when no pixels changed. `pushesBefore` is `pushes` from before the change.
   */
  structure(layerId: Id, meta: unknown, pushesBefore: number) {
    if (this.history.pushes > pushesBefore) this.history.tagLast(meta)
    else this.history.pushMeta(layerId, meta)
  }

  /** True when the step undone or redone last set the selection; the Selector then picks it up. */
  selectionRestored = false

  private replay(step: ReturnType<TileHistory['undo']>, which: 'before' | 'after'): Id | null {
    this.lastMeta = step?.meta ? { meta: step.meta, which } : null
    this.selectionRestored = !!step?.sel
    if (step?.sel) this.selectionMask = step.sel[which]
    if (!step?.layerId) return null
    const { ctx } = this.ensure(step.layerId)
    for (const t of step.tiles) ctx.putImageData(t[which], t.rect.x, t.rect.y)
    this.touched(step.layerId)
    return step.layerId
  }

  undo(): Id | null {
    // Undo while moving just puts the pixels back.
    if (this.floating) {
      const id = this.floating.layerId
      this.cancelMove()
      return id
    }
    return this.replay(this.history.undo(), 'before')
  }

  redo(): Id | null {
    return this.replay(this.history.redo(), 'after')
  }

  get canUndo() {
    return this.history.canUndo
  }

  /** The undo and redo steps, for saving them between sessions (0.31). */
  get historyStacks() {
    return this.history.stacks
  }

  /** Put back undo steps from an earlier session. */
  loadHistory(undo: UndoStep[], redo: UndoStep[]) {
    this.history.load(undo, redo)
    this.version++
  }

  /** Pixels of part of a layer (its Canvas 2D copy), e.g. to check a saved undo step still fits. */
  layerPixels(id: Id, r: Rect): ImageData {
    return this.ensure(id).ctx.getImageData(r.x, r.y, r.w, r.h)
  }
  get canRedo() {
    return this.history.canRedo
  }

  // ---- Compositing ----------------------------------------------------------

  /**
   * The stroke whose preview `scratch` holds; while it is drawn, only the stroke's area is redrawn
   * (it only grows), and `dirty` says which part changed since the last preview.
   */
  private livePreview: { stroke: Canvas2D; dirty: Rect | null } | null = null

  /** A layer's pixels as they look right now: with the live stroke or the lifted pixels on top. */
  private livePixels(layer: SketchLayer): { canvas: HTMLCanvasElement; live: boolean; dirty?: Rect | null } {
    const src = this.ensure(layer.id).canvas
    const stroking = this.stroke && this.strokeOpts?.layer.id === layer.id
    const moving = this.floating?.layerId === layer.id
    if (!stroking && !moving) return { canvas: src, live: false }
    const s = this.scratch.ctx
    s.globalCompositeOperation = 'source-over'
    s.globalAlpha = 1
    // Wet brushes and the Smudge tool repaint the whole layer; other strokes only their own area.
    const area = stroking && !(this.stamper instanceof WetStamper) ? this.strokeArea(this.strokeOpts!) : null
    const r = area && clipRect(area, this.width, this.height)
    if (r && this.livePreview?.stroke === this.stroke) {
      s.save()
      s.beginPath()
      s.rect(r.x, r.y, r.w, r.h)
      s.clip()
      s.clearRect(r.x, r.y, r.w, r.h)
      s.drawImage(src, 0, 0)
      this.applyStroke(s, this.strokeOpts!, true)
      s.restore()
      this.livePreview.dirty = r
      return { canvas: this.scratch.canvas, live: true, dirty: r }
    }
    this.livePreview = r ? { stroke: this.stroke!, dirty: null } : null
    s.clearRect(0, 0, this.width, this.height)
    s.drawImage(src, 0, 0)
    if (stroking) this.applyStroke(s, this.strokeOpts!, true)
    else if (this.floating!.view) s.drawImage(this.floating!.view, 0, 0)
    else s.drawImage(this.floating!.piece.canvas, this.floating!.dx, this.floating!.dy)
    return { canvas: this.scratch.canvas, live: true }
  }

  /** The last render, reused while nothing changed (the editor redraws its view on every pointer move). */
  private lastRender: { layers: SketchLayer[]; background: string | null | undefined; withBackground: boolean; version: number; canvas: HTMLCanvasElement } | null = null

  /** Flatten the visible layers (with the live stroke) into one canvas at document size. */
  render(doc: LayerStack, withBackground = true): HTMLCanvasElement {
    const last = this.lastRender
    if (last && last.layers === doc.layers && last.background === doc.backgroundColor && last.withBackground === withBackground && last.version === this.version) return last.canvas
    if (this.gpuFor(doc)) {
      // ponytail: the whole picture comes back from the GPU; only exports, merges and onion skins ask for it.
      try {
        this.toPicture(doc, withBackground)
        this.composite.ctx.putImageData(this.gpu!.read(this.gpu!.picture, { x: 0, y: 0, w: this.width, h: this.height }, this.colorSpace), 0, 0)
        this.lastRender = { layers: doc.layers, background: doc.backgroundColor, withBackground, version: this.version, canvas: this.composite.canvas }
        return this.composite.canvas
      } catch {
        this.gpuFailed()
      }
    }
    // While a stroke is drawn and nothing else changed, only the stroke's area of the picture is redone.
    const area = last && last.canvas === this.composite.canvas && last.layers === doc.layers && last.background === doc.backgroundColor && last.withBackground === withBackground ? this.strokeOnlyArea(doc) : null
    const canvas = this.renderCanvas2d(doc, withBackground, area ?? undefined)
    this.lastRender = { layers: doc.layers, background: doc.backgroundColor, withBackground, version: this.version, canvas }
    return canvas
  }

  /**
   * The area a Canvas 2D redraw can be limited to: the live stroke's area, when the last render already showed
   * this stroke. Not with adjustment layers or CPU-blended layers (they read and write the whole picture).
   */
  private strokeOnlyArea(doc: LayerStack): Rect | null {
    if (!this.stroke || !this.strokeOpts || this.stamper instanceof WetStamper || this.livePreview?.stroke !== this.stroke) return null
    if (doc.layers.some((l) => l.kind === 'adjust' || (l.visible && !CANVAS_BLENDS.has(l.blend)))) return null
    const area = this.strokeArea(this.strokeOpts)
    return area && clipRect(area, this.width, this.height)
  }

  /**
   * Show the picture on the GPU's view canvas: `m` is the view matrix in CSS pixels, `w`×`h` the view's CSS size.
   * Returns false when Canvas 2D has to draw it (no GPU, or adjustment layers).
   */
  draw(doc: LayerStack, m: [number, number, number, number, number, number], w: number, h: number, dpr: number, smooth: boolean, tint?: { id: Id; color: string } | null): boolean {
    if (!this.gpuFor(doc)) return false
    try {
      this.toPicture(doc, true)
      this.gpu!.present(m, w, h, dpr, smooth, tint && this.layers.has(tint.id) ? { tex: this.tex(tint.id), color: rgb(tint.color) } : null)
      return true
    } catch {
      this.gpuFailed()
      return false
    }
  }

  /** Blend the layers into the GPU picture: only what the stroke changed, or everything after other changes. */
  private toPicture(doc: LayerStack, withBackground: boolean) {
    const gpu = this.gpu!
    this.syncGpuStroke()
    const s = this.onPicture
    // Canvas 2D strokes (wet paint, smudge) and moved pixels come from the CPU each frame.
    const live = !!this.stroke || !!this.floating
    const full = live || !s || s.layers !== doc.layers || s.background !== doc.backgroundColor || s.withBackground !== withBackground || s.edits !== this.edits
    const r = full ? null : this.gpuDirty
    if (full || r) {
      const keys = new Set<string>()
      const stack = this.gpuNodes(layerTree(doc.layers), keys)
      gpu.pruneGroups(keys)
      gpu.compose(stack, withBackground && doc.backgroundColor ? parseHex(doc.backgroundColor) : null, r)
    }
    this.gpuDirty = null
    this.onPicture = { layers: doc.layers, background: doc.backgroundColor, withBackground, edits: this.edits }
  }

  /** A layer's pixels on the GPU as they look right now (with the stroke being painted, or lifted pixels). */
  private gpuSource(layer: SketchLayer): Tex {
    if (this.g?.layerId === layer.id) return this.g.preview
    const stroking = this.stroke && this.strokeOpts?.layer.id === layer.id
    if (!stroking && this.floating?.layerId !== layer.id) return this.tex(layer.id)
    const gpu = this.gpu!
    const live = (k: string) => {
      let e = this.texs.get(`${layer.id}:${k}`)
      if (!e) this.texs.set(`${layer.id}:${k}`, (e = { t: gpu.target(), version: -1 }))
      return e
    }
    const f = this.floating
    if (f && !f.view) {
      // Moving: the lifted pixels go up once, then are drawn at their new place each frame.
      const piece = live('piece')
      if (piece.version !== this.moves) {
        gpu.upload(piece.t, f.piece.canvas)
        piece.version = this.moves
      }
      const out = live('live').t
      gpu.copy(this.tex(layer.id), out, null)
      gpu.region(piece.t, out, -f.dx, -f.dy, this.width, this.height, 1, true)
      return out
    }
    const { canvas, dirty } = this.livePixels(layer)
    const e = live('live')
    gpu.upload(e.t, canvas, dirty)
    return e.t
  }

  private gpuNodes(nodes: LayerNode[], keys: Set<string>): GpuLayer[] {
    const out: GpuLayer[] = []
    let base: GpuLayer | null = null
    for (const { layer, children, mask } of nodes) {
      const m = mask?.visible ? this.gpuSource(mask) : null
      // Clipped layers follow the base's pixels, mask, opacity and visibility (v0.13).
      if (layer.clip && base) base.clipBase = true
      const clipTo = layer.clip && base ? { clipTo: base.key, clipMask: base.mask, clipOpacity: base.opacity } : { clipTo: null }
      if (children) {
        // A hidden group stays in the stack, invisible, for its clipped layers.
        keys.add(layer.id)
        const entry: GpuLayer = { tex: this.gpu!.picture, key: layer.id, opacity: layer.visible ? layer.opacity : 0, blend: layer.blend, mask: m, ...clipTo, children: this.gpuNodes(children, keys) }
        if (!layer.clip) base = entry
        out.push(entry)
        continue
      }
      if (layer.kind === 'adjust') {
        // An adjustment layer is the picture below, recoloured; it is never a clipping base.
        if (layer.visible && layer.adjust) out.push({ tex: this.gpu!.picture, key: layer.id, opacity: layer.opacity, blend: layer.blend, mask: m, ...clipTo, adjust: layer.adjust })
        continue
      }
      const entry: GpuLayer = { tex: this.gpuSource(layer), key: layer.id, opacity: layer.opacity, blend: layer.blend, mask: m, ...clipTo }
      // A clipping base must be in the stack even when hidden, with no effect of its own.
      const shown = layer.visible ? entry : { ...entry, opacity: 0 }
      if (!layer.clip) base = shown
      out.push(shown)
    }
    return out
  }

  private renderCanvas2d(doc: LayerStack, withBackground: boolean, area?: Rect): HTMLCanvasElement {
    const { ctx, canvas } = this.composite
    const r = area ?? { x: 0, y: 0, w: this.width, h: this.height }
    ctx.save()
    if (area) {
      // Everything outside `area` is still the last render's picture.
      ctx.beginPath()
      ctx.rect(r.x, r.y, r.w, r.h)
      ctx.clip()
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(r.x, r.y, r.w, r.h)
    if (withBackground && doc.backgroundColor) {
      ctx.fillStyle = doc.backgroundColor
      ctx.fillRect(r.x, r.y, r.w, r.h)
    }
    this.stackOrder = doc.layers
    this.compose2d(ctx, layerTree(doc.layers), 0)
    ctx.restore()
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    return canvas
  }

  /** Canvases for groups and masked layers, per group depth (Canvas 2D path). */
  private pool: Canvas2D[] = []
  /** The last group at each depth that layers may clip to (Canvas 2D path). */
  private groupBases: Canvas2D[] = []
  /** Layers in document order, for the adjustment layer cache. */
  private stackOrder: SketchLayer[] = []
  private adjustCache = new Map<Id, { sig: string; c: Canvas2D }>()

  /** What an adjustment layer makes of the picture below it (`below`), cached until something under it changes. */
  private adjusted(layer: SketchLayer, below: CanvasRenderingContext2D): HTMLCanvasElement {
    const i = this.stackOrder.findIndex((l) => l.id === layer.id)
    const sig = [JSON.stringify(layer.adjust), ...this.stackOrder.slice(0, i).map((l) => `${l.id}:${this.layerVersions.get(l.id) ?? 0}:${l.visible}:${l.opacity}:${l.blend}:${l.clip}:${l.parent ?? ''}:${this.livePixels(l).live ? this.version : 0}`)].join('|')
    const hit = this.adjustCache.get(layer.id)
    if (hit && hit.sig === sig) return hit.c.canvas
    const c = hit?.c ?? this.canvas()
    const img = below.getImageData(0, 0, this.width, this.height)
    c.ctx.putImageData(layer.adjust ? runCpu(layer.adjust.id, layer.adjust.values, img) : img, 0, 0)
    this.adjustCache.set(layer.id, { sig, c })
    return c.canvas
  }
  private pooled(i: number): Canvas2D {
    const c = (this.pool[i] ??= this.canvas())
    c.ctx.globalCompositeOperation = 'source-over'
    c.ctx.globalAlpha = 1
    c.ctx.clearRect(0, 0, this.width, this.height)
    return c
  }

  /** Mask pixels as alpha (brightness x alpha), cached per mask version. */
  private maskCache = new Map<Id, { version: number; c: Canvas2D }>()
  private maskAlpha(mask: SketchLayer): HTMLCanvasElement {
    const { canvas: src, live } = this.livePixels(mask)
    const version = this.layerVersions.get(mask.id) ?? 0
    const hit = this.maskCache.get(mask.id)
    if (hit && hit.version === version && !live) return hit.c.canvas
    const c = hit?.c ?? this.canvas()
    const img = src.getContext('2d')!.getImageData(0, 0, this.width, this.height)
    lumaToAlpha(img.data)
    c.ctx.putImageData(img, 0, 0)
    this.maskCache.set(mask.id, { version: live ? -1 : version, c })
    return c.canvas
  }

  private compose2d(ctx: CanvasRenderingContext2D, nodes: LayerNode[], depth: number) {
    let base: { canvas: HTMLCanvasElement; mask: HTMLCanvasElement | null; opacity: number } | null = null
    for (const { layer, children, mask } of nodes) {
      const m = mask?.visible ? this.maskAlpha(mask) : null
      const clipTo = layer.clip ? base : null
      const opacity = layer.visible ? layer.opacity : 0
      let src: HTMLCanvasElement
      if (children) {
        // v0.13: groups are clipping bases too; their result is kept so later groups can reuse the pool.
        const g = this.pooled(depth * 2)
        this.compose2d(g.ctx, children, depth + 1)
        src = g.canvas
        if (!layer.clip) {
          const keep = (this.groupBases[depth] ??= this.canvas())
          keep.ctx.clearRect(0, 0, this.width, this.height)
          keep.ctx.drawImage(src, 0, 0)
          base = { canvas: keep.canvas, mask: m, opacity }
        }
        if (!layer.visible) continue
      } else if (layer.kind === 'adjust') {
        // An adjustment layer is the picture below, recoloured; it is never a clipping base.
        if (!layer.visible) continue
        src = this.adjusted(layer, ctx)
      } else {
        src = this.livePixels(layer).canvas
        if (!layer.clip) base = { canvas: this.ensure(layer.id).canvas, mask: m, opacity }
        if (!layer.visible) continue
      }
      if (m || clipTo) {
        // Keep only where the mask and the clipping base let it through.
        const t = this.pooled(depth * 2 + 1)
        t.ctx.drawImage(src, 0, 0)
        t.ctx.globalCompositeOperation = 'destination-in'
        if (m) t.ctx.drawImage(m, 0, 0)
        if (clipTo) {
          t.ctx.globalAlpha = clipTo.opacity
          t.ctx.drawImage(clipTo.canvas, 0, 0)
          t.ctx.globalAlpha = 1
          if (clipTo.mask) t.ctx.drawImage(clipTo.mask, 0, 0)
        }
        src = t.canvas
      }
      if (CANVAS_BLENDS.has(layer.blend)) {
        ctx.globalAlpha = layer.opacity
        ctx.globalCompositeOperation = layer.blend as GlobalCompositeOperation
        ctx.drawImage(src, 0, 0)
      } else cpuBlend(ctx, src, layer.blend, layer.opacity)
    }
  }

  /** One pixel of a layer (straight RGBA 0..255), from the GPU when it has the layer. */
  private pixelOf(id: Id, x: number, y: number): ArrayLike<number> {
    if (this.gpuActive) return this.gpu!.read(this.tex(id), { x, y, w: 1, h: 1 }).data
    return this.ensure(id).ctx.getImageData(x, y, 1, 1).data
  }

  /**
   * Layer picker: the layer whose paint shows at (x, y), the topmost visible, unlocked pixel layer with
   * paint there that its mask and clipping base let through. Reads one pixel per layer.
   */
  layerAt(layers: SketchLayer[], x: number, y: number): Id | null {
    x = Math.floor(x)
    y = Math.floor(y)
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null
    const stack: { layer: SketchLayer; base: SketchLayer | null; mask?: SketchLayer }[] = []
    const walk = (nodes: LayerNode[]) => {
      let base: SketchLayer | null = null
      for (const { layer, children, mask } of nodes) {
        if (children) walk(children)
        else stack.push({ layer, base: layer.clip ? base : null, mask })
        if (!layer.clip) base = children ? null : layer
      }
    }
    walk(layerTree(layers))
    for (const { layer, base, mask } of stack.reverse()) {
      if (layer.kind === 'adjust' || !layer.opacity || !shownInTree(layers, layer.id) || lockedInTree(layers, layer.id)) continue
      if (!this.pixelOf(layer.id, x, y)[3]) continue
      if (mask?.visible) {
        const m = this.pixelOf(mask.id, x, y)
        if (!((0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) * m[3])) continue
      }
      if (base && !this.pixelOf(base.id, x, y)[3]) continue
      return layer.id
    }
    return null
  }

  /** The color under a canvas pixel in the flattened picture, as #rrggbb, or null if transparent. */
  pickColor(doc: SketchDoc, x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null
    let px: number[] | Uint8ClampedArray | null = null
    if (this.gpuFor(doc)) {
      try {
        this.toPicture(doc, true)
        px = this.gpu!.pixel(x, y)
      } catch {
        this.gpuFailed()
      }
    }
    const [r, g, b, a] = px ?? this.render(doc).getContext('2d')!.getImageData(Math.floor(x), Math.floor(y), 1, 1).data
    if (a === 0) return null
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
  }

  layerPng(layerId: Id): Promise<Blob> {
    return toPng(this.ensure(layerId).canvas)
  }

  /** The flattened picture as PNG, cut to the drawing's frame (0.31). */
  flattenedPng(doc: SketchDoc, withBackground = true): Promise<Blob> {
    const pic = this.render(doc, withBackground)
    return toPng(doc.frame ? toFrame(pic, doc) : pic)
  }

  /** True when the layer has no visible pixels (saved as an empty layer instead of a PNG). */
  isEmpty(layerId: Id): boolean {
    const data = this.ensure(layerId).ctx.getImageData(0, 0, this.width, this.height).data
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false
    return true
  }
}

/** Mask pixels to alpha: brightness (0.299, 0.587, 0.114) times alpha, like the GPU path. */
export function lumaToAlpha(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = Math.round(((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * d[i + 3]) / 255)
    d[i] = d[i + 1] = d[i + 2] = 0
  }
}

/** Blend modes Canvas 2D lacks, pixel by pixel (only used without WebGL2). */
function cpuBlend(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, mode: BlendMode, opacity: number) {
  const { width: w, height: h } = ctx.canvas
  const dst = ctx.getImageData(0, 0, w, h)
  const top = src.getContext('2d')!.getImageData(0, 0, w, h).data
  const d = dst.data
  for (let i = 0; i < d.length; i += 4) {
    if (!top[i + 3]) continue
    const o = blendPixel(mode, [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, d[i + 3] / 255], [top[i] / 255, top[i + 1] / 255, top[i + 2] / 255, top[i + 3] / 255], opacity)
    d[i] = o[0] * 255
    d[i + 1] = o[1] * 255
    d[i + 2] = o[2] * 255
    d[i + 3] = o[3] * 255
  }
  ctx.putImageData(dst, 0, 0)
}

export function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode PNG'))), 'image/png'))
}

/** The part of `r` inside the canvas, in whole pixels; null when nothing is left. */
/** The smallest rectangle around both (either may be null). */
function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || !b) return a ?? b
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export function clipRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(w, Math.ceil(r.x + r.w))
  const y1 = Math.min(h, Math.ceil(r.y + r.h))
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}
