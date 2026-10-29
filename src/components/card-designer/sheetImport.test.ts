import { describe, expect, it } from 'vitest'
import { parseCSV, toCSV } from '@/shared/csv'
import { cardsFromSheet, composeScene, createCardDoc, setLayerOnEveryCard, type CardDoc, type CardTextNode } from './model'
import { applyImport, deckRows, guessTargets, missingPictures, ownTextBoxes, sheetRows } from './sheetImport'

describe('fill cards from a spreadsheet', () => {
  const base = createCardDoc()
  const [name, cost, , , art] = base.fields
  const rules = base.front.nodes.find((n) => n.kind === 'card-text' && n.text === '{Rules}')!
  const start: CardDoc = {
    ...base,
    variants: [{ id: 'red', name: 'Red', colors: [] }],
    cards: [
      { id: 'a', copies: 1, values: { [name.id]: 'Bolt', [cost.id]: '2' } },
      { id: 'b', copies: 1, values: { [name.id]: 'Heal' } },
    ],
  }
  // Her deck: the text layer is off every card and the rules box holds each card's own typed text (T off).
  let doc = setLayerOnEveryCard(start, rules.layerId, false, ['a', 'b'])
  const own = (c: string, text: string) => {
    const o = doc.overrides![c]
    doc = { ...doc, overrides: { ...doc.overrides, [c]: { ...o, nodes: { ...o.nodes, [rules.layerId]: o.nodes![rules.layerId].map((n) => (n.kind === 'card-text' && n.textKey === rules.id ? { ...n, ownText: true, text } : n)) } } } }
  }
  own('a', 'Deal 3.')
  own('b', 'Heal 2.')
  const box = (d: CardDoc, c: string) => composeScene(d, 'front', c).nodes.find((n) => n.kind === 'card-text' && n.textKey === rules.id) as CardTextNode

  const rows = parseCSV('Name,Cost,Variant,Copies,Ability,Art\nBolt,3,red,2,Deal 4.,\nWolf,1,,,Bite.,wolf.png\nBad,abc,blue,x,,\n')

  it('guesses columns and lists the own-text boxes', () => {
    const t = guessTargets(doc, rows)
    expect(t).toEqual([`field:${name.id}`, `field:${cost.id}`, 'variant', 'copies', 'new:text', `field:${art.id}`])
    const boxes = ownTextBoxes(doc, 'a')
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toMatchObject({ key: rules.id, tpl: false })
    expect(missingPictures(doc, rows, t, new Map())).toEqual(['wolf.png'])
  })

  it('updates cards by name, adds new ones and turns the own-text box into a field', () => {
    const t = guessTargets(doc, rows)
    t[4] = `box:${rules.id}`
    const r = applyImport(doc, rows, t, 'a', new Map([['wolf', 'assets/images/w.png']]))
    expect(r.updated).toBe(1)
    expect(r.added).toBe(2)
    expect(r.newFields).toEqual(['Ability'])
    expect(r.problems).toHaveLength(3)
    const ability = r.doc.fields.find((f) => f.name === 'Ability')!
    const [a, b, wolf] = r.doc.cards
    expect(a).toMatchObject({ id: 'a', copies: 2, variantId: 'red', values: { [cost.id]: '3', [ability.id]: 'Deal 4.' } })
    // Heal is not in the sheet: it keeps the text its box had.
    expect(b.values[ability.id]).toBe('Heal 2.')
    expect(wolf.values).toMatchObject({ [name.id]: 'Wolf', [ability.id]: 'Bite.', [art.id]: 'assets/images/w.png' })
    for (const c of [a, b, wolf]) expect(box(r.doc, c.id).text).toBe('{Ability}')
    // A bad number keeps the value it had (a new card: none).
    expect(r.doc.cards[3].values[cost.id]).toBeUndefined()
  })

  it('exports the deck as rows that fill it back', () => {
    const csv = toCSV(deckRows(start))
    const back = parseCSV(csv)
    expect(back[0]).toEqual(['Name', 'Cost', 'Type', 'Rules', 'Art', 'Copies', 'Variant'])
    const r = applyImport(start, back, guessTargets(start, back), null, new Map())
    expect(r).toMatchObject({ added: 0, updated: 2, problems: [] })
    expect(r.doc.cards).toEqual(start.cards)
  })

  it('reads a Spreadsheet sheet as rows', () => {
    expect(sheetRows({ id: 's', name: 'S', cells: { A1: { v: 'Name' }, C1: { v: 'Cost' }, A2: { v: 'Bolt' } } })).toEqual([
      ['Name', '', 'Cost'],
      ['Bolt'],
    ])
  })
})

describe('fields the sheet has no column for', () => {
  const base = createCardDoc()
  const [name, cost, type] = base.fields
  const doc: CardDoc = { ...base, cards: [{ id: 'a', copies: 1, values: { [name.id]: 'Bolt', [cost.id]: '2', [type.id]: 'HP: 10' } }] }
  const rows = parseCSV('Name,Cost\nWolf,1\n')

  it('new cards take them from the open card', () => {
    const r = applyImport(doc, rows, guessTargets(doc, rows), 'a', new Map())
    expect(r.doc.cards[1].values).toEqual({ [name.id]: 'Wolf', [cost.id]: '1', [type.id]: 'HP: 10' })
  })

  it('a linked sheet takes them from the first card of the list', () => {
    const sheet = { id: 's', name: 'S', cells: { A1: { v: 'Name' }, A2: { v: 'Wolf' } } }
    expect(cardsFromSheet(sheet, doc.fields, [], doc.cards[0].values)[0].values).toMatchObject({ [name.id]: 'Wolf', [cost.id]: '2', [type.id]: 'HP: 10' })
  })
})
