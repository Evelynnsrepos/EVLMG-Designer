import { newId, type Id } from '@/core/model'

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

export interface LevelDoc {
  width: number
  height: number
  /** "x,y" → tile. */
  tiles: Record<string, TileId>
  notes: Note[]
  /** v0.13: tileset images (atlases), cut into square tiles like a Godot TileSet. */
  tilesets?: Tileset[]
  /** v0.13: "x,y" → "set:column:row", the picture tile painted there (drawn under the plan tiles' symbols). */
  art?: Record<string, string>
  /** v0.14: cells blocked by hand ("x,y"), on top of tiles that block movement by themselves. */
  blocked?: Record<string, true>
}

export interface Tileset {
  id: Id
  name: string
  image: string
  /** Size of one tile in the image, in pixels. */
  tileSize: number
  columns: number
  rows: number
  /** The image's size in pixels, to work out columns and rows when the tile size changes. */
  width: number
  height: number
  /** v0.14: tiles that block movement (fences, house walls), as "column:row". */
  solid?: string[]
}

export const artKey = (set: number, col: number, row: number) => `${set}:${col}:${row}`
export const parseArt = (v: string) => {
  const [set, col, row] = v.split(':').map(Number)
  return { set, col, row }
}

export const createLevelDoc = (): LevelDoc => ({ width: 40, height: 28, tiles: {}, notes: [] })
export const cellKey = (x: number, y: number) => `${x},${y}`
export const tileColor = (t: TileId) => TILES.find((x) => x.id === t)?.color ?? '#888'
export const newNote = (x: number, y: number): Note => ({ id: newId(), x, y, text: '' })

/** A room: floor inside, walls around it; existing doors in the wall line stay. */
export function room(d: LevelDoc, x1: number, y1: number, x2: number, y2: number): Record<string, TileId> {
  const [ax, bx] = [Math.min(x1, x2), Math.max(x1, x2)]
  const [ay, by] = [Math.min(y1, y2), Math.max(y1, y2)]
  const tiles = { ...d.tiles }
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++) {
      const edge = x === ax || x === bx || y === ay || y === by
      const k = cellKey(x, y)
      if (edge) tiles[k] = tiles[k] === 'door' ? 'door' : 'wall'
      else tiles[k] = 'floor'
    }
  return tiles
}

/** Fill the connected area of the same tile (or empty) starting at x,y. */
export function bucket<T extends string = TileId>(d: Pick<LevelDoc, 'width' | 'height'> & { tiles: Record<string, T> }, x: number, y: number, tile: T | null): Record<string, T> {
  const tiles = { ...d.tiles }
  const from = tiles[cellKey(x, y)] ?? null
  if (from === tile) return tiles
  const stack = [[x, y]]
  let n = 0
  while (stack.length && n < 20000) {
    const [cx, cy] = stack.pop()!
    if (cx < 0 || cy < 0 || cx >= d.width || cy >= d.height) continue
    const k = cellKey(cx, cy)
    if ((tiles[k] ?? null) !== from) continue
    if (tile) tiles[k] = tile
    else delete tiles[k]
    n++
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

/** True when nothing can walk on cell x,y: blocked by hand, or painted with a tile that blocks movement (v0.14). */
export function isBlocked(d: LevelDoc, x: number, y: number): boolean {
  const k = cellKey(x, y)
  if (d.blocked?.[k]) return true
  const v = d.art?.[k]
  if (!v) return false
  const a = parseArt(v)
  return !!d.tilesets?.[a.set]?.solid?.includes(`${a.col}:${a.row}`)
}

/**
 * The level as a Godot 4 scene: a TileMap with one TileSet atlas source per tileset image (v0.13).
 * Cells use TileMap format 2: three int32 per cell, holding x and y, the source and atlas column,
 * and the atlas row and alternative tile (0). `imagePath(i)` is where tileset `i` lies in the Godot project.
 */
export function godotScene(d: LevelDoc, name: string, imagePath: (i: number) => string): string {
  const sets = d.tilesets ?? []
  const lines = [`[gd_scene load_steps=${sets.length * 2 + 2} format=3]`, '']
  sets.forEach((_, i) => lines.push(`[ext_resource type="Texture2D" path="${imagePath(i)}" id="${i + 1}"]`))
  lines.push('')
  sets.forEach((t, i) => {
    lines.push(`[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_${i}"]`, `texture = ExtResource("${i + 1}")`, `texture_region_size = Vector2i(${t.tileSize}, ${t.tileSize})`)
    const h = t.tileSize / 2
    for (let row = 0; row < t.rows; row++)
      for (let col = 0; col < t.columns; col++) {
        lines.push(`${col}:${row}/0 = 0`)
        // v0.14: tiles that block movement get a full-tile collision shape.
        if (t.solid?.includes(`${col}:${row}`)) lines.push(`${col}:${row}/0/physics_layer_0/polygon_0/points = PackedVector2Array(${-h}, ${-h}, ${h}, ${-h}, ${h}, ${h}, ${-h}, ${h})`)
      }
    lines.push('')
  })
  const size = sets[0]?.tileSize ?? 16
  const handBlocked = Object.keys(d.blocked ?? {}).map((k) => k.split(',').map(Number))
  if (handBlocked.length) lines.push('[sub_resource type="RectangleShape2D" id="Blocked_1"]', `size = Vector2(${size}, ${size})`, '')
  lines.push('[sub_resource type="TileSet" id="TileSet_1"]', `tile_size = Vector2i(${size}, ${size})`)
  if (sets.some((t) => t.solid?.length)) lines.push('physics_layer_0/collision_layer = 1')
  sets.forEach((_, i) => lines.push(`sources/${i} = SubResource("TileSetAtlasSource_${i}")`))
  const data: number[] = []
  for (const [k, v] of Object.entries(d.art ?? {})) {
    const [x, y] = k.split(',').map(Number)
    const a = parseArt(v)
    if (!sets[a.set]) continue
    data.push(((y << 16) | (x & 0xffff)) | 0, (a.set | (a.col << 16)) | 0, a.row | 0)
  }
  lines.push('', `[node name="${name.replace(/[^\p{L}\p{N}_ ]/gu, '_') || 'Level'}" type="TileMap"]`, 'tile_set = SubResource("TileSet_1")', 'format = 2', `layer_0/tile_data = PackedInt32Array(${data.join(', ')})`, '')
  // Cells blocked by hand: one static body with a square for each.
  if (handBlocked.length) {
    lines.push('[node name="Blocked" type="StaticBody2D" parent="."]', '')
    handBlocked.forEach(([x, y], i) => lines.push(`[node name="Cell${i}" type="CollisionShape2D" parent="Blocked"]`, `position = Vector2(${x * size + size / 2}, ${y * size + size / 2})`, 'shape = SubResource("Blocked_1")', ''))
  }
  return lines.join('\n')
}
