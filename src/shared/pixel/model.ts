import { newId, type Id } from '@/core/model'

/**
 * Pixel Art (v0.16): sprites, tilesets and tilemaps on exact whole pixels.
 * A document is layers × frames; each cel is a small PNG kept inline as a data URL, so undo,
 * sync and backups work like any other document.
 * ponytail: inline PNGs keep big canvases (1024² and up, many frames) heavy in the JSON; move cels
 * into project assets like Draw does if that ever shows up.
 */

export interface PixelLayer {
  id: Id
  name: string
  visible: boolean
  /** 0..1 */
  opacity: number
  locked?: boolean
  /** v0.16: how the layer mixes with the ones below. */
  blend?: 'multiply' | 'screen' | 'add'
  /** v0.16: a tracing layer: shown faintly while drawing, left out of every export. */
  reference?: boolean
}

export interface PixelFrame {
  id: Id
  /** How long the frame shows, in ms. */
  duration: number
}

export type LoopMode = 'forward' | 'reverse' | 'pingpong'

/** A named run of frames (idle, walk, attack), frames `from`..`to` inclusive (0-based). */
export interface PixelTag {
  id: Id
  name: string
  from: number
  to: number
  color: string
  loop: LoopMode
}

/** A layer of tiles from this file's tileset; "x,y" → tile number (left to right, top to bottom). */
export interface TileMapLayer {
  id: Id
  name: string
  visible: boolean
  cells: Record<string, number>
}

export interface PixelDoc {
  /** False until a size is picked on the start screen. */
  started: boolean
  kind: 'sprite' | 'tileset'
  width: number
  height: number
  /** Bottom first. */
  layers: PixelLayer[]
  frames: PixelFrame[]
  /** "layerId:frameId" → PNG data URL; missing = empty. "@frameId" = linked: the same pixels as that frame (v0.16). */
  cels: Record<string, string>
  tags: PixelTag[]
  /** '#rrggbb' */
  palette: string[]
  /** Tileset files: tile size and the map painted with the tiles. */
  tileSize?: number
  map?: { width: number; height: number; layers: TileMapLayer[] }
  /** The tileset in the project's tile library (shared with Level Layout) this file keeps up to date. */
  libraryId?: Id
  /** v0.16: wide (2) or tall (0.5) pixels, for retro systems; shown that way, missing = square. */
  pixelAspect?: number
  /** v0.16: 'indexed' paints only palette colours, 'gray' only grays; missing = any colour. */
  colorMode?: 'indexed' | 'gray'
  /** v0.16: palette variants (enemy colours, team colours): colour i of the palette shown as colour i of the variant. */
  variants?: { id: Id; name: string; colors: string[] }[]
}

/** The starter palette: 16 colours picked for this app (black, white, three ramps and a few accents). */
export const STARTER_PALETTE = ['#000000', '#ffffff', '#3a2f45', '#6b5a7a', '#a89fb5', '#7a3b2e', '#c2643c', '#f0a35e', '#f7e08b', '#2e5c3a', '#4f9a4a', '#9cd36a', '#1f3b6e', '#3f78c4', '#86c5f0', '#b8384a']

export const newPixelLayer = (name: string): PixelLayer => ({ id: newId(), name, visible: true, opacity: 1 })
export const newFrame = (duration = 100): PixelFrame => ({ id: newId(), duration })

export const createPixelDoc = (): PixelDoc => ({ started: false, kind: 'sprite', width: 32, height: 32, layers: [newPixelLayer('Layer 1')], frames: [newFrame()], cels: {}, tags: [], palette: [...STARTER_PALETTE] })

export function startDoc(kind: PixelDoc['kind'], width: number, height: number, tileSize = 16): Partial<PixelDoc> {
  return kind === 'tileset'
    ? { started: true, kind, width, height, tileSize, map: { width: 20, height: 15, layers: [{ id: newId(), name: 'Ground', visible: true, cells: {} }] } }
    : { started: true, kind, width, height }
}

export const celKey = (layer: Id, frame: Id) => `${layer}:${frame}`

/** The cel that really holds the pixels: a linked cel ("@frameId") points at the same layer in another frame. */
export function resolveKey(cels: Record<string, string>, key: string): string {
  for (let i = 0; i < 8; i++) {
    const v = cels[key]
    if (!v?.startsWith('@')) return key
    key = `${key.slice(0, key.indexOf(':'))}:${v.slice(1)}`
  }
  return key
}
export const isLink = (v: string | undefined) => !!v?.startsWith('@')

// ---- Pixels ----------------------------------------------------------------

export interface Img {
  width: number
  height: number
  data: Uint8ClampedArray
}
export type RGBA = [number, number, number, number]

export const blank = (width: number, height: number): Img => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
export const cloneImg = (i: Img): Img => ({ width: i.width, height: i.height, data: new Uint8ClampedArray(i.data) })

export function hexToRgba(hex: string): RGBA {
  const n = parseInt(hex.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]
}
export const rgbaToHex = (r: number, g: number, b: number) => `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`

export function getPx(img: Img, x: number, y: number): RGBA {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}
export function setPx(img: Img, x: number, y: number, c: RGBA) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return
  img.data.set(c, (y * img.width + x) * 4)
}

/** Every pixel on the straight line from a to b (Bresenham). */
export function line(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = []
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    out.push([x0, y0])
    if (x0 === x1 && y0 === y1) return out
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
}

/**
 * Clean lines: drop the pixel in an L-shaped corner, so 1px freehand lines look hand-placed
 * (a pixel whose neighbours before and after touch each other diagonally).
 */
export function cleanPath(points: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const p of points) {
    if (out.length && out[out.length - 1][0] === p[0] && out[out.length - 1][1] === p[1]) continue
    out.push(p)
    if (out.length >= 3) {
      const [a, b, c] = out.slice(-3)
      if (Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1 && (b[0] === a[0] || b[1] === a[1])) out.splice(out.length - 2, 1)
    }
  }
  return out
}

/** Offsets covered by a brush of `size` pixels, square or round. */
export function brushOffsets(size: number, round: boolean): [number, number][] {
  const out: [number, number][] = []
  const lo = 0 - Math.floor((size - 1) / 2)
  const c = (size - 1) / 2 + lo
  for (let y = lo; y < lo + size; y++) for (let x = lo; x < lo + size; x++) if (!round || size < 3 || (x - c) ** 2 + (y - c) ** 2 <= (size / 2) ** 2 + 0.25) out.push([x, y])
  return out
}

export function rectPoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const [ax, bx, ay, by] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)]
  const out: [number, number][] = []
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) if (filled || x === ax || x === bx || y === ay || y === by) out.push([x, y])
  return out
}

/** The ellipse inside the box; the outline is the filled shape's edge pixels (4-connected). */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const [ax, bx, ay, by] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)]
  const cx = (ax + bx) / 2
  const cy = (ay + by) / 2
  const rx = (bx - ax) / 2 + 0.5
  const ry = (by - ay) / 2 + 0.5
  const inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
  const out: [number, number][] = []
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++) {
      if (!inside(x, y)) continue
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) out.push([x, y])
    }
  return out
}

/** Pixels of exactly the colour at x,y: the connected area (4-way), or every match on the image. */
export function floodPoints(img: Img, x: number, y: number, contiguous: boolean): [number, number][] {
  const w = img.width
  const at = (i: number) => (img.data[i * 4] << 24) | (img.data[i * 4 + 1] << 16) | (img.data[i * 4 + 2] << 8) | img.data[i * 4 + 3]
  // Fully transparent pixels count as one colour whatever their RGB.
  const key = (i: number) => (img.data[i * 4 + 3] === 0 ? 0 : at(i))
  const target = key(y * w + x)
  const out: [number, number][] = []
  if (!contiguous) {
    for (let i = 0; i < w * img.height; i++) if (key(i) === target) out.push([i % w, Math.floor(i / w)])
    return out
  }
  const seen = new Uint8Array(w * img.height)
  const stack = [y * w + x]
  while (stack.length) {
    const i = stack.pop()!
    if (seen[i] || key(i) !== target) continue
    seen[i] = 1
    const px = i % w
    const py = (i - px) / w
    out.push([px, py])
    if (px > 0) stack.push(i - 1)
    if (px < w - 1) stack.push(i + 1)
    if (py > 0) stack.push(i - w)
    if (py < img.height - 1) stack.push(i + w)
  }
  return out
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
/** Ordered dithering: paint this pixel at `level` (0 = none, 16 = all)? */
export const ditherOn = (x: number, y: number, level: number) => BAYER[(y & 3) * 4 + (x & 3)] < level

/** Shade brush: the colour one step lighter (+1) or darker (-1) along the palette, or null when not in it. */
export function shadeStep(palette: string[], hex: string, dir: 1 | -1): string | null {
  const i = palette.indexOf(hex)
  if (i < 0) return null
  return palette[Math.max(0, Math.min(palette.length - 1, i + dir))]
}

/** Points mirrored across the canvas middle (horizontal, vertical or both). */
export function mirror(points: [number, number][], w: number, h: number, sym: { x: boolean; y: boolean }): [number, number][] {
  const out = [...points]
  for (const [x, y] of points) {
    if (sym.x) out.push([w - 1 - x, y])
    if (sym.y) out.push([x, h - 1 - y])
    if (sym.x && sym.y) out.push([w - 1 - x, h - 1 - y])
  }
  return out
}

const BLENDS = {
  multiply: (s: number, d: number) => (s * d) / 255,
  screen: (s: number, d: number) => 255 - ((255 - s) * (255 - d)) / 255,
  add: (s: number, d: number) => Math.min(255, s + d),
}

/** Flatten visible layers of one frame (layer opacity, and multiply/screen/add where a layer asks for it). */
export function composite(layers: { visible: boolean; opacity: number; img: Img | undefined; blend?: PixelLayer['blend'] }[], width: number, height: number): Img {
  const out = blank(width, height)
  const d = out.data
  for (const l of layers) {
    if (!l.visible || !l.img) continue
    const s = l.img.data
    const mix = l.blend ? BLENDS[l.blend] : null
    for (let i = 0; i < d.length; i += 4) {
      const a = (s[i + 3] / 255) * l.opacity
      if (!a) continue
      const da = d[i + 3] / 255
      const oa = a + da * (1 - a)
      for (let c = 0; c < 3; c++) {
        // Blending only changes the colour where there is something below.
        const src = mix && da ? mix(s[i + c], d[i + c]) * da + s[i + c] * (1 - da) : s[i + c]
        d[i + c] = (src * a + d[i + c] * da * (1 - a)) / oa
      }
      d[i + 3] = oa * 255
    }
  }
  return out
}

/** Swap every pixel of one colour for another in the image; returns true when something changed. */
export function replaceColor(img: Img, from: string, to: string): boolean {
  const [r, g, b] = hexToRgba(from)
  const [nr, ng, nb] = hexToRgba(to)
  let changed = false
  const d = img.data
  for (let i = 0; i < d.length; i += 4)
    if (d[i + 3] && d[i] === r && d[i + 1] === g && d[i + 2] === b) {
      d[i] = nr
      d[i + 1] = ng
      d[i + 2] = nb
      changed = true
    }
  return changed
}

// ---- Palette ---------------------------------------------------------------

function hsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgba(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255)
  return rgbaToHex(f(0), f(8), f(4))
}

/**
 * Ramp maker: `steps` colours from dark to light, with hue shifting
 * (shadows lean cool towards blue, lights warm towards yellow), around a middle colour.
 */
export function ramp(hex: string, steps: number, shift = 20): string[] {
  const [h, s, l] = hsl(hex)
  const out: string[] = []
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : (i / (steps - 1)) * 2 - 1 // -1 dark … 1 light
    // Towards 240° (blue) in shadows, towards 60° (yellow) in lights, taking the short way round.
    const goal = t < 0 ? 240 : 60
    const diff = ((goal - h + 540) % 360) - 180
    const nh = (h + Math.sign(diff) * Math.min(Math.abs(diff), shift * Math.abs(t)) + 360) % 360
    out.push(fromHsl(nh, Math.min(1, s * (1 - 0.15 * Math.abs(t))), Math.max(0.04, Math.min(0.96, l + t * 0.35))))
  }
  return out
}

/** Palette files: GIMP .gpl, JASC .pal and .hex lists. */
export function parsePalette(text: string): string[] {
  const out: string[] = []
  const lines = text.split(/\r?\n/)
  if (lines[0]?.startsWith('JASC-PAL')) {
    for (const l of lines.slice(3)) {
      const n = l.trim().split(/\s+/).map(Number)
      if (n.length >= 3 && n.every((v) => Number.isFinite(v))) out.push(rgbaToHex(n[0], n[1], n[2]))
    }
    return out
  }
  for (const l of lines) {
    const t = l.trim()
    const hex = /^#?([0-9a-f]{6})$/i.exec(t)
    if (hex) {
      out.push(`#${hex[1].toLowerCase()}`)
      continue
    }
    const n = /^(\d+)\s+(\d+)\s+(\d+)/.exec(t)
    if (n) out.push(rgbaToHex(+n[1], +n[2], +n[3]))
  }
  return out
}

export const paletteToGpl = (name: string, colors: string[]) =>
  ['GIMP Palette', `Name: ${name}`, '#', ...colors.map((c) => hexToRgba(c).slice(0, 3).map((v) => String(v).padStart(3)).join(' ') + `\t${c}`)].join('\n') + '\n'

// ---- Tiles -----------------------------------------------------------------

export const tileColumns = (d: Pick<PixelDoc, 'width' | 'tileSize'>) => Math.max(1, Math.floor(d.width / (d.tileSize ?? 16)))
export const tileRows = (d: Pick<PixelDoc, 'height' | 'tileSize'>) => Math.max(1, Math.floor(d.height / (d.tileSize ?? 16)))

/** The frames a tag plays, in order (ping-pong goes there and back without repeating the ends). */
export function tagFrames(tag: Pick<PixelTag, 'from' | 'to' | 'loop'> | null, count: number): number[] {
  const from = tag ? Math.max(0, tag.from) : 0
  const to = tag ? Math.min(count - 1, tag.to) : count - 1
  const fwd = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)
  if (tag?.loop === 'reverse') return fwd.reverse()
  if (tag?.loop === 'pingpong') return [...fwd, ...fwd.slice(1, -1).reverse()]
  return fwd
}

/** A sprite sheet cut into frames of cw × ch, left to right and top to bottom; empty cells are skipped. */
export function sliceSheet(img: Img, cw: number, ch: number): Img[] {
  const out: Img[] = []
  for (let y0 = 0; y0 + ch <= img.height; y0 += ch)
    for (let x0 = 0; x0 + cw <= img.width; x0 += cw) {
      const f = blank(cw, ch)
      let any = false
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) {
          const c = getPx(img, x0 + x, y0 + y)
          if (c[3]) any = true
          setPx(f, x, y, c)
        }
      if (any) out.push(f)
    }
  return out
}
