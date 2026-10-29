import { describe, expect, it } from 'vitest'
import { TileHistory } from './tiles'

describe('layer changes in the undo history', () => {
  it('keeps a merge or delete as one step that undo and redo bring back', () => {
    const h = new TileHistory()
    const before = h.pushes
    h.pushMeta('a', { gone: 'b' })
    expect(h.pushes).toBe(before + 1)
    const s = h.undo()
    expect(s?.meta).toEqual({ gone: 'b' })
    expect(h.redo()?.meta).toEqual({ gone: 'b' })
  })
})

describe('selections in the undo history', () => {
  it('undo takes a new selection away again, redo brings it back', () => {
    const h = new TileHistory()
    const mask = { width: 2, height: 2 } as HTMLCanvasElement
    h.pushSelection(null, mask)
    const s = h.undo()
    expect(s?.layerId).toBe('')
    expect(s?.sel).toEqual({ before: null, after: mask })
    expect(h.redo()?.sel?.after).toBe(mask)
  })
})
