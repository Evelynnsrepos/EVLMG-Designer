import { defaultLibrary } from './brushDefaults'
import { SketchEngine } from './engine'
import { canvas2dFirst } from './gl'
import { newLayer, type SketchLayer } from './model'

/**
 * Drawing speed test (0.24): plays the same pen stroke on test pictures and times each pen move
 * (paint + blend the layers), so speed fixes can be compared before and after on each computer.
 */

export interface GpuInfo {
  renderer: string
  /** The picture is drawn without the graphics card (llvmpipe and the like). */
  software: boolean
  webgl2: boolean
}

export function gpuInfo(): GpuInfo {
  const c = document.createElement('canvas')
  const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null
  if (!gl) return { renderer: 'No WebGL', software: true, webgl2: false }
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return { renderer, software: isSoftwareRenderer(renderer), webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext }
}

export const isSoftwareRenderer = (renderer: string) => /llvmpipe|softpipe|swiftshader|software|swrast/i.test(renderer)

export interface BenchCase {
  name: string
  width: number
  height: number
  layers: number
  /** A layer blend mode Canvas 2D doesn't have, so the GPU path runs. */
  specialBlend?: boolean
}

export const BENCH_CASES: BenchCase[] = [
  { name: 'Full HD, 3 layers', width: 1920, height: 1080, layers: 3 },
  { name: '4000 × 4000, 10 layers', width: 4000, height: 4000, layers: 10 },
  { name: '4000 × 4000, 10 layers, Linear burn', width: 4000, height: 4000, layers: 10, specialBlend: true },
]

export interface BenchResult {
  name: string
  avgMs: number
  p95Ms: number
  /** Pen moves slower than one frame at 60 Hz. */
  slow: number
  moves: number
}

/** The same zigzag stroke every time: `n` pen moves of 4 points each across the middle of the picture. */
export function benchPath(width: number, height: number, n: number) {
  const out: { x: number; y: number; pressure: number }[][] = []
  for (let i = 0; i < n; i++) {
    const move = []
    for (let k = 0; k < 4; k++) {
      const t = (i * 4 + k) / (n * 4)
      move.push({ x: width * (0.2 + 0.6 * t), y: height * (0.5 + 0.25 * Math.sin(t * Math.PI * 8)), pressure: 0.5 + 0.5 * Math.sin(t * Math.PI * 3) ** 2 })
    }
    out.push(move)
  }
  return out
}

export function summarize(name: string, times: number[]): BenchResult {
  const sorted = [...times].sort((a, b) => a - b)
  const avg = times.reduce((s, t) => s + t, 0) / Math.max(1, times.length)
  return { name, avgMs: avg, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0, slow: times.filter((t) => t > 16.7).length, moves: times.length }
}

const nextTask = () => new Promise((r) => setTimeout(r, 0))

export async function runBenchCase(c: BenchCase, moves = 150): Promise<BenchResult> {
  const engine = new SketchEngine(c.width, c.height)
  const layers: SketchLayer[] = Array.from({ length: c.layers }, (_, i) => ({ ...newLayer(`Layer ${i + 1}`), blend: c.specialBlend && i === 1 ? 'linear-burn' : 'source-over' }))
  // Some paint on every layer, so blending has real pixels to work with.
  layers.forEach((l, i) =>
    engine.edit(l.id, (ctx) => {
      ctx.fillStyle = `hsla(${i * 36}, 70%, 50%, 0.5)`
      ctx.fillRect((c.width * i) / (c.layers * 2), 0, c.width / 2, c.height)
    }),
  )
  const doc = { layers, backgroundColor: '#ffffff' }
  engine.render(doc)
  const brush = defaultLibrary().brushes.find((b) => b.id === 'round-brush')!
  const path = benchPath(c.width, c.height, moves)
  const active = layers[layers.length - 1]
  engine.beginStroke({ layer: active, brush: { ...brush, size: 40 }, color: '#203040', symmetry: 'off', erase: false }, path[0][0])
  const times: number[] = []
  for (const move of path) {
    const t0 = performance.now()
    for (const p of move) engine.strokeTo(p)
    engine.render(doc)
    times.push(performance.now() - t0)
    // Lets the window repaint between moves, like real drawing (not timed).
    await nextTask()
  }
  engine.cancelStroke()
  return summarize(c.name, times)
}

/** Everything as plain text, to paste into a bug report or chat. */
export function benchReport(gpu: GpuInfo, results: BenchResult[]): string {
  return [
    `Graphics: ${gpu.renderer}${gpu.software ? ' (software, no graphics card)' : ''}${gpu.webgl2 ? '' : ', no WebGL2'}`,
    `Blending: ${canvas2dFirst.value ? 'Canvas 2D first (Linux)' : 'GPU'}`,
    `Browser engine: ${navigator.userAgent}`,
    ...results.map((r) => `${r.name}: ${r.avgMs.toFixed(1)} ms average, ${r.p95Ms.toFixed(1)} ms slowest 5%, ${r.slow} of ${r.moves} moves over 16.7 ms`),
  ].join('\n')
}
