import { glAllowed } from '../gl'
import { balanceLut, curvesLut, gradientLut, type Balance } from './color'
import type { AdjustValues, FilterId } from './filters'
import * as S from './shaders'

/**
 * Runs Adjustments and Liquify on the GPU (WebGL2) for a live preview. One per
 * adjustment session: the layer is uploaded once, then every slider change
 * re-renders into `canvas`. `create` returns null without WebGL2; callers then
 * use the CPU versions in cpu.ts.
 */

type Uniform = number | [number, number]
type Target = { tex: WebGLTexture; fb: WebGLFramebuffer }

export class AdjustGl {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private progs = new Map<string, WebGLProgram>()
  private source: WebGLTexture
  private lut: WebGLTexture
  private field: WebGLTexture | null = null
  private targets: Target[]
  private w: number
  private h: number

  static create(width: number, height: number): AdjustGl | null {
    if (!glAllowed.value || typeof document === 'undefined') return null
    try {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false })
      if (!gl) return null
      const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
      if (width > max || height > max) return null
      return new AdjustGl(canvas, gl)
    } catch {
      return null
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas
    this.gl = gl
    this.w = canvas.width
    this.h = canvas.height
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.source = this.texture(gl.LINEAR)
    this.lut = this.texture(gl.NEAREST)
    this.targets = [0, 1, 2].map(() => {
      const tex = this.texture(gl.LINEAR)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const fb = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      return { tex, fb }
    })
  }

  private texture(filter: number) {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  private program(frag: string) {
    let p = this.progs.get(frag)
    if (p) return p
    const gl = this.gl
    p = gl.createProgram()!
    for (const [type, text] of [
      [gl.VERTEX_SHADER, S.VERT],
      [gl.FRAGMENT_SHADER, frag],
    ] as const) {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, text)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader')
      gl.attachShader(p, sh)
    }
    gl.bindAttribLocation(p, 0, 'pos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
    this.progs.set(frag, p)
    return p
  }

  /** The layer's pixels (straight alpha canvas); premultiplied on upload. */
  setSource(img: TexImageSource) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.source)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img)
  }

  /**
   * One shader pass from `input` (plus extra textures on units 1, 2) into target `out`
   * (null = the visible canvas through the upright copy).
   */
  private pass(frag: string, input: WebGLTexture, out: number | null, uniforms: Record<string, Uniform> = {}, extra: Record<string, WebGLTexture> = {}) {
    const gl = this.gl
    const p = this.program(frag)
    gl.useProgram(p)
    gl.bindFramebuffer(gl.FRAMEBUFFER, out === null ? null : this.targets[out].fb)
    gl.viewport(0, 0, this.w, this.h)
    gl.disable(gl.BLEND)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, input)
    gl.uniform1i(gl.getUniformLocation(p, 'src'), 0)
    Object.entries(extra).forEach(([name, tex], i) => {
      gl.activeTexture(gl.TEXTURE1 + i)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(gl.getUniformLocation(p, name), 1 + i)
    })
    gl.uniform2f(gl.getUniformLocation(p, 'size'), this.w, this.h)
    for (const [k, v] of Object.entries(uniforms)) {
      const loc = gl.getUniformLocation(p, k)
      if (typeof v === 'number') gl.uniform1f(loc, v)
      else gl.uniform2f(loc, v[0], v[1])
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  private setLut(t: [Uint8Array, Uint8Array, Uint8Array]) {
    const gl = this.gl
    const px = new Uint8Array(256 * 4)
    for (let i = 0; i < 256; i++) px.set([t[0][i], t[1][i], t[2][i], 255], i * 4)
    gl.bindTexture(gl.TEXTURE_2D, this.lut)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px)
  }

  /** Two-pass Gaussian blur of `input` into target `out` (uses target 2 in between). */
  private blur(input: WebGLTexture, out: number, sigma: number) {
    this.pass(S.GAUSS, input, 2, { dir: [1, 0], sigma })
    this.pass(S.GAUSS, this.targets[2].tex, out, { dir: [0, 1], sigma })
  }

  /** Render an adjustment of the source into `canvas`. */
  run(id: FilterId, a: AdjustValues): HTMLCanvasElement {
    const v = a.v
    const src = this.source
    const T = this.targets
    // Most adjustments render into target 0, then it is copied to the canvas.
    switch (id) {
      case 'hsb':
        this.pass(S.HSB, src, 0, { hue: v.hue, sat: v.sat, bright: v.bright })
        break
      case 'balance': {
        const bal = Object.fromEntries((['shadows', 'midtones', 'highlights'] as const).map((r) => [r, [0, 1, 2].map((i) => v[`${r}${i}`] ?? 0)])) as Balance
        this.setLut(balanceLut(bal))
        this.pass(S.LUT, src, 0, { byLuma: 0, keepLum: v.keep, amount: 1 }, { lut: this.lut })
        break
      }
      case 'curves':
        this.setLut(curvesLut(a.curves))
        this.pass(S.LUT, src, 0, { byLuma: 0, keepLum: 0, amount: 1 }, { lut: this.lut })
        break
      case 'gradient':
        this.setLut(gradientLut(a.gradient))
        this.pass(S.LUT, src, 0, { byLuma: 1, keepLum: 0, amount: v.amount }, { lut: this.lut })
        break
      case 'valueAlpha':
        this.pass(S.VALUE_ALPHA, src, 0, { mode: v.mode, amount: v.amount })
        break
      case 'gaussian':
        this.blur(src, 0, v.radius / 2)
        break
      case 'motion': {
        const r = (v.angle * Math.PI) / 180
        this.pass(S.MOTION, src, 0, { dir: [Math.cos(r), Math.sin(r)], len: v.length })
        break
      }
      case 'perspective':
        this.pass(S.ZOOM, src, 0, { center: [a.center.x, a.center.y], amount: v.amount })
        break
      case 'noise':
        this.pass(S.NOISE, src, 0, { amount: v.amount, scale: v.scale, octaves: v.octaves, kind: v.kind, seed: a.seed })
        break
      case 'sharpen':
        this.blur(src, 1, 1.5)
        this.pass(S.SHARPEN, src, 0, { amount: v.amount }, { blur: T[1].tex })
        break
      case 'bloom':
        this.pass(S.BRIGHT, src, 1, { threshold: v.threshold })
        this.blur(T[1].tex, 1, v.size / 2)
        this.pass(S.GLOW, src, 0, { amount: v.amount }, { blur: T[1].tex })
        break
      case 'glitch':
        this.pass(S.GLITCH, src, 0, { kind: v.kind, amount: v.amount, seed: a.seed })
        break
      case 'halftone':
        this.pass(S.HALFTONE, src, 0, { mode: v.mode, cell: v.size })
        break
      case 'chromatic':
        this.pass(S.CHROMA, src, 0, { mode: v.mode, amount: v.amount, angle: (v.angle * Math.PI) / 180, center: [a.center.x, a.center.y] })
        break
    }
    this.pass(S.PRESENT, T[0].tex, null)
    return this.canvas
  }

  /** Liquify: warp the source by a displacement field (2 floats per node, a node every `cell` pixels). */
  warp(field: Float32Array, fw: number, fh: number, cell: number, amount: number): HTMLCanvasElement {
    const gl = this.gl
    if (!this.field) this.field = this.texture(gl.NEAREST)
    gl.bindTexture(gl.TEXTURE_2D, this.field)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, fw, fh, 0, gl.RG, gl.FLOAT, field)
    this.pass(S.WARP, this.source, 0, { cellSize: cell, amount }, { field: this.field })
    this.pass(S.PRESENT, this.targets[0].tex, null)
    return this.canvas
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
