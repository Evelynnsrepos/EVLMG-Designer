import { newId, type Id } from '@/core/model'
import { godotAlternative, type Tileset, type TileLibrary } from '@/shared/tileset'

export { createLibrary, grid, guessTileSize, LIBRARY_ID, tileRect, type TileLibrary, type Tileset } from '@/shared/tileset'

/** Level / dungeon layout (v0.10): a tile grid with rooms, doors, spawns, loot and numbered notes. */

export const TILES = [
  { id: 'floor', label: 'Floor', color: '#c9b79c' },
  { id: 'wall', label: 'Wall', color: '#4a4a55' },
  { id: 'door', label: 'Door', color: '#a0522d' },
  { id: 'water', label: 'Water', color: '#3e8ef7' },
  { id: 'lava', label: 'Lava', color: '#e8590c' },
  { id: 'grass', label: 'Grass', color: '#5c940d' },
  { id: 'pit', label: 'Pit', color: '#111114' },
  { id: 'stairs', label: 'Stairs', color: '#adb5bd' },
  { id: 'spawn', label: 'Player start', color: '#2f9e44' },
  { id: 'exit', label: 'Exit', color: '#9c36b5' },
  { id: 'enemy', label: 'Enemy', color: '#e03131' },
  { id: 'boss', label: 'Boss', color: '#a61e4d' },
  { id: 'chest', label: 'Chest', color: '#f5a623' },
  { id: 'key', label: 'Key', color: '#fab005' },
  { id: 'trap', label: 'Trap', color: '#f76707' },
  { id: 'npc', label: 'NPC', color: '#0c8599' },
] as const
export type TileId = (typeof TILES)[number]['id']

/** Tiles drawn on top of the floor as a symbol instead of a full square. */
export const MARKERS: Partial<Record<TileId, string>> = { spawn: 'S', exit: 'E', enemy: '!', boss: 'B', chest: '$', key: 'K', trap: '^', npc: '?' }

export interface Note {
  id: Id
  x: number
  y: number
  text: string
}

/** v0.15: a layer of picture tiles; later layers are drawn on top (fences and fountains over the ground). */
export interface ArtLayer {
  id: Id
  name: string
  hidden?: boolean
  /** "x,y" → "tilesetId:column:row". */
  art: Record<string, string>
}

export interface LevelDoc {
  width: number
  height: number
  /** "x,y" → tile. */
  tiles: Record<string, TileId>
  notes: Note[]
  /** v0.15: picture tile layers, bottom first. */
  layers?: ArtLayer[]
  /** v0.14: cells blocked by hand ("x,y"), on top of tiles that block movement by themselves. */
  blocked?: Record<string, true>
  /** v0.16: an isometric level: diamond cells twice as wide as high (32 × 16 tiles). */
  iso?: boolean
  /** v0.13–0.14: the level's own tilesets; v0.15 moves them into the shared library (see migrateLevel). */
  tilesets?: Tileset[]
  /** v0.13–0.14: one layer of picture tiles, "x,y" → "set index:column:row"; becomes layers[0]. */
  art?: Record<string, string>
}

export const artKey = (set: Id, col: number, row: number, flags = 0) => `${set}:${col}:${row}${flags ? `:${flags}` : ''}`
export const parseArt = (v: string) => {
  const [set, col, row, flags] = v.split(':')
  return { set, col: Number(col), row: Number(row), flags: Number(flags) || 0 }
}

export const createLevelDoc = (): LevelDoc => ({ width: 40, height: 28, tiles: {}, notes: [], layers: [newLayer('Ground')] })
export const newLayer = (name: string): ArtLayer => ({ id: newId(), name, art: {} })
export const cellKey = (x: number, y: number) => `${x},${y}`
export const tileColor = (t: TileId) => TILES.find((x) => x.id === t)?.color ?? '#888'
export const newNote = (x: number, y: number): Note => ({ id: newId(), x, y, text: '' })

/**
 * Older levels kept their own tilesets and one picture layer, numbered by tileset position.
 * Moves those tilesets into the shared library (once, by id) and the picture tiles into the first layer.
 */
export function migrateLevel(d: LevelDoc, library: TileLibrary): { level: LevelDoc; library: TileLibrary } | null {
  if (d.layers && !d.tilesets && !d.art) return null
  const own = d.tilesets ?? []
  const known = new Set(library.tilesets.map((t) => t.id))
  const lib = { ...library, tilesets: [...library.tilesets, ...own.filter((t) => !known.has(t.id))] }
  const art: Record<string, string> = {}
  for (const [k, v] of Object.entries(d.art ?? {})) {
    const a = parseArt(v)
    const set = /^\d+$/.test(a.set) ? own[Number(a.set)]?.id : a.set
    if (set) art[k] = artKey(set, a.col, a.row)
  }
  const level: LevelDoc = { ...d, layers: d.layers ?? [{ ...newLayer('Ground'), art }] }
  delete level.tilesets
  delete level.art
  return { level, library: lib }
}

/** A selection of tiles in a tileset: one tile, or a block of them painted as a stamp (v0.15). */
export interface Stamp {
  set: Id
  col: number
  row: number
  w: number
  h: number
}

/** The picture tiles a stamp puts down with its top left corner at x,y, cut off at the level's edges. */
export function stampCells(s: Stamp, x: number, y: number, size: { width: number; height: number }): [string, string][] {
  const out: [string, string][] = []
  for (let dy = 0; dy < s.h; dy++)
    for (let dx = 0; dx < s.w; dx++) {
      if (x + dx < 0 || y + dy < 0 || x + dx >= size.width || y + dy >= size.height) continue
      out.push([cellKey(x + dx, y + dy), artKey(s.set, s.col + dx, s.row + dy)])
    }
  return out
}

/** The stamp's tile for cell x,y when it is repeated across an area that starts at ox,oy (fill). */
export function stampTileAt(s: Stamp, ox: number, oy: number, x: number, y: number): string {
  const mod = (a: number, n: number) => ((a % n) + n) % n
  return artKey(s.set, s.col + mod(x - ox, s.w), s.row + mod(y - oy, s.h))
}

/** 0.24: how a stamp or brush lines up with the level: on the cell under the mouse, or on a grid its own size. */
export type Snap = 'cell' | 'grid'

/**
 * The top left cell of a w × h stamp or brush for the cell p under the mouse (0.24). Stamps hang down-right from p,
 * brushes are centred on it; "grid" puts it on a grid as big as itself that starts at the level's top left.
 */
export function footprint(p: { x: number; y: number }, w: number, h: number, snap: Snap, centred: boolean) {
  if (snap === 'grid') return { x: Math.floor(p.x / w) * w, y: Math.floor(p.y / h) * h }
  return centred ? { x: p.x - Math.floor((w - 1) / 2), y: p.y - Math.floor((h - 1) / 2) } : { x: p.x, y: p.y }
}

/** The copy of a dragged w × h stamp that cell p falls in (0.24): copies sit side by side, starting at the first one. */
export const repeatAt = (first: { x: number; y: number }, p: { x: number; y: number }, w: number, h: number) => ({
  x: first.x + Math.floor((p.x - first.x) / w) * w,
  y: first.y + Math.floor((p.y - first.y) / h) * h,
})

/** Shift held while dragging (0.24): p kept on the line through start, across or down. */
export const straighten = (start: { x: number; y: number }, p: { x: number; y: number }, axis: 'x' | 'y') => (axis === 'x' ? { x: p.x, y: start.y } : { x: start.x, y: p.y })

/**
 * Where cells sit on the canvas (v0.16): a square grid, or isometric diamonds (twice as wide as high,
 * x going down-right and y down-left, like Godot's isometric "diamond down" layout). `s` is a cell's width in px.
 */
export function geometry(iso: boolean | undefined, w: number, h: number, s: number) {
  if (!iso)
    return {
      width: w * s,
      height: h * s,
      cellH: s,
      /** Top left corner of the cell's box. */
      box: (x: number, y: number): [number, number] => [x * s, y * s],
      at: (px: number, py: number) => ({ x: Math.floor(px / s), y: Math.floor(py / s) }),
    }
  const hw = s / 2
  const hh = s / 4
  const ox = h * hw
  return {
    width: (w + h) * hw,
    height: (w + h) * hh,
    cellH: s / 2,
    box: (x: number, y: number): [number, number] => [ox + (x - y) * hw - hw, (x + y) * hh],
    at: (px: number, py: number) => {
      const mx = (px - ox) / hw
      const my = py / hh
      return { x: Math.floor((mx + my) / 2), y: Math.floor((my - mx) / 2) }
    },
  }
}

/** A rectangle of cells, corners included. */
export interface CellRect {
  x0: number
  y0: number
  x1: number
  y1: number
}
export const inRect = (r: CellRect, x: number, y: number) => x >= Math.min(r.x0, r.x1) && x <= Math.max(r.x0, r.x1) && y >= Math.min(r.y0, r.y1) && y <= Math.max(r.y0, r.y1)

/**
 * The current layer's picture tiles in the rectangle moved by dx,dy (0.21: other layers, plan tiles, blocked cells
 * and notes stay where they are); what lands outside the level is dropped.
 */
export function moveRegion(d: LevelDoc, r: CellRect, dx: number, dy: number, layerId: string | undefined): Pick<LevelDoc, 'layers'> {
  const move = <T,>(map: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {}
    const moved: [string, T][] = []
    for (const [k, v] of Object.entries(map)) {
      const [x, y] = k.split(',').map(Number)
      if (!inRect(r, x, y)) out[k] = v
      else if (x + dx >= 0 && y + dy >= 0 && x + dx < d.width && y + dy < d.height) moved.push([cellKey(x + dx, y + dy), v])
    }
    for (const [k, v] of moved) out[k] = v
    return out
  }
  return { layers: (d.layers ?? []).map((l) => (l.id === layerId ? { ...l, art: move(l.art) } : l)) }
}

/** The current layer's picture tiles in the rectangle removed (0.21: like moving, only that layer). */
export function clearRegion(d: LevelDoc, r: CellRect, layerId: string | undefined): Pick<LevelDoc, 'layers'> {
  const keep = <T,>(map: Record<string, T>) => Object.fromEntries(Object.entries(map).filter(([k]) => !inRect(r, ...(k.split(',').map(Number) as [number, number]))))
  return { layers: (d.layers ?? []).map((l) => (l.id === layerId ? { ...l, art: keep(l.art) } : l)) }
}

/**
 * Fill the connected area of the same tile (or empty) starting at x,y.
 * `tile` can depend on the cell, for repeating a stamp; `skip` leaves cells alone (blocked ones).
 */
export function bucket<T extends string = TileId>(
  d: Pick<LevelDoc, 'width' | 'height'> & { tiles: Record<string, T> },
  x: number,
  y: number,
  tile: T | null | ((x: number, y: number) => T),
  skip?: (x: number, y: number) => boolean,
): Record<string, T> {
  const tiles = { ...d.tiles }
  const from = tiles[cellKey(x, y)] ?? null
  if (from === tile) return tiles
  const seen = new Set<string>()
  const stack = [[x, y]]
  while (stack.length && seen.size < 40000) {
    const [cx, cy] = stack.pop()!
    if (cx < 0 || cy < 0 || cx >= d.width || cy >= d.height) continue
    const k = cellKey(cx, cy)
    if (seen.has(k) || (d.tiles[k] ?? null) !== from) continue
    seen.add(k)
    if (!skip?.(cx, cy)) {
      const t = typeof tile === 'function' ? tile(cx, cy) : tile
      if (t) tiles[k] = t
      else delete tiles[k]
    }
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
  }
  return tiles
}

/** How many of each tile there are, e.g. to count enemies and chests. */
export function counts(d: LevelDoc): Partial<Record<TileId, number>> {
  const out: Partial<Record<TileId, number>> = {}
  for (const t of Object.values(d.tiles)) out[t] = (out[t] ?? 0) + 1
  return out
}

/** True when nothing can walk on cell x,y: blocked by hand, or a tile that blocks movement on any layer (v0.14). */
export function isBlocked(d: LevelDoc, sets: Tileset[], x: number, y: number): boolean {
  const k = cellKey(x, y)
  if (d.blocked?.[k]) return true
  return (d.layers ?? []).some((l) => {
    const v = l.art[k]
    if (!v) return false
    const a = parseArt(v)
    return !!sets.find((t) => t.id === a.set)?.solid?.includes(`${a.col}:${a.row}`)
  })
}

/** The library's tilesets this level paints with, in library order. */
export function usedTilesets(d: LevelDoc, sets: Tileset[]): Tileset[] {
  const used = new Set<string>()
  for (const l of d.layers ?? []) for (const v of Object.values(l.art)) used.add(parseArt(v).set)
  return sets.filter((t) => used.has(t.id))
}

/**
 * The level as a Godot 4 scene: a TileMap with one TileSet atlas source per tileset image (v0.13)
 * and one TileMap layer per picture layer (v0.15). Cells use TileMap format 2: three int32 per cell,
 * holding x and y, the source and atlas column, and the atlas row and alternative tile (0).
 * `sets` are the tilesets in source order (see usedTilesets); `imagePath(i)` is where tileset `i` lies in the Godot project.
 */
export function godotScene(d: LevelDoc, sets: Tileset[], name: string, imagePath: (i: number) => string): string {
  const lines = [`[gd_scene load_steps=${sets.length * 2 + 2} format=3]`, '']
  sets.forEach((_, i) => lines.push(`[ext_resource type="Texture2D" path="${imagePath(i)}" id="${i + 1}"]`))
  lines.push('')
  sets.forEach((t, i) => {
    lines.push(`[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_${i}"]`, `texture = ExtResource("${i + 1}")`)
    if (t.margin) lines.push(`margins = Vector2i(${t.margin}, ${t.margin})`)
    if (t.spacing) lines.push(`separation = Vector2i(${t.spacing}, ${t.spacing})`)
    lines.push(`texture_region_size = Vector2i(${t.tileSize}, ${t.tileHeight ?? t.tileSize})`)
    const h = t.tileSize / 2
    // Isometric tiles collide as a diamond, square ones as a square.
    const shape = d.iso ? `PackedVector2Array(${-h}, 0, 0, ${-(t.tileHeight ?? t.tileSize) / 2}, ${h}, 0, 0, ${(t.tileHeight ?? t.tileSize) / 2})` : `PackedVector2Array(${-h}, ${-h}, ${h}, ${-h}, ${h}, ${h}, ${-h}, ${h})`
    for (let row = 0; row < t.rows; row++)
      for (let col = 0; col < t.columns; col++) {
        lines.push(`${col}:${row}/0 = 0`)
        // v0.14: tiles that block movement get a full-tile collision shape.
        if (t.solid?.includes(`${col}:${row}`)) lines.push(`${col}:${row}/0/physics_layer_0/polygon_0/points = ${shape}`)
      }
    lines.push('')
  })
  const size = sets[0]?.tileSize ?? 16
  const sizeH = d.iso ? (sets[0]?.tileHeight ?? size / 2) : size
  const handBlocked = Object.keys(d.blocked ?? {}).map((k) => k.split(',').map(Number))
  if (handBlocked.length) lines.push('[sub_resource type="RectangleShape2D" id="Blocked_1"]', `size = Vector2(${size}, ${sizeH})`, '')
  lines.push('[sub_resource type="TileSet" id="TileSet_1"]')
  // v0.16: isometric levels use Godot's isometric shape with the "diamond down" layout (x down-right, y down-left).
  if (d.iso) lines.push('tile_shape = 1', 'tile_layout = 5')
  lines.push(`tile_size = Vector2i(${size}, ${sizeH})`)
  if (sets.some((t) => t.solid?.length)) lines.push('physics_layer_0/collision_layer = 1')
  sets.forEach((_, i) => lines.push(`sources/${i} = SubResource("TileSetAtlasSource_${i}")`))
  const source = new Map(sets.map((t, i) => [t.id, i]))
  lines.push('', `[node name="${name.replace(/[^\p{L}\p{N}_ ]/gu, '_') || 'Level'}" type="TileMap"]`, 'tile_set = SubResource("TileSet_1")', 'format = 2')
  ;(d.layers ?? []).forEach((l, n) => {
    const data: number[] = []
    for (const [k, v] of Object.entries(l.art)) {
      const [x, y] = k.split(',').map(Number)
      const a = parseArt(v)
      const s = source.get(a.set)
      if (s === undefined) continue
      // Mirrors and turns ride on the alternative tile number, as Godot's transform flags.
      data.push(((y << 16) | (x & 0xffff)) | 0, (s | (a.col << 16)) | 0, (a.row | (godotAlternative(a.flags) << 16)) | 0)
    }
    lines.push(`layer_${n}/name = "${l.name.replace(/"/g, "'")}"`)
    if (l.hidden) lines.push(`layer_${n}/enabled = false`)
    lines.push(`layer_${n}/z_index = ${n}`, `layer_${n}/tile_data = PackedInt32Array(${data.join(', ')})`)
  })
  lines.push('')
  // Cells blocked by hand: one static body with a square for each.
  if (handBlocked.length) {
    lines.push('[node name="Blocked" type="StaticBody2D" parent="."]', '')
    handBlocked.forEach(([x, y], i) =>
      lines.push(`[node name="Cell${i}" type="CollisionShape2D" parent="Blocked"]`, d.iso ? `position = Vector2(${((x - y) * size) / 2}, ${((x + y) * sizeH) / 2})` : `position = Vector2(${x * size + size / 2}, ${y * size + size / 2})`, 'shape = SubResource("Blocked_1")', ''),
    )
  }
  return lines.join('\n')
}
