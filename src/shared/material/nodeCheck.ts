// Shared by the node tests: puts one library node in a small graph with test pictures on its inputs,
// renders it and measures whether the result tiles.
import { createGen, type Gen, GenContext, GenGraph } from './gen'
import { mmLibrary } from './library'
import { fragmentSource, type MaterialRenderer, ShaderError } from './render'

// What feeds each input type in the test: a tiling noise for pictures, a circle for shapes.
const TEST_SOURCES: Record<string, string> = { f: 'perlin', rgb: 'perlin_color', rgba: 'perlin_color', sdf2d: 'sdcircle', fill: 'fill2' }
const PICTURE_TYPES = ['f', 'rgb', 'rgba', 'sdf2d', 'fill']

/** The node inside a test graph, plus the output that gets rendered. */
export function testNode(id: string): { gen: Gen; output: number } {
  const probe = createGen({ type: id, name: id, parameters: {}, node_position: { x: 0, y: 0 } }, mmLibrary)!
  const inputs = probe.getInputDefs()
  const nodes: object[] = [{ name: 'node', type: id, parameters: {}, node_position: { x: 0, y: 0 } }]
  const connections: object[] = []
  inputs.forEach((input, i) => {
    const src = TEST_SOURCES[input.type]
    const readsTexture = JSON.stringify(mmLibrary.get(id)).includes(`$${input.name}.texture`)
    // only the first input gets a test picture (plus inputs read as textures); the rest keep their defaults,
    // since the same picture on every input makes nodes like Levels divide by zero
    if (!src || (i > 0 && !readsTexture)) return
    const name = `src${i}`
    nodes.push({ name, type: src, parameters: {}, node_position: { x: -200, y: i * 100 } })
    // the fill node needs a mask to fill
    if (src === 'fill2') {
      nodes.push({ name: `${name}_mask`, type: 'perlin', parameters: {}, node_position: { x: -400, y: i * 100 } })
      connections.push({ from: `${name}_mask`, from_port: 0, to: name, to_port: 0 })
    }
    // nodes that read their input's texture directly need a buffer in front
    if (readsTexture) {
      nodes.push({ name: `${name}_buffer`, type: 'buffer', parameters: { size: 7 }, node_position: { x: -100, y: i * 100 } })
      connections.push({ from: name, from_port: 0, to: `${name}_buffer`, to_port: 0 })
      connections.push({ from: `${name}_buffer`, from_port: 0, to: 'node', to_port: i })
    } else connections.push({ from: name, from_port: 0, to: 'node', to_port: i })
  })
  const graph = new GenGraph(mmLibrary)
  graph.deserialize({ nodes, connections, label: 'test' })
  const gen = graph.child('node')!
  const output = gen.getOutputDefs().findIndex(o => PICTURE_TYPES.includes(o.type))
  return { gen, output }
}

/** The fragment shader of the node's final pass (no GPU needed). */
export function testShader(id: string): string {
  const { gen, output } = testNode(id)
  return fragmentSource(gen.getShaderCode('uv', output, new GenContext()))
}

export interface NodeCheck {
  id: string
  error?: string
  /** Wrap-around difference at the left/right and top/bottom edges, relative to neighbouring pixels inside. */
  seam?: number
  tiles?: boolean
  finite?: boolean
}

/**
 * Seam score: the change across the wrap-around edge divided by the biggest change between two neighbouring
 * columns (or rows) inside the picture. A tiling picture's edge is no harsher than its inside, so it scores 1 or less.
 */
export function seamScore(pixels: Float32Array, size: number): number {
  const at = (x: number, y: number, c: number) => pixels[(y * size + x) * 4 + c]
  // mean change between column a and b (rows when `rows` is true)
  const diff = (a: number, b: number, rows: boolean) => {
    let d = 0
    for (let i = 0; i < size; i++) for (let c = 0; c < 4; c++) d += Math.abs(rows ? at(i, a, c) - at(i, b, c) : at(a, i, c) - at(b, i, c))
    return d / size
  }
  let worst = 0
  for (const rows of [false, true]) {
    let inner = 0
    for (let i = 0; i + 1 < size; i++) inner = Math.max(inner, diff(i, i + 1, rows))
    worst = Math.max(worst, diff(size - 1, 0, rows) / Math.max(inner, 0.01))
  }
  return worst
}

export function checkNode(id: string, renderer: MaterialRenderer, size = 128): NodeCheck {
  try {
    const { gen, output } = testNode(id)
    const r = renderer.render(gen, output, size)
    const finite = r.pixels.every(Number.isFinite)
    const seam = seamScore(r.pixels, size)
    // shortcut: up to 1.5× the harshest inside change counts as tiling; a gradient's seam scores 50× or more
    return { id, seam, finite, tiles: finite && seam <= 1.5 }
  } catch (e) {
    if (e instanceof ShaderError) {
      const line = +(e.log.match(/ERROR: \d+:(\d+)/)?.[1] ?? 0)
      return { id, error: `${e.message} in: ${e.source.split('\n')[line - 1]?.trim()}` }
    }
    return { id, error: e instanceof Error ? e.message : String(e) }
  }
}
