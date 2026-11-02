import { zlibSync } from 'fflate'
import { cropMarks, mirroredSlots, mmToPx, type SheetLayout } from './layout'
import { makePdf, type PdfPage } from './pdf'

/**
 * Draw print pages: each card picture (already including its bleed) goes into a slot, crop marks on top.
 * `backs` (optional) fills a mirrored page after every fronts page, for duplex printing; `backOffset` (mm) moves them.
 */
export function drawSheets(layout: SheetLayout, fronts: HTMLCanvasElement[], dpi: number, bleed: number, backs?: HTMLCanvasElement[], backOffset?: { x: number; y: number }): HTMLCanvasElement[] {
  const per = layout.slots.length
  if (!per) return []
  const pages: HTMLCanvasElement[] = []
  const page = (cards: HTMLCanvasElement[], slots: { x: number; y: number }[]) => {
    const c = document.createElement('canvas')
    c.width = mmToPx(layout.page.w, dpi)
    c.height = mmToPx(layout.page.h, dpi)
    const g = c.getContext('2d')!
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, c.width, c.height)
    cards.forEach((card, i) => g.drawImage(card, mmToPx(slots[i].x, dpi), mmToPx(slots[i].y, dpi), mmToPx(layout.cell.w, dpi), mmToPx(layout.cell.h, dpi)))
    g.strokeStyle = '#000000'
    g.lineWidth = Math.max(1, dpi / 300)
    for (const [x1, y1, x2, y2] of cropMarks(layout, bleed)) {
      g.beginPath()
      g.moveTo(mmToPx(x1, dpi), mmToPx(y1, dpi))
      g.lineTo(mmToPx(x2, dpi), mmToPx(y2, dpi))
      g.stroke()
    }
    pages.push(c)
  }
  for (let i = 0; i < fronts.length; i += per) {
    page(fronts.slice(i, i + per), layout.slots)
    if (backs) page(backs.slice(i, i + per), mirroredSlots(layout, backOffset))
  }
  return pages
}

/** Canvas to file bytes (PNG or JPEG). */
export async function canvasBytes(c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg' = 'image/png'): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, type, 0.92))
  if (!blob) throw new Error('Could not draw the picture (it may be too big).')
  return new Uint8Array(await blob.arrayBuffer())
}

/** A canvas as a PDF picture: JPEG, or lossless (sharper small text, bigger file). */
async function pdfImage(c: HTMLCanvasElement, lossless: boolean): Promise<Pick<PdfPage, 'image' | 'lossless' | 'pxWidth' | 'pxHeight'>> {
  if (!lossless) return { image: await canvasBytes(c, 'image/jpeg'), pxWidth: c.width, pxHeight: c.height }
  const rgba = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
  const rgb = new Uint8Array((rgba.length / 4) * 3)
  // Print pages have no see-through parts: drop alpha onto white.
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const a = rgba[i + 3] / 255
    for (let k = 0; k < 3; k++) rgb[j + k] = Math.round(rgba[i + k] * a + 255 * (1 - a))
  }
  return { image: zlibSync(rgb, { level: 6 }), lossless: true, pxWidth: c.width, pxHeight: c.height }
}

/** Print pages as one PDF at the layout's paper size. */
export async function sheetsToPdf(layout: SheetLayout, pages: HTMLCanvasElement[], lossless = false): Promise<Uint8Array> {
  const out = []
  for (const p of pages) out.push({ widthMm: layout.page.w, heightMm: layout.page.h, ...(await pdfImage(p, lossless)) })
  return makePdf(out)
}

/** One card per page: every page is the card plus its bleed (`trimMm` on each side), no crop marks (print shops cut at the trim box). */
export async function cardsToPdf(sides: HTMLCanvasElement[], widthMm: number, heightMm: number, trimMm = 0, lossless = false): Promise<Uint8Array> {
  const out = []
  for (const c of sides) out.push({ widthMm, heightMm, trimMm, ...(await pdfImage(c, lossless)) })
  return makePdf(out)
}
