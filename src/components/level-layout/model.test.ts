import { describe, expect, it } from 'vitest'
import { bucket, counts, createLevelDoc, godotScene, room } from './model'

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
    const d = { ...createLevelDoc(), tilesets: [{ id: 't', name: 'Dungeon', image: 'a.png', tileSize: 16, columns: 2, rows: 1, width: 32, height: 16 }], art: { '3,2': '0:1:0' } }
    const scene = godotScene(d, 'Crypt 1', (i) => `res://egd/levels/tiles_${i}.png`)
    expect(scene).toContain('[ext_resource type="Texture2D" path="res://egd/levels/tiles_0.png" id="1"]')
    expect(scene).toContain('1:0/0 = 0')
    expect(scene).toContain('tile_size = Vector2i(16, 16)')
    // x=3, y=2 → (2 << 16) | 3; source 0, column 1 → 1 << 16; row 0
    expect(scene).toContain(`PackedInt32Array(${(2 << 16) | 3}, ${1 << 16}, 0)`)
    expect(scene).toContain('[node name="Crypt 1" type="TileMap"]')
  })
})
