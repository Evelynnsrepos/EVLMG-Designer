import { describe, expect, it } from 'vitest'
import { emptyGraph, GALLERY, galleryGraph, loadMaterial, materialParam, searchGallery } from './material'

describe('materials', () => {
  it('finds where each map of a gallery material comes from', () => {
    const m = loadMaterial(galleryGraph('bricks'))
    expect(m.sources.albedo).not.toBeNull()
    expect(m.sources.normal).not.toBeNull()
    expect(m.sources.emission).toBeNull()
    expect(m.graph.child('Material')).toBeUndefined()
  })
  it('an empty material has no maps and default settings', () => {
    const m = loadMaterial(emptyGraph())
    expect(Object.values(m.sources).every(s => s === null)).toBe(true)
    expect(materialParam(emptyGraph(), 'roughness')).toBe(1)
  })
  it('searches by everyday words', () => {
    expect(GALLERY.length).toBeGreaterThan(25)
    expect(searchGallery('old wall').map(e => e.id)).toContain('improved_brick')
    expect(searchGallery('zzz')).toEqual([])
  })
})
