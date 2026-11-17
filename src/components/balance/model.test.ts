import { describe, expect, it } from 'vitest'
import { curve, outliers, strips, type Point } from './model'

const p = (name: string, value: number, group = 'Common', level?: number): Point => ({ id: name, name, value, group, level })

describe('balance', () => {
  it('flags values far from their group, not across groups', () => {
    const list = [p('a', 10), p('b', 11), p('c', 12), p('d', 10), p('e', 95), p('L1', 100, 'Legendary'), p('L2', 110, 'Legendary'), p('L3', 105, 'Legendary'), p('L4', 98, 'Legendary')]
    const o = outliers(list)
    expect(o.map((x) => x.name)).toEqual(['e'])
    expect(o[0].typical).toBe(11)
  })

  it('finds jumps in the difficulty curve', () => {
    const list = [1, 2, 3, 4, 5, 6].map((l) => p(`lv${l}`, l === 5 ? 400 : 100 * 1.1 ** l, 'x', l))
    const c = curve(list)
    expect(c.levels).toEqual([1, 2, 3, 4, 5, 6])
    expect(c.spikes.map((s) => s.level)).toEqual([5, 6])
  })

  it('builds dot chart rows with the flagged dots marked', () => {
    const rows = strips([p('a', 10), p('b', 11), p('c', 12), p('d', 10), p('e', 95), p('L1', 100, 'Legendary')])
    expect(rows.map((r) => r.group)).toEqual(['Common', 'Legendary'])
    expect(rows[0].median).toBe(11)
    expect(rows[0].dots.filter((d) => d.flag).map((d) => [d.name, d.flag])).toEqual([['e', 'high']])
    expect(rows[1].dots[0].flag).toBe(null)
  })
})
