import { describe, expect, it } from 'vitest'
import { createEntity } from '@/core/model'
import { assetPaths, buildExport, customListRecords, ident, type ExportInput } from './build'

const input = (): ExportInput => {
  const sword = { ...createEntity('item'), name: 'Fire Sword', stats: { ATK: 12 }, categories: { c1: 'Rare' } }
  const sword2 = { ...createEntity('item'), name: 'Fire Sword', stats: {} }
  return {
    projectName: 'Test',
    entities: { item: [sword, sword2], character: [], town: [], enemy: [] },
    categories: [{ id: 'c1', name: 'Rarity' } as never],
    quests: [],
    dialogues: [],
    strings: { languages: ['en', 'de'], items: [{ key: 'ui.start', values: { en: 'Start', de: 'Starten' } }] },
  }
}

describe('engine export', () => {
  it('writes JSON with unique ids, stats and category names', () => {
    const files = buildExport(input(), 'json')
    const items = JSON.parse(files.find((f) => f.path === 'items.json')!.text).items
    expect(items.map((i: { id: string }) => i.id)).toEqual(['fire_sword', 'fire_sword_2'])
    expect(items[0].stats).toEqual([{ name: 'ATK', value: 12 }])
    expect(items[0].categories).toEqual([{ name: 'Rarity', value: 'Rare' }])
    expect(files.find((f) => f.path === 'strings.csv')!.text).toContain('ui.start,Start,Starten')
    expect(ident('Ærøskøbing Tavern!')).toBe('aeroskobing_tavern')
  })

  it('adds engine files', () => {
    expect(buildExport(input(), 'godot').map((f) => f.path)).toContain('egd/egd_data.gd')
    expect(buildExport(input(), 'unity').map((f) => f.path)).toContain('Assets/Scripts/EgdData.cs')
    const dt = buildExport(input(), 'unreal').find((f) => f.path === 'DataTables/DT_Items.csv')!
    expect(dt.text.split('\r\n')[0]).toBe('Name,DisplayName,Description,atk,rarity')
    expect(dt.text).toContain('fire_sword,Fire Sword,,12,Rare')
  })
})

describe('engine export of everything (0.28)', () => {
  it('names flags in dialogue and quest conditions and writes every data tool', () => {
    const base = input()
    const files = buildExport(
      {
        ...base,
        flags: [{ id: 'f1', name: 'met_king', kind: 'bool', initial: 0, note: '' }],
        dialogues: [{ title: 'Intro', startId: 'l1', lines: [{ id: 'l1', speakerName: 'King', speakerId: null, text: 'Hi', next: null, conditions: [{ flagId: 'f1', op: '==', value: 1 }], changes: [], choices: [{ text: 'Bow', to: null, changes: [{ flagId: 'f1', op: 'set', value: 1 }] }] }] }],
        quests: [{ id: 'q', name: 'Crown', summary: '', kind: 'main', level: null, requires: [], objectives: [], rewardXp: 0, rewardGold: 0, rewardItems: [], onComplete: [{ flagId: 'f1', op: 'set', value: 1 }] }],
        tools: [{ type: 'skill-tree', documents: [{ id: 'd1', title: 'Warrior', data: { skills: [{ image: 'assets/images/abc.png' }] } }, { id: 'd2', title: 'Warrior', data: {} }] }],
      },
      'godot',
    )
    const dlg = JSON.parse(files.find((f) => f.path === 'egd/dialogues.json')!.text).dialogues[0]
    expect(dlg.lines[0].conditions).toEqual([{ flag: 'met_king', op: '==', value: 1 }])
    expect(dlg.lines[0].choices[0].changes).toEqual([{ flag: 'met_king', op: 'set', value: 1 }])
    expect(JSON.parse(files.find((f) => f.path === 'egd/quests.json')!.text).quests[0].onComplete[0].flag).toBe('met_king')
    expect(JSON.parse(files.find((f) => f.path === 'egd/flags.json')!.text).flags[0]).toMatchObject({ name: 'met_king', uid: 'f1' })
    const tree = JSON.parse(files.find((f) => f.path === 'egd/tools/skill-tree.json')!.text)
    expect(tree.documents.map((d: { id: string }) => d.id)).toEqual(['warrior', 'warrior_2'])
    expect(tree.documents[0].data.skills[0].image).toBe('images/abc.png')
    expect(files.find((f) => f.path === 'egd/egd_data.gd')!.text).toContain('func tool(type: String')
  })

  it('writes Custom Lists with values by field name', () => {
    const out = customListRecords({ one: 'vehicle', fields: [{ id: 'f1', name: 'Speed', kind: 'number' }], items: [{ id: 'u1', name: 'Tank', image: null, values: { f1: 40 } }, { id: 'u2', name: 'Tank', image: null, values: {} }] })
    expect(out.records).toEqual([
      { id: 'tank', uid: 'u1', name: 'Tank', image: null, values: { Speed: 40 } },
      { id: 'tank_2', uid: 'u2', name: 'Tank', image: null, values: { Speed: null } },
    ])
  })

  it('finds project pictures inside tool data', () => {
    expect([...assetPaths({ a: ['assets/images/x.png', 'nope'], b: { c: 'assets/audio/y.ogg' } })]).toEqual(['assets/images/x.png', 'assets/audio/y.ogg'])
  })
})
