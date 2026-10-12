import { blank, floodPoints, getPx, line, setPx, type Img, type RGBA } from './model'

/** A selection: one byte per pixel, 1 = selected. */
export type Mask = Uint8Array

export type Combine = 'replace' | 'add' | 'subtract'

export function combine(old: Mask | null, next: Mask, how: Combine): Mask {
  if (how === 'replace' || !old) return next
  const out = new Uint8Array(old)
  for (let i = 0; i < out.length; i++) if (next[i]) out[i] = how === 'add' ? 1 : 0
  return out
}

export function rectMask(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Mask {
  const m = new Uint8Array(w * h)
  for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(h - 1, Math.max(y0, y1)); y++) for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(w - 1, Math.max(x0, x1)); x++) m[y * w + x] = 1
  return m
}

/** Pixels whose centre is inside the drawn outline (even-odd rule), plus the outline itself. */
export function lassoMask(w: number, h: number, pts: [number, number][]): Mask {
  const m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let inside = false
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i]
        const [xj, yj] = pts[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
      }
      if (inside) m[y * w + x] = 1
    }
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]
    for (const [x, y] of line(a[0], a[1], b[0], b[1])) if (x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = 1
  })
  return m
}

/** Magic wand: pixels of exactly this colour (connected, or everywhere). */
export function wandMask(img: Img, x: number, y: number, contiguous: boolean): Mask {
  const m = new Uint8Array(img.width * img.height)
  for (const [px, py] of floodPoints(img, x, y, contiguous)) m[py * img.width + px] = 1
  return m
}

export function bounds(m: Mask, w: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -1
  let y1 = -1
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue
    const x = i % w
    const y = (i - x) / w
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** The selected pixels cut out of `img` (img loses them) as a piece the size of their bounds. */
export function cut(img: Img, m: Mask, keep = false): { piece: Img; x: number; y: number; mask: Mask } | null {
  const b = bounds(m, img.width)
  if (!b) return null
  const piece = blank(b.w, b.h)
  const mask = new Uint8Array(b.w * b.h)
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const i = (b.y + y) * img.width + b.x + x
      if (!m[i]) continue
      mask[y * b.w + x] = 1
      setPx(piece, x, y, getPx(img, b.x + x, b.y + y))
      if (!keep) setPx(img, b.x + x, b.y + y, [0, 0, 0, 0])
    }
  return { piece, x: b.x, y: b.y, mask }
}

/** Put a piece onto an image at x,y (only its opaque pixels, or all pixels under its mask). */
export function paste(img: Img, piece: Img, x: number, y: number, mask?: Mask) {
  for (let py = 0; py < piece.height; py++)
    for (let px = 0; px < piece.width; px++) {
      const c = getPx(piece, px, py)
      if (mask ? mask[py * piece.width + px] : c[3]) setPx(img, x + px, y + py, c)
    }
}

/** The piece's mask placed on the canvas at x,y. */
export function placeMask(w: number, h: number, mask: Mask, mw: number, x: number, y: number): Mask {
  const m = new Uint8Array(w * h)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const tx = x + (i % mw)
    const ty = y + Math.floor(i / mw)
    if (tx >= 0 && ty >= 0 && tx < w && ty < h) m[ty * w + tx] = 1
  }
  return m
}

export function flipImg(img: Img, axis: 'x' | 'y'): Img {
  const out = blank(img.width, img.height)
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) setPx(out, axis === 'x' ? img.width - 1 - x : x, axis === 'y' ? img.height - 1 - y : y, getPx(img, x, y))
  return out
}

/** Exact quarter turn; `cw` clockwise. Width and height swap. */
export function rotate90(img: Img, cw: boolean): Img {
  const out = blank(img.height, img.width)
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) setPx(out, cw ? img.height - 1 - y : y, cw ? x : img.width - 1 - x, getPx(img, x, y))
  return out
}

/** Mask transforms that follow the image ones. */
export const maskImg = (m: Mask, w: number, h: number): Img => {
  const img = blank(w, h)
  for (let i = 0; i < m.length; i++) if (m[i]) img.data[i * 4 + 3] = 255
  return img
}
export const imgMask = (img: Img): Mask => {
  const m = new Uint8Array(img.width * img.height)
  for (let i = 0; i < m.length; i++) m[i] = img.data[i * 4 + 3] ? 1 : 0
  return m
}

/** Outline: a one-pixel line of `color` around the opaque pixels (outside, 4-way), inside the mask if given. */
export function outline(img: Img, color: RGBA, m?: Mask | null): Img {
  const out: Img = { ...img, data: new Uint8ClampedArray(img.data) }
  const w = img.width
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < img.height && img.data[(y * w + x) * 4 + 3] > 0
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y) || (m && !m[y * w + x])) continue
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) setPx(out, x, y, color)
    }
  return out
}

/** Shift with wrap-around: what leaves one edge comes back at the other (checks seamless tiles). */
export function wrapShift(img: Img, dx: number, dy: number): Img {
  const out = blank(img.width, img.height)
  const mod = (a: number, n: number) => ((a % n) + n) % n
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) setPx(out, mod(x + dx, img.width), mod(y + dy, img.height), getPx(img, x, y))
  return out
}
