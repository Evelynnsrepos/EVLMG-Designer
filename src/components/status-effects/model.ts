import { newId, type Id } from '@/core/model'

/**
 * Status Effects & Reactions (missing tools phase 1): effects like Burn or
 * Stun that last a while, tick, change stats or stop a fighter from acting,
 * and a grid of what happens when one element meets another (Wet + Lightning).
 * The Combat Simulator plays them out; Abilities say which effects they apply.
 */

export interface StatusEffect {
  id: Id
  name: string
  /** Helps (true) or hurts (false). */
  good: boolean
  /** How long it lasts, in seconds (a turn-based game can read seconds as turns). */
  seconds: number
  maxStacks: number
  /** refresh: lands again = timer restarts; stronger: one more stack and the timer restarts; ignore: nothing happens. */
  stacking: 'refresh' | 'stronger' | 'ignore'
  /** Damage (or healing) every `every` seconds, per stack. null = no ticks. */
  tick: { amount: number; every: number; heal: boolean } | null
  /** Stat changes while active, per stack, e.g. SPD -30. Stat names as in the Combat Simulator: ATK, DEF, SPD, CRIT. */
  stats: { stat: string; percent: number }[]
  /** The target can't act while it has this (stun, freeze, sleep). */
  stops: boolean
  /** Effects this one removes when it lands (Wet removes Burn). */
  cancels: Id[]
  /** Element of its ticks, for resistances; '' = none. */
  element: string
  description: string
  image: string | null
  sprite?: { doc: string; tag?: string } | null
}

/** What happens when `second` hits a target that already carries `first`. */
export interface Reaction {
  id: Id
  first: string
  second: string
  name: string
  /** Damage of the hit that triggers it, times this. */
  multiplier: number
  addsEffectId: Id | null
  /** The first element is used up. */
  consumes: boolean
  description: string
}

export interface StatusDoc {
  items: StatusEffect[]
  reactions: Reaction[]
  /** Elements for the reaction grid, besides the ones abilities and resistances already use. */
  elements: string[]
}

/** The project's one list, like Abilities & Spells. */
export const STATUS_DOC = { type: 'status-effects' as const, id: 'status-effects' }

/** Missing file = empty, so a project without the tool simulates exactly as before. The tool offers the examples. */
export const emptyStatusDoc = (): StatusDoc => ({ items: [], reactions: [], elements: [] })

export const newEffect = (name = 'New effect'): StatusEffect => ({
  id: newId(),
  name,
  good: false,
  seconds: 5,
  maxStacks: 1,
  stacking: 'refresh',
  tick: null,
  stats: [],
  stops: false,
  cancels: [],
  element: '',
  description: '',
  image: null,
})

export const newReaction = (first: string, second: string): Reaction => ({ id: newId(), first, second, name: `${first} + ${second}`, multiplier: 1.5, addsEffectId: null, consumes: true, description: '' })

/** The example list a new project starts from (Burn, Wet, Freeze…). */
export function exampleStatusDoc(): StatusDoc {
  const burn: StatusEffect = { ...newEffect('Burn'), seconds: 6, maxStacks: 3, stacking: 'stronger', tick: { amount: 3, every: 1, heal: false }, element: 'Fire', description: 'Takes fire damage every second. Stacks up to 3 times.' }
  const wet: StatusEffect = { ...newEffect('Wet'), seconds: 8, cancels: [burn.id], element: 'Water', description: 'Soaked. Puts out Burn.' }
  const freeze: StatusEffect = { ...newEffect('Freeze'), seconds: 2, stops: true, element: 'Ice', description: 'Frozen solid: can\'t act.' }
  const poison: StatusEffect = { ...newEffect('Poison'), seconds: 10, tick: { amount: 2, every: 2, heal: false }, stats: [{ stat: 'DEF', percent: -10 }], element: 'Poison', description: 'Slow damage and weaker armour.' }
  const stun: StatusEffect = { ...newEffect('Stun'), seconds: 1.5, stops: true, description: 'Dazed: can\'t act for a moment.' }
  const haste: StatusEffect = { ...newEffect('Haste'), good: true, seconds: 8, stats: [{ stat: 'SPD', percent: 30 }], description: 'Acts 30% faster.' }
  const regen: StatusEffect = { ...newEffect('Regeneration'), good: true, seconds: 10, tick: { amount: 4, every: 1, heal: true }, description: 'Heals a little every second.' }
  return {
    items: [burn, wet, freeze, poison, stun, haste, regen],
    reactions: [
      { ...newReaction('Water', 'Lightning'), name: 'Electrocute', multiplier: 2, addsEffectId: stun.id },
      { ...newReaction('Water', 'Ice'), name: 'Frozen', multiplier: 1, addsEffectId: freeze.id },
      { ...newReaction('Fire', 'Ice'), name: 'Melt', multiplier: 2 },
    ],
    elements: ['Fire', 'Water', 'Ice', 'Lightning', 'Poison'],
  }
}

/** Every element in use: the doc's own, the reactions', the effects' and any extra ones (abilities, resistances), case-insensitively unique. */
export function allElements(d: StatusDoc, extra: string[] = []): string[] {
  const seen = new Map<string, string>()
  for (const e of [...d.elements, ...d.reactions.flatMap((r) => [r.first, r.second]), ...d.items.map((x) => x.element), ...extra]) {
    const t = e.trim()
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
  }
  return [...seen.values()]
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
export const reactionFor = (d: Pick<StatusDoc, 'reactions'>, first: string, second: string) => d.reactions.find((r) => same(r.first, first) && same(r.second, second))

/** What one effect does over its whole duration at a number of stacks: ticks, total damage or healing. */
export function effectTotal(e: StatusEffect, stacks = 1): { ticks: number; total: number } {
  if (!e.tick || e.tick.every <= 0) return { ticks: 0, total: 0 }
  const ticks = Math.floor(e.seconds / e.tick.every + 1e-9)
  return { ticks, total: ticks * e.tick.amount * Math.max(1, Math.min(stacks, e.maxStacks)) }
}

/** Plain-words summary, e.g. "6 s · 3 per 1 s (18 total) · up to 3 stacks". */
export function effectSummary(e: StatusEffect): string {
  const parts = [`${e.seconds} s`]
  if (e.tick) parts.push(`${e.tick.heal ? '+' : ''}${e.tick.amount} per ${e.tick.every} s (${effectTotal(e).total} total)`)
  for (const s of e.stats) parts.push(`${s.stat} ${s.percent > 0 ? '+' : ''}${s.percent}%`)
  if (e.stops) parts.push("can't act")
  if (e.maxStacks > 1) parts.push(`up to ${e.maxStacks} stacks`)
  return parts.join(' · ')
}
