import { zipSync } from 'fflate'
import { assetBlobUrl } from '@/core/assets'
import { canvasBytes, makePdf } from '@/shared/print'
import { H, fontStack, paragraphsOf, placeImage, type ExportDeck, type ExportSlide, type Obj, type Theme } from './model'

/** 0.35: draws slides on a canvas (PDF, slide pictures) and gathers pictures for the .pptx / .odp files. */

type Pic = HTMLImageElement | HTMLCanvasElement

async function loadImage(root: string, path: string): Promise<HTMLImageElement | null> {
  const url = await assetBlobUrl(root, path)
  if (!url) return null
  const img = new Image()
  img.src = url
  return img.decode().then(
    () => img,
    () => null,
  )
}

const MAX = 2400
async function toPng(src: Pic, sx: number, sy: number, sw: number, sh: number, w: number, h: number): Promise<Uint8Array> {
  const k = Math.min(1, MAX / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k))
  c.height = Math.max(1, Math.round(h * k))
  c.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height)
  return canvasBytes(c, 'image/png')
}

/**
 * Loads every picture the slides use. Cover pictures are cropped here into their own
 * entry (`path#cover:w:h`) so the file writers only ever place whole pictures.
 */
export async function resolveDeck(root: string, base: Omit<ExportDeck, 'images'>): Promise<ExportDeck> {
  const images: ExportDeck['images'] = new Map()
  const loaded = new Map<string, HTMLImageElement | null>()
  const slides: ExportSlide[] = []
  for (const s of base.slides) {
    const objs: Obj[] = []
    for (const o of s.objs) {
      if (o.kind !== 'image' || !o.image) {
        objs.push(o)
        continue
      }
      if (!loaded.has(o.image)) loaded.set(o.image, await loadImage(root, o.image))
      const img = loaded.get(o.image)
      if (!img) continue
      const iw = img.naturalWidth
      const ih = img.naturalHeight
      if (o.fit === 'cover') {
        const key = `${o.image}#cover:${Math.round(o.w)}:${Math.round(o.h)}`
        if (!images.has(key)) {
          const { crop } = placeImage(o, iw, ih)
          const sw = iw * (1 - crop.l - crop.r)
          const sh = ih * (1 - crop.t - crop.b)
          images.set(key, { png: await toPng(img, iw * crop.l, ih * crop.t, sw, sh, sw, sh), w: sw, h: sh })
        }
        objs.push({ ...o, image: key, fit: 'contain' })
      } else {
        if (!images.has(o.image)) images.set(o.image, { png: await toPng(img, 0, 0, iw, ih, iw, ih), w: iw, h: ih })
        objs.push(o)
      }
    }
    slides.push({ ...s, objs })
  }
  return { ...base, slides, images }
}

/** Wraps one paragraph to `width`; returns its lines. */
function wrapLine(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (g.measureText(next).width > width && line) {
      out.push(line)
      line = word
    } else line = next
  }
  out.push(line)
  return out
}

function drawText(g: CanvasRenderingContext2D, o: Obj, theme: Theme, middle: boolean) {
  const size = o.size ?? 40
  g.font = `${o.italic ? 'italic ' : ''}${o.bold ? '700' : '400'} ${size}px ${fontStack(o.font, theme)}`
  if ('fontVariantCaps' in g) g.fontVariantCaps = o.caps ? 'small-caps' : 'normal'
  g.fillStyle = o.color ?? theme.ink
  g.strokeStyle = g.fillStyle
  g.textBaseline = 'top'
  const lh = size * (o.lineHeight ?? 1.2)
  const indent = o.bullets ? size * 1.1 : 0
  const lines = paragraphsOf(o).flatMap((p) => wrapLine(g, p, o.w - indent).map((t, i) => ({ t, bullet: o.bullets && i === 0 })))
  let y = middle ? (o.h - lines.length * lh) / 2 : 0
  for (const { t, bullet } of lines) {
    if (y + lh > o.h + size) break
    const w = g.measureText(t).width
    const x = o.align === 'center' ? indent + (o.w - indent - w) / 2 : o.align === 'right' ? o.w - w : indent
    if (bullet) g.fillText('•', x - indent, y)
    g.fillText(t, x, y)
    if (o.underline) g.fillRect(x, y + size * 1.05, w, Math.max(1, size / 16))
    y += lh
  }
}

function drawShape(g: CanvasRenderingContext2D, o: Obj) {
  const kind = o.shape ?? 'rect'
  const sw = o.strokeW ?? 4
  g.beginPath()
  if (kind === 'line' || kind === 'arrow') {
    g.moveTo(0, 0)
    g.lineTo(o.w, o.h)
  } else if (kind === 'ellipse') g.ellipse(o.w / 2, o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2)
  else if (kind === 'triangle') {
    g.moveTo(o.w / 2, 0)
    g.lineTo(o.w, o.h)
    g.lineTo(0, o.h)
    g.closePath()
  } else if (kind === 'round') g.roundRect(0, 0, o.w, o.h, Math.min(o.w, o.h) * 0.16)
  else g.rect(0, 0, o.w, o.h)
  const line = kind === 'line' || kind === 'arrow'
  if (!line && o.fill !== 'none') {
    g.fillStyle = o.fill ?? '#cccccc'
    g.fill()
  }
  if (sw > 0 && (o.stroke || line)) {
    g.strokeStyle = o.stroke ?? '#000000'
    g.lineWidth = sw
    g.stroke()
    if (kind === 'arrow') {
      const a = Math.atan2(o.h, o.w)
      const len = sw * 5
      g.beginPath()
      g.moveTo(o.w, o.h)
      g.lineTo(o.w - len * Math.cos(a - 0.45), o.h - len * Math.sin(a - 0.45))
      g.lineTo(o.w - len * Math.cos(a + 0.45), o.h - len * Math.sin(a + 0.45))
      g.closePath()
      g.fillStyle = g.strokeStyle
      g.fill()
    }
  }
}

export function drawSlide(g: CanvasRenderingContext2D, s: ExportSlide, deck: ExportDeck, pics: Map<string, Pic>) {
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.fillStyle = s.bg
  g.fillRect(0, 0, deck.width, H)
  for (const o of s.objs) {
    g.save()
    g.translate(o.x + o.w / 2, o.y + o.h / 2)
    if (o.rot) g.rotate((o.rot * Math.PI) / 180)
    g.translate(-o.w / 2, -o.h / 2)
    if (o.kind === 'image') {
      const p = o.image ? pics.get(o.image) : undefined
      if (p) {
        const at = placeImage(o, p.width, p.height)
        g.drawImage(p, at.x - o.x, at.y - o.y, at.w, at.h)
      }
    } else {
      if (o.kind === 'shape') drawShape(g, o)
      else if (o.fill && o.fill !== 'none') {
        g.fillStyle = o.fill
        g.fillRect(0, 0, o.w, o.h)
      }
      if (o.text) drawText(g, o, deck.theme, o.kind === 'shape')
    }
    g.restore()
  }
}

async function picsOf(deck: ExportDeck): Promise<Map<string, Pic>> {
  const pics = new Map<string, Pic>()
  for (const [key, img] of deck.images) {
    const el = new Image()
    el.src = URL.createObjectURL(new Blob([img.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
    await el.decode().catch(() => undefined)
    URL.revokeObjectURL(el.src)
    // Draw at the picture's real size, not the (maybe smaller) stored one.
    const c = document.createElement('canvas')
    c.width = Math.round(img.w)
    c.height = Math.round(img.h)
    c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height)
    pics.set(key, c)
  }
  return pics
}

async function eachSlide(deck: ExportDeck, fn: (c: HTMLCanvasElement, i: number) => Promise<void>) {
  await document.fonts?.load(`48px ${fontStack(undefined, deck.theme)}`).catch(() => undefined)
  const pics = await picsOf(deck)
  const c = document.createElement('canvas')
  c.width = deck.width
  c.height = H
  const g = c.getContext('2d')!
  for (const [i, s] of deck.slides.entries()) {
    drawSlide(g, s, deck, pics)
    await fn(c, i)
  }
}

export async function deckToPdf(deck: ExportDeck): Promise<Uint8Array> {
  const pages: Parameters<typeof makePdf>[0] = []
  await eachSlide(deck, async (c) => {
    pages.push({ widthMm: 297, heightMm: (297 * H) / deck.width, image: await canvasBytes(c, 'image/jpeg'), pxWidth: deck.width, pxHeight: H })
  })
  return makePdf(pages)
}

export async function deckToPngZip(deck: ExportDeck): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  await eachSlide(deck, async (c, i) => {
    files[`slide-${String(i + 1).padStart(2, '0')}.png`] = await canvasBytes(c, 'image/png')
  })
  return zipSync(files, { level: 0 })
}
