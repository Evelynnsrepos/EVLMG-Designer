import { describe, expect, it } from 'vitest'
import { createCalendarDoc, entriesOn, formatYear, fromDayNumber, gameDay, isFullMoon, newDayEntry, newEra, nextDeadline, REAL_WEEKDAYS, realMonths, toDayNumber, weekdayOf, yearLength } from './calendar'

describe('calendar', () => {
  const c = createCalendarDoc()

  it('counts days and converts dates both ways', () => {
    expect(yearLength(c)).toBe(304)
    const n = toDayNumber(c, 3, 2, 5)
    expect(n).toBe(2 * 304 + 60 + 4)
    expect(fromDayNumber(c, n)).toEqual({ year: 3, month: 2, day: 5 })
    expect(fromDayNumber(c, 0)).toEqual({ year: 1, month: 0, day: 1 })
    expect(weekdayOf(c, 7)).toBe(1)
  })

  it('formats years by era', () => {
    expect(formatYear(c, 305)).toBe('305')
    const cal = { ...c, eras: [{ ...newEra(1), abbr: 'FA' }, { ...newEra(500), abbr: 'SA' }] }
    expect(formatYear(cal, 305)).toBe('305 FA')
    expect(formatYear(cal, 512)).toBe('13 SA')
    expect(formatYear(cal, -9)).toBe('10 before FA')
  })
})

describe('calendar games', () => {
  const base = createCalendarDoc()
  const c = { ...base, months: realMonths(), weekdays: REAL_WEEKDAYS, gameStart: { year: 1, month: 3, day: 7 }, gameEnd: { year: 1, month: 11, day: 31 } }

  it('finds entries, weekly and yearly repeats', () => {
    const once = { ...newDayEntry({ year: 1, month: 3, day: 10 }), title: 'Exam' }
    const weekly = { ...newDayEntry({ year: 1, month: 3, day: 8 }), repeat: 'weekly' as const }
    const yearly = { ...newDayEntry({ year: 1, month: 0, day: 1 }), repeat: 'yearly' as const }
    const cal = { ...c, entries: [once, weekly, yearly] }
    expect(entriesOn(cal, toDayNumber(cal, 1, 3, 10))).toEqual([once])
    expect(entriesOn(cal, toDayNumber(cal, 1, 3, 15))).toEqual([weekly])
    expect(entriesOn(cal, toDayNumber(cal, 1, 3, 1))).toEqual([])
    expect(entriesOn(cal, toDayNumber(cal, 2, 0, 1))).toEqual([yearly])
  })

  it('counts game days, deadlines and full moons', () => {
    const n = toDayNumber(c, 1, 3, 7)
    expect(gameDay(c, n)).toEqual({ day: 1, of: 269 })
    expect(gameDay(c, n - 1)).toBeNull()
    const dl = { ...newDayEntry({ year: 1, month: 4, day: 6 }), kind: 'deadline' as const }
    expect(nextDeadline({ ...c, entries: [dl] }, n)?.daysLeft).toBe(29)
    const moon = { ...c, moonCycle: 30, fullMoonDay: n }
    expect(isFullMoon(moon, n + 30)).toBe(true)
    expect(isFullMoon(moon, n + 31)).toBe(false)
  })
})
