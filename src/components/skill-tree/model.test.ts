import { describe, expect, it } from 'vitest'
import { cannotAdd, cannotRankClass, cannotRemove, classLoop, createSkillTreeDoc, freeCell, inheritable, learned, newClass, newSkill, spent, wouldLoop, type SkillTreeDoc } from './model'

function tree(): SkillTreeDoc {
  const a = { ...newSkill('Slash'), maxRank: 3 }
  const b = { ...newSkill('Whirlwind'), requires: [a.id], cost: 2 }
  const c = { ...newSkill('Rage'), pointsNeeded: 3 }
  return { ...createSkillTreeDoc(), skills: [a, b, c], budget: { start: 0, perLevel: 1, level: 6 } }
}

describe('skill tree', () => {
  it('needs required skills, points spent and enough points', () => {
    const d = tree()
    const [a, b, c] = d.skills
    expect(cannotAdd(d, b.id)).toMatch(/Slash/)
    expect(cannotAdd(d, c.id)).toMatch(/3 points/)
    const withA = { ...d, plan: { [a.id]: 3 } }
    expect(cannotAdd(withA, a.id)).toMatch(/max rank/)
    expect(cannotAdd(withA, b.id)).toBeNull()
    expect(cannotAdd(withA, c.id)).toBeNull()
    const full = { ...withA, plan: { ...withA.plan, [b.id]: 1, [c.id]: 1 } }
    expect(spent(full)).toBe(6)
    expect(cannotAdd({ ...full, skills: [...full.skills, newSkill('X')] }, 'nope')).toBe('Unknown skill')
  })

  it('cannot take back what others build on', () => {
    const d = tree()
    const [a, b, c] = d.skills
    const p = { ...d, plan: { [a.id]: 3, [b.id]: 1, [c.id]: 1 } }
    expect(cannotRemove({ ...p, plan: { [a.id]: 3, [c.id]: 1 } }, a.id)).toMatch(/Rage needs 3/)
    expect(cannotRemove({ ...p, plan: { [a.id]: 1, [b.id]: 1 } }, a.id)).toMatch(/Whirlwind/)
    expect(cannotRemove(p, b.id)).toBeNull()
  })

  it('spots loops', () => {
    const [a, b] = tree().skills
    expect(wouldLoop([a, b], a.id, b.id)).toBe(true)
    expect(wouldLoop([a, b], b.id, a.id)).toBe(false)
  })
})

describe('boards and archetypes', () => {
  it('builds out from start cells on a board', () => {
    const a = { ...newSkill('Start'), start: true, cell: { x: 0, y: 0 } }
    const b = { ...newSkill('B'), cell: { x: 1, y: 0 } }
    const c = { ...newSkill('C'), cell: { x: 2, y: 0 } }
    const d: SkillTreeDoc = { ...createSkillTreeDoc(), layout: 'board', skills: [a, b, c], budget: { start: 10, perLevel: 0, level: 0 } }
    expect(cannotAdd(d, c.id)).toMatch(/neighbour/)
    const p = { ...d, plan: { [a.id]: 1, [b.id]: 1 } }
    expect(cannotAdd(p, c.id)).toBeNull()
    expect(cannotRemove({ ...p, plan: { ...p.plan, [c.id]: 1 } }, b.id)).toMatch(/C would lose/)
    expect(freeCell([a, b, c], 8)).toEqual({ x: 3, y: 0 })
  })

  it('needs any one of several skills', () => {
    const a = newSkill('A')
    const b = newSkill('B')
    const c = { ...newSkill('C'), requires: [a.id, b.id], requireAny: true }
    const d: SkillTreeDoc = { ...createSkillTreeDoc(), skills: [a, b, c], budget: { start: 10, perLevel: 0, level: 0 }, plan: { [b.id]: 1 } }
    expect(cannotAdd(d, c.id)).toBeNull()
    expect(cannotAdd({ ...d, plan: {} }, c.id)).toMatch(/A or B/)
    expect(cannotRemove({ ...d, plan: { [a.id]: 1, [b.id]: 1, [c.id]: 1 } }, a.id)).toBeNull()
  })

  it('learns class skills by archetype rank and gates advanced archetypes', () => {
    const warrior = { ...newClass('Warrior'), maxRank: 20 }
    const gladiator = { ...newClass('Gladiator'), requires: [{ classId: warrior.id, rank: 20 }] }
    const cleave = { ...newSkill('Cleave'), classId: warrior.id, learnAt: 3, inheritable: true, cost: 5 }
    const d: SkillTreeDoc = { ...createSkillTreeDoc(), skills: [cleave], classes: [warrior, gladiator], classPlan: { [warrior.id]: 2 } }
    expect(learned(d)).toEqual([])
    expect(cannotAdd(d, cleave.id)).toMatch(/Warrior rank 3/)
    expect(cannotRankClass(d, gladiator.id)).toMatch(/Warrior rank 20/)
    const d2 = { ...d, classPlan: { [warrior.id]: 3 }, equipped: gladiator.id }
    expect(learned(d2)).toEqual([cleave])
    expect(inheritable(d2)).toEqual([cleave])
    expect(spent(d2)).toBe(0)
    expect(classLoop([warrior, gladiator], warrior.id, gladiator.id)).toBe(true)
  })
})
