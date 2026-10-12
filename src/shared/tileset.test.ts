import { describe, expect, it } from 'vitest'
import { FLIP_H, godotAlternative, tilePixel, turnFlags } from './tileset'

describe('mirrored and turned tiles', () => {
  it('turns a quarter clockwise: the top left pixel ends up top right', () => {
    const cw = turnFlags(0, 'cw')
    expect(tilePixel(cw, 2, 0, 3)).toEqual([0, 0])
    expect(turnFlags(turnFlags(turnFlags(cw, 'cw'), 'cw'), 'cw')).toBe(0)
    expect(turnFlags(cw, 'ccw')).toBe(0)
  })
  it('mirrors and maps to Godot transform bits', () => {
    expect(tilePixel(FLIP_H, 0, 1, 4)).toEqual([3, 1])
    expect(godotAlternative(turnFlags(0, 'cw'))).toBeGreaterThanOrEqual(4096)
  })
})
