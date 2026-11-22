import type { AdjustValues } from './adjust/filters'
import type { Rect } from './tiles'

/**
 * ASCII art (0.35): a picture as a grid of characters. Shared by ASCII layers (paint with any brush, see letters),
 * the ASCII adjustment, ASCII adjustment layers and the text exports. No AI: each cell's brightness picks a character
 * from a light-to-dark ramp; optional edge lines, dithering and colour.
 *
 * Cells are `cell` px wide and twice as tall (a monospace character), lined up with the canvas corner.
 */

/** Built-in character ramps, light to dark. */
export const CHARSETS = [
  { name: 'Classic', chars: ' .:-=+*#%@' },
  {
    name: 'Fine',
    chars: ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  },
  { name: 'Blocks', chars: ' ░▒▓█' },
] as const
/** Braille: every pattern of the 8 dots except none, index = dots - 1 (no dots = an empty cell). */
const BRAILLE = Array.from({ length: 255 }, (_, i) => String.fromCharCode(0x2801 + i)).join('')
/** The empty Braille cell, used in the text instead of a space so the lines keep their width in any font. */
const BRAILLE_BLANK = '\u2800'
/** Letters (Settings › Letters) after the built-in ramps and "Your own". */
export const SET_BRAILLE = 4
export const SET_LINES = 5
export const SET_TEXT = 6
/** Edge lines, by direction: vertical, rising, flat, falling. */
const EDGES = '|/-\\'
/** A cell with nothing in it (no character, no background). */
const EMPTY = 255
/** The font the letters are drawn in; bundled (public/fonts, OFL) so they look the same everywhere. */
export const ASCII_FONT = 'JetBrains Mono'

/** Extra settings that are not numbers. */
export interface AsciiText {
  /** "Your own" characters, any order (they are sorted light to dark by their ink). */
  chars?: string
  /** "One colour": the colour of every letter. */
  ink?: string
  /** Background colour of every cell (when the Background switch is on). */
  paper?: string
  /** "Your text": written into the shape, letter after letter (like code filling a picture). */
  text?: string
  /** Sign brushes: cells painted by hand, by the pixel corner of the cell they were painted in ("x,y"). */
  marks?: Record<string, AsciiMark>
}

/** One hand-painted cell: a fixed sign, steps darker (+) or lighter (-), and the brush colour for unpainted cells. */
export interface AsciiMark {
  s?: string
  d?: number
  c?: string
}

/** The settings as the renderer reads them, from the adjustment's values. */
export interface AsciiSettings {
  chars: string
  /** Cell width in px (height is twice that). */
  cell: number
  /** 0 = letters on dark parts, 1 = on bright parts, 2 = on painted parts (coverage only). */
  look: number
  /** 0 = picture colours, 1 = one colour. */
  colour: number
  contrast: number
  /** 0..1, 0 = off. */
  edges: number
  /** 0 = off, 1 = pattern (ordered), 2 = spread (error diffusion). */
  dither: number
  ink: [number, number, number]
  paper: [number, number, number] | null
  /** 0 = a letter by brightness, 1 = Braille (8 dots per cell), 2 = "Your text" written into the shape. */
  mode: number
  /** "Your text", spaces squeezed. */
  text: string
  /** Letters on the other parts (dark ↔ bright, painted ↔ empty). */
  invert: boolean
  /** 0..1: share of cells that get a random letter (glitch). */
  scatter: number
  seed: number
}

export const asciiCell = (v: AdjustValues['v']) => Math.max(2, Math.round(v.cell ?? 8))

function hex(c: string | undefined, fallback: [number, number, number]): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? '')
  if (!m) return fallback
  const n = parseInt(m[1], 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}

export function asciiSettings(a: Pick<AdjustValues, 'v' | 'ascii'> & { seed?: number }): AsciiSettings {
  const v = a.v
  const set = Math.round(v.set ?? 0)
  const own = [...new Set([...(a.ascii?.chars ?? '')])].join('')
  const text = set === SET_TEXT ? (a.ascii?.text ?? '').replace(/\s+/g, ' ').trim() || 'ASCII' : ''
  // Your text: a space first (index 0 = nothing), then each letter once; capped so the edge lines still fit.
  const textChars = ' ' + [...new Set([...text])].filter((c) => c !== ' ').slice(0, 200).join('')
  const chars = set === 3 ? own || CHARSETS[0].chars : set === SET_BRAILLE ? BRAILLE : set === SET_LINES ? ' ' : set === SET_TEXT ? textChars : CHARSETS[Math.min(2, Math.max(0, set))].chars
  return {
    chars,
    // Braille splits a cell into 2×4 dots, so the cell must be even.
    cell: set === SET_BRAILLE ? Math.max(2, Math.round(asciiCell(v) / 2) * 2) : asciiCell(v),
    look: Math.round(v.look ?? 0),
    colour: Math.round(v.colour ?? 0),
    contrast: v.contrast ?? 0,
    edges: set === SET_BRAILLE ? 0 : set === SET_LINES ? Math.max(0.6, v.edges ?? 0) : (v.edges ?? 0),
    dither: Math.round(v.dither ?? 0),
    ink: hex(a.ascii?.ink, [0, 0, 0]),
    paper: v.paper ? hex(a.ascii?.paper, [255, 255, 255]) : null,
    mode: set === SET_BRAILLE ? 1 : set === SET_TEXT ? 2 : 0,
    text,
    invert: !!v.invert,
    scatter: v.scatter ?? 0,
    seed: a.seed ?? 1,
  }
}

// ---- Glyphs ------------------------------------------------------------------------

/** Each character's ink, `cw`×`ch` bytes per character (0..255), the ramp first and then the four edge lines. */
export interface Atlas {
  key: string
  /** The ramp, sorted light to dark, then EDGES. */
  chars: string
  /** Number of ramp characters (the rest are edge lines). */
  ramp: number
  cw: number
  ch: number
  ink: Uint8Array
}

const BLOCKS: Record<string, number> = {
  '█': 255,
  '▓': 191,
  '▒': 128,
  '░': 64,
}

let fontAsked = false
/** Ask for the bundled font, so the next atlas uses it. */
export function loadAsciiFont(): Promise<unknown> {
  fontAsked = true
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve()
  return document.fonts.load(`16px "${ASCII_FONT}"`).catch(() => undefined)
}
const fontReady = () => typeof document !== 'undefined' && !!document.fonts?.check(`16px "${ASCII_FONT}"`)

let atlasCache: Atlas | null = null
/** The glyphs of `chars` at this cell size, drawn once (Canvas 2D) and kept while nothing changes. */
export function glyphAtlas(chars: string, cw: number, own: boolean, extra = ''): Atlas {
  if (!fontAsked) void loadAsciiFont()
  const edges = chars.length > 250 ? '' : EDGES
  // Signs painted with the sign brushes, after the edge lines (none fit next to Braille's 255).
  const more = edges ? [...new Set([...extra])].filter((c) => !chars.includes(c) && !EDGES.includes(c)).slice(0, 250 - chars.length - edges.length).join('') : ''
  const key = `${chars}|${cw}|${fontReady()}|${own}|${more}`
  if (atlasCache?.key === key) return atlasCache
  const ch = cw * 2
  const all = [...chars, ...edges, ...more]
  const c = document.createElement('canvas')
  c.width = cw * all.length
  c.height = ch
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = '#000'
  g.font = `${(cw / 0.6).toFixed(2)}px "${ASCII_FONT}", ui-monospace, monospace`
  g.textBaseline = 'alphabetic'
  all.forEach((s, i) => {
    if (s in BLOCKS) {
      g.globalAlpha = BLOCKS[s] / 255
      g.fillRect(i * cw, 0, cw, ch)
      g.globalAlpha = 1
    } else if (s > BRAILLE_BLANK && s <= '\u28ff') {
      // Braille dots drawn by hand: the bundled font has none, and system fonts space them differently.
      const m = s.charCodeAt(0) - 0x2800
      const d = cw / 2
      for (let b = 0; b < 8; b++) {
        if (!(m & (1 << b))) continue
        const col = b < 3 || b === 6 ? 0 : 1
        const row = b < 6 ? b % 3 : 3
        if (d < 3) g.fillRect(i * cw + col * d, row * d, d, d)
        else {
          g.beginPath()
          g.arc(i * cw + (col + 0.5) * d, (row + 0.5) * d, d * 0.38, 0, Math.PI * 2)
          g.fill()
        }
      }
    } else if (s !== ' ') g.fillText(s, i * cw + (cw - g.measureText(s).width) / 2, ch * 0.74)
  })
  const px = g.getImageData(0, 0, c.width, ch).data
  let ink = new Uint8Array(all.length * cw * ch)
  for (let i = 0; i < all.length; i++) for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) ink[(i * ch + y) * cw + x] = px[(y * c.width + i * cw + x) * 4 + 3]
  let ramp = [...chars]
  if (own) {
    // "Your own" characters: sort them light to dark by how much ink they leave.
    const sum = ramp.map((_, i) => ink.subarray(i * cw * ch, (i + 1) * cw * ch).reduce((a, b) => a + b, 0))
    const order = ramp.map((_, i) => i).sort((a, b) => sum[a] - sum[b])
    const sorted = new Uint8Array(ink.length)
    order.forEach((from, to) => sorted.set(ink.subarray(from * cw * ch, (from + 1) * cw * ch), to * cw * ch))
    sorted.set(ink.subarray(ramp.length * cw * ch), ramp.length * cw * ch)
    ink = sorted
    ramp = order.map((i) => ramp[i])
  }
  return (atlasCache = {
    key,
    chars: ramp.join('') + edges + more,
    ramp: ramp.length,
    cw,
    ch,
    ink,
  })
}

// ---- The grid ------------------------------------------------------------------------

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/** A number 0..1 that stays the same for the same cell and seed. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * The characters of one picture: cell averages in, a character and a colour per cell out. Keeps its arrays, so a
 * stroke only reads its own cells again and only the cells whose character or colour changed are drawn again.
 */
export class AsciiGrid {
  w = 0
  h = 0
  cw = 0
  ch = 0
  cols = 0
  rows = 0
  /** Samples per cell across and down: 2×4 for Braille (one per dot), else 1×1. */
  sx = 1
  sy = 1
  /** Sample size in px and the sample grid. */
  dw = 0
  dh = 0
  dcols = 0
  drows = 0
  /** Per sample: straight r, g, b (0..255) and coverage (0..1). */
  cells = new Float32Array(0)
  /** Your text: the atlas index of each of its letters. */
  private order: number[] = []
  /** Sign brushes, per cell: fixed atlas index or -1, steps darker/lighter, brush colour (rgb) or -1. */
  private mSign = new Int16Array(0)
  private mShade = new Int8Array(0)
  private mColor = new Int32Array(0)
  private marks: AsciiText['marks'] = undefined
  /** The hand-painted cells changed since the last pickAll (the picture did not). */
  marksChanged = false
  /** Per cell: atlas index, or EMPTY. */
  idx = new Uint8Array(0)
  /** Per cell: r, g, b, atlas index (for the GPU's pick texture). */
  pick = new Uint8Array(0)
  s!: AsciiSettings
  atlas!: Atlas
  private sig = ''

  /** Set up for a w×h picture; true when everything has to be worked out again. */
  prepare(w: number, h: number, s: AsciiSettings, atlas: Atlas, marks?: AsciiText['marks']): boolean {
    const sig = `${w}x${h}|${JSON.stringify(s)}|${atlas.key}`
    if (sig === this.sig) {
      if (marks !== this.marks) this.setMarks(marks)
      return false
    }
    this.sig = sig
    this.s = s
    this.atlas = atlas
    this.w = w
    this.h = h
    this.cw = s.cell
    this.ch = s.cell * 2
    this.cols = Math.ceil(w / this.cw)
    this.rows = Math.ceil(h / this.ch)
    this.sx = s.mode === 1 ? 2 : 1
    this.sy = s.mode === 1 ? 4 : 1
    this.dw = this.cw / this.sx
    this.dh = this.ch / this.sy
    this.dcols = this.cols * this.sx
    this.drows = this.rows * this.sy
    const n = this.cols * this.rows
    this.order = [...s.text].map((c) => Math.max(0, atlas.chars.indexOf(c)))
    this.cells = new Float32Array(this.dcols * this.drows * 4)
    this.idx = new Uint8Array(n).fill(EMPTY)
    this.pick = new Uint8Array(n * 4)
    for (let i = 0; i < n; i++) this.pick[i * 4 + 3] = EMPTY
    this.mSign = new Int16Array(n)
    this.mShade = new Int8Array(n)
    this.mColor = new Int32Array(n)
    this.setMarks(marks)
    return true
  }

  /** The cell (in cells) a mark key points at, or -1 when it is outside. */
  cellOfKey(key: string): number {
    const [x, y] = key.split(',').map(Number)
    const cx = Math.floor(x / this.cw)
    const cy = Math.floor(y / this.ch)
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows ? cy * this.cols + cx : -1
  }

  private setMarks(marks: AsciiText['marks']) {
    this.marks = marks
    this.marksChanged = true
    this.mSign.fill(-1)
    this.mShade.fill(0)
    this.mColor.fill(-1)
    for (const key in marks ?? {}) {
      const i = this.cellOfKey(key)
      if (i < 0) continue
      const m = marks![key]
      const at = m.s ? this.atlas.chars.indexOf(m.s) : -1
      if (at >= 0) this.mSign[i] = at
      if (m.d) this.mShade[i] = Math.max(-127, Math.min(127, Math.round(m.d)))
      const c = /^#?([0-9a-f]{6})$/i.exec(m.c ?? '')
      if (c) this.mColor[i] = parseInt(c[1], 16)
    }
  }

  /** The pixel rectangle `r` grown to whole cells (in cells). */
  cellsOf(r: Rect): Rect {
    const x0 = Math.max(0, Math.floor(r.x / this.cw))
    const y0 = Math.max(0, Math.floor(r.y / this.ch))
    const x1 = Math.min(this.cols, Math.ceil((r.x + r.w) / this.cw))
    const y1 = Math.min(this.rows, Math.ceil((r.y + r.h) / this.ch))
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
  }

  /** Cells (in cells) → pixels, clipped to the picture. */
  pixelsOf(c: Rect): Rect {
    const x = c.x * this.cw
    const y = c.y * this.ch
    return {
      x,
      y,
      w: Math.min(this.w, (c.x + c.w) * this.cw) - x,
      h: Math.min(this.h, (c.y + c.h) * this.ch) - y,
    }
  }

  /** Cells (in cells) → samples (in samples). */
  dotsOf(c: Rect): Rect {
    return { x: c.x * this.sx, y: c.y * this.sy, w: c.w * this.sx, h: c.h * this.sy }
  }

  /** Average the cells `cells` (their samples) from straight RGBA pixels `px` that cover the pixel rectangle `at`. */
  readPixels(px: Uint8ClampedArray | Uint8Array, at: Rect, cellRect: Rect) {
    const { dw: cw, dh: ch, cells } = this
    const c = this.dotsOf(cellRect)
    for (let cy = c.y; cy < c.y + c.h; cy++)
      for (let cx = c.x; cx < c.x + c.w; cx++) {
        let r = 0
        let g = 0
        let b = 0
        let a = 0
        let n = 0
        const y1 = Math.min(this.h, (cy + 1) * ch)
        const x1 = Math.min(this.w, (cx + 1) * cw)
        for (let y = cy * ch; y < y1; y++) {
          let i = ((y - at.y) * at.w + (cx * cw - at.x)) * 4
          for (let x = cx * cw; x < x1; x++, i += 4) {
            const al = px[i + 3]
            r += px[i] * al
            g += px[i + 1] * al
            b += px[i + 2] * al
            a += al
            n++
          }
        }
        const k = (cy * this.dcols + cx) * 4
        cells[k] = a ? r / a : 0
        cells[k + 1] = a ? g / a : 0
        cells[k + 2] = a ? b / a : 0
        cells[k + 3] = n ? a / n / 255 : 0
      }
  }

  /** Sample averages from the GPU (straight RGBA bytes, one pixel per sample) for the cells `cellRect`. */
  readCells(px: Uint8ClampedArray | Uint8Array, cellRect: Rect) {
    const c = this.dotsOf(cellRect)
    for (let y = 0; y < c.h; y++)
      for (let x = 0; x < c.w; x++) {
        const i = (y * c.w + x) * 4
        const k = ((c.y + y) * this.dcols + c.x + x) * 4
        this.cells[k] = px[i]
        this.cells[k + 1] = px[i + 1]
        this.cells[k + 2] = px[i + 2]
        this.cells[k + 3] = px[i + 3] / 255
      }
  }

  /** How much ink each sample wants, 0..1. */
  private density(): Float32Array {
    const { cells, s } = this
    const n = this.dcols * this.drows
    const d = new Float32Array(n)
    const k = s.contrast >= 0 ? 1 / (1 - Math.min(0.95, s.contrast)) : 1 + s.contrast
    for (let i = 0; i < n; i++) {
      const a = cells[i * 4 + 3]
      const l = (cells[i * 4] * 0.299 + cells[i * 4 + 1] * 0.587 + cells[i * 4 + 2] * 0.114) / 255
      let v = s.look === 2 ? a : s.look === 1 ? a * l : a * (1 - l)
      if (s.invert) v = 1 - v
      d[i] = Math.min(1, Math.max(0, (v - 0.5) * k + 0.5))
      if (!a && !s.invert) d[i] = 0
    }
    return d
  }

  /** Pick every cell's character and colour. Returns the cells (in cells) that changed, or null. */
  pickAll(): Rect | null {
    const { cols, rows, s, atlas, dcols } = this
    // Braille dots and Your text are on or off; the ramps have a level per letter.
    const n = s.mode === 0 ? atlas.ramp : 2
    const d = this.density()
    // Shade and Subtract brushes: a step darker or lighter per pass (one letter, or about a third for on/off cells).
    const step = s.mode === 0 ? 1 / Math.max(1, n - 1) : 0.34
    for (let i = 0; i < cols * rows; i++) {
      const sh = this.mShade[i]
      if (!sh) continue
      const x = i % cols
      const y = (i - x) / cols
      for (let j = 0; j < this.sy; j++)
        for (let q = 0; q < this.sx; q++) {
          const k = (y * this.sy + j) * dcols + x * this.sx + q
          d[k] = Math.min(1, Math.max(0, d[k] + sh * step))
        }
    }
    this.marksChanged = false
    const level = this.levels(d, n)
    const edgeAt = s.edges > 0 && s.mode !== 1 ? 0.25 + (1 - s.edges) * 1.75 : Infinity
    let x0 = cols
    let y0 = rows
    let x1 = -1
    let y1 = -1
    const at = (x: number, y: number) => d[Math.min(rows - 1, Math.max(0, y)) * cols + Math.min(cols - 1, Math.max(0, x))]
    let gxs: Float32Array | null = null
    let gys: Float32Array | null = null
    let mag: Float32Array | null = null
    if (edgeAt < Infinity) {
      gxs = new Float32Array(cols * rows)
      gys = new Float32Array(cols * rows)
      mag = new Float32Array(cols * rows)
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x
          gxs[i] = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)
          // Cells are twice as tall as wide, so a step down counts half.
          gys[i] = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 2
          mag[i] = Math.hypot(gxs[i], gys[i])
        }
    }
    const magAt = (x: number, y: number) => (x < 0 || y < 0 || x >= cols || y >= rows ? 0 : mag![y * cols + x])
    const cell = [0, 0, 0, 0]
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        let g: number
        if (s.mode === 1) {
          // Braille: one bit per dot that is on; the colour is the dots' average.
          let m = 0
          let r = 0
          let gg = 0
          let b = 0
          let a = 0
          for (let b8 = 0; b8 < 8; b8++) {
            const dx = x * 2 + (b8 < 3 || b8 === 6 ? 0 : 1)
            const dy = y * 4 + (b8 < 6 ? b8 % 3 : 3)
            const j = dy * dcols + dx
            const al = this.cells[j * 4 + 3]
            r += this.cells[j * 4] * al
            gg += this.cells[j * 4 + 1] * al
            b += this.cells[j * 4 + 2] * al
            a += al
            if (level[j] > 0) m |= 1 << b8
          }
          cell[0] = a ? r / a : 0
          cell[1] = a ? gg / a : 0
          cell[2] = a ? b / a : 0
          g = m ? m - 1 : EMPTY
        } else {
          const k = i * 4
          cell[0] = this.cells[k]
          cell[1] = this.cells[k + 1]
          cell[2] = this.cells[k + 2]
          const a = this.cells[k + 3]
          g = !a && !s.paper && !s.invert && this.mShade[i] <= 0 ? EMPTY : s.mode === 2 ? (level[i] > 0 && this.order.length ? this.order[i % this.order.length] : 0) : level[i]
          // Edge lines on cells with ink; "Lines only" (one blank letter) has no ink, so every cell may get one.
          if (g !== EMPTY && (level[i] > 0 || atlas.ramp === 1) && this.mShade[i] >= 0 && mag && mag[i] > edgeAt) {
            const gx = gxs![i]
            const gy = gys![i]
            // Thin lines: only where the edge is strongest across it (compared with the two cells along the slope).
            const sx = Math.round(gx / mag[i])
            const sy = Math.round(gy / mag[i])
            if (mag[i] >= magAt(x + sx, y + sy) && mag[i] >= magAt(x - sx, y - sy)) {
              const t = ((Math.atan2(gy, gx) + Math.PI) % Math.PI) / Math.PI
              g = atlas.ramp + (Math.round(t * 4) % 4)
            }
          }
        }
        // Scatter: some letters swapped for random ones (the same cells every time, so painting doesn't flicker).
        if (s.scatter > 0 && s.mode !== 1 && g !== EMPTY && g > 0 && g < atlas.ramp && atlas.ramp > 2) {
          const h = hash(x, y, s.seed)
          if (h < s.scatter) g = 1 + Math.floor(hash(y, x, s.seed + 7) * (atlas.ramp - 1))
        }
        if (this.mSign[i] >= 0) g = this.mSign[i]
        const k = i * 4
        const mc = this.mColor[i]
        // Cells with nothing painted take the brush colour they were marked with.
        const own = mc >= 0 && (s.mode === 1 ? g !== EMPTY : !this.cells[k + 3]) ? [mc >> 16, (mc >> 8) & 255, mc & 255] : null
        const c = s.colour === 1 ? s.ink : own
        const r = c ? c[0] : Math.round(cell[0])
        const gg = c ? c[1] : Math.round(cell[1])
        const b = c ? c[2] : Math.round(cell[2])
        const p = this.pick
        if (p[k] !== r || p[k + 1] !== gg || p[k + 2] !== b || p[k + 3] !== g) {
          p[k] = r
          p[k + 1] = gg
          p[k + 2] = b
          p[k + 3] = g
          this.idx[i] = g
          if (x < x0) x0 = x
          if (y < y0) y0 = y
          if (x > x1) x1 = x
          if (y > y1) y1 = y
        }
      }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  }

  /** Each sample's level 0..n-1 (with the chosen dithering). */
  private levels(d: Float32Array, n: number): Int16Array {
    const { dcols: cols, drows: rows, s } = this
    const level = new Int16Array(cols * rows)
    if (n < 2) return level
    if (s.dither === 2) {
      const e = Float32Array.from(d)
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x
          const q = Math.min(n - 1, Math.max(0, Math.round(e[i] * (n - 1))))
          level[i] = q
          if (!this.cells[i * 4 + 3]) continue
          const err = e[i] - q / (n - 1)
          if (x + 1 < cols) e[i + 1] += (err * 7) / 16
          if (y + 1 < rows) {
            if (x > 0) e[i + cols - 1] += (err * 3) / 16
            e[i + cols] += (err * 5) / 16
            if (x + 1 < cols) e[i + cols + 1] += err / 16
          }
        }
    } else
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x
          const t = s.dither === 1 ? (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5 : 0
          level[i] = Math.min(n - 1, Math.max(0, Math.round(d[i] * (n - 1) + t)))
        }
    return level
  }

  /** Draw the pixel rectangle `r` (whole cells) into straight RGBA `out` (r.w × r.h). */
  paint(out: Uint8ClampedArray, r: Rect) {
    const { cw, ch, atlas, s } = this
    const paper = s.paper
    for (let y = r.y; y < r.y + r.h; y++) {
      const cy = Math.floor(y / ch)
      const gy = y - cy * ch
      let o = (y - r.y) * r.w * 4
      for (let x = r.x; x < r.x + r.w; x++, o += 4) {
        const cx = Math.floor(x / cw)
        const k = (cy * this.cols + cx) * 4
        const g = this.pick[k + 3]
        if (g === EMPTY) {
          // Only Braille leaves empty cells with the background on (cells with no dots).
          if (paper) {
            out[o] = paper[0]
            out[o + 1] = paper[1]
            out[o + 2] = paper[2]
            out[o + 3] = 255
          } else out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0
          continue
        }
        const cov = atlas.ink[(g * ch + gy) * cw + (x - cx * cw)]
        if (paper) {
          const t = cov / 255
          out[o] = this.pick[k] * t + paper[0] * (1 - t)
          out[o + 1] = this.pick[k + 1] * t + paper[1] * (1 - t)
          out[o + 2] = this.pick[k + 2] * t + paper[2] * (1 - t)
          out[o + 3] = 255
        } else {
          out[o] = this.pick[k]
          out[o + 1] = this.pick[k + 1]
          out[o + 2] = this.pick[k + 2]
          out[o + 3] = cov
        }
      }
    }
  }

  /** The characters as text lines (empty cells are spaces, trailing spaces dropped). */
  text(): string[] {
    const lines: string[] = []
    const chars = [...this.atlas.chars]
    const blank = this.s.mode === 1 ? BRAILLE_BLANK : ' '
    for (let y = 0; y < this.rows; y++) {
      let line = ''
      for (let x = 0; x < this.cols; x++) {
        const g = this.idx[y * this.cols + x]
        line += g === EMPTY ? blank : chars[g]
      }
      lines.push(line.replace(/\s+$/, ''))
    }
    return lines
  }

  /** Each line as runs of characters with the same colour. */
  runs(): { text: string; color: [number, number, number] | null }[][] {
    const chars = [...this.atlas.chars]
    const out: { text: string; color: [number, number, number] | null }[][] = []
    for (let y = 0; y < this.rows; y++) {
      const line: { text: string; color: [number, number, number] | null }[] = []
      for (let x = 0; x < this.cols; x++) {
        const k = (y * this.cols + x) * 4
        const g = this.pick[k + 3]
        const s = g === EMPTY ? (this.s.mode === 1 ? BRAILLE_BLANK : ' ') : chars[g]
        const color: [number, number, number] | null = g === EMPTY || s === ' ' ? null : [this.pick[k], this.pick[k + 1], this.pick[k + 2]]
        const last = line[line.length - 1]
        if (last && (color === null ? last.color === null : last.color && last.color.join() === color.join())) last.text += s
        else line.push({ text: s, color })
      }
      while (line.length && line[line.length - 1].color === null) {
        const t = line[line.length - 1].text.replace(/\s+$/, '')
        if (t) {
          line[line.length - 1].text = t
          break
        }
        line.pop()
      }
      out.push(line)
    }
    return out
  }
}

/** The whole CPU path: a picture's straight pixels → the ASCII picture (Adjustments, adjustment layers). */
export function renderAscii(img: ImageData, a: Pick<AdjustValues, 'v' | 'ascii' | 'seed'>, grid = new AsciiGrid()): ImageData {
  prepareGrid(grid, img.width, img.height, a)
  const all = { x: 0, y: 0, w: img.width, h: img.height }
  grid.readPixels(img.data, all, grid.cellsOf(all))
  grid.pickAll()
  const out = new ImageData(img.width, img.height)
  grid.paint(out.data, all)
  return out
}

// ---- Text exports -----------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const css = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** A web page with the characters in their colours. */
export function asciiHtml(grid: AsciiGrid, title: string): string {
  const bg = grid.s.paper ? css(grid.s.paper) : 'transparent'
  const body = grid
    .runs()
    .map((line) => line.map((r) => (r.color ? `<span style="color:${css(r.color)}">${esc(r.text)}</span>` : esc(r.text))).join(''))
    .join('\n')
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${esc(title)}</title></head>\n<body style="margin:0;background:${bg}">\n<pre style="font:${grid.cw / 0.6}px/${grid.ch}px '${ASCII_FONT}',ui-monospace,monospace;margin:0;padding:8px">${body}</pre>\n</body></html>\n`
}

/** Text for terminals, with 24-bit colour codes (ANSI). */
export function asciiAnsi(grid: AsciiGrid): string {
  const bg = grid.s.paper ? `\x1b[48;2;${grid.s.paper.join(';')}m` : ''
  return (
    grid
      .runs()
      .map((line) => bg + line.map((r) => (r.color ? `\x1b[38;2;${r.color.join(';')}m${r.text}` : r.text)).join('') + '\x1b[0m')
      .join('\n') + '\n'
  )
}

/** How far past a change the letters can change (neighbour cells: edges, pattern); Infinity with spread dithering. */
export function asciiReach(a: Pick<AdjustValues, 'v'>): number {
  return Math.round(a.v.dither ?? 0) === 2 ? Infinity : asciiCell(a.v) * 4
}

/** The grid for these settings, set up for a w×h picture; `fresh` = everything is worked out again. */
export function prepareGrid(grid: AsciiGrid, w: number, h: number, a: Pick<AdjustValues, 'v' | 'ascii'> & { seed?: number }): boolean {
  const s = asciiSettings(a)
  const marks = a.ascii?.marks
  const extra = marks ? Object.values(marks).map((m) => m.s ?? '').join('') : ''
  return grid.prepare(w, h, s, glyphAtlas(s.chars, s.cell, Math.round(a.v.set ?? 0) === 3, extra), marks)
}

/** Canvas 2D: read the cells under `r` from `src`, and draw the cells whose letter changed into `out`. */
export function asciiInto(grid: AsciiGrid, src: HTMLCanvasElement, out: CanvasRenderingContext2D, r: Rect, fresh: boolean) {
  if (fresh) out.clearRect(0, 0, out.canvas.width, out.canvas.height)
  const c = grid.cellsOf(r)
  const at = grid.pixelsOf(c)
  if (at.w > 0 && at.h > 0) grid.readPixels(src.getContext('2d')!.getImageData(at.x, at.y, at.w, at.h).data, at, c)
  const changed = grid.pickAll()
  if (!changed) return
  const p = grid.pixelsOf(changed)
  const img = out.createImageData(p.w, p.h)
  grid.paint(img.data, p)
  out.putImageData(img, p.x, p.y)
}

/**
 * Letter brush (0.35): `text` as a strip picture for a tiled ribbon brush, so the letters follow the line and turn
 * with it. Upside down on purpose: the ribbon puts the picture's top on the right of the stroke's direction.
 */
export function letterStrip(text: string): string {
  const t = (text.replace(/\s+/g, ' ').trim() || 'ASCII') + ' '
  const H = 64
  const size = 52
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  const font = `${size}px "${ASCII_FONT}", ui-monospace, monospace`
  g.font = font
  c.width = Math.max(8, Math.ceil(g.measureText(t).width))
  c.height = H
  g.font = font
  g.fillStyle = '#fff'
  g.textBaseline = 'middle'
  g.translate(0, H)
  g.scale(1, -1)
  g.fillText(t, 0, H / 2 + 2)
  return c.toDataURL('image/png')
}
