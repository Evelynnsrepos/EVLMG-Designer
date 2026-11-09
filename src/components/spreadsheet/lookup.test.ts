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
