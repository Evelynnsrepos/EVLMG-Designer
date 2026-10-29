import { describe, expect, it } from 'vitest'
import { applySlots, cardsFromSheet, createCardDoc, deckJson, expandCopies, fillText, renameFieldInScene, slotColors, ttsFileUrl, ttsSavedObject, ttsSheets, type CardNode } from './model'

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

  it('writes local paths as Tabletop Simulator file URLs', () => {
    expect(ttsFileUrl('C:\\Users\\Eve\\My Games\\a.png')).toBe('file:///C:/Users/Eve/My Games/a.png')
    expect(ttsFileUrl('/home/eve/a.png')).toBe('file:///home/eve/a.png')
  })

  it('builds a Tabletop Simulator deck over several sheets, one card alone as a card', () => {
    const sheet = (face: string, names: string[]) => ({ face, back: 'b', cols: 10, rows: 7, cards: names.map((name) => ({ name, description: '' })) })
    const o = ttsSavedObject('Deck', [sheet('f1', ['A', 'B']), sheet('f2', ['C'])], false, false).ObjectStates[0] as Record<string, any>
    expect(o.Name).toBe('Deck')
    expect(o.DeckIDs).toEqual([100, 101, 200])
    expect(Object.keys(o.CustomDeck)).toEqual(['1', '2'])
    expect(o.CustomDeck['2']).toMatchObject({ FaceURL: 'f2', BackURL: 'b', NumWidth: 10, NumHeight: 7, BackIsHidden: true, Type: 0 })
    expect(o.ContainedObjects.map((c: any) => [c.Nickname, c.CardID, Object.keys(c.CustomDeck)[0]])).toEqual([['A', 100, '1'], ['B', 101, '1'], ['C', 200, '2']])
    expect(new Set([o.GUID, ...o.ContainedObjects.map((c: any) => c.GUID)]).size).toBe(4)
    const one = ttsSavedObject('Deck', [sheet('f1', ['A'])], false, false).ObjectStates[0] as Record<string, any>
    expect([one.Name, one.CardID, one.Nickname]).toEqual(['Card', 100, 'A'])
  })

  it('splits a deck into Tabletop Simulator sheets of at most 10 x 7, at least 2 x 2, last cell free', () => {
    expect(ttsSheets(0)).toEqual([])
    expect(ttsSheets(1)).toEqual([{ cols: 2, rows: 2, count: 1 }])
    expect(ttsSheets(7)).toEqual([{ cols: 7, rows: 2, count: 7 }])
    expect(ttsSheets(23)).toEqual([{ cols: 10, rows: 3, count: 23 }])
    expect(ttsSheets(20)).toEqual([{ cols: 10, rows: 3, count: 20 }])
    expect(ttsSheets(75)).toEqual([
      { cols: 10, rows: 7, count: 69 },
      { cols: 6, rows: 2, count: 6 },
    ])
  })
})
