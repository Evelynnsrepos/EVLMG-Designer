import { describe, expect, it } from 'vitest'
import {
  cannotAdd,
  cannotRankGroup,
  cannotRemove,
  cannotUnrankGroup,
  carryable,
  createSkillTreeDoc,
  freeCell,
  fullTreeCost,
  groupLoop,
  learned,
  newCurrency,
  newGroup,
  newSkill,
  normalizeSkillTree,
  spent,
  spentOf,
  wouldLoop,
  type SkillTreeDoc,
} from './model'

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

describe('building blocks', () => {
  it('opens grid cells next to learned ones from start cells', () => {
    const a = { ...newSkill('Start'), start: true, cell: { x: 0, y: 0 } }
    const b = { ...newSkill('B'), cell: { x: 1, y: 0 } }
    const c = { ...newSkill('C'), cell: { x: 2, y: 0 } }
    const d: SkillTreeDoc = { ...createSkillTreeDoc(), layout: 'grid', skills: [a, b, c], budget: { start: 10, perLevel: 0, level: 0 } }
    expect(cannotAdd(d, c.id)).toMatch(/neighbour/)
    expect(cannotAdd({ ...d, gridOpensNext: false }, c.id)).toBeNull()
    const p = { ...d, plan: { [a.id]: 1, [b.id]: 1 } }
    expect(cannotAdd(p, c.id)).toBeNull()
    expect(cannotRemove({ ...p, plan: { ...p.plan, [c.id]: 1 } }, b.id)).toMatch(/C would lose/)
    expect(freeCell([a, b, c], 8)).toEqual({ x: 3, y: 0 })
  })

  it('needs N of several skills, a level, and the right currency', () => {
    const a = newSkill('A')
    const b = newSkill('B')
    const c = newSkill('C')
    const gems = { ...newCurrency('Gems'), start: 1 }
    const d1 = { ...newSkill('D'), requires: [a.id, b.id, c.id], needCount: 2, minLevel: 5, currencyId: gems.id, cost: 1 }
    const d: SkillTreeDoc = { ...createSkillTreeDoc(), skills: [a, b, c, d1], currencies: [gems], budget: { start: 10, perLevel: 0, level: 3 }, plan: { [a.id]: 1 } }
    expect(cannotAdd(d, d1.id)).toMatch(/1 more of: B, C/)
    const two = { ...d, plan: { [a.id]: 1, [c.id]: 1 } }
    expect(cannotAdd(two, d1.id)).toMatch(/level 5/)
    const lvl = { ...two, budget: { ...two.budget, level: 5 } }
    expect(cannotAdd(lvl, d1.id)).toBeNull()
    const bought = { ...lvl, plan: { ...lvl.plan, [d1.id]: 1 } }
    expect(spentOf(bought, gems.id)).toBe(1)
    expect(spentOf(bought)).toBe(2)
    expect(cannotRemove({ ...bought, plan: { ...bought.plan, [b.id]: 1 } }, a.id)).toBeNull()
    expect(cannotRemove(bought, a.id)).toMatch(/D needs it/)
    expect(fullTreeCost(normalizeSkillTree(d))).toBe('3 points + 1 Gems')
  })

  it('teaches skills by group rank, gates groups, and carries skills', () => {
    const first = { ...newGroup('First'), maxRank: 20 }
    const second = { ...newGroup('Second'), requires: [{ groupId: first.id, rank: 20 }], unlockCost: 5 }
    const cleave = { ...newSkill('Cleave'), groupId: first.id, learnAt: 3, carryable: true, cost: 5 }
    const d: SkillTreeDoc = { ...createSkillTreeDoc(), skills: [cleave], groups: [first, second], groupRanks: { [first.id]: 2 }, budget: { start: 0, perLevel: 0, level: 1 } }
    expect(learned(d)).toEqual([])
    expect(cannotAdd(d, cleave.id)).toMatch(/First rank 3/)
    expect(cannotRankGroup(d, second.id)).toMatch(/First rank 20/)
    const d20 = { ...d, groupRanks: { [first.id]: 20 } }
    expect(cannotRankGroup(d20, second.id)).toMatch(/Not enough points/)
    const rich = { ...d20, budget: { ...d20.budget, start: 10 } }
    expect(cannotRankGroup(rich, second.id)).toBeNull()
    const both = { ...rich, groupRanks: { [first.id]: 20, [second.id]: 1 }, activeGroup: second.id }
    expect(spentOf(both)).toBe(5)
    expect(cannotUnrankGroup(both, first.id)).toMatch(/Second needs it/)
    expect(carryable(both)).toEqual([cleave])
    expect(spent(both)).toBe(0)
    expect(groupLoop([first, second], first.id, second.id)).toBe(true)
  })
})
