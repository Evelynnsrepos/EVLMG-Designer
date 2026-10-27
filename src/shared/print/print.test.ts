import { describe, expect, it } from 'vitest'
import { cropMarks, mirroredSlots, mmToPx, PAGE_SIZES, sheetLayout } from './layout'
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
