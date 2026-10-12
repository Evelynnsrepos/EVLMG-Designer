import { blank, hexToRgba, rgbaToHex, type Img } from './model'

/** Palettes made for this app (no outside palettes are bundled). */
export const BUILTIN_PALETTES: { name: string; colors: string[] }[] = [
  { name: '1-bit', colors: ['#000000', '#ffffff'] },
  { name: '4 greens (handheld style)', colors: ['#0f2a1d', '#3b6b3a', '#8bb35a', '#d9ec9a'] },
  { name: '8 grays', colors: ['#000000', '#242424', '#494949', '#6d6d6d', '#929292', '#b6b6b6', '#dbdbdb', '#ffffff'] },
  { name: '8 warm', colors: ['#1f0f0c', '#4d1f17', '#86321f', '#c1502c', '#e5803f', '#f2b45e', '#f8dc93', '#fff6d6'] },
  { name: '8 cool', colors: ['#0b0f1f', '#18254d', '#24407a', '#2f66a8', '#3f93c9', '#6cc0dd', '#a8e3ee', '#e8fbff'] },
]

const dist = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

/** The palette colour closest to this one (by RGB distance). */
export function nearest(palette: string[], hex: string): string {
  if (!palette.length) return hex
  const c = hexToRgba(hex)
  let best = palette[0]
  let bd = Infinity
  for (const p of palette) {
    const d = dist(hexToRgba(p), c)
    if (d < bd) {
      bd = d
      best = p
    }
  }
  return best
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/** Every opaque pixel moved to its closest palette colour; `dither` mixes neighbours in a fine pattern for smooth shades. */
export function reduce(img: Img, palette: string[], dither = false): Img {
  const pal = palette.map(hexToRgba)
  const out = blank(img.width, img.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue
    const p = i / 4
    const x = p % img.width
    const y = (p - x) / img.width
    const off = dither ? (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 48 : 0
    const c = [d[i] + off, d[i + 1] + off, d[i + 2] + off]
    let best = pal[0]
    let bd = Infinity
    for (const q of pal) {
      const e = dist(q, c)
      if (e < bd) {
        bd = e
        best = q
      }
    }
    out.data.set([best[0], best[1], best[2], 255], i)
  }
  return out
}

/** The colours of a picture, most used first, at most `max`. */
export function paletteOf(img: Img, max = 64): string[] {
  const count = new Map<string, number>()
  const d = img.data
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]) count.set(rgbaToHex(d[i], d[i + 1], d[i + 2]), (count.get(rgbaToHex(d[i], d[i + 1], d[i + 2])) ?? 0) + 1)
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, max).map(([c]) => c)
}

/** The same picture in grays (by how bright each colour looks). */
export function grayscale(img: Img): Img {
  const out = blank(img.width, img.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    out.data.set([v, v, v, d[i + 3]], i)
  }
  return out
}
export const grayHex = (hex: string) => {
  const [r, g, b] = hexToRgba(hex)
  const v = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  return rgbaToHex(v, v, v)
}

/** Palette swap: every pixel in palette[i] shown in variant[i] instead. */
export function swapColors(img: Img, palette: string[], variant: string[]): Img {
  const map = new Map(palette.map((c, i) => [c, hexToRgba(variant[i] ?? c)]))
  const out = blank(img.width, img.height)
  out.data.set(img.data)
  const d = out.data
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue
    const to = map.get(rgbaToHex(d[i], d[i + 1], d[i + 2]))
    if (to) d.set(to.slice(0, 3), i)
  }
  return out
}
