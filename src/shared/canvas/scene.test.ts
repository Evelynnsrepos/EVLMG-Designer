import { describe, expect, it } from 'vitest'
import {
  addLayer,
  addNodes,
  createScene,
  deleteNodes,
  duplicateNodes,
  ensureTopLayer,
  moveLayer,
  moveNodeInLayer,
  removeLayer,
  renderOrder,
  reorderNodes,
  resolveActiveLayer,
  selectableNodes,
  translateNodes,
  updateLayer,
} from './scene'
import type { BuiltinNode, ConnectorNode, RectNode, Scene } from './types'

const rect = (id: string, layerId: string, x = 0): RectNode => ({ id, kind: 'rect', layerId, x, y: 0, width: 10, height: 10 })
const link = (id: string, layerId: string, fromId: string, toId: string): ConnectorNode => ({ id, kind: 'connector', layerId, x: 0, y: 0, fromId, toId })

function sample(): Scene<BuiltinNode> {
  const s = createScene()
  const L = s.layers[0].id
  return addNodes(s, [rect('a', L), rect('b', L, 50), rect('c', L, 100), link('ab', L, 'a', 'b'), link('bc', L, 'b', 'c')])
}

describe('scene nodes', () => {
  it('starts with one layer', () => {
    const s = createScene()
    expect(s.layers).toHaveLength(1)
    expect(s.nodes).toEqual([])
  })

  it('deletes nodes and the connectors attached to them', () => {
    const s = deleteNodes(sample(), ['b'])
    expect(s.nodes.map((n) => n.id)).toEqual(['a', 'c'])
  })

  it('returns the same scene when nothing changes', () => {
    const s = sample()
    expect(deleteNodes(s, ['missing'])).toBe(s)
    expect(translateNodes(s, ['a'], 0, 0)).toBe(s)
  })

  it('moves nodes but leaves connectors to follow', () => {
    const s = translateNodes(sample(), ['a', 'ab'], 5, 7, (n) => n.kind === 'connector')
    expect(s.nodes.find((n) => n.id === 'a')).toMatchObject({ x: 5, y: 7 })
    expect(s.nodes.find((n) => n.id === 'ab')).toMatchObject({ x: 0, y: 0 })
  })

  it('duplicates nodes and rewires connectors between copies only', () => {
    const { scene, ids } = duplicateNodes(sample(), ['a', 'b', 'ab', 'bc'], 10, 0)
    expect(ids).toHaveLength(3) // a, b and the a→b link; b→c needs c
    const copies = scene.nodes.filter((n) => ids.includes(n.id))
    const linkCopy = copies.find((n) => n.kind === 'connector') as ConnectorNode
    const [ca, cb] = copies.filter((n) => n.kind === 'rect')
    expect(linkCopy.fromId).toBe(ca.id)
    expect(linkCopy.toId).toBe(cb.id)
    expect(ca.x).toBe(10)
  })

  it('reorders within a layer', () => {
    const s = sample()
    expect(reorderNodes(s, ['a'], 'forward').nodes.map((n) => n.id).slice(0, 3)).toEqual(['b', 'a', 'c'])
    expect(reorderNodes(s, ['c'], 'back').nodes[0].id).toBe('c')
    expect(reorderNodes(s, ['a'], 'front').nodes.at(-1)!.id).toBe('a')
    expect(moveNodeInLayer(s, 'c', 0).nodes[0].id).toBe('c')
  })
})

describe('layers', () => {
  it('draws always-on-top layers above all others (MB-6)', () => {
    let s = sample()
    const base = s.layers[0].id
    const top = ensureTopLayer(s)
    s = top.scene
    const extra = addLayer(s, { name: 'Images' })
    s = addNodes(extra.scene, [rect('img', extra.id), rect('pen', top.id)])
    expect(renderOrder(s).map((g) => g.layer.id)).toEqual([base, extra.id, top.id])
    expect(ensureTopLayer(s).id).toBe(top.id)
  })

  it('hides and locks layers', () => {
    let s = sample()
    const L = s.layers[0].id
    s = updateLayer(s, L, { locked: true })
    expect(selectableNodes(s)).toHaveLength(0)
    s = updateLayer(s, L, { locked: false, hidden: true })
    expect(selectableNodes(s)).toHaveLength(0)
  })

  it('limits selection to one layer when scoped, never a locked one (0.22)', () => {
    let s = createScene()
    const a = s.layers[0].id
    const b = addLayer(s, {})
    s = addNodes(b.scene, [rect('x', a), rect('y', b.id), rect('z', b.id)])
    expect(selectableNodes(s, b.id).map((n) => n.id)).toEqual(['y', 'z'])
    expect(selectableNodes(s, a).map((n) => n.id)).toEqual(['x'])
    s = updateLayer(s, b.id, { locked: true })
    expect(selectableNodes(s, b.id)).toHaveLength(0)
  })

  it('picks a usable layer for new nodes', () => {
    let s = sample()
    const first = s.layers[0].id
    const second = addLayer(s, {})
    s = second.scene
    expect(resolveActiveLayer(s, null)).toBe(second.id)
    expect(resolveActiveLayer(s, first)).toBe(first)
    s = updateLayer(s, second.id, { locked: true })
    expect(resolveActiveLayer(s, second.id)).toBe(first)
  })

  it('moves and removes layers, keeping at least one', () => {
    let s = sample()
    const first = s.layers[0].id
    const second = addLayer(s, {})
    s = addNodes(second.scene, [rect('x', second.id)])
    expect(moveLayer(s, second.id, 0).layers[0].id).toBe(second.id)
    s = removeLayer(s, second.id)
    expect(s.layers.map((l) => l.id)).toEqual([first])
    expect(s.nodes.some((n) => n.id === 'x')).toBe(false)
    expect(removeLayer(s, first)).toBe(s)
  })
})
