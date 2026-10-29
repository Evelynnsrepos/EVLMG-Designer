import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryFs, setFs } from '../fs'
import { readDocument } from '../project'
import { copyDocument, flushAll, loadDocumentNow, updateDocument, useProjectStore } from '.'

describe('copyDocument', () => {
  beforeEach(() => setFs(new MemoryFs()))
  afterEach(async () => {
    await useProjectStore.getState().close()
  })

  it('gives the new document its own copy of the content', async () => {
    const store = useProjectStore.getState()
    await store.create({ name: 'Cards', description: '', components: ['card-designer'] })
    const root = useProjectStore.getState().root!
    const deck = store.addDocument('card-designer', 'Deck')
    await loadDocumentNow(root, 'card-designer', deck.id, () => ({ cards: [] as string[] }))
    updateDocument<{ cards: string[] }>(root, 'card-designer', deck.id, () => ({ cards: ['Knight'] }))
    const dummy = store.addDocument('card-designer', 'Deck (copy)')
    await copyDocument('card-designer', deck.id, dummy.id)
    updateDocument<{ cards: string[] }>(root, 'card-designer', dummy.id, (d) => ({ cards: [...d.cards, 'Dummy'] }))
    await flushAll(root)
    expect(await readDocument(root, 'card-designer', deck.id, () => null)).toEqual({ cards: ['Knight'] })
    expect(await readDocument(root, 'card-designer', dummy.id, () => null)).toEqual({ cards: ['Knight', 'Dummy'] })
  })
})
