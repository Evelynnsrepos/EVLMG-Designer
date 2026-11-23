import { mapPoint, type Box, type Pt, type Turn, type XfState } from './transform'

/**
 * Rotate object as a 3D model (no AI, like Illustrator's Inflate / Extrude & Bevel): the drawing's
 * outline gets a height from how far each spot is from the edge, so it becomes a puffy or extruded
 * shape with the drawing on its front and, mirrored, on its back. Turned in 3D and drawn on the GPU
 * with depth, so nearer parts hide farther ones. Hidden sides are guessed: the edge colour is
 * stretched around the sides and the back shows the front mirrored.
 */

export interface Shape3d {
  /** Thickness, 0 (flat card) .. 1 (the widest part becomes round like a tube; thin parts stay thin). */
  thick: number
  /** How the edge rises over `bevel`: 0 a straight slope, 1 a round curve. */
  round: number
  /** Edge width, 0..1 of the way in: near 0 is cut out with straight sides, 1 is puffed all the way (a pillow). */
  bevel: number
  /** Shading strength, 0 none .. 1 strong. */
  light: number
  /** Where the light comes from on screen, in degrees (0 right, 90 below, 225 top left). */
  lightAngle: number
  /** Light colour (#rrggbb); it tints the shading. */
  lightColor: string
  /** What the back shows: the front mirrored, one colour, or another layer (painted as seen from behind). */
  back: { mode: 'mirror' | 'color' | 'layer'; color: string; layerId: string | null }
}

export const SHAPE_DEFAULT: Shape3d = { thick: 0.6, round: 1, bevel: 1, light: 0.5, lightAngle: 225, lightColor: '#ffffff', back: { mode: 'mirror', color: '#808080', layerId: null } }

/** How far each grid cell is from the outline (in cells), and which cells hold paint. */
export interface DepthField {
  gw: number
  gh: number
  dist: Float32Array
  paint: Uint8Array
  max: number
  /** The picture's alpha and the box the grid covers, so the outline can be followed finer than the grid. */
  alpha?: (x: number, y: number) => number
  src?: Box
  /** Filled in by vertexDepth. */
  vdepth?: { d: Float32Array; max: number }
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
  return { gw, gh, dist: d, paint, max: Math.max(1, max), alpha, src }
}

/** Height (0..1 of the full thickness) at a distance `t` (0 at the edge, 1 deepest inside). */
export function profile(t: number, round: number, bevel = 1): number {
  // The edge rises over the first `bevel` of the way in, then stays flat.
  const e = Math.min(1, Math.max(0, t) / Math.max(0.02, bevel))
  const curve = Math.sqrt(Math.max(0, 1 - (1 - e) ** 2))
  return e + (curve - e) * round
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

/**
 * The model: per vertex x, y, z (canvas px around the centre), u, v (0..1 of the source), normal x, y, z,
 * and a u, v a little further inside the drawing (the steep sides take their colour from there, not from the see-through edge).
 */
export function buildModel(base: XfState, field: DepthField, shape: Shape3d): { verts: Float32Array; centre: Pt; size: number; rim: number } {
  const { gw, gh, paint, max } = field
  const centre = mapPoint(base, 0.5, 0.5)
  const a = mapPoint(base, 0, 0)
  const b = mapPoint(base, 1, 1)
  const size = Math.max(Math.hypot(b.x - a.x, b.y - a.y) / Math.SQRT2, 1)
  const P: Pt[] = []
  for (let j = 0; j <= gh; j++) for (let i = 0; i <= gw; i++) P.push(mapPoint(base, i / gw, j / gh))
  // Thickness follows the drawing's own width (1 = the widest part as round as a tube), so a sword stays a blade and a face a ball.
  const cellPx = Math.max(Math.hypot(P[gw].x - P[0].x, P[gw].y - P[0].y) / gw, Math.hypot(P[gh * (gw + 1)].x - P[0].x, P[gh * (gw + 1)].y - P[0].y) / gh)
  const thick = shape.thick * max * cellPx
  // Height at each grid corner, from its true distance to the drawing's outline (smooth, not in cell steps).
  const { d: vd, max: vmax } = vertexDepth(field)
  const H = new Float32Array((gw + 1) * (gh + 1))
  for (let k = 0; k < H.length; k++) H[k] = vd[k] > 0 ? profile(vd[k] / vmax, shape.round, shape.bevel) * thick : 0
  const h = (i: number, j: number) => H[Math.min(gh, Math.max(0, j)) * (gw + 1) + Math.min(gw, Math.max(0, i))]
  const cells: number[] = []
  for (let k = 0; k < gw * gh; k++) if (paint[k]) cells.push(k)
  const verts = new Float32Array(cells.length * 2 * 6 * STRIDE)
  let o = 0
  const snap = edgeSnap(field, h)
  const put = (i: number, j: number, side: 1 | -1) => {
    const z = h(i, j)
    const sn = z ? null : snap(i, j)
    const p = sn ? mapPoint(base, sn.u, sn.v) : P[j * (gw + 1) + i]
    const [pu, pv] = sn ? [sn.u, sn.v] : [i / gw, j / gh]
    // Slope of the height over the canvas (cell size in px along each axis).
    const dx = Math.hypot(P[j * (gw + 1) + Math.min(gw, i + 1)].x - P[j * (gw + 1) + Math.max(0, i - 1)].x, P[j * (gw + 1) + Math.min(gw, i + 1)].y - P[j * (gw + 1) + Math.max(0, i - 1)].y) || 1
    const dy = Math.hypot(P[Math.min(gh, j + 1) * (gw + 1) + i].x - P[Math.max(0, j - 1) * (gw + 1) + i].x, P[Math.min(gh, j + 1) * (gw + 1) + i].y - P[Math.max(0, j - 1) * (gw + 1) + i].y) || 1
    const gx = (h(i + 1, j) - h(i - 1, j)) / dx
    const gy = (h(i, j + 1) - h(i, j - 1)) / dy
    const l = Math.hypot(gx, gy, 1)
    // Uphill in the grid (towards the inside), four cells: past a drawn outline, so the sides take the fill colour.
    const ux = h(i + 1, j) - h(i - 1, j)
    const uy = h(i, j + 1) - h(i, j - 1)
    const ul = Math.hypot(ux, uy) || 1
    verts.set([p.x - centre.x, p.y - centre.y, z * side, pu, pv, (-gx / l) * side, (-gy / l) * side, side / l, (i + (4 * ux) / ul) / gw, (j + (4 * uy) / ul) / gh, side], o)
    o += STRIDE
  }
  for (const side of [1, -1] as const)
    for (const k of cells) {
      const i = k % gw
      const j = (k - i) / gw
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 0], [1, 1], [0, 1]]) put(i + di, j + dj, side)
    }
  return { verts, centre, size, rim: Math.max(0.5, thick * 0.1) }
}

export const STRIDE = 11

/**
 * Distance (in cells) from each grid corner to the nearest point of the outline, found on a grid 4× finer than the
 * mesh, so heights follow the outline smoothly. 0 outside. Kept on the field: it only changes with the picture.
 */
export function vertexDepth(field: DepthField): { d: Float32Array; max: number } {
  if (field.vdepth) return field.vdepth
  const { gw, gh, dist, alpha, src } = field
  const d = new Float32Array((gw + 1) * (gh + 1))
  if (!alpha || !src) {
    // No picture to look at: the mean of the cells around each corner, as before.
    let max = 0
    for (let j = 0; j <= gh; j++)
      for (let i = 0; i <= gw; i++) {
        let s = 0
        for (const [a, b] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (i + a >= 0 && j + b >= 0 && i + a < gw && j + b < gh) s += dist[(j + b) * gw + i + a]
        max = Math.max(max, (d[j * (gw + 1) + i] = s / 4))
      }
    return (field.vdepth = { d, max: Math.max(1e-3, max) })
  }
  const F = 4
  const fw = gw * F
  const fh = gh * F
  const solid = new Uint8Array(fw * fh)
  const px = (u: number, o: number, n: number) => Math.min(o + n - 1, Math.max(o, Math.floor(o + u * n)))
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) solid[y * fw + x] = alpha(px((x + 0.5) / fw, src.x, src.w), px((y + 0.5) / fh, src.y, src.h)) >= 128 ? 1 : 0
  // Squared distance to the outline (fine samples inside with a neighbour outside), exact, in two passes (Felzenszwalb).
  const D = new Float64Array(fw * fh)
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < fw; x++) {
      const out = (a: number, b: number) => a < 0 || b < 0 || a >= fw || b >= fh || !solid[b * fw + a]
      D[y * fw + x] = solid[y * fw + x] && (out(x - 1, y) || out(x + 1, y) || out(x, y - 1) || out(x, y + 1)) ? 0 : 1e20
    }
  const n = Math.max(fw, fh)
  const f = new Float64Array(n)
  const g = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  const pass = (len: number, get: (q: number) => number, set: (q: number, x: number) => void) => {
    for (let q = 0; q < len; q++) f[q] = get(q)
    edt1d(f, len, g, v, z)
    for (let q = 0; q < len; q++) set(q, g[q])
  }
  for (let x = 0; x < fw; x++) pass(fh, (q) => D[q * fw + x], (q, val) => (D[q * fw + x] = val))
  for (let y = 0; y < fh; y++) pass(fw, (q) => D[y * fw + q], (q, val) => (D[y * fw + q] = val))
  let max = 0
  for (let j = 0; j <= gh; j++)
    for (let i = 0; i <= gw; i++) {
      const k = Math.min(fh - 1, j * F) * fw + Math.min(fw - 1, i * F)
      if (solid[k]) max = Math.max(max, (d[j * (gw + 1) + i] = Math.sqrt(D[k]) / F + 0.5 / F))
    }
  return (field.vdepth = { d, max: Math.max(1e-3, max) })
}

/** One line of the exact squared distance transform: `f` in, `g` out. */
function edt1d(f: Float64Array, n: number, g: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    g[q] = (q - v[k]) ** 2 + f[v[k]]
  }
}

/**
 * Edge corners (height 0) sit on the grid, so the outline came out in steps. Each one moves inwards to where the
 * picture's own outline is (alpha half way), searched along the way uphill, so the sides follow the drawing.
 */
function edgeSnap(field: DepthField, h: (i: number, j: number) => number) {
  const { gw, gh, paint, alpha, src } = field
  const painted = (i: number, j: number) => i >= 0 && j >= 0 && i < gw && j < gh && paint[j * gw + i] === 1
  return (i: number, j: number): { u: number; v: number } | null => {
    if (!alpha || !src) return null
    // Towards the inside: uphill, or (thin lines with no height) towards the painted cells around the corner.
    let dx = h(i + 1, j) - h(i - 1, j)
    let dy = h(i, j + 1) - h(i, j - 1)
    if (!dx && !dy)
      for (const [a, b] of [[-1, -1], [0, -1], [-1, 0], [0, 0]])
        if (painted(i + a, j + b)) [dx, dy] = [dx + a + 0.5, dy + b + 0.5]
    const l = Math.hypot(dx, dy)
    if (!l) return null
    const at = (t: number) => {
      const u = (i + (dx / l) * t) / gw
      const v = (j + (dy / l) * t) / gh
      const x = Math.min(src.x + src.w - 1, Math.max(src.x, Math.floor(src.x + u * src.w)))
      const y = Math.min(src.y + src.h - 1, Math.max(src.y, Math.floor(src.y + v * src.h)))
      return { u, v, a: alpha(x, y) }
    }
    if (at(0).a >= 128) return null
    for (let t = 0.125; t <= 1.5; t += 0.125) {
      const q = at(t)
      if (q.a >= 128) return { u: Math.min(1, Math.max(0, q.u)), v: Math.min(1, Math.max(0, q.v)) }
    }
    return null
  }
}

const VERT = `#version 300 es
in vec3 pos;
in vec2 uv;
in vec3 nrm;
in vec2 uvIn;
in float side;
uniform mat3 rot;
uniform vec2 centre, canvas;
uniform float focal, size, rimH;
out vec2 vuv;
out vec2 vuvIn;
out vec3 vn;
out float wall;
out float vside;
void main() {
  vuvIn = uvIn;
  vside = side;
  // The sides: steep, or close to the rim (where the front and back meet), so the rim reads as one band.
  wall = max(1.0 - abs(nrm.z), 1.0 - smoothstep(0.0, rimH, abs(pos.z)));
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
in vec2 vuvIn;
in vec3 vn;
in float wall;
in float vside;
uniform sampler2D src;
uniform sampler2D backTex;
uniform vec4 box;
uniform vec2 texSize;
uniform float light;
uniform vec3 lightDir;
uniform vec3 lightColor;
uniform int backMode;
uniform vec3 backColor;
out vec4 o;
void main() {
  vec4 c = texture(src, (box.xy + vuv * box.zw) / texSize);
  // The sides: colour from just inside the outline, so they are solid, not see-through.
  float w = smoothstep(0.3, 0.55, wall);
  // The mesh is a grid, so near the outline some of it lies past the drawing: rather than leave a hole there (the back
  // showed through in teeth), it takes the colour from just inside, like the sides.
  float fill = max(w, 1.0 - c.a);
  if (fill > 0.5) {
    vec4 d = texture(src, (box.xy + vuvIn * box.zw) / texSize);
    if (d.a > 0.5 || d.a > c.a) c = mix(c, d, fill);
  }
  bool backFace = w <= 0.5 && vside < 0.0;
  if (backFace && backMode == 1) {
    c = vec4(backColor * c.a, c.a);
  } else if (backFace && backMode == 2) {
    // The back layer is painted as seen from behind, so it is read mirrored; it covers the front's mirror image, inside the outline only.
    vec4 b = texture(backTex, (box.xy + vec2(1.0 - vuv.x, vuv.y) * box.zw) / texSize);
    c = (b + c * (1.0 - b.a)) * c.a;
  }
  if (c.a < 0.03) discard;
  vec3 n = normalize(vn);
  float d = max(dot(n, lightDir), 0.0);
  vec3 shade = mix(vec3(1.0), (0.35 + 0.85 * d) * lightColor, light);
  o = vec4(c.rgb * shade, c.a);
}`

/** One WebGL2 canvas (document size) that draws the model. */
export class ModelRenderer {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private buf: WebGLBuffer
  private tex: WebGLTexture
  private backTex: WebGLTexture
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
    gl.bindAttribLocation(p, 3, 'uvIn')
    gl.bindAttribLocation(p, 4, 'side')
    gl.linkProgram(p)
    this.prog = p
    this.buf = gl.createBuffer()!
    const texture = () => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
      return t
    }
    this.tex = texture()
    this.backTex = texture()
  }

  /** The picture the model is painted with (the lifted pixels, or the selection mask). */
  upload(src: HTMLCanvasElement, back = false) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, back ? this.backTex : this.tex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src)
    if (!back) this.texSize = [src.width, src.height]
  }

  /** Draw the model turned by `t` into this canvas (w × h, the document size). */
  draw(model: ReturnType<typeof buildModel>, src: Box, t: Turn, shape: Shape3d, w: number, h: number) {
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
    const stride = STRIDE * 4
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 20)
    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 32)
    gl.enableVertexAttribArray(4)
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 40)
    const u = (n: string) => gl.getUniformLocation(this.prog, n)
    gl.uniformMatrix3fv(u('rot'), false, rotation(t))
    gl.uniform2f(u('centre'), model.centre.x, model.centre.y)
    gl.uniform2f(u('canvas'), w, h)
    gl.uniform1f(u('focal'), model.size * (1 + 20 * (1 - t.depth) ** 2))
    gl.uniform1f(u('size'), model.size)
    gl.uniform1f(u('rimH'), model.rim)
    gl.uniform4f(u('box'), src.x, src.y, src.w, src.h)
    gl.uniform2f(u('texSize'), this.texSize[0], this.texSize[1])
    gl.uniform1f(u('light'), shape.light)
    gl.uniform3fv(u('lightDir'), lightDir(shape.lightAngle))
    gl.uniform3fv(u('lightColor'), rgb(shape.lightColor))
    gl.uniform1i(u('backMode'), shape.back.mode === 'color' ? 1 : shape.back.mode === 'layer' ? 2 : 0)
    gl.uniform3fv(u('backColor'), rgb(shape.back.color))
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.uniform1i(u('src'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.backTex)
    gl.uniform1i(u('backTex'), 1)
    gl.activeTexture(gl.TEXTURE0)
    gl.drawArrays(gl.TRIANGLES, 0, model.verts.length / STRIDE)
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

/** The light's direction for an angle on screen (y down), a little in front. 225° is the old top left. */
export function lightDir(deg: number): [number, number, number] {
  const r = (deg * Math.PI) / 180
  const v = [Math.cos(r) * 0.75, Math.sin(r) * 0.75, 0.66]
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

function rgb(hex: string): [number, number, number] {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0xffffff
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
