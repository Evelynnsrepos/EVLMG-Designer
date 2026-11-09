// EXPERIMENTAL: Material Lab is work in progress (docs/MATERIAL-LAB.md); APIs here can still change.
// The Material Maker node files bundled with Material Lab (see mm-nodes/README.md for the source and licence).
import { createGen, type Gen, type Json, type NodeLibrary, UnsupportedNodeError, UNSUPPORTED_PARAMETER_TYPES } from './gen'

const files = import.meta.glob('./mm-nodes/*.mmg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const MULTILINE_KEYS = ['code', 'custom', 'global', 'instance', 'preview_shader', 'template']

/** .mmg files are JSON with code stored as arrays of lines; a few have trailing commas. */
export function parseMmg(text: string): Json {
  const data = JSON.parse(text.replace(/,(\s*[\]}])/g, '$1'))
  const join = (d: Json): Json => {
    if (Array.isArray(d)) return d.map(join)
    if (d && typeof d === 'object') {
      for (const k of Object.keys(d)) d[k] = MULTILINE_KEYS.includes(k) && Array.isArray(d[k]) ? d[k].join('\n') : join(d[k])
    }
    return d
  }
  return join(data)
}

const defs = new Map<string, Json>()
for (const [path, text] of Object.entries(files)) defs.set(path.slice(path.lastIndexOf('/') + 1, -4), parseMmg(text))

export const mmLibrary: NodeLibrary = { get: name => (defs.has(name) ? structuredClone(defs.get(name)) : undefined) }

export interface NodeInfo {
  /** File name without .mmg, the id Material Maker graphs use. */
  id: string
  name: string
  description: string
  outputs: string[]
}

const OUTPUTS_2D = ['f', 'rgb', 'rgba', 'sdf2d', 'fill']

// Nodes that don't work as shipped by Material Maker either, or need a 3D model.
const BROKEN: Record<string, string> = {
  bricks_nontileable: 'calls bricks_rb, which bricks.mmg no longer has',
  brush_triplanar: 'needs a 3D model',
  raymarching_preview: 'a 3D preview of 3D shapes',
}

/** Why a node can't be used yet, or null when it can. */
export function unsupportedReason(id: string): string | null {
  const d = defs.get(id)
  if (!d) return 'not bundled'
  if (BROKEN[id]) return BROKEN[id]
  const walk = (n: Json): string | null => {
    for (const p of n.shader_model?.parameters ?? []) if (UNSUPPORTED_PARAMETER_TYPES.includes(p.type)) return `${p.type} parameter`
    for (const c of n.nodes ?? []) {
      const r = walk(c) ?? (c.type && defs.has(c.type) ? walk(defs.get(c.type)) : null)
      if (r) return r
    }
    return null
  }
  const r = walk(d)
  if (r) return r
  try {
    const gen = createGen(structuredClone(d), mmLibrary)
    if (!gen) return 'not a node'
    const outs = gen.getOutputDefs().map(o => o.type)
    if (!outs.length) return 'no outputs'
    // Material Lab makes flat, tiling textures; the 3D shape and 3D texture nodes come later
    if (!outs.some(t => OUTPUTS_2D.includes(t))) return '3D only'
  } catch (e) {
    if (e instanceof UnsupportedNodeError) return e.message
    throw e
  }
  return null
}

/** Every bundled node Material Lab can run, sorted by name. */
export function listNodes(): NodeInfo[] {
  const out: NodeInfo[] = []
  for (const [id, d] of defs) {
    if (unsupportedReason(id)) continue
    const sm = d.shader_model ?? {}
    out.push({
      id,
      name: sm.name ?? d.label ?? id,
      description: sm.longdesc ?? d.longdesc ?? sm.shortdesc ?? d.shortdesc ?? '',
      outputs: (createGen(structuredClone(d), mmLibrary) as Gen).getOutputDefs().map(o => o.type),
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** A fresh node of the given library id, with its default values. */
export function createNode(id: string): Gen {
  const d = mmLibrary.get(id)
  if (!d) throw new Error(`Unknown node ${id}`)
  const gen = createGen({ type: id, name: id, parameters: {}, node_position: { x: 0, y: 0 } }, mmLibrary)
  if (!gen) throw new Error(`Not a node: ${id}`)
  return gen
}

export const allNodeIds = () => [...defs.keys()]
