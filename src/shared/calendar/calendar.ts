import { newId, type Id } from '@/core/model'
import { useDocument } from '@/core/state'

/**
 * Custom calendars and eras (v0.10): the world's months, weekdays and named
 * ages. Shared so the Timeline can show years as "305 TA" instead of 305.
 * Years are whole numbers on one absolute scale, like the Timeline's.
 */

export interface Month {
  id: Id
  name: string
  days: number
}

export interface Era {
  id: Id
  name: string
  /** Short form after the year, e.g. "TA". */
  abbr: string
  /** Absolute year in which this era's year 1 starts. */
  start: number
  color: string
}

/** A day in a calendar game (v0.35, Persona / Metaphor style): story beats, deadlines, free days. */
export const DAY_KINDS = [
  { id: 'story', label: 'Story', color: '#9c36b5' },
  { id: 'deadline', label: 'Deadline', color: '#e03131' },
  { id: 'event', label: 'Event', color: '#3e8ef7' },
  { id: 'free', label: 'Free time', color: '#2f9e44' },
  { id: 'exam', label: 'Exam / test', color: '#f5a623' },
  { id: 'holiday', label: 'Holiday', color: '#c2255c' },
  { id: 'locked', label: 'No free time', color: '#495057' },
] as const
export type DayKind = (typeof DAY_KINDS)[number]['id']

export interface CalendarDate {
  year: number
  /** 0-based month index. */
  month: number
  day: number
}

export interface DayEntry extends CalendarDate {
  id: Id
  title: string
  kind: DayKind
  /** Index into `timeSlots`; -1 or missing = the whole day. */
  slot?: number
  /** Weekly repeats on the same weekday, yearly on the same date. */
  repeat?: 'none' | 'weekly' | 'yearly'
  notes?: string
  /** Show it on linked timelines (default yes; repeats never show). */
  onTimeline?: boolean
}

export interface CalendarDoc {
  months: Month[]
  weekdays: string[]
  eras: Era[]
  /** Weekday (index) of day 1 of year 1. */
  firstWeekday: number
  /** Show era years on timelines. */
  useOnTimeline: boolean
  /** v0.35 calendar games: parts of a day, e.g. Morning, After school, Evening. */
  timeSlots?: string[]
  entries?: DayEntry[]
  /** First and last in-game day, for "day 12 of 300" and countdowns. */
  gameStart?: CalendarDate | null
  gameEnd?: CalendarDate | null
  /** Moon cycle in days (0 = off) and the day number of a full moon. */
  moonCycle?: number
  fullMoonDay?: number
  /** Timeline documents that follow this calendar (their events come from the entries). */
  linkedTimelines?: Id[]
}

const month = (name: string, days: number): Month => ({ id: newId(), name, days })

export function createCalendarDoc(): CalendarDoc {
  return {
    months: [
      month('Frostmoon', 30),
      month('Thawmoon', 30),
      month('Seedmoon', 31),
      month('Bloommoon', 30),
      month('Sunmoon', 31),
      month('Highsun', 30),
      month('Harvest', 31),
      month('Leaffall', 30),
      month('Mistmoon', 30),
      month('Darkmoon', 31),
    ],
    weekdays: ['Moonday', 'Fireday', 'Waterday', 'Earthday', 'Windday', 'Starday'],
    eras: [],
    firstWeekday: 0,
    useOnTimeline: true,
    timeSlots: ['Morning', 'Daytime', 'Evening'],
    entries: [],
    gameStart: null,
    gameEnd: null,
    moonCycle: 0,
    fullMoonDay: 0,
    linkedTimelines: [],
  }
}

/** Real-world months and weekdays (no leap years), for games set in our world. */
export const REAL_MONTHS: [string, number][] = [
  ['January', 31], ['February', 28], ['March', 31], ['April', 30], ['May', 31], ['June', 30],
  ['July', 31], ['August', 31], ['September', 30], ['October', 31], ['November', 30], ['December', 31],
]
export const REAL_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const realMonths = (): Month[] => REAL_MONTHS.map(([n, d]) => month(n, d))

export const newDayEntry = (date: CalendarDate, title = 'New entry'): DayEntry => ({ id: newId(), ...date, title, kind: 'event', slot: -1, repeat: 'none', notes: '', onTimeline: true })

export const dayKindColor = (k: DayKind) => DAY_KINDS.find((x) => x.id === k)?.color

export const dateNumber = (c: CalendarDoc, d: CalendarDate) => toDayNumber(c, d.year, d.month, d.day)

/** Entries on a day, repeats included, sorted by time slot. */
export function entriesOn(c: CalendarDoc, n: number): DayEntry[] {
  const date = fromDayNumber(c, n)
  return (c.entries ?? [])
    .filter((e) => {
      const en = dateNumber(c, e)
      if (en === n) return true
      if (n < en) return false
      if (e.repeat === 'weekly') return c.weekdays.length > 0 && (n - en) % c.weekdays.length === 0
      if (e.repeat === 'yearly') return e.month === date.month && e.day === date.day
      return false
    })
    .sort((a, b) => (a.slot ?? -1) - (b.slot ?? -1))
}

/** "Day 12 of 300" inside the game's span, or null outside / without a start. */
export function gameDay(c: CalendarDoc, n: number): { day: number; of: number | null } | null {
  if (!c.gameStart) return null
  const start = dateNumber(c, c.gameStart)
  const end = c.gameEnd ? dateNumber(c, c.gameEnd) : null
  if (n < start || (end !== null && n > end)) return null
  return { day: n - start + 1, of: end === null ? null : end - start + 1 }
}

/** The next deadline on or after day n, with days left (0 = today). */
export function nextDeadline(c: CalendarDoc, n: number): { entry: DayEntry; daysLeft: number } | null {
  let best: { entry: DayEntry; daysLeft: number } | null = null
  for (const e of c.entries ?? []) {
    if (e.kind !== 'deadline' || e.repeat === 'weekly' || e.repeat === 'yearly') continue
    const left = dateNumber(c, e) - n
    if (left >= 0 && (!best || left < best.daysLeft)) best = { entry: e, daysLeft: left }
  }
  return best
}

/** Is day n a full moon? */
export const isFullMoon = (c: CalendarDoc, n: number) => !!c.moonCycle && c.moonCycle > 0 && (((n - (c.fullMoonDay ?? 0)) % c.moonCycle) + c.moonCycle) % c.moonCycle === 0

/** "7 April" or "7 April, year 3" when the calendar spans more than one year. */
export function formatDate(c: CalendarDoc, d: CalendarDate, withYear = true): string {
  const base = `${d.day} ${c.months[d.month]?.name ?? '?'}`
  return withYear ? `${base}, ${formatYear(c, d.year)}` : base
}

export const newEra = (start: number): Era => ({ id: newId(), name: 'New era', abbr: 'NE', start, color: '#9c36b5' })

export const CALENDAR_DOC = { type: 'calendar' as const, id: 'calendar' }

export function useCalendar() {
  return useDocument<CalendarDoc>(CALENDAR_DOC.type, CALENDAR_DOC.id, createCalendarDoc)
}

export const yearLength = (c: CalendarDoc) => c.months.reduce((s, m) => s + Math.max(0, m.days), 0)

/** The era a year falls in: the latest one that has started. */
export function eraOf(c: CalendarDoc, year: number): Era | undefined {
  return [...c.eras].sort((a, b) => b.start - a.start).find((e) => e.start <= year)
}

/** "305 TA", or "12 before FA" for years before the first era, or the plain number without eras. */
export function formatYear(c: CalendarDoc | undefined, year: number): string {
  if (!c || !c.eras.length) return String(year)
  const era = eraOf(c, year)
  if (era) return `${year - era.start + 1} ${era.abbr}`
  const first = [...c.eras].sort((a, b) => a.start - b.start)[0]
  return `${first.start - year} before ${first.abbr}`
}

/** Days since day 1 of year 1 (0-based) for a date; months and days are 1-based. */
export function toDayNumber(c: CalendarDoc, year: number, monthIndex: number, day: number): number {
  const len = yearLength(c)
  const before = c.months.slice(0, monthIndex).reduce((s, m) => s + m.days, 0)
  return (year - 1) * len + before + (day - 1)
}

export function fromDayNumber(c: CalendarDoc, n: number): { year: number; month: number; day: number } {
  const len = Math.max(1, yearLength(c))
  const year = Math.floor(n / len) + 1
  let rest = n - (year - 1) * len
  let month = 0
  while (month < c.months.length - 1 && rest >= c.months[month].days) {
    rest -= c.months[month].days
    month++
  }
  return { year, month, day: rest + 1 }
}

export const weekdayOf = (c: CalendarDoc, n: number) => (c.weekdays.length ? (((n + c.firstWeekday) % c.weekdays.length) + c.weekdays.length) % c.weekdays.length : 0)
