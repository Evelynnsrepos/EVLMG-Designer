import { describe, expect, it } from 'vitest'
import { BASE_BRUSH, defaultLibrary, isRibbon, isShaded, normalizeBrush, strokeAlpha } from './brushes'
import { V05_BUILTIN_IDS } from './brushDefaults'
import { mergeBuiltIns } from './library'

describe('brush settings', () => {
  it('fills in new settings for brushes saved by v0.5 and fixes broken values', () => {
    const old = { id: 'x', name: 'Old', size: 20, shape: 'nope', spacing: Number.NaN, rotation: 30, count: 2.6 } as never
    const b = normalizeBrush(old)
    expect(b.size).toBe(20)
    expect(b.shape).toBe('round')
    expect(b.spacing).toBe(BASE_BRUSH.spacing)
    expect(b.rotation).toBe(30)
    expect(b.count).toBe(3)
    expect(b.sizePresets).toEqual([null, null, null, null])
    expect(b.pressureCurve).toHaveLength(2)
    expect(b.dual).toBeNull()
  })

  it('a dual brush never nests', () => {
    const b = normalizeBrush({ id: 'x', name: 'D', dual: { size: 4, dual: { size: 2 } } } as never)
    expect(b.dual?.size).toBe(4)
    expect(b.dual?.dual).toBeNull()
  })

  it('glaze caps at opacity, blending paints each stamp', () => {
    expect(strokeAlpha({ ...BASE_BRUSH, opacity: 0.5 })).toBe(0.5)
    expect(strokeAlpha({ ...BASE_BRUSH, opacity: 0.5, renderMode: 'uniform-blending' })).toBe(1)
  })

  it('the default library is big, with unique ids', () => {
    const lib = defaultLibrary()
    expect(lib.brushes.length).toBeGreaterThan(100)
    expect(new Set(lib.brushes.map((b) => b.id)).size).toBe(lib.brushes.length)
    for (const id of V05_BUILTIN_IDS) expect(lib.brushes.some((b) => b.id === id)).toBe(true)
  })

  it('adds new built-ins to old libraries but keeps what the user deleted deleted', () => {
    const fresh = defaultLibrary()
    // A v0.5 user who deleted Stipple and has a set of their own.
    const savedBrushes = fresh.brushes.filter((b) => V05_BUILTIN_IDS.includes(b.id) && b.id !== 'stipple')
    const savedSets = [
      { id: 'mine', name: 'Mine', brushIds: [] },
      ...fresh.sets.filter((s) => s.id === 'textures' || s.id === 'sketching').map((s) => ({ ...s, brushIds: s.brushIds.filter((id) => savedBrushes.some((b) => b.id === id)) })),
    ]
    const { sets, brushes } = mergeBuiltIns(savedSets, savedBrushes, V05_BUILTIN_IDS)
    expect(brushes.some((b) => b.id === 'stipple')).toBe(false)
    expect(sets.find((s) => s.id === 'sketching')!.brushIds).toContain('2h-pencil')
    expect(sets.some((s) => s.id === 'comics')).toBe(true)
    expect(sets[0].id).toBe('mine')
    for (const s of sets) for (const id of s.brushIds) expect(brushes.some((b) => b.id === id)).toBe(true)
  })
})

describe('ribbon, shading and caps (0.31)', () => {
  it('are off for older brushes and keep only sensible values', () => {
    const old = normalizeBrush({ id: 'x', name: 'Old' })
    expect([old.ribbon, old.shaded, old.capStart, old.capEnd]).toEqual(['off', false, null, null])
    const odd = normalizeBrush({ id: 'y', name: 'Odd', ribbon: 'zigzag', shaded: 'yes', capStart: '', capEnd: 'data:image/png;base64,x' } as never)
    expect([odd.ribbon, odd.shaded, odd.capStart, odd.capEnd]).toEqual(['off', false, null, 'data:image/png;base64,x'])
    expect(isShaded({ ...BASE_BRUSH, shaded: true })).toBe(false)
    expect(isShaded({ ...BASE_BRUSH, shaded: true, shapeImage: 'data:x' })).toBe(true)
    expect(isRibbon({ ...BASE_BRUSH, ribbon: 'tile' })).toBe(true)
  })
})
