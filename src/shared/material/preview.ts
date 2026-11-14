// EXPERIMENTAL: Material Lab is work in progress (docs/MATERIAL-LAB.md).
// The big Material Lab preview: a lit ball, a 3×3 tiled floor or a pixel-art tile, drawn from a material's maps.
import { MAPS, type MapKey } from './material'
import { VERTEX } from './render'

export type PreviewShape = 'ball' | 'tiled' | 'pixel'

export interface Light {
  name: string
  /** Direction towards the light (x right, y up, z towards the viewer). */
  dir: [number, number, number]
  color: [number, number, number]
  ambient: [number, number, number]
}

export const LIGHTS: Light[] = [
  { name: 'Studio', dir: [-0.5, 0.6, 0.7], color: [3, 3, 3], ambient: [0.35, 0.35, 0.38] },
  { name: 'Sunny day', dir: [0.4, 0.8, 0.45], color: [4, 3.7, 3.2], ambient: [0.3, 0.4, 0.55] },
  { name: 'Overcast', dir: [0, 1, 0.35], color: [1.3, 1.3, 1.35], ambient: [0.6, 0.62, 0.65] },
  { name: 'Dungeon torch', dir: [-0.75, 0.2, 0.65], color: [3.2, 1.8, 0.8], ambient: [0.04, 0.035, 0.03] },
  { name: 'Night', dir: [0.4, 0.7, 0.45], color: [0.5, 0.65, 1.1], ambient: [0.04, 0.06, 0.11] },
]

export interface PreviewOptions {
  shape: PreviewShape
  light: Light
  /** Turn of the ball in radians (left/right, up/down). */
  yaw: number
  pitch: number
  zoom: number
  tint: [number, number, number]
  metallic: number
  roughness: number
  normal: number
  ao: number
  emission: number
  /** Show one map on its own instead of the lit material. */
  only: MapKey | null
}

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D t_albedo, t_metallic, t_roughness, t_emission, t_normal, t_ao, t_depth;
uniform vec2 size;
uniform int shape, only;
uniform float yaw, pitch, zoom, metallic, roughness, nstrength, aostrength, emission;
uniform vec3 tint, ldir, lcol, amb;
out vec4 o;
const float PI = 3.14159265359;

vec3 srgbToLinear(vec3 c) { return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, lessThan(c, vec3(0.04045))); }

vec3 shade(vec2 uv, vec3 T, vec3 B, vec3 N, vec3 V) {
  vec3 albedo = tint * srgbToLinear(texture(t_albedo, uv).rgb);
  float metal = clamp(metallic * texture(t_metallic, uv).r, 0.0, 1.0);
  float rough = clamp(roughness * texture(t_roughness, uv).r, 0.04, 1.0);
  float ao = clamp(mix(1.0, texture(t_ao, uv).r, aostrength), 0.0, 1.0);
  vec3 emis = emission * srgbToLinear(texture(t_emission, uv).rgb);
  vec3 tn = texture(t_normal, uv).rgb * 2.0 - 1.0;
  vec3 n = normalize(T * tn.x * nstrength + B * tn.y * nstrength + N * max(tn.z, 0.05));
  vec3 L = normalize(ldir), H = normalize(L + V);
  float ndl = max(dot(n, L), 0.0), ndv = max(dot(n, V), 1e-3), ndh = max(dot(n, H), 0.0);
  float a = rough * rough, a2 = a * a;
  float d = a2 / (PI * pow(ndh * ndh * (a2 - 1.0) + 1.0, 2.0));
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float g = ndl / (ndl * (1.0 - k) + k) * ndv / (ndv * (1.0 - k) + k);
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 f = f0 + (1.0 - f0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  vec3 spec = d * g * f / (4.0 * ndl * ndv + 1e-4);
  vec3 diff = (1.0 - f) * (1.0 - metal) * albedo / PI;
  // cheap surroundings: the ambient colour lights the colour, and shiny metal reflects it
  vec3 env = amb * ao * (albedo * (1.0 - metal) + f0 * (1.0 - rough * 0.7));
  return (diff + spec) * lcol * ndl * ao + env + emis;
}

vec3 raw(vec2 uv) {
  if (only == 0) return texture(t_albedo, uv).rgb;
  if (only == 1) return texture(t_metallic, uv).rrr;
  if (only == 2) return texture(t_roughness, uv).rrr;
  if (only == 3) return texture(t_emission, uv).rgb;
  if (only == 4) return texture(t_normal, uv).rgb;
  if (only == 5) return texture(t_ao, uv).rrr;
  return texture(t_depth, uv).rrr;
}

void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - size) / min(size.x, size.y);
  vec3 c;
  if (shape == 0) {
    // a ball of radius 1 seen from the front; its texture wraps twice around and once top to bottom
    vec3 ro = vec3(p / zoom * 1.25, 3.0), rd = vec3(0.0, 0.0, -1.0);
    float b = dot(ro, rd), h = b * b - dot(ro, ro) + 1.0;
    if (h < 0.0) { o = vec4(0.0); return; }
    vec3 w = ro + rd * (-b - sqrt(h));
    mat3 ry = mat3(cos(yaw), 0.0, sin(yaw), 0.0, 1.0, 0.0, -sin(yaw), 0.0, cos(yaw));
    mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(pitch), -sin(pitch), 0.0, sin(pitch), cos(pitch));
    mat3 r = rx * ry;
    vec3 q = transpose(r) * w;
    vec2 uv = vec2(atan(q.z, q.x) / PI, acos(clamp(q.y, -1.0, 1.0)) / PI);
    vec3 T = r * normalize(vec3(-q.z, 0.0, q.x) + 1e-5);
    vec3 N = normalize(w);
    vec3 B = normalize(cross(N, T));
    // texture rows grow downwards, so "up" in the normal map is towards the top of the ball
    c = only >= 0 ? raw(uv) : shade(uv, T, B, N, vec3(0.0, 0.0, 1.0));
  } else {
    // a flat square facing the viewer: 3×3 tiles show seams, one hard-pixel tile shows the pixel-art look
    vec2 uv = vec2(p.x, -p.y) * 0.5 / zoom + 0.5;
    if (shape == 1) uv *= 3.0;
    else {
      if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) { o = vec4(0.0); return; }
      uv = (floor(uv * 64.0) + 0.5) / 64.0;
    }
    c = only >= 0 ? raw(uv) : shade(uv, vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0), vec3(0.0, 0.0, 1.0));
  }
  if (only < 0) {
    c = c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14); // filmic curve, keeps bright light from clipping
    c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  }
  o = vec4(c, 1.0);
}
`

export class MaterialPreview {
  readonly gl: WebGL2RenderingContext
  private program: WebGLProgram
  private textures: Record<string, WebGLTexture> = {}
  private loc = (n: string) => this.gl.getUniformLocation(this.program, n)

  readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'preview shader')
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAGMENT))
    gl.bindAttribLocation(p, 0, 'p')
    gl.linkProgram(p)
    this.program = p
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.bindVertexArray(gl.createVertexArray())
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.useProgram(p)
    MAPS.forEach((m, i) => {
      const t = gl.createTexture()!
      this.textures[m.key] = t
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.uniform1i(this.loc(`t_${m.key}`), i)
      this.upload(m.key, null, 1)
    })
  }

  /** Puts one map on the GPU; null = the map's empty value. Pixels are RGBA floats, row 0 at the top. */
  upload(key: MapKey, pixels: Float32Array | null, size: number) {
    const gl = this.gl
    const m = MAPS.find(m => m.key === key)!
    const s = pixels ? size : 1
    // 8 bits are plenty for looking at, and can have mipmaps on every GPU
    const data = Uint8ClampedArray.from(pixels ?? [...m.fallback, 1], v => v * 255 + 0.5)
    gl.activeTexture(gl.TEXTURE0 + MAPS.indexOf(m))
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, s, s, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  }

  draw(o: PreviewOptions) {
    const { gl, canvas } = this
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform2f(this.loc('size'), canvas.width, canvas.height)
    gl.uniform1i(this.loc('shape'), ['ball', 'tiled', 'pixel'].indexOf(o.shape))
    gl.uniform1i(this.loc('only'), o.only ? MAPS.findIndex(m => m.key === o.only) : -1)
    gl.uniform1f(this.loc('yaw'), o.yaw)
    gl.uniform1f(this.loc('pitch'), o.pitch)
    gl.uniform1f(this.loc('zoom'), o.zoom)
    gl.uniform1f(this.loc('metallic'), o.metallic)
    gl.uniform1f(this.loc('roughness'), o.roughness)
    gl.uniform1f(this.loc('nstrength'), o.normal)
    gl.uniform1f(this.loc('aostrength'), o.ao)
    gl.uniform1f(this.loc('emission'), o.emission)
    gl.uniform3fv(this.loc('tint'), o.tint)
    gl.uniform3fv(this.loc('ldir'), o.light.dir)
    gl.uniform3fv(this.loc('lcol'), o.light.color)
    gl.uniform3fv(this.loc('amb'), o.light.ambient)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose() {
    for (const t of Object.values(this.textures)) this.gl.deleteTexture(t)
    this.gl.deleteProgram(this.program)
  }
}
