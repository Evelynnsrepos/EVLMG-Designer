import { describe, expect, it } from 'vitest'
import { allNodeIds, listNodes, unsupportedReason } from './library'
import { testShader } from './nodeCheck'

const EXCLUDED = ['skewed_bricks', 'skewed_uneven_bricks', 'shard_fbm', 'voronoi_triangle']

describe('Material Lab node library', () => {
  it('leaves out the nodes whose licence is unclear', () => {
    for (const id of EXCLUDED) expect(allNodeIds()).not.toContain(id)
  })

  it('builds a complete shader for every included node', () => {
    const nodes = listNodes()
    expect(nodes.length).toBeGreaterThan(200)
    const failed: string[] = []
    for (const n of nodes) {
      const src = testShader(n.id)
      if (src.includes('(error')) failed.push(`${n.id}: ${src.match(/\(error[^)]*\)/)?.[0]}`)
    }
    expect(failed).toEqual([])
  })

  it('says why a node is left out', () => {
    expect(unsupportedReason('perlin')).toBeNull()
    expect(unsupportedReason('material')).not.toBeNull()
  })
})
