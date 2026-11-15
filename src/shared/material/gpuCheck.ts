// Runs in the browser for gpu.test.ts: renders every included node on the real GPU.
import { listNodes } from './library'
import { checkNode, type NodeCheck } from './nodeCheck'
import { MaterialRenderer } from './render'
import { GALLERY, galleryGraph, loadMaterial, renderMaps } from './material'

export function runAll(ids?: string[]): { float: boolean; results: NodeCheck[] } {
  const renderer = new MaterialRenderer()
  // small buffers and few loop rounds keep the software GPU in CI fast; tiling doesn't depend on the buffer size
  renderer.bufferLimit = 128
  const results = (ids ?? listNodes().map(n => n.id)).map(id => {
    // a half-finished fill gives Fill to UV empty areas (divide by zero), so that one runs every round
    renderer.iterationLimit = id === 'fill_to_uv2' ? Infinity : 8
    const t = performance.now()
    const r = checkNode(id, renderer, 64)
    console.log(`${id} ${Math.round(performance.now() - t)}ms seam ${r.seam?.toFixed(2)} ${r.error ?? ''}`)
    return r
  })
  renderer.dispose()
  return { float: renderer.floatTextures, results }
}

/** Renders every map of every gallery material; returns the problems found (empty = all fine). */
export function runGallery(limits = true): string[] {
  const renderer = new MaterialRenderer()
  if (limits) {
    renderer.bufferLimit = 128
    renderer.iterationLimit = 8
  }
  const problems: string[] = []
  for (const e of GALLERY) {
    const t = performance.now()
    try {
      const m = loadMaterial(galleryGraph(e.id))
      for (const [k, px] of Object.entries(renderMaps(renderer, m, 32))) if (px && !px.every(Number.isFinite)) problems.push(`${e.id}: ${k} has NaN`)
    } catch (err) {
      problems.push(`${e.id}: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`)
    }
    console.log(`${e.id} ${Math.round(performance.now() - t)}ms`)
  }
  renderer.dispose()
  return problems
}
