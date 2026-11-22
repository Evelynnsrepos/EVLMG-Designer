import { mapPoint, type Box, type Pt, type Turn, type XfState } from './transform'

/**
 * Rotate object as a 3D model (no AI, like Illustrator's Inflate / Extrude & Bevel): the drawing's
 * outline gets a height from how far each spot is from the edge, so it becomes a puffy or extruded
 * shape with the drawing on its front and, mirrored, on its back. Turned in 3D and drawn on the GPU
 * with depth, so nearer parts hide farther ones. Hidden sides are guessed: the edge colour is
 * stretched around the sides and the back shows the front mirrored.
 */

export interface Shape3d {
  /** Thickness, 0 (flat card) .. 1 (as thick as half the picture). */
  thick: number
  /** 0 straight sides (extruded), 1 fully round (inflated like a pillow). */
  round: number
  /** Shading from a light at the top left, 0 none .. 1 strong. */
  light: number
}

/** How far each grid cell is from the outline (in cells), and which cells hold paint. */
export interface DepthField {
  gw: number
  gh: number
  dist: Float32Array
  paint: Uint8Array
  max: number
}

/** Distance from the outline for a grid over the lifted pixels (`alpha(x, y)` 0..255), at most `cells` across. */
export function depthField(alpha: (x: number, y: number) => number, src: Box, cells = 128): DepthField {
  const step = Math.max(1, Math.max(src.w, src.h) / cells)
  const gw = Math.max(1, Math.ceil(src.w / step))
  const gh = Math.max(1, Math.ceil(src.h / step))
  const paint = new Uint8Array(gw * gh)
  const inside = new Uint8Array(gw * gh)
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      // Any paint in the cell (a few samples) keeps it in the mesh; mostly solid counts as inside.
      let any = 0
      let solid = 0
      for (let b = 0; b < 3; b++)
        for (let a = 0; a < 3; a++) {
          const v = alpha(Math.min(src.x + src.w - 1, Math.floor(src.x + (i + (a + 0.5) / 3) * step)), Math.min(src.y + src.h - 1, Math.floor(src.y + (j + (b + 0.5) / 3) * step)))
          if (v > 8) any++
          if (v > 100) solid++
        }
      paint[j * gw + i] = any ? 1 : 0
      inside[j * gw + i] = solid >= 5 ? 1 : 0
    }
  // Two-pass chamfer distance to the nearest outside cell.
  const INF = 1e9
  const d = new Float32Array(gw * gh)
  for (let k = 0; k < d.length; k++) d[k] = inside[k] ? INF : 0
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= gw || j >= gh ? 0 : d[j * gw + i])
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i
      if (d[k]) d[k] = Math.min(d[k], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + 1.414, at(i + 1, j - 1) + 1.414)
    }
  let max = 0
  for (let j = gh - 1; j >= 0; j--)
    for (let i = gw - 1; i >= 0; i--) {
      const k = j * gw + i
      if (d[k]) d[k] = Math.min(d[k], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + 1.414, at(i - 1, j + 1) + 1.414)
      max = Math.max(max, d[k])
    }
  return { gw, gh, dist: d, paint, max: Math.max(1, max) }
}

/** Height (0..1 of the full thickness) at a distance `t` (0 at the edge, 1 deepest inside). */
export function profile(t: number, round: number): number {
  const pillow = Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, t)) ** 2))
  // Straight sides rise over the first eighth of the way in, then stay flat.
  const box = Math.min(1, t * 8)
  return box + (pillow - box) * round
}

/** Rotation (X, then Y, then Z, like turn3d) as a column-major 3×3 matrix. */
export function rotation(t: Turn): number[] {
  const r = Math.PI / 180
  const [sx, cx, sy, cy, sz, cz] = [Math.sin(t.x * r), Math.cos(t.x * r), Math.sin(t.y * r), Math.cos(t.y * r), Math.sin(t.z * r), Math.cos(t.z * r)]
  const rot = (x: number, y: number, z: number) => {
    ;[y, z] = [y * cx - z * sx, y * sx + z * cx]
    ;[x, z] = [x * cy + z * sy, -x * sy + z * cy]
    ;[x, y] = [x * cz - y * sz, x * sz + y * cz]
    return [x, y, z]
  }
  return [...rot(1, 0, 0), ...rot(0, 1, 0), ...rot(0, 0, 1)]
}

/** The model: per vertex x, y, z (canvas px around the centre), u, v (0..1 of the source), normal x, y, z. */
export function buildModel(base: XfState, field: DepthField, shape: Shape3d): { verts: Float32Array; centre: Pt; size: number } {
  const { gw, gh, dist, paint, max } = field
  const centre = mapPoint(base, 0.5, 0.5)
  const a = mapPoint(base, 0, 0)
  const b = mapPoint(base, 1, 1)
  const size = Math.max(Math.hypot(b.x - a.x, b.y - a.y) / Math.SQRT2, 1)
  const thick = shape.thick * size * 0.5
  // Height at each grid corner: the mean of the cells around it.
  const H = new Float32Array((gw + 1) * (gh + 1))
  for (let j = 0; j <= gh; j++)
    for (let i = 0; i <= gw; i++) {
      let s = 0
      for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const ci = i + di
        const cj = j + dj
        if (ci >= 0 && cj >= 0 && ci < gw && cj < gh) s += dist[cj * gw + ci]
      }
      H[j * (gw + 1) + i] = (s / 4 / max) > 0 ? profile(s / 4 / max, shape.round) * thick : 0
    }
  const P: Pt[] = []
  for (let j = 0; j <= gh; j++) for (let i = 0; i <= gw; i++) P.push(mapPoint(base, i / gw, j / gh))
  const h = (i: number, j: number) => H[Math.min(gh, Math.max(0, j)) * (gw + 1) + Math.min(gw, Math.max(0, i))]
  const cells: number[] = []
  for (let k = 0; k < gw * gh; k++) if (paint[k]) cells.push(k)
  const verts = new Float32Array(cells.length * 2 * 6 * 8)
  let o = 0
  const put = (i: number, j: number, side: 1 | -1) => {
    const p = P[j * (gw + 1) + i]
    const z = h(i, j)
    // Slope of the height over the canvas (cell size in px along each axis).
    const dx = Math.hypot(P[j * (gw + 1) + Math.min(gw, i + 1)].x - P[j * (gw + 1) + Math.max(0, i - 1)].x, P[j * (gw + 1) + Math.min(gw, i + 1)].y - P[j * (gw + 1) + Math.max(0, i - 1)].y) || 1
    const dy = Math.hypot(P[Math.min(gh, j + 1) * (gw + 1) + i].x - P[Math.max(0, j - 1) * (gw + 1) + i].x, P[Math.min(gh, j + 1) * (gw + 1) + i].y - P[Math.max(0, j - 1) * (gw + 1) + i].y) || 1
    const gx = (h(i + 1, j) - h(i - 1, j)) / dx
    const gy = (h(i, j + 1) - h(i, j - 1)) / dy
    const l = Math.hypot(gx, gy, 1)
    verts.set([p.x - centre.x, p.y - centre.y, z * side, i / gw, j / gh, (-gx / l) * side, (-gy / l) * side, side / l], o)
    o += 8
  }
  for (const side of [1, -1] as const)
    for (const k of cells) {
      const i = k % gw
      const j = (k - i) / gw
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 0], [1, 1], [0, 1]]) put(i + di, j + dj, side)
    }
  return { verts, centre, size }
}

const VERT = `#version 300 es
in vec3 pos;
in vec2 uv;
in vec3 nrm;
uniform mat3 rot;
uniform vec2 centre, canvas;
uniform float focal, size;
out vec2 vuv;
out vec3 vn;
void main() {
  vec3 p = rot * pos;
  float k = focal / max(focal * 0.1, focal - p.z);
  vec2 s = centre + p.xy * k;
  vuv = uv;
  vn = rot * nrm;
  gl_Position = vec4(s.x / canvas.x * 2.0 - 1.0, 1.0 - s.y / canvas.y * 2.0, clamp(-p.z / (size * 4.0), -1.0, 1.0), 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 vuv;
in vec3 vn;
uniform sampler2D src;
uniform vec4 box;
uniform vec2 texSize;
uniform float light;
out vec4 o;
void main() {
  vec4 c = texture(src, (box.xy + vuv * box.zw) / texSize);
  if (c.a < 0.03) discard;
  vec3 n = normalize(vn);
  // Light from the top left, a little in front.
  float d = max(dot(n, normalize(vec3(-0.45, -0.6, 0.66))), 0.0);
  float shade = mix(1.0, 0.35 + 0.85 * d, light);
  o = vec4(c.rgb * shade, c.a);
}`

/** One WebGL2 canvas (document size) that draws the model. */
export class ModelRenderer {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private buf: WebGLBuffer
  private tex: WebGLTexture
  private texSize = [1, 1]

  /** Null without WebGL2 (then Rotate object stays a flat card). */
  static create(): ModelRenderer | null {
    try {
      const c = document.createElement('canvas')
      const gl = c.getContext('webgl2', { premultipliedAlpha: true, antialias: true, depth: true })
      return gl ? new ModelRenderer(c, gl) : null
    } catch {
      return null
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas
    this.gl = gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG))
    gl.bindAttribLocation(p, 0, 'pos')
    gl.bindAttribLocation(p, 1, 'uv')
    gl.bindAttribLocation(p, 2, 'nrm')
    gl.linkProgram(p)
    this.prog = p
    this.buf = gl.createBuffer()!
    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
  }

  /** The picture the model is painted with (the lifted pixels, or the selection mask). */
  upload(src: HTMLCanvasElement) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src)
    this.texSize = [src.width, src.height]
  }

  /** Draw the model turned by `t` into this canvas (w × h, the document size). */
  draw(model: ReturnType<typeof buildModel>, src: Box, t: Turn, light: number, w: number, h: number) {
    const gl = this.gl
    if (this.canvas.width !== w || this.canvas.height !== h) [this.canvas.width, this.canvas.height] = [w, h]
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clearDepth(1)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)
    gl.disable(gl.BLEND)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.useProgram(this.prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, model.verts, gl.DYNAMIC_DRAW)
    const stride = 8 * 4
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 20)
    const u = (n: string) => gl.getUniformLocation(this.prog, n)
    gl.uniformMatrix3fv(u('rot'), false, rotation(t))
    gl.uniform2f(u('centre'), model.centre.x, model.centre.y)
    gl.uniform2f(u('canvas'), w, h)
    gl.uniform1f(u('focal'), model.size * (1 + 20 * (1 - t.depth) ** 2))
    gl.uniform1f(u('size'), model.size)
    gl.uniform4f(u('box'), src.x, src.y, src.w, src.h)
    gl.uniform2f(u('texSize'), this.texSize[0], this.texSize[1])
    gl.uniform1f(u('light'), light)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.uniform1i(u('src'), 0)
    gl.drawArrays(gl.TRIANGLES, 0, model.verts.length / 8)
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
