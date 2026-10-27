import { cropMarks, mirroredSlots, mmToPx, type SheetLayout } from './layout'
import { makePdf } from './pdf'

/**
 * Draw print pages: each card picture (already including its bleed) goes into a slot, crop marks on top.
 * `backs` (optional) fills a mirrored page after every fronts page, for duplex printing.
 */
export function drawSheets(layout: SheetLayout, fronts: HTMLCanvasElement[], dpi: number, bleed: number, backs?: HTMLCanvasElement[]): HTMLCanvasElement[] {
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
    if (backs) page(backs.slice(i, i + per), mirroredSlots(layout))
  }
  return pages
}

/** Canvas to file bytes (PNG or JPEG). */
export async function canvasBytes(c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg' = 'image/png'): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, type, 0.92))
  if (!blob) throw new Error('Could not draw the picture (it may be too big).')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Print pages as one PDF at the layout's paper size. */
export async function sheetsToPdf(layout: SheetLayout, pages: HTMLCanvasElement[]): Promise<Uint8Array> {
  const out = []
  for (const p of pages) out.push({ widthMm: layout.page.w, heightMm: layout.page.h, jpeg: await canvasBytes(p, 'image/jpeg'), pxWidth: p.width, pxHeight: p.height })
  return makePdf(out)
}
