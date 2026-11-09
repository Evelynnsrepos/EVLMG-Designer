// Runs in the browser for gpu.test.ts: renders every included node on the real GPU.
import { listNodes } from './library'
import { checkNode, type NodeCheck } from './nodeCheck'
import { MaterialRenderer } from './render'

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
