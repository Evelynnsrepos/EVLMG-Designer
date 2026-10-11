import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

/**
 * Colour helpers for the colour panel (Sketch Pro): conversions, harmony schemes,
 * colour names, palettes from images, and palette files (.swatches, .ase, .aco). Pure.
 */

export type RGB = [number, number, number]
/** Hue 0..360, saturation and brightness 0..1. */
export type HSB = [number, number, number]

export interface Swatch {
  hex: string
  name?: string
}
export interface Palette {
  id: string
  name: string
  colors: Swatch[]
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '').trim()
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const rgbToHex = (rgb: RGB) => `#${rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`

/** A typed hex code (with or without #, 3 or 6 digits) as #rrggbb, or null. */
export function parseHexInput(s: string): string | null {
  const h = s.trim().replace(/^#/, '')
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) return null
  return rgbToHex(hexToRgb(h))
}

export function rgbToHsb([r, g, b]: RGB): HSB {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const d = max - Math.min(R, G, B)
  let h = 0
  if (d) {
    if (max === R) h = ((G - B) / d) % 6
    else if (max === G) h = (B - R) / d + 2
    else h = (R - G) / d + 4
  }
  return [(h * 60 + 360) % 360, max ? d / max : 0, max]
}

export function hsbToRgb([h, s, v]: HSB): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255
  }
  return [f(5), f(3), f(1)]
}

export const hexToHsb = (hex: string) => rgbToHsb(hexToRgb(hex))
export const hsbToHex = (hsb: HSB) => rgbToHex(hsbToRgb(hsb))

export type Harmony = 'complementary' | 'split' | 'analogous' | 'triadic' | 'tetradic'
export const HARMONIES: Harmony[] = ['complementary', 'split', 'analogous', 'triadic', 'tetradic']
const HARMONY_ANGLES: Record<Harmony, number[]> = {
  complementary: [180],
  split: [150, 210],
  analogous: [-30, 30],
  triadic: [120, 240],
  tetradic: [90, 180, 270],
}

/** The colour itself followed by its partners in a harmony scheme (same saturation and brightness). */
export function harmony(hex: string, scheme: Harmony): string[] {
  const [h, s, b] = hexToHsb(hex)
  return [hex, ...HARMONY_ANGLES[scheme].map((a) => hsbToHex([(h + a + 360) % 360, s, b]))]
}

/** Common colour names (CSS colours). */
const NAMES: [string, string][] = [
  ['Black', '000000'], ['Night', '0c090a'], ['Charcoal', '34282c'], ['Dim grey', '696969'], ['Grey', '808080'], ['Dark grey', 'a9a9a9'], ['Silver', 'c0c0c0'],
  ['Light grey', 'd3d3d3'], ['Gainsboro', 'dcdcdc'], ['White smoke', 'f5f5f5'], ['White', 'ffffff'], ['Snow', 'fffafa'], ['Ivory', 'fffff0'], ['Linen', 'faf0e6'],
  ['Beige', 'f5f5dc'], ['Cream', 'fffdd0'], ['Wheat', 'f5deb3'], ['Tan', 'd2b48c'], ['Khaki', 'f0e68c'], ['Dark khaki', 'bdb76b'], ['Sand', 'c2b280'],
  ['Burly wood', 'deb887'], ['Peru', 'cd853f'], ['Chocolate', 'd2691e'], ['Sienna', 'a0522d'], ['Saddle brown', '8b4513'], ['Brown', 'a52a2a'], ['Maroon', '800000'],
  ['Dark red', '8b0000'], ['Firebrick', 'b22222'], ['Crimson', 'dc143c'], ['Red', 'ff0000'], ['Indian red', 'cd5c5c'], ['Light coral', 'f08080'], ['Salmon', 'fa8072'],
  ['Dark salmon', 'e9967a'], ['Light salmon', 'ffa07a'], ['Coral', 'ff7f50'], ['Tomato', 'ff6347'], ['Orange red', 'ff4500'], ['Dark orange', 'ff8c00'], ['Orange', 'ffa500'],
  ['Amber', 'ffbf00'], ['Gold', 'ffd700'], ['Yellow', 'ffff00'], ['Light yellow', 'ffffe0'], ['Lemon chiffon', 'fffacd'], ['Pale goldenrod', 'eee8aa'], ['Goldenrod', 'daa520'],
  ['Dark goldenrod', 'b8860b'], ['Olive', '808000'], ['Olive drab', '6b8e23'], ['Dark olive green', '556b2f'], ['Yellow green', '9acd32'], ['Chartreuse', '7fff00'], ['Lawn green', '7cfc00'],
  ['Lime', '00ff00'], ['Lime green', '32cd32'], ['Pale green', '98fb98'], ['Light green', '90ee90'], ['Spring green', '00ff7f'], ['Medium sea green', '3cb371'], ['Sea green', '2e8b57'],
  ['Forest green', '228b22'], ['Green', '008000'], ['Dark green', '006400'], ['Mint', '98ff98'], ['Aquamarine', '7fffd4'], ['Medium aquamarine', '66cdaa'], ['Turquoise', '40e0d0'],
  ['Medium turquoise', '48d1cc'], ['Light sea green', '20b2aa'], ['Teal', '008080'], ['Dark cyan', '008b8b'], ['Cyan', '00ffff'], ['Light cyan', 'e0ffff'], ['Pale turquoise', 'afeeee'],
  ['Powder blue', 'b0e0e6'], ['Light blue', 'add8e6'], ['Sky blue', '87ceeb'], ['Light sky blue', '87cefa'], ['Deep sky blue', '00bfff'], ['Dodger blue', '1e90ff'], ['Cornflower blue', '6495ed'],
  ['Steel blue', '4682b4'], ['Cadet blue', '5f9ea0'], ['Slate grey', '708090'], ['Light slate grey', '778899'], ['Royal blue', '4169e1'], ['Blue', '0000ff'], ['Medium blue', '0000cd'],
  ['Dark blue', '00008b'], ['Navy', '000080'], ['Midnight blue', '191970'], ['Indigo', '4b0082'], ['Dark slate blue', '483d8b'], ['Slate blue', '6a5acd'], ['Medium slate blue', '7b68ee'],
  ['Medium purple', '9370db'], ['Blue violet', '8a2be2'], ['Dark violet', '9400d3'], ['Dark orchid', '9932cc'], ['Purple', '800080'], ['Dark magenta', '8b008b'], ['Medium orchid', 'ba55d3'],
  ['Orchid', 'da70d6'], ['Violet', 'ee82ee'], ['Plum', 'dda0dd'], ['Thistle', 'd8bfd8'], ['Lavender', 'e6e6fa'], ['Magenta', 'ff00ff'], ['Medium violet red', 'c71585'],
  ['Deep pink', 'ff1493'], ['Hot pink', 'ff69b4'], ['Pale violet red', 'db7093'], ['Pink', 'ffc0cb'], ['Light pink', 'ffb6c1'], ['Misty rose', 'ffe4e1'], ['Peach', 'ffe5b4'],
  ['Bisque', 'ffe4c4'], ['Moccasin', 'ffe4b5'], ['Navajo white', 'ffdead'], ['Rosy brown', 'bc8f8f'], ['Dark slate grey', '2f4f4f'], ['Gunmetal', '2a3439'], ['Rust', 'b7410e'],
  ['Brick', 'cb4154'], ['Burgundy', '800020'], ['Mustard', 'e1ad01'], ['Ochre', 'cc7722'], ['Terracotta', 'e2725b'], ['Sage', 'bcb88a'], ['Moss', '8a9a5b'], ['Ice blue', 'c6e2ff'],
]

/** The nearest common name for a colour. */
export function colorName(hex: string): string {
  const [r, g, b] = hexToRgb(hex)
  let best = NAMES[0][0]
  let bestD = Infinity
  for (const [name, h] of NAMES) {
    const [r2, g2, b2] = hexToRgb(h)
    // "Redmean" distance: close to how different colours look.
    const rm = (r + r2) / 2
    const d = (2 + rm / 256) * (r - r2) ** 2 + 4 * (g - g2) ** 2 + (2 + (255 - rm) / 256) * (b - b2) ** 2
    if (d < bestD) {
      bestD = d
      best = name
    }
  }
  return best
}

/** Main colours of an image (RGBA bytes) by median cut; transparent pixels are skipped. */
export function extractPalette(rgba: Uint8ClampedArray, count = 10): string[] {
  const px: RGB[] = []
  const step = Math.max(1, Math.floor(rgba.length / 4 / 40000))
  for (let i = 0; i < rgba.length; i += 4 * step) if (rgba[i + 3] > 127) px.push([rgba[i], rgba[i + 1], rgba[i + 2]])
  if (!px.length) return []
  let boxes: RGB[][] = [px]
  while (boxes.length < count) {
    // Split the box with the widest colour range at its median.
    let bi = -1
    let bc = 0
    let br = 0
    boxes.forEach((box, i) => {
      if (box.length < 2) return
      for (let c = 0; c < 3; c++) {
        let lo = 255
        let hi = 0
        for (const p of box) {
          if (p[c] < lo) lo = p[c]
          if (p[c] > hi) hi = p[c]
        }
        if (hi - lo > br) [bi, bc, br] = [i, c, hi - lo]
      }
    })
    if (bi < 0 || br === 0) break
    const box = boxes[bi].sort((a, b) => a[bc] - b[bc])
    const mid = box.length >> 1
    boxes = [...boxes.slice(0, bi), box.slice(0, mid), box.slice(mid), ...boxes.slice(bi + 1)]
  }
  const avg = boxes.map((box) => box.reduce<RGB>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / box.length) as RGB)
  // Most used first, no duplicates.
  return [...new Set(avg.map((c, i) => [c, boxes[i].length] as const).sort((a, b) => b[1] - a[1]).map(([c]) => rgbToHex(c)))]
}

// ---- Palette files -----------------------------------------------------------

const cmykToRgb = (c: number, m: number, y: number, k: number): RGB => [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)]

function labToRgb(L: number, a: number, b: number): RGB {
  // CIE Lab (D65) to sRGB.
  let y = (L + 16) / 116
  let x = a / 500 + y
  let z = y - b / 200
  const f = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787)
  x = 0.95047 * f(x)
  y = f(y)
  z = 1.08883 * f(z)
  const lin = [x * 3.2406 + y * -1.5372 + z * -0.4986, x * -0.9689 + y * 1.8758 + z * 0.0415, x * 0.0557 + y * -0.204 + z * 1.057]
  return lin.map((v) => 255 * clamp(v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v, 0, 1)) as RGB
}

/** Adobe Swatch Exchange (.ase). Groups are flattened into one palette. */
export function parseAse(buf: ArrayBuffer, fallbackName: string): Palette {
  const v = new DataView(buf)
  if (v.getUint32(0) !== 0x41534546) throw new Error('Not an .ase file')
  const n = v.getUint32(8)
  let o = 12
  const colors: Swatch[] = []
  let name = fallbackName
  const str = (at: number) => {
    const len = v.getUint16(at)
    let s = ''
    for (let i = 0; i < len; i++) {
      const c = v.getUint16(at + 2 + i * 2)
      if (c) s += String.fromCharCode(c)
    }
    return { s, end: at + 2 + len * 2 }
  }
  for (let i = 0; i < n && o + 6 <= buf.byteLength; i++) {
    const type = v.getUint16(o)
    const len = v.getUint32(o + 2)
    const body = o + 6
    if (type === 0xc001 && len) name = colors.length ? name : str(body).s || name
    if (type === 0x0001) {
      const { s, end } = str(body)
      const model = String.fromCharCode(v.getUint8(end), v.getUint8(end + 1), v.getUint8(end + 2), v.getUint8(end + 3))
      const f = (k: number) => v.getFloat32(end + 4 + k * 4)
      let rgb: RGB | null = null
      if (model === 'RGB ') rgb = [f(0) * 255, f(1) * 255, f(2) * 255]
      else if (model === 'CMYK') rgb = cmykToRgb(f(0), f(1), f(2), f(3))
      else if (model === 'LAB ') rgb = labToRgb(f(0) * 100, f(1), f(2))
      else if (model === 'Gray') rgb = [f(0) * 255, f(0) * 255, f(0) * 255]
      if (rgb) colors.push({ hex: rgbToHex(rgb), ...(s ? { name: s } : {}) })
    }
    o = body + len
  }
  return { id: '', name, colors }
}

export function writeAse(p: Palette): Uint8Array {
  const blocks = p.colors.map((c) => {
    const name = c.name ?? ''
    const len = 2 + (name.length + 1) * 2 + 4 + 12 + 2
    const b = new DataView(new ArrayBuffer(6 + len))
    b.setUint16(0, 0x0001)
    b.setUint32(2, len)
    b.setUint16(6, name.length + 1)
    for (let i = 0; i < name.length; i++) b.setUint16(8 + i * 2, name.charCodeAt(i))
    let o = 8 + (name.length + 1) * 2
    for (const ch of 'RGB ') b.setUint8(o++, ch.charCodeAt(0))
    for (const v of hexToRgb(c.hex)) {
      b.setFloat32(o, v / 255)
      o += 4
    }
    b.setUint16(o, 2) // normal colour
    return new Uint8Array(b.buffer)
  })
  const head = new DataView(new ArrayBuffer(12))
  head.setUint32(0, 0x41534546)
  head.setUint16(4, 1)
  head.setUint16(6, 0)
  head.setUint32(8, blocks.length)
  return concat([new Uint8Array(head.buffer), ...blocks])
}

/** Photoshop colour swatches (.aco), version 2 names when present. */
export function parseAco(buf: ArrayBuffer, name: string): Palette {
  const v = new DataView(buf)
  const read = (at: number, named: boolean) => {
    const n = v.getUint16(at + 2)
    let o = at + 4
    const colors: Swatch[] = []
    for (let i = 0; i < n; i++) {
      const space = v.getUint16(o)
      const [w, x, y, z] = [v.getUint16(o + 2), v.getUint16(o + 4), v.getUint16(o + 6), v.getUint16(o + 8)]
      o += 10
      let label = ''
      if (named) {
        const len = v.getUint32(o)
        for (let k = 0; k < len; k++) {
          const c = v.getUint16(o + 4 + k * 2)
          if (c) label += String.fromCharCode(c)
        }
        o += 4 + len * 2
      }
      let rgb: RGB | null = null
      if (space === 0) rgb = [w / 257, x / 257, y / 257]
      else if (space === 1) rgb = hsbToRgb([(w / 65535) * 360, x / 65535, y / 65535])
      else if (space === 2) rgb = cmykToRgb(1 - w / 65535, 1 - x / 65535, 1 - y / 65535, 1 - z / 65535)
      else if (space === 7) rgb = labToRgb(w / 100, ((x << 16) >> 16) / 100, ((y << 16) >> 16) / 100)
      else if (space === 8) rgb = [255 - (w / 10000) * 255, 255 - (w / 10000) * 255, 255 - (w / 10000) * 255]
      if (rgb) colors.push({ hex: rgbToHex(rgb), ...(label ? { name: label } : {}) })
    }
    return { colors, end: o }
  }
  if (v.getUint16(0) !== 1 && v.getUint16(0) !== 2) throw new Error('Not an .aco file')
  if (v.getUint16(0) === 2) return { id: '', name, colors: read(0, true).colors }
  const v1 = read(0, false)
  // A version 2 block with names usually follows.
  if (v1.end + 4 <= buf.byteLength && v.getUint16(v1.end) === 2) return { id: '', name, colors: read(v1.end, true).colors }
  return { id: '', name, colors: v1.colors }
}

/** .swatches files from tablet drawing apps: a zip with Swatches.json (hue, saturation, brightness 0..1). */
export function parseSwatches(bytes: Uint8Array, fallbackName: string): Palette[] {
  const files = unzipSync(bytes)
  const key = Object.keys(files).find((k) => k.toLowerCase().endsWith('swatches.json'))
  if (!key) throw new Error('No Swatches.json inside')
  const data = JSON.parse(strFromU8(files[key]))
  const list = (Array.isArray(data) ? data : [data]) as { name?: string; swatches?: ({ hue: number; saturation: number; brightness: number } | null)[] }[]
  return list.map((p) => ({
    id: '',
    name: p.name || fallbackName,
    colors: (p.swatches ?? []).filter((s): s is NonNullable<typeof s> => !!s).map((s) => ({ hex: hsbToHex([s.hue * 360, s.saturation, s.brightness]) })),
  }))
}

export function writeSwatches(p: Palette): Uint8Array {
  const swatches = p.colors.slice(0, 30).map((c) => {
    const [h, s, b] = hexToHsb(c.hex)
    return { hue: h / 360, saturation: s, brightness: b, alpha: 1, colorSpace: 0 }
  })
  return zipSync({ 'Swatches.json': strToU8(JSON.stringify([{ name: p.name, swatches }])) })
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/**
 * The disc picker's inner circle (v0.13): saturation and brightness live on a square, the picker is round.
 * These map the square (-1..1 on both axes) onto the disc and back (elliptical grid mapping), so every spot
 * in the circle is a colour and every colour has a spot in the circle.
 */
export function squareToDisc(u: number, v: number): { x: number; y: number } {
  return { x: u * Math.sqrt(1 - (v * v) / 2), y: v * Math.sqrt(1 - (u * u) / 2) }
}

export function discToSquare(x: number, y: number): { u: number; v: number } {
  // Outside the circle counts as its edge, so dragging past it keeps working.
  const r = Math.hypot(x, y)
  if (r > 1) {
    x /= r
    y /= r
  }
  const s2 = 2 * Math.SQRT2
  const part = (a: number, b: number) => 0.5 * Math.sqrt(Math.max(0, 2 + a * a - b * b + s2 * a)) - 0.5 * Math.sqrt(Math.max(0, 2 + a * a - b * b - s2 * a))
  const clamp = (n: number) => Math.max(-1, Math.min(1, n))
  return { u: clamp(part(x, y)), v: clamp(part(y, x)) }
}
