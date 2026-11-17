import { newId, type Id } from '@/core/model'
import { defaultValues, getFormula, tryCompile, type CompiledFormula } from '@/shared/formulas'
import { reactionFor, type StatusDoc, type StatusEffect } from '@/components/status-effects/model'

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
  /** Status effects it puts on the target (chance in percent, own duration or the effect's). */
  applies?: { effectId: Id; chance: number; seconds?: number | null }[]
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
  /** With status effects: average damage from ticks per fight, and how often each reaction happened per fight. */
  effects?: { damage: number; reactions: Record<string, number> }
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
/** shortcut: an element hit leaves its element on the target this long for reactions; make it a setting if people ask. */
export const AURA_SECONDS = 8

interface ActiveEffect {
  e: StatusEffect
  stacks: number
  until: number
  nextTick: number
}

/** A stat with the target's active effects applied, e.g. ATK with Weaken -20%. */
function withEffects(base: number, stat: string, fx: ActiveEffect[]): number {
  let pct = 0
  for (const a of fx) for (const s of a.e.stats) if (s.stat.trim().toUpperCase() === stat || (stat === 'SPD' && s.stat.trim().toUpperCase() === 'SPEED')) pct += s.percent * a.stacks
  return Math.max(0, base * (1 + pct / 100))
}

/** Puts an effect on a unit by its stacking rule; returns a log note ('' when nothing changed). */
function applyEffect(u: { fx: ActiveEffect[] }, e: StatusEffect, seconds: number | null, t: number): string {
  const len = Math.max(0, seconds ?? e.seconds)
  if (e.cancels.length) u.fx = u.fx.filter((a) => !e.cancels.includes(a.e.id))
  const have = u.fx.find((a) => a.e.id === e.id)
  if (!have) {
    u.fx.push({ e, stacks: 1, until: t + len, nextTick: t + (e.tick?.every ?? 0) })
    return e.name
  }
  if (e.stacking === 'ignore') return ''
  have.until = t + len
  if (e.stacking === 'stronger' && have.stacks < Math.max(1, e.maxStacks)) have.stacks++
  return e.stacking === 'stronger' ? `${e.name} x${have.stacks}` : e.name
}

export function simulateCombat(d: CombatDoc, seed = 1, abilities: SimAbility[] = [], status?: Pick<StatusDoc, 'items' | 'reactions'>): CombatResult {
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
  const effectsById = new Map((status?.items ?? []).map((e) => [e.id, e]))
  if (status) result.effects = { damage: 0, reactions: {} }
  let seconds = 0
  const hpLeft: [number, number] = [0, 0]
  const runs = Math.max(1, Math.min(20000, Math.round(d.runs)))
  for (let run = 0; run < runs; run++) {
    const units = d.teams.flatMap((team, side) =>
      team.flatMap((f) => Array.from({ length: Math.max(0, Math.round(f.count)) }, (_, i) => ({ f, side, hp: f.hp, next: random() / Math.max(0.01, f.speed), ready: {} as Record<Id, number>, fx: [] as ActiveEffect[], aura: null as { element: string; until: number } | null, label: f.count > 1 ? `${f.name} ${i + 1}` : f.name }))),
    )
    const total: [number, number] = [0, 1].map((s) => units.filter((u) => u.side === s).reduce((a, u) => a + u.hp, 0)) as [number, number]
    const log = run === 0 ? result.log : null
    let t = 0
    while (t < MAX_SECONDS) {
      const alive = (s: number) => units.filter((u) => u.side === s && u.hp > 0)
      if (!alive(0).length || !alive(1).length) break
      const actor = units.filter((u) => u.hp > 0).reduce((a, b) => (b.next < a.next ? b : a))
      t = actor.next
      // Ticks up to now, then effects that ran out.
      for (const u of units) {
        if (u.hp <= 0) continue
        for (const a of u.fx) {
          const tick = a.e.tick
          if (!tick || tick.every <= 0) continue
          while (a.nextTick <= Math.min(t, a.until) && u.hp > 0) {
            const amount = tick.amount * a.stacks
            if (tick.heal) u.hp = Math.min(u.f.hp, u.hp + amount)
            else {
              const dmg = amount * resistOf(u.f, a.e.element)
              u.hp -= dmg
              if (result.effects) result.effects.damage += dmg / runs
              if (log && log.length < 60) log.push(`${a.nextTick.toFixed(1)}s ${u.label} takes ${Math.round(dmg)} from ${a.e.name}${u.hp <= 0 ? `, ${u.label} falls` : ''}`)
            }
            a.nextTick += tick.every
          }
        }
        u.fx = u.fx.filter((a) => a.until > t)
        if (u.aura && u.aura.until <= t) u.aura = null
      }
      if (actor.hp <= 0) continue
      actor.next += 1 / Math.max(0.01, withEffects(actor.f.speed, 'SPD', actor.fx))
      if (actor.fx.some((a) => a.e.stops)) {
        if (log && log.length < 60) log.push(`${t.toFixed(1)}s ${actor.label} can't act (${actor.fx.find((a) => a.e.stops)!.e.name})`)
        continue
      }
      const foes = alive(1 - actor.side)
      if (!foes.length) break
      const target = foes.reduce((a, b) => (b.hp < a.hp ? b : a))
      const crit = random() * 100 < withEffects(actor.f.crit, 'CRIT', actor.fx)
      const spread = 1 + ((random() * 2 - 1) * d.spread) / 100
      // The first ability that is ready replaces the basic attack; its formula gets this attacker's ATK and the target's DEF.
      const skill = (actor.f.abilities ?? []).map((id) => skills.get(id)).find((x) => x && (actor.ready[x.a.id] ?? 0) <= t)
      if (skill) actor.ready[skill.a.id] = t + Math.max(0, skill.a.cooldown)
      const att = actor.fx.length ? { ...actor.f, atk: withEffects(actor.f.atk, 'ATK', actor.fx) } : actor.f
      const def = target.fx.length ? { ...target.f, def: withEffects(target.f.def, 'DEF', target.fx) } : target.f
      const raw = skill ? hitDamage(skill.f, { ...skill.a.values }, att, def) : hitDamage(compiled.value, base, att, def)
      let dmg = raw * resistOf(target.f, skill?.a.element ?? '') * spread * (crit ? actor.f.critDamage / 100 : 1)
      // A second element on a target that carries one: look up the reaction.
      const element = skill?.a.element.trim() ?? ''
      let reacted = ''
      if (status && element) {
        const r = target.aura && reactionFor(status, target.aura.element, element)
        if (r) {
          dmg *= r.multiplier
          reacted = r.name
          result.effects!.reactions[r.name] = (result.effects!.reactions[r.name] ?? 0) + 1 / runs
          if (r.consumes) target.aura = null
          const add = r.addsEffectId ? effectsById.get(r.addsEffectId) : undefined
          if (add) applyEffect(target, add, null, t)
        } else target.aura = { element, until: t + AURA_SECONDS }
      }
      target.hp -= dmg
      result.damage[actor.f.id] = (result.damage[actor.f.id] ?? 0) + dmg / runs
      const landed: string[] = []
      if (skill && target.hp > 0) for (const ap of skill.a.applies ?? []) {
        const e = effectsById.get(ap.effectId)
        if (e && random() * 100 < ap.chance) landed.push(applyEffect(target, e, ap.seconds ?? null, t))
      }
      if (log && log.length < 60) log.push(`${t.toFixed(1)}s ${actor.label} ${skill ? `uses ${skill.a.name} on` : 'hits'} ${target.label} for ${Math.round(dmg)}${crit ? ' (crit)' : ''}${reacted ? ` (${reacted}!)` : ''}${landed.filter(Boolean).length ? `, ${landed.filter(Boolean).join(', ')}` : ''}${target.hp <= 0 ? `, ${target.label} falls` : ''}`)
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
