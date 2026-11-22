import { balanceLut, curvesLut, gradientLut, hsbAdjust, luma, type Balance, type RGB } from './color'
import type { AdjustValues, FilterId } from './filters'
import { fieldAt } from './liquify'
import { renderAscii } from '../ascii'

/**
 * CPU versions of the Adjustments and Liquify (Sketch Pro), for machines
 * without WebGL2. They follow the shaders in shaders.ts; slower, same look.
 * Pixels are premultiplied floats 0..1 while working.
 */

type Px = Float32Array<ArrayBuffer>

function toPx(img: ImageData): Px {
  const d = img.data
  const p = new Float32Array(d.length)
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255
    p[i] = (d[i] / 255) * a
    p[i + 1] = (d[i + 1] / 255) * a
    p[i + 2] = (d[i + 2] / 255) * a
    p[i + 3] = a
  }
  return p
}

function toImage(p: Px, w: number, h: number): ImageData {
  const out = new ImageData(w, h)
  const d = out.data
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3]
    d[i + 3] = a * 255
    if (a > 0) {
      d[i] = (p[i] / a) * 255
      d[i + 1] = (p[i + 1] / a) * 255
      d[i + 2] = (p[i + 2] / a) * 255
    }
  }
  return out
}

/** Bilinear sample with clamped edges, into `out`. */
function sample(p: Px, w: number, h: number, x: number, y: number, out: number[]) {
  x = Math.min(w - 1, Math.max(0, x - 0.5))
  y = Math.min(h - 1, Math.max(0, y - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  for (let c = 0; c < 4; c++) {
    const a = p[(y0 * w + x0) * 4 + c] * (1 - fx) + p[(y0 * w + x1) * 4 + c] * fx
    const b = p[(y1 * w + x0) * 4 + c] * (1 - fx) + p[(y1 * w + x1) * 4 + c] * fx
    out[c] = a * (1 - fy) + b * fy
  }
}

/** Run `f(x, y, i)` for every pixel; it writes premultiplied RGBA into `out` at i. */
function each(w: number, h: number, f: (x: number, y: number, i: number) => void) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f(x + 0.5, y + 0.5, (y * w + x) * 4)
}

/** Straight colour of a premultiplied pixel. */
const straight = (p: Px, i: number): RGB => {
  const a = p[i + 3]
  return a > 0 ? [p[i] / a, p[i + 1] / a, p[i + 2] / a] : [0, 0, 0]
}
const put = (out: Px, i: number, c: RGB, a: number) => {
  for (let k = 0; k < 3; k++) out[i + k] = Math.min(1, Math.max(0, c[k])) * a
  out[i + 3] = a
}

function gauss1(p: Px, w: number, h: number, sigma: number, dx: number, dy: number): Px {
  if (sigma < 0.3) return p
  const r = Math.ceil(sigma * 3)
  const k: number[] = []
  let sum = 0
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp((-i * i) / (2 * sigma * sigma))
  const out = new Float32Array(p.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      for (let i = -r; i <= r; i++) {
        const sx = Math.min(w - 1, Math.max(0, x + i * dx))
        const sy = Math.min(h - 1, Math.max(0, y + i * dy))
        const s = (sy * w + sx) * 4
        const wt = k[i + r] / sum
        out[o] += p[s] * wt
        out[o + 1] += p[s + 1] * wt
        out[o + 2] += p[s + 2] * wt
        out[o + 3] += p[s + 3] * wt
      }
    }
  return out
}
const gauss = (p: Px, w: number, h: number, sigma: number) => gauss1(gauss1(p, w, h, sigma, 1, 0), w, h, sigma, 0, 1)

const fract = (v: number) => v - Math.floor(v)
const hash = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453)
function vnoise(x: number, y: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  let fx = x - ix
  let fy = y - iy
  fx = fx * fx * (3 - 2 * fx)
  fy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * fx
  const b = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * fx
  return a + (b - a) * fy
}

function lutPass(p: Px, out: Px, t: [Uint8Array, Uint8Array, Uint8Array], byLuma: boolean, keepLum: boolean, amount: number) {
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3]
    if (!a) continue
    const c = straight(p, i)
    let r: RGB
    if (byLuma) {
      const l = Math.round(luma(...c) * 255)
      r = [0, 1, 2].map((k) => c[k] + (t[k][l] / 255 - c[k]) * amount) as RGB
    } else {
      r = [t[0][Math.round(c[0] * 255)] / 255, t[1][Math.round(c[1] * 255)] / 255, t[2][Math.round(c[2] * 255)] / 255]
      if (keepLum) {
        const d = luma(...c) - luma(...r)
        r = [r[0] + d, r[1] + d, r[2] + d]
      }
    }
    put(out, i, r, a)
  }
}

/** A grid turned by `ang`: distance (in cells) from p to its dot centre, and the colour there. */
function cellAt(p: Px, w: number, h: number, x: number, y: number, ang: number, cell: number, s: number[]) {
  const c = Math.cos(ang)
  const sn = Math.sin(ang)
  const qx = c * x - sn * y
  const qy = sn * x + c * y
  const cx = (Math.floor(qx / cell) + 0.5) * cell
  const cy = (Math.floor(qy / cell) + 0.5) * cell
  sample(p, w, h, c * cx + sn * cy, -sn * cx + c * cy, s)
  const a = s[3]
  return { d: Math.hypot(qx - cx, qy - cy) / cell, c: (a > 0 ? [s[0] / a, s[1] / a, s[2] / a] : [0, 0, 0]) as RGB }
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
const dot1 = (v: number, d: number) => {
  const r = Math.sqrt(Math.min(1, Math.max(0, v))) * 0.72
  return smooth(r + 0.06, r - 0.06, d)
}
const cmyk = ([r, g, b]: RGB) => {
  const k = 1 - Math.max(r, g, b)
  const n = Math.max(1e-4, 1 - k)
  return [(1 - r - k) / n, (1 - g - k) / n, (1 - b - k) / n, k]
}

/**
 * Values to opacity (like Krita's colour to alpha against white or black): bright (mode 0) or dark (mode 1)
 * parts turn see-through, and colours are unblended so the result over white (or black) looks the same.
 */
export function valueAlpha(c: RGB, a: number, mode: number, amount: number): [RGB, number] {
  const k = mode ? c : (c.map((x) => 1 - x) as RGB)
  const na = Math.max(k[0], k[1], k[2])
  const nk = na > 0 ? k.map((x) => x / na) : [0, 0, 0]
  const un = (mode ? nk : nk.map((x) => 1 - x)) as RGB
  const mix = (x: number, y: number) => x + (y - x) * amount
  return [[mix(c[0], un[0]), mix(c[1], un[1]), mix(c[2], un[2])], a * mix(1, na)]
}

/** An adjustment of `img` on the CPU. */
export function runCpu(id: FilterId, a: AdjustValues, img: ImageData): ImageData {
  if (id === 'ascii') return renderAscii(img, a)
  const { width: w, height: h } = img
  const v = a.v
  const p = toPx(img)
  let out: Px = new Float32Array(p.length)
  const s = [0, 0, 0, 0]
  const s2 = [0, 0, 0, 0]
  const s3 = [0, 0, 0, 0]
  switch (id) {
    case 'hsb':
      for (let i = 0; i < p.length; i += 4) if (p[i + 3]) put(out, i, hsbAdjust(straight(p, i), v.hue, v.sat, v.bright), p[i + 3])
      break
    case 'balance': {
      const bal = Object.fromEntries((['shadows', 'midtones', 'highlights'] as const).map((r) => [r, [0, 1, 2].map((i) => v[`${r}${i}`] ?? 0)])) as Balance
      lutPass(p, out, balanceLut(bal), false, !!v.keep, 1)
      break
    }
    case 'curves':
      lutPass(p, out, curvesLut(a.curves), false, false, 1)
      break
    case 'gradient':
      lutPass(p, out, gradientLut(a.gradient), true, false, v.amount)
      break
    case 'valueAlpha':
      for (let i = 0; i < p.length; i += 4) if (p[i + 3]) put(out, i, ...valueAlpha(straight(p, i), p[i + 3], v.mode, v.amount))
      break
    case 'gaussian':
      out = gauss(p, w, h, v.radius / 2)
      break
    case 'motion': {
      const r = (v.angle * Math.PI) / 180
      const n = 32
      each(w, h, (x, y, i) => {
        for (let k = 0; k < n; k++) {
          const t = (k / (n - 1) - 0.5) * v.length
          sample(p, w, h, x + Math.cos(r) * t, y + Math.sin(r) * t, s)
          for (let c = 0; c < 4; c++) out[i + c] += s[c] / n
        }
      })
      break
    }
    case 'perspective': {
      const n = 32
      each(w, h, (x, y, i) => {
        for (let k = 0; k < n; k++) {
          const t = v.amount * 0.5 * (k / (n - 1))
          sample(p, w, h, x + (a.center.x - x) * t, y + (a.center.y - y) * t, s)
          for (let c = 0; c < 4; c++) out[i + c] += s[c] / n
        }
      })
      break
    }
    case 'noise':
      each(w, h, (x, y, i) => {
        const al = p[i + 3]
        if (!al) return
        let nx = x / v.scale + a.seed * 17
        let ny = y / v.scale + a.seed * 17
        let n = 0
        let amp = 0.5
        let tot = 0
        for (let o = 0; o < Math.min(6, v.octaves); o++) {
          let q = vnoise(nx, ny)
          if (v.kind > 1.5) q = 1 - Math.abs(2 * q - 1)
          else if (v.kind > 0.5) q = Math.abs(2 * q - 1)
          n += q * amp
          tot += amp
          amp *= 0.5
          nx *= 2.03
          ny *= 2.03
        }
        n /= tot
        const c = straight(p, i)
        put(out, i, c.map((cv) => cv + ((cv < 0.5 ? 2 * cv * n : 1 - 2 * (1 - cv) * (1 - n)) - cv) * v.amount) as RGB, al)
      })
      break
    case 'sharpen': {
      const b = gauss(p, w, h, 1.5)
      for (let i = 0; i < p.length; i += 4) {
        const al = p[i + 3]
        for (let c = 0; c < 3; c++) out[i + c] = Math.min(al, Math.max(0, p[i + c] + (p[i + c] - b[i + c]) * v.amount))
        out[i + 3] = al
      }
      break
    }
    case 'bloom': {
      const bright = new Float32Array(p.length)
      for (let i = 0; i < p.length; i += 4) {
        const k = smooth(v.threshold - 0.1, v.threshold, luma(...straight(p, i)))
        for (let c = 0; c < 4; c++) bright[i + c] = p[i + c] * k
      }
      const g = gauss(bright, w, h, v.size / 2)
      for (let i = 0; i < p.length; i++) out[i] = 1 - (1 - p[i]) * (1 - Math.min(1, g[i] * v.amount))
      break
    }
    case 'glitch':
      each(w, h, (x, y, i) => {
        let ox = 0
        let oy = 0
        let split = 0
        const k = v.kind
        const am = v.amount
        if (k < 0.5) {
          const bx = Math.floor(x / 96)
          const by = Math.floor(y / 24)
          if (hash(bx + a.seed, by + a.seed) < am * 0.6) {
            ox = (hash(bx + a.seed + 3.1, by + a.seed + 3.1) - 0.5) * am * 240
            split = 6 * am
          }
        } else if (k < 1.5) {
          ox = Math.sin(y * 0.03 + a.seed) * am * 30 + (hash(Math.floor(y / 4), a.seed) - 0.5) * am * 8
          split = 4 * am
        } else if (k < 2.5) {
          const band = Math.floor(y / 3)
          if (hash(band, a.seed) > 1 - am * 0.3) ox = (hash(band, a.seed + 1) - 0.5) * 120 * am
          split = 10 * am
        } else {
          const band = Math.floor((x + y) / 48)
          if (hash(band, a.seed) < am * 0.7) {
            const t = (hash(band, a.seed + 2) - 0.5) * am * 90
            ox = t
            oy = -t
          }
          split = 3 * am
        }
        sample(p, w, h, x + ox + split, y + oy, s)
        sample(p, w, h, x + ox, y + oy, s2)
        sample(p, w, h, x + ox - split, y + oy, s3)
        const al = Math.max(s[3], s2[3], s3[3])
        let noise = 0
        if (k > 1.5 && k < 2.5) noise = (hash(Math.floor(y), a.seed + 5) - 0.5) * 0.15 * am * al
        out[i] = Math.min(al, Math.max(0, s[0] + noise))
        out[i + 1] = Math.min(al, Math.max(0, s2[1] + noise))
        out[i + 2] = Math.min(al, Math.max(0, s3[2] + noise))
        out[i + 3] = al
      })
      break
    case 'halftone':
      each(w, h, (x, y, i) => {
        const al = p[i + 3]
        if (!al) return
        const cell = v.size
        let col: RGB
        const at = (ang: number) => cellAt(p, w, h, x, y, ang, cell, s)
        if (v.mode < 0.5) {
          const c1 = at(0.2618)
          const cc = dot1(cmyk(c1.c)[0], c1.d)
          const c2 = at(1.309)
          const mm = dot1(cmyk(c2.c)[1], c2.d)
          const c3 = at(0)
          const yy = dot1(cmyk(c3.c)[2], c3.d)
          const c4 = at(0.7854)
          const kk = dot1(cmyk(c4.c)[3], c4.d)
          col = [(1 - cc) * (1 - kk), (1 - mm) * (1 - kk), (1 - yy) * (1 - kk)]
        } else if (v.mode < 1.5) {
          const c1 = at(0.2618)
          const c2 = at(1.309)
          const c3 = at(0.7854)
          col = [dot1(c1.c[0], c1.d), dot1(c2.c[1], c2.d), dot1(c3.c[2], c3.d)]
        } else {
          const c1 = at(0.7854)
          const g = 1 - dot1(1 - luma(...c1.c), c1.d)
          col = [g, g, g]
        }
        put(out, i, col, al)
      })
      break
    case 'chromatic': {
      const r = (v.angle * Math.PI) / 180
      each(w, h, (x, y, i) => {
        const [ox, oy] = v.mode < 0.5 ? [((x - a.center.x) / Math.max(w, h)) * v.amount * 2, ((y - a.center.y) / Math.max(w, h)) * v.amount * 2] : [Math.cos(r) * v.amount, Math.sin(r) * v.amount]
        sample(p, w, h, x + ox, y + oy, s)
        sample(p, w, h, x - ox, y - oy, s3)
        const al = Math.max(s[3], p[i + 3], s3[3])
        out[i] = s[0]
        out[i + 1] = p[i + 1]
        out[i + 2] = s3[2]
        out[i + 3] = al
      })
      break
    }
  }
  return toImage(out, w, h)
}

/** Liquify on the CPU: like the WARP shader. */
export function warpCpu(img: ImageData, field: Float32Array, fw: number, fh: number, cell: number, amount: number): ImageData {
  const { width: w, height: h } = img
  const p = toPx(img)
  const out = new Float32Array(p.length)
  const s = [0, 0, 0, 0]
  const d = [0, 0]
  each(w, h, (x, y, i) => {
    fieldAt(field, fw, fh, x / cell, y / cell, d)
    const qx = x + d[0] * amount
    const qy = y + d[1] * amount
    if (qx < 0 || qy < 0 || qx > w || qy > h) return
    sample(p, w, h, qx, qy, s)
    out.set(s, i)
  })
  return toImage(out, w, h)
}
