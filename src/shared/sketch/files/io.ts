import { zipSync } from 'fflate'
import { frameOf, toFrame } from '../growth'
import { resolveAssetPath } from '@/core/assets'
import { getFs, isTauri } from '@/core/fs'
import type { AssetPath } from '@/core/model'
import { frameIds, normalizeAnimation, playable, sequence, showFrames } from '../assist'
import type { SketchEngine } from '../engine'
import { exportLayers, isGroup, isMask, layerTree, subtreeStack } from '../layers'
import type { SketchDoc } from '../model'
import { ApngEncoder } from './apng'
import { fitSize, type CanvasChange } from './canvas'
import { GifEncoder } from './gif'
import { readPsd, writePsd, type Pixels, type PsdFile } from './psd'
import { readTiff, writeTiff } from './tiff'
import { muxWebm, type AudioTrack, type VideoChunk } from './webm'

/**
 * The browser side of Sketch files (Sketch Pro): reading files the user picks,
 * turning the drawing into PSD / PNG / JPEG / TIFF / layer PNGs, and encoding
 * animations and time-lapses (WebM through WebCodecs, else GIF; also APNG).
 */

export const IMPORT_EXTENSIONS = ['psd', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff']

export function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })! }
}

export function pixelsOf(src: CanvasImageSource, w: number, h: number): Pixels {
  const { ctx } = makeCanvas(w, h)
  ctx.drawImage(src, 0, 0)
  return ctx.getImageData(0, 0, w, h)
}

export function canvasOf(p: Pixels): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(p.width, p.height)
  ctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0)
  return canvas
}

/** Draw `src` (at the old canvas size) onto a new canvas after a canvas change. */
export function applyChange(src: CanvasImageSource, c: CanvasChange): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(c.width, c.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.setTransform(...c.matrix)
  ctx.drawImage(src, 0, 0)
  return canvas
}

export function canvasBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the picture'))), type, quality))
}

export async function readAssetImage(root: string, path: AssetPath): Promise<ImageBitmap> {
  const bytes = await getFs().readBinary(await resolveAssetPath(root, path))
  return createImageBitmap(new Blob([bytes as BlobPart]))
}

// ---- Import -------------------------------------------------------------------

/** Ask for files: the system dialog on desktop, a file input in the browser. */
export async function pickFiles(title: string, extensions: string[]): Promise<{ name: string; bytes: Uint8Array }[]> {
  if (isTauri()) {
    const fs = getFs()
    const paths = await fs.pickFiles(title, extensions)
    return Promise.all(paths.map(async (p) => ({ name: p.split(/[\\/]/).pop() ?? p, bytes: await fs.readBinary(p) })))
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = extensions.map((e) => `.${e}`).join(',')
    input.multiple = true
    input.onchange = async () => resolve(await Promise.all([...(input.files ?? [])].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))))
    input.click()
  })
}

/** Any supported file as layers (a picture is one layer). Throws with a readable message. */
export async function readImport(name: string, bytes: Uint8Array): Promise<PsdFile> {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'psd') return readPsd(bytes)
  let pixels: Pixels
  try {
    // GIFs give their first frame; TIFF works where the webview can decode it.
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: ext === 'tif' || ext === 'tiff' ? 'image/tiff' : '' }))
    pixels = pixelsOf(bmp, bmp.width, bmp.height)
  } catch {
    if (ext !== 'tif' && ext !== 'tiff') throw new Error(`${name} could not be read as a picture`)
    pixels = readTiff(bytes)
  }
  const { width, height } = pixels
  return { width, height, layers: [{ id: 'img', name: name.replace(/\.[^.]+$/, ''), opacity: 1, blend: 'source-over', visible: true, clip: false, parent: null, pixels: { ...pixels, left: 0, top: 0 } }] }
}

// ---- Export -------------------------------------------------------------------

export type ExportFormat = 'png' | 'jpeg' | 'tiff' | 'psd' | 'layers' | 'gif' | 'apng' | 'webm'

export interface Exported {
  bytes: Uint8Array
  ext: string
  filter: { name: string; extensions: string[] }
}

const FILTERS: Record<string, string> = { png: 'PNG image', jpg: 'JPEG image', tif: 'TIFF image', psd: 'Photoshop file', zip: 'Zip archive', gif: 'Animated GIF', webm: 'WebM video' }
const out = (bytes: Uint8Array, ext: string, name = FILTERS[ext]): Exported => ({ bytes, ext, filter: { name, extensions: [ext] } })

/** The picture without private layers, flattened, as a 2D canvas (the engine may hand out its GPU canvas). */
function flat(engine: SketchEngine, doc: SketchDoc, background: string | null): HTMLCanvasElement {
  const f = frameOf(doc)
  const { canvas, ctx } = makeCanvas(f.w, f.h)
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, f.w, f.h)
  }
  ctx.drawImage(engine.render({ ...doc, layers: exportLayers(doc.layers) }, false), -f.x, -f.y)
  return canvas
}

/**
 * Animation frames, one per tick. With Animation Assist on, its frames, holds,
 * ping-pong and background / foreground frames are used; otherwise each visible
 * top-level layer or group is one frame.
 */
export function layerFrames(engine: SketchEngine, doc: SketchDoc): (() => HTMLCanvasElement)[] {
  const layers = exportLayers(doc.layers)
  const f = frameOf(doc)
  const draw = (stack: SketchDoc['layers']) => () => {
    const { canvas, ctx } = makeCanvas(f.w, f.h)
    ctx.drawImage(engine.render({ layers: stack, backgroundColor: doc.backgroundColor }, true), -f.x, -f.y)
    return canvas
  }
  if (doc.animation?.on) {
    const a = normalizeAnimation(doc.animation)
    const ids = frameIds(layers)
    const frames = playable(ids.length, a)
    // Background and foreground frames show under / over every frame.
    const fixed = ids.map((_, i) => i).filter((i) => !frames.includes(i))
    return sequence(ids, frames, a.holds, a.mode).map((f) => draw(showFrames(layers, ids, [...fixed, f])))
  }
  return layerTree(layers)
    .filter((n) => n.layer.visible)
    .map((n) => draw(subtreeStack(layers, n.layer.id)))
}

export async function exportDrawing(format: ExportFormat, engine: SketchEngine, doc: SketchDoc, fps = 8): Promise<Exported> {
  // 0.31: only the canvas (the frame) is exported, not paint past its edges.
  const { w: width, h: height } = frameOf(doc)
  const layerPixels = (id: string) => toFrame(engine.layerCanvas(id), doc)
  switch (format) {
    case 'png':
      return out(new Uint8Array(await (await canvasBlob(flat(engine, doc, doc.backgroundColor))).arrayBuffer()), 'png')
    case 'jpeg':
      return out(new Uint8Array(await (await canvasBlob(flat(engine, doc, doc.backgroundColor ?? '#ffffff'), 'image/jpeg', 0.92)).arrayBuffer()), 'jpg')
    case 'tiff':
      return out(writeTiff(pixelsOf(flat(engine, doc, doc.backgroundColor), width, height)), 'tif')
    case 'psd': {
      const layers = exportLayers(doc.layers)
      const bytes = writePsd({
        width,
        height,
        layers,
        pixels: (id) => (engine.isEmpty(id) ? null : layerPixels(id).getContext('2d')!.getImageData(0, 0, width, height)),
        composite: pixelsOf(flat(engine, doc, doc.backgroundColor ?? '#ffffff'), width, height),
      })
      return out(bytes, 'psd')
    }
    case 'layers': {
      const files: Record<string, Uint8Array> = {}
      const pixelLayers = exportLayers(doc.layers).filter((l) => !isGroup(l) && !isMask(l))
      for (const [i, l] of pixelLayers.entries()) {
        const name = `${String(i + 1).padStart(2, '0')} ${l.name.replace(/[<>:"/\\|?*]/g, '')}.png`
        files[name] = new Uint8Array(await (await canvasBlob(layerPixels(l.id))).arrayBuffer())
      }
      return out(zipSync(files, { level: 0 }), 'zip')
    }
    default: {
      const frames = layerFrames(engine, doc)
      if (doc.animation?.on) fps = normalizeAnimation(doc.animation).fps
      return encodeAnimation(
        format,
        width,
        height,
        frames.map((f) => ({ ms: 1000 / fps, draw: f })),
      )
    }
  }
}

// ---- Animation and video --------------------------------------------------------

export interface AnimFrame {
  ms: number
  draw(): HTMLCanvasElement | Promise<HTMLCanvasElement>
}

/** True when this webview can make WebM video (WebCodecs). */
export const canEncodeVideo = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'

/** Letterbox a picture into a frame of exactly w × h. */
function framed(src: HTMLCanvasElement, w: number, h: number, frame: ReturnType<typeof makeCanvas>, background: string) {
  const { ctx } = frame
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, w, h)
  const k = Math.min(w / src.width, h / src.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, (w - src.width * k) / 2, (h - src.height * k) / 2, src.width * k, src.height * k)
  return frame.canvas
}

/**
 * Encode frames as GIF, APNG or WebM. Pictures are fitted into width × height.
 * WebM falls back to GIF when the webview has no video encoder (the result says which).
 */
export async function encodeAnimation(
  format: 'gif' | 'apng' | 'webm',
  width: number,
  height: number,
  frames: AnimFrame[],
  onProgress?: (done: number) => void,
  /** WebM only: a sound track (Storyboard animatics). Left out where the webview can't encode Opus. */
  sound?: AudioBuffer | null,
): Promise<Exported> {
  if (format === 'webm' && canEncodeVideo()) {
    const video = await encodeWebm(width, height, frames, onProgress, sound ? await encodeOpus(sound) : undefined)
    if (video) return out(video, 'webm')
  }
  // GIF and APNG keep the real size up to 1920 px (sprites stay pixel-exact).
  const k = Math.min(1, (format === 'webm' ? 960 : 1920) / Math.max(width, height))
  const size = { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
  const frame = makeCanvas(size.width, size.height)
  const enc = format === 'apng' ? new ApngEncoder(size.width, size.height) : new GifEncoder(size.width, size.height)
  for (const [i, f] of frames.entries()) {
    const c = framed(await f.draw(), size.width, size.height, frame, format === 'apng' ? 'transparent' : '#ffffff')
    enc.add(frame.ctx.getImageData(0, 0, c.width, c.height), f.ms)
    onProgress?.(i + 1)
    // Let the page breathe between frames.
    await new Promise((r) => setTimeout(r, 0))
  }
  return format === 'apng' ? out(enc.done(), 'png', 'Animated PNG') : out(enc.done(), 'gif')
}

async function encodeWebm(width: number, height: number, frames: AnimFrame[], onProgress?: (done: number) => void, audio?: AudioTrack | null): Promise<Uint8Array | null> {
  const size = fitSize(width, height, 4096)
  for (const [codec, id] of [
    ['vp09.00.10.08', 'V_VP9'],
    ['vp8', 'V_VP8'],
  ] as const) {
    const config: VideoEncoderConfig = { codec, width: size.width, height: size.height, bitrate: 6_000_000, framerate: 30 }
    if (!(await VideoEncoder.isConfigSupported(config).catch(() => null))?.supported) continue
    const chunks: VideoChunk[] = []
    let failed: unknown = null
    const enc = new VideoEncoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        chunks.push({ data, time: chunk.timestamp / 1000, key: chunk.type === 'key' })
      },
      error: (e) => (failed = e),
    })
    enc.configure(config)
    const frame = makeCanvas(size.width, size.height)
    let t = 0
    for (const [i, f] of frames.entries()) {
      const vf = new VideoFrame(framed(await f.draw(), size.width, size.height, frame, '#ffffff'), { timestamp: Math.round(t * 1000), duration: Math.round(f.ms * 1000) })
      enc.encode(vf, { keyFrame: i % 60 === 0 })
      vf.close()
      t += f.ms
      onProgress?.(i + 1)
      while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5))
      if (failed) break
    }
    if (!failed) await enc.flush().catch((e) => (failed = e))
    enc.close()
    if (failed) continue
    chunks.sort((a, b) => a.time - b.time)
    return muxWebm(chunks, { ...size, codec: id, duration: t, audio: audio ?? undefined })
  }
  return null
}

export const canEncodeSound = () => typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined'

/** Opus chunks for a WebM sound track, or null where the webview has no Opus encoder. */
export async function encodeOpus(buffer: AudioBuffer): Promise<AudioTrack | null> {
  if (!canEncodeSound()) return null
  const sampleRate = 48000
  const channels = Math.min(2, buffer.numberOfChannels)
  const config: AudioEncoderConfig = { codec: 'opus', sampleRate, numberOfChannels: channels, bitrate: 128_000 }
  if (buffer.sampleRate !== sampleRate || !(await AudioEncoder.isConfigSupported(config).catch(() => null))?.supported) return null
  const chunks: VideoChunk[] = []
  let codecPrivate: Uint8Array | null = null
  let failed: unknown = null
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push({ data, time: chunk.timestamp / 1000, key: true })
      const d = meta?.decoderConfig?.description
      if (d && !codecPrivate) codecPrivate = new Uint8Array(ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d)
    },
    error: (e) => (failed = e),
  })
  enc.configure(config)
  // One second at a time, planar float like the AudioBuffer holds it.
  for (let at = 0; at < buffer.length && !failed; at += sampleRate) {
    const n = Math.min(sampleRate, buffer.length - at)
    const planes = new Float32Array(n * channels)
    for (let c = 0; c < channels; c++) planes.set(buffer.getChannelData(c).subarray(at, at + n), c * n)
    const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((at / sampleRate) * 1e6), data: planes })
    enc.encode(ad)
    ad.close()
  }
  if (!failed) await enc.flush().catch((e) => (failed = e))
  enc.close()
  if (failed || !chunks.length) return null
  // shortcut: without an OpusHead from the encoder, build the standard one (no pre-skip info), when a player complains use the encoder's.
  codecPrivate ??= opusHead(channels, sampleRate)
  return { chunks, sampleRate, channels, codecPrivate }
}

function opusHead(channels: number, rate: number): Uint8Array {
  const b = new Uint8Array(19)
  b.set([...'OpusHead'].map((c) => c.charCodeAt(0)))
  const v = new DataView(b.buffer)
  b[8] = 1
  b[9] = channels
  v.setUint16(10, 312, true)
  v.setUint32(12, rate, true)
  return b
}

/** A 16-bit WAV file (Storyboard: the animatic's sound mix on its own). */
export function wavBytes(buffer: AudioBuffer): Uint8Array {
  const ch = buffer.numberOfChannels
  const n = buffer.length
  const out = new Uint8Array(44 + n * ch * 2)
  const v = new DataView(out.buffer)
  const text = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)))
  text(0, 'RIFF')
  v.setUint32(4, 36 + n * ch * 2, true)
  text(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, ch, true)
  v.setUint32(24, buffer.sampleRate, true)
  v.setUint32(28, buffer.sampleRate * ch * 2, true)
  v.setUint16(32, ch * 2, true)
  v.setUint16(34, 16, true)
  text(36, 'data')
  v.setUint32(40, n * ch * 2, true)
  const data = [...Array(ch)].map((_, c) => buffer.getChannelData(c))
  for (let i = 0, at = 44; i < n; i++) for (let c = 0; c < ch; c++, at += 2) v.setInt16(at, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true)
  return out
}

/** Time-lapse frames from the recorded assets, then the finished picture. */
export function timelapseFrames(root: string, frames: AssetPath[], plan: { index: number; ms: number }[], final: () => HTMLCanvasElement): AnimFrame[] {
  let cache: { index: number; canvas: HTMLCanvasElement } | null = null
  return plan.map((step) => ({
    ms: step.ms,
    draw: async () => {
      if (step.index < 0) return final()
      if (cache?.index !== step.index) {
        const bmp = await readAssetImage(root, frames[step.index]).catch(() => null)
        const c = makeCanvas(bmp?.width ?? 2, bmp?.height ?? 2)
        if (bmp) c.ctx.drawImage(bmp, 0, 0)
        cache = { index: step.index, canvas: c.canvas }
      }
      return cache.canvas
    },
  }))
}
