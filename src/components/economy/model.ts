import { newId, type Id } from '@/core/model'
import { tryCompile, type CompiledFormula } from '@/shared/formulas'
import type { Market } from './market'

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
  /** 0.35: per hour as a formula of t (hours played); replaces perHour and growth when set. */
  formula?: string
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
  /** 0.35: the cost as a formula of t (hours played) and n (times paid so far); replaces cost when set. */
  formula?: string
}

export interface EconomyDoc {
  /** 0.28: player profiles; missing = DEFAULT_PROFILES. */
  profiles?: Profile[]
  currencies: Currency[]
  sources: Source[]
  sinks: Sink[]
  hours: number
  /** Missing tools phase 3: bars that change over time (hunger, stamina, energy). Missing = none. */
  meters?: Meter[]
  meterActions?: MeterAction[]
  /** Which player profile plays between offline breaks (offline meters). Missing = 'regular' or the first profile. */
  meterProfileId?: Id
  /** 0.35: goods, places, routes and recipes (Markets tab). Missing = not used. */
  market?: Market
}

/** A bar from 0 to max that changes by itself every hour of play. */
export interface Meter {
  id: Id
  name: string
  start: number
  max: number
  /** Change per hour of play, e.g. -5 for hunger. */
  perHour: number
  /** Keeps going while the game is closed (energy that refills over the day): simulated between play sessions. */
  offline: boolean
  thresholds: MeterThreshold[]
  /** Change per hour as a formula; replaces perHour when set. Names: t, v (this meter), max, other meters by name. */
  formula?: string
}

/** While a meter is below `below`: a name (Hungry), an optional Status Effect, and an optional change to another meter. */
export interface MeterThreshold {
  id: Id
  /** The value for 'below' and 'above'; unused for 'empty' and 'full'. */
  below: number
  /** Missing = 'below'. */
  when?: 'below' | 'above' | 'empty' | 'full'
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
  /** Every this many hours of play; for 'below' at most this often. Rounded to quarter hours. */
  every: number
  /** Missing = 'every': on a clock. 'below' / 'above': whenever the meter is below / above `at`. */
  when?: 'every' | 'below' | 'above'
  at?: number
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
  /** 0.35: formulas with a typo or a name other than t and n, by source or sink id. */
  formulaErrors: Record<Id, string>
}

/** Compiles a source or sink formula; only t and n are known. */
function formulaOf(text: string | undefined): { f: CompiledFormula | null; error: string | null } {
  if (!text?.trim()) return { f: null, error: null }
  const c = tryCompile(text)
  if (!c.ok) return { f: null, error: c.error.message }
  const bad = c.value.variables.filter((v) => v !== 't' && v !== 'n')
  return bad.length ? { f: null, error: `Unknown name ${bad.join(', ')} (use t for hours played, n for times paid)` } : { f: c.value, error: null }
}
const run = (f: CompiledFormula, t: number, n = 0) => {
  try {
    return Math.max(0, f.evaluate({ t, n }))
  } catch {
    return 0
  }
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
  const formulaErrors: Record<Id, string> = {}
  const fs = new Map<Id, CompiledFormula>()
  for (const x of [...d.sources, ...d.sinks]) {
    const r = formulaOf(x.formula)
    if (r.error) formulaErrors[x.id] = r.error
    if (r.f) fs.set(x.id, r.f)
  }
  const paidCount: Record<Id, number> = {}
  const onNeed = (d.meterActions ?? []).filter((a) => (a.when ?? 'every') !== 'every' && a.costCurrencyId && a.cost > 0)
  const needFired = onNeed.length ? simulateMeters(d).fired : {}
  const steps = Math.round(Math.min(1000, Math.max(0, d.hours)) / STEP)
  for (let i = 1; i <= steps; i++) {
    const t = i * STEP
    for (const s of d.sources) {
      if (t <= s.fromHour || !(s.currencyId in bal)) continue
      const f = fs.get(s.id)
      const gain = f ? run(f, t) * STEP : s.perHour * STEP * Math.pow(1 + s.growth / 100, t - s.fromHour)
      bal[s.currencyId] += gain
      earned[s.currencyId] += gain
    }
    for (const k of sinks) {
      if (t <= k.fromHour || !(k.currencyId in bal)) continue
      let cost = 0
      const f = fs.get(k.id)
      const price = f ? run(f, t, paidCount[k.id] ?? 0) : k.cost
      if (k.kind === 'perHour') cost = price * STEP
      else if (k.kind === 'every' && t - (lastPaid[k.id] ?? k.fromHour) >= Math.max(STEP, k.hours) - 1e-9) cost = price
      else if (k.kind === 'once' && bought[k.id] === null && bal[k.currencyId] >= price) cost = price
      if (!cost) continue
      if (bal[k.currencyId] < cost && k.kind !== 'once') {
        if (!shortfalls.some((x) => x.sinkId === k.id)) shortfalls.push({ sinkId: k.id, hour: t })
        continue
      }
      bal[k.currencyId] -= cost
      spent[k.currencyId] += cost
      lastPaid[k.id] = t
      paidCount[k.id] = (paidCount[k.id] ?? 0) + 1
      if (k.kind === 'once') bought[k.id] = t
    }
    for (const a of onNeed) {
      if (!(a.costCurrencyId! in bal) || !needFired[a.id]?.includes(i)) continue
      if (bal[a.costCurrencyId!] < a.cost) {
        if (!shortfalls.some((x) => x.sinkId === a.id)) shortfalls.push({ sinkId: a.id, hour: t })
        continue
      }
      bal[a.costCurrencyId!] -= a.cost
      spent[a.costCurrencyId!] += a.cost
    }
    times.push(t)
    for (const c of d.currencies) balance[c.id].push(Math.round(bal[c.id]))
  }
  return { times, balance, earned, spent, bought, shortfalls, formulaErrors }
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

const th = (below: number, name: string, when?: MeterThreshold['when'], meterId: Id | null = null, perHour = 0): MeterThreshold => ({ id: newId(), below, name, when, effectId: null, meterId, perHour })

/** Example: two meters that pull on each other through a formula and an 'above' level. */
export function moodExample(): Pick<EconomyDoc, 'meters' | 'meterActions'> {
  const stress: Meter = { id: newId(), name: 'Stress', start: 10, max: 100, perHour: 6, offline: false, thresholds: [] }
  const mood: Meter = { id: newId(), name: 'Mood', start: 80, max: 100, perHour: 0, formula: '-1 - 0.05 * Stress', offline: false, thresholds: [th(30, 'Gloomy'), th(0, 'Breakdown', 'empty')] }
  stress.thresholds = [th(70, 'Overwhelmed', 'above', mood.id, -6)]
  return {
    meters: [mood, stress],
    meterActions: [
      { id: newId(), name: 'Rest', meterId: stress.id, amount: -50, every: 3, when: 'above', at: 60, costCurrencyId: null, cost: 0 },
      { id: newId(), name: 'Treat yourself', meterId: mood.id, amount: 25, every: 6, costCurrencyId: null, cost: 0 },
    ],
  }
}

/** Example: a tank that runs dry and is refilled only when it gets low, for a price. */
export function fuelExample(currencyId: Id | null): Pick<EconomyDoc, 'meters' | 'meterActions'> {
  const fuel: Meter = { id: newId(), name: 'Fuel', start: 100, max: 100, perHour: -12, offline: false, thresholds: [th(25, 'Low fuel'), th(0, 'Stranded', 'empty')] }
  return { meters: [fuel], meterActions: [{ id: newId(), name: 'Refuel', meterId: fuel.id, amount: 100, every: 0.25, when: 'below', at: 20, costCurrencyId: currencyId, cost: currencyId ? 40 : 0 }] }
}

/** Example: an energy bar that refills while the game is closed and is spent on play. */
export function refillExample(): Pick<EconomyDoc, 'meters' | 'meterActions'> {
  const energy: Meter = { id: newId(), name: 'Energy', start: 120, max: 160, perHour: 8, offline: true, thresholds: [th(20, 'Out of energy'), th(0, 'Full, wasting refills', 'full')] }
  return { meters: [energy], meterActions: [{ id: newId(), name: 'Play a stage', meterId: energy.id, amount: -20, every: 0.5, when: 'above', at: 19, costCurrencyId: null, cost: 0 }] }
}

export interface MeterResult {
  /** Same quarter-hour samples as the money simulation. */
  times: number[]
  values: Record<Id, number[]>
  /** First hour each level is reached, null = never. (Named for 'below', holds every kind.) */
  firstBelow: Record<Id, number | null>
  /** Hours each level is active in total. */
  hoursBelow: Record<Id, number>
  /** Step numbers (hour / 0.25) at which each action happened. */
  fired: Record<Id, number[]>
  /** Meter formulas with a mistake, by meter id. */
  formulaErrors: Record<Id, string>
}

const clamp = (v: number, max: number) => Math.min(Math.max(0, max), Math.max(0, v))

/** A name usable in a formula: Body Heat -> Body_Heat. */
export const meterVar = (name: string) => name.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^(\d)/, '_$1')

/** Is a level active at value v? */
export function levelActive(th: MeterThreshold, v: number, max: number): boolean {
  const w = th.when ?? 'below'
  return w === 'below' ? v < th.below : w === 'above' ? v > th.below : w === 'empty' ? v <= 0 : v >= max
}

/** Quarter-hour steps for an action interval (the simulation moves in quarter hours). */
export const stepsOf = (every: number) => Math.max(1, Math.round(every / STEP))

/** The profile that plays between offline breaks. */
export const meterProfile = (d: EconomyDoc): Profile => {
  const ps = d.profiles ?? DEFAULT_PROFILES
  return ps.find((p) => p.id === d.meterProfileId) ?? ps.find((p) => p.id === 'regular') ?? ps[0] ?? DEFAULT_PROFILES[1]
}

export function simulateMeters(d: EconomyDoc): MeterResult {
  const meters = d.meters ?? []
  const actions = d.meterActions ?? []
  const v: Record<Id, number> = Object.fromEntries(meters.map((m) => [m.id, clamp(m.start, m.max)]))
  const values: Record<Id, number[]> = Object.fromEntries(meters.map((m) => [m.id, [v[m.id]]]))
  const firstBelow: Record<Id, number | null> = {}
  const hoursBelow: Record<Id, number> = {}
  const fired: Record<Id, number[]> = Object.fromEntries(actions.map((a) => [a.id, []]))
  const formulaErrors: Record<Id, string> = {}
  const known = new Set(['t', 'v', 'max', ...meters.map((m) => meterVar(m.name))])
  const fs = new Map<Id, CompiledFormula>()
  for (const m of meters) {
    if (!m.formula?.trim()) continue
    const c = tryCompile(m.formula)
    if (!c.ok) formulaErrors[m.id] = c.error.message
    else {
      const bad = c.value.variables.filter((x) => !known.has(x))
      if (bad.length) formulaErrors[m.id] = `Unknown name ${bad.join(', ')} (use t, v, max or a meter name)`
      else fs.set(m.id, c.value)
    }
  }
  const rate = (m: Meter, t: number) => {
    const f = fs.get(m.id)
    if (!f) return m.perHour
    try {
      const r = f.evaluate({ t, v: v[m.id], max: m.max, ...Object.fromEntries(meters.map((o) => [meterVar(o.name), v[o.id]])) })
      return Number.isFinite(r) ? r : 0
    } catch {
      return 0
    }
  }
  for (const m of meters) for (const th of m.thresholds) ((firstBelow[th.id] = levelActive(th, v[m.id], m.max) ? 0 : null), (hoursBelow[th.id] = 0))
  // Offline meters: after each play session (the profile's hours per day) the rest of the day passes with the game closed.
  // shortcut: levels don't count while offline and the offline change uses the rate at the end of the session; split it up if a designer needs levels to fire offline.
  const prof = meterProfile(d)
  const session = prof.hoursPerDay > 0 && prof.hoursPerDay < 24 ? stepsOf(prof.hoursPerDay) : 0
  const offlineHours = 24 - session * STEP
  const lastFired: Record<Id, number> = {}
  const times = [0]
  const steps = Math.round(Math.min(1000, Math.max(0, d.hours)) / STEP)
  for (let i = 1; i <= steps; i++) {
    const t = i * STEP
    const delta: Record<Id, number> = Object.fromEntries(meters.map((m) => [m.id, rate(m, t) * STEP]))
    // Levels look at the meters as they were at the start of this step, so the order of meters doesn't matter.
    for (const m of meters)
      for (const th of m.thresholds) {
        if (!levelActive(th, v[m.id], m.max)) continue
        hoursBelow[th.id] += STEP
        if (th.meterId && th.meterId in delta) delta[th.meterId] += th.perHour * STEP
      }
    for (const a of actions) {
      if (!(a.meterId in delta)) continue
      const n = stepsOf(a.every)
      const need = a.when === 'below' ? v[a.meterId] < (a.at ?? 0) : a.when === 'above' ? v[a.meterId] > (a.at ?? 0) : null
      const due = need === null ? i % n === 0 : need && i - (lastFired[a.id] ?? -Infinity) >= n
      if (!due) continue
      delta[a.meterId] += a.amount
      lastFired[a.id] = i
      fired[a.id].push(i)
    }
    for (const m of meters) {
      v[m.id] = clamp(v[m.id] + delta[m.id], m.max)
      if (session && m.offline && i % session === 0) v[m.id] = clamp(v[m.id] + rate(m, t) * offlineHours, m.max)
      values[m.id].push(Math.round(v[m.id] * 10) / 10)
      for (const th of m.thresholds) if (firstBelow[th.id] === null && levelActive(th, v[m.id], m.max)) firstBelow[th.id] = t
    }
    times.push(t)
  }
  return { times, values, firstBelow, hoursBelow, fired, formulaErrors }
}

/** Meter actions that cost money, as sinks for the money simulation (paid every time the action happens). */
export const meterSinks = (d: EconomyDoc): Sink[] =>
  (d.meterActions ?? []).filter((a) => a.costCurrencyId && a.cost > 0 && (a.when ?? 'every') === 'every').map((a) => ({ id: a.id, name: a.name, currencyId: a.costCurrencyId!, cost: a.cost, kind: 'every' as const, hours: a.every, fromHour: 0 }))

/** Real hours for an offline meter to go from empty to full (or full to empty); null when it doesn't move. */
export const realHoursToFill = (m: Meter): number | null => (m.perHour ? Math.round((m.max / Math.abs(m.perHour)) * 10) / 10 : null)
