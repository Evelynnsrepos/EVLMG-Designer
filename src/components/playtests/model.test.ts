import { describe, expect, it } from 'vitest'
import { byBuild, newFinding, newSection, newSession, openBugs, openFindings, sectionAverages, syncSections } from './model'

describe('playtests', () => {
  it('averages scores per build and sorts open findings by severity', () => {
    const a = {
      ...newSession(),
      date: '2026-10-01',
      build: '0.1',
      fun: 4,
      findings: [
        {
          ...newFinding(),
          text: 'Typo',
          severity: 'minor' as const,
          area: 'Menu',
        },
      ],
    }
    const b = {
      ...newSession(),
      date: '2026-10-02',
      build: '0.1',
      fun: 6,
      findings: [
        {
          ...newFinding(),
          text: 'Crash',
          severity: 'blocker' as const,
          area: 'Menu',
        },
        { ...newFinding(), text: 'Old', fixed: true },
      ],
    }
    const c = { ...newSession(), date: '2026-10-05', build: '0.2', fun: 8 }
    expect(byBuild([c, a, b]).map((x) => [x.build, x.sessions, x.fun])).toEqual([
      ['0.1', 2, 5],
      ['0.2', 1, 8],
    ])
    const o = openFindings([a, b, c])
    expect(o.list.map((f) => f.text)).toEqual(['Crash', 'Typo'])
    expect(o.areas).toEqual([['Menu', 2]])
  })
})

describe('playtest sections (0.35)', () => {
  it('keeps sections in step with the journey and averages them across sessions', () => {
    const beats = [
      { id: 'b2', name: 'Town', at: 20 },
      { id: 'b1', name: 'Intro', at: 0 },
    ]
    const own = { ...newSection('Menu'), boring: 5 }
    const synced = syncSections([{ ...newSection('Old intro name', 'b1'), fun: 2 }, own], beats)
    expect(synced.map((x) => [x.name, x.beatId])).toEqual([
      ['Intro', 'b1'],
      ['Town', 'b2'],
      ['Menu', null],
    ])
    expect(synced[0].fun).toBe(2)
    expect(synced[1].id).toBe('b2')
    // A deleted beat keeps its ratings as a hand-made section.
    expect(syncSections(synced, [beats[0]]).map((x) => [x.name, x.beatId])).toEqual([
      ['Town', 'b2'],
      ['Intro', null],
      ['Menu', null],
    ])

    const town = (boring: number, sid: string) => ({ ...newSection('Town', 'b2'), id: sid, boring, length: 5, minutes: 10 })
    const a = { ...newSession(), sections: [town(4, 's1')], log: [{ id: 'o1', t: 5, sectionId: 's1', tag: 'Bored', text: '' }], findings: [{ ...newFinding('bug'), text: 'Door', sectionId: 's1' }] }
    const b = { ...newSession(), sections: [town(5, 's2'), { ...newSection('Intro', 'b1'), fun: 4 }], log: [{ id: 'o2', t: 9, sectionId: 's2', tag: 'Bored', text: '' }] }
    const avg = sectionAverages([a, b], new Set(['b1', 'b2']))
    const t = avg.find((x) => x.beatId === 'b2')!
    expect([t.testers, t.boring, t.length, t.minutes, t.fun]).toEqual([2, 4.5, 5, 10, null])
    expect(t.tags).toEqual([['Bored', 2]])
    expect(t.bugs).toBe(1)
    expect(t.flags).toEqual(['boring', 'too long'])
    expect(avg.find((x) => x.beatId === 'b1')!.flags).toEqual([])
    expect(openBugs([a, b]).map((f) => f.text)).toEqual(['Door'])
  })
})
