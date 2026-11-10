import { blank, floodPoints, getPx, line, setPx, type Img, type RGBA } from '@/shared/pixel/model'

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

/** Magic wand: pixels of this colour, within `tolerance` per channel (connected, or everywhere). */
export function wandMask(img: Img, x: number, y: number, contiguous: boolean, tolerance = 0): Mask {
  const m = new Uint8Array(img.width * img.height)
  for (const [px, py] of floodPoints(img, x, y, contiguous, tolerance)) m[py * img.width + px] = 1
  return m
}

/** The ellipse inside the box (pixel centres), like the Ellipse tool fills it. */
export function ellipseMask(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Mask {
  const m = new Uint8Array(w * h)
  const [ax, bx, ay, by] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)]
  const [cx, cy, rx, ry] = [(ax + bx) / 2, (ay + by) / 2, (bx - ax) / 2 + 0.5, (by - ay) / 2 + 0.5]
  for (let y = Math.max(0, ay); y <= Math.min(h - 1, by); y++) for (let x = Math.max(0, ax); x <= Math.min(w - 1, bx); x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) m[y * w + x] = 1
  return m
}

/** Grow (n > 0) or shrink (n < 0) the selection by n pixels, in all 8 directions. */
export function growMask(m: Mask, w: number, h: number, n: number): Mask {
  let cur = m
  for (let k = 0; k < Math.abs(n); k++) {
    const next = new Uint8Array(cur)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (!!cur[i] === n > 0) continue
        // Growing: an empty pixel next to a selected one joins; shrinking: a selected pixel next to an empty one (or the edge) leaves.
        let near = false
        for (let dy = -1; dy <= 1 && !near; dy++)
          for (let dx = -1; dx <= 1 && !near; dx++) {
            const [nx, ny] = [x + dx, y + dy]
            const v = nx >= 0 && ny >= 0 && nx < w && ny < h ? cur[ny * w + nx] : 0
            near = n > 0 ? !!v : !v
          }
        if (near) next[i] = n > 0 ? 1 : 0
      }
    cur = next
  }
  return cur
}

/** Only the edge: the selection minus the selection shrunk by `n`. */
export function borderMask(m: Mask, w: number, h: number, n = 1): Mask {
  const inner = growMask(m, w, h, -n)
  return m.map((v, i) => (v && !inner[i] ? 1 : 0))
}

export const invertMask = (m: Mask): Mask => m.map((v) => (v ? 0 : 1))

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

/**
 * Outline: a one-pixel line of `color` around the opaque pixels, inside the mask if given.
 * Outside (default) draws on the empty pixels next to the drawing, inside on its own edge pixels;
 * corners also counts diagonal neighbours (a rounder, thicker look at corners).
 */
export function outline(img: Img, color: RGBA, m?: Mask | null, opts: { inside?: boolean; corners?: boolean } = {}): Img {
  const out: Img = { ...img, data: new Uint8ClampedArray(img.data) }
  const w = img.width
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < img.height && img.data[(y * w + x) * 4 + 3] > 0
  const near = opts.corners ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, 0], [1, 0], [0, -1], [0, 1]]
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y) !== !!opts.inside || (m && !m[y * w + x])) continue
      if (near.some(([dx, dy]) => solid(x + dx, y + dy) !== !!opts.inside)) setPx(out, x, y, color)
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

/** Scale2x: twice the size, keeping hard pixel edges and smoothing diagonal steps. */
export function scale2x(img: Img): Img {
  const out = blank(img.width * 2, img.height * 2)
  const at = (x: number, y: number) => getPx(img, Math.max(0, Math.min(img.width - 1, x)), Math.max(0, Math.min(img.height - 1, y)))
  const same = (a: RGBA, b: RGBA) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const p = at(x, y)
      const a = at(x, y - 1)
      const b = at(x + 1, y)
      const c = at(x - 1, y)
      const d = at(x, y + 1)
      setPx(out, 2 * x, 2 * y, same(c, a) && !same(c, d) && !same(a, b) ? a : p)
      setPx(out, 2 * x + 1, 2 * y, same(a, b) && !same(a, c) && !same(b, d) ? b : p)
      setPx(out, 2 * x, 2 * y + 1, same(d, c) && !same(d, b) && !same(c, a) ? c : p)
      setPx(out, 2 * x + 1, 2 * y + 1, same(b, d) && !same(b, a) && !same(d, c) ? d : p)
    }
  return out
}

/**
 * Pixel rotate by any angle without blur: scaled up 8× with Scale2x, turned with nearest-neighbour
 * sampling, and read back at the middle of every 8 × 8 block (the published RotSprite idea).
 */
export function rotateAny(img: Img, degrees: number): Img {
  const big = scale2x(scale2x(scale2x(img)))
  const r = (degrees * Math.PI) / 180
  const [cos, sin] = [Math.cos(r), Math.sin(r)]
  const w = Math.ceil(Math.abs(img.width * cos) + Math.abs(img.height * sin))
  const h = Math.ceil(Math.abs(img.width * sin) + Math.abs(img.height * cos))
  const out = blank(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // The middle of this pixel, turned back into the source, in 8× source pixels.
      const dx = x + 0.5 - w / 2
      const dy = y + 0.5 - h / 2
      const sx = Math.floor((dx * cos + dy * sin + img.width / 2) * 8)
      const sy = Math.floor((-dx * sin + dy * cos + img.height / 2) * 8)
      if (sx >= 0 && sy >= 0 && sx < big.width && sy < big.height) setPx(out, x, y, getPx(big, sx, sy))
    }
  return out
}

/** Nearest-neighbour scale to w × h: every pixel stays a hard square. */
export function scaleImg(img: Img, w: number, h: number): Img {
  const out = blank(Math.max(1, w), Math.max(1, h))
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) setPx(out, x, y, getPx(img, Math.floor((x * img.width) / out.width), Math.floor((y * img.height) / out.height)))
  return out
}

/** A selection as text for the document (so selecting is an undo step): run lengths, starting with unselected. */
export function maskToText(m: Mask): string {
  const runs: number[] = []
  let cur = 0
  let n = 0
  for (const v of m) {
    if ((v ? 1 : 0) === cur) n++
    else {
      runs.push(n)
      cur = 1 - cur
      n = 1
    }
  }
  runs.push(n)
  return runs.join(',')
}

export function textToMask(t: string, size: number): Mask | null {
  const m = new Uint8Array(size)
  let i = 0
  t.split(',').forEach((r, k) => {
    const n = Number(r) || 0
    if (k % 2) m.fill(1, i, Math.min(size, i + n))
    i += n
  })
  return m.some((v) => v) ? m : null
}
