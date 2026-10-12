import { describe, expect, it } from 'vitest'
import { godotSpriteFrames, sheetJson } from './exports'

describe('pixel art exports', () => {
  const d = { width: 16, height: 8, frames: [{ id: 'a', duration: 100 }, { id: 'b', duration: 250 }, { id: 'c', duration: 100 }], tags: [{ id: 't', name: 'walk', from: 0, to: 2, color: '#fff', loop: 'pingpong' as const }] }
  it('lays out the sheet and its JSON', () => {
    const j = sheetJson(d, 'hero.png')
    expect(j.meta.size).toEqual({ w: 32, h: 16 })
    expect(j.frames[2].frame).toEqual({ x: 0, y: 8, w: 16, h: 8 })
    expect(j.meta.frameTags[0]).toEqual({ name: 'walk', from: 0, to: 2, direction: 'pingpong' })
  })
  it('writes a Godot SpriteFrames resource with one animation per tag', () => {
    const t = godotSpriteFrames(d, 'res://egd/sprites/hero.png')
    expect(t).toContain('region = Rect2(16, 0, 16, 8)')
    expect(t).toContain('"name": &"walk"')
    expect(t).toContain('"duration": 0.250')
    expect(t.match(/AtlasTexture_1"\)/g)).toHaveLength(2)
  })
})
