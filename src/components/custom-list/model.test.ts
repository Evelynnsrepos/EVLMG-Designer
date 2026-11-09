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

describe('templates', () => {
  it('builds every template with linked field values', async () => {
    const { TEMPLATES, fromTemplate } = await import('./model')
    for (const t of TEMPLATES) {
      const d = fromTemplate(t.id)
      expect(d.fields.length).toBe(t.fields.length)
      for (const r of d.items) for (const k of Object.keys(r.values)) expect(d.fields.some((f) => f.id === k)).toBe(true)
    }
    const a = fromTemplate('accessibility')
    const area = a.fields.find((f) => f.name === 'Area')!
    expect(a.items[0].values[area.id]).toBe('Motor')
  })
})
