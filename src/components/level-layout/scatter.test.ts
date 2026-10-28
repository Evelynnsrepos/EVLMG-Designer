import { describe, expect, it } from 'vitest'
import { footprint, repeatAt, straighten } from './model'
import { newScatterSet, scatter, unscatter, type ScatterSet } from './scatter'

const all = (w: number, h: number) => {
  const out: [number, number][] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push([x, y])
  return out
}
const base = { art: {}, cells: all(10, 10), seed: 1, size: { width: 10, height: 10 }, allowed: () => true }
const rocks = (patch: Partial<ScatterSet>): ScatterSet => ({ ...newScatterSet('Rocks'), pieces: [{ id: 'a', set: 't', col: 0, row: 0, w: 1, h: 1, weight: 5 }], ...patch })

describe('brush placement', () => {
  it('hangs stamps from the mouse, centres brushes and snaps to a grid of their own size', () => {
    expect(footprint({ x: 5, y: 7 }, 3, 2, 'cell', false)).toEqual({ x: 5, y: 7 })
    expect(footprint({ x: 5, y: 7 }, 3, 3, 'cell', true)).toEqual({ x: 4, y: 6 })
    expect(footprint({ x: 5, y: 7 }, 3, 2, 'grid', false)).toEqual({ x: 3, y: 6 })
  })

  it('puts repeated copies side by side from the first one, both ways', () => {
    const first = { x: 4, y: 4 }
    expect(repeatAt(first, { x: 6, y: 4 }, 3, 1)).toEqual({ x: 4, y: 4 })
    expect(repeatAt(first, { x: 7, y: 4 }, 3, 1)).toEqual({ x: 7, y: 4 })
    expect(repeatAt(first, { x: 3, y: 5 }, 3, 1)).toEqual({ x: 1, y: 5 })
    expect(straighten(first, { x: 9, y: 6 }, 'x')).toEqual({ x: 9, y: 4 })
  })
})

describe('scatter', () => {
  it('puts nothing down at 0 % and covers every allowed cell at 100 % without spacing', () => {
    expect(scatter({ ...base, set: rocks({ amount: 0 }) })).toEqual({})
    const full = scatter({ ...base, set: rocks({ amount: 100, spacing: 0 }), allowed: (x) => x < 5 })
    expect(Object.keys(full)).toHaveLength(50)
    expect(full['4,9']).toBe('t:0:0')
    expect(full['5,0']).toBeUndefined()
  })

  it('is the same for the same seed and different for another', () => {
    const set = rocks({ amount: 30 })
    expect(scatter({ ...base, set })).toEqual(scatter({ ...base, set }))
    expect(scatter({ ...base, set })).not.toEqual(scatter({ ...base, set, seed: 2 }))
  })

  it('keeps the spacing, leaves other tiles alone and puts groups down whole', () => {
    const set = rocks({ amount: 100, spacing: 1, pieces: [{ id: 'b', set: 't', col: 2, row: 0, w: 2, h: 2, weight: 1 }] })
    const art = scatter({ ...base, set, art: { '0,0': 'fence:0:0' } })
    expect(art['0,0']).toBe('fence:0:0')
    const placed = Object.entries(art).filter(([, v]) => v.startsWith('t:'))
    expect(placed.length % 4).toBe(0)
    // Every top left piece of a group has its other three next to it.
    for (const [k] of placed.filter(([, v]) => v === 't:2:0')) {
      const [x, y] = k.split(',').map(Number)
      expect([art[`${x + 1},${y}`], art[`${x},${y + 1}`], art[`${x + 1},${y + 1}`]]).toEqual(['t:3:0', 't:2:1', 't:3:1'])
      // Nothing touches the group, and the fence at 0,0 keeps its gap too.
      expect(art[`${x + 2},${y}`]).toBeUndefined()
      expect(x + y).toBeGreaterThan(1)
    }
    // A 2 × 2 group never sticks out of the area: no left half in the last column.
    for (let y = 0; y < 10; y++) expect(['t:2:0', 't:2:1']).not.toContain(art[`9,${y}`])
  })

  it('takes out only the set’s details', () => {
    const set = rocks({})
    expect(unscatter({ '1,1': 't:0:0', '2,2': 't:1:0', '3,3': 'u:0:0' }, all(10, 10), set)).toEqual({ '2,2': 't:1:0', '3,3': 'u:0:0' })
  })
})
