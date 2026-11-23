import { newId, type Id, type LinkTarget } from '@/core/model'

/**
 * Live-Service Planner (missing tools phase 4): the weeks after launch.
 * Versions or seasons one after another, events and banners placed on weeks,
 * a battle pass, and a store rotation. Week 0 is launch week.
 */

export interface Version {
  id: Id
  name: string
  weeks: number
  color: string
  notes: string
  /** The Task Board milestone Make milestones made for it. */
  milestoneId?: Id
}

export interface LiveEvent {
  id: Id
  name: string
  startWeek: number
  days: number
  rewards: string
  target: LinkTarget | null
  color: string
}

export interface LiveBanner {
  id: Id
  name: string
  startWeek: number
  weeks: number
  /** A Gacha & Loot document with the rates. */
  gachaDocId: Id | null
  /** Characters on the banner. */
  featured: Id[]
  /** Anything else it features: items, skins, maps, modes, any document or entry. */
  links?: LinkTarget[]
  /** Bar colour; missing = the old purple. */
  color?: string
}

export interface PassReward {
  tier: number
  free: string
  paid: string
}

export interface BattlePass {
  /** Missing on plans from before passes per season. */
  id?: Id
  name?: string
  /** Missing = week 0. May be a fraction: days are sevenths of a week. */
  startWeek?: number
  tiers: number
  xpPerTier: number
  /** XP a player earns per day of play at one hour; scaled by the player profiles. */
  xpPerHour: number
  weeks: number
  rewards: PassReward[]
}

export interface StoreSlot {
  id: Id
  week: number
  name: string
  price: number
  currency: string
}

/** Something on a row of the person's own (a collab, a sale, a maintenance window…). */
export interface CustomItem {
  id: Id
  name: string
  startWeek: number
  weeks: number
  notes: string
}

/** A row the person names themselves, next to Events and Banners. */
export interface CustomRow {
  id: Id
  name: string
  color: string
  items: CustomItem[]
}

export interface LiveOpsDoc {
  /** Launch date, YYYY-MM-DD; '' = weeks only. */
  start: string
  versions: Version[]
  events: LiveEvent[]
  banners: LiveBanner[]
  /** Before passes per season: the one pass. Read through passesOf(); new edits write `passes`. */
  pass: BattlePass | null
  passes?: BattlePass[]
  /** How long people play a day, for the pass maths. Missing = DEFAULT_PROFILES. */
  profiles?: PlayerProfile[]
  store: StoreSlot[]
  /** Warn when a character is featured again sooner than this many weeks. */
  rerunWeeks: number
  /** Rows of the person's own (0.35+, optional: older files have none). */
  rows?: CustomRow[]
}

export interface PlayerProfile {
  name: string
  hoursPerDay: number
}

export const DEFAULT_PROFILES: PlayerProfile[] = [
  { name: 'Casual', hoursPerDay: 0.5 },
  { name: 'Regular', hoursPerDay: 1.5 },
  { name: 'Core', hoursPerDay: 4 },
]

export const BANNER_COLOR = '#9c36b5'
export const PASS_COLOR = '#2f9e44'
export const STORE_COLOR = '#1098ad'

export const VERSION_COLORS = ['#3e8ef7', '#9c36b5', '#2f9e44', '#f08c00', '#c2255c', '#1098ad']

/** A new plan starts nearly empty: one version, nothing on it. */
export function createLiveOpsDoc(): LiveOpsDoc {
  return {
    start: '',
    versions: [{ id: newId(), name: '1.0 Launch', weeks: 6, color: VERSION_COLORS[0], notes: '' }],
    events: [],
    banners: [],
    pass: null,
    passes: [],
    store: [],
    rerunWeeks: 26,
  }
}

export function newPass(startWeek: number, weeks: number, name = 'Pass'): BattlePass {
  return { id: newId(), name, startWeek, tiers: 50, xpPerTier: 1000, xpPerHour: 1200, weeks, rewards: [{ tier: 1, free: '100 gold', paid: 'Outfit' }, { tier: 50, free: 'Title', paid: 'Cosmetic' }] }
}

/** "Fill with an example": two versions with an event, a featured slot, a pass and a store item, all changeable. */
export function exampleLiveOpsDoc(d: LiveOpsDoc): LiveOpsDoc {
  return {
    ...d,
    versions: [
      { id: newId(), name: '1.0 Launch', weeks: 6, color: VERSION_COLORS[0], notes: '' },
      { id: newId(), name: '1.1', weeks: 6, color: VERSION_COLORS[1], notes: '' },
    ],
    events: [{ id: newId(), name: 'Launch celebration', startWeek: 0, days: 14, rewards: 'Bonus rewards', target: null, color: '#f5a623' }],
    banners: [
      { id: newId(), name: 'Featured 1', startWeek: 0, weeks: 3, gachaDocId: null, featured: [] },
      { id: newId(), name: 'Featured 2', startWeek: 3, weeks: 3, gachaDocId: null, featured: [] },
    ],
    pass: null,
    passes: [newPass(0, 6, 'Season 1')],
    store: [{ id: newId(), week: 0, name: 'Starter bundle', price: 5, currency: '€' }],
  }
}

/** The passes of a plan, old single-pass plans included, each with an id and a start. */
export function passesOf(d: Pick<LiveOpsDoc, 'pass' | 'passes'>): (BattlePass & { id: Id; startWeek: number })[] {
  const list = d.passes ?? (d.pass ? [d.pass] : [])
  return list.map((p, i) => ({ ...p, id: p.id ?? `pass-${i}`, startWeek: p.startWeek ?? 0 }))
}

/** Writes passes back; clears the old single `pass` so it is never read twice. */
export const withPasses = (d: LiveOpsDoc, passes: BattlePass[]): LiveOpsDoc => ({ ...d, pass: null, passes })

/** One pass per version, matching its start and length. Keeps passes that already match a version's start. */
export function passPerVersion(d: LiveOpsDoc): LiveOpsDoc {
  const have = passesOf(d)
  const starts = versionStarts(d)
  const add = d.versions.filter((_, i) => !have.some((p) => p.startWeek === starts[i])).map((v) => newPass(starts[d.versions.indexOf(v)], v.weeks, `${v.name} pass`))
  return add.length ? withPasses(d, [...have, ...add].sort((a, b) => (a.startWeek ?? 0) - (b.startWeek ?? 0))) : d
}

/**
 * Lanes for a row: items that overlap in time go on separate lanes, each item on the first free lane.
 * Returns the lane of each item by id and how many lanes the row needs.
 */
export function lanes(items: { id: Id; start: number; length: number }[]): { lane: Map<Id, number>; count: number } {
  const ends: number[] = []
  const lane = new Map<Id, number>()
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    let l = ends.findIndex((e) => e <= it.start + 1e-9)
    if (l < 0) l = ends.length
    ends[l] = it.start + Math.max(it.length, 1 / 7)
    lane.set(it.id, l)
  }
  return { lane, count: Math.max(1, ends.length) }
}

type Milestone = { id: Id; name: string; date: string }

/**
 * Task Board milestones for the versions: one per version, remembered on the version (`milestoneId`), so renaming a
 * version renames its milestone instead of adding a second one. Plans from before this adopt a milestone of the same name.
 */
export function versionMilestones(d: LiveOpsDoc, milestones: Milestone[]): { versions: Version[]; milestones: Milestone[] } {
  const starts = versionStarts(d)
  const out = [...milestones]
  const versions = d.versions.map((v, i) => {
    const date = weekDate(d.start, starts[i])
    let at = v.milestoneId ? out.findIndex((m) => m.id === v.milestoneId) : -1
    if (at < 0) at = out.findIndex((m) => m.name === v.name && !d.versions.some((x) => x !== v && x.milestoneId === m.id))
    if (at >= 0) {
      // Without a launch date keep a date someone typed on the Task Board.
      out[at] = { ...out[at], name: v.name, date: date || out[at].date }
      return out[at].id === v.milestoneId ? v : { ...v, milestoneId: out[at].id }
    }
    out.push({ id: v.id, name: v.name, date })
    return { ...v, milestoneId: v.id }
  })
  return { versions, milestones: out }
}

/** Start week of each version (they follow each other from week 0). */
export function versionStarts(d: Pick<LiveOpsDoc, 'versions'>): number[] {
  let w = 0
  return d.versions.map((v) => {
    const s = w
    w += Math.max(1, v.weeks)
    return s
  })
}

export const totalWeeks = (d: LiveOpsDoc) =>
  Math.max(
    versionStarts(d).at(-1)! + (d.versions.at(-1)?.weeks ?? 0) || 0,
    ...d.events.map((e) => e.startWeek + Math.ceil(e.days / 7)),
    ...d.banners.map((b) => b.startWeek + b.weeks),
    ...d.store.map((s) => s.week + 1),
    ...passesOf(d).map((p) => p.startWeek + p.weeks),
    ...(d.rows ?? []).flatMap((r) => r.items.map((i) => i.startWeek + i.weeks)),
    12,
  )

/** Date of a week's first day, or '' without a launch date. */
export function weekDate(start: string, week: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return ''
  const t = new Date(`${start}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + Math.round(week * 7))
  return t.toISOString().slice(0, 10)
}

/** Characters featured again within `rerunWeeks` of their last banner. */
export function rerunWarnings(d: LiveOpsDoc): { characterId: Id; first: Id; again: Id; weeks: number }[] {
  const out: { characterId: Id; first: Id; again: Id; weeks: number }[] = []
  const sorted = [...d.banners].sort((a, b) => a.startWeek - b.startWeek)
  const last = new Map<Id, LiveBanner>()
  for (const b of sorted)
    for (const c of b.featured) {
      const prev = last.get(c)
      if (prev && b.startWeek - prev.startWeek < d.rerunWeeks) out.push({ characterId: c, first: prev.id, again: b.id, weeks: b.startWeek - prev.startWeek })
      last.set(c, b)
    }
  return out
}

/** Days a player of `hoursPerDay` needs to finish the pass, and whether that fits in the pass's weeks. */
export function passDays(p: BattlePass, hoursPerDay: number): { days: number; fits: boolean } {
  const perDay = p.xpPerHour * hoursPerDay
  const days = perDay > 0 ? Math.ceil((p.tiers * p.xpPerTier) / perDay) : Infinity
  return { days, fits: days <= p.weeks * 7 }
}

/** Move every listed item by some weeks, passes included (versions are not moved: they follow each other). */
export function shiftWeeks(d: LiveOpsDoc, ids: Set<Id>, by: number): LiveOpsDoc {
  const mv = <T extends { id: Id }>(xs: T[], key: keyof T) => xs.map((x) => (ids.has(x.id) ? { ...x, [key]: Math.max(0, (x[key] as number) + by) } : x))
  const passes = passesOf(d)
  const rows = d.rows?.map((r) => ({ ...r, items: mv(r.items, 'startWeek') }))
  const out = { ...d, events: mv(d.events, 'startWeek'), banners: mv(d.banners, 'startWeek'), store: mv(d.store, 'week'), ...(rows ? { rows } : {}) }
  return passes.some((p) => ids.has(p.id)) ? withPasses(out, mv(passes, 'startWeek')) : out
}
