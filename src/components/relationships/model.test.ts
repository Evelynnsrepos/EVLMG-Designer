import { describe, expect, it } from 'vitest'
import { createRelationshipsDoc, daysPerRank, newBond, pointsPerDay, rankCost, rankTotals } from './model'

describe('relationships', () => {
  it('rank curves', () => {
    expect(rankCost({ mode: 'flat', base: 100, step: 0, custom: [] }, 5)).toBe(100)
    expect(rankCost({ mode: 'linear', base: 100, step: 20, custom: [] }, 3)).toBe(140)
    expect(rankCost({ mode: 'growing', base: 100, step: 10, custom: [] }, 3)).toBe(121)
    expect(rankCost({ mode: 'custom', base: 0, step: 0, custom: [5, 7] }, 4)).toBe(7)
    expect(rankTotals({ ranks: 3, curve: { mode: 'flat', base: 50, step: 0, custom: [] } })).toEqual([50, 100, 150])
  })

  it('loved gifts make the plan faster', () => {
    const d = { ...createRelationshipsDoc(), actions: [{ id: 'a', name: 'Talk', points: 10, perDay: 1 }] }
    const b = { ...newBond('c'), ranks: 2, curve: { mode: 'flat' as const, base: 100, step: 0, custom: [] } }
    expect(pointsPerDay(b, d)).toBe(20) // talk 10 + one neutral gift 10
    expect(daysPerRank(b, d)).toEqual([5, 10])
    const loved = { ...b, gifts: [{ itemId: 'i', mood: 'love' as const }] }
    expect(daysPerRank(loved, d).at(-1)).toBeLessThan(10)
    expect(daysPerRank(b, { ...d, actions: [], giftsPerDay: 0 })[0]).toBe(Infinity)
  })
})
