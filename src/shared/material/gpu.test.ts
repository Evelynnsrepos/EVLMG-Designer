// Compiles and renders every included Material Maker node in a real browser (WebGL2).
// Needs Chrome or Chromium: set MATERIAL_TEST_BROWSER to its path, or have Chrome installed.
// Skipped when no browser is found, unless MATERIAL_GPU_TEST=required (CI sets that).
import { chromium, type Browser } from 'playwright-core'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NodeCheck } from './nodeCheck'

// Nodes that make a picture that isn't meant to repeat (one shape, a gradient across, a picture that fades out).
// Checked by hand on 2026-11-09; anything new that stops tiling fails the test.
const NOT_TILING = [
  // gradients and one-off shapes across the whole picture
  'gradient', 'circular_gradient', 'spiral_gradient', 'profile', 'sine_wave', 'trimsheet',
  // map the picture around a centre, so the edges can't meet
  'circle_map', 'inverse_circle_map', 'kaleidoscope', 'kaleidoscope2', 'circle_splatter', 'skew',
  // their default second input is a left-to-right / top-to-bottom gradient
  'blend', 'blend2',
  // the test feeds colour noise where a normal map belongs, so the rebuilt height drifts
  'normal2height', 'normal2height_simple',
  // fill helpers: positions and UVs inside each filled area, not a picture of their own
  'fill_preprocess', 'fill_to_gradient2', 'fill_to_uv2',
].sort()

let browser: Browser | null = null
let server: ViteDevServer | null = null

async function launch(): Promise<Browser | null> {
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  const tries = [
    process.env.MATERIAL_TEST_BROWSER && { executablePath: process.env.MATERIAL_TEST_BROWSER },
    { executablePath: '/opt/pw-browsers/chromium' },
    { channel: 'chrome' },
    { channel: 'chromium' },
  ].filter(Boolean) as object[]
  for (const t of tries) {
    try {
      return await chromium.launch({ ...t, args })
    } catch {
      // try the next one
    }
  }
  return null
}

beforeAll(async () => {
  browser = await launch()
  if (!browser) {
    if (process.env.MATERIAL_GPU_TEST === 'required') throw new Error('No Chrome/Chromium found for the Material Lab GPU test')
    return
  }
  server = await createServer({ server: { port: 0, strictPort: false, hmr: false }, logLevel: 'silent', clearScreen: false })
  await server.listen()
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

describe('Material Lab nodes on the GPU', () => {
  it('every included node compiles, renders and tiles', async ctx => {
    if (!browser || !server) return ctx.skip()
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    if (process.env.MATERIAL_GPU_LOG) page.on('console', m => process.stdout.write(m.text() + '\n'))
    await page.goto(server.resolvedUrls!.local[0] + 'material-gpu-check')
    await page.addScriptTag({ type: 'module', content: "import { runAll } from '/src/shared/material/gpuCheck.ts'; window.runAll = runAll" })
    await page.waitForFunction(() => 'runAll' in window, null, { timeout: 60_000 })
    // MATERIAL_GPU_ONLY=a,b checks just those nodes (handy while fixing one)
    const only = process.env.MATERIAL_GPU_ONLY?.split(',')
    const { results } = (await page.evaluate(ids => (window as unknown as { runAll: (ids?: string[]) => unknown }).runAll(ids), only)) as { float: boolean; results: NodeCheck[] }
    expect(errors).toEqual([])
    const failed = results.filter(r => r.error || !r.finite).map(r => `${r.id}: ${r.error ?? 'NaN or infinite pixels'}`)
    expect(failed).toEqual([])
    const notTiling = results.filter(r => !r.tiles).map(r => r.id).sort()
    expect(notTiling).toEqual(NOT_TILING.filter(id => !only || only.includes(id)))
  }, 600_000)
})
