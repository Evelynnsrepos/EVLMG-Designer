import { defaultValues } from './adjust/filters'
import { defaultLibrary } from './brushDefaults'
import { SketchEngine } from './engine'
import { glAllowed } from './gl'
import { gpuAllowSoftware } from './gpuPaint'
import { newLayer, type InputPoint, type LayerAdjust } from './model'

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

function stroke(brushId: string, gpu: boolean, mode: 'paint' | 'erase' | 'smudge') {
  const brush = defaultLibrary().brushes.find((b) => b.id === brushId)!
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

export async function runSketchGpuCheck(): Promise<{ strokes: GpuDiff[]; adjust: GpuDiff[] }> {
  gpuAllowSoftware.value = true
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
  ]
  const strokes = cases.map(([id, mode]) => {
    const g = stroke(id, true, mode)
    return diff(`${id} (${mode})`, g.gpu, g.px, stroke(id, false, mode).px)
  })
  const adjust = (['hsb', 'balance', 'curves', 'gradient'] as const).map((id) => {
    const g = adjusted(id, true)
    return diff(id, g.gpu, g.px, adjusted(id, false).px)
  })
  return { strokes, adjust }
}
