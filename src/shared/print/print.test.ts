import { describe, expect, it } from 'vitest'
import { bleedMmToPx, bleedPxToMm, cardPixels, cropMarks, extendIntoBleed, mirroredSlots, mmToPx, PAGE_SIZES, sheetLayout } from './layout'
import { makePdf } from './pdf'

const A4 = PAGE_SIZES[0]
const LETTER = PAGE_SIZES.find((p) => p.id === 'letter')!

describe('sheet layout', () => {
  it('fits 9 poker cards with 3 mm bleed on A4', () => {
    const l = sheetLayout(A4, { w: 63, h: 88 }, 3)
    expect([l.cols, l.rows]).toEqual([3, 3])
    expect(l.page).toEqual({ w: 210, h: 297 })
    // Bleed boxes stay on the paper.
    for (const s of l.slots) {
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.x + l.cell.w).toBeLessThanOrEqual(210)
    }
  })

  it('keeps cut lines inside the printable margin', () => {
    const l = sheetLayout(LETTER, { w: 63, h: 88 }, 3, 5)
    const top = l.slots[0].y + 3
    const bottom = l.slots[l.slots.length - 1].y + l.cell.h - 3
    expect(top).toBeGreaterThanOrEqual(5)
    expect(bottom).toBeLessThanOrEqual(LETTER.h - 5)
  })

  it('turns the page when landscape fits more', () => {
    const l = sheetLayout(A4, { w: 130, h: 60 }, 0)
    expect(l.page.w).toBe(297)
    expect(l.slots).toHaveLength(6)
  })

  it('mirrors backs left to right', () => {
    const l = sheetLayout(A4, { w: 63, h: 88 }, 3)
    const m = mirroredSlots(l)
    expect(m[0].x).toBeCloseTo(l.slots[2].x)
    expect(m[0].y).toBe(l.slots[0].y)
  })

  it('puts crop marks outside the cards only', () => {
    const l = sheetLayout(A4, { w: 63, h: 88 }, 3)
    const marks = cropMarks(l, 3)
    // 6 cut lines across (both sides of 3 columns), each marked at the top and bottom; the same for the rows.
    expect(marks).toHaveLength(6 * 2 + 6 * 2)
    const left = l.slots[0].x + 3
    const right = left + 3 * l.cell.w - 6
    // Horizontal marks never reach into the cards.
    for (const [x1, , x2] of marks.filter((m) => m[1] === m[3])) expect(Math.max(x1, x2) < left || Math.min(x1, x2) > right).toBe(true)
  })

  it('converts mm to pixels', () => {
    expect(mmToPx(25.4, 300)).toBe(300)
    expect(mmToPx(210, 300)).toBe(2480)
  })
})

describe('pdf', () => {
  it('writes a valid xref for each page', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const bytes = makePdf([
      { widthMm: 210, heightMm: 297, jpeg, pxWidth: 1, pxHeight: 1 },
      { widthMm: 210, heightMm: 297, jpeg, pxWidth: 1, pxHeight: 1 },
    ])
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Count 2')
    expect(text).toContain('/MediaBox [0 0 595.276 841.890]')
    const start = Number(/startxref\n(\d+)/.exec(text)![1])
    expect(text.slice(start, start + 4)).toBe('xref')
    // Every xref offset points at its object.
    const offs = [...text.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]))
    expect(offs).toHaveLength(8)
    offs.forEach((o, i) => expect(text.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true))
  })
})

describe('bleed', () => {
  it('adds the bleed to every side of the exported card, typed in mm', () => {
    const none = cardPixels({ w: 63, h: 88 }, 0, 300)
    const mm3 = cardPixels({ w: 63, h: 88 }, 3, 300)
    expect([none.width, none.height]).toEqual([744, 1039])
    expect(mm3.bleed).toBe(35)
    expect([mm3.width, mm3.height]).toEqual([744 + 70, 1039 + 70])
  })

  it('adds the bleed typed in pixels (300 DPI) exactly', () => {
    const mm = bleedPxToMm(36)
    expect(bleedMmToPx(mm)).toBe(36)
    const c = cardPixels({ w: 63, h: 88 }, mm, 300)
    expect([c.width, c.height]).toEqual([744 + 72, 1039 + 72])
    // At 600 DPI the same bleed is twice as many pixels.
    expect(cardPixels({ w: 63, h: 88 }, mm, 600).bleed).toBe(72)
  })

  it('stretches the card edge into an empty bleed and keeps art that reaches it', () => {
    const w = 10
    const h = 10
    const px = new Uint8ClampedArray(w * h * 4)
    const set = (x: number, y: number, r: number, a = 255) => px.set([r, 0, 0, a], (y * w + x) * 4)
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) set(x, y, 100 + x * 10 + y, x === 2 ? 128 : 255) // the card, 6x6, left column half covered
    set(0, 0, 7) // art already in the bleed
    extendIntoBleed(px, w, h, 2)
    const at = (x: number, y: number) => [px[(y * w + x) * 4], px[(y * w + x) * 4 + 3]]
    expect(at(0, 0)).toEqual([7, 255])
    expect(at(9, 9)).toEqual([100 + 50 + 5, 255]) // corner takes the card's inner corner pixel
    expect(at(0, 5)).toEqual([100 + 40 + 5, 255]) // left edge, from two pixels in
    expect(at(2, 5)[1]).toBe(255) // the half covered cut line pixel is filled too
    expect(at(5, 0)).toEqual([100 + 50 + 4, 255]) // top edge
    // Every pixel is filled now.
    for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(255)
  })

  it('stretches the card edge over art in the bleed when asked to', () => {
    const w = 10
    const h = 10
    const px = new Uint8ClampedArray(w * h * 4)
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) px.set([100 + x * 10 + y, 0, 0, 255], (y * w + x) * 4)
    px.set([7, 0, 0, 255], 0) // art in the bleed gets covered
    extendIntoBleed(px, w, h, 2, true)
    expect([px[0], px[3]]).toEqual([100 + 40 + 4, 255])
  })
})
