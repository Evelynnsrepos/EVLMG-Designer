import { useEffect, useMemo, useState } from 'react'
import { importAssetFromBlob, resolveAssetPath } from '@/core/assets'
import { getFs } from '@/core/fs'
import { newId } from '@/core/model'
import { toPng, type SketchEngine } from './engine'
import type { SketchDoc } from './model'
import { feather as featherMask, floodMask, maskEdges } from './selection'

const selectionName = (n: number) => `Selection ${n}`

export type Pt = { x: number; y: number }
export type SelShape = 'freehand' | 'rect' | 'ellipse' | 'wand'
export type SelMode = 'replace' | 'add' | 'subtract'

/**
 * Selections (Sketch Pro): freehand and polygon, rectangle, ellipse and automatic (magic wand),
 * combined by add or remove into one soft mask on the engine. Edits keep going through the engine.
 */
export class Selector {
  shape: SelShape = 'freehand'
  mode: SelMode = 'replace'
  threshold = 0.12
  featherRadius = 8
  showMask = false
  /** Edges of the selection (SVG path data in canvas pixels). */
  edges = ''
  /** Shape being drawn: freehand points, rectangle/ellipse corners, or wand preview edges. */
  draft: { pts: Pt[]; kind: SelShape; edges?: string } | null = null
  /** Corners of a polygon in progress (freehand clicks). */
  polygon: Pt[] | null = null
  /** Shift of the outline while the pixels are being moved. */
  offset: Pt = { x: 0, y: 0 }
  version = 0
  private gestureMode: SelMode = 'replace'
  private downAt: { p: Pt; t: number; sx: number } | null = null
  private wand: { data: ImageData; at: Pt; base: number; mask: Uint8Array } | null = null
  onChange: () => void = () => {}

  /** The shape the selection tool (M) comes back with: the last one picked while it was on (v0.13). */
  selectionShape: SelShape = 'rect'
  selectionTool = false

  /** Change settings (from the bar) and redraw. */
  patch(p: Partial<Pick<Selector, 'shape' | 'mode' | 'threshold' | 'featherRadius' | 'showMask' | 'offset'>>) {
    if (p.shape && p.shape !== this.shape) this.cancelDraft()
    if (p.shape && this.selectionTool) this.selectionShape = p.shape
    Object.assign(this, p)
    this.changed()
  }

  listen(fn: () => void) {
    this.onChange = fn
  }

  private engine: SketchEngine

  constructor(engine: SketchEngine) {
    this.engine = engine
  }

  get active() {
    return !!this.engine.selectionMask
  }

  private changed() {
    this.version++
    this.onChange()
  }

  private blank() {
    return this.engine.canvas()
  }

  /** Put a new mask in, combined with the current one by `mode`. */
  apply(next: HTMLCanvasElement | null, mode: SelMode = 'replace') {
    const cur = this.engine.selectionMask
    let out: HTMLCanvasElement | null = next
    if (next && cur && mode !== 'replace') {
      const c = this.blank()
      c.ctx.drawImage(cur, 0, 0)
      c.ctx.globalCompositeOperation = mode === 'add' ? 'source-over' : 'destination-out'
      c.ctx.drawImage(next, 0, 0)
      out = c.canvas
    } else if (mode === 'subtract' && !cur) out = null
    this.set(out)
  }

  private set(mask: HTMLCanvasElement | null, withLast = false) {
    const before = this.engine.selectionMask
    this.edges = mask ? edgePath(mask) : ''
    // An empty selection is no selection.
    this.engine.selectionMask = this.edges ? mask : null
    this.engine.selectionChanged(before, withLast)
    this.offset = { x: 0, y: 0 }
    this.changed()
  }

  /** Pick up the selection undo or redo put back on the engine. */
  sync() {
    if (!this.engine.selectionRestored) return
    const mask = this.engine.selectionMask
    this.edges = mask ? edgePath(mask) : ''
    this.offset = { x: 0, y: 0 }
    this.changed()
  }

  clear() {
    this.polygon = null
    this.draft = null
    this.set(null)
  }

  /** Select where a canvas (a layer) has pixels. */
  fromCanvas(src: HTMLCanvasElement) {
    const c = this.blank()
    c.ctx.drawImage(src, 0, 0)
    this.apply(c.canvas, 'replace')
  }

  invert() {
    const cur = this.engine.selectionMask
    const c = this.blank()
    c.ctx.fillStyle = '#fff'
    c.ctx.fillRect(0, 0, c.canvas.width, c.canvas.height)
    if (cur) {
      c.ctx.globalCompositeOperation = 'destination-out'
      c.ctx.drawImage(cur, 0, 0)
    }
    this.set(c.canvas)
  }

  feather() {
    const cur = this.engine.selectionMask
    if (!cur) return
    const { width: w, height: h } = cur
    const img = cur.getContext('2d')!.getImageData(0, 0, w, h)
    const a = new Uint8Array(w * h)
    for (let p = 0; p < a.length; p++) a[p] = img.data[p * 4 + 3]
    this.set(maskCanvas(this.blank(), featherMask(a, w, h, this.featherRadius)))
  }

  /** Move the selection with the pixels (Move tool). */
  translate(dx: number, dy: number) {
    const cur = this.engine.selectionMask
    if (!cur || (!dx && !dy)) return
    const c = this.blank()
    c.ctx.drawImage(cur, dx, dy)
    this.set(c.canvas, true)
  }

  /** Replace the mask by a transformed copy (Transform). */
  transformed(fn: (mask: HTMLCanvasElement) => HTMLCanvasElement) {
    const cur = this.engine.selectionMask
    if (cur) this.set(fn(cur), true)
  }

  // ---- Drawing a selection --------------------------------------------------

  /** Pointer down with a selection tool. `pixels` gives what the wand looks at. */
  down(p: Pt, e: { shiftKey: boolean; altKey: boolean; clientX: number }, pixels: () => ImageData) {
    this.gestureMode = e.shiftKey ? 'add' : e.altKey ? 'subtract' : this.mode
    this.downAt = { p, t: performance.now(), sx: e.clientX }
    if (this.shape === 'wand') {
      const data = pixels()
      const mask = floodMask(data.data, data.width, data.height, p.x, p.y, this.threshold)
      this.wand = { data, at: p, base: this.threshold, mask }
      this.draft = { pts: [p], kind: 'wand', edges: edgePathOf(mask, data.width, data.height) }
    } else if (this.shape === 'freehand') {
      this.draft = { pts: [...(this.polygon ?? []), p], kind: 'freehand' }
    } else this.draft = { pts: [p, p], kind: this.shape }
    this.changed()
  }

  move(p: Pt, e: { shiftKey: boolean; clientX: number }) {
    const d = this.draft
    if (!d || !this.downAt) return
    if (d.kind === 'wand' && this.wand) {
      // Drag sideways to change the threshold, like ColorDrop.
      const t = Math.min(1, Math.max(0, this.wand.base + (e.clientX - this.downAt.sx) / 400))
      if (Math.abs(t - this.threshold) < 0.004) return
      this.threshold = t
      const { data, at } = this.wand
      this.wand.mask = floodMask(data.data, data.width, data.height, at.x, at.y, t)
      d.edges = edgePathOf(this.wand.mask, data.width, data.height)
    } else if (d.kind === 'freehand') d.pts.push(p)
    else {
      const a = d.pts[0]
      let b = p
      if (e.shiftKey) {
        const s = Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y))
        b = { x: a.x + Math.sign(p.x - a.x || 1) * s, y: a.y + Math.sign(p.y - a.y || 1) * s }
      }
      d.pts = [a, b]
    }
    this.changed()
  }

  /** Pointer up; `scale` is the view zoom (to tell a click from a drag). */
  up(scale: number) {
    const d = this.draft
    const at = this.downAt
    this.downAt = null
    if (!d || !at) return
    const last = d.pts[d.pts.length - 1]
    const click = performance.now() - at.t < 300 && Math.hypot(last.x - at.p.x, last.y - at.p.y) * scale < 4
    if (d.kind === 'wand' && this.wand) {
      const { data, mask } = this.wand
      this.wand = null
      this.draft = null
      return this.apply(maskCanvas(this.blank(), mask, data.width), this.gestureMode)
    }
    if (d.kind === 'freehand') {
      if (click) {
        // Clicks place polygon corners; clicking the first corner (or double click) closes it.
        const poly = this.polygon ?? []
        const first = poly[0]
        if (first && poly.length > 2 && Math.hypot(at.p.x - first.x, at.p.y - first.y) * scale < 10) return this.closePolygon()
        this.polygon = [...poly, at.p]
        this.draft = { pts: this.polygon, kind: 'freehand' }
        return this.changed()
      }
      if (this.polygon) {
        // A drag while placing corners adds a freehand piece to the polygon.
        this.polygon = d.pts
        return this.changed()
      }
      this.draft = null
      if (d.pts.length < 3) return this.changed()
      return this.apply(this.shapeMask('freehand', d.pts), this.gestureMode)
    }
    this.draft = null
    if (click) return this.changed()
    this.apply(this.shapeMask(d.kind, d.pts), this.gestureMode)
  }

  closePolygon() {
    const poly = this.polygon
    this.polygon = null
    this.draft = null
    if (poly && poly.length > 2) this.apply(this.shapeMask('freehand', poly), this.gestureMode)
    else this.changed()
  }

  cancelDraft() {
    this.polygon = null
    this.draft = null
    this.wand = null
    this.changed()
  }

  private shapeMask(kind: SelShape, pts: Pt[]) {
    const c = this.blank()
    const ctx = c.ctx
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    if (kind === 'rect') {
      const [a, b] = pts
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    } else if (kind === 'ellipse') {
      const [a, b] = pts
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
    } else pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)))
    ctx.closePath()
    ctx.fill()
    return c.canvas
  }

  // ---- Saved selections -----------------------------------------------------

  async save(root: string, doc: SketchDoc, update: (fn: (d: SketchDoc) => SketchDoc) => void) {
    const cur = this.engine.selectionMask
    if (!cur) return
    const asset = await importAssetFromBlob(root, await toPng(cur), 'image', 'selection.png')
    if (!asset) return
    const entry = { id: newId(), name: selectionName((doc.selections?.length ?? 0) + 1), image: asset.path }
    update((d) => ({ ...d, selections: [...(d.selections ?? []), entry] }))
  }

  async load(root: string, image: string) {
    const bytes = await getFs().readBinary(await resolveAssetPath(root, image))
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]))
    const c = this.blank()
    c.ctx.drawImage(bmp, 0, 0)
    this.apply(c.canvas, 'replace')
  }
}

/** A mask canvas (white, alpha = how selected) from one byte per pixel. */
function maskCanvas(c: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }, mask: Uint8Array, w = c.canvas.width) {
  const img = c.ctx.createImageData(w, mask.length / w)
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
    img.data[i + 3] = mask[p]
  }
  c.ctx.putImageData(img, 0, 0)
  return c.canvas
}

function edgePathOf(mask: Uint8Array, w: number, h: number) {
  return segmentsToPath(maskEdges((p) => mask[p], w, h))
}

function edgePath(mask: HTMLCanvasElement) {
  const { width: w, height: h } = mask
  const d = mask.getContext('2d')!.getImageData(0, 0, w, h).data
  return segmentsToPath(maskEdges((p) => d[p * 4 + 3], w, h))
}

function segmentsToPath(s: number[]) {
  const out: string[] = []
  for (let i = 0; i < s.length; i += 4) out.push(s[i + 1] === s[i + 3] ? `M${s[i]} ${s[i + 1]}H${s[i + 2]}` : `M${s[i]} ${s[i + 1]}V${s[i + 3]}`)
  return out.join('')
}

/** One Selector per engine; the component re-renders when it changes. */
export function useSelector(engine: SketchEngine, active: boolean, tool: string): Selector {
  const sel = useMemo(() => new Selector(engine), [engine])
  const [, setVersion] = useState(0)
  useEffect(() => {
    sel.listen(() => setVersion(sel.version))
  }, [sel])
  // The lasso tool (L) draws freehand. The selection tool (M) keeps the last shape picked for it
  // (rectangle at first), so choosing lasso, ellipse or wand there sticks (v0.13).
  useEffect(() => {
    sel.selectionTool = false
    if (tool === 'rect') sel.patch({ shape: sel.selectionShape })
    if (tool === 'lasso') sel.patch({ shape: 'freehand' })
    sel.selectionTool = tool === 'rect'
  }, [sel, tool])
  // Enter closes a polygon, Escape drops a shape being drawn.
  useEffect(() => {
    if (!active) return
    const down = (e: KeyboardEvent) => {
      if (!sel.polygon && !sel.draft) return
      if (e.key === 'Enter') sel.closePolygon()
      else if (e.key === 'Escape') sel.cancelDraft()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [sel, active])
  return sel
}

