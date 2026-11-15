import { zipSync } from 'fflate'

/**
 * Saving without freezing the drawing (0.31): PNG encoding and zipping run in a worker (encode.worker.ts) when the
 * web engine can draw there (OffscreenCanvas); otherwise on the page as before.
 */

let worker: Worker | null | undefined
let next = 0
const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>()

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' ? new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' }) : null
    worker?.addEventListener('message', (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const w = waiting.get(e.data.id)
      waiting.delete(e.data.id)
      if (e.data.error !== undefined) w?.fail(new Error(e.data.error))
      else w?.ok(e.data.result)
    })
    worker?.addEventListener('error', () => (worker = null))
  } catch {
    worker = null
  }
  return worker
}

function call<T>(job: Record<string, unknown>, transfer: Transferable[]): Promise<T> {
  const w = getWorker()!
  const id = ++next
  return new Promise<T>((ok, fail) => {
    waiting.set(id, { ok: ok as (v: unknown) => void, fail })
    w.postMessage({ ...job, id }, transfer)
  })
}

const pngOnPage = (c: HTMLCanvasElement) => new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('Could not encode PNG'))), 'image/png'))

/** A canvas (a layer) or straight pixels as PNG, encoded off the page when possible. */
export async function pngOf(src: HTMLCanvasElement | ImageData, colorSpace: PredefinedColorSpace = 'srgb'): Promise<Blob> {
  if (getWorker()) {
    try {
      if (src instanceof ImageData) return await call<Blob>({ kind: 'png', image: src.data.buffer, w: src.width, h: src.height, colorSpace }, [src.data.buffer])
      const image = await createImageBitmap(src)
      return await call<Blob>({ kind: 'png', image, w: src.width, h: src.height, colorSpace }, [image])
    } catch {
      worker = null
    }
  }
  if (src instanceof HTMLCanvasElement) return pngOnPage(src)
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  c.getContext('2d', { colorSpace })!.putImageData(src, 0, 0)
  return pngOnPage(c)
}

/** Files zipped (fast compression), off the page when possible. The byte arrays are copied, not taken. */
export async function zipOf(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  if (getWorker()) {
    try {
      // Copied a few MB at a time with breaks in between, so the drawing keeps moving; the copies are handed over.
      const copies: Record<string, Uint8Array> = {}
      let since = 0
      for (const [k, v] of Object.entries(files)) {
        copies[k] = v.slice()
        since += v.byteLength
        if (since > 8 << 20) {
          since = 0
          await new Promise((r) => setTimeout(r, 0))
        }
      }
      return await call<Uint8Array>({ kind: 'zip', files: copies }, Object.values(copies).map((c) => c.buffer))
    } catch {
      worker = null
    }
  }
  return zipSync(files, { level: 1 })
}
