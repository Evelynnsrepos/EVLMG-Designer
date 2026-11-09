import { describe, expect, it } from 'vitest'
import { createEntity } from '@/core/model'
import { lookupEntries } from './lookup'

describe('STAT() lookup', () => {
  it('collects stats, categories by name, enemy levels and Custom List fields', () => {
    const sword = { ...createEntity('item'), name: 'Sword', stats: { ATK: 5 }, categories: { c: 'Rare' } }
    const slime = { ...createEntity('enemy'), name: 'Slime', levelMin: 2, levelMax: 4 }
    const out = lookupEntries({ item: [sword], character: [], town: [], enemy: [slime] }, [{ id: 'c', name: 'Rarity' } as never], [
      { title: 'Vehicles', doc: { one: 'vehicle', fields: [{ id: 'f', name: 'Speed', kind: 'number' }], items: [{ id: 'r', name: 'Tank', image: null, values: { f: 40 } }] } },
    ])
    expect(out.find((e) => e.name === 'Sword')!.fields).toMatchObject({ ATK: 5, Rarity: 'Rare' })
    expect(out.find((e) => e.name === 'Slime')!.fields).toMatchObject({ 'Level min': 2, 'Level max': 4 })
    expect(out.find((e) => e.name === 'Tank')).toEqual({ kind: 'Vehicles', name: 'Tank', fields: { Speed: 40 } })
  })
})

describe('typing over STAT() writes back (0.28)', () => {
  it('finds the entry and converts the value', async () => {
    const { statWriteBack } = await import('./lookup')
    const entries: import('./engine').LookupEntry[] = [
      { kind: 'item', name: 'Sword', fields: { Description: '', ATK: 5, Rarity: 'Rare' }, src: { entity: 'item' as const, id: 's' } },
      { kind: 'item', name: 'Bow', fields: { Description: '', ATK: 3, DEX: 2 }, src: { entity: 'item' as const, id: 'b' } },
      { kind: 'Vehicles', name: 'Tank', fields: { Speed: 40, Armored: true, Note: 'x' }, src: { list: 'L', id: 't' } },
    ]
    expect(statWriteBack(entries, '=STAT("Sword", "ATK")', '7')).toEqual({ entity: 'item', id: 's', patch: { stats: { ATK: 7 } } })
    // A stat other entries of the kind have counts too.
    expect(statWriteBack(entries, '=STAT("sword";"dex")', '1,5')).toEqual({ entity: 'item', id: 's', patch: { stats: { DEX: 1.5 } } })
    expect(statWriteBack(entries, '=STAT("Sword", "ATK")', 'high')).toBeNull()
    expect(statWriteBack(entries, '=STAT("Sword", "Rarity")', 'Epic')).toBeNull()
    expect(statWriteBack(entries, '=STAT("Tank", "Speed", "Vehicles")', '55')).toEqual({ list: 'L', id: 't', fieldName: 'Speed', value: 55 })
    expect(statWriteBack(entries, '=STAT("Tank", "Armored")', 'no')).toEqual({ list: 'L', id: 't', fieldName: 'Armored', value: false })
    expect(statWriteBack(entries, '=STAT("Tank", "Speed")', '=1+1')).toBeNull()
    expect(statWriteBack(entries, '=A1', '3')).toBeNull()
  })
})
