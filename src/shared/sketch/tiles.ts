/**
 * Tile-diff undo (Sketch Pro): the canvas is split into 256 px tiles and an undo
 * step only keeps the tiles an edit really changed, before and after. That is
 * what allows 250 steps on big canvases.
 */

export const TILE = 256
export const MAX_UNDO = 250
/** Memory for undo pixels; the oldest steps go first when it is full. */
export const UNDO_BUDGET = 768 * 1024 * 1024

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Tiles (as their top-left pixel) touched by a rectangle, clipped to the canvas. */
export function tilesIn(r: Rect, width: number, height: number): Rect[] {
  const x0 = Math.max(0, Math.floor(r.x / TILE))
  const y0 = Math.max(0, Math.floor(r.y / TILE))
  const x1 = Math.min(Math.ceil(width / TILE), Math.ceil((r.x + r.w) / TILE))
  const y1 = Math.min(Math.ceil(height / TILE), Math.ceil((r.y + r.h) / TILE))
  const out: Rect[] = []
  for (let ty = y0; ty < y1; ty++)
    for (let tx = x0; tx < x1; tx++) {
      const x = tx * TILE
      const y = ty * TILE
      out.push({ x, y, w: Math.min(TILE, width - x), h: Math.min(TILE, height - y) })
    }
  return out
}

/** Smallest rectangle around points, grown by `pad` on every side. */
export function boundsOf(points: { x: number; y: number }[], pad: number): Rect | null {
  if (!points.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of points) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 - x0 + 2 * pad) + 1, h: Math.ceil(y1 - y0 + 2 * pad) + 1 }
}

export interface TilePatch {
  rect: Rect
  before: ImageData
  after: ImageData
}

export interface UndoStep {
  layerId: string
  tiles: TilePatch[]
  bytes: number
  /** v0.17: a change to the layer list that goes with this step (merge, delete), so undo brings layers back. */
  meta?: unknown
  /** The selection before and after this step (masks are never changed in place), so undo brings it back. */
  sel?: { before: HTMLCanvasElement | null; after: HTMLCanvasElement | null }
}

function same(a: ImageData, b: ImageData) {
  const x = new Uint32Array(a.data.buffer, a.data.byteOffset, a.data.byteLength >> 2)
  const y = new Uint32Array(b.data.buffer, b.data.byteOffset, b.data.byteLength >> 2)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}

/** Undo and redo stacks of tile patches, limited by step count and memory. */
export class TileHistory {
  private undoStack: UndoStep[] = []
  private redoStack: UndoStep[] = []
  private bytes = 0
  private maxSteps: number
  private budget: number

  constructor(maxSteps = MAX_UNDO, budget = UNDO_BUDGET) {
    this.maxSteps = maxSteps
    this.budget = budget
  }

  /** Keep the tiles that differ; nothing is recorded when the edit changed nothing. */
  /** How many steps were ever recorded (to tell whether an edit made one). */
  pushes = 0

  push(layerId: string, rects: Rect[], before: ImageData[], after: ImageData[]): boolean {
    const tiles: TilePatch[] = []
    for (let i = 0; i < rects.length; i++) if (!same(before[i], after[i])) tiles.push({ rect: rects[i], before: before[i], after: after[i] })
    if (!tiles.length) return false
    const bytes = tiles.reduce((n, t) => n + t.before.data.byteLength * 2, 0)
    this.pushes++
    this.undoStack.push({ layerId, tiles, bytes })
    this.bytes += bytes
    for (const s of this.redoStack) this.bytes -= s.bytes
    this.redoStack = []
    while (this.undoStack.length > 1 && (this.undoStack.length > this.maxSteps || this.bytes > this.budget)) this.bytes -= this.undoStack.shift()!.bytes
    return true
  }

  /** Attach a layer-list change to the newest step. */
  tagLast(meta: unknown) {
    const s = this.undoStack.at(-1)
    if (s) s.meta = meta
  }

  /** The newest step (to tie a selection to it). */
  get last(): UndoStep | undefined {
    return this.undoStack.at(-1)
  }

  /** A step that only changes the selection; layerId is '' (no layer). */
  pushSelection(before: HTMLCanvasElement | null, after: HTMLCanvasElement | null) {
    const bytes = after ? after.width * after.height * 4 : 0
    this.pushes++
    this.undoStack.push({ layerId: '', tiles: [], bytes, sel: { before, after } })
    this.bytes += bytes
    for (const s of this.redoStack) this.bytes -= s.bytes
    this.redoStack = []
    while (this.undoStack.length > 1 && (this.undoStack.length > this.maxSteps || this.bytes > this.budget)) this.bytes -= this.undoStack.shift()!.bytes
  }

  /** A step that only changes the layer list (no pixels changed). */
  pushMeta(layerId: string, meta: unknown) {
    this.pushes++
    this.undoStack.push({ layerId, tiles: [], bytes: 0, meta })
    for (const s of this.redoStack) this.bytes -= s.bytes
    this.redoStack = []
    if (this.undoStack.length > this.maxSteps) this.bytes -= this.undoStack.shift()!.bytes
  }

  undo(): UndoStep | undefined {
    const s = this.undoStack.pop()
    if (s) this.redoStack.push(s)
    return s
  }

  redo(): UndoStep | undefined {
    const s = this.redoStack.pop()
    if (s) this.undoStack.push(s)
    return s
  }

  dropLayer(layerId: string) {
    const keep = (s: UndoStep) => {
      if (s.layerId !== layerId) return true
      this.bytes -= s.bytes
      return false
    }
    this.undoStack = this.undoStack.filter(keep)
    this.redoStack = this.redoStack.filter(keep)
  }

  get canUndo() {
    return this.undoStack.length > 0
  }
  get canRedo() {
    return this.redoStack.length > 0
  }
  get steps() {
    return this.undoStack.length
  }
}

/** How many layers fit in memory for a canvas size (each layer is width × height × 4 bytes). */
export function maxLayers(width: number, height: number, memory = 2048 * 1024 * 1024): number {
  return Math.max(1, Math.min(999, Math.floor(memory / (width * height * 4)) - 3))
}
