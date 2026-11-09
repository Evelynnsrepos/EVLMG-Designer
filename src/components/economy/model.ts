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
  const bought: Record<Id, number | null> = Object.fromEntries(d.sinks.filter((s) => s.kind === 'once').map((s) => [s.id, null]))
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
    for (const k of d.sinks) {
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
