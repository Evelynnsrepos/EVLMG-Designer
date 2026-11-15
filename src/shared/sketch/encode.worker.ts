/// <reference lib="webworker" />
import { zipSync } from 'fflate'

/** Encodes PNGs and zips undo steps away from the page, so saving never freezes the drawing (0.31). See encode.ts. */
type Job =
  | { id: number; kind: 'png'; image: ImageBitmap | ArrayBuffer; w: number; h: number; colorSpace: PredefinedColorSpace }
  | { id: number; kind: 'zip'; files: Record<string, Uint8Array> }

self.onmessage = async (e: MessageEvent<Job>) => {
  const job = e.data
  try {
    if (job.kind === 'png') {
      const c = new OffscreenCanvas(job.w, job.h)
      const g = c.getContext('2d', { colorSpace: job.colorSpace })!
      if (job.image instanceof ImageBitmap) g.drawImage(job.image, 0, 0)
      else g.putImageData(new ImageData(new Uint8ClampedArray(job.image), job.w, job.h, { colorSpace: job.colorSpace }), 0, 0)
      self.postMessage({ id: job.id, result: await c.convertToBlob({ type: 'image/png' }) })
    } else {
      const bytes = zipSync(job.files, { level: 1 })
      self.postMessage({ id: job.id, result: bytes }, [bytes.buffer])
    }
  } catch (err) {
    self.postMessage({ id: job.id, error: String(err) })
  }
}
