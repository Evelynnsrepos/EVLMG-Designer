import { describe, expect, it } from 'vitest'
import { hitTest } from './Hotwheel'

describe('Hotwheel hit test', () => {
  it('picks by direction and distance, with halves', () => {
    expect(hitTest(0, -10, 1, 6, 8)).toBeNull() // the centre cancels
    expect(hitTest(0, -60, 1, 6, 8)).toEqual({ ring: 'in', i: 0, half: 1 }) // straight up: slice 0, right half
    expect(hitTest(60, 0, 1, 6, 8)?.i).toBe(2) // right = slice 2 of 6 (90° / 60°, rounded)
    expect(hitTest(0, 400, 1, 6, 8)).toMatchObject({ ring: 'out', i: 4 }) // far down: outer ring, slice 4 of 8
    expect(hitTest(0, 400, 1, 6, 0)).toMatchObject({ ring: 'in', i: 3 }) // no outer ring: the inner one
    expect(hitTest(0, -50, 2, 6, 8)).toBeNull() // twice the size: 50 px is still the centre
  })
})
