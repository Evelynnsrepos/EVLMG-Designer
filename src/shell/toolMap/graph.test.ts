import { describe, expect, it } from 'vitest'
import { COMPONENT_TYPES, type ComponentType, type Entity } from '@/core/model'
import { bendEdges, DEFAULT_BEND, edgePath, groupTools, toolNodes, IMAGE_SENDERS, layoutMap, mapEdges, MAX_BENT, neighbourIn, ROUTES, STEP } from './graph'

const types = COMPONENT_TYPES as readonly string[]

describe('tool map', () => {
  it('only names tools that exist', () => {
    for (const t of [...ROUTES.flatMap(([a, b]) => [a, b]), ...IMAGE_SENDERS]) expect(types).toContain(t)
  })

  it('groups like the sidebar: starred, folders, the rest', () => {
    const shown: ComponentType[] = ['wiki', 'sketch', 'map', 'tasks', 'writer']
    const groups = groupTools({ favorites: ['tasks'], folders: [{ id: 'f', name: 'Art', tools: ['sketch', 'tasks', 'vector'] }] }, shown)
    expect(groups.map((g) => [g.name, g.tools])).toEqual([
      ['Starred', ['tasks']],
      ['Art', ['sketch']],
      ['Other tools', ['wiki', 'map', 'writer']],
    ])
    expect(groupTools({}, shown)).toEqual([{ id: 'rest', name: '', tools: shown }])
  })

  it('never puts two bubbles on top of each other, and is the same every time', () => {
    const all = [...COMPONENT_TYPES] as ComponentType[]
    const groups = groupTools({ favorites: all.slice(0, 3), folders: [{ id: 'a', name: 'A', tools: all.slice(3, 20) }, { id: 'b', name: 'B', tools: all.slice(20, 21) }] }, all)
    const layout = layoutMap(groups)
    const pts = [...layout.nodes.values()]
    expect(pts).toHaveLength(all.length)
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(STEP * 0.99)
    expect(layoutMap(groups)).toEqual(layout)
    expect(layoutMap([]).nodes.size).toBe(0)
  })

  it('finds links from jump points, connections and mentions, and only between shown tools', () => {
    const sword = { id: 'aaaaaaaa-0000-4000-8000-000000000001', type: 'item', name: 'Sword', connections: [{ kind: 'entity', type: 'character', id: 'x' }] } as unknown as Entity
    const meta = {
      documents: [{ id: 'bbbbbbbb-0000-4000-8000-000000000002', type: 'writer' as const, title: 'Story' }],
      jumps: [
        { id: '1', from: { kind: 'document' as const, type: 'map' as const, documentId: null }, to: { kind: 'entity' as const, type: 'item' as const, id: sword.id } },
        { id: '2', from: { kind: 'document' as const, type: 'map' as const, documentId: null }, to: { kind: 'document' as const, type: 'gacha' as const, documentId: null } },
      ],
    }
    const index = new Map([[sword.id, [{ source: { kind: 'document' as const, componentType: 'writer' as const, documentId: meta.documents[0].id, title: 'Story' }, fields: ['html'] }]]])
    const multi = new Set(['writer', 'sketch', 'moodboard', 'map'])
    const shown: ComponentType[] = ['map', 'item-list', 'character-list', 'writer', 'sketch', 'moodboard']
    const nodes = shown.flatMap((t) => toolNodes(t, multi.has(t), meta.documents))
    const edges = mapEdges(nodes, meta as never, [sword], ['moodboard', 'asset-pool'], index)
    expect(edges).toEqual([
      { a: 'item-list', b: 'map', kind: 'link', count: 1, why: '1 jump point' },
      { a: 'character-list', b: 'item-list', kind: 'link', count: 1, why: '1 connection' },
      { a: 'item-list', b: 'writer:bbbbbbbb-0000-4000-8000-000000000002', kind: 'link', count: 1, why: '1 mention' },
      { a: 'moodboard', b: 'sketch', kind: 'route', count: 1, why: 'Send to, Pictures' },
    ])
  })

  it('gives every document its own bubble and its own lines', () => {
    const docs = [
      { id: 'd1', type: 'sketch' as const, title: 'Forest' },
      { id: 'd2', type: 'sketch' as const, title: '' },
      { id: 'w1', type: 'writer' as const, title: 'Chapter 1' },
    ]
    expect(toolNodes('sketch', true, docs).map((n) => [n.key, n.title])).toEqual([['sketch:d1', 'Forest'], ['sketch:d2', 'Untitled']])
    expect(toolNodes('moodboard', true, docs)).toEqual([{ key: 'moodboard', type: 'moodboard', documentId: null, title: null }]) // none yet: the tool
    expect(toolNodes('wiki', false, docs)).toEqual([{ key: 'wiki', type: 'wiki', documentId: null, title: null }])
    const nodes = [...toolNodes('sketch', true, docs), ...toolNodes('writer', true, docs), ...toolNodes('wiki', false, docs)]
    const jump = (from: string, fromDoc: string | null, to: string, toDoc: string | null) => ({ id: from + to, from: { kind: 'document', type: from, documentId: fromDoc }, to: { kind: 'document', type: to, documentId: toDoc } })
    const links = (jumps: unknown[]) => mapEdges(nodes, { documents: docs, jumps } as never, [], []).filter((e) => e.kind === 'link').map((e) => `${e.a} ${e.b}`)
    // A jump from one drawing lands on that drawing only.
    expect(links([jump('sketch', 'd2', 'writer', 'w1')])).toEqual(['sketch:d2 writer:w1'])
    // A jump to Draw as a whole touches every drawing.
    expect(links([jump('wiki', null, 'sketch', null)])).toEqual(['sketch:d1 wiki', 'sketch:d2 wiki'])
    // A deleted document draws nothing.
    expect(links([jump('wiki', null, 'sketch', 'gone')])).toEqual([])
  })

  it('bends lines away from each other and around bubbles', () => {
    // Two lines whose default bows cross: one of them has to give way.
    const nodes = new Map<ComponentType, { x: number; y: number }>([['wiki', { x: 0, y: 0 }], ['map', { x: 400, y: 0 }], ['tasks', { x: 200, y: -10 }], ['writer', { x: 200, y: -200 }]])
    const edges = [{ a: 'wiki' as const, b: 'map' as const }, { a: 'tasks' as const, b: 'writer' as const }]
    expect(bendEdges(nodes, edges)).not.toEqual([0.16, 0.16])
    // A bubble right on a line: the line goes round it.
    const row = new Map<ComponentType, { x: number; y: number }>([['wiki', { x: 0, y: 0 }], ['map', { x: 400, y: 0 }], ['tasks', { x: 200, y: -32 }]])
    expect(bendEdges(row, [edges[0]])).toEqual([-0.16])
    // Nothing in the way: the gentle default, and the same answer every time.
    expect(bendEdges(nodes, [edges[0]])).toEqual(bendEdges(nodes, [edges[0]]))
    expect(edgePath({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.1)).toBe('M0 0 Q50 -10 100 0')
  })

  it('moves with the arrow keys to the nearest bubble in that direction', () => {
    const nodes = new Map<ComponentType, { x: number; y: number }>([['wiki', { x: 0, y: 0 }], ['map', { x: 100, y: 10 }], ['tasks', { x: 300, y: 0 }], ['writer', { x: 0, y: 120 }]])
    expect(neighbourIn(nodes, 'wiki', 1, 0)).toBe('map')
    expect(neighbourIn(nodes, 'wiki', 0, 1)).toBe('writer')
    expect(neighbourIn(nodes, 'wiki', -1, 0)).toBeNull()
  })

  it('builds dotted lines only for the bubble asked for, so many documents stay cheap', () => {
    const docs = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, type: i % 2 ? ('sketch' as const) : ('moodboard' as const), title: `${i}` }))
    const nodes = [...toolNodes('sketch', true, docs), ...toolNodes('moodboard', true, docs)]
    const meta = { documents: docs, jumps: [] } as never
    expect(mapEdges(nodes, meta, [], ['moodboard']).filter((e) => e.kind === 'route')).toHaveLength(400) // every pair
    const one = mapEdges(nodes, meta, [], ['moodboard'], undefined, undefined, 'sketch:s1')
    expect(one).toHaveLength(20)
    expect(one.every((e) => e.a === 'sketch:s1' || e.b === 'sketch:s1')).toBe(true)
    expect(mapEdges(nodes, meta, [], ['moodboard'], undefined, undefined, null)).toEqual([])
  })

  it('draws mentions of records kept inside a document, and of one-bubble tools', () => {
    const article = 'cccccccc-0000-4000-8000-000000000003'
    const docs = [{ id: 'dddddddd-0000-4000-8000-000000000004', type: 'writer' as const, title: 'Story' }]
    const nodes = [...toolNodes('writer', true, docs), ...toolNodes('wiki', false, docs)]
    const writer = { kind: 'document' as const, componentType: 'writer' as const, documentId: docs[0].id, title: 'Story' }
    const wikiFile = { kind: 'document' as const, componentType: 'wiki' as const, documentId: 'wiki', title: null }
    const index = new Map([[article, [{ source: writer, fields: ['html'] }]]])
    const owned = new Map([[article, wikiFile]])
    expect(mapEdges(nodes, { documents: docs, jumps: [] } as never, [], [], index, owned, null)).toEqual([{ a: 'wiki', b: `writer:${docs[0].id}`, kind: 'link', count: 1, why: '1 mention' }])
    expect(mapEdges(nodes, { documents: docs, jumps: [] } as never, [], [], index, undefined, null)).toEqual([]) // without knowing the owner: nothing
  })

  it('keeps the gentle bend on huge maps instead of comparing every line', () => {
    const nodes = new Map(Array.from({ length: MAX_BENT + 2 }, (_, i) => [`n${i}`, { x: i * 10, y: 0 }]))
    const edges = Array.from({ length: MAX_BENT + 1 }, (_, i) => ({ a: `n${i}`, b: `n${i + 1}` }))
    expect(bendEdges(nodes, edges).every((b) => b === DEFAULT_BEND)).toBe(true)
  })
})
