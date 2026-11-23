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
  /** Stat changes while active, per stack, e.g. SPD -30 %. Any stat name the Combat Simulator knows: ATK, DEF, SPD, CRIT, CRITDMG, DMG, TAKEN or a fighter's own. */
  stats: { stat: string; percent: number; flat?: number }[]
  /** The target can't act while it has this (stun, freeze, sleep). */
  stops: boolean
  /** Effects this one removes when it lands (Wet removes Burn). */
  cancels: Id[]
  /** Own types or tags (Debuff, Control, Curse…), so other effects can remove or block all of a type. */
  tags?: string[]
  /** Removes every effect with one of these types when it lands (a cleanse). */
  cancelsTags?: string[]
  /** While active, these effects (by id) and types can't land on the target (immunity). */
  blocks?: Id[]
  blocksTags?: string[]
  /** Element of its ticks, for resistances; '' = none. */
  element: string
  description: string
  image: string | null
  sprite?: { doc: string; tag?: string } | null
}

/** What happens when `second` hits a target that already carries `first`. */
export interface Reaction {
  id: Id
  /** 'element' (default): first and second are elements. 'effect': first and second are effect ids, it happens when the second effect lands on a target that has the first. */
  on?: 'element' | 'effect'
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
  /** How durations read: the Combat Simulator counts turn-based fights in rounds either way. */
  unit?: 'seconds' | 'turns'
  /** How long an element hit stays on a target for reactions (default AURA_SECONDS). */
  auraSeconds?: number
}

/** Default time an element stays on a target. */
export const AURA_SECONDS = 8
/** Stats the Combat Simulator always knows; fighters can add their own. */
export const BUILTIN_STATS = ['ATK', 'DEF', 'SPD', 'CRIT', 'CRITDMG', 'DMG', 'TAKEN']

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
  const burn: StatusEffect = { ...newEffect('Burn'), tags: ['Debuff'], seconds: 6, maxStacks: 3, stacking: 'stronger', tick: { amount: 3, every: 1, heal: false }, element: 'Fire', description: 'Takes fire damage every second. Stacks up to 3 times.' }
  const wet: StatusEffect = { ...newEffect('Wet'), tags: ['Condition'], seconds: 8, cancels: [burn.id], element: 'Water', description: 'Soaked. Puts out Burn.' }
  const freeze: StatusEffect = { ...newEffect('Freeze'), tags: ['Control'], seconds: 2, stops: true, element: 'Ice', description: 'Frozen solid: can\'t act.' }
  const poison: StatusEffect = { ...newEffect('Poison'), tags: ['Debuff'], seconds: 10, tick: { amount: 2, every: 2, heal: false }, stats: [{ stat: 'DEF', percent: -10 }], element: 'Poison', description: 'Slow damage and weaker armour.' }
  const stun: StatusEffect = { ...newEffect('Stun'), tags: ['Control'], seconds: 1.5, stops: true, description: 'Dazed: can\'t act for a moment.' }
  const haste: StatusEffect = { ...newEffect('Haste'), tags: ['Buff'], good: true, seconds: 8, stats: [{ stat: 'SPD', percent: 30 }], description: 'Acts 30% faster.' }
  const regen: StatusEffect = { ...newEffect('Regeneration'), tags: ['Buff'], good: true, seconds: 10, tick: { amount: 4, every: 1, heal: true }, description: 'Heals a little every second.' }
  const tired: StatusEffect = { ...newEffect('Exhausted'), seconds: 20, tags: ['Condition'], stats: [{ stat: 'SPD', percent: -25 }, { stat: 'ATK', percent: 0, flat: -3 }], description: 'Slower and a little weaker. Works for survival meters too.' }
  const cleanse: StatusEffect = { ...newEffect('Cleanse'), good: true, seconds: 4, tags: ['Buff'], cancelsTags: ['Debuff'], blocksTags: ['Control'], description: 'Removes every Debuff and blocks Control effects for a moment.' }
  return {
    items: [burn, wet, freeze, poison, stun, haste, regen, tired, cleanse],
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
  for (const e of [...d.elements, ...d.reactions.filter((r) => r.on !== 'effect').flatMap((r) => [r.first, r.second]), ...d.items.map((x) => x.element), ...extra]) {
    const t = e.trim()
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
  }
  return [...seen.values()]
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
export const reactionFor = (d: Pick<StatusDoc, 'reactions'>, first: string, second: string) => d.reactions.find((r) => r.on !== 'effect' && same(r.first, first) && same(r.second, second))
export const effectReactionFor = (d: Pick<StatusDoc, 'reactions'>, firstId: Id, secondId: Id) => d.reactions.find((r) => r.on === 'effect' && r.first === firstId && r.second === secondId)

/** Splits "Debuff, Control" into clean, unique tags. */
export const parseTags = (s: string) => [...new Set(s.split(',').map((t) => t.trim()).filter(Boolean))]
const hasTag = (e: Pick<StatusEffect, 'tags'>, tags: string[] | undefined) => !!tags?.length && !!e.tags?.some((t) => tags.some((x) => same(x, t)))
/** Whether `e` takes away `other` when it lands: by id or by type. */
export const removes = (e: StatusEffect, other: StatusEffect) => e.cancels.includes(other.id) || hasTag(other, e.cancelsTags)
/** Whether an active `guard` keeps `e` from landing. */
export const blocks = (guard: StatusEffect, e: StatusEffect) => !!guard.blocks?.includes(e.id) || hasTag(e, guard.blocksTags)
/** Every type used by any effect. */
export const allTags = (d: Pick<StatusDoc, 'items'>) => [...new Map(d.items.flatMap((e) => e.tags ?? []).map((t) => [t.toLowerCase(), t])).values()]

/** What one effect does over its whole duration at a number of stacks: ticks, total damage or healing. */
export function effectTotal(e: StatusEffect, stacks = 1): { ticks: number; total: number } {
  if (!e.tick || e.tick.every <= 0) return { ticks: 0, total: 0 }
  const ticks = Math.floor(e.seconds / e.tick.every + 1e-9)
  return { ticks, total: ticks * e.tick.amount * Math.max(1, Math.min(stacks, e.maxStacks)) }
}

/** Words for the summary, so the tool can show it in the interface language. */
export const SUMMARY_EN = { unit: 's', per: 'per', total: 'total', cantAct: "can't act", upTo: 'up to {n} stacks' }

/** Plain-words summary, e.g. "6 s · 3 per 1 s (18 total) · up to 3 stacks". */
export function effectSummary(e: StatusEffect, w = SUMMARY_EN): string {
  const parts = [`${e.seconds} ${w.unit}`]
  if (e.tick) parts.push(`${e.tick.heal ? '+' : ''}${e.tick.amount} ${w.per} ${e.tick.every} ${w.unit} (${effectTotal(e).total} ${w.total})`)
  const sign = (n: number) => (n > 0 ? '+' : '') + n
  for (const s of e.stats) parts.push([s.stat, s.percent ? `${sign(s.percent)}%` : '', s.flat ? sign(s.flat) : ''].filter(Boolean).join(' '))
  if (e.stops) parts.push(w.cantAct)
  if (e.maxStacks > 1) parts.push(w.upTo.replace('{n}', String(e.maxStacks)))
  if (e.tags?.length) parts.push(e.tags.join(', '))
  return parts.join(' · ')
}
