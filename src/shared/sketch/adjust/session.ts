import type { Id } from '@/core/model'
import { StrokeStamper, type BrushSettings, type StrokePoint } from '../brushes'
import type { SketchEngine } from '../engine'
import { runCpu, warpCpu } from './cpu'
import type { AdjustValues, FilterId } from './filters'
import { AdjustGl } from './gpu'

/**
 * One open adjustment, Liquify or Clone on a layer (Sketch Pro). Keeps the
 * layer's original pixels, shows the preview by putting the result on the
 * layer, and on Apply puts the original back and makes the change through
 * `engine.edit`, so it lands in the tile undo as one step. Cancel just puts
 * the original back.
 */

type C2 = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }

/** Copy of a layer's pixels. */
function copyOf(engine: SketchEngine, src: HTMLCanvasElement): C2 {
  const c = engine.canvas()
  c.ctx.drawImage(src, 0, 0)
  return c
}

export class LayerSession {
  readonly layerId: Id
  readonly w: number
  readonly h: number
  protected engine: SketchEngine
  protected original: C2
  protected out: C2
  private done = false
  private shown = false

  constructor(engine: SketchEngine, layerId: Id) {
    this.engine = engine
    this.layerId = layerId
    this.w = engine.width
    this.h = engine.height
    this.original = copyOf(engine, engine.layerCanvas(layerId))
    this.out = this.engine.canvas()
  }

  /** Show `out` on the layer (preview only, no undo, not saved). */
  protected show() {
    if (this.done) return
    this.engine.setLayerImage(this.layerId, this.out.canvas)
    this.shown = true
  }

  /** Make the preview real (one undo step). Returns the changed layer. */
  apply(): Id {
    this.finish()
    this.engine.setLayerImage(this.layerId, this.original.canvas)
    const out = this.out.canvas
    return this.engine.edit(this.layerId, (ctx) => {
      ctx.clearRect(0, 0, this.w, this.h)
      ctx.drawImage(out, 0, 0)
    })
  }

  /** Put the original back. True when a preview had changed the layer. */
  cancel(): boolean {
    if (this.done) return false
    this.finish()
    if (this.shown) this.engine.setLayerImage(this.layerId, this.original.canvas)
    return this.shown
  }

  protected finish() {
    this.done = true
  }

  get finished() {
    return this.done
  }
}

/** An adjustment or Liquify: a computed result, applied to the whole layer or painted in with the brush. */
export class AdjustSession extends LayerSession {
  private gpu: AdjustGl | null
  private origData: ImageData | null = null
  private cpuOut: C2 | null = null
  private result: HTMLCanvasElement | null = null
  /** Paint-on mode: where the effect has been brushed in so far. */
  private mask: C2 | null = null
  private stroke: { c: C2; stamper: StrokeStamper; opacity: number } | null = null
  private scratch: C2

  constructor(engine: SketchEngine, layerId: Id) {
    super(engine, layerId)
    this.gpu = AdjustGl.create(this.w, this.h)
    this.gpu?.setSource(this.original.canvas)
    this.scratch = this.engine.canvas()
  }

  get onGpu() {
    return !!this.gpu
  }

  /** The original pixels, read once (histogram, CPU fallback). */
  pixels(): ImageData {
    return (this.origData ??= this.original.ctx.getImageData(0, 0, this.w, this.h))
  }

  private cpuCanvas(img: ImageData) {
    const c = (this.cpuOut ??= this.engine.canvas())
    c.ctx.putImageData(img, 0, 0)
    return c.canvas
  }

  renderFilter(id: FilterId, values: AdjustValues) {
    // ASCII art has no Adjustments shader; its CPU path is quick enough for a preview.
    this.result = this.gpu && id !== 'ascii' ? this.gpu.run(id, values) : this.cpuCanvas(runCpu(id, values, this.pixels()))
    this.compose()
  }

  renderWarp(field: Float32Array, fw: number, fh: number, cell: number, amount: number) {
    this.result = this.gpu ? this.gpu.warp(field, fw, fh, cell, amount) : this.cpuCanvas(warpCpu(this.pixels(), field, fw, fh, cell, amount))
    this.compose()
  }

  /** Switch between whole layer (false) and paint-on (true). Painting starts empty. */
  setPaintOn(on: boolean) {
    this.mask = on ? this.engine.canvas() : null
    this.stroke = null
    this.compose()
  }

  get paintOn() {
    return !!this.mask
  }

  beginPaint(brush: BrushSettings, p: StrokePoint) {
    if (!this.mask) return
    const c = this.engine.canvas()
    this.stroke = { c, stamper: new StrokeStamper(c.ctx, brush), opacity: brush.opacity }
    this.stroke.stamper.add(p)
    this.compose()
  }

  paintTo(p: StrokePoint) {
    if (!this.stroke) return
    this.stroke.stamper.add(p)
    this.compose()
  }

  endPaint() {
    if (!this.stroke || !this.mask) return
    this.stroke.stamper.finish()
    this.mask.ctx.globalAlpha = this.stroke.opacity
    this.mask.ctx.drawImage(this.stroke.c.canvas, 0, 0)
    this.mask.ctx.globalAlpha = 1
    this.stroke = null
    this.compose()
  }

  /** out = original × (1 − w) + result × w, where w = painted mask (or everywhere) × selection. */
  private compose() {
    const { ctx } = this.out
    const sel = this.engine.selectionMask
    ctx.save()
    ctx.clearRect(0, 0, this.w, this.h)
    if (!this.result) ctx.drawImage(this.original.canvas, 0, 0)
    else if (!this.mask && !sel) ctx.drawImage(this.result, 0, 0)
    else {
      const m = this.scratch.ctx
      m.save()
      m.clearRect(0, 0, this.w, this.h)
      if (this.mask) {
        m.drawImage(this.mask.canvas, 0, 0)
        if (this.stroke) {
          m.globalAlpha = this.stroke.opacity
          m.drawImage(this.stroke.c.canvas, 0, 0)
        }
      } else {
        m.fillStyle = '#fff'
        m.fillRect(0, 0, this.w, this.h)
      }
      m.globalAlpha = 1
      if (sel) {
        m.globalCompositeOperation = 'destination-in'
        m.drawImage(sel, 0, 0)
      }
      m.restore()
      ctx.drawImage(this.original.canvas, 0, 0)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.drawImage(this.scratch.canvas, 0, 0)
      m.save()
      m.globalCompositeOperation = 'source-in'
      m.drawImage(this.result, 0, 0)
      m.restore()
      ctx.globalCompositeOperation = 'lighter'
      ctx.drawImage(this.scratch.canvas, 0, 0)
    }
    ctx.restore()
    this.show()
  }

  protected finish() {
    super.finish()
    this.gpu?.dispose()
    this.gpu = null
  }
}

/**
 * Clone: paints the layer's own pixels from a source point with the current
 * brush. Locked: every stroke starts copying at the source. Following: the
 * source keeps its distance to the brush across strokes.
 */
export class CloneSession {
  private engine: SketchEngine
  source: { x: number; y: number } | null = null
  locked = false
  /** Source minus brush, once known (following mode keeps it between strokes). */
  offset: { x: number; y: number } | null = null
  private stroke: { layerId: Id; before: C2; mask: C2; stamper: StrokeStamper; opacity: number; off: { x: number; y: number } } | null = null
  private out: C2
  private tmp: C2

  constructor(engine: SketchEngine) {
    this.engine = engine
    this.out = engine.canvas()
    this.tmp = engine.canvas()
  }

  setLocked(locked: boolean) {
    this.locked = locked
    this.offset = null
  }

  setSource(p: { x: number; y: number }) {
    this.source = p
    this.offset = null
  }

  /** Where the brush copies from when it is at `p` (for the marker). */
  sourceFor(p: { x: number; y: number }): { x: number; y: number } | null {
    const off = this.stroke?.off ?? (!this.locked && this.offset) ?? null
    if (off) return { x: p.x + off.x, y: p.y + off.y }
    return this.source
  }

  get painting() {
    return !!this.stroke
  }

  /** Start a stroke; false when no source is set yet. */
  begin(layerId: Id, brush: BrushSettings, p: StrokePoint): boolean {
    if (!this.source) return false
    const off = !this.locked && this.offset ? this.offset : { x: this.source.x - p.x, y: this.source.y - p.y }
    if (!this.locked) this.offset = off
    const before = copyOf(this.engine, this.engine.layerCanvas(layerId))
    const mask = this.engine.canvas()
    this.stroke = { layerId, before, mask, stamper: new StrokeStamper(mask.ctx, brush), opacity: brush.opacity, off }
    this.stroke.stamper.add(p)
    this.preview()
    return true
  }

  move(p: StrokePoint) {
    if (!this.stroke) return
    this.stroke.stamper.add(p)
    this.preview()
  }

  /** Finish the stroke as one undo step. Returns the changed layer. */
  end(): Id | null {
    const s = this.stroke
    if (!s) return null
    s.stamper.finish()
    this.compose()
    this.stroke = null
    this.engine.setLayerImage(s.layerId, s.before.canvas)
    const out = this.out.canvas
    return this.engine.edit(s.layerId, (ctx) => {
      ctx.clearRect(0, 0, out.width, out.height)
      ctx.drawImage(out, 0, 0)
    })
  }

  cancel() {
    const s = this.stroke
    if (!s) return
    this.stroke = null
    this.engine.setLayerImage(s.layerId, s.before.canvas)
  }

  private compose() {
    const s = this.stroke!
    const t = this.tmp.ctx
    t.save()
    t.clearRect(0, 0, t.canvas.width, t.canvas.height)
    t.drawImage(s.before.canvas, -s.off.x, -s.off.y)
    t.globalCompositeOperation = 'destination-in'
    t.drawImage(s.mask.canvas, 0, 0)
    const sel = this.engine.selectionMask
    if (sel) t.drawImage(sel, 0, 0)
    t.restore()
    const o = this.out.ctx
    o.save()
    o.clearRect(0, 0, o.canvas.width, o.canvas.height)
    o.drawImage(s.before.canvas, 0, 0)
    o.globalAlpha = s.opacity
    o.drawImage(this.tmp.canvas, 0, 0)
    o.restore()
  }

  private preview() {
    this.compose()
    this.engine.setLayerImage(this.stroke!.layerId, this.out.canvas)
  }
}
