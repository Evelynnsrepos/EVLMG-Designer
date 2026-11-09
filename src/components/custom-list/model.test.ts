import { describe, expect, it } from 'vitest'
import { changeKind, coerce, createCustomListDoc, newField, newRecord } from './model'

describe('custom list', () => {
  it('converts values when a field changes kind', () => {
    expect(coerce('number', '12')).toBe(12)
    expect(coerce('number', 'fast')).toBeNull()
    expect(coerce('text', 12)).toBe('12')
    expect(coerce('entries', { type: 'item', id: 'a' })).toEqual([{ type: 'item', id: 'a' }])
    expect(coerce('entry', [{ type: 'item', id: 'a' }])).toEqual({ type: 'item', id: 'a' })
    const f = newField('text')
    const d = { ...createCustomListDoc(), fields: [f], items: [{ ...newRecord('Tank'), values: { [f.id]: '40' } }] }
    expect(changeKind(d, f.id, 'number').items[0].values[f.id]).toBe(40)
  })
})
