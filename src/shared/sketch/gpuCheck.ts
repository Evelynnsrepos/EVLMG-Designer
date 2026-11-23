import type { AsciiMark } from './ascii'
import { runCpu } from './adjust/cpu'
import { defaultValues, type AdjustValues, type FilterId } from './adjust/filters'
import { AdjustGl } from './adjust/gpu'
import { defaultLibrary } from './brushDefaults'
import type { BrushSettings } from './brushes'
import { loadImageMask } from './brushTextures'
import { SketchEngine } from './engine'
import { glAllowed } from './gl'
import { gpuAllowSoftware } from './gpuPaint'
import { newLayer, type InputPoint, type LayerAdjust } from './model'
import type { OutlineSettings } from './outline'
import { transformState } from './transform'
import { Transformer } from './transformer'

/** A pen point with a fixed time, so speed-based settings come out the same in both runs. */
const pt = (x: number, y: number, pressure: number, time: number) => ({ x, y, pressure, time }) as InputPoint

/**
 * Runs in a browser for gpu.test.ts: the same strokes and adjustment layers painted by the GPU engine and by
 * Canvas 2D, compared pixel by pixel. Random numbers are seeded, so both get the same jitter.
 */

const W = 240
const H = 160

export interface GpuDiff {
  name: string
  gpu: boolean
  /** Mean difference per channel, 0..255. */
  mean: number
  max: number
}

function engine(gpu: boolean) {
  glAllowed.value = gpu
  const e = new SketchEngine(W, H)
  glAllowed.value = true
  return e
}

function diff(name: string, gpu: boolean, a: Uint8ClampedArray, b: Uint8ClampedArray): GpuDiff {
  let max = 0
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    if (d > max) max = d
    sum += d
  }
  return { name, gpu, mean: sum / a.length, max }
}

/** A see-through test image with light and dark (two shaded ovals), for ribbon and shaded brushes. */
function testImage(w: number, h: number): string {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  for (const x of [w / 4, (3 * w) / 4]) {
    const gr = g.createRadialGradient(x - h / 6, h / 3, 1, x, h / 2, h / 1.6)
    gr.addColorStop(0, '#fff')
    gr.addColorStop(1, '#111')
    g.fillStyle = gr
    g.beginPath()
    g.ellipse(x, h / 2, w / 4.2, h / 2.2, 0.4, 0, Math.PI * 2)
    g.fill()
  }
  return c.toDataURL()
}

let images: { braid: string; bead: string } | null = null

const BRUSHES: Record<string, () => Partial<BrushSettings>> = {
  'ribbon-shaded-caps': () => ({ shapeImage: images!.braid, ribbon: 'tile', shaded: true, capStart: images!.bead, capEnd: images!.bead }),
  'stamps-shaded': () => ({ shapeImage: images!.braid, shaded: true, spacing: 0.6 }),
}

function stroke(brushId: string, gpu: boolean, mode: 'paint' | 'erase' | 'smudge') {
  const lib = defaultLibrary().brushes
  const brush = BRUSHES[brushId] ? { ...lib.find((b) => b.id === 'round-brush')!, ...BRUSHES[brushId]() } : lib.find((b) => b.id === brushId)!
  const e = engine(gpu)
  const layer = newLayer('L')
  const doc = { layers: [layer], backgroundColor: '#ffffff' }
  e.edit(layer.id, (c) => {
    c.fillStyle = '#3080c0'
    c.fillRect(60, 0, 80, H)
  })
  let seed = 12345
  const random = Math.random
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  try {
    e.beginStroke({ layer, brush: { ...brush, size: Math.min(brush.size, 30) }, color: '#c03020', symmetry: 'off', erase: mode === 'erase', smudge: mode === 'smudge' }, pt(20, 80, 0.3, 0))
    for (let i = 1; i <= 40; i++) {
      const t = i / 40
      e.strokeTo(pt(20 + t * 200, 80 + Math.sin(t * 9) * 50, 0.3 + 0.6 * Math.sin(t * 3) ** 2, i * 8))
      if (i % 4 === 0) e.render(doc)
    }
    e.endStroke()
  } finally {
    Math.random = random
  }
  return { px: e.render(doc).getContext('2d')!.getImageData(0, 0, W, H).data, gpu: e.gpuActive }
}

function adjusted(id: LayerAdjust['id'], gpu: boolean) {
  const e = engine(gpu)
  const a = newLayer('A')
  const b = newLayer('B')
  const values = defaultValues(id, W, H)
  values.v = { ...values.v, hue: 60, sat: 0.4, bright: -0.2, shadows0: 0.3, highlights2: -0.4 }
  const adj = { ...newLayer('Adj'), kind: 'adjust' as const, adjust: { id, values } }
  e.edit(a.id, (c) => {
    const g = c.createLinearGradient(0, 0, W, 0)
    g.addColorStop(0, '#102030')
    g.addColorStop(0.5, '#e08040')
    g.addColorStop(1, '#40c0f0')
    c.fillStyle = g
    c.fillRect(0, 0, W, H)
  })
  e.edit(b.id, (c) => {
    c.fillStyle = 'rgba(200,30,120,0.6)'
    c.fillRect(40, 40, 120, 80)
  })
  return { px: e.render({ layers: [a, b, adj], backgroundColor: '#ffffff' }).getContext('2d')!.getImageData(0, 0, W, H).data, gpu: e.gpuActive }
}

/** An Adjustments menu filter (not a layer) on the GPU preview vs the CPU, on a see-through gradient. */
function filtered(id: FilterId, values: AdjustValues): GpuDiff | null {
  const src = document.createElement('canvas')
  src.width = W
  src.height = H
  const c = src.getContext('2d')!
  const g = c.createLinearGradient(0, 0, W, 0)
  g.addColorStop(0, '#102030')
  g.addColorStop(0.5, '#e08040')
  g.addColorStop(1, '#ffffff')
  c.fillStyle = g
  c.fillRect(0, 0, W, H)
  c.fillStyle = 'rgba(40,200,120,0.6)'
  c.fillRect(40, 40, 120, 80)
  const gl = AdjustGl.create(W, H)
  if (!gl) return null
  gl.setSource(src)
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const o = out.getContext('2d')!
  o.drawImage(gl.run(id, values), 0, 0)
  const cpu = runCpu(id, values, c.getImageData(0, 0, W, H)).data
  return diff(`${id} (Adjustments menu): GPU vs CPU`, true, o.getImageData(0, 0, W, H).data, cpu)
}

const OUTLINES: Record<string, OutlineSettings> = {
  outside: { size: 6, color: '#202020', where: 'outside', sharpness: 1, roundness: 1 },
  'center-soft-square': { size: 10, color: '#ff0000', color2: '#0000ff', where: 'center', sharpness: 0.3, roundness: 0 },
  inside: { size: 5, color: '#00a040', where: 'inside', sharpness: 1, roundness: 0.5 },
}

/** An outline layer painted on (the outline follows while painting), then the same pixels outlined from scratch. */
function outlined(name: string, gpu: boolean) {
  const e = engine(gpu)
  const layer = { ...newLayer('O'), outline: OUTLINES[name] }
  const doc = { layers: [layer], backgroundColor: '#ffffff' }
  e.edit(layer.id, (c) => {
    c.fillStyle = '#3080c0'
    c.fillRect(150, 30, 50, 90)
  })
  e.render(doc)
  const brush = defaultLibrary().brushes.find((b) => b.id === 'round-brush')!
  e.beginStroke({ layer, brush: { ...brush, size: 14 }, color: '#c03020', symmetry: 'off', erase: false }, pt(20, 80, 1, 0))
  for (let i = 1; i <= 30; i++) {
    e.strokeTo(pt(20 + i * 6, 80 + Math.sin(i / 3) * 40, 1, i * 8))
    if (i % 3 === 0) e.draw(doc, [1, 0, 0, 1, 0, 0], W, H, 1, false) || e.render(doc)
  }
  e.endStroke()
  const px = e.render(doc).getContext('2d')!.getImageData(0, 0, W, H).data.slice()
  const scratch = (on: boolean) => {
    const f = engine(on)
    f.setLayerImage(layer.id, e.layerCanvas(layer.id))
    return f.render(doc).getContext('2d')!.getImageData(0, 0, W, H).data
  }
  return { px, fresh: scratch(gpu), other: scratch(!gpu), gpu: e.gpuActive }
}

/** An ASCII layer painted on (the letters follow while painting), then the same pixels as letters from scratch. */
function asciiLayer(gpu: boolean, v: Record<string, number>, marks?: Record<string, AsciiMark>) {
  const e = engine(gpu)
  const layer = { ...newLayer('A'), ascii: { ...defaultValues('ascii', W, H), v: { ...defaultValues('ascii', W, H).v, look: 2, ...v } } }
  let doc = { layers: [layer], backgroundColor: '#ffffff' }
  e.edit(layer.id, (c) => {
    c.fillStyle = '#3080c0'
    c.fillRect(150, 30, 50, 90)
  })
  e.render(doc)
  const brush = defaultLibrary().brushes.find((b) => b.id === 'round-brush')!
  e.beginStroke({ layer, brush: { ...brush, size: 14 }, color: '#c03020', symmetry: 'off', erase: false }, pt(20, 80, 1, 0))
  for (let i = 1; i <= 30; i++) {
    e.strokeTo(pt(20 + i * 6, 80 + Math.sin(i / 3) * 40, 1, i * 8))
    if (i % 3 === 0) e.draw(doc, [1, 0, 0, 1, 0, 0], W, H, 1, false) || e.render(doc)
  }
  e.endStroke()
  if (marks) {
    // Sign brushes: only the marks change after the picture was drawn (the letters are picked again, nothing re-read).
    e.render(doc)
    doc = { ...doc, layers: [{ ...layer, ascii: { ...layer.ascii, ascii: { marks } } }] }
  }
  const px = e.render(doc).getContext('2d')!.getImageData(0, 0, W, H).data.slice()
  const scratch = (on: boolean) => {
    const f = engine(on)
    f.setLayerImage(layer.id, e.layerCanvas(layer.id))
    return f.render(doc).getContext('2d')!.getImageData(0, 0, W, H).data
  }
  return { px, fresh: scratch(gpu), other: scratch(!gpu), gpu: e.gpuActive }
}

/** The Move tool: a layer moved and turned, then dropped (on the GPU it is drawn and dropped there). */
function moved(gpu: boolean) {
  const e = engine(gpu)
  const layer = newLayer('L')
  e.edit(layer.id, (c) => {
    c.fillStyle = '#c03020'
    c.fillRect(40, 30, 90, 60)
    c.fillStyle = '#3080c0'
    c.fillRect(100, 70, 50, 50)
  })
  const xf = new Transformer(e)
  xf.begin(layer.id)
  const s0 = (xf as unknown as { state: Parameters<typeof transformState>[0] }).state
  for (let i = 1; i <= 5; i++) {
    const a = i * 0.05
    xf.set(transformState(s0, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 20 + i * 6, -10 + i * 3]))
    e.draw({ layers: [layer], backgroundColor: null }, [1, 0, 0, 1, 0, 0], W, H, 1, false)
  }
  xf.commit(null)
  return { px: e.layerCanvas(layer.id).getContext('2d')!.getImageData(0, 0, W, H).data, gpu: e.gpuActive }
}

/**
 * Foreign pixels in the GPU copy of a layer (what a test build once saved: other GPU memory) must never reach the
 * saved layer: a stroke next to them keeps everything outside its own paint as it was. Returns the stray pixel count.
 */
function foreignPixels(): { stray: number; gpu: boolean } {
  const e = engine(true)
  const layer = newLayer('L')
  const doc = { layers: [layer], backgroundColor: null }
  e.render(doc)
  const internals = e as unknown as { tex(id: string): { fb: WebGLFramebuffer }; gpu: { gl: WebGL2RenderingContext } }
  const fb = internals.tex(layer.id).fb
  const gl = internals.gpu.gl
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.enable(gl.SCISSOR_TEST)
  gl.scissor(120, 0, 100, H)
  gl.clearColor(1, 0, 1, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.disable(gl.SCISSOR_TEST)
  const brush = defaultLibrary().brushes.find((b) => b.id === 'round-brush')!
  e.beginStroke({ layer, brush: { ...brush, size: 10 }, color: '#000000', symmetry: 'off', erase: false }, pt(20, 80, 1, 0))
  for (let i = 1; i <= 5; i++) e.strokeTo(pt(20 + i * 10, 80, 1, i * 8))
  e.endStroke()
  const d = e.layerCanvas(layer.id).getContext('2d')!.getImageData(120, 0, 100, H).data
  let stray = 0
  for (let i = 3; i < d.length; i += 4) if (d[i]) stray++
  // and the screen copy was repaired: the flattened picture has nothing there either
  const pic = e.render(doc, false).getContext('2d')!.getImageData(120, 0, 100, H).data
  for (let i = 3; i < pic.length; i += 4) if (pic[i]) stray++
  return { stray, gpu: e.gpuActive }
}

/** Paint on the GPU, undo, redo: the picture must come back exactly each time. */
function undoRoundTrip(): GpuDiff[] {
  const e = engine(true)
  const layer = newLayer('L')
  const doc = { layers: [layer], backgroundColor: '#ffffff' }
  e.edit(layer.id, (c) => {
    c.fillStyle = '#3080c0'
    c.fillRect(60, 0, 80, H)
  })
  const picture = () => e.render(doc).getContext('2d')!.getImageData(0, 0, W, H).data.slice()
  const before = picture()
  const brush = defaultLibrary().brushes.find((b) => b.id === 'round-brush')!
  e.beginStroke({ layer, brush: { ...brush, size: 20 }, color: '#c03020', symmetry: 'off', erase: false }, pt(20, 80, 1, 0))
  for (let i = 1; i <= 20; i++) e.strokeTo(pt(20 + i * 10, 80 + (i % 2) * 20, 1, i * 8))
  e.render(doc)
  e.endStroke()
  const after = picture()
  e.undo()
  const undone = picture()
  e.redo()
  const redone = picture()
  return [diff('stroke changed the picture (expect > 0)', e.gpuActive, before, after), diff('undo', e.gpuActive, undone, before), diff('redo', e.gpuActive, redone, after)]
}

export async function runSketchGpuCheck(): Promise<{ strokes: GpuDiff[]; adjust: GpuDiff[]; undo: GpuDiff[]; foreign: { stray: number; gpu: boolean } }> {
  gpuAllowSoftware.value = true
  images = { braid: testImage(128, 48), bead: testImage(32, 32) }
  await Promise.all([loadImageMask(images.braid), loadImageMask(images.bead)])
  // Brush tips and grains that are images load in the background: paint once first.
  for (const id of ['bristle-brush', 'grit', 'thick-paint']) stroke(id, false, 'paint')
  await new Promise((r) => setTimeout(r, 1000))
  const cases: [string, 'paint' | 'erase' | 'smudge'][] = [
    ['round-brush', 'paint'],
    ['pixel-pen', 'paint'],
    ['bristle-brush', 'paint'],
    ['thick-paint', 'paint'],
    ['watercolor-splatter', 'paint'],
    ['ribbon', 'paint'],
    ['wet-round', 'paint'],
    ['soft-blender', 'smudge'],
    ['hard-eraser', 'erase'],
    ['ribbon-shaded-caps', 'paint'],
    ['stamps-shaded', 'paint'],
    ['rope', 'paint'],
    ['box-braid', 'paint'],
    ['oak-leaves', 'paint'],
    ['outline-marker', 'paint'],
    ['ink-fill', 'paint'],
    ['bubble-outline', 'paint'],
  ]
  const strokes = cases.map(([id, mode]) => {
    const g = stroke(id, true, mode)
    return diff(`${id} (${mode})`, g.gpu, g.px, stroke(id, false, mode).px)
  })
  const adjust = (['hsb', 'balance', 'curves', 'gradient'] as const).map((id) => {
    const g = adjusted(id, true)
    return diff(id, g.gpu, g.px, adjusted(id, false).px)
  })
  for (const [mode, extra] of [[0, {}], [1, { keepColour: 1 }], [2, { reach: 0.1, soft: 0.6, amount: 0.8 }]] as [number, Record<string, number>][]) {
    const values = defaultValues('valueAlpha', W, H)
    const d = filtered('valueAlpha', { ...values, key: '#e08040', v: { ...values.v, mode, ...extra } })
    if (d) adjust.push({ ...d, name: `${d.name}, mode ${mode}` })
  }
  const outlines: GpuDiff[] = []
  for (const name of Object.keys(OUTLINES)) {
    const g = outlined(name, true)
    const c = outlined(name, false)
    // The strokes themselves differ a little at their edges (see above), so the engines are compared on the same pixels.
    outlines.push(diff(`outline ${name}: GPU vs Canvas 2D, same pixels`, g.gpu, g.fresh, g.other), diff(`outline ${name}: GPU live vs from scratch`, g.gpu, g.px, g.fresh), diff(`outline ${name}: Canvas 2D live vs from scratch`, true, c.px, c.fresh))
  }
  // ASCII layers: live painting must match working it out from scratch exactly; GPU and Canvas 2D average the cells
  // with different rounding (8-bit on the GPU), so a few letters may differ there.
  for (const [name, v] of [['plain', {}], ['edges + pattern', { edges: 0.8, dither: 1 }], ['spread + background', { dither: 2, paper: 1 }], ['braille + background', { set: 4, paper: 1 }], ['lines only', { set: 5 }], ['your text', { set: 6 }], ['sign brushes', { scatter: 0.3 }]] as [string, Record<string, number>][]) {
    const marks: Record<string, AsciiMark> | undefined = name === 'sign brushes' ? { '64,32': { s: '_' }, '72,32': { s: '(' }, '0,0': { d: 3, c: '#00aa00' }, '160,64': { d: -2 } } : undefined
    const g = asciiLayer(true, v, marks)
    const c = asciiLayer(false, v, marks)
    outlines.push(diff(`ascii ${name}: GPU live vs from scratch`, g.gpu, g.px, g.fresh), diff(`ascii ${name}: Canvas 2D live vs from scratch`, true, c.px, c.fresh))
    strokes.push(diff(`ascii ${name}: GPU vs Canvas 2D, same pixels`, g.gpu, g.fresh, g.other))
  }
  const g = moved(true)
  return { strokes: [...strokes, diff('Move tool (turned and moved)', g.gpu, g.px, moved(false).px)], adjust: [...adjust, ...outlines], undo: undoRoundTrip(), foreign: foreignPixels() }
}
