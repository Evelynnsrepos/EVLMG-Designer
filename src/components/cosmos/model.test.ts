import { describe, expect, it } from 'vitest'
import { addBody, childrenOf, createCosmos, moveBody, orbitLayout, pathTo, removeBody, subtreeIds, updateBody } from './model'

function sample() {
  let c = createCosmos()
  const galaxy = addBody(c, null)
  c = galaxy.cosmos
  const system = addBody(c, galaxy.body.id)
  c = system.cosmos
  const planet = addBody(c, system.body.id)
  c = planet.cosmos
  const moon = addBody(c, planet.body.id)
  return { c: moon.cosmos, galaxy: galaxy.body, system: system.body, planet: planet.body, moon: moon.body }
}

describe('cosmos', () => {
  it('adds the natural child kind with a numbered name', () => {
    const { c, galaxy, system, planet, moon } = sample()
    expect([galaxy.kind, system.kind, planet.kind, moon.kind]).toEqual(['galaxy', 'solar-system', 'planet', 'moon'])
    expect(planet.name).toBe('Planet 1')
    expect(addBody(c, system.id).body.name).toBe('Planet 2')
    expect(addBody(c, system.id, 'star').body.kind).toBe('star')
  })

  it('shows the path from the top for the breadcrumb', () => {
    const { c, galaxy, system, planet, moon } = sample()
    expect(pathTo(c, moon.id).map((b) => b.id)).toEqual([galaxy.id, system.id, planet.id, moon.id])
    expect(pathTo(c, null)).toEqual([])
  })

  it('deletes a body with everything inside it', () => {
    const { c, galaxy, system } = sample()
    expect(subtreeIds(c, system.id).size).toBe(3)
    expect(removeBody(c, system.id).bodies.map((b) => b.id)).toEqual([galaxy.id])
  })

  it('moves bodies but never into themselves', () => {
    const { c, galaxy, system, moon } = sample()
    expect(moveBody(c, system.id, moon.id)).toBe(c)
    const moved = moveBody(c, moon.id, galaxy.id)
    expect(childrenOf(moved, galaxy.id).map((b) => b.id)).toEqual([system.id, moon.id])
    expect(childrenOf(moveBody(c, galaxy.id, null), null).length).toBe(1)
  })

  it('edits fields without touching the parent', () => {
    const { c, planet } = sample()
    const next = updateBody(c, planet.id, { name: 'Terra', color: '#00ff00' })
    expect(next.bodies.find((b) => b.id === planet.id)).toMatchObject({ name: 'Terra', color: '#00ff00', parentId: planet.parentId })
  })

  it('puts each child on its own orbit inside the view', () => {
    const o = orbitLayout(5)
    expect(new Set(o.map((p) => p.r)).size).toBe(5)
    for (const p of o) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(281)
    expect(orbitLayout(1)[0].r).toBe(175)
    expect(orbitLayout(0)).toEqual([])
  })
})

describe('v0.4 views', () => {
  it('lays out a tree with parents centered over their children', async () => {
    const { treeLayout, showsOrbits } = await import('./model')
    let c = createCosmos()
    const g = addBody(c, null, 'galaxy')
    c = g.cosmos
    const a = addBody(c, g.body.id, 'solar-system')
    c = a.cosmos
    const b = addBody(c, g.body.id, 'solar-system')
    c = b.cosmos
    const { nodes, edges } = treeLayout(c, null)
    const pos = (id: string) => nodes.find((n) => n.body.id === id)!
    expect(pos(g.body.id).x).toBe((pos(a.body.id).x + pos(b.body.id).x) / 2)
    expect(pos(a.body.id).y).toBeGreaterThan(pos(g.body.id).y)
    expect(edges).toHaveLength(2)
    expect(showsOrbits(null)).toBe(false)
    expect(showsOrbits(g.body)).toBe(true)
  })
})

describe('art styles (v0.35)', () => {
  it('gives every kind pictures in every style, and Next look cycles', async () => {
    const { ART_STYLES, artFor, lookCount, variantOf } = await import('./art')
    const { BODY_KINDS } = await import('./model')
    for (const style of ART_STYLES)
      for (const kind of BODY_KINDS) {
        const art = artFor(style, kind, 3)
        if (style === 'flat' && art === null) continue // plain disc
        expect(art!.length).toBeGreaterThan(0)
        expect(lookCount(style, kind)).toBeGreaterThan(0)
      }
    expect(artFor('custom', 'planet', 0, 'blob:me')).toEqual([{ src: 'blob:me', s: 1.2 }])
    expect(artFor('painted', 'planet', 0)).not.toEqual(artFor('painted', 'planet', 1))
    expect(variantOf('abc')).toBe(variantOf('abc'))
    expect(variantOf('abc', 4)).toBe(4)
  })
})
