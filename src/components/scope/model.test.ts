import { describe, expect, it } from 'vitest'
import { type ScopeDoc, type Version, moveItem, patchNotes, putFeature, setMark, ship, unplanned, addToVersion, createScopeDoc, deleteFeature, feedBack, newFeature, newVersion, nextVersionName, notInVersion, resolveItems, versionDays, versionsOf } from './model'

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

  it('locks scope, moves between versions, ships with carry-over and writes patch notes', () => {
    const a = { ...newFeature('must'), title: 'Combat', effort: 5, status: 'Done' as const }
    const b = { ...newFeature('should'), title: 'Fishing', effort: 3 }
    const c = { ...newFeature('could'), title: 'Pets' }
    const v1: Version = { ...newVersion([]), name: '0.1' }
    const v2: Version = { ...newVersion([v1]), name: '0.2' }
    let d: ScopeDoc = { ...createScopeDoc(), items: [a, b, c], versions: [v1, v2] }
    d = putFeature(d, v1.id, { ref: a.id }, undefined, 't1')
    d = putFeature(d, v1.id, { ref: b.id }, undefined, 't1')
    expect(d.versions![0].items.map((i) => i.mark)).toEqual(['planned', 'planned'])
    expect(unplanned(d).map((f) => f.title)).toEqual(['Pets'])

    // locked: new things count as added, a second put of the same feature does nothing
    d = { ...d, versions: d.versions!.map((v) => (v.id === v1.id ? { ...v, lockedAt: 't2' } : v)) }
    d = putFeature(d, v1.id, { ref: c.id }, undefined, 't3')
    d = putFeature(d, v1.id, { ref: c.id }, undefined, 't3')
    expect(d.versions![0].items.map((i) => i.mark)).toEqual(['planned', 'planned', 'added'])

    // cut with a reason, history kept
    const pets = d.versions![0].items[2]
    d = setMark(d, v1.id, pets.id, 'cut', 'No time', 't4')
    expect(d.versions![0].items[2]).toMatchObject({ mark: 'cut', reason: 'No time' })
    expect(d.versions![0].items[2].log!.map((l) => l.mark)).toEqual(['added', 'cut'])

    // ship 0.1: unfinished Fishing moves to 0.2, stays in 0.1 as cut "Moved to 0.2"; Combat (done) stays
    d = ship(d, v1.id, v2.id, 't5')
    const [s1, s2] = d.versions!
    expect(s1.state).toBe('shipped')
    expect(s1.items.find((i) => i.ref === b.id)).toMatchObject({ mark: 'cut', reason: 'Moved to 0.2', movedTo: v2.id })
    expect(s2.items).toHaveLength(1)
    expect(s2.items[0]).toMatchObject({ ref: b.id, mark: 'planned' })
    expect(s2.items[0].log![0].note).toBe('From 0.1')

    // a shipped version takes nothing new
    expect(putFeature(d, v1.id, { ref: c.id })).toBe(d)
    // an open version just lets an item go
    expect(moveItem(d, v2.id, s2.items[0].id, null).versions![1].items).toEqual([])

    const notes = patchNotes(d, d.versions!)
    expect(notes.indexOf('## 0.2')).toBeLessThan(notes.indexOf('## 0.1'))
    expect(notes).toContain('### In this version\n\n- Combat')
    expect(notes).toContain('- Pets (No time)')
    expect(notes).toContain('- Fishing (Moved to 0.2)')
  })
})
