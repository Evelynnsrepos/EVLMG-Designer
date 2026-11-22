import { describe, expect, it } from 'vitest'
import { buffOn, createCombatDoc, CUSTOM_FORMULA, exampleElementalTeam, exampleTurnBoss, newBuff, newFighter, newPhase, PRESET_PREFIX, simulateCombat, summary, type Fighter } from './model'

describe('combat simulator', () => {
  it('a much stronger side always wins', () => {
    const d = { ...createCombatDoc(), runs: 200, teams: [[{ ...newFighter('Knight'), hp: 500, atk: 80 }], [{ ...newFighter('Rat'), hp: 20, atk: 5 }]] as [ReturnType<typeof newFighter>[], ReturnType<typeof newFighter>[]] }
    const r = simulateCombat(d)
    expect(r.wins[0]).toBe(200)
    expect(r.avgHpLeft[0]).toBeGreaterThan(0.9)
    expect(r.log.length).toBeGreaterThan(0)
  })

  it('mirror fights are roughly even and counts add fighters', () => {
    const f = newFighter('Duelist')
    const r = simulateCombat({ ...createCombatDoc(), runs: 2000, teams: [[f], [{ ...f, id: 'b' }]] })
    expect(r.wins[0] / 2000).toBeGreaterThan(0.4)
    expect(r.wins[0] / 2000).toBeLessThan(0.6)
    const swarm = simulateCombat({ ...createCombatDoc(), runs: 200, teams: [[f], [{ ...f, id: 'c', count: 5 }]] })
    expect(swarm.wins[1]).toBeGreaterThan(190)
    expect(simulateCombat({ ...createCombatDoc(), formulaId: 'nope' }).error).toBeTruthy()
  })

  it('uses abilities when ready and resistances per element (0.28)', () => {
    type T = [ReturnType<typeof newFighter>[], ReturnType<typeof newFighter>[]]
    const dummy = { ...newFighter('Dummy'), hp: 1e9, atk: 0, def: 0, speed: 0.01, crit: 0 }
    const mage = { ...newFighter('Mage'), atk: 10, def: 0, speed: 1, crit: 0, abilities: ['fb'] }
    const fireball = { id: 'fb', name: 'Fireball', element: 'Fire', cooldown: 3, expression: 'ATK * 5', values: {} }
    const fight = (resist?: Record<string, number>) => simulateCombat({ ...createCombatDoc(), spread: 0, runs: 1, teams: [[mage], [{ ...dummy, resist }]] as T }, 1, [fireball])
    const plain = fight()
    expect(plain.log.filter((l) => l.includes('uses Fireball')).length).toBeGreaterThan(0)
    // Fireball every 3 s, basic hits in between: more fireballs would mean the cooldown is ignored.
    const casts = plain.log.filter((l) => l.includes('uses Fireball')).length
    const hits = plain.log.filter((l) => l.includes(' hits ')).length
    expect(hits).toBeGreaterThan(casts)
    const half = fight({ fire: 0.5 })
    expect(half.damage[mage.id]).toBeLessThan(plain.damage[mage.id])
    expect(half.log.find((l) => l.includes('Fireball'))).toContain('for 25')
  })
})

describe('combat simulator 0.35', () => {
  type T = [Fighter[], Fighter[]]
  const dummy = (p: Partial<Fighter> = {}): Fighter => ({ ...newFighter('Dummy'), hp: 1e9, atk: 0, def: 0, speed: 0.01, crit: 0, ...p })
  const base = { ...createCombatDoc(), spread: 0, runs: 1 }

  it('own formula with extra stats, T_ numbers, and missing names reported', () => {
    const a = { ...newFighter('A'), atk: 10, crit: 0, speed: 1, stats: { EM: 5 } }
    const r = simulateCombat({ ...base, formulaId: CUSTOM_FORMULA, expression: 'ATK + EM + T_Level', teams: [[a], [dummy({ stats: { Level: 3 } })]] as T })
    expect(r.log[0]).toContain('for 18')
    expect(r.missing).toEqual(['Dummy has no EM', 'A has no Level (used as T_Level)'])
    expect(simulateCombat({ ...base, formulaId: CUSTOM_FORMULA, expression: 'ATK +' }).error).toContain('Your formula')
    const preset = { id: 'p1', title: 'P', expression: 'ATK * K', values: { K: 3 } }
    expect(simulateCombat({ ...base, formulaId: PRESET_PREFIX + 'p1', teams: [[a], [dummy()]] as T }, 1, [], undefined, [preset]).log[0]).toContain('for 30')
  })

  it('buffs: team ATK on a rhythm, damage taken on enemies', () => {
    const a = { ...newFighter('A'), atk: 10, crit: 0, speed: 1 }
    const doc = (buffs: Fighter['buffs']) => ({ ...base, formulaId: CUSTOM_FORMULA, expression: 'ATK', teams: [[{ ...a, buffs }], [dummy()]] as T, timeLimit: 10 })
    const plain = simulateCombat(doc([]))
    const always = simulateCombat(doc([{ ...newBuff(), stat: 'ATK', percent: 100 }]))
    const half = simulateCombat(doc([{ ...newBuff(), stat: 'ATK', percent: 100, every: 2, lasts: 1 }]))
    const taken = simulateCombat(doc([{ ...newBuff(), to: 'enemies', stat: 'TAKEN', percent: 50 }]))
    expect(always.damage[a.id]).toBeCloseTo(plain.damage[a.id] * 2)
    expect(half.damage[a.id]).toBeGreaterThan(plain.damage[a.id])
    expect(half.damage[a.id]).toBeLessThan(always.damage[a.id])
    expect(taken.damage[a.id]).toBeCloseTo(plain.damage[a.id] * 1.5)
    expect(buffOn({ every: 10, lasts: 3 }, 12)).toBe(true)
    expect(buffOn({ every: 10, lasts: 3 }, 14)).toBe(false)
  })

  it('turn based: speed order, weakness gives one more turn, time limit', () => {
    const fast = { ...newFighter('Fast'), atk: 1, crit: 0, speed: 50, element: 'Fire' }
    const r = simulateCombat({ ...base, mode: 'turns', weaknessTurn: true, timeLimit: 3, formulaId: CUSTOM_FORMULA, expression: 'ATK', teams: [[fast], [dummy({ speed: 10, atk: 1, resist: { fire: 2 } })]] as T })
    expect(r.unit).toBe('rounds')
    expect(r.log[0]).toMatch(/^R1 Fast hits/)
    expect(r.log[1]).toContain('one more turn')
    expect(r.timeouts).toBe(1)
    expect(summary(base, r)).toContain('run out of time')
  })

  it('boss phases and waves', () => {
    const hero = { ...newFighter('Hero'), hp: 1e6, atk: 10, crit: 0, speed: 1 }
    const boss = { ...newFighter('Boss'), hp: 100, atk: 1, def: 0, crit: 0, speed: 1, phases: [{ ...newPhase(), name: 'Rage', below: 50, atk: 900 }] }
    const r = simulateCombat({ ...base, formulaId: CUSTOM_FORMULA, expression: 'ATK', teams: [[hero], [boss, { ...newFighter('Add'), hp: 10, def: 0, crit: 0, wave: 2 }]] as T })
    expect(r.log.some((l) => l.includes('enters Rage'))).toBe(true)
    expect(r.log.some((l) => l.includes('Boss hits Hero for 10'))).toBe(true)
    expect(r.log.some((l) => l.includes('Wave 2'))).toBe(true)
    expect(r.wins[0]).toBe(1)
  })

  it('examples run and give readable results', () => {
    for (const ex of [exampleElementalTeam(), exampleTurnBoss()]) {
      const r = simulateCombat({ ...ex, runs: 50 })
      expect(r.error).toBeNull()
      expect(r.missing).toBeUndefined()
      expect(r.wins[0] + r.wins[1] + r.draws).toBe(50)
      expect(Object.values(r.damage).some((v) => v > 0)).toBe(true)
    }
  })
})
