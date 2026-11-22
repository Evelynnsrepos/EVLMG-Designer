import { describe, expect, it } from 'vitest'
import { minecraftPack, newAchievement, platformChecks, suggestApiName, summary, toRows, wouldLoop } from './model'

describe('achievements', () => {
  it('sums points and counts hidden, rare and common ones', () => {
    const list = [
      { ...newAchievement(), points: 50, expectedPercent: 5, hidden: true },
      { ...newAchievement(), points: 10, expectedPercent: 80 },
    ]
    expect(summary(list)).toEqual({ count: 2, points: 60, hidden: 1, rare: 1, common: 1 })
  })

  it('checks platform rules', () => {
    const a = { ...newAchievement(), name: 'Slime Bane', apiName: 'ACH_X', description: 'd', trophy: 'platinum' as const }
    const b = { ...newAchievement(), apiName: 'ACH_X', description: 'd', trophy: 'platinum' as const, requires: [a.id] }
    const texts = platformChecks([a, b], ['steam', 'playstation']).map((c) => c.text)
    expect(texts).toContain('API names used twice: ACH_X.')
    expect(texts).toContain('Only one platinum trophy is allowed, you have 2.')
    expect(suggestApiName('Slime Bane!')).toBe('ACH_SLIME_BANE')
    expect(wouldLoop([a, b], a.id, b.id)).toBe(true)
    expect(toRows([a, b])[2][11]).toBe('ACH_X')
  })

  it('writes a Minecraft datapack with parents', () => {
    const root = { ...newAchievement(), name: 'Story Start', mcIcon: 'minecraft:grass_block' }
    const child = { ...newAchievement(), name: 'Story Start', requires: [root.id], frame: 'goal' as const }
    const files = minecraftPack([root, child], 'My Game')
    expect(Object.keys(files).sort()).toEqual(['data/my_game/advancement/story_start.json', 'data/my_game/advancement/story_start_2.json', 'pack.mcmeta'])
    const c = JSON.parse(files['data/my_game/advancement/story_start_2.json'])
    expect(c.parent).toBe('my_game:story_start')
    expect(c.display.frame).toBe('goal')
    expect(JSON.parse(files['data/my_game/advancement/story_start.json']).display.background).toBeTruthy()
  })
})
