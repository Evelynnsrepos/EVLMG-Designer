import { describe, expect, it } from 'vitest'
import { createLiveOpsDoc, passDays, rerunWarnings, shiftWeeks, totalWeeks, versionStarts, weekDate } from './model'

describe('live-service planner', () => {
  it('versions follow each other and the plan is long enough', () => {
    const d = createLiveOpsDoc()
    expect(versionStarts(d)).toEqual([0, 6])
    expect(totalWeeks(d)).toBe(12)
    expect(weekDate('2027-01-04', 2)).toBe('2027-01-18')
    expect(weekDate('', 2)).toBe('')
  })

  it('warns about reruns too soon', () => {
    const d = createLiveOpsDoc()
    d.banners[0].featured = ['mira']
    d.banners[1].featured = ['mira']
    expect(rerunWarnings(d)).toHaveLength(1)
    expect(rerunWarnings({ ...d, rerunWeeks: 2 })).toHaveLength(0)
  })

  it('battle pass: casual misses it, core finishes', () => {
    const p = createLiveOpsDoc().pass!
    expect(passDays(p, 0.5).fits).toBe(false)
    expect(passDays(p, 4).fits).toBe(true)
  })

  it('shifts selected items, never below week 0', () => {
    const d = createLiveOpsDoc()
    const s = shiftWeeks(d, new Set([d.banners[1].id, d.events[0].id]), -5)
    expect(s.banners[1].startWeek).toBe(0)
    expect(s.events[0].startWeek).toBe(0)
    expect(s.banners[0]).toBe(d.banners[0])
  })

  it('counts and moves the rows people add themselves', () => {
    const d = { ...createLiveOpsDoc(), rows: [{ id: 'r', name: 'Collabs', color: '#000', items: [{ id: 'c', name: 'Collab', startWeek: 20, weeks: 3, notes: '' }] }] }
    expect(totalWeeks(d)).toBe(23)
    expect(shiftWeeks(d, new Set(['c']), 2).rows![0].items[0].startWeek).toBe(22)
    expect(shiftWeeks(createLiveOpsDoc(), new Set(['c']), 2).rows).toBeUndefined()
  })
})
