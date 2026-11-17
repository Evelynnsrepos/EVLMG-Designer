import type { Id } from '@/core/model'
import { defaultValues, getFormula, type FormulaPreset } from '@/shared/formulas'

/**
 * Stored shapes of the calculator documents (spec 8.3, 8.9). Each calculator document is one preset (CA-4):
 * its name is the document title in the sidebar, its data lives at `components/<calculator type>/<id>.json`.
 * The Level Calculator reads Damage Calculator presets (LV-4) and the Resource Calculator reads Level
 * Calculator presets (LV-7, RC-4), so these shapes are shared. Only add optional fields; `normalize*` fills them.
 */

/** Sweep one variable across a range and show it as a table or chart (CA-6). */
export interface RangeSettings {
  variable: string
  from: number
  to: number
  step: number
  mode: 'table' | 'chart'
}

/** A Damage Calculator document. */
export interface DamagePresetDoc {
  /** A library formula id, or null for a custom formula (CA-5). */
  formulaId: string | null
  /** The custom formula, used when `formulaId` is null. Kept when switching so it is not lost. */
  expression: string
  values: Record<string, number>
  range: RangeSettings
  /** Missing tools 6b: weapons compared by time to kill over distance. Missing = not used. */
  ttk?: TtkSettings
  /** Missing tools 6c: two numbers changed by steps in order, then multiplied (chips × mult). Missing = not used. */
  stack?: ScoreStack
}

export interface TtkWeapon {
  id: Id
  name: string
  damage: number
  /** Shots per minute. */
  rpm: number
  /** Full damage up to here (m), then falls to `minPercent` at `falloffEnd`. */
  falloffStart: number
  falloffEnd: number
  minPercent: number
}

export interface TtkSettings {
  weapons: TtkWeapon[]
  /** Target health, plus armour that takes damage first. */
  hp: number
  armor: number
  maxRange: number
}

export interface ScoreStep {
  id: Id
  name: string
  /** add or multiply the first (a) or second (b) number. */
  op: 'add-a' | 'add-b' | 'mul-a' | 'mul-b'
  amount: number
  /** How many times it happens (one per card played, for example). */
  times: number
  on: boolean
}

export interface ScoreStack {
  aName: string
  bName: string
  a: number
  b: number
  steps: ScoreStep[]
}

export type GrowthMode = 'flat' | 'percent' | 'formula'

/**
 * A value that changes per level (LV-3): a stat, or a level-up cost.
 * flat: base + perLevel × (level − 1); percent: base × (1 + perLevel%)^(level − 1), compounding,
 * the same as the Enemy List's growth; formula: any expression using `Level` and `Base`.
 */
export interface GrowthRow {
  id: Id
  /** Stat name used as a formula variable (ATK, DEF, HP, EM, ...). Empty for cost rows. */
  stat: string
  base: number
  mode: GrowthMode
  perLevel: number
  expression: string
}

/** A material needed to go from a level to the next one (LV-6). */
export interface CostRow extends GrowthRow {
  /** The item from the Item List; null until picked. */
  itemId: Id | null
}

export interface LevelPresetDoc {
  levelFrom: number
  levelTo: number
  /** XP curve (LV-1, LV-2). `formulaId` null = custom formula using `Level`. */
  xp: { enabled: boolean; formulaId: string | null; expression: string; values: Record<string, number> }
  stats: GrowthRow[]
  /** Where the stats were pulled from (LV-3), for display only. */
  statSource: { type: 'character' | 'enemy' | 'item'; id: Id } | null
  /** Damage per level (LV-4): a Damage Calculator preset, or a library formula with its own values. */
  damage: { source: 'none' | 'preset' | 'formula'; presetId: Id | null; formulaId: string; values: Record<string, number> }
  /** What the damage is dealt to (LV-5). `enemyLevel` null = same level as the attacker. */
  target: { mode: 'none' | 'fixed' | 'enemy'; values: Record<string, number>; enemyId: Id | null; enemyLevel: number | null }
  costs: CostRow[]
  /** Which columns to draw in the chart. */
  chart: 'damage' | 'xp' | 'stats'
}

export const DEFAULT_DAMAGE_FORMULA = 'percentage-armor'

export function createDamagePresetDoc(): DamagePresetDoc {
  const f = getFormula(DEFAULT_DAMAGE_FORMULA)!
  return {
    formulaId: f.id,
    expression: '',
    values: defaultValues(f),
    range: { variable: 'ATK', from: 100, to: 200, step: 10, mode: 'table' },
  }
}

export function normalizeDamagePresetDoc(d: Partial<DamagePresetDoc> | undefined): DamagePresetDoc {
  const def = createDamagePresetDoc()
  return {
    formulaId: d?.formulaId === undefined ? def.formulaId : d.formulaId,
    expression: d?.expression ?? '',
    values: { ...(d?.values ?? def.values) },
    range: { ...def.range, ...d?.range },
    ...(d?.ttk ? { ttk: d.ttk } : {}),
    ...(d?.stack ? { stack: d.stack } : {}),
  }
}

/** The shared `FormulaPreset` view of a Damage Calculator document, for `evaluatePreset`. */
export function toFormulaPreset(id: Id, name: string, doc: DamagePresetDoc): FormulaPreset {
  return { id, name, formulaId: doc.formulaId, expression: doc.expression, values: doc.values }
}

export function createLevelPresetDoc(): LevelPresetDoc {
  const xp = getFormula('xp-polynomial')!
  const dmg = getFormula(DEFAULT_DAMAGE_FORMULA)!
  return {
    levelFrom: 1,
    levelTo: 90,
    xp: { enabled: true, formulaId: xp.id, expression: 'Base * Level ^ 2', values: defaultValues(xp) },
    stats: [],
    statSource: null,
    damage: { source: 'none', presetId: null, formulaId: dmg.id, values: defaultValues(dmg) },
    target: { mode: 'none', values: { DEF: 50 }, enemyId: null, enemyLevel: null },
    costs: [],
    chart: 'damage',
  }
}

export function normalizeLevelPresetDoc(d: Partial<LevelPresetDoc> | undefined): LevelPresetDoc {
  const def = createLevelPresetDoc()
  if (!d) return def
  return {
    levelFrom: d.levelFrom ?? def.levelFrom,
    levelTo: d.levelTo ?? def.levelTo,
    xp: { ...def.xp, ...d.xp },
    stats: (d.stats ?? []).map(normalizeGrowthRow),
    statSource: d.statSource ?? null,
    damage: { ...def.damage, ...d.damage },
    target: { ...def.target, ...d.target },
    costs: (d.costs ?? []).map((c) => ({ ...normalizeGrowthRow(c), itemId: c.itemId ?? null })),
    chart: d.chart ?? def.chart,
  }
}

function normalizeGrowthRow<T extends Partial<GrowthRow>>(r: T): GrowthRow {
  return {
    id: r.id ?? '',
    stat: r.stat ?? '',
    base: r.base ?? 0,
    mode: r.mode ?? 'flat',
    perLevel: r.perLevel ?? 0,
    expression: r.expression ?? '',
  }
}

/** A Damage Calculator preset's formula and its input values, for use outside the calculator (Spreadsheet CALC, v0.9). */
export function damagePresetFormula(doc: DamagePresetDoc): { expression: string; values: Record<string, number> } {
  const lib = doc.formulaId === null ? undefined : getFormula(doc.formulaId)
  if (lib) return { expression: lib.expression, values: { ...defaultValues(lib), ...doc.values } }
  return { expression: doc.expression, values: { ...doc.values } }
}
