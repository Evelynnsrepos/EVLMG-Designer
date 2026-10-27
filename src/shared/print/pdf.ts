import { MM_PER_INCH } from './layout'

/** One PDF page showing one JPEG picture edge to edge. */
export interface PdfPage {
  widthMm: number
  heightMm: number
  /** JPEG file bytes. */
  jpeg: Uint8Array
  /** The JPEG's size in pixels. */
  pxWidth: number
  pxHeight: number
}

const pt = (mm: number) => ((mm / MM_PER_INCH) * 72).toFixed(3)

/**
 * A minimal PDF (0.22 print sheets): each page is exactly the given paper size with the picture filling it,
 * so printers don't scale anything when "actual size" is chosen. No dependency needed.
 */
export function makePdf(pages: PdfPage[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b
    parts.push(bytes)
    length += bytes.length
  }
  // Object numbers: 1 catalog, 2 page tree, then per page: page, content, image.
  const obj = (n: number, body: (string | Uint8Array)[]) => {
    offsets[n] = length
    push(`${n} 0 obj\n`)
    body.forEach(push)
    push('\nendobj\n')
  }
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>'])
  obj(2, [`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`])
  pages.forEach((p, i) => {
    const n = 3 + i * 3
    const w = pt(p.widthMm)
    const h = pt(p.heightMm)
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`
    obj(n, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`])
    obj(n + 1, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`])
    obj(n + 2, [
      `<< /Type /XObject /Subtype /Image /Width ${p.pxWidth} /Height ${p.pxHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream',
    ])
  })
  const count = 3 + pages.length * 3
  const xref = length
  push(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(length)
  let at = 0
  for (const b of parts) {
    out.set(b, at)
    at += b.length
  }
  return out
}
