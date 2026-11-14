import { balanceLut, curvesLut, gradientLut, type Balance } from './adjust/color'
import * as AS from './adjust/shaders'
import { blendIndex, GLSL_BLEND, type BlendMode } from './blend'
import type { LayerAdjust } from './model'
import type { Filtering } from './brushes'
import type { Rect } from './tiles'

/**
 * The Draw engine on the graphics card (0.31). Layers stay on the GPU as textures while you paint:
 * dabs are drawn straight into a stroke texture, the stroke is coloured and put on a copy of its
 * layer by a shader, the layers are blended only where something changed, and the picture is drawn
 * to the screen with the view's zoom and turn. Nothing is copied through the CPU while painting.
 *
 * Only core WebGL2 with 8-bit RGBA textures is used (no float textures, no vendor extensions), so it
 * runs the same on AMD, Intel and NVIDIA. Every texture is premultiplied, row 0 = the top of the picture.
 * The engine keeps its Canvas 2D copy of each layer up to date after every edit, so a lost GPU never
 * loses paint: it just switches back to Canvas 2D.
 */

export type Tex = { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }

/** One stamp for the GPU (doc pixels): where, how big, turned and squashed, how strong, own colour, distance along the stroke. */
export interface GpuDab {
  x: number
  y: number
  size: number
  rot: number
  sx: number
  sy: number
  alpha: number
  at: number
  color: [number, number, number] | null
}

/** How a brush's dabs look, the same for every dab of a stroke. */
export interface DabLook {
  tip: TexImageSource
  filtering: Filtering
  /** Moving grain baked into each dab (alpha grain canvas), or null. */
  grain: { image: TexImageSource; scale: number; zoom: number; rotation: number; movement: number; filtering: Filtering } | null
}

/** Everything that turns a stroke mask into paint on a layer (colorStroke + compositeStroke on the GPU). */
export interface StrokeLook {
  color: [number, number, number]
  /** Dabs carry their own colour (colour dynamics): the mask's colour is the paint. */
  colored: boolean
  /** Texturized grain: canvas, gray (blended) or alpha (holes), its blend mode, scale and rotation (degrees). */
  grain: { image: TexImageSource; gray: boolean; blend: BlendMode; scale: number; rotation: number; filtering: Filtering } | null
  wetEdges: number
  burntEdges: number
  burntColor: [number, number, number]
  /** Gaussian blur of the mask used by wet and burnt edges (px). */
  edgeBlur: number
  alphaThreshold: number
  /** 3D paint (0 = off). */
  height: number
  opacity: number
  erase: boolean
  alphaLock: boolean
  luminance: boolean
  blend: BlendMode
}

export interface GpuLayer {
  key: string
  /** The layer's pixels; `source`/`version` upload them when they changed on the CPU. */
  tex: Tex
  opacity: number
  blend: BlendMode
  clipTo: string | null
  children?: GpuLayer[]
  mask?: Tex | null
  clipMask?: Tex | null
  clipOpacity?: number
  clipBase?: boolean
  /** An adjustment layer: the picture below, recoloured, is what gets blended. */
  adjust?: LayerAdjust
}

const HEADER = '#version 300 es\nprecision highp float;\n'

/** Full-texture pass. */
const QUAD_VERT = `${HEADER}
in vec2 pos;
out vec2 uv;
void main() { uv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0.0, 1.0); }`

const BLEND_FRAG = `${HEADER}
in vec2 uv;
uniform sampler2D dst, src, clipTex, maskTex, clipMaskTex;
uniform int mode;
uniform float opacity, clipOpacity;
uniform bool useClip, useMask, useClipMask;
const vec3 LUMA = vec3(0.299, 0.587, 0.114);
out vec4 outColor;
${GLSL_BLEND}
void main() {
  vec4 b = texture(dst, uv);
  vec4 s = texture(src, uv);
  float as = s.a * opacity;
  if (useMask) as *= dot(texture(maskTex, uv).rgb, LUMA);
  if (useClip) as *= texture(clipTex, uv).a * clipOpacity * (useClipMask ? dot(texture(clipMaskTex, uv).rgb, LUMA) : 1.0);
  float ab = b.a;
  float ao = as + ab * (1.0 - as);
  vec3 bc = ab > 0.0 ? b.rgb / ab : vec3(0.0);
  vec3 sc = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
  vec3 cs = (1.0 - ab) * sc + ab * clamp(blendColor(mode, bc, sc), 0.0, 1.0);
  outColor = vec4(as * cs + ab * (1.0 - as) * bc, ao);
}`

/** The layer the Layer picker points at, tinted over the picture. */
const TINT_FRAG = `${HEADER}
in vec2 uv;
uniform sampler2D src;
uniform vec3 color;
out vec4 outColor;
void main() { float a = texture(src, uv).a * 0.45; outColor = vec4(color * a, a); }`

const COPY_FRAG = `${HEADER}
in vec2 uv;
uniform sampler2D src;
out vec4 outColor;
void main() { outColor = texture(src, uv); }`

/** The picture on screen: a quad in document pixels, placed by the view matrix. */
const VIEW_VERT = `${HEADER}
in vec2 pos;
uniform vec2 doc;
uniform mat3 toClip;
out vec2 uv;
void main() {
  uv = pos * 0.5 + 0.5;
  vec3 p = toClip * vec3(uv * doc, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`

/** One dab per instance. */
const DAB_VERT = `${HEADER}
layout(location = 0) in vec2 pos;
layout(location = 1) in vec4 a0;
layout(location = 2) in vec4 a1;
layout(location = 3) in vec4 a2;
uniform vec2 size;
out vec2 q;
out float alpha, at, dabSize;
out vec4 col;
void main() {
  vec2 s = pos * 0.5 * a0.z * a1.xy;
  float c = cos(a0.w), n = sin(a0.w);
  vec2 p = a0.xy + vec2(c * s.x - n * s.y, n * s.x + c * s.y);
  q = pos * 0.5 + 0.5;
  alpha = a1.z;
  at = a1.w;
  dabSize = a0.z;
  col = a2;
  gl_Position = vec4(p / size * 2.0 - 1.0, 0.0, 1.0);
}`

const DAB_FRAG = `${HEADER}
in vec2 q;
in float alpha, at, dabSize;
in vec4 col;
uniform sampler2D tip, grain;
uniform bool useGrain;
uniform vec2 grainSize;
uniform float grainScale, grainZoom, grainRot, grainMove;
out vec4 outColor;
void main() {
  float a = texture(tip, q).a * alpha;
  if (useGrain) {
    vec2 p = q * dabSize + vec2(at * (1.0 - grainMove), 0.0);
    float c = cos(-grainRot), n = sin(-grainRot);
    vec2 g = vec2(c * p.x - n * p.y, n * p.x + c * p.y) / (grainScale * mix(1.0, dabSize / 40.0, grainZoom));
    a *= texture(grain, g / grainSize).a;
  }
  vec3 rgb = col.a > 0.5 ? col.rgb : vec3(1.0);
  outColor = vec4(rgb * a, a);
}`

/** Separable blur of a mask's alpha into r (gaussian when sigma > 0, box of `radius` px otherwise). */
const BLUR_FRAG = `${HEADER}
in vec2 uv;
uniform sampler2D src;
uniform vec2 dir;
uniform float sigma;
uniform int radius;
uniform bool alphaIn, rgba;
out vec4 outColor;
void main() {
  float sum = 0.0, wsum = 0.0;
  vec4 all4 = vec4(0.0);
  int n = sigma > 0.0 ? min(48, int(ceil(sigma * 3.0))) : radius;
  float step = sigma > 0.0 ? max(1.0, sigma * 3.0 / float(n)) : 1.0;
  for (int i = -48; i <= 48; i++) {
    if (i < -n || i > n) continue;
    float w = sigma > 0.0 ? exp(-0.5 * pow(float(i) * step / sigma, 2.0)) : 1.0;
    vec4 t = texture(src, uv + dir * float(i) * step);
    sum += (alphaIn ? t.a : t.r) * w;
    all4 += t * w;
    wsum += w;
  }
  outColor = rgba ? all4 / wsum : vec4(sum / wsum, 0.0, 0.0, 1.0);
}`

/** A pixel-aligned piece of a texture: dst pixel p shows src at p + off (transparent outside src), scaled by `zoom`. */
const REGION_FRAG = `${HEADER}
uniform sampler2D src;
uniform vec2 off, srcSize;
uniform float zoom;
out vec4 outColor;
void main() {
  vec2 p = gl_FragCoord.xy * zoom + off;
  outColor = p.x < 0.0 || p.y < 0.0 || p.x > srcSize.x || p.y > srcSize.y ? vec4(0.0) : texture(src, p / srcSize);
}`

/** a × (1 - k) + b × k, pixel by pixel (the wet brush picking up colour). */
const MIX_FRAG = `${HEADER}
uniform sampler2D a, b;
uniform vec2 size;
uniform float k;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / size;
  outColor = texture(a, uv) * (1.0 - k) + texture(b, uv) * k;
}`

/** One wet or smudge stamp on the working copy of the layer (brushWet.ts on the GPU). */
const WET_FRAG = `${HEADER}
uniform sampler2D work, carry, blurred, tip;
uniform vec2 doc, box, carrySize;
uniform float s, k, rot, sx, sy, size, fillA, pull, alpha, grade;
uniform vec3 color;
uniform int mode;
out vec4 outColor;
${GLSL_BLEND}
vec4 over(vec4 s, vec4 b, int m) {
  float ao = s.a + b.a * (1.0 - s.a);
  vec3 bc = b.a > 0.0 ? b.rgb / b.a : vec3(0.0);
  vec3 sc = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
  vec3 cs = (1.0 - b.a) * sc + b.a * clamp(blendColor(m, bc, sc), 0.0, 1.0);
  return vec4(s.a * cs + b.a * (1.0 - s.a) * bc, ao);
}
void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 q = p - box;
  vec2 l = q - s * 0.5;
  float c = cos(-rot), n = sin(-rot);
  vec2 t = vec2(c * l.x - n * l.y, n * l.x + c * l.y) / (vec2(sx, sy) * k) / size + 0.5;
  float ta = t.x < 0.0 || t.y < 0.0 || t.x > 1.0 || t.y > 1.0 ? 0.0 : texture(tip, t).a;
  vec4 w = texture(work, p / doc);
  vec4 cr = texture(carry, q / carrySize);
  if (mode == 0) {
    vec4 paint = vec4(color * fillA, fillA);
    vec4 cp = cr * pull;
    paint = (cp + paint * (1.0 - cp.a)) * ta;
    vec4 o = paint * alpha + w * (1.0 - paint.a * alpha);
    if (grade > 0.0) o = over(paint * alpha * grade * 0.5, o, 2);
    outColor = o;
  } else {
    vec4 paint = (mode == 2 ? texture(blurred, p / doc) : cr) * ta;
    outColor = w * (1.0 - ta * alpha) + paint * alpha;
  }
}`

/** colorStroke + compositeStroke: the stroke mask as paint on the layer below it (dst). */
const APPLY_FRAG = `${HEADER}
in vec2 uv;
uniform sampler2D dst, mask, pred, grain, edges, relief, sel, wet;
uniform vec2 doc, grainSize;
uniform vec3 color, burntColor;
uniform bool colored, usePred, useGrain, grainGray, useSel, erase, alphaLock, luminance, useWet;
uniform int grainMode, mode;
uniform float grainScale, grainRot, wetEdges, burntEdges, threshold, height, opacity;
out vec4 outColor;
${GLSL_BLEND}
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 l) { return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l)); }
vec4 over(vec4 s, vec4 b, int m) {
  float ao = s.a + b.a * (1.0 - s.a);
  vec3 bc = b.a > 0.0 ? b.rgb / b.a : vec3(0.0);
  vec3 sc = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
  vec3 cs = (1.0 - b.a) * sc + b.a * clamp(blendColor(m, bc, sc), 0.0, 1.0);
  return vec4(s.a * cs + b.a * (1.0 - s.a) * bc, ao);
}
float h(vec2 o) { return texture(relief, uv + o / doc).r; }
void main() {
  vec4 d = texture(dst, uv);
  vec4 m = texture(mask, uv);
  if (usePred) { vec4 p = texture(pred, uv); m = m + p * (1.0 - m.a); }
  // Wet paint and smudge: the painted working copy of the layer is the paint.
  vec4 p = useWet ? texture(wet, uv) : colored ? m : vec4(color * m.a, m.a);
  vec2 px = gl_FragCoord.xy;
  if (useGrain && !useWet) {
    float c = cos(-grainRot), n = sin(-grainRot);
    vec2 g = vec2(c * px.x - n * px.y, n * px.x + c * px.y) / grainScale / grainSize;
    vec4 t = texture(grain, g);
    if (grainGray) p = over(t, p, grainMode) * m.a;
    else p *= t.a;
  }
  if (!useWet && (wetEdges > 0.0 || burntEdges > 0.0)) {
    float b = texture(edges, uv).r;
    if (burntEdges > 0.0) p = over(vec4(burntColor, 1.0) * m.a * (1.0 - b) * burntEdges, p, 2);
    if (wetEdges > 0.0) p *= 1.0 - b * wetEdges * 0.6;
  }
  if (threshold > 0.0 && !useWet) {
    float a = p.a >= threshold && p.a > 0.0 ? 1.0 : 0.0;
    p = vec4((p.a > 0.0 ? p.rgb / p.a : vec3(0.0)) * a, a);
  }
  if (height > 0.0 && !erase && p.a > 0.0) {
    // 3D paint, as relief.ts: the blurred stroke coverage is the height, lit from the top left.
    float steep = 3.0 + height * 8.0;
    float dx = (h(vec2(1.0, 0.0)) - h(vec2(-1.0, 0.0))) * steep;
    float dy = (h(vec2(0.0, 1.0)) - h(vec2(0.0, -1.0))) * steep;
    vec3 nrm = normalize(vec3(-dx, -dy, 1.0));
    vec3 L = normalize(vec3(-0.55, -0.6, 0.58));
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float diffuse = clamp(dot(nrm, L) / L.z - 1.0, -0.45, 0.5);
    float cover = min(1.0, m.a * 255.0 / 160.0);
    float spec = pow(max(0.0, dot(nrm, H)), 40.0) * 0.45 * height * cover;
    vec3 c = clamp(p.rgb / p.a * (1.0 + diffuse * 0.8 * height * cover) + spec, 0.0, 1.0);
    p = vec4(c * p.a, p.a);
  }
  float selA = useSel ? texture(sel, uv).a : 1.0;
  p *= selA;
  if (useWet) { outColor = p + d * (1.0 - selA) * (1.0 - p.a); return; }
  if (erase) { outColor = d * (1.0 - p.a * opacity); return; }
  if (luminance) {
    float sa = p.a * opacity;
    float oa = alphaLock ? d.a : sa + d.a * (1.0 - sa);
    if (sa <= 0.0 || oa <= 0.0) { outColor = d; return; }
    float ws = alphaLock ? sa : sa / oa;
    vec3 sc = p.rgb / p.a;
    vec3 dc = d.a > 0.0 ? d.rgb / d.a : vec3(0.0);
    outColor = vec4(toSrgb(toLin(sc) * ws + toLin(dc) * (1.0 - ws)) * oa, oa);
    return;
  }
  vec4 s = p * opacity;
  if (alphaLock) { outColor = vec4(s.rgb * d.a + d.rgb * (1.0 - s.a), d.a); return; }
  outColor = over(s, d, mode);
}`

function compile(gl: WebGL2RenderingContext, vert: string, frag: string) {
  const prog = gl.createProgram()!
  for (const [type, text] of [
    [gl.VERTEX_SHADER, vert],
    [gl.FRAGMENT_SHADER, frag],
  ] as const) {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, text)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader')
    gl.attachShader(prog, sh)
  }
  gl.bindAttribLocation(prog, 0, 'pos')
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link')
  return prog
}

/** Turn off to test the Canvas 2D engine (Settings → Drawing). */
export const gpuAllowed = { value: true }

/** Tests turn this on to run the GPU engine on SwiftShader. */
export const gpuAllowSoftware = { value: false }

/** Software GL drivers paint slower than Canvas 2D, so the engine stays on Canvas 2D there. */
export const isSoftwareGl = (renderer: string) => /llvmpipe|softpipe|swiftshader|software|swrast/i.test(renderer)

type Prog = { prog: WebGLProgram; loc: Map<string, WebGLUniformLocation | null> }

export class GpuPainter {
  /** Shows the picture; the editor puts it under its own overlay canvas. */
  readonly canvas: HTMLCanvasElement
  readonly gl: WebGL2RenderingContext
  readonly width: number
  readonly height: number
  lost = false
  private progs = new Map<string, Prog>()
  private quad: WebGLBuffer
  private dabBuf: WebGLBuffer
  private dabData = new Float32Array(12 * 256)
  /** Images (tips, grains, selection) uploaded once per object. */
  private images = new WeakMap<object, { tex: WebGLTexture; version: number }>()
  /** Two render targets per group depth (0 = the picture), made when first needed. */
  private levels: Tex[][] = []
  private groupTex = new Map<string, Tex>()
  private empty: WebGLTexture
  /** The blended picture; only the changed part is blended again. */
  readonly picture: Tex
  private temps = new Map<string, Tex>()
  private crop: CanvasRenderingContext2D | null = null

  static create(width: number, height: number, colorSpace: PredefinedColorSpace = 'srgb'): GpuPainter | null {
    if (!gpuAllowed.value || typeof document === 'undefined') return null
    try {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false })
      if (!gl) return null
      const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
      if (width > max || height > max) return null
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      if (info && !gpuAllowSoftware.value && isSoftwareGl(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)))) return null
      if (colorSpace !== 'srgb' && 'drawingBufferColorSpace' in gl) {
        gl.drawingBufferColorSpace = colorSpace
        gl.unpackColorSpace = colorSpace
      }
      return new GpuPainter(canvas, gl, width, height)
    } catch {
      return null
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, width: number, height: number) {
    this.canvas = canvas
    this.gl = gl
    this.width = width
    this.height = height
    canvas.className = 'sketch-gpu'
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.lost = true
    })
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    this.dabBuf = gl.createBuffer()!
    this.empty = this.rawTexture(1, 1)
    this.picture = this.target()
    // Compile everything now, so a driver that can't run them falls back to Canvas 2D right away.
    for (const p of ['blend', 'copy', 'view', 'dab', 'blur', 'apply', 'region', 'mix', 'wet']) this.prog(p)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  }

  private prog(name: string): Prog {
    let p = this.progs.get(name)
    if (!p) {
      const [v, f] = {
        blend: [QUAD_VERT, BLEND_FRAG],
        copy: [QUAD_VERT, COPY_FRAG],
        view: [VIEW_VERT, COPY_FRAG],
        tint: [VIEW_VERT, TINT_FRAG],
        dab: [DAB_VERT, DAB_FRAG],
        blur: [QUAD_VERT, BLUR_FRAG],
        apply: [QUAD_VERT, APPLY_FRAG],
        region: [QUAD_VERT, REGION_FRAG],
        mix: [QUAD_VERT, MIX_FRAG],
        wet: [QUAD_VERT, WET_FRAG],
        'adj-hsb': [QUAD_VERT, AS.HSB],
        'adj-lut': [QUAD_VERT, AS.LUT],
      }[name]!
      p = { prog: compile(this.gl, v, f), loc: new Map() }
      this.progs.set(name, p)
    }
    this.gl.useProgram(p.prog)
    return p
  }

  private u(p: Prog, name: string) {
    if (!p.loc.has(name)) p.loc.set(name, this.gl.getUniformLocation(p.prog, name))
    return p.loc.get(name)!
  }

  /** Set uniforms: numbers become floats, booleans ints, arrays vecs; `tex:` binds a texture unit. */
  private set(p: Prog, values: Record<string, number | boolean | number[] | null>) {
    const gl = this.gl
    for (const [k, v] of Object.entries(values)) {
      const l = this.u(p, k)
      if (l === null || v === null) continue
      if (typeof v === 'boolean') gl.uniform1i(l, v ? 1 : 0)
      else if (typeof v === 'number') gl.uniform1f(l, v)
      else if (v.length === 2) gl.uniform2f(l, v[0], v[1])
      else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2])
      else if (v.length === 9) gl.uniformMatrix3fv(l, false, v)
    }
  }

  private seti(p: Prog, name: string, v: number) {
    this.gl.uniform1i(this.u(p, name), v)
  }

  private bind(unit: number, tex: WebGLTexture | null, p: Prog, name: string) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex ?? this.empty)
    this.seti(p, name, unit)
  }

  private rawTexture(w: number, h: number) {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h)
    return tex
  }

  /** A blank document-size texture that can be drawn into. */
  target(w = this.width, h = this.height): Tex {
    const gl = this.gl
    const tex = this.rawTexture(w, h)
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.clearColor(0, 0, 0, 0)
    gl.disable(gl.SCISSOR_TEST)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return { tex, fb, w, h }
  }

  free(t: Tex | null | undefined) {
    if (!t) return
    this.gl.deleteTexture(t.tex)
    this.gl.deleteFramebuffer(t.fb)
  }

  /** A scratch texture by name, made when first needed. */
  temp(name: string, w = this.width, h = this.height): Tex {
    let t = this.temps.get(name)
    if (!t) this.temps.set(name, (t = this.target(w, h)))
    return t
  }

  /** Hand a texture back as a named scratch texture (the old layer texture becomes the next preview). */
  swapTemp(name: string, t: Tex) {
    this.temps.set(name, t)
  }

  private level(depth: number) {
    return (this.levels[depth] ??= [this.target(), this.target()])
  }

  /** Draw into `t` (null = the screen), limited to `r` (document pixels). */
  private into(t: Tex | null, r: Rect | null) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null)
    if (t) gl.viewport(0, 0, t.w, t.h)
    if (r) {
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(r.x, r.y, r.w, r.h)
    } else gl.disable(gl.SCISSOR_TEST)
  }

  private drawQuad() {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  clear(t: Tex, r: Rect | null) {
    const gl = this.gl
    this.into(t, r)
    gl.disable(gl.BLEND)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /** dst = src (inside `r`), or src drawn over dst with a canvas composite operation. */
  copy(src: Tex, dst: Tex, r: Rect | null, op: GlobalCompositeOperation | 'copy' = 'copy') {
    const gl = this.gl
    this.into(dst, r)
    const p = this.prog('copy')
    this.bind(0, src.tex, p, 'src')
    if (op === 'copy') gl.disable(gl.BLEND)
    else {
      gl.enable(gl.BLEND)
      const f = {
        'source-over': [gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
        'destination-in': [gl.ZERO, gl.SRC_ALPHA],
        'destination-out': [gl.ZERO, gl.ONE_MINUS_SRC_ALPHA],
        xor: [gl.ONE_MINUS_DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA],
      }[op as string] ?? [gl.ONE, gl.ONE_MINUS_SRC_ALPHA]
      gl.blendFunc(f[0], f[1])
    }
    this.drawQuad()
    gl.disable(gl.BLEND)
  }

  // ---- Pixels in and out ------------------------------------------------------

  /** Upload a CPU image (a layer's Canvas 2D copy) into `t`, all of it or the part `r`. */
  upload(t: Tex, source: TexImageSource, r?: Rect | null) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, t.tex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    if (!r) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source)
      return
    }
    // Only the changed part: a whole big canvas each pen move is slow where it goes through the CPU (WebKitGTK).
    const c = (this.crop ??= document.createElement('canvas').getContext('2d', { colorSpace: this.gl.unpackColorSpace ?? 'srgb' })!)
    c.canvas.width = r.w
    c.canvas.height = r.h
    c.drawImage(source as CanvasImageSource, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, gl.RGBA, gl.UNSIGNED_BYTE, c.canvas)
  }

  /** Straight-alpha pixels of `r` in `t`, as ImageData for the layer's Canvas 2D copy and undo. */
  read(t: Tex, r: Rect, colorSpace: PredefinedColorSpace = 'srgb'): ImageData {
    const gl = this.gl
    const px = new Uint8Array(r.w * r.h * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
    gl.readPixels(r.x, r.y, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3]
      if (a && a < 255) {
        px[i] = Math.min(255, Math.round((px[i] * 255) / a))
        px[i + 1] = Math.min(255, Math.round((px[i + 1] * 255) / a))
        px[i + 2] = Math.min(255, Math.round((px[i + 2] * 255) / a))
      }
    }
    return new ImageData(new Uint8ClampedArray(px.buffer), r.w, r.h, { colorSpace })
  }

  /** An image (tip, grain, selection) as a texture, uploaded again only when `version` changes. */
  image(src: TexImageSource, filtering: Filtering | 'mask' = 'classic', repeat = false, version = 0): WebGLTexture {
    const gl = this.gl
    // A spare unit, so setting up this texture never replaces one already bound for drawing.
    gl.activeTexture(gl.TEXTURE7)
    let e = this.images.get(src)
    if (!e || e.version !== version) {
      if (e) gl.deleteTexture(e.tex)
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src)
      gl.generateMipmap(gl.TEXTURE_2D)
      this.images.set(src, (e = { tex, version }))
    }
    gl.bindTexture(gl.TEXTURE_2D, e.tex)
    const min = filtering === 'none' || filtering === 'mask' ? gl.NEAREST : filtering === 'improved' ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering === 'none' || filtering === 'mask' ? gl.NEAREST : gl.LINEAR)
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
    return e.tex
  }

  // ---- Dabs ---------------------------------------------------------------------

  /** Draw dabs into `t` (source-over), all with the same look. */
  dabs(t: Tex, look: DabLook, dabs: GpuDab[]) {
    if (!dabs.length) return
    const gl = this.gl
    this.into(t, null)
    const p = this.prog('dab')
    const tip = this.image(look.tip, look.filtering)
    this.bind(0, tip, p, 'tip')
    const g = look.grain
    if (g) {
      this.bind(1, this.image(g.image, g.filtering, true), p, 'grain')
      const gi = g.image as { width: number; height: number }
      this.set(p, { useGrain: true, grainSize: [gi.width, gi.height], grainScale: g.scale, grainZoom: g.zoom, grainRot: (g.rotation * Math.PI) / 180, grainMove: g.movement })
    } else this.set(p, { useGrain: false })
    this.set(p, { size: [this.width, this.height] })
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dabBuf)
    for (let i = 1; i <= 3; i++) {
      gl.enableVertexAttribArray(i)
      gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 48, (i - 1) * 16)
      gl.vertexAttribDivisor(i, 1)
    }
    if (this.dabData.length < dabs.length * 12) this.dabData = new Float32Array(dabs.length * 24)
    const d = this.dabData
    dabs.forEach((b, i) => {
      const o = i * 12
      d[o] = b.x
      d[o + 1] = b.y
      d[o + 2] = b.size
      d[o + 3] = b.rot
      d[o + 4] = b.sx
      d[o + 5] = b.sy
      d[o + 6] = b.alpha
      d[o + 7] = b.at
      d[o + 8] = b.color?.[0] ?? 0
      d[o + 9] = b.color?.[1] ?? 0
      d[o + 10] = b.color?.[2] ?? 0
      d[o + 11] = b.color ? 1 : 0
    })
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, dabs.length * 12), gl.STREAM_DRAW)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, dabs.length)
    for (let i = 1; i <= 3; i++) {
      gl.vertexAttribDivisor(i, 0)
      gl.disableVertexAttribArray(i)
    }
    gl.disable(gl.BLEND)
  }

  // ---- Strokes onto layers --------------------------------------------------------

  /** Blur a mask's alpha (or a blurred value in r) into `out`, inside `r`, horizontally then vertically. */
  private blur(src: Tex, out: Tex, r: Rect, sigma: number, radius = 0) {
    const p = this.prog('blur')
    const mid = this.temp('blurMid')
    this.into(mid, r)
    this.bind(0, src.tex, p, 'src')
    this.set(p, { dir: [1 / this.width, 0], sigma, alphaIn: true, rgba: false })
    this.seti(p, 'radius', radius)
    this.drawQuad()
    this.into(out, r)
    this.bind(0, mid.tex, p, 'src')
    this.set(p, { dir: [0, 1 / this.height], sigma, alphaIn: false, rgba: false })
    this.seti(p, 'radius', radius)
    this.drawQuad()
  }

  /**
   * out = the layer `dst` with the stroke `mask` (and predicted points) painted on, inside `r`.
   * `sel` is the selection mask, if any.
   */
  /** Gaussian blur of all four channels of `src` into `out`, inside `r`. */
  blurRgba(src: Tex, out: Tex, r: Rect, sigma: number) {
    const p = this.prog('blur')
    const mid = this.temp('blurMid')
    for (const [from, to, dir] of [
      [src, mid, [1 / this.width, 0]],
      [mid, out, [0, 1 / this.height]],
    ] as const) {
      this.into(to, r)
      this.gl.disable(this.gl.BLEND)
      this.bind(0, from.tex, p, 'src')
      this.set(p, { dir: [...dir], sigma, alphaIn: false, rgba: true })
      this.seti(p, 'radius', 0)
      this.drawQuad()
    }
  }

  /** dst[0..w) = src at (x, y), `zoom` src pixels per dst pixel (a piece of the layer under a wet stamp). */
  region(src: Tex, dst: Tex, x: number, y: number, w: number, h: number, zoom = 1, over = false) {
    const gl = this.gl
    this.into(dst, { x: 0, y: 0, w, h })
    if (over) {
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    } else gl.disable(gl.BLEND)
    const p = this.prog('region')
    this.bind(0, src.tex, p, 'src')
    // Smooth between pixels when scaled or moved by part of a pixel, like Canvas 2D's drawImage.
    const f = zoom === 1 && Number.isInteger(x) && Number.isInteger(y) ? gl.NEAREST : gl.LINEAR
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f)
    this.set(p, { off: [x, y], srcSize: [src.w, src.h], zoom })
    this.drawQuad()
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.disable(gl.BLEND)
  }

  /** out[0..s) = a × (1 - k) + b × k. */
  mix(a: Tex, b: Tex, out: Tex, s: number, k: number) {
    this.into(out, { x: 0, y: 0, w: s, h: s })
    this.gl.disable(this.gl.BLEND)
    const p = this.prog('mix')
    this.bind(0, a.tex, p, 'a')
    this.bind(1, b.tex, p, 'b')
    this.set(p, { size: [a.w, a.h], k })
    this.drawQuad()
  }

  /** One wet stamp: `work` gets the stamp inside the s×s box at (x0, y0); `spare` is a texture of the same size to draw into. */
  wetStamp(
    work: Tex,
    spare: Tex,
    carry: Tex,
    blurred: Tex | null,
    tip: TexImageSource,
    filtering: Filtering,
    o: { x0: number; y0: number; s: number; k: number; rot: number; sx: number; sy: number; size: number; mode: 0 | 1 | 2; color: [number, number, number]; fillA: number; pull: number; alpha: number; grade: number },
  ) {
    const r = clip({ x: o.x0, y: o.y0, w: o.s, h: o.s }, this.width, this.height)
    if (!r) return
    this.into(spare, r)
    this.gl.disable(this.gl.BLEND)
    const p = this.prog('wet')
    this.bind(0, work.tex, p, 'work')
    this.bind(1, carry.tex, p, 'carry')
    this.bind(2, blurred?.tex ?? null, p, 'blurred')
    this.bind(3, this.image(tip, filtering), p, 'tip')
    this.set(p, { doc: [this.width, this.height], box: [o.x0, o.y0], carrySize: [carry.w, carry.h], s: o.s, k: o.k, rot: o.rot, sx: o.sx, sy: o.sy, size: o.size, fillA: o.fillA, pull: o.pull, alpha: o.alpha, grade: o.grade, color: o.color })
    this.seti(p, 'mode', o.mode)
    this.drawQuad()
    this.copy(spare, work, r)
  }

  applyStroke(dst: Tex, mask: Tex, pred: Tex | null, out: Tex, look: StrokeLook, r: Rect, sel: { image: TexImageSource; version: number } | null, wet: Tex | null = null) {
    const grow = (n: number) => clip({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n }, this.width, this.height)
    const edges = look.wetEdges > 0 || look.burntEdges > 0
    // The blur passes read the stroke texture around the area too.
    let joined = mask
    if (pred && (edges || look.height > 0)) {
      joined = this.temp('joined')
      const big = grow(Math.ceil(look.edgeBlur * 3) + 6)
      if (big) {
        this.copy(mask, joined, big)
        this.copy(pred, joined, big, 'source-over')
      }
    }
    if (edges) {
      const e = grow(Math.ceil(look.edgeBlur * 3) + 2)
      if (e) this.blur(joined, this.temp('edges'), e, look.edgeBlur)
    }
    if (look.height > 0 && !look.erase) {
      const e = grow(8)
      if (e) this.blur(joined, this.temp('relief'), e, 0, Math.round(1 + Math.min(1, look.height) * 3))
    }
    const gl = this.gl
    this.into(out, r)
    gl.disable(gl.BLEND)
    const p = this.prog('apply')
    this.bind(0, dst.tex, p, 'dst')
    this.bind(1, mask.tex, p, 'mask')
    this.bind(2, pred?.tex ?? null, p, 'pred')
    const g = look.grain
    this.bind(3, g ? this.image(g.image, g.filtering, true) : null, p, 'grain')
    this.bind(4, edges ? this.temp('edges').tex : null, p, 'edges')
    this.bind(5, look.height > 0 ? this.temp('relief').tex : null, p, 'relief')
    this.bind(6, sel ? this.image(sel.image, 'mask', false, sel.version) : null, p, 'sel')
    this.bind(7, wet?.tex ?? null, p, 'wet')
    const gi = g?.image as { width: number; height: number } | undefined
    this.set(p, {
      doc: [this.width, this.height],
      color: look.color,
      burntColor: look.burntColor,
      colored: look.colored,
      usePred: !!pred,
      useGrain: !!g,
      grainGray: !!g?.gray,
      grainSize: gi ? [gi.width, gi.height] : [1, 1],
      grainScale: g?.scale ?? 1,
      grainRot: g ? (g.rotation * Math.PI) / 180 : 0,
      useSel: !!sel,
      useWet: !!wet,
      erase: look.erase,
      alphaLock: look.alphaLock,
      luminance: look.luminance && !look.erase,
      wetEdges: look.wetEdges,
      burntEdges: look.burntEdges,
      threshold: look.alphaThreshold,
      height: Math.min(1, look.height),
      opacity: look.opacity,
    })
    this.seti(p, 'grainMode', g ? blendIndex(g.blend) : 0)
    this.seti(p, 'mode', blendIndex(look.blend))
    this.drawQuad()
  }

  // ---- Layers into the picture ---------------------------------------------------

  /** Blend the layers (bottom to top) over the background into `picture`, only inside `r` (null = all). */
  compose(layers: GpuLayer[], background: [number, number, number, number] | null, r: Rect | null) {
    const byKey = new Map<string, GpuLayer>()
    const index = (ls: GpuLayer[]) => ls.forEach((l) => (byKey.set(l.key, l), l.children && index(l.children)))
    index(layers)
    const result = this.composeLevel(layers, 0, background, byKey, r)
    this.copy(result, this.picture, r)
  }

  private composeLevel(layers: GpuLayer[], depth: number, background: [number, number, number, number] | null, byKey: Map<string, GpuLayer>, r: Rect | null): Tex {
    const gl = this.gl
    const targets = this.level(depth)
    let cur = 0
    this.into(targets[cur], r)
    gl.disable(gl.BLEND)
    if (background) gl.clearColor(background[0] * background[3], background[1] * background[3], background[2] * background[3], background[3])
    else gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    for (const layer of layers) {
      const src = layer.children ? this.composeLevel(layer.children, depth + 1, null, byKey, r) : layer.adjust ? this.adjusted(targets[cur], layer.adjust, r) : layer.tex
      if (layer.children && layer.clipBase) this.keepGroup(layer.key, src, r)
      const next = 1 - cur
      this.into(targets[next], r)
      const p = this.prog('blend')
      this.bind(0, targets[cur].tex, p, 'dst')
      this.bind(1, src.tex, p, 'src')
      const clipTo = layer.clipTo ? byKey.get(layer.clipTo) : undefined
      this.bind(2, clipTo ? (clipTo.children ? (this.groupTex.get(clipTo.key)?.tex ?? null) : clipTo.tex.tex) : null, p, 'clipTex')
      this.bind(3, layer.mask?.tex ?? null, p, 'maskTex')
      const clipMask = clipTo && layer.clipMask
      this.bind(4, clipMask ? clipMask.tex : null, p, 'clipMaskTex')
      this.seti(p, 'mode', blendIndex(layer.blend))
      this.set(p, { opacity: layer.opacity, clipOpacity: layer.clipOpacity ?? 1, useClip: !!clipTo, useMask: !!layer.mask, useClipMask: !!clipMask })
      this.drawQuad()
      cur = next
    }
    return targets[cur]
  }

  private luts = new Map<string, WebGLTexture>()

  /** Adjustment layers (adjust/shaders.ts, the same as the Adjustments panel): the picture below, recoloured. */
  private adjusted(below: Tex, a: LayerAdjust, r: Rect | null): Tex {
    const gl = this.gl
    const out = this.temp('adjust')
    this.into(out, r)
    gl.disable(gl.BLEND)
    const v = a.values.v
    if (a.id === 'hsb') {
      const p = this.prog('adj-hsb')
      this.bind(0, below.tex, p, 'src')
      this.set(p, { size: [this.width, this.height], hue: v.hue ?? 0, sat: v.sat ?? 0, bright: v.bright ?? 0 })
    } else {
      const p = this.prog('adj-lut')
      this.bind(0, below.tex, p, 'src')
      const bal = () => Object.fromEntries((['shadows', 'midtones', 'highlights'] as const).map((k) => [k, [0, 1, 2].map((i) => v[`${k}${i}`] ?? 0)])) as Balance
      const t = a.id === 'balance' ? balanceLut(bal()) : a.id === 'curves' ? curvesLut(a.values.curves) : gradientLut(a.values.gradient)
      this.bind(1, this.lut(t), p, 'lut')
      this.set(p, { size: [this.width, this.height], byLuma: a.id === 'gradient' ? 1 : 0, keepLum: a.id === 'balance' ? (v.keep ?? 0) : 0, amount: a.id === 'gradient' ? (v.amount ?? 1) : 1 })
    }
    this.drawQuad()
    return out
  }

  /** A 256×1 lookup table texture, made once per table. */
  private lut(t: [Uint8Array, Uint8Array, Uint8Array]): WebGLTexture {
    const key = `${t[0]}|${t[1]}|${t[2]}`
    let tex = this.luts.get(key)
    if (!tex) {
      const gl = this.gl
      const px = new Uint8Array(256 * 4)
      for (let i = 0; i < 256; i++) px.set([t[0][i], t[1][i], t[2][i], 255], i * 4)
      gl.activeTexture(gl.TEXTURE7)
      tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      if (this.luts.size > 32) this.luts.clear()
      this.luts.set(key, tex)
    }
    return tex
  }

  /** Keep a group's blended result, so layers clipped to it can use it after the group's targets are reused. */
  private keepGroup(key: string, src: Tex, r: Rect | null) {
    let t = this.groupTex.get(key)
    if (!t) this.groupTex.set(key, (t = this.target()))
    this.copy(src, t, r)
  }

  /** Forget kept group results of groups that are gone. */
  pruneGroups(keep: Set<string>) {
    for (const [k, t] of this.groupTex)
      if (!keep.has(k)) {
        this.free(t)
        this.groupTex.delete(k)
      }
  }

  /** One pixel of the picture, straight RGBA 0..255. */
  pixel(x: number, y: number): [number, number, number, number] {
    const d = this.read(this.picture, { x: Math.floor(x), y: Math.floor(y), w: 1, h: 1 }).data
    return [d[0], d[1], d[2], d[3]]
  }

  // ---- The screen -------------------------------------------------------------------

  /**
   * Show the picture: `m` is the view matrix in CSS pixels (as for ctx.transform), `w`×`h` the
   * element's CSS size. Smooth when zoomed out or turned, pixel-sharp when zoomed in.
   */
  present(m: [number, number, number, number, number, number], w: number, h: number, dpr: number, smooth: boolean, tint: { tex: Tex; color: [number, number, number] } | null = null) {
    const gl = this.gl
    const cw = Math.max(1, Math.round(w * dpr))
    const ch = Math.max(1, Math.round(h * dpr))
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw
      this.canvas.height = ch
      this.canvas.style.width = `${w}px`
      this.canvas.style.height = `${h}px`
    }
    this.into(null, null)
    gl.viewport(0, 0, cw, ch)
    gl.disable(gl.BLEND)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const p = this.prog('view')
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.picture.tex)
    const f = smooth ? gl.LINEAR : gl.NEAREST
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f)
    this.seti(p, 'src', 0)
    // Document pixels → CSS pixels (m) → device pixels → clip space (y up).
    const [a, b, c, d, e, ff] = m
    const sx = (2 * dpr) / cw
    const sy = (-2 * dpr) / ch
    const toClip = [a * sx, b * sy, 0, c * sx, d * sy, 0, e * sx - 1, ff * sy + 1, 1]
    this.set(p, { doc: [this.width, this.height], toClip })
    this.drawQuad()
    if (tint) {
      const t = this.prog('tint')
      this.bind(0, tint.tex.tex, t, 'src')
      this.set(t, { doc: [this.width, this.height], toClip, color: tint.color })
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      this.drawQuad()
      gl.disable(gl.BLEND)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.picture.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  }

  /** Stop drawing: frees the GPU memory right away instead of waiting for the garbage collector. */
  destroy() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

/** The part of `r` inside a w×h picture, in whole pixels; null when nothing is left. */
export function clip(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(w, Math.ceil(r.x + r.w))
  const y1 = Math.min(h, Math.ceil(r.y + r.h))
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

/** '#rrggbb' to 0..1 RGB. */
export function rgb(color: string): [number, number, number] {
  const h = color.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const n = parseInt(full, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * A stroke texture that brush stamps go into (the GPU twin of the stamper's Canvas 2D canvases).
 * Dabs are batched and drawn in one call per frame; `changed` collects where it changed.
 */
export class GpuSurface {
  readonly canvas: { width: number; height: number }
  look: DabLook | null = null
  private batch: GpuDab[] = []
  /** Where it changed since the engine last took it (document pixels). */
  changed: Rect | null = null
  readonly painter: GpuPainter
  readonly t: Tex
  constructor(painter: GpuPainter, t: Tex) {
    this.painter = painter
    this.t = t
    this.canvas = { width: t.w, height: t.h }
  }

  /** Note that `r` changed (stamps drawn somewhere else, e.g. on the wet working copy). */
  mark(r: Rect) {
    const c = this.changed
    if (!c) this.changed = { ...r }
    else {
      const x1 = Math.max(c.x + c.w, r.x + r.w)
      const y1 = Math.max(c.y + c.h, r.y + r.h)
      c.x = Math.min(c.x, r.x)
      c.y = Math.min(c.y, r.y)
      c.w = x1 - c.x
      c.h = y1 - c.y
    }
  }

  takeChanged(): Rect | null {
    this.flush()
    const c = this.changed
    this.changed = null
    return c && clip(c, this.t.w, this.t.h)
  }

  dab(d: GpuDab) {
    this.batch.push(d)
    const r = d.size * 0.75 + 2
    this.mark({ x: d.x - r, y: d.y - r, w: 2 * r, h: 2 * r })
    if (this.batch.length >= 4096) this.flush()
  }

  flush() {
    if (!this.batch.length || !this.look) return
    this.painter.dabs(this.t, this.look, this.batch)
    this.batch = []
  }

  clearRect(x: number, y: number, w: number, h: number) {
    this.flush()
    const r = clip({ x, y, w, h }, this.t.w, this.t.h)
    if (!r) return
    this.painter.clear(this.t, r)
    this.mark(r)
  }

  /** A blank surface of the same size (one per role, reused between strokes). */
  like(role: string): GpuSurface {
    const s = new GpuSurface(this.painter, this.painter.temp(role))
    this.painter.clear(s.t, null)
    return s
  }

  /** This = main + tail, then `second` (dual brush) with its operation, inside `r`. */
  assemble(r: Rect, main: GpuSurface, tail: GpuSurface | null, second: GpuSurface | null, op: GlobalCompositeOperation) {
    main.flush()
    tail?.flush()
    second?.flush()
    const p = this.painter
    p.clear(this.t, r)
    p.copy(main.t, this.t, r, 'source-over')
    if (tail) p.copy(tail.t, this.t, r, 'source-over')
    if (second) p.copy(second.t, this.t, r, op)
    this.mark(r)
  }
}
