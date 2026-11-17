import { newId, type Id } from '@/core/model'

/**
 * Economy simulator (v0.10): where currencies come from (sources) and where
 * they go (sinks), simulated hour by hour of play.
 */

export interface Currency {
  id: Id
  name: string
  start: number
}

export interface Source {
  id: Id
  name: string
  currencyId: Id
  perHour: number
  /** Income grows by this percent per hour played (better areas, upgrades). */
  growth: number
  fromHour: number
}

export interface Sink {
  id: Id
  name: string
  currencyId: Id
  cost: number
  /** once: bought one time when affordable; every: every `hours`; perHour: steady drain. */
  kind: 'once' | 'every' | 'perHour'
  hours: number
  fromHour: number
}

export interface EconomyDoc {
  /** 0.28: player profiles; missing = DEFAULT_PROFILES. */
  profiles?: Profile[]
  currencies: Currency[]
  sources: Source[]
  sinks: Sink[]
  hours: number
  /** Missing tools phase 3: bars that change over time (hunger, stamina, resin). Missing = none. */
  meters?: Meter[]
  meterActions?: MeterAction[]
}

/** A bar from 0 to max that changes by itself every hour of play. */
export interface Meter {
  id: Id
  name: string
  start: number
  max: number
  /** Change per hour of play, e.g. -5 for hunger. */
  perHour: number
  /** Keeps going while the game is closed (resin, energy refills): shown in real hours. */
  offline: boolean
  thresholds: MeterThreshold[]
}

/** While a meter is below `below`: a name (Hungry), an optional Status Effect, and an optional change to another meter. */
export interface MeterThreshold {
  id: Id
  below: number
  name: string
  effectId: Id | null
  meterId: Id | null
  perHour: number
}

/** Something the player does that changes a meter: Eat +40 every 4 hours, maybe for a price. */
export interface MeterAction {
  id: Id
  name: string
  meterId: Id
  amount: number
  /** Every this many hours of play. */
  every: number
  costCurrencyId: Id | null
  cost: number
}

/** 0.28: how much different players play, to turn hours of play into days. */
export interface Profile {
  id: Id
  name: string
  hoursPerDay: number
}

export const DEFAULT_PROFILES: Profile[] = [
  { id: 'casual', name: 'Casual', hoursPerDay: 0.5 },
  { id: 'regular', name: 'Regular', hoursPerDay: 1.5 },
  { id: 'core', name: 'Core', hoursPerDay: 4 },
]

/** Days of real time until a player of this profile reaches an hour of play. */
export const daysFor = (hours: number, p: Profile) => Math.max(1, Math.ceil(hours / Math.max(0.01, p.hoursPerDay)))

/** Quest gold as one source spread over the hours of play: the total of every quest's gold reward. */
export const questGoldSource = (quests: { rewardGold: number }[], d: Pick<EconomyDoc, 'hours'>, currencyId: Id): Source => ({
  ...newSource(currencyId),
  name: `Quest rewards (${quests.length} quests)`,
  perHour: Math.round((quests.reduce((a, q) => a + (q.rewardGold || 0), 0) / Math.max(1, d.hours)) * 100) / 100,
})

export function createEconomyDoc(): EconomyDoc {
  const gold: Currency = { id: newId(), name: 'Gold', start: 100 }
  return {
    currencies: [gold],
    sources: [
      { id: newId(), name: 'Quests', currencyId: gold.id, perHour: 300, growth: 2, fromHour: 0 },
      { id: newId(), name: 'Selling loot', currencyId: gold.id, perHour: 150, growth: 1, fromHour: 1 },
    ],
    sinks: [
      { id: newId(), name: 'Potions', currencyId: gold.id, cost: 50, kind: 'perHour', hours: 1, fromHour: 0 },
      { id: newId(), name: 'Repairs', currencyId: gold.id, cost: 120, kind: 'every', hours: 2, fromHour: 0 },
      { id: newId(), name: 'Mount', currencyId: gold.id, cost: 2500, kind: 'once', hours: 1, fromHour: 0 },
    ],
    hours: 20,
  }
}

export const newSource = (currencyId: Id): Source => ({ id: newId(), name: 'New source', currencyId, perHour: 100, growth: 0, fromHour: 0 })
export const newSink = (currencyId: Id): Sink => ({ id: newId(), name: 'New sink', currencyId, cost: 100, kind: 'every', hours: 1, fromHour: 0 })

export interface EconomyResult {
  /** Hours at each sample (every quarter hour). */
  times: number[]
  balance: Record<Id, number[]>
  earned: Record<Id, number>
  spent: Record<Id, number>
  /** When one-time purchases happened, or null when never affordable. */
  bought: Record<Id, number | null>
  /** First time a sink could not be paid. */
  shortfalls: { sinkId: Id; hour: number }[]
}

const STEP = 0.25

export function simulateEconomy(d: EconomyDoc): EconomyResult {
  const bal: Record<Id, number> = Object.fromEntries(d.currencies.map((c) => [c.id, c.start]))
  const balance: Record<Id, number[]> = Object.fromEntries(d.currencies.map((c) => [c.id, [c.start]]))
  const earned: Record<Id, number> = Object.fromEntries(d.currencies.map((c) => [c.id, 0]))
  const spent: Record<Id, number> = Object.fromEntries(d.currencies.map((c) => [c.id, 0]))
  const sinks = [...d.sinks, ...meterSinks(d)]
  const bought: Record<Id, number | null> = Object.fromEntries(sinks.filter((s) => s.kind === 'once').map((s) => [s.id, null]))
  const shortfalls: EconomyResult['shortfalls'] = []
  const lastPaid: Record<Id, number> = {}
  const times = [0]
  const steps = Math.round(Math.min(1000, Math.max(0, d.hours)) / STEP)
  for (let i = 1; i <= steps; i++) {
    const t = i * STEP
    for (const s of d.sources) {
      if (t <= s.fromHour || !(s.currencyId in bal)) continue
      const gain = s.perHour * STEP * Math.pow(1 + s.growth / 100, t - s.fromHour)
      bal[s.currencyId] += gain
      earned[s.currencyId] += gain
    }
    for (const k of sinks) {
      if (t <= k.fromHour || !(k.currencyId in bal)) continue
      let cost = 0
      if (k.kind === 'perHour') cost = k.cost * STEP
      else if (k.kind === 'every' && t - (lastPaid[k.id] ?? k.fromHour) >= Math.max(STEP, k.hours) - 1e-9) cost = k.cost
      else if (k.kind === 'once' && bought[k.id] === null && bal[k.currencyId] >= k.cost) cost = k.cost
      if (!cost) continue
      if (bal[k.currencyId] < cost && k.kind !== 'once') {
        if (!shortfalls.some((x) => x.sinkId === k.id)) shortfalls.push({ sinkId: k.id, hour: t })
        continue
      }
      bal[k.currencyId] -= cost
      spent[k.currencyId] += cost
      lastPaid[k.id] = t
      if (k.kind === 'once') bought[k.id] = t
    }
    times.push(t)
    for (const c of d.currencies) balance[c.id].push(Math.round(bal[c.id]))
  }
  return { times, balance, earned, spent, bought, shortfalls }
}

// ---- Meters (missing tools phase 3) ------------------------------------------------

export function survivalExample(): Pick<EconomyDoc, 'meters' | 'meterActions'> {
  const health: Meter = { id: newId(), name: 'Health', start: 100, max: 100, perHour: 0, offline: false, thresholds: [{ id: newId(), below: 30, name: 'Badly hurt', effectId: null, meterId: null, perHour: 0 }] }
  const hunger: Meter = {
    id: newId(),
    name: 'Food',
    start: 80,
    max: 100,
    perHour: -5,
    offline: false,
    thresholds: [
      { id: newId(), below: 25, name: 'Hungry', effectId: null, meterId: null, perHour: 0 },
      { id: newId(), below: 5, name: 'Starving', effectId: null, meterId: health.id, perHour: -10 },
    ],
  }
  const thirst: Meter = { id: newId(), name: 'Water', start: 80, max: 100, perHour: -8, offline: false, thresholds: [{ id: newId(), below: 10, name: 'Parched', effectId: null, meterId: health.id, perHour: -15 }] }
  const energy: Meter = { id: newId(), name: 'Energy', start: 100, max: 100, perHour: -6, offline: false, thresholds: [{ id: newId(), below: 15, name: 'Exhausted', effectId: null, meterId: null, perHour: 0 }] }
  return {
    meters: [hunger, thirst, energy, health],
    meterActions: [
      { id: newId(), name: 'Eat', meterId: hunger.id, amount: 40, every: 5, costCurrencyId: null, cost: 0 },
      { id: newId(), name: 'Drink', meterId: thirst.id, amount: 50, every: 4, costCurrencyId: null, cost: 0 },
      { id: newId(), name: 'Sleep', meterId: energy.id, amount: 100, every: 14, costCurrencyId: null, cost: 0 },
    ],
  }
}

export interface MeterResult {
  /** Same quarter-hour samples as the money simulation. */
  times: number[]
  values: Record<Id, number[]>
  /** First hour each threshold is reached, null = never. */
  firstBelow: Record<Id, number | null>
  /** Hours each threshold is active in total. */
  hoursBelow: Record<Id, number>
}

const clamp = (v: number, max: number) => Math.min(Math.max(0, max), Math.max(0, v))

export function simulateMeters(d: EconomyDoc): MeterResult {
  const meters = d.meters ?? []
  const actions = d.meterActions ?? []
  const v: Record<Id, number> = Object.fromEntries(meters.map((m) => [m.id, clamp(m.start, m.max)]))
  const values: Record<Id, number[]> = Object.fromEntries(meters.map((m) => [m.id, [v[m.id]]]))
  const firstBelow: Record<Id, number | null> = {}
  const hoursBelow: Record<Id, number> = {}
  for (const m of meters) for (const th of m.thresholds) ((firstBelow[th.id] = v[m.id] < th.below ? 0 : null), (hoursBelow[th.id] = 0))
  const times = [0]
  const steps = Math.round(Math.min(1000, Math.max(0, d.hours)) / STEP)
  for (let i = 1; i <= steps; i++) {
    const t = i * STEP
    const delta: Record<Id, number> = Object.fromEntries(meters.map((m) => [m.id, m.perHour * STEP]))
    // Thresholds look at the meters as they were at the start of this step, so the order of meters doesn't matter.
    for (const m of meters)
      for (const th of m.thresholds) {
        if (v[m.id] >= th.below) continue
        hoursBelow[th.id] += STEP
        if (th.meterId && th.meterId in delta) delta[th.meterId] += th.perHour * STEP
      }
    for (const a of actions) if (a.meterId in delta && a.every > 0 && Math.abs(t / a.every - Math.round(t / a.every)) < 1e-9) delta[a.meterId] += a.amount
    for (const m of meters) {
      v[m.id] = clamp(v[m.id] + delta[m.id], m.max)
      values[m.id].push(Math.round(v[m.id] * 10) / 10)
      for (const th of m.thresholds) if (firstBelow[th.id] === null && v[m.id] < th.below) firstBelow[th.id] = t
    }
    times.push(t)
  }
  return { times, values, firstBelow, hoursBelow }
}

/** Meter actions that cost money, as sinks for the money simulation (paid every time the action happens). */
export const meterSinks = (d: EconomyDoc): Sink[] =>
  (d.meterActions ?? []).filter((a) => a.costCurrencyId && a.cost > 0).map((a) => ({ id: a.id, name: a.name, currencyId: a.costCurrencyId!, cost: a.cost, kind: 'every' as const, hours: a.every, fromHour: 0 }))

/** Real hours for an offline meter to go from empty to full (or full to empty); null when it doesn't move. */
export const realHoursToFill = (m: Meter): number | null => (m.perHour ? Math.round((m.max / Math.abs(m.perHour)) * 10) / 10 : null)
