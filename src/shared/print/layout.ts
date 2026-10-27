/**
 * Print sheets (0.22): sizes in millimetres, cards laid out on paper pages with bleed and crop marks.
 * Pure math here; `sheet.ts` draws and `pdf.ts` writes the file.
 */

export interface Size {
  /** Millimetres. */
  w: number
  h: number
}

export const PAGE_SIZES: { id: string; name: string; w: number; h: number }[] = [
  { id: 'a4', name: 'A4', w: 210, h: 297 },
  { id: 'a3', name: 'A3', w: 297, h: 420 },
  { id: 'a5', name: 'A5', w: 148, h: 210 },
  { id: 'letter', name: 'US Letter', w: 215.9, h: 279.4 },
  { id: 'legal', name: 'US Legal', w: 215.9, h: 355.6 },
]

export const MM_PER_INCH = 25.4

/** Pixels for a length in millimetres at a print resolution. */
export const mmToPx = (mm: number, dpi: number) => Math.round((mm / MM_PER_INCH) * dpi)

export interface SheetLayout {
  /** The page, turned to landscape when that fits more cards. */
  page: Size
  cols: number
  rows: number
  /** Top-left corner of each card's bleed box on the page, in mm, row by row. */
  slots: { x: number; y: number }[]
  /** Card size including bleed on all sides. */
  cell: Size
}

/**
 * As many cards as fit on one page. Bleed boxes touch (each card keeps its own bleed) and must stay on the
 * paper; the cut lines must stay inside the printable area `margin` from the edge. The grid is centred.
 */
export function sheetLayout(pageSize: Size, card: Size, bleed: number, margin = 4): SheetLayout {
  const cell = { w: card.w + 2 * bleed, h: card.h + 2 * bleed }
  const fit = (len: number, c: number) => {
    let n = 0
    while ((n + 1) * c <= len && (n + 1) * c - 2 * bleed <= len - 2 * margin) n++
    return n
  }
  const make = (page: Size): SheetLayout => {
    const cols = fit(page.w, cell.w)
    const rows = fit(page.h, cell.h)
    const x0 = (page.w - cols * cell.w) / 2
    const y0 = (page.h - rows * cell.h) / 2
    const slots = []
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) slots.push({ x: x0 + c * cell.w, y: y0 + r * cell.h })
    return { page, cols, rows, slots, cell }
  }
  const portrait = make({ w: Math.min(pageSize.w, pageSize.h), h: Math.max(pageSize.w, pageSize.h) })
  const landscape = make({ w: portrait.page.h, h: portrait.page.w })
  return landscape.slots.length > portrait.slots.length ? landscape : portrait
}

/**
 * Slots for the backs page: mirrored left to right, so after flipping the paper on its long edge
 * (duplex printing) every back sits behind its front.
 */
export function mirroredSlots(layout: SheetLayout): { x: number; y: number }[] {
  return layout.slots.map((s) => ({ x: layout.page.w - s.x - layout.cell.w, y: s.y }))
}

/**
 * Crop marks in mm, as line segments [x1, y1, x2, y2]: at every cut line, from the page edge to `gap`
 * before the outer cut, so they only print on paper that is cut away.
 */
export function cropMarks(layout: SheetLayout, bleed: number, gap = 1): number[][] {
  if (!layout.slots.length) return []
  const { page, cell, cols, rows } = layout
  const left = layout.slots[0].x + bleed
  const top = layout.slots[0].y + bleed
  const right = left + cols * cell.w - 2 * bleed
  const bottom = top + rows * cell.h - 2 * bleed
  const xs = new Set<number>()
  const ys = new Set<number>()
  for (let c = 0; c < cols; c++) xs.add(left + c * cell.w).add(left + c * cell.w + cell.w - 2 * bleed)
  for (let r = 0; r < rows; r++) ys.add(top + r * cell.h).add(top + r * cell.h + cell.h - 2 * bleed)
  const out: number[][] = []
  for (const x of xs) out.push([x, 0, x, top - gap], [x, bottom + gap, x, page.h])
  for (const y of ys) out.push([0, y, left - gap, y], [right + gap, y, page.w, y])
  return out.filter(([x1, y1, x2, y2]) => Math.hypot(x2 - x1, y2 - y1) > 0.5)
}
