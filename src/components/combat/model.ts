import { newId, type Id } from '@/core/model'
import { defaultValues, getFormula, tryCompile, type CompiledFormula } from '@/shared/formulas'
import { reactionFor, type StatusDoc, type StatusEffect } from '@/components/status-effects/model'

/**
 * Combat simulator (v0.10): two teams fight many times over. Each fighter
 * attacks on its own speed, damage comes from a Damage Calculator formula.
 * 0.35 overhaul: own formulas and presets, extra stats, buffs from fighters,
 * turn-based mode with weakness extra turns, boss phases, waves, time limit.
 */

export interface Fighter {
  id: Id
  name: string
  /** Enemy or character it was taken from, if any. */
  sourceId: Id | null
  hp: number
  atk: number
  def: number
  /** Attacks per second (real time), or who goes first (turn based). */
  speed: number
  /** Percent. */
  crit: number
  critDamage: number
  /** Copies of this fighter on the team. */
  count: number
  /** 0.28: damage taken per element, like the Enemy List's resistances (1 = normal, 0.5 = half, 1.5 = weak). */
  resist?: Record<string, number>
  /** 0.28: Abilities & Spells it uses whenever one is ready, instead of a basic attack. */
  abilities?: Id[]
  /** 0.35: more numbers for formulas (EM, Level, DMG_BONUS...). */
  stats?: Record<string, number>
  /** 0.35: buffs and debuffs this fighter gives while it is alive. */
  buffs?: Buff[]
  /** 0.35: changes below a HP percent (boss phases). */
  phases?: Phase[]
  /** 0.35: wave it enters in (1 = from the start). */
  wave?: number
  /** 0.35: element of its basic attack ('' = none), for weaknesses and resistances. */
  element?: string
}

/**
 * "While this fighter fights: team +20% ATK". `every` 0 = always on, else it
 * comes every `every` seconds (or turns) and lasts `lasts`.
 * Special stats: DMG (damage dealt %), TAKEN (damage taken %).
 */
export interface Buff {
  id: Id
  name: string
  to: 'self' | 'team' | 'enemies'
  stat: string
  percent: number
  flat: number
  every: number
  lasts: number
}

/** Below `below` % HP the fighter changes: stats in percent, other abilities, other resistances. */
export interface Phase {
  id: Id
  name: string
  below: number
  atk: number
  def: number
  speed: number
  abilities: Id[] | null
  resist: Record<string, number> | null
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

/** A Damage Calculator preset, as far as the simulator needs it. */
export interface SimPreset {
  id: Id
  title: string
  expression: string
  values: Record<string, number>
}

export interface CombatDoc {
  teams: [Fighter[], Fighter[]]
  teamNames: [string, string]
  /** A library formula id, `preset:<id>` for a Damage Calculator preset, or `custom` for `expression`. */
  formulaId: string
  /** 0.35: the own formula when `formulaId` is `custom`. */
  expression?: string
  /** Random spread of damage, ± percent. */
  spread: number
  runs: number
  /** 0.35: real time (speed = attacks per second) or turns (rounds in speed order). Missing = real time. */
  mode?: 'realtime' | 'turns'
  /** 0.35, turns: hitting a weakness (resistance above 1) gives one more action that round. */
  weaknessTurn?: boolean
  /** 0.35: the first team must win within this many seconds (or rounds); 0 / missing = no limit. */
  timeLimit?: number
}

export const newFighter = (name = 'Fighter'): Fighter => ({ id: newId(), name, sourceId: null, hp: 100, atk: 20, def: 10, speed: 1, crit: 10, critDamage: 150, count: 1 })
export const newBuff = (): Buff => ({ id: newId(), name: 'Buff', to: 'team', stat: 'ATK', percent: 20, flat: 0, every: 0, lasts: 0 })
export const newPhase = (): Phase => ({ id: newId(), name: 'Enraged', below: 50, atk: 30, def: 0, speed: 0, abilities: null, resist: null })

export const createCombatDoc = (): CombatDoc => ({
  teams: [[newFighter('Hero')], [{ ...newFighter('Slime'), hp: 60, atk: 12, def: 2, speed: 0.8 }]],
  teamNames: ['Players', 'Enemies'],
  formulaId: 'percentage-armor',
  spread: 10,
  runs: 1000,
})

export const PRESET_PREFIX = 'preset:'
export const CUSTOM_FORMULA = 'custom'

/** The basic attack's formula: library, a Damage Calculator preset, or the own one. */
export function basicFormula(d: Pick<CombatDoc, 'formulaId' | 'expression'>, presets: SimPreset[] = []): { expression: string; values: Record<string, number> } | null {
  if (d.formulaId === CUSTOM_FORMULA) return d.expression?.trim() ? { expression: d.expression, values: {} } : null
  if (d.formulaId.startsWith(PRESET_PREFIX)) {
    const p = presets.find((x) => x.id === d.formulaId.slice(PRESET_PREFIX.length))
    return p && p.expression.trim() ? { expression: p.expression, values: p.values } : null
  }
  const lib = getFormula(d.formulaId)
  return lib ? { expression: lib.expression, values: defaultValues(lib) } : null
}

/** Reads "Fire 0.5, Ice 1.5" into resistances. */
export function parseResist(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of text.split(',')) {
    const m = part.trim().match(/^(.+?)\s*[×x*:=]?\s*(-?\d+(?:[.,]\d+)?)$/)
    if (m) out[m[1].trim()] = Number(m[2].replace(',', '.'))
  }
  return out
}
export const resistText = (r?: Record<string, number> | null) => Object.entries(r ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')

/** Values for the formula: the attacker's stats by name (and A_ + name), the target's as T_ + name; DEF is the target's DEF as before. */
export function hitDamage(f: CompiledFormula, base: Record<string, number>, attacker: Fighter, target: Fighter, extra?: { a: Record<string, number>; t: Record<string, number> }): number {
  const vars: Record<string, number> = { ...base }
  // Names nobody filled count as 0 (missingVars tells the person).
  for (const v of f.variables) if (!(v in vars)) vars[v] = 0
  if (extra) {
    for (const [k, v] of Object.entries(extra.a)) {
      vars[k] = v
      vars[`A_${k}`] = v
    }
    for (const [k, v] of Object.entries(extra.t)) vars[`T_${k}`] = v
  }
  vars.ATK = attacker.atk
  vars.DEF = target.def
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
  /** 0.35: fights that hit the time limit. */
  timeouts?: number
  /** 0.35: how long the first team's wins took: fastest 10%, middle, slowest 10%. */
  winTimes?: { fast: number; mid: number; slow: number }
  /** 0.35: seconds, or rounds in turn mode. */
  unit?: 's' | 'rounds'
  /** 0.35: formula numbers a fighter doesn't have (they count as 0). */
  missing?: string[]
}

/** Numbers every fighter has for formulas, plus its extra stats (spaces become _). */
export const fighterVars = (f: Fighter) => ['HP', 'MAXHP', 'SPD', 'CRIT', 'ATK', 'DEF', ...Object.keys(f.stats ?? {}).map((k) => k.trim().replace(/\W+/g, '_'))]

/** "Slime has no MV": formula names a fighter can't fill. */
export function missingVars(d: Pick<CombatDoc, 'teams'>, formulas: { variables: readonly string[]; base: Record<string, number>; users?: Id[] }[]): string[] {
  const out = new Set<string>()
  for (const fm of formulas)
    for (const [side, team] of d.teams.entries())
      for (const f of team) {
        if (fm.users && !fm.users.includes(f.id)) continue
        const own = fighterVars(f)
        const foes = d.teams[1 - side].map(fighterVars)
        for (const v of fm.variables) {
          if (v in fm.base || v === 'ATK' || v === 'DEF') continue
          if (v.startsWith('T_')) {
            if (foes.some((x) => !x.includes(v.slice(2)))) out.add(`${d.teams[1 - side].find((x) => !fighterVars(x).includes(v.slice(2)))!.name} has no ${v.slice(2)} (used as ${v})`)
          } else if (!own.includes(v.startsWith('A_') ? v.slice(2) : v)) out.add(`${f.name} has no ${v}`)
        }
      }
  return [...out].slice(0, 6)
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
const MAX_ROUNDS = 200
/** shortcut: an element hit leaves its element on the target this long for reactions; make it a setting if people ask. */
export const AURA_SECONDS = 8

interface ActiveEffect {
  e: StatusEffect
  stacks: number
  until: number
  nextTick: number
}

interface Unit {
  f: Fighter
  side: number
  hp: number
  next: number
  ready: Record<Id, number>
  fx: ActiveEffect[]
  aura: { element: string; until: number } | null
  label: string
  phase: Phase | null
  wave: number
}

const up = (s: string) => s.trim().toUpperCase()
const STAT_ALIASES: Record<string, string> = { SPEED: 'SPD', 'CRIT DMG': 'CRITDMG', 'CRIT DAMAGE': 'CRITDMG', 'DMG TAKEN': 'TAKEN' }
const norm = (s: string) => STAT_ALIASES[up(s)] ?? up(s)

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

/** Whether a buff with a rhythm is on at time t: on for `lasts` at the start of every `every`. */
export const buffOn = (b: Pick<Buff, 'every' | 'lasts'>, t: number) => b.every <= 0 || t % b.every < Math.max(0, b.lasts)

export function simulateCombat(d: CombatDoc, seed = 1, abilities: SimAbility[] = [], status?: Pick<StatusDoc, 'items' | 'reactions'>, presets: SimPreset[] = []): CombatResult {
  const basic = basicFormula(d, presets)
  const compiled = basic ? tryCompile(basic.expression) : null
  const turns = d.mode === 'turns'
  const empty: CombatResult = { wins: [0, 0], draws: 0, avgSeconds: 0, avgHpLeft: [0, 0], damage: {}, log: [], error: null, unit: turns ? 'rounds' : 's' }
  if (!basic || !compiled?.ok) return { ...empty, error: d.formulaId === CUSTOM_FORMULA && basic && compiled && !compiled.ok ? `Your formula: ${compiled.error.message}` : 'Pick a damage formula.' }
  const base = basic.values
  const random = rng(seed)
  const skills = new Map(abilities.flatMap((a) => {
    const c = tryCompile(a.expression)
    return c.ok ? [[a.id, { a, f: c.value }] as const] : []
  }))
  const result = empty
  const effectsById = new Map((status?.items ?? []).map((e) => [e.id, e]))
  if (status) result.effects = { damage: 0, reactions: {} }
  const limit = d.timeLimit && d.timeLimit > 0 ? d.timeLimit : Infinity
  if (limit < Infinity) result.timeouts = 0
  const winTimes: number[] = []
  let seconds = 0
  const hpLeft: [number, number] = [0, 0]
  const runs = Math.max(1, Math.min(20000, Math.round(d.runs)))
  const anyBuffs = d.teams.some((t) => t.some((f) => f.buffs?.length))
  const missing = missingVars(d, [{ variables: compiled.value.variables, base }, ...[...skills.values()].map((x) => ({ variables: x.f.variables, base: { ...base, ...x.a.values }, users: d.teams.flat().filter((f) => f.abilities?.includes(x.a.id) || f.phases?.some((p) => p.abilities?.includes(x.a.id))).map((f) => f.id) }))])
  if (missing.length) result.missing = missing

  for (let run = 0; run < runs; run++) {
    const units: Unit[] = d.teams.flatMap((team, side) =>
      team.flatMap((f) => Array.from({ length: Math.max(0, Math.round(f.count)) }, (_, i) => ({ f, side, hp: f.hp, next: random() / Math.max(0.01, f.speed), ready: {} as Record<Id, number>, fx: [] as ActiveEffect[], aura: null, label: f.count > 1 ? `${f.name} ${i + 1}` : f.name, phase: null, wave: Math.max(1, Math.round(f.wave ?? 1)) }))),
    )
    const total: [number, number] = [0, 1].map((s) => units.filter((u) => u.side === s).reduce((a, u) => a + u.hp, 0)) as [number, number]
    const log = run === 0 ? result.log : null
    const note = (line: string) => log && log.length < 80 && log.push(line)
    const stamp = (t: number) => (turns ? `R${t}` : `${t.toFixed(1)}s`)
    /** The wave each side is on: the lowest wave that still has someone standing. */
    const wave = [1, 1]
    const waveOf = (s: number) => Math.min(Infinity, ...units.filter((u) => u.side === s && u.hp > 0).map((u) => u.wave))
    const inFight = (u: Unit) => u.hp > 0 && u.wave === wave[u.side]
    const alive = (s: number) => units.filter((u) => u.side === s && inFight(u))
    const sideDown = (s: number) => !units.some((u) => u.side === s && u.hp > 0)
    const resistOf = (u: Unit, element: string) => (element ? (Object.entries(u.phase?.resist ?? u.f.resist ?? {}).find(([k]) => k.toLowerCase() === element.toLowerCase())?.[1] ?? 1) : 1)

    /** Percent and flat changes on a stat from status effects and buffs. */
    const mods = (u: Unit, stat: string, t: number) => {
      let pct = 0
      let flat = 0
      for (const a of u.fx) for (const s of a.e.stats) if (norm(s.stat) === stat) pct += s.percent * a.stacks
      if (anyBuffs)
        for (const g of units) {
          if (!inFight(g) || !g.f.buffs) continue
          for (const b of g.f.buffs) {
            if (norm(b.stat) !== stat || !buffOn(b, t)) continue
            const hits = b.to === 'self' ? g === u : b.to === 'team' ? g.side === u.side : g.side !== u.side
            if (!hits) continue
            pct += b.percent
            flat += b.flat
          }
        }
      return { pct, flat }
    }
    const phaseBase: Record<string, (u: Unit) => number> = {
      ATK: (u) => u.f.atk * (1 + (u.phase?.atk ?? 0) / 100),
      DEF: (u) => u.f.def * (1 + (u.phase?.def ?? 0) / 100),
      SPD: (u) => u.f.speed * (1 + (u.phase?.speed ?? 0) / 100),
      CRIT: (u) => u.f.crit,
      CRITDMG: (u) => u.f.critDamage,
    }
    const stat = (u: Unit, name: string, t: number) => {
      const s = norm(name)
      const b = phaseBase[s]?.(u) ?? Object.entries(u.f.stats ?? {}).find(([k]) => norm(k) === s)?.[1] ?? 0
      const m = mods(u, s, t)
      return Math.max(0, b * (1 + m.pct / 100) + m.flat)
    }
    /** Every number of a unit for formulas: HP is current, MAXHP the start. */
    const allStats = (u: Unit, t: number) => {
      const out: Record<string, number> = { HP: Math.max(0, u.hp), MAXHP: u.f.hp, SPD: stat(u, 'SPD', t), CRIT: stat(u, 'CRIT', t), ATK: stat(u, 'ATK', t), DEF: stat(u, 'DEF', t) }
      for (const k of Object.keys(u.f.stats ?? {})) out[k.trim().replace(/\W+/g, '_')] = stat(u, k, t)
      return out
    }

    const checkPhase = (u: Unit, t: number) => {
      if (!u.f.phases?.length || u.hp <= 0) return
      const pct = (u.hp / Math.max(1, u.f.hp)) * 100
      const next = [...u.f.phases].sort((a, b) => a.below - b.below).find((p) => pct < p.below)
      if (next && next !== u.phase) {
        u.phase = next
        note(`${stamp(t)} ${u.label} enters ${next.name || 'a new phase'}`)
      }
    }

    const ticks = (t: number) => {
      for (const u of units) {
        if (!inFight(u)) continue
        for (const a of u.fx) {
          const tick = a.e.tick
          if (!tick || tick.every <= 0) continue
          while (a.nextTick <= Math.min(t, a.until) && u.hp > 0) {
            const amount = tick.amount * a.stacks
            if (tick.heal) u.hp = Math.min(u.f.hp, u.hp + amount)
            else {
              const dmg = amount * resistOf(u, a.e.element)
              u.hp -= dmg
              if (result.effects) result.effects.damage += dmg / runs
              note(`${stamp(a.nextTick)} ${u.label} takes ${Math.round(dmg)} from ${a.e.name}${u.hp <= 0 ? `, ${u.label} falls` : ''}`)
            }
            a.nextTick += tick.every
          }
          checkPhase(u, t)
        }
        u.fx = u.fx.filter((a) => a.until > t)
        if (u.aura && u.aura.until <= t) u.aura = null
      }
    }

    /** One action; returns true when it hit a weakness. */
    const act = (actor: Unit, t: number): boolean => {
      if (actor.fx.some((a) => a.e.stops)) {
        note(`${stamp(t)} ${actor.label} can't act (${actor.fx.find((a) => a.e.stops)!.e.name})`)
        return false
      }
      const foes = alive(1 - actor.side)
      if (!foes.length) return false
      const target = foes.reduce((a, b) => (b.hp < a.hp ? b : a))
      const crit = random() * 100 < stat(actor, 'CRIT', t)
      const spread = 1 + ((random() * 2 - 1) * d.spread) / 100
      // The first ability that is ready replaces the basic attack; its formula gets this attacker's stats and the target's.
      const skill = (actor.phase?.abilities ?? actor.f.abilities ?? []).map((id) => skills.get(id)).find((x) => x && (actor.ready[x.a.id] ?? 0) <= t)
      if (skill) actor.ready[skill.a.id] = t + Math.max(turns ? 1 : 0, skill.a.cooldown)
      const as = allStats(actor, t)
      const ts = allStats(target, t)
      const att = { ...actor.f, atk: as.ATK }
      const def = { ...target.f, def: ts.DEF }
      const extra = { a: as, t: ts }
      const raw = skill ? hitDamage(skill.f, { ...base, ...skill.a.values }, att, def, extra) : hitDamage(compiled.value, base, att, def, extra)
      const element = (skill ? skill.a.element : (actor.f.element ?? '')).trim()
      const res = resistOf(target, element)
      const bonus = (1 + mods(actor, 'DMG', t).pct / 100) * (1 + mods(target, 'TAKEN', t).pct / 100)
      let dmg = raw * res * Math.max(0, bonus) * spread * (crit ? stat(actor, 'CRITDMG', t) / 100 : 1)
      // A second element on a target that carries one: look up the reaction.
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
      if (skill && target.hp > 0)
        for (const ap of skill.a.applies ?? []) {
          const e = effectsById.get(ap.effectId)
          if (e && random() * 100 < ap.chance) landed.push(applyEffect(target, e, ap.seconds ?? null, t))
        }
      const weak = res > 1
      note(`${stamp(t)} ${actor.label} ${skill ? `uses ${skill.a.name} on` : 'hits'} ${target.label} for ${Math.round(dmg)}${crit ? ' (crit)' : ''}${weak ? ' (weak!)' : ''}${reacted ? ` (${reacted}!)` : ''}${landed.filter(Boolean).length ? `, ${landed.filter(Boolean).join(', ')}` : ''}${target.hp <= 0 ? `, ${target.label} falls` : ''}`)
      checkPhase(target, t)
      return weak
    }

    /** After someone falls: the next wave comes in, starting its clock now. */
    const nextWave = (t: number) => {
      for (const s of [0, 1]) {
        const w = waveOf(s)
        if (w !== Infinity && w !== wave[s]) {
          wave[s] = w
          note(`${stamp(t)} Wave ${w} of ${d.teamNames[s]} comes in`)
          for (const u of units) if (u.side === s && u.wave === w) u.next = t + random() / Math.max(0.01, u.f.speed)
        }
      }
    }

    let t = 0
    nextWave(0)
    if (turns) {
      for (let round = 1; round <= Math.min(MAX_ROUNDS, limit); round++) {
        t = round
        ticks(t)
        nextWave(t)
        if (sideDown(0) || sideDown(1)) break
        const order = units.filter(inFight).map((u) => ({ u, s: stat(u, 'SPD', t) + random() * 1e-6 })).sort((a, b) => b.s - a.s)
        for (const { u } of order) {
          if (!inFight(u)) continue
          const weak = act(u, t)
          nextWave(t)
          if (weak && d.weaknessTurn && inFight(u) && alive(1 - u.side).length) {
            note(`${stamp(t)} ${u.label} gets one more turn`)
            act(u, t)
            nextWave(t)
          }
          if (sideDown(0) || sideDown(1)) break
        }
        if (sideDown(0) || sideDown(1)) break
      }
    } else {
      while (t < MAX_SECONDS) {
        if (sideDown(0) || sideDown(1)) break
        const actor = units.filter(inFight).reduce((a, b) => (b.next < a.next ? b : a))
        if (actor.next > limit) {
          t = limit
          break
        }
        t = actor.next
        ticks(t)
        nextWave(t)
        if (!inFight(actor)) continue
        actor.next += 1 / Math.max(0.01, stat(actor, 'SPD', t))
        act(actor, t)
        nextWave(t)
      }
    }
    const left = [0, 1].map((s) => units.filter((u) => u.side === s && u.hp > 0).reduce((a, u) => a + u.hp, 0))
    if (left[0] > 0 && left[1] <= 0) {
      result.wins[0]++
      hpLeft[0] += left[0] / total[0]
      winTimes.push(t)
    } else if (left[1] > 0 && left[0] <= 0) {
      result.wins[1]++
      hpLeft[1] += left[1] / total[1]
    } else {
      result.draws++
      if (result.timeouts !== undefined && t >= Math.min(limit, turns ? MAX_ROUNDS : MAX_SECONDS) - 1e-9) {
        result.timeouts++
        note(`${stamp(t)} Time is up`)
      }
    }
    seconds += t
  }
  result.avgSeconds = seconds / runs
  result.avgHpLeft = [result.wins[0] ? hpLeft[0] / result.wins[0] : 0, result.wins[1] ? hpLeft[1] / result.wins[1] : 0]
  if (winTimes.length) {
    winTimes.sort((a, b) => a - b)
    const at = (q: number) => winTimes[Math.min(winTimes.length - 1, Math.floor(q * winTimes.length))]
    result.winTimes = { fast: at(0.1), mid: at(0.5), slow: at(0.9) }
  }
  return result
}

export const SUMMARY_WORDS = {
  rounds: ' rounds',
  seconds: ' s',
  win: (team: string, pct: string) => `${team} win ${pct} of fights`,
  usually: (mid: string, fast: string, slow: string) => `, usually in ${mid} (fastest ${fast}, slowest ${slow})`,
  otherWin: (team: string, pct: string) => `${team} win ${pct}.`,
  timeout: (pct: string, limit: string) => `${pct} run out of time (${limit}).`,
  draw: (pct: string) => `${pct} end without a winner.`,
}

/** Results in one plain sentence (words can be another language). */
export function summary(d: Pick<CombatDoc, 'teamNames' | 'timeLimit'>, r: CombatResult, w: typeof SUMMARY_WORDS = SUMMARY_WORDS): string {
  const n = r.wins[0] + r.wins[1] + r.draws
  if (!n) return ''
  const pct = (x: number) => `${Math.round((x / n) * 100)}%`
  const unit = r.unit === 'rounds' ? w.rounds : w.seconds
  const time = (x: number) => `${r.unit === 'rounds' ? Math.round(x) : x.toFixed(1)}${unit}`
  const parts = [`${w.win(d.teamNames[0] || 'Team 1', pct(r.wins[0]))}${r.winTimes ? w.usually(time(r.winTimes.mid), time(r.winTimes.fast), time(r.winTimes.slow)) : ''}.`]
  if (r.wins[1]) parts.push(w.otherWin(d.teamNames[1] || 'Team 2', pct(r.wins[1])))
  if (r.timeouts) parts.push(w.timeout(pct(r.timeouts), time(d.timeLimit ?? 0)))
  else if (r.draws) parts.push(w.draw(pct(r.draws)))
  return parts.join(' ')
}

// ---- Examples (0.35): made-up teams, nothing copied from real games -------------------------------

/** Abyss-style: four elemental characters with supports against two waves, 60 s to clear. */
export function exampleElementalTeam(): CombatDoc {
  const f = (name: string, p: Partial<Fighter>): Fighter => ({ ...newFighter(name), crit: 50, critDamage: 200, ...p })
  return {
    teamNames: ['Party', 'Floor 12, first half'],
    formulaId: CUSTOM_FORMULA,
    expression: 'ATK * MV / 100 * (1 + EM / 1000) * 500 / (500 + T_DEF)',
    spread: 5,
    runs: 500,
    timeLimit: 60,
    teams: [
      [
        f('Main damage', { hp: 15000, atk: 2100, def: 800, speed: 1.4, stats: { MV: 180, EM: 100 } }),
        f('Second damage', { hp: 18000, atk: 1700, def: 900, speed: 1, stats: { MV: 150, EM: 300 } }),
        f('Buffer', { hp: 20000, atk: 900, def: 900, speed: 0.5, crit: 5, critDamage: 50, stats: { MV: 60, EM: 0 }, buffs: [{ ...newBuff(), name: 'Attack song', to: 'team', stat: 'ATK', percent: 0, flat: 1000, every: 15, lasts: 12 }] }),
        f('Shredder', { hp: 19000, atk: 1100, def: 850, speed: 0.6, crit: 5, critDamage: 50, stats: { MV: 80, EM: 800 }, buffs: [{ ...newBuff(), name: 'Resistance shred', to: 'enemies', stat: 'TAKEN', percent: 25, flat: 0, every: 0, lasts: 0 }, { ...newBuff(), name: 'Element mastery share', to: 'team', stat: 'EM', percent: 0, flat: 200, every: 20, lasts: 8 }] }),
      ],
      [
        { ...newFighter('Stone guardian'), hp: 300000, atk: 1500, def: 950, speed: 0.4, crit: 0, wave: 1, stats: { MV: 100, EM: 0 } },
        { ...newFighter('Small drone'), hp: 60000, atk: 900, def: 900, speed: 0.8, crit: 0, count: 3, wave: 2, stats: { MV: 100, EM: 0 } },
      ],
    ],
  }
}

/** Persona-style: four party members against a boss with weaknesses and a second phase, turn based. */
export function exampleTurnBoss(): CombatDoc {
  const f = (name: string, p: Partial<Fighter>): Fighter => ({ ...newFighter(name), crit: 10, critDamage: 150, ...p })
  return {
    teamNames: ['Team', 'Boss'],
    formulaId: CUSTOM_FORMULA,
    expression: 'sqrt(ATK) * POWER * (1 + Level / 100) / sqrt(max(1, T_DEF))',
    spread: 5,
    runs: 1000,
    mode: 'turns',
    weaknessTurn: true,
    timeLimit: 30,
    teams: [
      [
        f('Leader', { element: 'Physical', hp: 450, atk: 90, def: 60, speed: 60, stats: { POWER: 60, Level: 60 } }),
        f('Bruiser', { element: 'Physical', hp: 520, atk: 110, def: 70, speed: 45, stats: { POWER: 70, Level: 58 } }),
        f('Caster', { element: 'Fire', hp: 380, atk: 120, def: 45, speed: 55, stats: { POWER: 75, Level: 58 }, buffs: [{ ...newBuff(), name: 'Defence down', to: 'enemies', stat: 'DEF', percent: -40, flat: 0, every: 4, lasts: 3 }] }),
        f('Healer', { element: 'Wind', hp: 400, atk: 70, def: 55, speed: 50, stats: { POWER: 40, Level: 57 }, buffs: [{ ...newBuff(), name: 'Attack up', to: 'team', stat: 'ATK', percent: 40, flat: 0, every: 4, lasts: 3 }] }),
      ],
      [
        {
          ...newFighter('Golden judge'),
          hp: 4500,
          atk: 60,
          def: 80,
          speed: 52,
          crit: 5,
          stats: { POWER: 80, Level: 65 },
          resist: { Physical: 1.5, Ice: 0.5 },
          phases: [{ ...newPhase(), name: 'Second form (no more weakness)', below: 50, atk: 40, def: 0, speed: 20, resist: { Physical: 1, Ice: 0.5 } }],
        },
      ],
    ],
  }
}
