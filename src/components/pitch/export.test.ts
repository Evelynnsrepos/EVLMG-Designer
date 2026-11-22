import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { THEMES, exportSlide, newSlide, newObj, unlockLayout, type ExportDeck } from './model'
import { deckToOdp } from './odp'
import { deckToPptx } from './pptx'

// 1x1 red PNG
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

function sampleDeck(): ExportDeck {
  const theme = THEMES[0]
  const ctx = { width: 1920, theme, pillars: [{ title: 'Cozy', why: 'Feel safe & warm <3', color: '#ff8800' }], entities: {} }
  const free = newSlide('blank', {
    notes: 'Say hello\nthen smile',
    transition: 'fade',
    objects: [
      newObj('text', { text: 'Bullets\nTwo', bullets: true, bold: true, caps: true, rot: 15 }),
      newObj('shape', { shape: 'arrow', stroke: '#112233' }),
      newObj('shape', { shape: 'ellipse', fill: '#00ff00', text: 'In a circle' }),
      newObj('image', { image: 'assets/images/a.png' }),
    ],
  })
  const slides = [newSlide('title', { title: 'My game', text: 'A pitch', image: 'assets/images/a.png' }), newSlide('pillars', { title: 'Pillars', hidden: true }), free]
  return { width: 1920, theme, title: 'Test & deck', slides: slides.map((s) => exportSlide(s, ctx)), images: new Map([['assets/images/a.png', { png: PNG, w: 1, h: 1 }]]) }
}

const wellFormed = (xml: string) => {
  // Every opened tag closes: a cheap check without a DOM parser.
  const stack: string[] = []
  for (const m of xml.replace(/<\?[^>]*\?>/g, '').matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue
    if (m[1]) expect(stack.pop()).toBe(m[2])
    else stack.push(m[2])
  }
  expect(stack).toEqual([])
}

describe('pitch deck export', () => {
  it('writes a .pptx with slides, notes, hidden slide, picture and escaped text', () => {
    const files = unzipSync(deckToPptx(sampleDeck()))
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'ppt/presentation.xml', 'ppt/slides/slide3.xml', 'ppt/notesSlides/notesSlide3.xml', 'ppt/media/image1.png']))
    for (const [name, bytes] of Object.entries(files)) if (name.endsWith('.xml') || name.endsWith('.rels')) wellFormed(strFromU8(bytes))
    expect(strFromU8(files['ppt/slides/slide2.xml'])).toContain('show="0"')
    expect(strFromU8(files['ppt/slides/slide2.xml'])).toContain('Feel safe &amp; warm &lt;3')
    expect(strFromU8(files['ppt/slides/slide3.xml'])).toContain('<p:fade/>')
    expect(strFromU8(files['ppt/slides/slide3.xml'])).toContain('cap="small"')
  })

  it('writes an .odp with the mimetype first and stored', () => {
    const zip = deckToOdp(sampleDeck())
    expect(strFromU8(zip.slice(30, 38))).toBe('mimetype')
    const files = unzipSync(zip)
    for (const name of ['content.xml', 'styles.xml', 'meta.xml', 'META-INF/manifest.xml']) wellFormed(strFromU8(files[name]))
    const content = strFromU8(files['content.xml'])
    expect(content).toContain('presentation:visibility="hidden"')
    expect(content).toContain('<presentation:notes>')
    expect(content).toContain('fo:font-variant="small-caps"')
    expect(files['Pictures/image1.png']).toBeDefined()
  })

  it('unlocks a layout into free objects with new ids', () => {
    const ctx = { width: 1920, theme: THEMES[0], pillars: [], entities: {} }
    const s = unlockLayout(newSlide('text', { title: 'Hi', text: 'Body' }), ctx)
    expect(s.layout).toBe('blank')
    expect(s.objects?.map((o) => o.text)).toEqual(['Hi', 'Body'])
    expect(s.objects?.every((o) => !o.fromLayout && !o.id.includes(':'))).toBe(true)
  })
})

// Writes sample files for a manual check in an office app: PITCH_OUT=/some/dir npx vitest run export.test
if (typeof process !== 'undefined' && process.env.PITCH_OUT) {
  const fs = await import('node:fs')
  fs.writeFileSync(`${process.env.PITCH_OUT}/sample.pptx`, deckToPptx(sampleDeck()))
  fs.writeFileSync(`${process.env.PITCH_OUT}/sample.odp`, deckToOdp(sampleDeck()))
}
