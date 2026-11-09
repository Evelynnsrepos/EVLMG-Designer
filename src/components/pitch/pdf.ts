import { assetBlobUrl } from '@/core/assets'
import type { Entity } from '@/core/model'
import { canvasBytes, makePdf } from '@/shared/print'

/** 0.28: the pitch deck as a PDF, one 16:9 page per slide, drawn on a canvas (no DOM capture library needed). */

interface PdfSlide {
  layout: 'title' | 'text' | 'image' | 'pillars' | 'entities'
  title: string
  text: string
  image: string | null
  entityIds: string[]
}
interface Pillar {
  title: string
  why: string
  color: string
}

const W = 1920
const H = 1080
const FONT = "'Lexend Deca', sans-serif"
const INK = '#1d1d22'
const SOFT = '#55555e'

async function loadImage(root: string, path: string | null | undefined): Promise<HTMLImageElement | null> {
  const url = await assetBlobUrl(root, path)
  if (!url) return null
  const img = new Image()
  img.src = url
  return img.decode().then(
    () => img,
    () => null,
  )
}

/** Draws `text` wrapped to `width`, keeps \n as new lines; returns the y below it. Stops at `maxY`. */
function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, size: number, maxY = H - 60): number {
  g.font = `${size}px ${FONT}`
  const lh = size * 1.35
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (g.measureText(next).width > width && line) {
        if (y + lh > maxY) return y
        g.fillText(line, x, y)
        y += lh
        line = word
      } else line = next
    }
    if (y + lh > maxY) return y
    g.fillText(line, x, y)
    y += lh
  }
  return y
}

/** Fit `img` inside the box, keeping its shape. */
function contain(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.naturalWidth, h / img.naturalHeight)
  const dw = img.naturalWidth * s
  const dh = img.naturalHeight * s
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

async function drawSlide(g: CanvasRenderingContext2D, root: string, s: PdfSlide, pillars: Pillar[], entities: Entity[]) {
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, W, H)
  g.textBaseline = 'top'
  g.fillStyle = INK
  const heading = (t: string) => {
    g.fillStyle = INK
    g.font = `600 72px ${FONT}`
    g.fillText(t, 120, 100, W - 240)
  }
  if (s.layout === 'title') {
    const img = await loadImage(root, s.image)
    if (img) contain(g, img, 0, 0, W, H * 0.55)
    g.textAlign = 'center'
    g.font = `600 110px ${FONT}`
    g.fillText(s.title, W / 2, img ? H * 0.6 : H * 0.38, W - 200)
    g.fillStyle = SOFT
    if (s.text) {
      // Centred wrap: measure each line ourselves.
      g.textAlign = 'center'
      wrap(g, s.text, W / 2, img ? H * 0.6 + 150 : H * 0.38 + 160, W - 400, 44)
    }
    g.textAlign = 'left'
  } else if (s.layout === 'text') {
    heading(s.title)
    g.fillStyle = SOFT
    wrap(g, s.text, 120, 230, W - 240, 46)
  } else if (s.layout === 'image') {
    const img = await loadImage(root, s.image)
    if (img) contain(g, img, 80, 80, W / 2 - 120, H - 160)
    g.fillStyle = INK
    g.font = `600 64px ${FONT}`
    const y = wrap(g, s.title, W / 2 + 40, 120, W / 2 - 160, 64)
    g.fillStyle = SOFT
    wrap(g, s.text, W / 2 + 40, y + 30, W / 2 - 160, 40)
  } else if (s.layout === 'pillars') {
    heading(s.title || 'Design pillars')
    const list = pillars.filter((p) => p.title)
    const cw = (W - 240 - (list.length - 1) * 40) / Math.max(1, list.length)
    list.forEach((p, i) => {
      const x = 120 + i * (cw + 40)
      g.fillStyle = p.color
      g.fillRect(x, 260, cw, 12)
      g.fillStyle = INK
      g.font = `600 48px ${FONT}`
      const y = wrap(g, p.title, x, 300, cw, 48)
      g.fillStyle = SOFT
      wrap(g, p.why, x, y + 20, cw, 34)
    })
  } else {
    heading(s.title)
    const list = s.entityIds.flatMap((id) => entities.filter((e) => e.id === id))
    const cols = Math.min(6, Math.max(1, list.length))
    const cw = (W - 240 - (cols - 1) * 40) / cols
    for (const [i, e] of list.slice(0, 6).entries()) {
      const x = 120 + i * (cw + 40)
      const img = await loadImage(root, e.image)
      if (img) contain(g, img, x, 240, cw, cw)
      else {
        g.fillStyle = '#ececf0'
        g.fillRect(x, 240, cw, cw)
      }
      g.fillStyle = INK
      g.font = `600 40px ${FONT}`
      g.fillText(e.name, x, 260 + cw, cw)
      g.fillStyle = SOFT
      wrap(g, e.description.slice(0, 90), x, 320 + cw, cw, 28)
    }
  }
}

export async function pitchPdf(root: string, slides: PdfSlide[], pillars: Pillar[], entitiesOf: (s: PdfSlide) => Entity[]): Promise<Uint8Array> {
  await document.fonts?.load(`48px ${FONT}`).catch(() => undefined)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const pages = []
  for (const s of slides) {
    await drawSlide(g, root, s, pillars, entitiesOf(s))
    pages.push({ widthMm: 297, heightMm: 167.0625, image: await canvasBytes(c, 'image/jpeg'), pxWidth: W, pxHeight: H })
  }
  return makePdf(pages)
}
