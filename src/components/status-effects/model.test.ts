import { describe, expect, it } from 'vitest'
import { createCombatDoc, newFighter, simulateCombat, type Fighter } from '@/components/combat/model'
import { allElements, effectTotal, emptyStatusDoc, exampleStatusDoc, newEffect, reactionFor } from './model'

type Teams = [Fighter[], Fighter[]]
const dummy = { ...newFighter('Dummy'), hp: 1e9, atk: 0, def: 0, speed: 0.01, crit: 0 }
const mage = { ...newFighter('Mage'), atk: 10, def: 0, speed: 1, crit: 0, abilities: ['a'] }
const fight = (ability: object, status?: ReturnType<typeof exampleStatusDoc>, target: Fighter = dummy) =>
  simulateCombat({ ...createCombatDoc(), spread: 0, runs: 1, teams: [[mage], [target]] as Teams }, 1, [{ id: 'a', name: 'Spell', element: '', cooldown: 1, expression: 'ATK', values: {}, ...ability }], status)

describe('status effects', () => {
  it('totals ticks over the duration and caps stacks', () => {
    const burn = { ...newEffect('Burn'), seconds: 6, maxStacks: 3, tick: { amount: 3, every: 1, heal: false } }
    expect(effectTotal(burn)).toEqual({ ticks: 6, total: 18 })
    expect(effectTotal(burn, 5).total).toBe(54)
  })

  it('finds reactions and elements case-insensitively', () => {
    const d = exampleStatusDoc()
    expect(reactionFor(d, 'water', 'LIGHTNING')?.name).toBe('Electrocute')
    expect(allElements(d, ['fire', 'Wind'])).toContain('Wind')
    expect(allElements(d, ['fire']).filter((e) => e.toLowerCase() === 'fire')).toHaveLength(1)
  })

  it('combat: burn ticks add damage, chance 0 adds none, no doc = as before', () => {
    const d = exampleStatusDoc()
    const burn = d.items.find((e) => e.name === 'Burn')!
    const withBurn = fight({ applies: [{ effectId: burn.id, chance: 100 }] }, d)
    expect(withBurn.effects!.damage).toBeGreaterThan(0)
    expect(withBurn.log.some((l) => l.includes('from Burn'))).toBe(true)
    expect(fight({ applies: [{ effectId: burn.id, chance: 0 }] }, d).effects!.damage).toBe(0)
    const before = fight({})
    expect(before.effects).toBeUndefined()
    expect(fight({}, emptyStatusDoc()).damage).toEqual(before.damage)
  })

  it('combat: stun skips turns, reactions trigger and multiply', () => {
    const d = exampleStatusDoc()
    const stun = d.items.find((e) => e.name === 'Stun')!
    const target = { ...dummy, speed: 1, atk: 1 }
    const r = fight({ applies: [{ effectId: stun.id, chance: 100, seconds: 5 }] }, d, target)
    expect(r.log.some((l) => l.includes("can't act"))).toBe(true)
    // Water then Lightning: two abilities alternating.
    const wet = { id: 'w', name: 'Splash', element: 'Water', cooldown: 2, expression: 'ATK', values: {} }
    const zap = { id: 'z', name: 'Zap', element: 'Lightning', cooldown: 2, expression: 'ATK', values: {} }
    const duo = simulateCombat({ ...createCombatDoc(), spread: 0, runs: 1, teams: [[{ ...mage, abilities: ['w', 'z'] }], [dummy]] as Teams }, 1, [wet, zap], d)
    expect(duo.effects!.reactions.Electrocute).toBeGreaterThan(0)
    expect(duo.log.some((l) => l.includes('Electrocute!') && l.includes('for 20'))).toBe(true)
  })

  it('wet removes burn', () => {
    const d = exampleStatusDoc()
    const burn = d.items.find((e) => e.name === 'Burn')!
    const wet = d.items.find((e) => e.name === 'Wet')!
    const both = simulateCombat(
      { ...createCombatDoc(), spread: 0, runs: 1, teams: [[{ ...mage, abilities: ['b', 'w'] }], [dummy]] as Teams },
      1,
      [
        { id: 'b', name: 'Ignite', element: '', cooldown: 4, expression: '0', values: {}, applies: [{ effectId: burn.id, chance: 100 }] },
        { id: 'w', name: 'Douse', element: '', cooldown: 4, expression: '0', values: {}, applies: [{ effectId: wet.id, chance: 100 }] },
      ],
      d,
    )
    const alone = fight({ expression: '0', cooldown: 4, applies: [{ effectId: burn.id, chance: 100 }] }, d)
    expect(both.effects!.damage).toBeLessThan(alone.effects!.damage)
  })
})
