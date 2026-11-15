import { describe, expect, it } from 'vitest'
import { dragPart, insertAnchor, invertMatrix, applyMatrix, nodeMatrix, normalize, pathD, removeAnchor, toggleSmooth, type SubPath } from './paths'
import { expandGroups, withPaths } from './tools'
import { createVectorDoc, makeShape, type PathNode } from './model'

const tri: SubPath[] = [{ anchors: [{ p: [0, 0] }, { p: [10, 0] }, { p: [10, 10] }], closed: true }]

describe('point paths', () => {
  it('writes straight lines and curves as SVG path data', () => {
    expect(pathD(tri)).toBe('M 0 0 L 10 0 L 10 10 L 0 0 Z')
    expect(pathD([{ anchors: [{ p: [0, 0], out: [5, -5] }, { p: [10, 0] }], closed: false }])).toBe('M 0 0 C 5 -5 10 0 10 0')
  })

  it('adds a point on the outline without changing it', () => {
    const r = insertAnchor(tri, 0, 0, 0.5)
    expect(r[0].anchors[1].p).toEqual([5, 0])
    expect(pathD(r)).toBe('M 0 0 L 5 0 L 10 0 L 10 10 L 0 0 Z')
  })

  it('smooth points turn both handles together; Alt breaks them', () => {
    const s = toggleSmooth(tri, 0, 1)
    const a = s[0].anchors[1]
    expect(a.kind).toBe('Smooth')
    const moved = dragPart(s, 0, 1, 'out', [10, 10])[0].anchors[1]
    expect(moved.in![0]).toBeCloseTo(10)
    expect(moved.in![1]).toBeLessThan(0)
    const broken = dragPart(s, 0, 1, 'out', [10, 10], true)[0].anchors[1]
    expect(broken.in).toEqual(a.in)
    expect(broken.kind).toBe('Corner')
  })

  it('drops a closed path that has too few points left', () => {
    expect(removeAnchor(tri, 0, 0)).toEqual([])
  })

  it('keeps edited points in place on screen', () => {
    const n: PathNode = { id: 'p', kind: 'vpath', layerId: 'l', x: 100, y: 50, rotation: 90, paths: tri, width: 10, height: 10 }
    const before = applyMatrix(nodeMatrix(n), [10, 10])
    const moved = dragPart(n.paths, 0, 0, 'p', [-5, -5])
    const after = withPaths(n, moved)
    const k = after.paths[0].anchors[2].p
    const now = applyMatrix(nodeMatrix(after), k)
    expect(now[0]).toBeCloseTo(before[0])
    expect(now[1]).toBeCloseTo(before[1])
    expect(normalize(after.paths).dx).toBe(0)
  })

  it('inverts the node matrix', () => {
    const m = nodeMatrix({ x: 3, y: 4, rotation: 30, scaleX: 2 })
    const p = applyMatrix(invertMatrix(m), applyMatrix(m, [7, -2]))
    expect(p[0]).toBeCloseTo(7)
    expect(p[1]).toBeCloseTo(-2)
  })

  it('selecting one item of a group picks the whole group', () => {
    const d = createVectorDoc()
    const l = d.scene.layers[0].id
    d.scene.nodes = [{ ...makeShape(l, 'rect', 0, 0, 1, 1), id: 'a', groupId: 'g' }, { ...makeShape(l, 'rect', 0, 0, 1, 1), id: 'b', groupId: 'g' }, { ...makeShape(l, 'rect', 0, 0, 1, 1), id: 'c' }]
    expect(expandGroups(d.scene, ['a']).sort()).toEqual(['a', 'b'])
    expect(expandGroups(d.scene, ['c'])).toEqual(['c'])
  })
})
