import { describe, expect, it } from 'vitest'
import { COMPONENT_TYPES, type ComponentType, type Entity } from '@/core/model'
import { groupTools, IMAGE_SENDERS, layoutMap, mapEdges, neighbourIn, ROUTES, STEP } from './graph'

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
    const shown: ComponentType[] = ['map', 'item-list', 'character-list', 'writer', 'sketch', 'moodboard']
    const edges = mapEdges(shown, meta as never, [sword], ['moodboard', 'asset-pool'], index)
    expect(edges).toEqual([
      { a: 'item-list', b: 'map', kind: 'link', count: 1, why: '1 jump point' },
      { a: 'character-list', b: 'item-list', kind: 'link', count: 1, why: '1 connection' },
      { a: 'item-list', b: 'writer', kind: 'link', count: 1, why: '1 mention' },
      { a: 'moodboard', b: 'sketch', kind: 'route', count: 1, why: 'Send to, Pictures' },
    ])
  })

  it('moves with the arrow keys to the nearest bubble in that direction', () => {
    const nodes = new Map<ComponentType, { x: number; y: number }>([['wiki', { x: 0, y: 0 }], ['map', { x: 100, y: 10 }], ['tasks', { x: 300, y: 0 }], ['writer', { x: 0, y: 120 }]])
    expect(neighbourIn(nodes, 'wiki', 1, 0)).toBe('map')
    expect(neighbourIn(nodes, 'wiki', 0, 1)).toBe('writer')
    expect(neighbourIn(nodes, 'wiki', -1, 0)).toBeNull()
  })
})
