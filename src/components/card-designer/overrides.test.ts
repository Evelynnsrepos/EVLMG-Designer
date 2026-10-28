import { describe, expect, it } from 'vitest'
import { composeScene, createCardDoc, legacyPerCardLayers, onEveryCard, sameTextEverywhere, toggleSameText, resizeDesign, setLayerOnEveryCard, setOnEveryCard, setOverride, slotColors, splitScene, withTokenFields, type CardDoc } from './model'

describe('what is on every card', () => {
  const base = createCardDoc()
  const art = base.front.nodes.find((n) => n.kind === 'card-image')!
  const frame = base.front.nodes.find((n) => n.name === 'Frame')!
  const text = base.front.nodes.find((n) => n.kind === 'card-text')!
  const doc: CardDoc = { ...base, cards: [{ id: 'a', copies: 1, values: {} }, { id: 'b', copies: 1, values: {} }] }
  const edit = (d: CardDoc, cardId: string, id: string, patch: object) => {
    const s = composeScene(d, 'front', cardId)
    return splitScene(d, 'front', cardId, { ...s, nodes: s.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as typeof n) : n)) })
  }
  const find = (d: CardDoc, cardId: string, id: string) => composeScene(d, 'front', cardId).nodes.find((n) => n.id === id)

  it('puts edits of items on every card into the design', () => {
    const out = edit(doc, 'a', frame.id, { x: frame.x + 10 })
    expect(out.front.nodes.find((n) => n.id === frame.id)!.x).toBe(frame.x + 10)
    expect(out.overrides?.a).toBeUndefined()
  })

  it('moves an item to one card only, and back to every card', () => {
    const own = setOnEveryCard(doc, 'front', 'a', [frame.id], false)
    expect(find(own, 'a', frame.id)).toBeTruthy()
    expect(find(own, 'b', frame.id)).toBeUndefined()
    expect(onEveryCard(own, 'front', frame.id)).toBe(false)
    const moved = edit(own, 'a', frame.id, { x: 5 })
    expect(moved.overrides!.a.nodes![frame.layerId][0].x).toBe(5)
    const back = setOnEveryCard(moved, 'front', 'a', [frame.id], true)
    expect(find(back, 'b', frame.id)!.x).toBe(5)
    expect(back.overrides?.a).toBeUndefined()
  })

  it('takes a layer off every card as a copy per card, and an item back onto every card links the layer', () => {
    const per = setLayerOnEveryCard(doc, art.layerId, false, ['a', 'b'])
    expect(per.front.nodes.some((n) => n.layerId === art.layerId)).toBe(false)
    const a = composeScene(per, 'front', 'a').nodes.find((n) => n.layerId === art.layerId)!
    const b = composeScene(per, 'front', 'b').nodes.find((n) => n.layerId === art.layerId)!
    expect(a.id).not.toBe(b.id)
    const out = edit(per, 'a', a.id, { x: 99 })
    expect(find(out, 'a', a.id)!.x).toBe(99)
    expect(find(out, 'b', b.id)!.x).toBe(art.x)
    const linked = setOnEveryCard(out, 'front', 'a', [a.id], true)
    expect(linked.perCardLayers).toEqual([])
    expect(find(linked, 'b', a.id)!.x).toBe(99)
  })

  it('gives each card its own text in a box that is on every card', () => {
    const d = { ...doc, front: { ...doc.front, nodes: doc.front.nodes.map((n) => (n.id === text.id ? { ...n, ownText: true } : n)) } }
    const out = edit(d, 'a', text.id, { text: 'Only A' })
    expect(find(out, 'a', text.id)).toMatchObject({ text: 'Only A' })
    expect(find(out, 'b', text.id)).toMatchObject({ text: (text as { text: string }).text })
    const moved = edit(out, 'b', text.id, { x: 7 })
    expect(find(moved, 'a', text.id)).toMatchObject({ x: 7, text: 'Only A' })
  })

  it('lets copies of a box on a layer off every card share their text, or not', () => {
    const per = setLayerOnEveryCard(doc, text.layerId, false, ['a', 'b'])
    const copy = (c: string) => composeScene(per, 'front', c).nodes.find((n) => n.kind === 'card-text' && n.textKey === text.id)!
    const a = copy('a')
    expect(sameTextEverywhere(per, 'front', a)).toBe(true)
    const shared = edit(per, 'a', a.id, { text: 'Both', x: 3 })
    expect(composeScene(shared, 'front', 'b').nodes.find((n) => (n as { textKey?: string }).textKey === text.id)).toMatchObject({ text: 'Both', x: text.x })
    const own = edit(toggleSameText(shared, 'front', 'a', a.id), 'a', a.id, { text: 'Only A' })
    expect(find(own, 'a', a.id)).toMatchObject({ text: 'Only A' })
    expect(composeScene(own, 'front', 'b').nodes.find((n) => (n as { textKey?: string }).textKey === text.id)).toMatchObject({ text: 'Both' })
  })

  it('puts a box on every card with its text, or empty when it keeps its own text', () => {
    const own = setOnEveryCard(doc, 'front', 'a', [text.id], false)
    const withText = setOnEveryCard(own, 'front', 'a', [text.id], true)
    expect(find(withText, 'b', text.id)).toMatchObject({ text: (text as { text: string }).text })
    const empty = setOnEveryCard(toggleSameText(own, 'front', 'a', text.id), 'front', 'a', [text.id], true)
    expect(find(empty, 'b', text.id)).toMatchObject({ text: '' })
    expect(find(empty, 'a', text.id)).toMatchObject({ text: (text as { text: string }).text })
  })

  it('turns 0.23.3 per-card layers into copies per card', () => {
    const old = setOverride({ ...doc, perCardLayers: [art.layerId] }, 'a', (o) => ({ ...o, nodes: { [art.layerId]: [{ ...art, x: 1 }] } }))
    expect(find(old, 'b', art.id)!.x).toBe(art.x)
    expect(legacyPerCardLayers(old)).toEqual([art.layerId])
    const out = setLayerOnEveryCard(old, art.layerId, false, ['a', 'b'])
    expect(legacyPerCardLayers(out)).toEqual([])
    expect(find(out, 'a', art.id)!.x).toBe(1)
    expect(composeScene(out, 'front', 'b').nodes.find((n) => n.layerId === art.layerId)!.x).toBe(art.x)
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
    const own = edit(setOnEveryCard(doc, 'front', 'a', [art.id], false), 'a', art.id, { x: art.x + 10 })
    const out = resizeDesign(own, 126, 176)
    expect(out.front.nodes.find((n) => n.id === frame.id)!.x).toBe(frame.x * 2)
    expect(out.overrides!.a.nodes![art.layerId][0].x).toBe((art.x + 10) * 2)
  })

  it('adds a field for a new {Name} in a text box', () => {
    const d = { ...doc, front: { ...doc.front, nodes: doc.front.nodes.map((n) => (n.id === text.id ? { ...n, text: '{Power} and {name}' } : n)) } }
    const out = withTokenFields(d)
    expect(out.fields.map((f) => f.name)).toEqual([...doc.fields.map((f) => f.name), 'Power'])
    expect(withTokenFields(out)).toBe(out)
  })
})
