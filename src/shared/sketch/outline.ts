/**
 * One outline engine for the Outline layer and the Outliner tool: a ring around (or inside) whatever has paint,
 * from a distance field in two passes (rows, then columns). Each pass looks at most `size` pixels each way, so a
 * changed spot only needs `size` pixels around it worked out again. The GPU runs the same two passes
 * (OUTLINE_H_FRAG and OUTLINE_V_FRAG below); this file has the Canvas 2D version and the settings.
 */

export interface OutlineSettings {
  /** Thickness in pixels, 1..MAX_OUTLINE. */
  size: number
  color: string
  /** Set: the colour fades from `color` (at the drawing) to `color2` (at the outer edge). */
  color2?: string | null
  /** Around the drawing, on its edge (half in, half out) or inside it. */
  where: 'outside' | 'center' | 'inside'
  /** 0 = soft glow, 1 = crisp edge. */
  sharpness: number
  /** 0 = square corners, 1 = round. */
  roundness: number
  /** 0..1, how see-through the outline is (the drawing itself stays as it is). Missing = 1. */
  opacity?: number
  /** A second ring outside the first (a sticker's white and black line), same sharpness and roundness. */
  second?: { size: number; color: string } | null
}

export const MAX_OUTLINE = 120

export const defaultOutline = (): OutlineSettings => ({ size: 8, color: '#111111', color2: null, where: 'outside', sharpness: 1, roundness: 1 })

/** How far an outline reaches past the paint (and how far a change moves it). */
export const outlineReach = (o: OutlineSettings) => Math.ceil(clampSize(o.size)) + (o.second ? Math.ceil(clampSize(o.second.size)) : 0) + 2

/** The second ring as settings of its own: outside whatever the first pass made. */
export const secondOutline = (o: OutlineSettings): OutlineSettings | null =>
  o.second ? { size: o.second.size, color: o.second.color, where: 'outside', sharpness: o.sharpness, roundness: o.roundness } : null

export const outlineOpacity = (o: OutlineSettings) => Math.max(0, Math.min(1, o.opacity ?? 1))

const clampSize = (s: number) => Math.max(1, Math.min(MAX_OUTLINE, s || 1))

function hex(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})/i.exec(c)
  const n = m ? parseInt(m[1], 16) : 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The numbers both versions work with. */
export function outlineParams(o: OutlineSettings) {
  const s = clampSize(o.size)
  const sOut = o.where === 'outside' ? s : o.where === 'center' ? s / 2 : 0
  const sIn = o.where === 'inside' ? s : o.where === 'center' ? s / 2 : 0
  return { s, sOut, sIn, soft: Math.max(1, (1 - Math.max(0, Math.min(1, o.sharpness))) * s), round: Math.max(0, Math.min(1, o.roundness)), c1: hex(o.color), c2: hex(o.color2 || o.color) }
}

/**
 * The outlined picture of `img` (straight RGBA): the paint over its outline, or (`ringOnly`) just the outline.
 * Outside `img` counts as empty, so pass a piece `outlineReach` bigger than the part you keep.
 */
export function outlineCpu(img: ImageData, o: OutlineSettings, ringOnly = false): ImageData {
  const sec = secondOutline(o)
  let out: ImageData
  if (!sec) out = rings(img, o, ringOnly)
  else if (!ringOnly) out = rings(rings(img, o, false), sec, false)
  else {
    // Just the two rings: the first, over the second (which rings the drawing with its first ring).
    out = rings(img, o, true)
    const two = rings(rings(img, o, false), sec, true).data
    const d = out.data
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255
      const b = (two[i + 3] / 255) * (1 - a)
      const t = a + b
      if (!t) continue
      for (let k = 0; k < 3; k++) d[i + k] = (d[i + k] * a + two[i + k] * b) / t
      d[i + 3] = t * 255
    }
  }
  const op = outlineOpacity(o)
  if (op >= 1) return out
  // Opacity fades from the drawing (or nothing, for rings only) to the outlined picture, premultiplied, like the GPU.
  const d = out.data
  const src = img.data
  for (let i = 0; i < d.length; i += 4) {
    const pa = ringOnly ? 0 : src[i + 3] / 255
    const oa = d[i + 3] / 255
    const a = pa + (oa - pa) * op
    if (a <= 0) {
      d[i + 3] = 0
      continue
    }
    for (let k = 0; k < 3; k++) d[i + k] = (src[i + k] * pa * (1 - op) * (ringOnly ? 0 : 1) + d[i + k] * oa * op) / a
    d[i + 3] = a * 255
  }
  return out
}

/** One ring pass at full strength. */
function rings(img: ImageData, o: OutlineSettings, ringOnly: boolean): ImageData {
  const { width: w, height: h, data } = img
  const p = outlineParams(o)
  const S = Math.ceil(p.s)
  const INF = S + 1
  // Rows: how far to the nearest painted (hOut) and nearest empty (hIn) pixel, with partly covered pixels a bit closer.
  const hOut = new Float32Array(w * h)
  const hIn = new Float32Array(w * h)
  for (const [dst, inside] of [
    [hOut, false],
    [hIn, true],
  ] as const) {
    if (inside ? !p.sIn : !p.sOut) continue
    for (let y = 0; y < h; y++) {
      const row = y * w
      let run = INF
      for (let x = 0; x < w; x++) {
        const a = data[(row + x) * 4 + 3] / 255
        const k = inside ? 1 - a : a
        run = Math.min(run + 1, k > 0 ? 0.5 - k : INF)
        dst[row + x] = run
      }
      run = INF
      for (let x = w - 1; x >= 0; x--) {
        const a = data[(row + x) * 4 + 3] / 255
        const k = inside ? 1 - a : a
        run = Math.min(run + 1, k > 0 ? 0.5 - k : INF)
        dst[row + x] = Math.max(0, Math.min(dst[row + x], run, INF))
      }
    }
  }
  // Columns: the distance itself, round, square or between.
  const dist = (hh: Float32Array, x: number, y: number) => {
    let d = INF
    for (let j = -S; j <= S; j++) {
      const yy = y + j
      if (yy < 0 || yy >= h) continue
      const a = hh[yy * w + x]
      if (a >= d) continue
      // Like the rows: a painted pixel's edge is half a pixel nearer than its middle.
      const b = Math.max(0, Math.abs(j) - 0.5)
      if (b >= d) continue
      const sq = Math.max(a, b)
      const m = sq + (Math.sqrt(a * a + b * b) - sq) * p.round
      if (m < d) d = m
    }
    return d
  }
  const ramp = (d: number, size: number) => {
    const t = Math.max(0, Math.min(1, (size + 0.5 - d) / p.soft))
    return p.soft > 1 ? t * t * (3 - 2 * t) : t
  }
  const out = new ImageData(w, h, { colorSpace: img.colorSpace })
  const od = out.data
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const la = data[i + 3] / 255
      // Premultiplied while mixing.
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      if (p.sOut) {
        const d = dist(hOut, x, y)
        // Rings only: no outer ring under solid paint (it would fill the shape); under soft edges it stays, so nothing shows through.
        const ra = d <= p.sOut + p.soft && !(ringOnly && la >= 1) ? ramp(d, p.sOut) : 0
        if (ra > 0) {
          const t = Math.min(1, d / p.sOut)
          r = (p.c1[0] + (p.c2[0] - p.c1[0]) * t) * ra
          g = (p.c1[1] + (p.c2[1] - p.c1[1]) * t) * ra
          b = (p.c1[2] + (p.c2[2] - p.c1[2]) * t) * ra
          a = ra
        }
      }
      if (!ringOnly && la > 0) {
        r = data[i] * la + r * (1 - la)
        g = data[i + 1] * la + g * (1 - la)
        b = data[i + 2] * la + b * (1 - la)
        a = la + a * (1 - la)
      }
      if (p.sIn && la > 0) {
        const d = dist(hIn, x, y)
        const ra = d <= p.sIn + p.soft ? ramp(d, p.sIn) * la : 0
        if (ra > 0) {
          const t = Math.min(1, d / p.sIn)
          r = (p.c1[0] + (p.c2[0] - p.c1[0]) * t) * ra + r * (1 - ra)
          g = (p.c1[1] + (p.c2[1] - p.c1[1]) * t) * ra + g * (1 - ra)
          b = (p.c1[2] + (p.c2[2] - p.c1[2]) * t) * ra + b * (1 - ra)
          a = ra + a * (1 - ra)
        }
      }
      if (a > 0) {
        od[i] = r / a
        od[i + 1] = g / a
        od[i + 2] = b / a
        od[i + 3] = a * 255
      }
    }
  return out
}

/** Outline the part `r` of a canvas into `dst` (same size), reading `outlineReach` more around it. */
export function outlineInto(src: HTMLCanvasElement, dst: CanvasRenderingContext2D, o: OutlineSettings, r: { x: number; y: number; w: number; h: number }, ringOnly = false) {
  const m = outlineReach(o)
  const x0 = Math.max(0, r.x - m)
  const y0 = Math.max(0, r.y - m)
  const x1 = Math.min(src.width, r.x + r.w + m)
  const y1 = Math.min(src.height, r.y + r.h + m)
  if (x1 <= x0 || y1 <= y0) return
  const img = src.getContext('2d')!.getImageData(x0, y0, x1 - x0, y1 - y0)
  dst.clearRect(r.x, r.y, r.w, r.h)
  dst.putImageData(outlineCpu(img, o, ringOnly), x0, y0, r.x - x0, r.y - y0, r.w, r.h)
}

// ---- GPU passes (gpuPaint.ts) --------------------------------------------------
// Pass 1 writes the row distances as bytes: r,g = to paint (whole, fraction), b,a = to empty.

const GLSL_HEADER = '#version 300 es\nprecision highp float;\n'

export const OUTLINE_H_FRAG = `${GLSL_HEADER}
uniform sampler2D src;
uniform float S;
uniform bool useOut, useIn;
out vec4 outColor;
float alphaAt(ivec2 p, ivec2 size) {
  if (p.x < 0 || p.y < 0 || p.x >= size.x || p.y >= size.y) return 0.0;
  return texelFetch(src, p, 0).a;
}
void main() {
  ivec2 size = textureSize(src, 0);
  ivec2 c = ivec2(gl_FragCoord.xy);
  int n = int(ceil(S));
  float inf = float(n) + 1.0;
  float dOut = inf, dIn = inf;
  for (int i = -${MAX_OUTLINE}; i <= ${MAX_OUTLINE}; i++) {
    if (i < -n || i > n) continue;
    float a = alphaAt(c + ivec2(i, 0), size);
    float k = abs(float(i));
    if (useOut && a > 0.0) dOut = min(dOut, k + 0.5 - a);
    if (useIn && a < 1.0) dIn = min(dIn, k + 0.5 - (1.0 - a));
  }
  dOut = clamp(dOut, 0.0, inf);
  dIn = clamp(dIn, 0.0, inf);
  outColor = vec4(floor(dOut) / 255.0, fract(dOut), floor(dIn) / 255.0, fract(dIn));
}`

export const OUTLINE_V_FRAG = `${GLSL_HEADER}
uniform sampler2D src, rows, base;
uniform float S, sOut, sIn, soft, round, op;
uniform vec3 c1, c2;
out vec4 outColor;
float ramp(float d, float size) {
  float t = clamp((size + 0.5 - d) / soft, 0.0, 1.0);
  return soft > 1.0 ? t * t * (3.0 - 2.0 * t) : t;
}
void main() {
  ivec2 size = textureSize(src, 0);
  ivec2 c = ivec2(gl_FragCoord.xy);
  int n = int(ceil(S));
  float inf = float(n) + 1.0;
  float dOut = inf, dIn = inf;
  for (int j = -${MAX_OUTLINE}; j <= ${MAX_OUTLINE}; j++) {
    if (j < -n || j > n) continue;
    int y = c.y + j;
    if (y < 0 || y >= size.y) continue;
    vec4 h = texelFetch(rows, ivec2(c.x, y), 0);
    float b = max(0.0, abs(float(j)) - 0.5);
    vec2 a = vec2(h.r * 255.0 + h.g, h.b * 255.0 + h.a);
    vec2 sq = max(a, vec2(b));
    vec2 m = mix(sq, sqrt(a * a + b * b), round);
    dOut = min(dOut, m.x);
    dIn = min(dIn, m.y);
  }
  vec4 layer = texelFetch(src, c, 0);
  vec4 o = vec4(0.0);
  if (sOut > 0.0) {
    float ra = ramp(dOut, sOut);
    o = vec4(mix(c1, c2, min(1.0, dOut / sOut)) * ra, ra);
  }
  o = layer + o * (1.0 - layer.a);
  if (sIn > 0.0 && layer.a > 0.0) {
    float ra = ramp(dIn, sIn) * layer.a;
    o = vec4(mix(c1, c2, min(1.0, dIn / sIn)) * ra, ra) + o * (1.0 - ra);
  }
  // Opacity fades from the drawing (base) to the outlined picture.
  outColor = mix(texelFetch(base, c, 0), o, op);
}`
