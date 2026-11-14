// EXPERIMENTAL: Material Lab is work in progress (docs/MATERIAL-LAB.md).
// A material: a Material Maker graph whose "Material" node collects the maps (colour, bumps, roughness, ...).
import { type Gen, type Json, GenGraph } from './gen'
import { mmLibrary, parseMmg } from './library'
import type { MaterialRenderer } from './render'

/** What a Material Lab document stores. The graph is Material Maker's .ptex format, so it can be traded with it. */
export interface MaterialDoc {
  graph: Json | null
  /** Gallery id the material started from (for "Back to the original"). */
  from?: string
  /** Random variation from "Surprise me", 0 = as designed. */
  variation?: number
}

export const createMaterialDoc = (): MaterialDoc => ({ graph: null })

/** The maps of a material, in the order of the Material node's inputs. */
export const MAPS = [
  { key: 'albedo', name: 'Colour', pro: 'albedo', type: 'rgb', fallback: [1, 1, 1] },
  { key: 'metallic', name: 'Metal', pro: 'metallic', type: 'f', fallback: [1, 1, 1] },
  { key: 'roughness', name: 'Shininess', pro: 'roughness', type: 'f', fallback: [1, 1, 1] },
  { key: 'emission', name: 'Glow', pro: 'emission', type: 'rgb', fallback: [0, 0, 0] },
  { key: 'normal', name: 'Bumps', pro: 'normal map', type: 'rgb', fallback: [0.5, 0.5, 1] },
  { key: 'ao', name: 'Shadows in cracks', pro: 'ambient occlusion', type: 'f', fallback: [1, 1, 1] },
  { key: 'depth', name: 'Height', pro: 'depth', type: 'f', fallback: [0, 0, 0] },
] as const
export type MapKey = (typeof MAPS)[number]['key']

/** Settings of the Material node every material has; Simple view shows them as sliders. */
export const MATERIAL_SLIDERS = [
  { param: 'roughness', name: 'Roughness', help: 'Low = shiny and wet, high = dull and dry', min: 0, max: 1, def: 1 },
  { param: 'metallic', name: 'Metal', help: 'How much it shines like metal where the material is metal', min: 0, max: 1, def: 1 },
  { param: 'normal', name: 'Bumps', help: 'How deep cracks and bumps look', min: 0, max: 2, def: 1 },
  { param: 'ao', name: 'Shadows in cracks', help: 'How dark the cracks get', min: 0, max: 2, def: 1 },
  { param: 'emission_energy', name: 'Glow', help: 'How bright glowing parts are (lava, lights)', min: 0, max: 4, def: 1 },
] as const

const MATERIAL_TYPES = ['material', 'material_unlit', 'material_dynamic', 'material_3d', 'material_raymarching', 'material_tesselated', 'material_dynamic_sky']

/** The Material node of a graph (or undefined). */
export const materialNode = (graph: Json): Json | undefined => graph?.nodes?.find((n: Json) => MATERIAL_TYPES.includes(n.type))

/** Number value of a Material node setting, or its default. */
export function materialParam(graph: Json, param: string): number {
  const v = materialNode(graph)?.parameters?.[param]
  return typeof v === 'number' ? v : (MATERIAL_SLIDERS.find(s => s.param === param)?.def ?? 1)
}

/** Tint (albedo_color) of the Material node as [r, g, b]. */
export function materialTint(graph: Json): [number, number, number] {
  const c = materialNode(graph)?.parameters?.albedo_color
  return c ? [c.r ?? 1, c.g ?? 1, c.b ?? 1] : [1, 1, 1]
}

export interface LoadedMaterial {
  graph: GenGraph
  /** Where each map comes from, or null when nothing is plugged in (the fallback colour is used). */
  sources: Record<MapKey, { gen: Gen; output: number } | null>
}

/** Builds the node graph of a material, with the Material node left out (its maps are rendered one by one). */
export function loadMaterial(doc: Json): LoadedMaterial {
  const mat = materialNode(doc)
  const graph = new GenGraph(mmLibrary)
  graph.deserialize({ ...doc, nodes: (doc.nodes ?? []).filter((n: Json) => n !== mat) })
  const sources = {} as LoadedMaterial['sources']
  MAPS.forEach((m, i) => {
    const c = mat && doc.connections?.find((c: Json) => c.to === mat.name && c.to_port === i)
    const src = c && graph.child(c.from)
    sources[m.key] = src ? (src instanceof GenGraph ? src.getPortSource('gen_outputs', c.from_port) : { gen: src, output: c.from_port }) : null
  })
  return { graph, sources }
}

/** RGBA floats per map (null = not plugged in), size × size, row 0 at the top, never NaN. */
export function renderMaps(renderer: MaterialRenderer, m: LoadedMaterial, size: number, only?: MapKey[]): Partial<Record<MapKey, Float32Array | null>> {
  const out: Partial<Record<MapKey, Float32Array | null>> = {}
  for (const map of MAPS) {
    if (only && !only.includes(map.key)) continue
    const s = m.sources[map.key]
    const px = s ? renderer.render(s.gen, s.output, size).pixels : null
    // a few nodes leave NaN where nothing is hit (Raymarching's background); show the map's empty value there
    if (px) for (let i = 0; i < px.length; i++) if (!Number.isFinite(px[i])) px[i] = i % 4 === 3 ? 1 : map.fallback[i % 4]
    out[map.key] = px
  }
  return out
}

// The gallery: Material Maker's example materials (MIT, see examples/README.md), with everyday names and search words.
const files = import.meta.glob('./examples/*.ptex', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const EXAMPLES: Record<string, Json> = {}
for (const [path, text] of Object.entries(files)) EXAMPLES[path.slice(path.lastIndexOf('/') + 1, -5)] = parseMmg(text)

export interface GalleryEntry {
  id: string
  name: string
  words: string
}

export const GALLERY: GalleryEntry[] = [
  { id: 'bricks', name: 'Bricks', words: 'wall house red' },
  { id: 'improved_brick', name: 'Old bricks', words: 'wall worn dirty old' },
  { id: 'brick_rotated', name: 'Brick paving', words: 'floor path street' },
  { id: 'pile_of_bricks', name: 'Pile of bricks', words: 'rubble ruin' },
  { id: 'stone_wall', name: 'Stone wall', words: 'rock dungeon castle' },
  { id: 'medieval_wall', name: 'Castle wall', words: 'stone medieval dungeon fantasy' },
  { id: 'stylized_wall', name: 'Cartoon wall', words: 'stylized stone toon hand painted' },
  { id: 'tiles', name: 'Tiles', words: 'bathroom kitchen floor' },
  { id: 'floor1', name: 'Stone floor', words: 'dungeon floor slabs old' },
  { id: 'floor2', name: 'Floor tiles', words: 'floor pattern' },
  { id: 'mosaic', name: 'Mosaic', words: 'tiles colourful' },
  { id: 'wooden_floor', name: 'Wooden floor', words: 'planks boards house' },
  { id: 'wood', name: 'Wood', words: 'planks tree bark grain' },
  { id: 'wood_with_blood', name: 'Bloody wood', words: 'horror planks stain' },
  { id: 'rusted_metal', name: 'Rusty metal', words: 'old iron rust' },
  { id: 'metal_pattern', name: 'Metal plates', words: 'sci-fi panel steel' },
  { id: 'metal_pattern_2', name: 'Sci-fi panel', words: 'metal futuristic' },
  { id: 'metal_pattern_3', name: 'Tread plate', words: 'metal floor industrial' },
  { id: 'rock', name: 'Rock', words: 'stone cliff mountain' },
  { id: 'dry_earth', name: 'Dry earth', words: 'cracked desert mud ground dirt' },
  { id: 'grass_with_flowers', name: 'Grass with flowers', words: 'meadow ground nature' },
  { id: 'clump_of_grass', name: 'Grass', words: 'ground nature lawn' },
  { id: 'lava', name: 'Lava', words: 'fire glow volcano hot' },
  { id: 'marble', name: 'Marble', words: 'stone fancy temple' },
  { id: 'paper', name: 'Paper', words: 'parchment old' },
  { id: 'crocodile_skin', name: 'Lizard skin', words: 'scales leather dragon reptile' },
  { id: 'beehive', name: 'Honeycomb', words: 'hexagon bee' },
  { id: 'emmental', name: 'Cheese', words: 'holes food' },
  { id: 'mandala', name: 'Mandala', words: 'pattern ornament' },
  { id: 'splatter', name: 'Paint splatter', words: 'stain mess' },
  { id: 'planet', name: 'Planet', words: 'space globe' },
].filter(e => EXAMPLES[e.id])

/** A fresh copy of a gallery material's graph. */
export const galleryGraph = (id: string): Json | null => (EXAMPLES[id] ? structuredClone(EXAMPLES[id]) : null)

/** An empty material: just the Material node, for people who want to build from nothing. */
export const emptyGraph = (): Json => ({
  type: 'graph', name: 'Material', label: 'Material', node_position: { x: 0, y: 0 }, parameters: {}, connections: [],
  nodes: [{ name: 'Material', type: 'material', node_position: { x: 0, y: 0 }, parameters: {} }],
})

export function searchGallery(q: string): GalleryEntry[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  return GALLERY.filter(e => words.every(w => `${e.name} ${e.words}`.toLowerCase().includes(w)))
}
