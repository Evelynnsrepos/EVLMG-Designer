import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryFs, setFs } from '../fs'
import { createEntity, newId } from '../model'
import { createProject, saveCollection, saveMeta, writeDocument } from '../project'
import { buildReferenceIndex, collectIds, collectOwnIds, findReferencesIn } from '.'

describe('collectOwnIds', () => {
  it('lists the ids of records kept inside, not the ids they point at', () => {
    const [doc, article, item] = [newId(), newId(), newId()]
    expect(collectOwnIds({ id: doc, articles: [{ id: article, itemId: item }], plain: { id: 'not-a-uuid' } })).toEqual([doc, article])
  })
})

describe('collectIds', () => {
  it('finds ids in values, keys and inside text, but not a record’s own id', () => {
    const own = newId()
    const a = newId()
    const b = newId()
    const c = newId()
    const found = collectIds({ id: own, rows: [{ id: newId(), itemId: a }], categories: { [b]: 'x' }, body: `<a data-id="${c}">Aria</a>` })
    expect(found.has(own)).toBe(false)
    expect([...found.get(a)!]).toEqual(['rows.itemId'])
    expect([...found.get(b)!]).toEqual(['categories'])
    expect([...found.get(c)!]).toEqual(['body'])
  })
})

describe('reference index', () => {
  beforeEach(() => setFs(new MemoryFs()))

  it('lists entities and documents that use an item', async () => {
    const p = await createProject({ name: 'Refs', description: '', components: ['enemy-list', 'timeline', 'wiki'] })
    const sword = createEntity('item', 'Sword')
    const unused = createEntity('item', 'Spoon')
    const goblin = createEntity('enemy', 'Goblin')
    goblin.dropTable = [{ id: newId(), itemId: sword.id, amountMin: 1, amountMax: 1, chancePercent: 5 }]
    await saveCollection(p.root, 'item', [sword, unused])
    await saveCollection(p.root, 'enemy', [goblin])

    const timelineId = newId()
    await saveMeta(p.root, { ...p.meta, documents: [{ id: timelineId, type: 'timeline', title: 'Main story', createdAt: '', updatedAt: '' }] })
    await writeDocument(p.root, 'timeline', timelineId, { events: [{ id: newId(), entityIds: [sword.id] }] })
    const articleId = newId()
    await writeDocument(p.root, 'wiki', articleId, { id: articleId, title: 'Legendary blades', body: `See [[${sword.id}]]` })

    const refs = await findReferencesIn(p.root, sword.id)
    expect(refs.map((r) => r.source)).toEqual([
      { kind: 'entity', entityType: 'enemy', entityId: goblin.id, name: 'Goblin' },
      { kind: 'document', componentType: 'timeline', documentId: timelineId, title: 'Main story' },
      { kind: 'document', componentType: 'wiki', documentId: articleId, title: 'Legendary blades' },
    ])
    expect(refs[0].fields).toEqual(['dropTable.itemId'])
    expect(await findReferencesIn(p.root, unused.id)).toEqual([])
  })

  it('does not count a record as referencing itself', async () => {
    const p = await createProject({ name: 'Self', description: '', components: [] })
    const aria = createEntity('character', 'Aria')
    aria.links = [{ id: newId(), label: 'Self', targetType: 'character', targetId: aria.id }]
    await saveCollection(p.root, 'character', [aria])
    expect(await findReferencesIn(p.root, aria.id)).toEqual([])
    expect((await buildReferenceIndex(p.root)).get(aria.id)).toHaveLength(1)
  })
})
