// Draw's GPU engine against its Canvas 2D engine, in a real browser (WebGL2 through SwiftShader).
// Skipped when no Chrome/Chromium is found, unless MATERIAL_GPU_TEST=required (CI sets that).
import type { Browser } from 'playwright-core'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchTestBrowser } from '../testBrowser'
import type { GpuDiff } from './gpuCheck'

let browser: Browser | null = null
let server: ViteDevServer | null = null

beforeAll(async () => {
  browser = await launchTestBrowser()
  if (!browser) {
    if (process.env.MATERIAL_GPU_TEST === 'required') throw new Error('No Chrome/Chromium found for the Draw GPU test')
    return
  }
  server = await createServer({ server: { port: 0, strictPort: false, hmr: false }, logLevel: 'silent', clearScreen: false })
  await server.listen()
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

describe('Draw on the GPU', () => {
  it('paints and blends like Canvas 2D', async (ctx) => {
    if (!browser || !server) return ctx.skip()
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(server.resolvedUrls!.local[0] + 'sketch-gpu-check')
    await page.addScriptTag({ type: 'module', content: "import { runSketchGpuCheck } from '/src/shared/sketch/gpuCheck.ts'; window.runSketchGpuCheck = runSketchGpuCheck" })
    await page.waitForFunction(() => 'runSketchGpuCheck' in window, null, { timeout: 60_000 })
    const { strokes, adjust } = (await page.evaluate(() => (window as unknown as { runSketchGpuCheck: () => unknown }).runSketchGpuCheck())) as { strokes: GpuDiff[]; adjust: GpuDiff[] }
    expect(errors).toEqual([])
    if (process.env.SKETCH_GPU_LOG) console.table([...strokes, ...adjust])
    for (const d of [...strokes, ...adjust]) expect(d.gpu, `${d.name} ran on the GPU`).toBe(true)
    // Strokes: the two rasterizers round dab edges differently, so a few edge pixels differ; on average it's the same paint.
    for (const d of strokes) expect(d.mean, d.name).toBeLessThan(1.5)
    for (const d of adjust) expect(d.max, d.name).toBeLessThanOrEqual(2)
  }, 300_000)
})
