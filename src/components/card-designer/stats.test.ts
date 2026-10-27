import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import type { RenderContext } from '@/shared/canvas'
import { iconPaths } from './icons'
import { cardNodeTypes } from './nodeTypes'
import { createCardDoc, deckJson, layoutRichText } from './model'
import { evaluatedSheet } from './sheetValues'

describe('custom stats', () => {
  it('exports number fields as numbers', () => {
    const doc = createCardDoc()
    const cost = doc.fields.find((f) => f.name === 'Cost')!
    expect(cost.kind).toBe('number')
    const j = deckJson('D', doc, [{ id: 'a', copies: 1, values: { [cost.id]: '3' } }, { id: 'b', copies: 1, values: { [cost.id]: 'X' } }])
    expect(j.cards[0].values.Cost).toBe(3)
    expect(j.cards[1].values.Cost).toBe('X')
  })

  it('lays out icons one font size wide and wraps words', () => {
    // Every letter 10 wide, space 10.
    const lines = layoutRichText('Deal 3 :fire: now\nok :nope:', (n) => n === 'fire', (w) => w.length * 10, 100, 20)
    expect(lines).toHaveLength(3)
    expect(lines[0].items.map((i) => [i.kind, i.value, i.x])).toEqual([
      ['text', 'Deal', 0],
      ['text', '3', 50],
      ['icon', 'fire', 70],
    ])
    expect(lines[1].items[0]).toMatchObject({ value: 'now', x: 0 })
    // Unknown icon names stay as text.
    expect(lines[2].items[1]).toMatchObject({ kind: 'text', value: ':nope:' })
  })

  it('reads built-in icons as vector paths', () => {
    expect(iconPaths('sword').length).toBeGreaterThan(0)
    expect(iconPaths('heart')[0]).toMatch(/^M/i)
    expect(iconPaths('missing')).toEqual([])
  })

  it('shows formula results from a linked sheet, also across sheets', () => {
    const stats = { id: 'b', name: 'Base', cells: { A1: { v: '4' } } }
    const cards = { id: 'a', name: 'Cards', cells: { A1: { v: 'Attack' }, A2: { v: '=Base!A1*2' }, B2: { v: '=1/3' }, C2: { v: 'Text' } } }
    const out = evaluatedSheet([cards, stats], cards)
    expect(out.cells.A2.v).toBe('8')
    expect(out.cells.B2.v).toBe('0.3333333333')
    expect(out.cells.C2.v).toBe('Text')
  })

  it('draws only foil items, in black, for the foil mask', () => {
    const doc = createCardDoc()
    const ctx = { theme: { text: '#111' }, resolveImageSrc: (p: string) => p } as unknown as RenderContext
    const types = cardNodeTypes({ colors: new Map(), fields: doc.fields, values: null, mask: true })
    const rect = { id: 'r', kind: 'rect', layerId: 'l', x: 0, y: 0, width: 10, height: 10, fillColor: '#f00', strokeColor: '#0f0' } as const
    expect(types.rect.render(rect, ctx)).toBeNull()
    const el = types.rect.render({ ...rect, foil: true }, ctx) as ReactElement<{ fill: string; stroke: string }>
    expect([el.props.fill, el.props.stroke]).toEqual(['#000', '#000'])
  })
})
