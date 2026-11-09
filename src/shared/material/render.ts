// Material Lab renderer: runs the GLSL from gen.ts on the GPU with WebGL2.
// Buffers become render passes into their own textures; everything else is stitched into one shader per pass.
import { godotToGlsl } from './godot'
import { type Gen, GenBuffer, GenContext, GenIterateBuffer, type ShaderCode, type Uniform } from './gen'

// Material Maker's general-purpose shader functions (addons/material_maker/shader_functions.tres, MIT).
const COMMON = `float dot2(vec2 x) {
	return dot(x, x);
}
float rand(vec2 x) {
    return fract(cos(mod(dot(x, vec2(13.9898, 8.141)), 3.14)) * 43758.5);
}
vec2 rand2(vec2 x) {
    return fract(cos(mod(vec2(dot(x, vec2(13.9898, 8.141)), dot(x, vec2(3.4562, 17.398))), vec2(3.14, 3.14))) * 43758.5);
}
vec3 rand3(vec2 x) {
    return fract(cos(mod(vec3(dot(x, vec2(13.9898, 8.141)), dot(x, vec2(3.4562, 17.398)), dot(x, vec2(13.254, 5.867))), vec3(3.14, 3.14, 3.14))) * 43758.5);
}
vec3 rand3_4d(vec4 x) {
    return fract(cos(mod(vec3(dot(x, vec4(13.9898, 8.141, 3.4562, 17.398)), dot(x + 0.1234, vec4(3.4562, 17.398, 13.254, 5.867)), dot(x + 0.5678, vec4(11.1357, 23.234, 95.346, 9.123))), vec3(3.14))) * 43758.5);
}
vec3 rgb2hsv(vec3 c) {
	vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
	vec4 p = c.g < c.b ? vec4(c.bg, K.wz) : vec4(c.gb, K.xy);
	vec4 q = c.r < p.x ? vec4(p.xyw, c.r) : vec4(c.r, p.yzx);
	float d = q.x - min(q.w, q.y);
	float e = 1.0e-10;
	return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
float param_rnd(float minimum, float maximum, float seed) {
	return minimum+(maximum-minimum)*rand(vec2(seed));
}
float param_rndi(float minimum, float maximum, float seed) {
	return floor(param_rnd(minimum, maximum + 1.0, seed));
}
`

// How an output with no colour of its own is shown (Material Maker's preview_<type>.gdshader).
const PREVIEW: Record<string, string> = {
  sdf2d: `vec4 preview_2d(vec2 uv) {
	float _seed_variation_ = variation;
	vec4 _controlled_variation_ = vec4(0.0);
	$(code)
	float d = $(value);
	vec3 col = vec3(clamp(6.0*cos(d*64.0)-5.0, 0.0, 1.0));
	col *= clamp(1.0-d*d, 0.0, 1.0);
	col *= vec3(1.0, vec2(step(-0.015, d)));
	col *= vec3(vec2(step(d, 0.015)), 1.0);
	return vec4(col, 1.0);
}
`,
  fill: `vec4 preview_2d(vec2 uv) {
	float _seed_variation_ = variation;
	vec4 _controlled_variation_ = vec4(0.0);
	$(code)
	return vec4(sign(dot($(value),vec4(1.0)))*(vec3(0.1)+0.9*fract(vec3(3456.765, 6523.12, 2373.987)*$(value).rgb+2341.876*$(value).aaa)), 1.0);
}
`,
}

export const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`

/** A complete WebGL2 fragment shader for one pass. Throws when the output can't be shown as a picture. */
export function fragmentSource(code: ShaderCode): string {
  let defs = code.defs
  let body = code.code
  let rgba = code.outputValues.rgba
  if (rgba === undefined) {
    const preview = PREVIEW[code.outputType]
    if (!preview) throw new Error(`Can't show a ${code.outputType || 'missing'} output as a picture`)
    defs += preview.replace('$(code)', body).replaceAll('$(value)', code.outputValues[code.outputType])
    body = ''
    rgba = 'preview_2d(uv)'
  }
  const uniforms = code.uniforms.map(u => `uniform ${u.type} ${u.name}${u.size ? `[${u.size}]` : ''};\n`).join('')
  const main = `
uniform float mm_chunk_size;
uniform vec2 mm_chunk_offset;
uniform vec2 mm_size;
out vec4 mm_out;
void main() {
float _seed_variation_ = variation;
vec4 _controlled_variation_ = vec4(0.0);
vec2 uv = mm_chunk_offset+mm_chunk_size*(gl_FragCoord.xy/mm_size);
${body}
mm_out = ${rgba};
}
`
  const src = `${uniforms}\n${defs}\n${main}`
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
// Godot shader built-ins
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
uniform float elapsed_time;
uniform float variation;
${COMMON}
${godotToGlsl(removeConstants(code.globalsString(src)) + '\n' + src)}`
}

// Godot has PI and TAU built in, and some nodes declare them again.
const removeConstants = (s: string) => s.replace(/const\s+float\s+(PI|TAU)\s*=.*?;/g, '')

interface Program {
  program: WebGLProgram
  locations: Map<string, WebGLUniformLocation | null>
}

export interface RenderResult {
  size: number
  /** RGBA, row 0 at the top of the picture (Material Maker's uv.y = 0). */
  pixels: Float32Array
}

export class MaterialRenderer {
  readonly gl: WebGL2RenderingContext
  /** False when the GPU can't render to 16-bit float textures; everything then runs in 8 bits. */
  readonly floatTextures: boolean
  private programs = new Map<string, Program>()
  private textures = new Map<string, { key: string; texture: WebGLTexture }>()
  /** Largest buffer texture, for quick previews: buffers asking for more render at this size. */
  bufferLimit = Infinity
  /** Most rounds an iterate buffer runs, for quick previews. */
  iterationLimit = Infinity
  private vao: WebGLVertexArrayObject
  private fbo: WebGLFramebuffer

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas = new OffscreenCanvas(1, 1)) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    this.floatTextures = gl.getExtension('EXT_color_buffer_float') !== null
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.fbo = gl.createFramebuffer()!
  }

  /** Compiles a pass, or throws with the GPU's error message. Programs are kept by their source. */
  compile(fragment: string): Program {
    const cached = this.programs.get(fragment)
    if (cached) return cached
    const gl = this.gl
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s) ?? ''
        gl.deleteShader(s)
        throw new ShaderError(log, src)
      }
      return s
    }
    const program = gl.createProgram()!
    const vs = shader(gl.VERTEX_SHADER, VERTEX)
    const fs = shader(gl.FRAGMENT_SHADER, fragment)
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.bindAttribLocation(program, 0, 'p')
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new ShaderError(gl.getProgramInfoLog(program) ?? '', fragment)
    const p = { program, locations: new Map() }
    this.programs.set(fragment, p)
    return p
  }

  /** Renders output `output` of `gen` as a size × size picture. */
  render(gen: Gen, output: number, size: number): RenderResult {
    const producers = new Map<string, GenBuffer | GenIterateBuffer>()
    let top: Gen = gen
    while (top.parent) top = top.parent
    for (const b of top.buffers()) {
      if (b instanceof GenBuffer) producers.set(b.textureName, b)
      else if (b instanceof GenIterateBuffer) producers.set(b.outputTexture, b)
    }
    const code = gen.getShaderCode('uv', output, new GenContext())
    const target = this.newTexture(size)
    this.pass(code, size, target, producers, new Map())
    const pixels = this.read(target, size)
    this.gl.deleteTexture(target)
    return { size, pixels }
  }

  /** Draws one pass into `target`. Returns a key that changes whenever the result could change. */
  private pass(code: ShaderCode, size: number, target: WebGLTexture, producers: Map<string, GenBuffer | GenIterateBuffer>, overrides: Map<string, { key: string; texture: WebGLTexture }>): string {
    const gl = this.gl
    const fragment = fragmentSource(code)
    const prog = this.compile(fragment)
    // fill every buffer this pass samples first
    const inputs = new Map<string, { key: string; texture: WebGLTexture }>()
    for (const u of code.uniforms) {
      if (u.type !== 'sampler2D') continue
      const name = String(u.value)
      const t = overrides.get(name) ?? this.bufferTexture(name, producers)
      if (t) inputs.set(u.name, t)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0)
    gl.viewport(0, 0, size, size)
    gl.useProgram(prog.program)
    const loc = (n: string) => {
      if (!prog.locations.has(n)) prog.locations.set(n, gl.getUniformLocation(prog.program, n))
      return prog.locations.get(n) ?? null
    }
    gl.uniform1f(loc('mm_chunk_size'), 1)
    gl.uniform2f(loc('mm_chunk_offset'), 0, 0)
    gl.uniform2f(loc('mm_size'), size, size)
    gl.uniform1f(loc('variation'), 0)
    gl.uniform1f(loc('elapsed_time'), 0)
    let unit = 0
    for (const u of code.uniforms) setUniform(gl, loc(u.name), u, () => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, inputs.get(u.name)?.texture ?? null)
      return unit++
    })
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    for (let i = 0; i < unit; i++) {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, target)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.bindTexture(gl.TEXTURE_2D, null)
    const values = code.uniforms.filter(u => u.type !== 'sampler2D').map(u => u.value)
    return `${fragment}|${JSON.stringify(values)}|${[...inputs.values()].map(t => t.key).join('|')}`
  }

  /** The texture a buffer node fills, re-rendered only when its shader, values or inputs changed. */
  private bufferTexture(name: string, producers: Map<string, GenBuffer | GenIterateBuffer>): { key: string; texture: WebGLTexture } | null {
    const gen = producers.get(name)
    if (!gen) return null
    const size = Math.min(gen.size(), this.bufferLimit)
    const scratch = this.newTexture(size)
    let key: string
    if (gen instanceof GenBuffer) key = this.pass(gen.sourceCode(), size, scratch, producers, new Map())
    else {
      gen.iteration = 0
      key = this.pass(gen.sourceCode(0), size, scratch, producers, new Map())
      let current = scratch
      let spare = this.newTexture(size)
      const iterations = Math.min(this.iterationLimit, Math.max(0, Math.trunc(+gen.getParameter('iterations'))))
      for (let i = 1; i <= iterations; i++) {
        gen.iteration = i
        // the loop input's key names the pass, not the whole chain, so keys stay short
        const loopKey = this.pass(gen.sourceCode(1), size, spare, producers, new Map([[gen.loopTexture, { key: `loop${i}`, texture: current }]]))
        if (i === iterations) key += '|' + loopKey
        ;[current, spare] = [spare, current]
      }
      gen.iteration = 0
      this.gl.deleteTexture(spare)
      if (current !== scratch) {
        this.gl.deleteTexture(scratch)
        return this.keep(name, key, current)
      }
    }
    return this.keep(name, key, scratch)
  }

  private keep(name: string, key: string, texture: WebGLTexture) {
    const old = this.textures.get(name)
    if (old && old.key === key) {
      this.gl.deleteTexture(texture)
      return old
    }
    if (old) this.gl.deleteTexture(old.texture)
    const entry = { key, texture }
    this.textures.set(name, entry)
    return entry
  }

  private newTexture(size: number): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    const levels = Math.floor(Math.log2(size)) + 1
    gl.texStorage2D(gl.TEXTURE_2D, levels, this.floatTextures ? gl.RGBA16F : gl.RGBA8, size, size)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.bindTexture(gl.TEXTURE_2D, null)
    return t
  }

  private read(texture: WebGLTexture, size: number): Float32Array {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    let out: Float32Array
    if (this.floatTextures) {
      out = new Float32Array(size * size * 4)
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, out)
    } else {
      const bytes = new Uint8Array(size * size * 4)
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
      out = Float32Array.from(bytes, b => b / 255)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return out
  }

  dispose() {
    const gl = this.gl
    for (const p of this.programs.values()) gl.deleteProgram(p.program)
    for (const t of this.textures.values()) gl.deleteTexture(t.texture)
    this.programs.clear()
    this.textures.clear()
  }
}

export class ShaderError extends Error {
  readonly log: string
  readonly source: string
  constructor(log: string, source: string) {
    super(log.trim().split('\n')[0] || 'Shader failed to compile')
    this.log = log
    this.source = source
  }
}

function setUniform(gl: WebGL2RenderingContext, loc: WebGLUniformLocation | null, u: Uniform, bindTexture: () => number) {
  if (u.type === 'sampler2D') {
    const unit = bindTexture()
    if (loc) gl.uniform1i(loc, unit)
    return
  }
  if (!loc) return
  const v = u.value
  if (u.type === 'float') {
    if (Array.isArray(v)) gl.uniform1fv(loc, v)
    else gl.uniform1f(loc, +v)
  }
  else if (u.type === 'int') gl.uniform1i(loc, Math.trunc(+v))
  else if (u.type === 'vec2') gl.uniform2fv(loc, v as number[])
  else if (u.type === 'vec4') gl.uniform4fv(loc, v as number[])
}

/** Converts a render to 8-bit RGBA for an ImageData or a PNG. */
export function toBytes(r: RenderResult): Uint8ClampedArray {
  return Uint8ClampedArray.from(r.pixels, v => v * 255 + 0.5)
}
