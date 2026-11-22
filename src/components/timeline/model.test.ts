import { describe, expect, it } from 'vitest'
import { deleteNodes, duplicateNodes } from '@/shared/canvas'
import {
  addBranch,
  addEvent,
  BRANCH_STUB,
  createDefaultTimeline,
  events,
  layoutCards,
  lineFamily,
  lines,
  mainLine,
  MAIN_LENGTH,
  normalizeTimeline,
  setLineLength,
  snapX,
  xOfYear,
  yearAt,
  yearAxis,
  yearTicks,
} from './model'

const measure = () => 16

function withEvents(xs: number[]) {
  let scene = createDefaultTimeline().scene
  const main = mainLine(scene)!
  const ids: string[] = []
  for (const x of xs) {
    const r = addEvent(scene, main.id, x)
    scene = r.scene
    ids.push(r.event!.id)
  }
  return { scene, main, ids }
}

describe('timeline model (spec 8.1 AC)', () => {
  it('three clicks on the line give three events in order, with no years', () => {
    const { scene } = withEvents([200, 600, 900])
    expect(events(scene).map((e) => e.x)).toEqual([200, 600, 900])
    expect(yearAxis({ startYear: null, endYear: null }, MAIN_LENGTH)).toBeNull()
    expect(yearAxis({ startYear: 100, endYear: null }, MAIN_LENGTH)).toBeNull()
  })

  it('branching at the middle event makes a line that can hold its own events', () => {
    const { scene, main, ids } = withEvents([200, 600, 900])
    const middle = events(scene).find((e) => e.id === ids[1])!
    const b = addBranch(scene, main.id, middle.x)
    const branch = b.branch!
    expect(branch.parentId).toBe(main.id)
    expect(branch.x).toBe(600)
    expect(branch.y).toBeGreaterThan(main.y)
    const withEvent = addEvent(b.scene, branch.id, 800)
    expect(withEvent.event!.lineId).toBe(branch.id)
    // events stay after the branch's curve
    expect(addEvent(b.scene, branch.id, 0).event!.x).toBe(600 + BRANCH_STUB)
  })

  it('places branches of the same parent on free lanes, and allows branches of branches', () => {
    const { scene, main } = withEvents([])
    const a = addBranch(scene, main.id, 300)
    const b = addBranch(a.scene, main.id, 400)
    expect(b.branch!.y).not.toBe(a.branch!.y)
    const c = addBranch(b.scene, a.branch!.id, 500)
    expect(c.branch!.parentId).toBe(a.branch!.id)
    expect(lineFamily(c.scene, a.branch!.id)).toEqual(new Set([a.branch!.id, c.branch!.id]))
  })
})

describe('years (TL-8)', () => {
  const axis = yearAxis({ startYear: -100, endYear: 100 }, 1000)!

  it('maps positions to whole years, negative allowed', () => {
    expect(yearAt(axis, 0)).toBe(-100)
    expect(yearAt(axis, 500)).toBe(0)
    expect(yearAt(axis, 1000)).toBe(100)
    expect(xOfYear(axis, 50)).toBe(750)
    expect(yearAt(axis, snapX(axis, 503))).toBe(1)
  })

  it('picks round tick steps', () => {
    expect(yearTicks(axis)).toEqual([-100, -80, -60, -40, -20, 0, 20, 40, 60, 80, 100])
  })
})

describe('editing', () => {
  it('stretching the main line keeps event years', () => {
    const { scene, main } = withEvents([600])
    const axisBefore = yearAxis({ startYear: 0, endYear: 100 }, main.length)!
    const yearBefore = yearAt(axisBefore, events(scene)[0].x)
    const stretched = setLineLength(scene, main.id, MAIN_LENGTH * 2)
    const m = mainLine(stretched)!
    expect(m.length).toBe(MAIN_LENGTH * 2)
    expect(yearAt(yearAxis({ startYear: 0, endYear: 100 }, m.length)!, events(stretched)[0].x)).toBe(yearBefore)
  })

  it('a line cannot shrink past its events', () => {
    const { scene, main } = withEvents([600])
    const b = addBranch(scene, main.id, 100)
    const withEv = addEvent(b.scene, b.branch!.id, 700).scene
    const short = setLineLength(withEv, b.branch!.id, 10)
    const branch = lines(short).find((l) => l.id === b.branch!.id)!
    expect(branch.x + branch.length).toBeGreaterThan(700)
  })
})

describe('normalizeTimeline', () => {
  it('deleting a branch removes its sub-branches and their events', () => {
    const { scene, main } = withEvents([])
    const a = addBranch(scene, main.id, 300)
    const c = addBranch(a.scene, a.branch!.id, 500)
    const ev = addEvent(c.scene, c.branch!.id, 800)
    const after = normalizeTimeline(deleteNodes(ev.scene, [a.branch!.id]))
    expect(lines(after).map((l) => l.id)).toEqual([main.id])
    expect(events(after)).toHaveLength(0)
  })

  it('turns a duplicated main line into a branch and recreates a missing main', () => {
    const { scene, main } = withEvents([])
    const dup = normalizeTimeline(duplicateNodes(scene, [main.id]).scene)
    expect(lines(dup).filter((l) => l.main)).toHaveLength(1)
    expect(lines(dup).find((l) => !l.main)!.parentId).toBe(main.id)

    const none = normalizeTimeline(deleteNodes(scene, [main.id]))
    expect(mainLine(none)).toBeDefined()
  })

  it('returns the same scene when nothing is wrong', () => {
    const { scene } = withEvents([100, 200])
    expect(normalizeTimeline(scene)).toBe(scene)
  })
})

describe('layoutCards', () => {
  it('lifts a card that would overlap its neighbour', () => {
    const { scene, ids } = withEvents([500, 520, 900])
    const cards = layoutCards(scene, measure, false)
    expect(cards.get(ids[1])!.lift).toBeGreaterThan(cards.get(ids[0])!.lift)
    expect(cards.get(ids[2])!.lift).toBe(cards.get(ids[0])!.lift)
  })
})

describe('linked calendar', () => {
  it('adds, moves and removes events from calendar entries', async () => {
    const { createCalendarDoc, newDayEntry } = await import('@/shared/calendar')
    const { createDefaultTimeline, syncCalendar, events } = await import('./model')
    const a = { ...newDayEntry({ year: 1, month: 0, day: 1 }), title: 'Start' }
    const b = { ...newDayEntry({ year: 1, month: 9, day: 30 }), title: 'End' }
    const weekly = { ...newDayEntry({ year: 1, month: 0, day: 2 }), repeat: 'weekly' as const }
    const cal = { ...createCalendarDoc(), entries: [a, b, weekly] }
    const s1 = syncCalendar(createDefaultTimeline().scene, cal)
    const evs = events(s1).sort((x, y) => x.x - y.x)
    expect(evs.map((e) => e.text)).toEqual(['1 Frostmoon · Start', '30 Darkmoon · End'])
    expect(evs[0].x).toBe(0)
    expect(syncCalendar(s1, cal)).toBe(s1)
    const s2 = syncCalendar(s1, { ...cal, entries: [{ ...a, title: 'Begin' }] })
    expect(events(s2).map((e) => e.text)).toEqual(['1 Frostmoon · Begin'])
  })
})
