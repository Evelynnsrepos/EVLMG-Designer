import { describe, expect, it } from 'vitest'
import { createCombatDoc, newFighter, simulateCombat } from './model'

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
