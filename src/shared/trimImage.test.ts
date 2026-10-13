import { describe, expect, it } from 'vitest'
import { alphaBounds } from './trimImage'

describe('alphaBounds', () => {
  it('finds the drawn box, or null on an empty picture', () => {
    const w = 5
    const h = 4
    const data = new Uint8ClampedArray(w * h * 4)
    expect(alphaBounds(data, w, h)).toBeNull()
    data[(1 * w + 2) * 4 + 3] = 255
    data[(2 * w + 3) * 4 + 3] = 1 // a faint edge pixel counts too
    expect(alphaBounds(data, w, h)).toEqual({ x: 2, y: 1, w: 2, h: 2 })
  })
})
