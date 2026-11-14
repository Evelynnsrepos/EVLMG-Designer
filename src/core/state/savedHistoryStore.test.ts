import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getFs, MemoryFs, setFs } from '../fs'
import { projectPaths } from '../project'
import { flushAll, loadDocumentNow, peekDocument, redoDocument, undoDocument, updateDocument, useProjectStore } from '.'

type Doc = { cels: Record<string, string> }
const png = (n: number) => `data:image/png;base64,${String(n).repeat(300)}`

describe('Pixel Art undo history after closing the project (0.31)', () => {
  beforeEach(() => setFs(new MemoryFs()))
  afterEach(async () => {
    await useProjectStore.getState().close()
  })

  it('undoes and redoes steps from the last session', async () => {
    const store = useProjectStore.getState()
    await store.create({ name: 'Sprites', description: '', components: ['pixel-art'] })
    const root = useProjectStore.getState().root!
    const sprite = store.addDocument('pixel-art', 'Hero')
    await loadDocumentNow<Doc>(root, 'pixel-art', sprite.id, () => ({ cels: {} }))
    for (const n of [1, 2, 3]) updateDocument<Doc>(root, 'pixel-art', sprite.id, (d) => ({ cels: { ...d.cels, [`c${n}`]: png(n) } }))
    undoDocument(root, 'pixel-art', sprite.id)
    await flushAll(root)
    expect(await getFs().exists(await projectPaths.history(root, 'pixel-art', sprite.id))).toBe(true)

    await useProjectStore.getState().close()
    await useProjectStore.getState().open(root)
    await loadDocumentNow<Doc>(root, 'pixel-art', sprite.id, () => ({ cels: {} }))
    expect(Object.keys(peekDocument<Doc>(root, 'pixel-art', sprite.id)!.cels)).toEqual(['c1', 'c2'])
    undoDocument(root, 'pixel-art', sprite.id)
    expect(Object.keys(peekDocument<Doc>(root, 'pixel-art', sprite.id)!.cels)).toEqual(['c1'])
    redoDocument(root, 'pixel-art', sprite.id)
    redoDocument(root, 'pixel-art', sprite.id)
    expect(peekDocument<Doc>(root, 'pixel-art', sprite.id)!.cels.c3).toBe(png(3))
  })
})
