import { describe, expect, it } from 'vitest'
import { checks, defaultSettings, newAchievement, newGroup, removeAchievement, SETUPS, settingsOf, suggestApiName, summary, toRows, treePack, wouldLoop } from './model'

const setup = (...ids: string[]) => ids.reduce((s, id) => SETUPS.find((x) => x.id === id)!.apply(s), defaultSettings())

describe('achievements', () => {
  it('sums points and counts hidden, rare and common ones', () => {
    const list = [
      { ...newAchievement(), points: 50, expectedPercent: 5, hidden: true },
      { ...newAchievement(), points: 10, expectedPercent: 80 },
    ]
    expect(summary(list)).toEqual({ count: 2, points: 60, hidden: 1, rare: 1, common: 1 })
  })

  it('checks what the settings ask for', () => {
    const s = setup('xbox', 'playstation')
    const dlc = newGroup('DLC')
    const a = { ...newAchievement(), name: 'Slime Bane', apiName: 'ACH_X', description: 'd', grade: 'Platinum', points: 990 }
    const b = { ...newAchievement(), apiName: 'ACH_X', description: 'd', grade: 'Platinum', needs: [a.id], needsAllOthers: true }
    const c = { ...newAchievement(), apiName: 'ACH_C', description: 'd', grade: 'Platinum', needsAllOthers: true, groupId: dlc.id }
    const t = checks([a, b, c], { ...s, groups: [dlc] })
    expect(t).toContain('API names used twice: ACH_X.')
    expect(t).toContain('Only one Platinum per group; the base game has 2.')
    expect(t).toContain('Platinum should need all other achievements: Slime Bane.')
    expect(t.some((x) => x.startsWith('The base game has 1000'))).toBe(false)
    expect(settingsOf(undefined).pointsName).toBe('Points')
    expect(suggestApiName('Slime Bane!')).toBe('ACH_SLIME_BANE')
  })

  it('keeps links consistent', () => {
    const a = newAchievement()
    const b = { ...newAchievement(), needs: [a.id] }
    const c = { ...newAchievement(), parentId: b.id }
    expect(wouldLoop([a, b, c], a.id, c.id)).toBe(true)
    const left = removeAchievement([a, b, c], b.id)
    expect(left.map((x) => x.parentId ?? null)).toEqual([null, null])
    expect(toRows([a, b], defaultSettings(), () => '')[2][11]).toBe(a.name)
  })

  it('writes a tree data pack with parents, frames and fields', () => {
    const s = setup('tree')
    const icon = s.fields.find((f) => f.name === 'Icon id')!
    const root = { ...newAchievement(), name: 'Story Start', custom: { [icon.id]: 'minecraft:grass_block' } }
    const child = { ...newAchievement(), name: 'Story Start', parentId: root.id, frame: 'Goal' }
    const files = treePack([root, child], { ...s, namespace: 'My Game' })
    expect(Object.keys(files).sort()).toEqual(['data/my_game/advancement/story_start.json', 'data/my_game/advancement/story_start_2.json', 'pack.mcmeta'])
    const c = JSON.parse(files['data/my_game/advancement/story_start_2.json'])
    expect(c.parent).toBe('my_game:story_start')
    expect(c.display.frame).toBe('goal')
    expect(JSON.parse(files['data/my_game/advancement/story_start.json']).display.icon.id).toBe('minecraft:grass_block')
  })
})
