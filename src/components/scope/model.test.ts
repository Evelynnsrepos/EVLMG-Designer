import { describe, expect, it } from 'vitest'
import { type ScopeDoc, addToVersion, createScopeDoc, deleteFeature, feedBack, newFeature, newVersion, nextVersionName, notInVersion, resolveItems, versionDays, versionsOf } from './model'

describe('scope versions', () => {
  it('names the next version', () => {
    expect(nextVersionName(undefined)).toBe('0.1')
    expect(nextVersionName('0.9')).toBe('0.10')
    expect(nextVersionName('1.0 Beta')).toBe('1.1 Beta')
    expect(nextVersionName('Launch')).toBe('Launch 2')
  })

  it('links plan features, keeps own ones, feeds them back and cleans up', () => {
    const a = { ...newFeature('must'), effort: 5 }
    const own = { ...newFeature('should'), effort: 2 }
    const v = newVersion([])
    let d: ScopeDoc = { ...createScopeDoc(), items: [a], versions: [v] }
    d = addToVersion(d, v.id, { id: 'i1', mark: 'planned', ref: a.id })
    d = addToVersion(d, v.id, { id: 'i2', mark: 'added', feature: own })
    expect(versionDays(d, d.versions![0])).toEqual({ inScope: 7, added: 2, cut: 0 })
    expect(notInVersion(d, d.versions![0])).toEqual([])
    expect(versionsOf(d, a.id).map((x) => x.id)).toEqual([v.id])

    d = feedBack(d, v.id, 'i2')
    expect(d.items).toHaveLength(2)
    expect(d.items[1].addedIn).toBe(v.id)
    expect(d.versions![0].items[1]).toEqual({ id: 'i2', mark: 'added', ref: own.id })
    expect(resolveItems(d, d.versions![0]).every((r) => !r.custom)).toBe(true)

    d = deleteFeature(d, a.id)
    expect(d.versions![0].items.map((i) => i.id)).toEqual(['i2'])
  })
})
