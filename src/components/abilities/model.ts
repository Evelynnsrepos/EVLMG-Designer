import { newId, type Id } from '@/core/model'
import type { DamagePreset } from '@/shared/calculators'
import { defaultValues, getFormula, tryEvaluate } from '@/shared/formulas'

/** Abilities and spells (v0.10), with damage worked out by Damage Calculator formulas. */

export const ABILITY_KINDS = [
  { id: 'attack', label: 'Attack', color: '#e03131' },
  { id: 'spell', label: 'Spell', color: '#9c36b5' },
  { id: 'heal', label: 'Heal', color: '#2f9e44' },
  { id: 'buff', label: 'Buff / debuff', color: '#f08c00' },
  { id: 'passive', label: 'Passive', color: '#3e8ef7' },
  { id: 'utility', label: 'Utility', color: '#9aa0a6' },
] as const
export type AbilityKind = (typeof ABILITY_KINDS)[number]['id']

export interface Ability {
  id: Id
  name: string
  kind: AbilityKind
  element: string
  description: string
  /** Where its number comes from: a Damage Calculator preset, a library formula, or none. */
  source: 'none' | 'preset' | 'formula'
  presetId: Id | null
  formulaId: string
  /** Inputs that differ from the preset or formula. */
  values: Record<string, number>
  cost: number
  costResource: string
  cooldown: number
  castTime: number
  range: string
  /** Characters who can use it. */
  users: Id[]
  image: string | null
  /** v0.16: an icon from Pixel Art (and the tag that plays), shown instead of the picture. */
  sprite?: { doc: string; tag?: string } | null
}

export interface AbilitiesDoc {
  items: Ability[]
}

export const createAbilitiesDoc = (): AbilitiesDoc => ({ items: [] })

export const newAbility = (): Ability => ({
  id: newId(),
  name: 'New ability',
  kind: 'attack',
  element: '',
  description: '',
  source: 'formula',
  presetId: null,
  formulaId: 'percentage-armor',
  values: {},
  cost: 0,
  costResource: 'Mana',
  cooldown: 1,
  castTime: 0,
  range: '',
  users: [],
  image: null,
})

export const kindColor = (k: AbilityKind) => ABILITY_KINDS.find((x) => x.id === k)?.color

/** The formula and all input values an ability uses. */
export function abilityFormula(a: Ability, presets: DamagePreset[]): { expression: string; values: Record<string, number> } | null {
  if (a.source === 'preset') {
    const p = presets.find((x) => x.id === a.presetId)
    return p ? { expression: p.expression, values: { ...p.values, ...a.values } } : null
  }
  if (a.source === 'formula') {
    const f = getFormula(a.formulaId)
    return f ? { expression: f.expression, values: { ...defaultValues(f), ...a.values } } : null
  }
  return null
}

/** Its number (damage, healing…), damage per second and per point of cost. */
export function abilityStats(a: Ability, presets: DamagePreset[]): { value: number | null; perSecond: number | null; perCost: number | null; error: string | null } {
  const f = abilityFormula(a, presets)
  if (!f) return { value: null, perSecond: null, perCost: null, error: a.source === 'none' ? null : 'Pick a formula' }
  const r = tryEvaluate(f.expression, f.values)
  if (!r.ok) return { value: null, perSecond: null, perCost: null, error: r.error.message }
  const cycle = Math.max(a.cooldown, a.castTime)
  return { value: r.value, perSecond: cycle > 0 ? r.value / cycle : null, perCost: a.cost > 0 ? r.value / a.cost : null, error: null }
}
