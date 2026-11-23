import { describe, expect, it } from 'vitest'
import { clampLines, createRelationshipsDoc, daysPerRank, moodsOf, newBond, pointsPerDay, rankCost, rankLadder, rankTotals, withMoods } from './model'

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

  it('ranks below zero, decay, cap and own action points', () => {
    const flat = { mode: 'flat' as const, base: 100, step: 0, custom: [] }
    expect(rankLadder({ ranks: 2, minRanks: 2, curve: flat }).map((x) => [x.rank, x.total])).toEqual([[-2, -200], [-1, -100], [0, 0], [1, 100], [2, 200]])
    const d = { ...createRelationshipsDoc(), actions: [{ id: 'a', name: 'Talk', points: 10, perDay: 1 }], giftsPerDay: 0 }
    const b = { ...newBond('c'), curve: flat }
    expect(pointsPerDay({ ...b, decay: 4 }, d)).toBe(6)
    expect(pointsPerDay({ ...b, actionPoints: { a: 30 }, cap: 20 }, d)).toBe(20)
    expect(daysPerRank({ ...b, decay: 10 }, d)[0]).toBe(Infinity)
  })

  it('keeps unlocks inside the ranks and reads old mood points', () => {
    const b = { ...newBond('c'), ranks: 3, minRanks: 0, unlocks: [{ id: 'u', rank: 8, text: '', target: null }], gates: [{ id: 'g', rank: -2, text: '', target: null }] }
    expect(clampLines(b)).toMatchObject({ unlocks: [{ rank: 3 }], gates: [{ rank: 1 }] })
    expect(clampLines({ ...b, minRanks: 1 }).gates![0].rank).toBe(-1)
    const old = { moodPoints: { love: 99, like: 1, neutral: 0, dislike: 0, hate: 0 } }
    expect(moodsOf(old).find((m) => m.id === 'love')!.points).toBe(99)
    const d = withMoods(createRelationshipsDoc(), [{ id: 'x', label: 'Adores', points: 70, color: '#000000' }])
    expect(d.moodPoints).toEqual({ x: 70 })
  })
})
