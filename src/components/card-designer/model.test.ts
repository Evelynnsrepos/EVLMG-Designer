import { describe, expect, it } from 'vitest'
import { applySlots, cardsFromSheet, createCardDoc, deckJson, expandCopies, fillText, renameFieldInScene, slotColors, type CardNode } from './model'

describe('card designer model', () => {
  const doc = createCardDoc()
  const [name, cost] = doc.fields

  it('fills {Field} text from the card, ignoring case, and keeps unknown names', () => {
    expect(fillText('{name} costs {COST} {Nope}', doc.fields, { [name.id]: 'Bolt', [cost.id]: '2' })).toBe('Bolt costs 2 {Nope}')
    expect(fillText('{Name}', doc.fields, null)).toBe('{Name}')
  })

  it('takes colours from slots, with a variant on top', () => {
    const frame = doc.slots[1]
    const v = { id: 'red', name: 'Red', colors: [{ slotId: frame.id, color: '#ff0000' }] }
    const colors = slotColors({ slots: doc.slots, variants: [v] }, 'red')
    expect(colors.get(frame.id)).toBe('#ff0000')
    expect(colors.get(doc.slots[0].id)).toBe(doc.slots[0].color)
    const node = doc.front.nodes.find((n) => n.name === 'Frame')!
    expect((applySlots(node, colors) as CardNode & { strokeColor: string }).strokeColor).toBe('#ff0000')
  })

  it('starts with layered front and back, every item on a real layer', () => {
    expect(doc.front.layers.map((l) => l.name)).toEqual(['Background', 'Art', 'Frame', 'Text'])
    for (const s of [doc.front, doc.back]) for (const n of s.nodes) expect(s.layers.some((l) => l.id === n.layerId)).toBe(true)
  })

  it('renames {Field} in the template with the field', () => {
    const s = renameFieldInScene(doc.front, 'Name', 'Title')
    expect(s.nodes.some((n) => n.kind === 'card-text' && n.text === '{Title}')).toBe(true)
    expect(s.nodes.some((n) => n.kind === 'card-text' && n.text === '{Name}')).toBe(false)
  })

  it('reads cards from a sheet: header row, copies and variant columns', () => {
    const sheet = {
      id: 's',
      name: 'Sheet1',
      cells: { A1: { v: 'Name' }, B1: { v: 'copies' }, C1: { v: 'Variant' }, D1: { v: 'Cost' }, A2: { v: 'Bolt' }, B2: { v: '3' }, C2: { v: 'red' }, D2: { v: '2' }, A4: { v: 'Shield' } },
    }
    const cards = cardsFromSheet(sheet, doc.fields, [{ id: 'r', name: 'Red', colors: [] }])
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({ copies: 3, variantId: 'r', values: { [name.id]: 'Bolt', [cost.id]: '2' } })
    expect(cards[1]).toMatchObject({ copies: 1, values: { [name.id]: 'Shield' } })
    expect(expandCopies(cards)).toHaveLength(4)
  })

  it('exports deck JSON with field names as keys', () => {
    const j = deckJson('Deck', doc, doc.cards)
    expect(j.format).toBe('evlmg-deck')
    expect(j.cards[0].values.Name).toBe('Fire Bolt')
    expect(j.card).toEqual({ widthMm: 63, heightMm: 88, bleedMm: 3, cornerMm: 3 })
  })
})
