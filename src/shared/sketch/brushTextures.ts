/**
 * Brush shapes and grains (Sketch Pro). Built-in ones are made in code
 * (noise, cells, lines), so the app ships no image files. Custom ones come
 * from images: white (or opaque) means paint, black (or transparent) none.
 * Everything is cached, so a stroke only builds each texture once.
 */

export const SHAPES = [
  { id: 'round', label: 'Round' },
  { id: 'square', label: 'Square' },
  { id: 'chalk', label: 'Chalk' },
  { id: 'splatter', label: 'Splatter' },
  { id: 'bristle', label: 'Bristle' },
  { id: 'pencil', label: 'Pencil' },
  { id: 'charcoal', label: 'Charcoal' },
  { id: 'oval', label: 'Oval' },
  { id: 'rake', label: 'Rake' },
  { id: 'dry', label: 'Dry brush' },
  { id: 'sponge', label: 'Sponge' },
  { id: 'watercolor', label: 'Watercolor blot' },
  { id: 'blob', label: 'Ink blot' },
  { id: 'speckle', label: 'Speckle' },
  { id: 'snow', label: 'Soft dots' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'leaf', label: 'Leaf' },
  { id: 'grass', label: 'Grass' },
  { id: 'fur', label: 'Fur' },
  { id: 'star', label: 'Star' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'ring', label: 'Ring' },
  { id: 'hatch', label: 'Hatching' },
  { id: 'heart', label: 'Heart' },
  { id: 'hair', label: 'Hair strands' },
  { id: 'hex', label: 'Hexagon' },
] as const
export type BrushShape = (typeof SHAPES)[number]['id']

export const GRAINS = [
  { id: 'none', label: 'None' },
  { id: 'paper', label: 'Paper' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'noise', label: 'Noise' },
  { id: 'rough', label: 'Rough paper' },
  { id: 'watercolor', label: 'Watercolor paper' },
  { id: 'charcoal', label: 'Charcoal paper' },
  { id: 'linen', label: 'Linen' },
  { id: 'concrete', label: 'Concrete' },
  { id: 'sponge', label: 'Sponge' },
  { id: 'sand', label: 'Sand' },
  { id: 'clouds', label: 'Clouds' },
  { id: 'wood', label: 'Wood' },
  { id: 'halftone', label: 'Halftone dots' },
  { id: 'lines', label: 'Screen lines' },
  { id: 'crosshatch', label: 'Crosshatch' },
  { id: 'flakes', label: 'Flakes' },
  { id: 'hexagons', label: 'Honeycomb' },
] as const
export type BrushGrain = (typeof GRAINS)[number]['id']

// ---- Noise (pure, tileable) ---------------------------------------------------

/** 0..1 from integer coordinates; the same input always gives the same value. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}

const wrap = (v: number, n: number) => ((v % n) + n) % n
const smooth = (t: number) => t * t * (3 - 2 * t)

/** Value noise on a grid of `px` × `py` cells that repeats over u, v in 0..1. */
function vnoise(u: number, v: number, px: number, py: number, seed: number) {
  const x = u * px
  const y = v * py
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = smooth(x - xi)
  const fy = smooth(y - yi)
  const a = hash2(wrap(xi, px), wrap(yi, py), seed)
  const b = hash2(wrap(xi + 1, px), wrap(yi, py), seed)
  const c = hash2(wrap(xi, px), wrap(yi + 1, py), seed)
  const d = hash2(wrap(xi + 1, px), wrap(yi + 1, py), seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** Layered noise (fractal), 0..1, tileable. */
function fbm(u: number, v: number, px: number, py: number, octaves: number, seed: number) {
  let sum = 0
  let amp = 0.5
  let total = 0
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(u, v, px, py, seed + o * 17) * amp
    total += amp
    amp *= 0.5
    px *= 2
    py *= 2
  }
  return sum / total
}

/** Distance to the nearest random point (cells), tileable, about 0..1. */
function cells(u: number, v: number, n: number, seed: number) {
  const x = u * n
  const y = v * n
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  let best = 9
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i
      const cy = yi + j
      const fx = cx + hash2(wrap(cx, n), wrap(cy, n), seed)
      const fy = cy + hash2(wrap(cx, n), wrap(cy, n), seed + 9)
      best = Math.min(best, Math.hypot(x - fx, y - fy))
    }
  return best
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const step = (a: number, b: number, x: number) => smooth(clamp01((x - a) / (b - a)))

/** A built-in grain as values 0..1 (1 = paint), `size` × `size`, seamless. */
export function grainValues(id: BrushGrain, size = 256): Float32Array {
  const out = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const r = hash2(x, y, 3)
      let g = 1
      switch (id) {
        case 'paper':
          g = 0.5 + 0.5 * (0.6 * fbm(u, v, 16, 16, 4, 1) + 0.4 * r)
          break
        case 'canvas':
          g = 0.55 + 0.45 * Math.abs(Math.sin(Math.PI * u * 28) * Math.sin(Math.PI * v * 28)) * (0.7 + r * 0.3)
          break
        case 'noise':
          g = r
          break
        case 'rough':
          g = clamp01((fbm(u, v, 8, 8, 5, 2) - 0.28) * 2.2)
          break
        case 'watercolor': {
          const blot = fbm(u, v, 6, 6, 4, 4)
          g = 0.45 + 0.4 * blot + 0.15 * step(0.1, 0.5, cells(u, v, 10, 5))
          break
        }
        case 'charcoal':
          g = clamp01((fbm(u, v, 64, 6, 3, 6) * 0.7 + r * 0.3 - 0.25) * 2)
          break
        case 'linen': {
          const h = fbm(u, v, 4, 64, 2, 7)
          const w = fbm(u, v, 64, 4, 2, 8)
          g = 0.4 + 0.6 * Math.max(h, w) * (0.8 + 0.2 * r)
          break
        }
        case 'concrete':
          g = 0.35 + 0.65 * fbm(u, v, 16, 16, 5, 9) - (r < 0.04 ? 0.5 : 0)
          break
        case 'sponge':
          g = step(0.25, 0.5, cells(u, v, 16, 10))
          break
        case 'sand':
          g = 0.3 + 0.7 * Math.sqrt(r) * (0.7 + 0.3 * fbm(u, v, 32, 32, 2, 11))
          break
        case 'clouds':
          g = fbm(u, v, 4, 4, 6, 12)
          break
        case 'wood':
          g = 0.5 + 0.5 * Math.sin(2 * Math.PI * (v * 8 + 1.2 * fbm(u, v, 2, 4, 3, 13)))
          break
        case 'halftone': {
          const d = Math.hypot((x % 8) - 3.5, (y % 8) - 3.5)
          g = 1 - step(2.2, 3.2, d)
          break
        }
        case 'lines':
          g = (x + y) % 8 < 3 ? 1 : 0
          break
        case 'crosshatch':
          g = (x + y) % 8 < 2 || (x - y + size) % 8 < 2 ? 1 : 0
          break
        case 'flakes': {
          // Scattered flakes of different sizes, like drifting snow.
          const d = cells(u, v, 14, 31)
          const size = 0.08 + 0.22 * hash2(Math.floor(u * 14), Math.floor(v * 14), 32)
          g = 1 - step(size * 0.6, size, d)
          break
        }
        case 'hexagons': {
          // A honeycomb: cells with soft walls.
          const q = (u * 16 * 2) / Math.sqrt(3)
          const rr = v * 16 - q / 2
          const cube = [q, rr, -q - rr]
          const rnd = cube.map(Math.round)
          const diff = cube.map((c, i) => Math.abs(c - rnd[i]))
          const edge = Math.max(...diff)
          g = 0.7 + 0.3 * (1 - step(0.32, 0.5, edge))
          break
        }
      }
      out[y * size + x] = clamp01(g)
    }
  }
  return out
}

/** Built-in shapes made from values: alpha 0..1 inside a `size` square. */
function shapeValue(id: BrushShape, x: number, y: number, size: number): number {
  const u = x / size
  const v = y / size
  const dx = u - 0.5
  const dy = v - 0.5
  const d = Math.hypot(dx, dy) * 2
  switch (id) {
    case 'pencil':
      return (1 - step(0.6, 1, d)) * (0.55 + 0.45 * hash2(x, y, 21))
    case 'charcoal': {
      const edge = 0.75 + 0.25 * fbm(u, v, 6, 6, 3, 22)
      return (1 - step(edge - 0.2, edge, d)) * step(0.3, 0.6, fbm(u, v, 12, 12, 3, 23) + hash2(x, y, 24) * 0.3)
    }
    case 'sponge':
      return (1 - step(0.7, 1, d)) * step(0.25, 0.45, cells(u, v, 9, 25))
    case 'watercolor': {
      const edge = 0.7 + 0.25 * fbm(u, v, 5, 5, 3, 26)
      const inside = 1 - step(edge - 0.08, edge, d)
      // Paint pools at the rim, as wet paint dries.
      return inside * (0.55 + 0.45 * step(edge - 0.3, edge - 0.05, d)) * (0.85 + 0.15 * fbm(u, v, 16, 16, 2, 27))
    }
    case 'blob': {
      const a = Math.atan2(dy, dx)
      const edge = 0.7 + 0.18 * Math.sin(a * 5 + 1) * fbm(u, v, 4, 4, 2, 28) + 0.1 * fbm(u, v, 8, 8, 2, 29)
      return 1 - step(edge - 0.04, edge, d)
    }
    case 'cloud':
      return clamp01((fbm(u, v, 4, 4, 5, 30) * 1.6 - 0.35) * (1 - step(0.4, 1, d)) * 1.6)
    default:
      return 0
  }
}

const VALUE_SHAPES = new Set<BrushShape>(['pencil', 'charcoal', 'sponge', 'watercolor', 'blob', 'cloud'])

/** Seeded random numbers (xorshift), 0..1. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}

// ---- Custom images (pure part) ------------------------------------------------

/**
 * Turn RGBA pixels into a paint mask (0..255): images with transparency use
 * their alpha, opaque images their brightness (white = paint).
 */
/** True when an image has real transparency: then its alpha is the shape (else its brightness is). */
export function usesAlpha(data: Uint8ClampedArray | Uint8Array): boolean {
  const n = data.length / 4
  let clear = 0
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 250) clear++
  return clear > n * 0.01
}

/** An image's brightness as an opaque grey canvas: the light and dark a shaded brush keeps. */
export function shadeCanvas(data: Uint8ClampedArray | Uint8Array, w: number, h: number): HTMLCanvasElement {
  const c = canvas(w, h)
  const img = new ImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
    img.data[o + 3] = 255
  }
  c.getContext('2d')!.putImageData(img, 0, 0)
  return c
}

export function maskFromPixels(data: Uint8ClampedArray | Uint8Array, invert = false): Uint8ClampedArray {
  const n = data.length / 4
  const useAlpha = usesAlpha(data)
  const out = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const m = useAlpha ? data[o + 3] : 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
    out[i] = invert ? 255 - m : m
  }
  return out
}

/** Make a grain image repeat without seams: blend it with itself moved by half. */
export function makeTileable(values: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(values.length)
  for (let y = 0; y < h; y++) {
    const wy = 1 - Math.abs((2 * (y + 0.5)) / h - 1)
    for (let x = 0; x < w; x++) {
      const wx = 1 - Math.abs((2 * (x + 0.5)) / w - 1)
      const m = smooth(Math.min(1, Math.min(wx, wy) * 2.5))
      const shifted = values[((y + (h >> 1)) % h) * w + ((x + (w >> 1)) % w)]
      out[y * w + x] = values[y * w + x] * m + shifted * (1 - m)
    }
  }
  return out
}

// ---- Canvases (browser only) ------------------------------------------------

export const TIP = 256

const shapeCache = new Map<string, HTMLCanvasElement>()

function canvas(w: number, h = w) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** A mask (0..255 per pixel) as a white canvas with that alpha. */
export function maskCanvas(mask: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = canvas(w, h)
  const img = new ImageData(w, h)
  for (let i = 0; i < mask.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255
    img.data[i * 4 + 3] = mask[i]
  }
  c.getContext('2d')!.putImageData(img, 0, 0)
  return c
}

/** A built-in brush tip as a white alpha mask, TIP px square. */
export function tipImage(shape: BrushShape, hardness: number): HTMLCanvasElement {
  const key = `${shape}|${hardness.toFixed(2)}`
  const cached = shapeCache.get(key)
  if (cached) return cached
  const c = canvas(TIP)
  const g = c.getContext('2d')!
  const r = TIP / 2
  const k = TIP / 128
  const h = Math.min(0.99, Math.max(0.01, hardness))
  const soft = (x: number, y: number, rad: number, a = 1) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, rad)
    grad.addColorStop(0, `rgba(255,255,255,${a})`)
    grad.addColorStop(h, `rgba(255,255,255,${a})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath()
    g.arc(x, y, rad, 0, Math.PI * 2)
    g.fill()
  }
  const rnd = seeded(shape.length * 977 + Math.round(hardness * 100))
  g.fillStyle = '#fff'
  if (VALUE_SHAPES.has(shape)) {
    const m = new Uint8ClampedArray(TIP * TIP)
    for (let y = 0; y < TIP; y++) for (let x = 0; x < TIP; x++) m[y * TIP + x] = shapeValue(shape, x, y, TIP) * 255
    g.drawImage(maskCanvas(m, TIP, TIP), 0, 0)
  } else if (shape === 'square') {
    const inset = (1 - h) * 12 * k
    g.filter = inset ? `blur(${inset / 2}px)` : 'none'
    g.fillRect(inset, inset, TIP - inset * 2, TIP - inset * 2)
    g.filter = 'none'
  } else if (shape === 'chalk') {
    soft(r, r, r * 0.95)
    // Bite random holes out of the edge and the inside.
    g.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 260; i++) {
      const a = rnd() * Math.PI * 2
      const d = Math.sqrt(rnd()) * r
      g.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.6})`
      g.fillRect(r + Math.cos(a) * d, r + Math.sin(a) * d, (2 + rnd() * 5) * k, (2 + rnd() * 5) * k)
    }
  } else if (shape === 'splatter' || shape === 'speckle' || shape === 'snow') {
    const n = shape === 'speckle' ? 160 : shape === 'snow' ? 18 : 70
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2
      const d = Math.pow(rnd(), 0.7) * r * 0.9
      const rad = shape === 'speckle' ? 0.6 + rnd() * 1.6 : shape === 'snow' ? 4 + rnd() * 9 : 1.5 + rnd() * 5
      soft(r + Math.cos(a) * d, r + Math.sin(a) * d, rad * k, 0.6 + rnd() * 0.4)
    }
  } else if (shape === 'bristle') {
    // Bristles side by side across the stroke (stamps turn with the stroke).
    for (let i = 0; i < 44; i++) soft(r + (rnd() - 0.5) * 30 * k, (8 + rnd() * 112) * k, (4 + rnd() * 6) * k, 0.35 + rnd() * 0.5)
  } else if (shape === 'rake') {
    for (let i = 0; i < 9; i++) soft(r + (rnd() - 0.5) * 4 * k, (10 + i * 13.5) * k, 5 * k, 0.9)
  } else if (shape === 'dry') {
    for (let i = 0; i < 70; i++) {
      const y = r + (rnd() - 0.5) * 100 * k
      g.globalAlpha = 0.25 + rnd() * 0.6
      g.fillRect((4 + rnd() * 20) * k, y, (60 + rnd() * 40) * k, (1 + rnd() * 2.5) * k)
    }
    g.globalAlpha = 1
  } else if (shape === 'oval') {
    g.save()
    g.translate(r, r)
    g.scale(1, 0.55)
    soft(0, 0, r)
    g.restore()
  } else if (shape === 'leaf') {
    g.beginPath()
    g.moveTo(r, 6 * k)
    g.bezierCurveTo(r + 46 * k, 40 * k, r + 34 * k, 100 * k, r, 122 * k)
    g.bezierCurveTo(r - 34 * k, 100 * k, r - 46 * k, 40 * k, r, 6 * k)
    g.fill()
    g.globalCompositeOperation = 'destination-out'
    g.lineWidth = 2 * k
    g.beginPath()
    g.moveTo(r, 14 * k)
    g.lineTo(r, 118 * k)
    g.stroke()
  } else if (shape === 'grass' || shape === 'fur') {
    const n = shape === 'grass' ? 9 : 40
    for (let i = 0; i < n; i++) {
      const x = r + (rnd() - 0.5) * (shape === 'grass' ? 70 : 100) * k
      const lean = (rnd() - 0.5) * 40 * k
      const top = (shape === 'grass' ? 6 + rnd() * 40 : 20 + rnd() * 40) * k
      const w = (shape === 'grass' ? 3 + rnd() * 3 : 1 + rnd()) * k
      g.globalAlpha = shape === 'grass' ? 1 : 0.4 + rnd() * 0.5
      g.beginPath()
      g.moveTo(x - w, 124 * k)
      g.quadraticCurveTo(x + lean * 0.3, (top + 124 * k) / 2, x + lean, top)
      g.quadraticCurveTo(x + lean * 0.3 + w, (top + 124 * k) / 2, x + w, 124 * k)
      g.fill()
    }
    g.globalAlpha = 1
  } else if (shape === 'star' || shape === 'triangle') {
    const pts = shape === 'star' ? 10 : 3
    g.beginPath()
    for (let i = 0; i < pts; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / pts
      const rad = shape === 'star' && i % 2 ? r * 0.42 : r * 0.95
      g.lineTo(r + Math.cos(a) * rad, r + Math.sin(a) * rad * (shape === 'triangle' ? 1 : 1) + (shape === 'triangle' ? r * 0.2 : 0))
    }
    g.fill()
  } else if (shape === 'ring') {
    soft(r, r, r)
    g.globalCompositeOperation = 'destination-out'
    soft(r, r, r * 0.72)
  } else if (shape === 'hatch') {
    for (let i = 0; i < 7; i++) g.fillRect((8 + i * 17) * k, 8 * k, 5 * k, 112 * k)
  } else if (shape === 'hair') {
    // Many fine, hard dots: stamped close together they draw a bundle of parallel strands.
    for (let i = 0; i < 36; i++) {
      const a = rnd() * Math.PI * 2
      const d = Math.sqrt(rnd()) * r * 0.92
      g.globalAlpha = 0.55 + rnd() * 0.45
      g.beginPath()
      g.arc(r + Math.cos(a) * d, r + Math.sin(a) * d, (0.6 + rnd() * 0.8) * k, 0, Math.PI * 2)
      g.fill()
    }
    g.globalAlpha = 1
  } else if (shape === 'hex') {
    g.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3
      g.lineTo(r + Math.cos(a) * r * 0.95, r + Math.sin(a) * r * 0.95)
    }
    g.filter = h < 0.9 ? `blur(${(1 - h) * 8 * k}px)` : 'none'
    g.fill()
    g.filter = 'none'
  } else if (shape === 'heart') {
    g.beginPath()
    g.moveTo(r, 116 * k)
    g.bezierCurveTo(-10 * k, 60 * k, 20 * k, 4 * k, r, 34 * k)
    g.bezierCurveTo(108 * k, 4 * k, 138 * k, 60 * k, r, 116 * k)
    g.fill()
  } else soft(r, r, r)
  g.globalCompositeOperation = 'source-over'
  shapeCache.set(key, c)
  return c
}

// ---- Image textures -----------------------------------------------------------

/** A loaded brush image: its shape as a white alpha mask, and its light and dark as an opaque grey canvas. */
type Loaded = { mask: Uint8ClampedArray; w: number; h: number; canvas: HTMLCanvasElement; shade: HTMLCanvasElement }
const images = new Map<string, Loaded | Promise<Loaded | null> | null>()

const MAX_SIDE = 512

/** Decode an image (data URL) into a paint mask; cached. */
export function loadImageMask(src: string): Promise<Loaded | null> {
  const got = images.get(src)
  if (got instanceof Promise) return got
  if (got !== undefined) return Promise.resolve(got)
  const p = new Promise<Loaded | null>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.max(1, Math.round(img.naturalWidth * s))
      const h = Math.max(1, Math.round(img.naturalHeight * s))
      const c = canvas(w, h)
      const g = c.getContext('2d', { willReadFrequently: true })!
      g.drawImage(img, 0, 0, w, h)
      const data = g.getImageData(0, 0, w, h).data
      const mask = maskFromPixels(data)
      const out = { mask, w, h, canvas: maskCanvas(mask, w, h), shade: shadeCanvas(data, w, h) }
      images.set(src, out)
      resolve(out)
    }
    img.onerror = () => {
      images.set(src, null)
      resolve(null)
    }
    img.src = src
  })
  images.set(src, p)
  return p
}

/** The decoded mask for an image, or null while it is still loading. */
export function imageMask(src: string): Loaded | null {
  const got = images.get(src)
  if (got === undefined) void loadImageMask(src)
  return got && !(got instanceof Promise) ? got : null
}

const derived = new Map<string, HTMLCanvasElement>()

/** A custom shape as a white alpha mask (inverted if asked), or null while loading. */
export function imageTip(src: string, invert: boolean): HTMLCanvasElement | null {
  const m = imageMask(src)
  if (!m) return null
  if (!invert) return m.canvas
  const key = `inv|${src}`
  let c = derived.get(key)
  if (!c) {
    c = maskCanvas(m.mask.map((v) => 255 - v), m.w, m.h)
    derived.set(key, c)
  }
  return c
}

export interface GrainLook {
  grain: BrushGrain
  grainImage?: string | null
  grainDepth: number
  grainContrast: number
  grainBrightness: number
  grainInvert: boolean
}

const grainBase = new Map<string, { values: Float32Array; size: number }>()

function grainSource(look: GrainLook): { values: Float32Array; w: number; h: number } | null {
  if (look.grainImage) {
    const m = imageMask(look.grainImage)
    return m ? { values: Float32Array.from(m.mask, (v) => v / 255), w: m.w, h: m.h } : null
  }
  if (look.grain === 'none') return null
  let b = grainBase.get(look.grain)
  if (!b) {
    b = { values: grainValues(look.grain, 256), size: 256 }
    grainBase.set(look.grain, b)
  }
  return { values: b.values, w: b.size, h: b.size }
}

const grainCanvases = new Map<string, HTMLCanvasElement | null>()

/**
 * The grain as a canvas: `alpha` mode is white with alpha 1 - depth × (1 - grain),
 * `gray` mode is opaque gray for colour blending (white = no change).
 */
export function grainCanvas(look: GrainLook, mode: 'alpha' | 'gray' = 'alpha'): HTMLCanvasElement | null {
  const key = `${mode}|${look.grainImage ?? look.grain}|${look.grainDepth}|${look.grainContrast}|${look.grainBrightness}|${look.grainInvert}`
  if (grainCanvases.has(key)) return grainCanvases.get(key)!
  const src = grainSource(look)
  if (!src) {
    // Images that are still loading are not cached as "none".
    if (!look.grainImage) grainCanvases.set(key, null)
    return null
  }
  const c = canvas(src.w, src.h)
  const img = new ImageData(src.w, src.h)
  const contrast = 1 + look.grainContrast * 2
  for (let i = 0; i < src.values.length; i++) {
    let g = src.values[i]
    if (look.grainInvert) g = 1 - g
    g = clamp01((g - 0.5) * contrast + 0.5 + look.grainBrightness * 0.5)
    const a = 1 - look.grainDepth * (1 - g)
    const o = i * 4
    if (mode === 'alpha') {
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255
      img.data[o + 3] = a * 255
    } else {
      img.data[o] = img.data[o + 1] = img.data[o + 2] = a * 255
      img.data[o + 3] = 255
    }
  }
  c.getContext('2d')!.putImageData(img, 0, 0)
  if (grainCanvases.size > 64) grainCanvases.clear()
  grainCanvases.set(key, c)
  return c
}

/** Small preview of a built-in grain (for the grain library). */
export function grainPreview(id: BrushGrain): HTMLCanvasElement | null {
  return grainCanvas({ grain: id, grainDepth: 1, grainContrast: 0, grainBrightness: 0, grainInvert: false }, 'gray')
}
