import type { Id } from '@/core/model'
import { blendPixel, CANVAS_BLENDS, type BlendMode } from './blend'
import { brushReach, colorStroke, compositeStroke, isWet, StrokeStamper, type BrushSettings } from './brushes'
import { WetStamper } from './brushWet'
import { canvas2dFirst, GlCompositor, parseHex, type GlLayer, type GlSource } from './gl'
import { layerTree, type LayerNode } from './layers'
import { mirrored, type InputPoint, type SketchDoc, type SketchLayer, type SymmetryMode } from './model'
import { applyRelief } from './relief'
import { runCpu } from './adjust/cpu'
import { TileHistory, tilesIn, type Rect } from './tiles'

/**
 * The raster painting engine behind SketchEditor: one offscreen canvas per
 * layer, a stroke buffer so a stroke never gets darker than its opacity
 * (overlapping dabs inside one stroke don't stack), clipping masks, alpha
 * lock, symmetry, a selection that clips painting, and tile-diff undo (250 steps).
 * Layers are blended on the GPU with every blend mode (Sketch Pro); without
 * WebGL2 they are blended in Canvas 2D.
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

export class SketchEngine {
  readonly width: number
  readonly height: number
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
  private previewVersion = 0
  private gpu: GlCompositor | null
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
    this.gpu = GlCompositor.create(width, height, colorSpace)
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

  /** True when layers are blended on the GPU. */
  get gpuActive() {
    return !!this.gpu && !this.gpu.lost
  }

  private touched(id: Id) {
    this.layerVersions.set(id, (this.layerVersions.get(id) ?? 0) + 1)
    this.version++
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
    this.stroke = this.canvas()
    this.predicted = null
    this.strokeOpts = opts
    this.strokeBounds = null
    this.stamper = this.newStamper(opts)
    this.stamper.add(p)
    this.version++
  }

  strokeTo(p: InputPoint) {
    if (!this.stamper) return
    this.stamper.add(p)
    this.version++
  }

  /**
   * Show predicted points ahead of the stroke (pointer prediction). They are
   * drawn for the live view only: the next call, the end of the stroke or a
   * restroke throws them away, so they never reach the layer or undo.
   */
  predict(points: InputPoint[], from: InputPoint | null) {
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

  cancelStroke() {
    this.predicted = null
    this.stroke = null
    this.stamper = null
    this.strokeOpts = null
    this.strokeBounds = null
    this.version++
  }

  get stroking() {
    return !!this.stroke
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
    if (this.history.push(layerId, rects, before, this.snapshot(layerId, rects))) this.history.last!.sel = { before: this.selectionMask, after: this.selectionMask }
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
    this.touched(layerId)
  }

  moveTo(dx: number, dy: number) {
    if (!this.floating) return
    this.floating.dx = dx
    this.floating.dy = dy
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
    const canvas = this.renderNow(doc, withBackground)
    this.lastRender = { layers: doc.layers, background: doc.backgroundColor, withBackground, version: this.version, canvas }
    return canvas
  }

  /** GPU or Canvas 2D, whichever is faster here for this picture. */
  private useGpu(doc: LayerStack) {
    // ponytail: adjustment layers run on the CPU, so a picture with one is blended in Canvas 2D; move them to GLSL if big canvases lag.
    if (!this.gpu || this.gpu.lost || doc.layers.some((l) => l.kind === 'adjust')) return false
    return !canvas2dFirst.value || doc.layers.some((l) => l.visible && !CANVAS_BLENDS.has(l.blend))
  }

  private renderNow(doc: LayerStack, withBackground: boolean): HTMLCanvasElement {
    if (this.useGpu(doc)) {
      try {
        return this.renderGpu(doc, withBackground)
      } catch {
        this.gpu = null
      }
    }
    return this.renderCanvas2d(doc, withBackground)
  }

  private renderGpu(doc: LayerStack, withBackground: boolean): HTMLCanvasElement {
    const gpu = this.gpu!
    const keys = new Set(doc.layers.map((l) => l.id))
    const stack = this.glNodes(layerTree(doc.layers), keys)
    gpu.prune(keys)
    const bg = withBackground && doc.backgroundColor ? parseHex(doc.backgroundColor) : null
    return gpu.render(stack, bg)
  }

  /** A layer's (or mask's) pixels as a GPU source; the live preview has its own texture so the layer's own stays valid. */
  private glSource(layer: SketchLayer, keys: Set<string>): GlSource {
    const { canvas, live, dirty } = this.livePixels(layer)
    const key = live ? `${layer.id}:live` : layer.id
    keys.add(key)
    return { source: canvas, key, version: live ? ++this.previewVersion : (this.layerVersions.get(layer.id) ?? 0), dirty }
  }

  private glNodes(nodes: LayerNode[], keys: Set<string>): GlLayer[] {
    const out: GlLayer[] = []
    let base: GlLayer | null = null
    for (const { layer, children, mask } of nodes) {
      const m = mask?.visible ? this.glSource(mask, keys) : null
      // Clipped layers follow the base's pixels, mask, opacity and visibility (v0.13).
      if (layer.clip && base) base.clipBase = true
      const clip = layer.clip && base ? { clipTo: base.key, clipMask: base.mask, clipOpacity: base.opacity } : { clipTo: null }
      if (children) {
        // v0.13: a group can be a clipping base too. A hidden one stays in the stack, invisible, for its clipped layers.
        const entry: GlLayer = { source: this.scratch.canvas, version: 0, key: layer.id, opacity: layer.visible ? layer.opacity : 0, blend: layer.blend, mask: m, ...clip, children: this.glNodes(children, keys) }
        if (!layer.clip) base = entry
        out.push(entry)
        continue
      }
      const entry: GlLayer = { ...this.glSource(layer, keys), opacity: layer.opacity, blend: layer.blend, mask: m, ...clip }
      // A clipping base must be in the stack even when hidden, with no effect of its own.
      const shown = layer.visible ? entry : { ...entry, opacity: 0 }
      if (!layer.clip) base = shown
      out.push(shown)
    }
    return out
  }

  private renderCanvas2d(doc: LayerStack, withBackground: boolean): HTMLCanvasElement {
    const { ctx, canvas } = this.composite
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, this.width, this.height)
    if (withBackground && doc.backgroundColor) {
      ctx.fillStyle = doc.backgroundColor
      ctx.fillRect(0, 0, this.width, this.height)
    }
    this.stackOrder = doc.layers
    this.compose2d(ctx, layerTree(doc.layers), 0)
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

  /** The color under a canvas pixel in the flattened picture, as #rrggbb, or null if transparent. */
  pickColor(doc: SketchDoc, x: number, y: number): string | null {
    const canvas = this.render(doc)
    const [r, g, b, a] =
      canvas === this.gpu?.canvas ? this.gpu.readPixel(x, y) : canvas.getContext('2d')!.getImageData(Math.floor(x), Math.floor(y), 1, 1).data
    if (a === 0) return null
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
  }

  layerPng(layerId: Id): Promise<Blob> {
    return toPng(this.ensure(layerId).canvas)
  }

  flattenedPng(doc: SketchDoc, withBackground = true): Promise<Blob> {
    return toPng(this.render(doc, withBackground))
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
export function clipRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(w, Math.ceil(r.x + r.w))
  const y1 = Math.min(h, Math.ceil(r.y + r.h))
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}
