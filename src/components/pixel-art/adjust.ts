import { blank, getPx, setPx, type Img, type RGBA } from '@/shared/pixel/model'
import type { Mask } from './selection'

/** Colour changes for a layer, a frame or a selection (v0.29). All return a new picture. */
export interface Adjust {
  /** -180..180 degrees */
  hue: number
  /** -100..100 */
  saturation: number
  /** -100..100 */
  lightness: number
  /** -100..100 */
  brightness: number
  /** -100..100 */
  contrast: number
  invert: boolean
}
export const NO_ADJUST: Adjust = { hue: 0, saturation: 0, lightness: 0, brightness: 0, contrast: 0, invert: false }

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  ;[r, g, b] = [r / 255, g / 255, b / 255]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const c = max - min
  if (!c) return [0, 0, l]
  const s = c / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / c + 6) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4
  return [h * 60, s, l]
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = l - c / 2
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
const clamp1 = (v: number) => Math.max(0, Math.min(1, v))

/** One colour through the adjustments. */
export function adjustColor([r, g, b, a]: RGBA, o: Adjust): RGBA {
  if (o.invert) [r, g, b] = [255 - r, 255 - g, 255 - b]
  if (o.hue || o.saturation || o.lightness) {
    const [h, s, l] = rgbToHsl(r, g, b)
    const sl = o.saturation / 100
    const ll = o.lightness / 100
    ;[r, g, b] = hslToRgb(h + o.hue, clamp1(sl < 0 ? s * (1 + sl) : s + (1 - s) * sl), clamp1(ll < 0 ? l * (1 + ll) : l + (1 - l) * ll))
  }
  const k = (259 * (o.contrast * 1.275 + 255)) / (255 * (259 - o.contrast * 1.275))
  const add = o.brightness * 1.275
  const f = (v: number) => clamp(k * (v + add - 128) + 128)
  return [f(r), f(g), f(b), a]
}

/** Every visible pixel (inside the mask, if any) through `adjustColor`. */
export function adjustImg(img: Img, o: Adjust, m?: Mask | null): Img {
  const out = blank(img.width, img.height)
  out.data.set(img.data)
  for (let i = 0, p = 0; i < img.data.length; i += 4, p++) {
    if (!img.data[i + 3] || (m && !m[p])) continue
    const c = adjustColor([img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]], o)
    out.data.set(c, i)
  }
  return out
}

/** A copy of the drawing in one colour, `dx`/`dy` pixels away, behind it (only on empty pixels). */
export function dropShadow(img: Img, dx: number, dy: number, color: RGBA, m?: Mask | null): Img {
  const out = blank(img.width, img.height)
  out.data.set(img.data)
  const w = img.width
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < w; x++) {
      const [sx, sy] = [x - dx, y - dy]
      if (sx < 0 || sy < 0 || sx >= w || sy >= img.height) continue
      if (m && !m[sy * w + sx]) continue
      if (img.data[(sy * w + sx) * 4 + 3] && !img.data[(y * w + x) * 4 + 3]) setPx(out, x, y, color)
    }
  return out
}

/** Clear lone pixels: ones with no visible neighbour (4-way), the stray dots left after cleanup. */
export function despeckle(img: Img, m?: Mask | null): Img {
  const out = blank(img.width, img.height)
  out.data.set(img.data)
  const w = img.width
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < img.height && getPx(img, x, y)[3] > 0
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < w; x++)
      if (on(x, y) && (!m || m[y * w + x]) && !on(x - 1, y) && !on(x + 1, y) && !on(x, y - 1) && !on(x, y + 1)) setPx(out, x, y, [0, 0, 0, 0])
  return out
}
