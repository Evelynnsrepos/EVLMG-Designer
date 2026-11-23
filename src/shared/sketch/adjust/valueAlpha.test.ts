import { describe, expect, it } from 'vitest'
import { valueAlpha, valueAlphaKey } from './cpu'
import { defaultValues } from './filters'

const W: [number, number, number] = [1, 1, 1]
const B: [number, number, number] = [0, 0, 0]

describe('values to opacity', () => {
  it('bright parts: white goes, grey keeps its look over white', () => {
    expect(valueAlpha([1, 1, 1], 1, W, 1)[1]).toBe(0)
    const [c, a] = valueAlpha([0.5, 0.5, 0.5], 1, W, 1)
    expect(a).toBeCloseTo(0.5)
    expect(c[0] * a + 1 * (1 - a)).toBeCloseTo(0.5)
  })
  it('dark parts: black goes, red stays solid red', () => {
    expect(valueAlpha([0, 0, 0], 1, B, 1)[1]).toBe(0)
    expect(valueAlpha([1, 0, 0], 1, B, 1)).toEqual([[1, 0, 0], 1])
  })
  it('strength 0 changes nothing', () => {
    expect(valueAlpha([0.3, 0.6, 0.9], 0.8, W, 0)).toEqual([[0.3, 0.6, 0.9], 0.8])
  })
  it('any colour: the picked colour goes, a mix keeps its look over that colour', () => {
    const k: [number, number, number] = [0.2, 0.8, 0.2]
    expect(valueAlpha(k, 1, k, 1)[1]).toBe(0)
    const c: [number, number, number] = [0.6, 0.5, 0.1]
    const [u, a] = valueAlpha(c, 1, k, 1)
    u.forEach((x, i) => expect(x * a + k[i] * (1 - a)).toBeCloseTo(c[i]))
  })
  it('range and softness: close colours fully go, far ones stay solid', () => {
    expect(valueAlpha([0.9, 0.9, 0.9], 1, W, 1, 0.2, 0.3)[1]).toBe(0)
    expect(valueAlpha([0.3, 0.3, 0.3], 1, W, 1, 0.2, 0.3)[1]).toBe(1)
  })
  it('keep colours only changes opacity', () => {
    const [c, a] = valueAlpha([0.5, 0.5, 0.5], 1, W, 1, 0, 1, 1)
    expect(c).toEqual([0.5, 0.5, 0.5])
    expect(a).toBeCloseTo(0.5)
  })
  it('key colour: white, black or the picked one, white when the picked one is broken', () => {
    const v = defaultValues('valueAlpha', 4, 4)
    expect(valueAlphaKey(v)).toEqual([1, 1, 1])
    expect(valueAlphaKey({ ...v, v: { ...v.v, mode: 1 } })).toEqual([0, 0, 0])
    expect(valueAlphaKey({ ...v, key: '#ff0000', v: { ...v.v, mode: 2 } })).toEqual([1, 0, 0])
    expect(valueAlphaKey({ ...v, key: 'nope', v: { ...v.v, mode: 2 } })).toEqual([1, 1, 1])
    expect(v.v.soft).toBe(1)
  })
})
