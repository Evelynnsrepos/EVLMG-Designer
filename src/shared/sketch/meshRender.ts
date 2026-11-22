import { buildMesh, curved, type XfState } from './transform'

/**
 * Draws lifted pixels through a transform mesh (Sketch Pro) with nearest, bilinear or
 * bicubic sampling, on the GPU; without WebGL2 it falls back to Canvas 2D triangles.
 */

export type Interpolation = 'nearest' | 'bilinear' | 'bicubic'

const VERT = `#version 300 es
in vec2 pos;
in vec2 uv;
uniform vec2 size;
out vec2 vuv;
void main() { vuv = uv; gl_Position = vec4(pos.x / size.x * 2.0 - 1.0, 1.0 - pos.y / size.y * 2.0, 0.0, 1.0); }`

/** Shared with the Draw engine's GPU path (gpuPaint.ts), which draws the same mesh in its own context. */
export const MESH_FRAG = `#version 300 es
precision highp float;
in vec2 vuv;
uniform sampler2D src;
uniform vec4 box; // source rectangle in texels: x, y, w, h
uniform int mode; // 0 nearest, 1 bilinear, 2 bicubic
out vec4 outColor;
vec4 texel(ivec2 p) {
  ivec2 s = textureSize(src, 0);
  // Outside the source rectangle is empty, so edges fade cleanly.
  if (p.x < int(box.x) || p.y < int(box.y) || p.x >= int(box.x + box.z) || p.y >= int(box.y + box.w)) return vec4(0.0);
  return texelFetch(src, clamp(p, ivec2(0), s - 1), 0);
}
vec4 cubicW(float t) {
  // Catmull-Rom weights.
  float t2 = t * t, t3 = t2 * t;
  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}
void main() {
  vec2 p = box.xy + vuv * box.zw - 0.5;
  if (mode == 0) { outColor = texel(ivec2(floor(p + 0.5))); return; }
  vec2 i = floor(p);
  vec2 f = p - i;
  ivec2 b = ivec2(i);
  if (mode == 1) {
    outColor = mix(mix(texel(b), texel(b + ivec2(1, 0)), f.x), mix(texel(b + ivec2(0, 1)), texel(b + ivec2(1, 1)), f.x), f.y);
    return;
  }
  vec4 wx = cubicW(f.x), wy = cubicW(f.y);
  vec4 c = vec4(0.0);
  for (int y = 0; y < 4; y++) {
    vec4 row = wx.x * texel(b + ivec2(-1, y - 1)) + wx.y * texel(b + ivec2(0, y - 1)) + wx.z * texel(b + ivec2(1, y - 1)) + wx.w * texel(b + ivec2(2, y - 1));
    c += wy[y] * row;
  }
  // Premultiplied: colour never exceeds alpha.
  c.a = clamp(c.a, 0.0, 1.0);
  outColor = vec4(clamp(c.rgb, 0.0, c.a), c.a);
}`

let gl: { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; prog: WebGLProgram; tex: WebGLTexture; pos: WebGLBuffer; uv: WebGLBuffer } | null | undefined

function setup(): typeof gl {
  if (gl !== undefined) return gl
  try {
    const canvas = document.createElement('canvas')
    const g = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false })
    if (!g) return (gl = null)
    const prog = g.createProgram()!
    for (const [type, text] of [[g.VERTEX_SHADER, VERT], [g.FRAGMENT_SHADER, MESH_FRAG]] as const) {
      const sh = g.createShader(type)!
      g.shaderSource(sh, text)
      g.compileShader(sh)
      if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(sh) ?? 'shader')
      g.attachShader(prog, sh)
    }
    g.bindAttribLocation(prog, 0, 'pos')
    g.bindAttribLocation(prog, 1, 'uv')
    g.linkProgram(prog)
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error('link')
    const tex = g.createTexture()!
    g.bindTexture(g.TEXTURE_2D, tex)
    for (const p of [g.TEXTURE_MIN_FILTER, g.TEXTURE_MAG_FILTER]) g.texParameteri(g.TEXTURE_2D, p, g.NEAREST)
    for (const p of [g.TEXTURE_WRAP_S, g.TEXTURE_WRAP_T]) g.texParameteri(g.TEXTURE_2D, p, g.CLAMP_TO_EDGE)
    return (gl = { canvas, gl: g, prog, tex, pos: g.createBuffer()!, uv: g.createBuffer()! })
  } catch {
    return (gl = null)
  }
}

/** Turn off to test the Canvas 2D path. */
export const meshGlAllowed = { value: true }

/**
 * Draw `src` (document-size canvas holding the lifted pixels) through the transform into `out`
 * (cleared first). `uploaded` skips re-uploading the same source while dragging.
 */
export function renderMesh(src: HTMLCanvasElement, s: XfState, out: CanvasRenderingContext2D, mode: Interpolation, upload = true) {
  const W = out.canvas.width
  const H = out.canvas.height
  out.save()
  out.setTransform(1, 0, 0, 1, 0, 0)
  out.globalCompositeOperation = 'source-over'
  out.globalAlpha = 1
  out.clearRect(0, 0, W, H)
  const g = meshGlAllowed.value ? setup() : null
  if (g) {
    const c = g.gl
    if (g.canvas.width !== W || g.canvas.height !== H) {
      g.canvas.width = W
      g.canvas.height = H
    }
    c.viewport(0, 0, W, H)
    c.clearColor(0, 0, 0, 0)
    c.clear(c.COLOR_BUFFER_BIT)
    c.useProgram(g.prog)
    c.activeTexture(c.TEXTURE0)
    c.bindTexture(c.TEXTURE_2D, g.tex)
    if (upload) {
      c.pixelStorei(c.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      c.pixelStorei(c.UNPACK_FLIP_Y_WEBGL, false)
      c.texImage2D(c.TEXTURE_2D, 0, c.RGBA8, c.RGBA, c.UNSIGNED_BYTE, src)
    }
    const mesh = buildMesh(s, curved(s) ? 32 : 16)
    c.bindBuffer(c.ARRAY_BUFFER, g.pos)
    c.bufferData(c.ARRAY_BUFFER, mesh.pos, c.DYNAMIC_DRAW)
    c.enableVertexAttribArray(0)
    c.vertexAttribPointer(0, 2, c.FLOAT, false, 0, 0)
    c.bindBuffer(c.ARRAY_BUFFER, g.uv)
    c.bufferData(c.ARRAY_BUFFER, mesh.uv, c.DYNAMIC_DRAW)
    c.enableVertexAttribArray(1)
    c.vertexAttribPointer(1, 2, c.FLOAT, false, 0, 0)
    const loc = (n: string) => c.getUniformLocation(g.prog, n)
    c.uniform1i(loc('src'), 0)
    c.uniform2f(loc('size'), W, H)
    c.uniform4f(loc('box'), s.src.x, s.src.y, s.src.w, s.src.h)
    c.uniform1i(loc('mode'), mode === 'nearest' ? 0 : mode === 'bilinear' ? 1 : 2)
    c.disable(c.BLEND)
    c.drawArrays(c.TRIANGLES, 0, mesh.pos.length / 2)
    out.drawImage(g.canvas, 0, 0)
  } else drawTriangles(src, s, out, mode)
  out.restore()
}

/** Canvas 2D fallback: each mesh triangle drawn with its own affine transform. */
function drawTriangles(src: HTMLCanvasElement, s: XfState, out: CanvasRenderingContext2D, mode: Interpolation) {
  const mesh = buildMesh(s, curved(s) ? 16 : 8)
  out.imageSmoothingEnabled = mode !== 'nearest'
  out.imageSmoothingQuality = mode === 'bicubic' ? 'high' : 'low'
  const { x: bx, y: by, w: bw, h: bh } = s.src
  for (let k = 0; k < mesh.pos.length; k += 6) {
    const [x0, y0, x1, y1, x2, y2] = mesh.pos.subarray(k, k + 6)
    const [u0, v0, u1, v1, u2, v2] = [...mesh.uv.subarray(k, k + 6)].map((t, i) => (i % 2 ? by + t * bh : bx + t * bw))
    const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)
    if (!den) continue
    const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / den
    const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / den
    const c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / den
    const d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / den
    out.save()
    out.beginPath()
    // Grow each triangle a hair so neighbours leave no seams.
    const cx = (x0 + x1 + x2) / 3
    const cy = (y0 + y1 + y2) / 3
    const grow = (x: number, y: number): [number, number] => {
      const l = Math.hypot(x - cx, y - cy) || 1
      return [x + ((x - cx) / l) * 0.6, y + ((y - cy) / l) * 0.6]
    }
    out.moveTo(...grow(x0, y0))
    out.lineTo(...grow(x1, y1))
    out.lineTo(...grow(x2, y2))
    out.closePath()
    out.clip()
    out.setTransform(a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0)
    out.drawImage(src, bx, by, bw, bh, bx, by, bw, bh)
    out.restore()
  }
}
