import { newId, type Id } from '@/core/model'
import { defaultValues, getFormula, tryCompile, type CompiledFormula } from '@/shared/formulas'

/**
 * Combat simulator (v0.10): two teams fight many times over. Each fighter
 * attacks on its own speed, damage comes from a Damage Calculator formula.
 */

export interface Fighter {
  id: Id
  name: string
  /** Enemy or character it was taken from, if any. */
  sourceId: Id | null
  hp: number
  atk: number
  def: number
  /** Attacks per second. */
  speed: number
  /** Percent. */
  crit: number
  critDamage: number
  /** Copies of this fighter on the team. */
  count: number
  /** 0.28: damage taken per element, like the Enemy List's resistances (1 = normal, 0.5 = half). */
  resist?: Record<string, number>
  /** 0.28: Abilities & Spells it uses whenever one is ready, instead of a basic attack. */
  abilities?: Id[]
}

/** An ability as the simulator uses it, resolved from Abilities & Spells. */
export interface SimAbility {
  id: Id
  name: string
  element: string
  cooldown: number
  expression: string
  values: Record<string, number>
}

export interface CombatDoc {
  teams: [Fighter[], Fighter[]]
  teamNames: [string, string]
  formulaId: string
  /** Random spread of damage, ± percent. */
  spread: number
  runs: number
}

export const newFighter = (name = 'Fighter'): Fighter => ({ id: newId(), name, sourceId: null, hp: 100, atk: 20, def: 10, speed: 1, crit: 10, critDamage: 150, count: 1 })

export const createCombatDoc = (): CombatDoc => ({
  teams: [[newFighter('Hero')], [{ ...newFighter('Slime'), hp: 60, atk: 12, def: 2, speed: 0.8 }]],
  teamNames: ['Players', 'Enemies'],
  formulaId: 'percentage-armor',
  spread: 10,
  runs: 1000,
})

/** Values for the formula: the attacker's ATK, the defender's DEF (and RES), defaults for the rest. */
export function hitDamage(f: CompiledFormula, base: Record<string, number>, attacker: Fighter, target: Fighter): number {
  const vars: Record<string, number> = { ...base, ATK: attacker.atk, DEF: target.def }
  try {
    const v = f.evaluate(vars)
    return Number.isFinite(v) ? Math.max(0, v) : 0
  } catch {
    return 0
  }
}

export interface CombatResult {
  wins: [number, number]
  draws: number
  avgSeconds: number
  /** Average HP left of the winning side, as a share of its total. */
  avgHpLeft: [number, number]
  /** Average damage per fight by fighter id. */
  damage: Record<Id, number>
  log: string[]
  error: string | null
}

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

const MAX_SECONDS = 600

export function simulateCombat(d: CombatDoc, seed = 1, abilities: SimAbility[] = []): CombatResult {
  const lib = getFormula(d.formulaId)
  const compiled = lib ? tryCompile(lib.expression) : null
  const empty: CombatResult = { wins: [0, 0], draws: 0, avgSeconds: 0, avgHpLeft: [0, 0], damage: {}, log: [], error: null }
  if (!lib || !compiled?.ok) return { ...empty, error: 'Pick a damage formula.' }
  const base = defaultValues(lib)
  const random = rng(seed)
  const skills = new Map(abilities.flatMap((a) => {
    const c = tryCompile(a.expression)
    return c.ok ? [[a.id, { a, f: c.value }] as const] : []
  }))
  const resistOf = (f: Fighter, element: string) => (element ? (Object.entries(f.resist ?? {}).find(([k]) => k.toLowerCase() === element.toLowerCase())?.[1] ?? 1) : 1)
  const result = empty
  let seconds = 0
  const hpLeft: [number, number] = [0, 0]
  const runs = Math.max(1, Math.min(20000, Math.round(d.runs)))
  for (let run = 0; run < runs; run++) {
    const units = d.teams.flatMap((team, side) =>
      team.flatMap((f) => Array.from({ length: Math.max(0, Math.round(f.count)) }, (_, i) => ({ f, side, hp: f.hp, next: random() / Math.max(0.01, f.speed), ready: {} as Record<Id, number>, label: f.count > 1 ? `${f.name} ${i + 1}` : f.name }))),
    )
    const total: [number, number] = [0, 1].map((s) => units.filter((u) => u.side === s).reduce((a, u) => a + u.hp, 0)) as [number, number]
    const log = run === 0 ? result.log : null
    let t = 0
    while (t < MAX_SECONDS) {
      const alive = (s: number) => units.filter((u) => u.side === s && u.hp > 0)
      if (!alive(0).length || !alive(1).length) break
      const actor = units.filter((u) => u.hp > 0).reduce((a, b) => (b.next < a.next ? b : a))
      t = actor.next
      actor.next += 1 / Math.max(0.01, actor.f.speed)
      const foes = alive(1 - actor.side)
      const target = foes.reduce((a, b) => (b.hp < a.hp ? b : a))
      const crit = random() * 100 < actor.f.crit
      const spread = 1 + ((random() * 2 - 1) * d.spread) / 100
      // The first ability that is ready replaces the basic attack; its formula gets this attacker's ATK and the target's DEF.
      const skill = (actor.f.abilities ?? []).map((id) => skills.get(id)).find((x) => x && (actor.ready[x.a.id] ?? 0) <= t)
      if (skill) actor.ready[skill.a.id] = t + Math.max(0, skill.a.cooldown)
      const raw = skill ? hitDamage(skill.f, { ...skill.a.values }, actor.f, target.f) : hitDamage(compiled.value, base, actor.f, target.f)
      const dmg = raw * resistOf(target.f, skill?.a.element ?? '') * spread * (crit ? actor.f.critDamage / 100 : 1)
      target.hp -= dmg
      result.damage[actor.f.id] = (result.damage[actor.f.id] ?? 0) + dmg / runs
      if (log && log.length < 60) log.push(`${t.toFixed(1)}s ${actor.label} ${skill ? `uses ${skill.a.name} on` : 'hits'} ${target.label} for ${Math.round(dmg)}${crit ? ' (crit)' : ''}${target.hp <= 0 ? `, ${target.label} falls` : ''}`)
    }
    const left = [0, 1].map((s) => units.filter((u) => u.side === s && u.hp > 0).reduce((a, u) => a + u.hp, 0))
    if (left[0] > 0 && left[1] <= 0) {
      result.wins[0]++
      hpLeft[0] += left[0] / total[0]
    } else if (left[1] > 0 && left[0] <= 0) {
      result.wins[1]++
      hpLeft[1] += left[1] / total[1]
    } else result.draws++
    seconds += t
  }
  result.avgSeconds = seconds / runs
  result.avgHpLeft = [result.wins[0] ? hpLeft[0] / result.wins[0] : 0, result.wins[1] ? hpLeft[1] / result.wins[1] : 0]
  return result
}
