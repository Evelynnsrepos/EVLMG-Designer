/**
 * The Vector tool's shape maths: VectorCraft's path operations (Rust, `wasm/vector-geom`) as WebAssembly.
 * Load once with `loadGeom()`; after that every call is synchronous and fast enough to run on a click.
 */
import wasmUrl from './geom/vector-geom.wasm?url'
import type { SubPath } from './paths'

/** A path for the maths: SVG path data in its own space plus the matrix that places it in the drawing. */
export interface GeomShape {
  d: string
  /** [a, b, c, d, e, f] like canvas `setTransform`; identity when left out. */
  m?: number[]
  evenodd?: boolean
}

export interface Piece {
  paths: SubPath[]
  /** Indexes of the input shapes the piece came from, front-most last. */
  sources: number[]
}

export type CombineMode = 'unite' | 'minus_front' | 'intersect' | 'exclude' | 'divide'

type Exports = { memory: WebAssembly.Memory; alloc(len: number): number; run(ptr: number, len: number): number; out_len(): number }

let mod: WebAssembly.Module | null = null
let inst: Exports | null = null
let loading: Promise<void> | null = null

/** Compiles the module once. Tests pass the file's bytes; the app fetches it. */
export function loadGeom(bytes?: BufferSource): Promise<void> {
  loading ??= (async () => {
    mod = await WebAssembly.compile(bytes ?? (await (await fetch(wasmUrl)).arrayBuffer()))
    inst = new WebAssembly.Instance(mod).exports as unknown as Exports
  })()
  return loading
}

export const geomReady = () => !!inst

function call(req: object): Piece[] {
  if (!inst || !mod) throw new Error('Shape maths are still loading. Try again in a moment.')
  const bytes = new TextEncoder().encode(JSON.stringify(req))
  let text: string
  try {
    const ptr = inst.alloc(bytes.length)
    new Uint8Array(inst.memory.buffer, ptr, bytes.length).set(bytes)
    const out = inst.run(ptr, bytes.length)
    text = new TextDecoder().decode(new Uint8Array(inst.memory.buffer, out, inst.out_len()))
  } catch {
    // A crash inside the maths leaves the instance unusable; start a fresh one for the next call.
    inst = new WebAssembly.Instance(mod).exports as unknown as Exports
    throw new Error('These shapes could not be combined. Try moving them a little.')
  }
  const r = JSON.parse(text) as { ok?: Piece[]; err?: string }
  if (r.err !== undefined) throw new Error(r.err)
  return r.ok ?? []
}

/** Join / cut out / overlap / remove overlap / split, over shapes listed back to front. */
export const combine = (mode: CombineMode, shapes: GeomShape[]) => call({ op: 'combine', mode, shapes })
/** Every separate area of the shapes (shape builder). */
export const regions = (shapes: GeomShape[]) => call({ op: 'regions', shapes })
/** Grow (delta > 0) or shrink a filled shape. */
export const offset = (shape: GeomShape, delta: number, round: boolean) => call({ op: 'offset', shape, delta, round })[0]
/** The area an outline of `width` covers, as a fillable shape. */
export const outline = (shape: GeomShape, width: number, round: boolean) => call({ op: 'outline', shape, width, round })[0]
/** The anchors of any SVG path data (arcs become curves). */
export const anchorsOf = (shape: GeomShape) => call({ op: 'anchors', shape })[0]
/** Smooth curves through freehand points. */
export const fitCurve = (points: [number, number][], closed: boolean, tolerance: number) => call({ op: 'fit', points, closed, tolerance })[0]
