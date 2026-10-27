import { describe, expect, it } from 'vitest'
import { composeScene, createCardDoc, resizeDesign, setOverride, slotColors, splitScene } from './model'

describe('per-card overrides', () => {
  const base = createCardDoc()
  const art = base.front.nodes.find((n) => n.kind === 'card-image')!
  const frame = base.front.nodes.find((n) => n.name === 'Frame')!
  const doc = { ...base, cards: [{ id: 'a', copies: 1, values: {} }, { id: 'b', copies: 1, values: {} }], perCardLayers: [art.layerId] }
  const move = (cardId: string, id: string, dx: number) => {
    const s = composeScene(doc, 'front', cardId)
    return splitScene(doc, 'front', cardId, { ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, x: n.x + dx } : n)) })
  }

  it('keeps edits on a per-card layer on that card only', () => {
    const out = move('a', art.id, 50)
    expect(composeScene(out, 'front', 'a').nodes.find((n) => n.id === art.id)!.x).toBe(art.x + 50)
    expect(composeScene(out, 'front', 'b').nodes.find((n) => n.id === art.id)!.x).toBe(art.x)
    expect(out.front.nodes.find((n) => n.id === art.id)!.x).toBe(art.x)
  })

  it('puts edits on other layers into the design for every card', () => {
    const out = move('a', frame.id, 10)
    expect(out.front.nodes.find((n) => n.id === frame.id)!.x).toBe(frame.x + 10)
    expect(out.overrides?.a).toBeUndefined()
  })

  it('turns a layer off on one card without changing the design', () => {
    const out = setOverride(doc, 'a', (o) => ({ ...o, hidden: [frame.layerId] }))
    expect(composeScene(out, 'front', 'a').layers.find((l) => l.id === frame.layerId)!.hidden).toBe(true)
    expect(composeScene(out, 'front', 'b').layers.find((l) => l.id === frame.layerId)!.hidden).toBeFalsy()
    const s = composeScene(out, 'front', 'a')
    expect(splitScene(out, 'front', 'a', s).front.layers.find((l) => l.id === frame.layerId)!.hidden).toBeFalsy()
  })

  it('lets one card unlink a colour slot', () => {
    const slot = doc.slots[1]
    const out = setOverride(doc, 'a', (o) => ({ ...o, colors: { [slot.id]: '#ff0000' } }))
    expect(slotColors(out, undefined, 'a').get(slot.id)).toBe('#ff0000')
    expect(slotColors(out, undefined, 'b').get(slot.id)).toBe(slot.color)
    expect(setOverride(out, 'a', () => ({})).overrides).toEqual({})
  })

  it('scales the design and cards’ own items to a new size', () => {
    const out = resizeDesign(move('a', art.id, 0 + 10), 126, 176)
    expect(out.front.nodes.find((n) => n.id === frame.id)!.x).toBe(frame.x * 2)
    expect(out.overrides!.a.nodes![art.layerId][0].x).toBe((art.x + 10) * 2)
  })
})
