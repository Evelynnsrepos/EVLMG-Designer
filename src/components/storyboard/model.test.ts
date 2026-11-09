import { describe, expect, it } from 'vitest'
import { cutLabel, formatTime, formatTimecode, framesFromWriter, linkedText, newFrame, numberFrames, panelLetter, parseTime, writerSections } from './model'

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const h = (text: string) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] })
const script = { type: 'doc', content: [p('Cold open.'), h('Rooftop'), p('Rain.'), p('Aiko: Late again.'), h('Classroom'), p('Bell rings.')] }

describe('numbering', () => {
  it('counts scenes, cuts and panels, and cut lengths', () => {
    const frames = [newFrame({ seconds: 2 }), newFrame({ seconds: 1, sameCut: true }), newFrame({ seconds: 3 }), newFrame({ seconds: 4, sceneStart: true, scene: 'Roof' }), newFrame({ seconds: 1, sameCut: true })]
    const n = numberFrames(frames)
    expect(n.map((x) => [x.scene, x.cut, x.panel, x.panels])).toEqual([
      [1, 1, 0, 2],
      [1, 1, 1, 2],
      [1, 2, 0, 1],
      [2, 3, 0, 2],
      [2, 3, 1, 2],
    ])
    expect(n[0].cutSeconds).toBe(3)
    expect(n[3].start).toBe(6)
    expect(n[3].sceneName).toBe('Roof')
    expect(cutLabel(n[1])).toBe('C1 B')
    expect(cutLabel(n[2])).toBe('C2')
  })
  it('a scene start always begins a new cut, and old boards (no new fields) are one cut per frame', () => {
    const n = numberFrames([newFrame(), newFrame({ sceneStart: true, sameCut: true }), newFrame()])
    expect(n.map((x) => x.cut)).toEqual([1, 2, 3])
  })
  it('letters panels past Z', () => {
    expect([0, 25, 26, 27].map(panelLetter)).toEqual(['A', 'Z', 'AA', 'AB'])
  })
})

describe('timing', () => {
  it('writes seconds + frames and timecode', () => {
    expect(formatTime(3.5, 24)).toBe('3+12')
    expect(formatTime(1 / 24, 24)).toBe('0+01')
    expect(formatTimecode(62.25, 24)).toBe('1:02+06')
  })
  it('reads what people type', () => {
    expect(parseTime('3+12', 24)).toBe(3.5)
    expect(parseTime('36k', 24)).toBe(1.5)
    expect(parseTime('2,5', 24)).toBe(2.5)
    expect(parseTime('4s', 30)).toBe(4)
    expect(parseTime('0', 24)).toBe(1 / 24)
    expect(parseTime('soon', 24)).toBeNull()
  })
})

describe('Writer links', () => {
  it('cuts a document at its headings', () => {
    const s = writerSections(script)
    expect(s.map((x) => x.heading)).toEqual([null, 'Rooftop', 'Classroom'])
    expect(s[1].paragraphs).toEqual(['Rain.', 'Aiko: Late again.'])
    expect(linkedText(script, 'Rooftop')).toBe('Rain.\n\nAiko: Late again.')
    expect(linkedText(script, 'Gone')).toBeNull()
    expect(linkedText(script, null)).toContain('Bell rings.')
  })
  it('makes panels per heading or per paragraph', () => {
    const perHeading = framesFromWriter('w1', script, 'heading')
    expect(perHeading.map((f) => f.scene)).toEqual(['', 'Rooftop', 'Classroom'])
    expect(perHeading.every((f) => f.sceneStart && f.writer?.documentId === 'w1')).toBe(true)
    const perParagraph = framesFromWriter('w1', script, 'paragraph')
    expect(perParagraph.map((f) => f.action)).toEqual(['Cold open.', 'Rain.', 'Aiko: Late again.', 'Bell rings.'])
    expect(perParagraph.map((f) => !!f.sceneStart)).toEqual([true, true, false, true])
    expect(numberFrames(perParagraph).map((x) => x.scene)).toEqual([1, 2, 2, 3])
  })
})
