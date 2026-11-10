import { celImg, encode } from '@/shared/pixel/codec'
import { blank, getPx, isLink, rgbaToHex, setPx, type Img, type PixelDoc } from '@/shared/pixel/model'
import type { VPoint } from '@/shared/pixel/shapes'

/**
 * Whole-sprite changes (v0.29): every layer and frame at once, live shapes included.
 * Each returns a new document, so one `update` = one undo step.
 */

/** Every cel through `img`, and every live shape point through `pt`, at the new size. */
function reshape(d: PixelDoc, width: number, height: number, img: (i: Img) => Img, pt: (p: VPoint) => VPoint): PixelDoc {
  const cels: Record<string, string> = {}
  for (const [k, url] of Object.entries(d.cels)) {
    if (isLink(url)) {
      cels[k] = url
      continue
    }
    const next = encode(img(celImg(url, d.width, d.height)))
    if (next) cels[k] = next
  }
  const shapes = d.shapes && Object.fromEntries(Object.entries(d.shapes).map(([k, c]) => [k, { ...c, list: c.list.map((s) => ({ ...s, points: s.points.map(pt) })) }]))
  return { ...d, width, height, cels, ...(shapes ? { shapes } : {}) }
}

/** New canvas size; `ax`/`ay` (0 left/top, 0.5 middle, 1 right/bottom) say where the old picture sits. */
export function resizeCanvas(d: PixelDoc, width: number, height: number, ax = 0.5, ay = 0.5): PixelDoc {
  const ox = Math.round((width - d.width) * ax)
  const oy = Math.round((height - d.height) * ay)
  return crop(d, -ox, -oy, width, height)
}

/** Keep the box x, y, w × h (parts outside the old canvas come out empty). */
export function crop(d: PixelDoc, x: number, y: number, w: number, h: number): PixelDoc {
  const move = (src: Img) => {
    const out = blank(w, h)
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (xx + x >= 0 && yy + y >= 0 && xx + x < src.width && yy + y < src.height) setPx(out, xx, yy, getPx(src, xx + x, yy + y))
    return out
  }
  return reshape(d, w, h, move, (p) => ({ x: p.x - x, y: p.y - y }))
}

/** The box around every visible pixel of every layer and frame, or null when the sprite is empty. */
export function contentBounds(d: PixelDoc): { x: number; y: number; w: number; h: number } | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1]
  for (const url of Object.values(d.cels)) {
    if (isLink(url)) continue
    const img = celImg(url, d.width, d.height)
    for (let y = 0; y < d.height; y++)
      for (let x = 0; x < d.width; x++)
        if (img.data[(y * d.width + x) * 4 + 3]) {
          if (x < x0) x0 = x
          if (y < y0) y0 = y
          if (x > x1) x1 = x
          if (y > y1) y1 = y
        }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** Flip the whole sprite left-right ('x') or upside down ('y'). */
export function flipSprite(d: PixelDoc, axis: 'x' | 'y'): PixelDoc {
  const [W, H] = [d.width, d.height]
  const img = (src: Img) => {
    const out = blank(W, H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) setPx(out, axis === 'x' ? W - 1 - x : x, axis === 'y' ? H - 1 - y : y, getPx(src, x, y))
    return out
  }
  return reshape(d, W, H, img, (p) => (axis === 'x' ? { x: W - 1 - p.x, y: p.y } : { x: p.x, y: H - 1 - p.y }))
}

/** Turn the whole sprite a quarter (width and height swap). */
export function turnSprite(d: PixelDoc, cw: boolean): PixelDoc {
  const [W, H] = [d.width, d.height]
  const to = (x: number, y: number) => (cw ? { x: H - 1 - y, y: x } : { x: y, y: W - 1 - x })
  const img = (src: Img) => {
    const out = blank(H, W)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const q = to(x, y)
        setPx(out, q.x, q.y, getPx(src, x, y))
      }
    return out
  }
  return reshape(d, H, W, img, (p) => to(p.x, p.y))
}

// ---- Palette ------------------------------------------------------------------------

function hueLight(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16)
  const [r, g, b] = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const c = max - min
  let h = 0
  if (c) h = max === r ? ((g - b) / c + 6) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4
  return [h * 60, c ? c / (1 - Math.abs(2 * l - 1)) : 0, l]
}

/** Palette sorted by hue (grays first, each hue dark to light) or by lightness. */
export function sortPalette(colors: string[], by: 'hue' | 'light'): string[] {
  const key = (c: string) => {
    const [h, s, l] = hueLight(c)
    return by === 'light' ? [l, h, 0] : [s < 0.08 ? -1 : Math.round(h / 15), l, 0]
  }
  return [...colors].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)]
    return ka[0] - kb[0] || ka[1] - kb[1]
  })
}

/** Palette colours no pixel of any layer or frame uses. */
export function unusedColors(d: PixelDoc): string[] {
  const used = new Set<string>()
  for (const url of Object.values(d.cels)) {
    if (isLink(url)) continue
    const img = celImg(url, d.width, d.height)
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3]) used.add(rgbaToHex(img.data[i], img.data[i + 1], img.data[i + 2]))
  }
  for (const c of Object.values(d.shapes ?? {})) for (const s of c.list) for (const col of [s.fillColor, s.strokeColor]) if (col) used.add(col.toLowerCase())
  return d.palette.filter((c) => !used.has(c.toLowerCase()))
}

// ---- Undo history ------------------------------------------------------------------

/** What changed between two saved states, in a few words. */
export function stepLabel(a: PixelDoc, b: PixelDoc): string {
  if (a.started !== b.started) return 'New sprite'
  if (a.width !== b.width || a.height !== b.height) return `Canvas size ${b.width}×${b.height}`
  const cels = Object.keys({ ...a.cels, ...b.cels }).filter((k) => a.cels[k] !== b.cels[k])
  const shapes = a.shapes !== b.shapes
  if (cels.length > 1 && !shapes) return cels.length === Object.keys(b.cels).length ? 'Whole sprite' : `Pixels in ${cels.length} places`
  if (shapes) return 'Shapes'
  if (cels.length === 1) {
    const [lid, fid] = cels[0].split(':')
    const layer = b.layers.find((l) => l.id === lid)?.name ?? 'a layer'
    const frame = b.frames.findIndex((f) => f.id === fid)
    return `Pixels on ${layer}${b.frames.length > 1 && frame >= 0 ? `, frame ${frame + 1}` : ''}`
  }
  if (a.palette !== b.palette) return 'Palette'
  if (a.layers !== b.layers) return 'Layers'
  if (a.frames !== b.frames) return 'Frames'
  if (a.tags !== b.tags) return 'Tags'
  if (a.selection !== b.selection) return b.selection ? 'Selection' : 'Deselect'
  return 'Settings'
}
