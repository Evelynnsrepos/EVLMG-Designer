import { describe, expect, it } from 'vitest'
import { createLiveOpsDoc, exampleLiveOpsDoc, lanes, passDays, passesOf, passPerVersion, rerunWarnings, shiftWeeks, totalWeeks, versionMilestones, versionStarts, weekDate } from './model'

const example = () => exampleLiveOpsDoc(createLiveOpsDoc())

describe('live-service planner', () => {
  it('a new plan is nearly empty; the example fills it', () => {
    const d = createLiveOpsDoc()
    expect(d.versions).toHaveLength(1)
    expect([d.events, d.banners, d.store, passesOf(d)].every((x) => x.length === 0)).toBe(true)
    expect(passesOf(example())).toHaveLength(1)
  })

  it('versions follow each other and the plan is long enough', () => {
    const d = example()
    expect(versionStarts(d)).toEqual([0, 6])
    expect(totalWeeks(d)).toBe(12)
    expect(weekDate('2027-01-04', 2)).toBe('2027-01-18')
    expect(weekDate('2027-01-04', 3 / 7)).toBe('2027-01-07')
    expect(weekDate('', 2)).toBe('')
  })

  it('warns about reruns too soon', () => {
    const d = example()
    d.banners[0].featured = ['mira']
    d.banners[1].featured = ['mira']
    expect(rerunWarnings(d)).toHaveLength(1)
    expect(rerunWarnings({ ...d, rerunWeeks: 2 })).toHaveLength(0)
  })

  it('battle pass: casual misses it, core finishes', () => {
    const p = passesOf(example())[0]
    expect(passDays(p, 0.5).fits).toBe(false)
    expect(passDays(p, 4).fits).toBe(true)
  })

  it('reads the old single pass and makes one pass per version', () => {
    const old = { ...example(), passes: undefined, pass: { tiers: 10, xpPerTier: 1, xpPerHour: 1, weeks: 6, rewards: [] } }
    const ps = passesOf(old)
    expect(ps).toHaveLength(1)
    expect(ps[0].startWeek).toBe(0)
    const per = passPerVersion(old)
    expect(per.pass).toBeNull()
    expect(passesOf(per).map((p) => p.startWeek)).toEqual([0, 6])
    expect(passPerVersion(per)).toBe(per)
  })

  it('shifts selected items, passes too, never below week 0', () => {
    const d = example()
    const pass = passesOf(d)[0]
    const s = shiftWeeks(d, new Set([d.banners[1].id, d.events[0].id, pass.id]), -5)
    expect(s.banners[1].startWeek).toBe(0)
    expect(s.events[0].startWeek).toBe(0)
    expect(s.banners[0]).toBe(d.banners[0])
    expect(passesOf(shiftWeeks(d, new Set([pass.id]), 2))[0].startWeek).toBe(2)
  })

  it('puts overlapping items on separate lanes', () => {
    const r = lanes([
      { id: 'a', start: 0, length: 3 },
      { id: 'b', start: 1, length: 3 },
      { id: 'c', start: 2, length: 3 },
      { id: 'd', start: 3, length: 1 },
    ])
    expect(r.count).toBe(3)
    expect([r.lane.get('a'), r.lane.get('b'), r.lane.get('c'), r.lane.get('d')]).toEqual([0, 1, 2, 0])
  })

  it('milestones follow renames instead of adding duplicates', () => {
    const d = { ...example(), start: '2027-01-04' }
    const first = versionMilestones(d, [])
    expect(first.milestones.map((m) => m.date)).toEqual(['2027-01-04', '2027-02-15'])
    const renamed = { ...d, versions: first.versions.map((v, i) => (i === 1 ? { ...v, name: '1.1 Winter' } : v)) }
    const again = versionMilestones(renamed, first.milestones)
    expect(again.milestones.map((m) => m.name)).toEqual(['1.0 Launch', '1.1 Winter'])
    // An older run made a milestone of the same name with its own id: adopt it, keep its typed date without a launch date.
    const adopt = versionMilestones({ ...example(), start: '' }, [{ id: 'm1', name: '1.1', date: '2027-03-01' }])
    expect(adopt.milestones).toHaveLength(2)
    expect(adopt.milestones[0]).toEqual({ id: 'm1', name: '1.1', date: '2027-03-01' })
    expect(adopt.versions[1].milestoneId).toBe('m1')
  })

  it('counts and moves the rows people add themselves', () => {
    const d = { ...createLiveOpsDoc(), rows: [{ id: 'r', name: 'Collabs', color: '#000', items: [{ id: 'c', name: 'Collab', startWeek: 20, weeks: 3, notes: '' }] }] }
    expect(totalWeeks(d)).toBe(23)
    expect(shiftWeeks(d, new Set(['c']), 2).rows![0].items[0].startWeek).toBe(22)
    expect(shiftWeeks(createLiveOpsDoc(), new Set(['c']), 2).rows).toBeUndefined()
  })
  it('counts and moves the rows people add themselves', () => {
    const d = { ...createLiveOpsDoc(), rows: [{ id: 'r', name: 'Collabs', color: '#000', items: [{ id: 'c', name: 'Collab', startWeek: 20, weeks: 3, notes: '' }] }] }
    expect(totalWeeks(d)).toBe(23)
    expect(shiftWeeks(d, new Set(['c']), 2).rows![0].items[0].startWeek).toBe(22)
    expect(shiftWeeks(createLiveOpsDoc(), new Set(['c']), 2).rows).toBeUndefined()
  })
})
