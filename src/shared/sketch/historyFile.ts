import { unzipSync, zipSync } from 'fflate'
import type { Id } from '@/core/model'
import { getFs } from '@/core/fs'
import { projectPaths } from '@/core/project'
import { zipOf } from './encode'
import type { SketchEngine } from './engine'
import type { UndoStep } from './tiles'

/**
 * Draw's undo history kept between sessions (0.31), in `.history/sketch/<document id>/`: one compressed file per
 * step (the changed tiles before and after, plus any layer-list change) and `index.json` with the order. After every
 * save only new steps are written. Selection-only steps stay in the session. On opening, the steps come back only
 * when the newest one matches the layers as they were loaded, so a history that no longer fits is never used.
 */

/** Steps kept between sessions (the session itself keeps up to 250). */
export const SAVED_STEPS = 100

interface Index {
  version: 1
  width: number
  height: number
  undo: string[]
  redo: string[]
}

interface StepHead {
  layerId: string
  meta?: unknown
  rects: { x: number; y: number; w: number; h: number }[]
}

const keep = (s: UndoStep) => !!s.id && (s.tiles.length > 0 || s.meta !== undefined)

/** encodeStep, zipped off the page (saving a big stroke's tiles took about a second there). */
export async function encodeStepAsync(s: UndoStep): Promise<Uint8Array> {
  return zipOf(stepFiles(s))
}

export function encodeStep(s: UndoStep): Uint8Array {
  return zipSync(stepFiles(s), { level: 1 })
}

function stepFiles(s: UndoStep): Record<string, Uint8Array> {
  const head: StepHead = { layerId: s.layerId, meta: s.meta, rects: s.tiles.map((t) => t.rect) }
  const files: Record<string, Uint8Array> = { 'step.json': new TextEncoder().encode(JSON.stringify(head)) }
  s.tiles.forEach((t, i) => {
    files[`b${i}`] = new Uint8Array(t.before.data.buffer, t.before.data.byteOffset, t.before.data.byteLength)
    files[`a${i}`] = new Uint8Array(t.after.data.buffer, t.after.data.byteOffset, t.after.data.byteLength)
  })
  return files
}

export function decodeStep(id: string, bytes: Uint8Array, colorSpace: PredefinedColorSpace): UndoStep {
  const files = unzipSync(bytes)
  const head = JSON.parse(new TextDecoder().decode(files['step.json'])) as StepHead
  const img = (name: string, r: StepHead['rects'][number]) => new ImageData(new Uint8ClampedArray(files[name]), r.w, r.h, { colorSpace })
  const tiles = head.rects.map((rect, i) => ({ rect, before: img(`b${i}`, rect), after: img(`a${i}`, rect) }))
  return { id, layerId: head.layerId, meta: head.meta, tiles, bytes: tiles.reduce((n, t) => n + t.before.data.byteLength * 2, 0) }
}

/**
 * True when the layer's pixels are what `step` left behind. Compared as colour × alpha (what you see), off by at
 * most 2: a faint pixel's colour comes back from its PNG quite differently while looking the same.
 */
export function fitsLayer(step: UndoStep, pixels: (r: UndoStep['tiles'][number]['rect']) => ImageData | null): boolean {
  for (const t of step.tiles) {
    const now = pixels(t.rect)
    if (!now) return false
    const a = t.after.data
    const b = now.data
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i + 3] - b[i + 3]) > 2) return false
      for (let c = 0; c < 3; c++) if (Math.abs(a[i + c] * a[i + 3] - b[i + c] * b[i + 3]) > 2 * 255) return false
    }
  }
  return true
}

export class SketchHistoryFile {
  private root: string
  private docId: Id
  /** Steps already on disk, by id. */
  private onDisk = new Set<string>()
  private size = { w: 0, h: 0 }
  private writing: Promise<void> = Promise.resolve()

  constructor(root: string, docId: Id) {
    this.root = root
    this.docId = docId
  }

  private async dir() {
    return getFs().join(await projectPaths.historyDir(this.root), 'sketch', this.docId)
  }

  /** Write what changed since the last call (one write at a time, in the background). */
  sync(engine: SketchEngine) {
    this.writing = this.writing.then(() => this.syncNow(engine)).catch(() => {})
    return this.writing
  }

  private async syncNow(engine: SketchEngine) {
    const fs = getFs()
    const dir = await this.dir()
    // The working area grew: every saved tile sits somewhere else now, so all steps are written again.
    if (this.size.w !== engine.width || this.size.h !== engine.height) this.onDisk.clear()
    this.size = { w: engine.width, h: engine.height }
    const { undo, redo } = engine.historyStacks
    const kept = [...undo.filter(keep).slice(-SAVED_STEPS), ...redo.filter(keep)]
    await fs.mkdir(dir)
    for (const s of kept)
      if (!this.onDisk.has(s.id!)) {
        await fs.writeBinaryAtomic(await fs.join(dir, `${s.id}.bin`), await encodeStepAsync(s))
        this.onDisk.add(s.id!)
      }
    const index: Index = { version: 1, width: engine.width, height: engine.height, undo: undo.filter(keep).slice(-SAVED_STEPS).map((s) => s.id!), redo: redo.filter(keep).map((s) => s.id!) }
    await fs.writeTextAtomic(await fs.join(dir, 'index.json'), JSON.stringify(index))
    // Steps that fell off the end or were replaced by new paint after an undo.
    const live = new Set(kept.map((s) => s.id!))
    for (const e of await fs.list(dir))
      if (e.name.endsWith('.bin') && !live.has(e.name.slice(0, -4))) {
        await fs.remove(await fs.join(dir, e.name)).catch(() => {})
        this.onDisk.delete(e.name.slice(0, -4))
      }
  }

  /** Put the saved steps back into the engine, if they fit the drawing as loaded. Returns how many came back. */
  async load(engine: SketchEngine, layerIds: Set<Id>): Promise<number> {
    try {
      const fs = getFs()
      const dir = await this.dir()
      const path = await fs.join(dir, 'index.json')
      if (!(await fs.exists(path))) return 0
      const index = JSON.parse(await fs.readText(path)) as Index
      if (index.version !== 1 || index.width !== engine.width || index.height !== engine.height) return 0
      const read = async (id: string) => decodeStep(id, await fs.readBinary(await fs.join(dir, `${id}.bin`)), engine.colorSpace)
      const undo = await Promise.all(index.undo.map(read))
      const redo = await Promise.all(index.redo.map(read))
      const top = [...undo].reverse().find((s) => s.tiles.length)
      const pixels = (id: Id) => (r: UndoStep['tiles'][number]['rect']) => (layerIds.has(id) ? engine.layerPixels(id, r) : null)
      if (top && !fitsLayer(top, pixels(top.layerId))) return 0
      // Painted already in this session: that history wins.
      if (engine.canUndo || engine.canRedo) return 0
      engine.loadHistory(undo, redo)
      for (const s of [...undo, ...redo]) this.onDisk.add(s.id!)
      this.size = { w: engine.width, h: engine.height }
      return undo.length + redo.length
    } catch {
      return 0
    }
  }
}
