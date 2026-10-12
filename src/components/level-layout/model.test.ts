import { describe, expect, it } from 'vitest'
import { bucket, counts, createLevelDoc, createLibrary, godotScene, grid, isBlocked, migrateLevel, room, stampCells, stampTileAt, usedTilesets, type LevelDoc } from './model'

describe('level layout', () => {
  it('builds rooms with walls and keeps doors', () => {
    const d = { ...createLevelDoc(), tiles: { '0,1': 'door' as const } }
    const tiles = room(d, 0, 0, 3, 3)
    expect(tiles['0,0']).toBe('wall')
    expect(tiles['1,1']).toBe('floor')
    expect(tiles['0,1']).toBe('door')
    expect(counts({ ...d, tiles })).toEqual({ wall: 11, door: 1, floor: 4 })
  })

  it('fills connected areas only', () => {
    const d = { ...createLevelDoc(), width: 5, height: 5 }
    const walled = { ...d, tiles: room(d, 0, 0, 4, 4) }
    const filled = bucket(walled, 2, 2, 'water')
    expect(counts({ ...walled, tiles: filled }).water).toBe(9)
    expect(filled['0,0']).toBe('wall')
  })
})

describe('Godot export', () => {
  it('writes a TileMap with an atlas per tileset and three numbers per painted cell', () => {
    const old: LevelDoc = { ...createLevelDoc(), layers: undefined, tilesets: [{ id: 't', name: 'Dungeon', image: 'a.png', tileSize: 16, columns: 2, rows: 1, width: 32, height: 16 }], art: { '3,2': '0:1:0' } }
    const { level: d, library } = migrateLevel(old, createLibrary())!
    const scene = godotScene(d, usedTilesets(d, library.tilesets), 'Crypt 1', (i) => `res://egd/levels/tiles_${i}.png`)
    expect(scene).toContain('[ext_resource type="Texture2D" path="res://egd/levels/tiles_0.png" id="1"]')
    expect(scene).toContain('1:0/0 = 0')
    expect(scene).toContain('tile_size = Vector2i(16, 16)')
    // x=3, y=2 → (2 << 16) | 3; source 0, column 1 → 1 << 16; row 0
    expect(scene).toContain(`PackedInt32Array(${(2 << 16) | 3}, ${1 << 16}, 0)`)
    expect(scene).toContain('[node name="Crypt 1" type="TileMap"]')
    expect(scene).not.toContain('physics_layer_0')
  })

  it('gives blocking tiles a collision shape and blocked cells a static body', () => {
    const sets = [{ id: 't', name: 'Town', image: 'a.png', tileSize: 16, columns: 2, rows: 1, width: 32, height: 16, solid: ['1:0'] }]
    const d: LevelDoc = {
      ...createLevelDoc(),
      layers: [{ id: 'g', name: 'Ground', art: { '1,0': 't:0:0' } }, { id: 'f', name: 'Fences', art: { '0,0': 't:1:0' } }],
      blocked: { '5,5': true as const },
    }
    expect(isBlocked(d, sets, 0, 0)).toBe(true)
    expect(isBlocked(d, sets, 1, 0)).toBe(false)
    expect(isBlocked(d, sets, 5, 5)).toBe(true)
    const scene = godotScene(d, sets, 'Town', () => 'res://t.png')
    expect(scene).toContain('physics_layer_0/collision_layer = 1')
    expect(scene).toContain('1:0/0/physics_layer_0/polygon_0/points = PackedVector2Array(-8, -8, 8, -8, 8, 8, -8, 8)')
    expect(scene).not.toContain('0:0/0/physics_layer_0')
    expect(scene).toContain('[node name="Blocked" type="StaticBody2D" parent="."]')
    expect(scene).toContain('position = Vector2(88, 88)')
  })
})

describe('v0.15 tilesets, layers and stamps', () => {
  it('moves old levels: own tilesets into the library, picture tiles into the first layer', () => {
    const old: LevelDoc = { ...createLevelDoc(), layers: undefined, tilesets: [{ id: 'a', name: 'A', image: 'a.png', tileSize: 16, columns: 1, rows: 1, width: 16, height: 16 }], art: { '0,0': '0:0:0', '1,0': '7:0:0' } }
    const m = migrateLevel(old, { tilesets: [{ id: 'a', name: 'A', image: 'a.png', tileSize: 16, columns: 1, rows: 1, width: 16, height: 16 }] })!
    expect(m.library.tilesets).toHaveLength(1)
    expect(m.level.layers![0].art).toEqual({ '0,0': 'a:0:0' })
    expect(m.level.tilesets).toBeUndefined()
    expect(migrateLevel(m.level, m.library)).toBeNull()
  })

  it('cuts tiles with margin and spacing and reports leftover pixels', () => {
    expect(grid({ width: 34, height: 18, tileSize: 16, margin: 1, spacing: 1 })).toEqual({ columns: 2, rows: 1, restX: 0, restY: 1 })
    expect(grid({ width: 40, height: 32, tileSize: 16 })).toMatchObject({ columns: 2, rows: 2, restX: 8, restY: 0 })
  })

  it('paints a stamp from its top left corner, cut off at the edge, and repeats it when filling', () => {
    const s = { set: 's', col: 2, row: 3, w: 2, h: 2 }
    expect(stampCells(s, 0, 0, { width: 10, height: 10 })).toEqual([['0,0', 's:2:3'], ['1,0', 's:3:3'], ['0,1', 's:2:4'], ['1,1', 's:3:4']])
    expect(stampCells(s, 9, 9, { width: 10, height: 10 })).toEqual([['9,9', 's:2:3']])
    expect(stampTileAt(s, 5, 5, 4, 5)).toBe('s:3:3')
    const filled = bucket({ width: 3, height: 1, tiles: {} as Record<string, string> }, 0, 0, (x, y) => stampTileAt(s, 0, 0, x, y), (x) => x === 1)
    expect(filled).toEqual({ '0,0': 's:2:3', '2,0': 's:2:3' })
  })

  it('exports one TileMap layer per picture layer, with margins and spacing', () => {
    const sets = [{ id: 't', name: 'T', image: 'a.png', tileSize: 16, columns: 1, rows: 1, width: 18, height: 18, margin: 1, spacing: 2 }]
    const d: LevelDoc = { ...createLevelDoc(), layers: [{ id: 'g', name: 'Ground', art: { '0,0': 't:0:0' } }, { id: 'f', name: 'Top', hidden: true, art: {} }] }
    const scene = godotScene(d, sets, 'L', () => 'res://t.png')
    expect(scene).toContain('margins = Vector2i(1, 1)')
    expect(scene).toContain('separation = Vector2i(2, 2)')
    expect(scene).toContain('layer_0/name = "Ground"')
    expect(scene).toContain('layer_1/enabled = false')
    expect(scene).toContain('layer_1/tile_data = PackedInt32Array()')
  })
})
