import { describe, expect, it } from 'vitest'
import { valueAlpha } from './cpu'

describe('values to opacity', () => {
  it('bright parts: white goes, grey keeps its look over white', () => {
    expect(valueAlpha([1, 1, 1], 1, 0, 1)[1]).toBe(0)
    const [c, a] = valueAlpha([0.5, 0.5, 0.5], 1, 0, 1)
    expect(a).toBeCloseTo(0.5)
    expect(c[0] * a + 1 * (1 - a)).toBeCloseTo(0.5)
  })
  it('dark parts: black goes, red stays solid red', () => {
    expect(valueAlpha([0, 0, 0], 1, 1, 1)[1]).toBe(0)
    expect(valueAlpha([1, 0, 0], 1, 1, 1)).toEqual([[1, 0, 0], 1])
  })
  it('strength 0 changes nothing', () => {
    expect(valueAlpha([0.3, 0.6, 0.9], 0.8, 0, 0)).toEqual([[0.3, 0.6, 0.9], 0.8])
  })
})
