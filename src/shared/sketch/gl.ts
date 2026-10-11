import { blendIndex, GLSL_BLEND, type BlendMode } from './blend'

/**
 * GPU compositor (Sketch Pro): uploads each layer once per change and blends the
 * stack in WebGL2 with every blend mode. Returns null when WebGL2 is missing or the
 * canvas is bigger than the GPU's textures; the engine then composites in Canvas 2D.
 */

export interface GlLayer {
  /** Pixels of the layer (straight alpha, as Canvas 2D keeps them). */
  source: HTMLCanvasElement
  /** Changes whenever the pixels changed, so unchanged layers are not uploaded again. */
  version: number
  key: string
  opacity: number
  blend: BlendMode
  /** Key of the layer whose alpha clips this one, or null. */
  clipTo: string | null
  /** A group: these layers are blended together first, then the result like one layer (`source` is ignored). */
  children?: GlLayer[]
  /** Layer mask: its brightness times its alpha scales this layer's alpha. */
  mask?: GlSource | null
  /** The clipping base's own mask, so clipped layers follow it too. */
  clipMask?: GlSource | null
  /** The clipping base's opacity (0 when it is hidden): clipped layers fade with it (v0.13). */
  clipOpacity?: number
  /** Set on a group that layers clip to: its blended result is kept as their clipping texture (v0.13). */
  clipBase?: boolean
}

/** Pixels the compositor keeps as a texture. */
export type GlSource = Pick<GlLayer, 'source' | 'version' | 'key'>

const VERT = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() { uv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D dst;
uniform sampler2D src;
uniform sampler2D clipTex;
uniform sampler2D maskTex;
uniform sampler2D clipMaskTex;
uniform int mode;
uniform float opacity;
uniform float clipOpacity;
uniform bool useClip;
uniform bool useMask;
uniform bool useClipMask;
// Mask brightness on premultiplied pixels = brightness x alpha.
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
  vec3 co = as * cs + ab * (1.0 - as) * bc;
  outColor = vec4(co, ao);
}`

const COPY = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D src;
out vec4 outColor;
void main() { outColor = texture(src, uv); }`

function compile(gl: WebGL2RenderingContext, vert: string, frag: string) {
  const prog = gl.createProgram()!
  for (const [type, text] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]] as const) {
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

/** Turn off to test the Canvas 2D path (Settings could expose this later). */
export const glAllowed = { value: true }

export class GlCompositor {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private blendProg: WebGLProgram
  private copyProg: WebGLProgram
  private textures = new Map<string, { tex: WebGLTexture; version: number }>()
  /** Two render targets per group depth (0 = the picture), made when first needed. */
  private levels: { tex: WebGLTexture; fb: WebGLFramebuffer }[][] = []
  private empty: WebGLTexture
  /** Blended results of groups that other layers clip to. */
  private groupTex = new Map<string, { tex: WebGLTexture; fb: WebGLFramebuffer }>()
  lost = false

  static create(width: number, height: number, colorSpace: PredefinedColorSpace = 'srgb'): GlCompositor | null {
    if (!glAllowed.value || typeof document === 'undefined') return null
    try {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false })
      if (!gl) return null
      // Display P3 canvases keep their wider colours through the GPU (where the browser supports it).
      if (colorSpace !== 'srgb' && 'drawingBufferColorSpace' in gl) {
        gl.drawingBufferColorSpace = colorSpace
        gl.unpackColorSpace = colorSpace
      }
      const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
      if (width > max || height > max) return null
      return new GlCompositor(canvas, gl)
    } catch {
      return null
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas
    this.gl = gl
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      this.lost = true
    })
    this.blendProg = compile(gl, VERT, FRAG)
    this.copyProg = compile(gl, VERT, COPY)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.level(0)
    this.empty = this.texture()
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  }

  private texture() {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  private level(depth: number) {
    const gl = this.gl
    return (this.levels[depth] ??= [0, 1].map(() => {
      const tex = this.texture()
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const fb = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      return { tex, fb }
    }))
  }

  private upload(layer: GlSource): WebGLTexture {
    const gl = this.gl
    let t = this.textures.get(layer.key)
    if (!t) {
      t = { tex: this.texture(), version: -1 }
      this.textures.set(layer.key, t)
    }
    if (t.version !== layer.version) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, layer.source)
      t.version = layer.version
    }
    return t.tex
  }

  /** Forget textures of layers that are gone. */
  prune(keep: Set<string>) {
    for (const [k, t] of this.textures)
      if (!keep.has(k)) {
        this.gl.deleteTexture(t.tex)
        this.textures.delete(k)
      }
  }

  /** Blend the layers (bottom to top) over the background and show the result on `canvas`. */
  render(layers: GlLayer[], background: [number, number, number, number] | null): HTMLCanvasElement {
    const gl = this.gl
    const byKey = new Map<string, GlLayer>()
    const index = (ls: GlLayer[]) => ls.forEach((l) => (byKey.set(l.key, l), l.children && index(l.children)))
    index(layers)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.disable(gl.BLEND)
    const result = this.compose(layers, 0, background, byKey)
    // Draw the result to the visible canvas (textures were uploaded flipped, so it comes out upright).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(this.copyProg)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, result)
    gl.uniform1i(gl.getUniformLocation(this.copyProg, 'src'), 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return this.canvas
  }

  /** Blend layers into the targets of one group depth; groups are blended on the next depth first. */
  private compose(layers: GlLayer[], depth: number, background: [number, number, number, number] | null, byKey: Map<string, GlLayer>): WebGLTexture {
    const gl = this.gl
    const targets = this.level(depth)
    let cur = 0
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets[cur].fb)
    if (background) gl.clearColor(background[0] * background[3], background[1] * background[3], background[2] * background[3], background[3])
    else gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const loc = (n: string) => gl.getUniformLocation(this.blendProg, n)
    for (const layer of layers) {
      const src = layer.children ? this.compose(layer.children, depth + 1, null, byKey) : this.upload(layer)
      if (layer.children && layer.clipBase) this.keepGroup(layer.key, src)
      gl.useProgram(this.blendProg)
      gl.uniform1i(loc('dst'), 0)
      gl.uniform1i(loc('src'), 1)
      gl.uniform1i(loc('clipTex'), 2)
      gl.uniform1i(loc('maskTex'), 3)
      gl.uniform1i(loc('clipMaskTex'), 4)
      const next = 1 - cur
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[next].fb)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, targets[cur].tex)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, src)
      const clip = layer.clipTo ? byKey.get(layer.clipTo) : undefined
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, clip ? (clip.children ? (this.groupTex.get(clip.key)?.tex ?? this.empty) : this.upload(clip)) : this.empty)
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, layer.mask ? this.upload(layer.mask) : this.empty)
      const clipMask = clip && layer.clipMask
      gl.activeTexture(gl.TEXTURE4)
      gl.bindTexture(gl.TEXTURE_2D, clipMask ? this.upload(clipMask) : this.empty)
      gl.uniform1i(loc('mode'), blendIndex(layer.blend))
      gl.uniform1f(loc('opacity'), layer.opacity)
      gl.uniform1f(loc('clipOpacity'), layer.clipOpacity ?? 1)
      gl.uniform1i(loc('useClip'), clip ? 1 : 0)
      gl.uniform1i(loc('useMask'), layer.mask ? 1 : 0)
      gl.uniform1i(loc('useClipMask'), clipMask ? 1 : 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      cur = next
    }
    return targets[cur].tex
  }

  /** Copy a group's blended result into its own texture, so layers clipped to it can use it after the group's targets are reused. */
  private keepGroup(key: string, src: WebGLTexture) {
    const gl = this.gl
    let t = this.groupTex.get(key)
    if (!t) {
      const tex = this.texture()
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.canvas.width, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const fb = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      this.groupTex.set(key, (t = { tex, fb }))
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
    gl.useProgram(this.copyProg)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    gl.uniform1i(gl.getUniformLocation(this.copyProg, 'src'), 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /** One pixel of the last render, straight RGBA 0..255 (y from the top). */
  readPixel(x: number, y: number): [number, number, number, number] {
    const gl = this.gl
    const px = new Uint8Array(4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(Math.floor(x), this.canvas.height - 1 - Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    const a = px[3]
    if (!a) return [0, 0, 0, 0]
    return [Math.round((px[0] * 255) / a), Math.round((px[1] * 255) / a), Math.round((px[2] * 255) / a), a]
  }
}

/** '#rrggbb' to straight RGBA 0..1. */
export function parseHex(color: string): [number, number, number, number] {
  const h = color.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const n = parseInt(full, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1]
}
