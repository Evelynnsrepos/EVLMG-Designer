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
}

export interface PassReward {
  tier: number
  free: string
  paid: string
}

export interface BattlePass {
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
  pass: BattlePass | null
  store: StoreSlot[]
  /** Warn when a character is featured again sooner than this many weeks. */
  rerunWeeks: number
  /** Rows of the person's own (0.35+, optional: older files have none). */
  rows?: CustomRow[]
}

export const VERSION_COLORS = ['#3e8ef7', '#9c36b5', '#2f9e44', '#f08c00', '#c2255c', '#1098ad']

export function createLiveOpsDoc(): LiveOpsDoc {
  return {
    start: '',
    versions: [
      { id: newId(), name: '1.0 Launch', weeks: 6, color: VERSION_COLORS[0], notes: '' },
      { id: newId(), name: '1.1', weeks: 6, color: VERSION_COLORS[1], notes: '' },
    ],
    events: [{ id: newId(), name: 'Launch celebration', startWeek: 0, days: 14, rewards: '10 pulls', target: null, color: '#f5a623' }],
    banners: [
      { id: newId(), name: 'Banner 1', startWeek: 0, weeks: 3, gachaDocId: null, featured: [] },
      { id: newId(), name: 'Banner 2', startWeek: 3, weeks: 3, gachaDocId: null, featured: [] },
    ],
    pass: { tiers: 50, xpPerTier: 1000, xpPerHour: 1200, weeks: 6, rewards: [{ tier: 1, free: '100 gold', paid: 'Outfit' }, { tier: 50, free: 'Title', paid: 'Weapon skin' }] },
    store: [],
    rerunWeeks: 26,
  }
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

/** Move every listed item by some weeks (versions are not moved: they follow each other). */
export function shiftWeeks(d: LiveOpsDoc, ids: Set<Id>, by: number): LiveOpsDoc {
  const mv = <T extends { id: Id }>(xs: T[], key: keyof T) => xs.map((x) => (ids.has(x.id) ? { ...x, [key]: Math.max(0, (x[key] as number) + by) } : x))
  const rows = d.rows?.map((r) => ({ ...r, items: mv(r.items, 'startWeek') }))
  return { ...d, events: mv(d.events, 'startWeek'), banners: mv(d.banners, 'startWeek'), store: mv(d.store, 'week'), ...(rows ? { rows } : {}) }
}
