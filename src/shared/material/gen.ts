// Material Lab node engine: turns a graph of Material Maker nodes into GLSL.
// A TypeScript port of Material Maker's shader generator (engine/nodes/gen_*.gd, MIT, see mm-nodes/LICENSE.md).
// Names, variable spellings and order follow the original so its .mmg node files work unchanged.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Json = any

export interface Uniform {
  name: string
  type: 'float' | 'int' | 'vec2' | 'vec4' | 'sampler2D'
  value: number | number[] | string // sampler2D: the texture name of the buffer that fills it
  size: number // array length, 0 for a plain uniform
}

export class ShaderCode {
  globals: { code: string; source: string }[] = []
  uniforms: Uniform[] = []
  defs = ''
  code = ''
  outputType = ''
  outputValues: Record<string, string> = {}
  alias: ShaderCode | null = null

  addGlobal(code: string, source: string, index = -1) {
    if (this.globals.some(g => g.code === code)) return
    if (index === -1) this.globals.push({ code, source })
    else this.globals.splice(index, 0, { code, source })
  }
  addGlobals(list: { code: string; source: string }[]) {
    for (const g of list) this.addGlobal(g.code, g.source)
  }
  addUniform(name: string, type: Uniform['type'], value: Uniform['value'], size = 0) {
    if (!this.uniforms.some(u => u.name === name)) this.uniforms.push({ name, type, value, size })
  }
  addUniforms(list: Uniform[]) {
    for (const u of list) this.addUniform(u.name, u.type, u.value, u.size)
  }
  /** Global declarations, keeping only the ones `code` (or a kept one) uses, like Material Maker. */
  globalsString(code = ''): string {
    let rv = ''
    for (const g of [...this.globals].reverse()) {
      let added = false
      for (const d of splitGlsl(g.code).reverse()) {
        const n = glslDeclarationName(d)
        if (code === '' || n === '' || code.includes(n) || rv.includes(n)) {
          rv = `\n// '${n}'\n${d}\n${rv}`
          added = true
        }
      }
      if (added) rv = `// #globals: ${g.source}\n${rv}`
    }
    return rv
  }
}

/** The value types a port can carry, from Material Maker's io_types.mmt. */
export const IO_TYPES: Record<string, { type: string; paramdefs: string; params: string; convert?: { type: string; expr: string }[] }> = {
  f: { type: 'float', paramdefs: 'vec2 uv', params: 'uv', convert: [{ type: 'rgb', expr: 'vec3($(value))' }, { type: 'rgba', expr: 'vec4(vec3($(value)), 1.0)' }] },
  rgb: { type: 'vec3', paramdefs: 'vec2 uv', params: 'uv', convert: [{ type: 'f', expr: '(dot($(value), vec3(1.0))/3.0)' }, { type: 'rgba', expr: 'vec4($(value), 1.0)' }] },
  rgba: { type: 'vec4', paramdefs: 'vec2 uv', params: 'uv', convert: [{ type: 'f', expr: '(dot(($(value)).rgb, vec3(1.0))/3.0)' }, { type: 'rgb', expr: '(($(value)).rgb)' }] },
  sdf2d: { type: 'float', paramdefs: 'vec2 uv', params: 'uv' },
  sdf3d: { type: 'float', paramdefs: 'vec3 p', params: 'p', convert: [{ type: 'sdf3dc', expr: 'vec2($(value), 0.0)' }] },
  sdf3dc: { type: 'vec2', paramdefs: 'vec3 p', params: 'p', convert: [{ type: 'sdf3d', expr: '($(value)).x' }] },
  tex3d_gs: { type: 'float', paramdefs: 'vec4 p', params: 'p', convert: [{ type: 'tex3d', expr: 'vec3($(value))' }] },
  tex3d: { type: 'vec3', paramdefs: 'vec4 p', params: 'p', convert: [{ type: 'tex3d_gs', expr: '(dot($(value), vec3(1.0))/3.0)' }] },
  v4v4: { type: 'vec4', paramdefs: 'vec4 p', params: 'p' },
  fill: { type: 'vec4', paramdefs: 'vec2 uv', params: 'uv' },
}

export class GenContext {
  private variants = new Map<Gen, string[]>()
  private parent: GenContext | null
  constructor(parent: GenContext | null = null) {
    this.parent = parent
  }
  hasVariant(g: Gen): boolean {
    return this.variants.has(g) || (this.parent !== null && this.parent.hasVariant(g))
  }
  private touch(g: Gen) {
    if (!this.variants.has(g)) this.variants.set(g, [])
    this.parent?.touch(g)
  }
  getVariant(g: Gen, variant: string): number {
    let rv = -1
    const list = this.variants.get(g)
    if (list) {
      rv = list.indexOf(variant)
      if (rv === -1) list.push(variant)
    } else this.variants.set(g, [variant])
    this.touch(g)
    return rv
  }
}

// ---------- string helpers (ports of gen_base.gd) ----------

export function findMatchingParenthesis(s: string, i: number, op = '(', cp = ')'): number {
  let level = 0
  for (; i < s.length; i++) {
    if (s[i] === op) level++
    else if (s[i] === cp && --level === 0) return i
  }
  return -1
}

export function splitParameters(s: string): string[] {
  if (s[0] !== '(' || findMatchingParenthesis(s, 0) !== s.length - 1) return []
  const out: string[] = []
  let p = ''
  for (const part of s.slice(1, -1).split(',')) {
    p = p === '' ? part : p + ',' + part
    if (count(p, '(') === count(p, ')') && count(p, '[') === count(p, ']')) {
      out.push(p.trim())
      p = ''
    }
  }
  return out
}
const count = (s: string, c: string) => s.split(c).length - 1

function removeComments(s: string): string {
  s = s.replace(/\/\*[\s\S]*?\*\//g, '')
  return s.replace(/\/\/.*/g, '')
}

export function splitGlsl(s: string): string[] {
  s = removeComments(s).trim()
  const a: string[] = []
  while (s !== '') {
    const semi = s.indexOf(';')
    const brace = s.indexOf('{')
    if (semi !== -1 && (brace === -1 || semi < brace)) {
      a.push(s.slice(0, semi + 1))
      s = s.slice(semi + 1)
    } else if (brace !== -1) {
      const close = findMatchingParenthesis(s, brace, '{', '}')
      if (close === -1) break
      let d = s.slice(0, close + 1)
      s = s.slice(close + 1).trim()
      if (s[0] === ';') {
        d += ';'
        s = s.slice(1)
      }
      a.push(d)
    } else break
    s = s.trim()
  }
  return a
}

function glslDeclarationName(s: string): string {
  const words = s.split(' ').filter(w => w !== '')
  if (words.length > 2 && ['const', 'uniform', 'varying'].includes(words[0])) return words[2].split('[')[0]
  const split = s.split(' ')
  if (split.length > 1) {
    const f = split[1].split('(')
    if (f.length > 1) return f[0]
  }
  return ''
}

const WORD = /[A-Za-z0-9_?]/
const wordEnd = (s: string, i: number) => {
  while (i < s.length && WORD.test(s[i])) i++
  return i
}

// ---------- parameter value types ----------

interface Color { r: number; g: number; b: number; a: number }
const toColor = (v: Json): Color => (v && typeof v === 'object' ? { r: +v.r, g: +v.g, b: +v.b, a: v.a === undefined ? 1 : +v.a } : { r: 0, g: 0, b: 0, a: 1 })

/** Gradient → GLSL function `<name>_gradient_fct` plus its uniforms (types/gradient.gd). */
function gradientShader(v: Json, name: string): { uniforms: Uniform[]; code: string } {
  let interpolation = 1
  let points: { v: number; c: Color }[] = []
  const src = Array.isArray(v) ? v : v?.points ?? []
  for (const p of src) points.push({ v: +p.pos, c: toColor(p) })
  if (!Array.isArray(v) && v?.interpolation !== undefined) interpolation = Math.trunc(+v.interpolation)
  points.sort((a, b) => a.v - b.v)
  if (interpolation === 0 && points.length) {
    for (let i = points.length - 1; i > 0; i--) {
      const same = JSON.stringify(points[i].c) === JSON.stringify(points[i - 1].c)
      if (same) points.splice(i, 1)
      else points[i].v = 0.5 * (points[i - 1].v + points[i].v)
    }
    points[0].v = 0
  }
  points = points.length ? points : []
  const pv = (i: number) => `p_${name}_pos[${i}]`
  const pc = (i: number) => `p_${name}_col[${i}]`
  let sh = `vec4 ${name}_gradient_fct(float x) {\n`
  const s = points.length - 1
  if (!points.length) sh += '  return vec4(0.0, 0.0, 0.0, 1.0);\n'
  else if (interpolation === 0) {
    if (s >= 1) {
      sh += `  if (x < ${pv(1)}) {\n    return ${pc(0)};\n`
      for (let i = 1; i < s; i++) sh += `  } else if (x < ${pv(i + 1)}) {\n    return ${pc(i)};\n`
      sh += '  }\n'
    }
    sh += `  return ${pc(s)};\n`
  } else if (interpolation === 1 || interpolation === 2) {
    sh += `  if (x < ${pv(0)}) {\n    return ${pc(0)};\n`
    const fn = interpolation === 1 ? '(' : '0.5-0.5*cos(3.14159265359*'
    for (let i = 0; i < s; i++) sh += `  } else if (x < ${pv(i + 1)}) {\n    return mix(${pc(i)}, ${pc(i + 1)}, ${fn}(x-${pv(i)})/(${pv(i + 1)}-${pv(i)})));\n`
    sh += `  }\n  return ${pc(s)};\n`
  } else {
    sh += `  if (x < ${pv(0)}) {\n    return ${pc(0)};\n`
    const seg = (a: number) => `mix(${pc(a)}, ${pc(a + 1)}, (x-${pv(a)})/(${pv(a + 1)}-${pv(a)}))`
    for (let i = 0; i < s; i++) {
      sh += `  } else if (x < ${pv(i + 1)}) {\n`
      const dx = `(x-${pv(i)})/(${pv(i + 1)}-${pv(i)})`
      const b = `mix(${pc(i)}, ${pc(i + 1)}, ${dx})`
      if (i > 0) {
        const a = seg(i - 1)
        if (i < s - 1) sh += `    return 0.5*(${b} + mix(${a}, ${seg(i + 1)}, 0.5-0.5*cos(3.14159265359*${dx})));\n`
        else sh += `    return mix(${a}, ${b}, 0.5+0.5*${dx});\n`
      } else if (i < s - 1) sh += `    return mix(${seg(i + 1)}, ${b}, 1.0-0.5*${dx});\n`
      else sh += `    return ${b};\n`
    }
    sh += `  }\n  return ${pc(s)};\n`
  }
  sh += '}\n'
  const uniforms: Uniform[] = points.length
    ? [
        { name: `p_${name}_pos`, type: 'float', value: points.map(p => p.v), size: points.length },
        { name: `p_${name}_col`, type: 'vec4', value: points.flatMap(p => [p.c.r, p.c.g, p.c.b, p.c.a]), size: points.length },
      ]
    : []
  return { uniforms, code: sh }
}

/** Curve → GLSL function `<name>_curve_fct` plus one uniform per point value (types/curve.gd). */
function curveShader(v: Json, name: string): { uniforms: Uniform[]; code: string } {
  const pts: Json[] = v?.points ?? [{ x: 0, y: 0, ls: 0, rs: 1 }, { x: 1, y: 1, ls: 1, rs: 0 }]
  const uniforms: Uniform[] = []
  pts.forEach((p, i) => {
    for (const k of ['x', 'y', 'ls', 'rs']) uniforms.push({ name: `p_${name}_${i}_${k}`, type: 'float', value: +p[k], size: 0 })
  })
  const P = (i: number, k: string) => `p_${name}_${i}_${k}`
  let sh = `float ${name}_curve_fct(float x) {\n`
  for (let i = 0; i < pts.length - 1; i++) {
    if (i < pts.length - 2) sh += `if (x <= ${P(i + 1, 'x')}) `
    sh += `{\nfloat dx = x - ${P(i, 'x')};\nfloat d = ${P(i + 1, 'x')} - ${P(i, 'x')};\nfloat t = dx/d;\nfloat omt = (1.0 - t);\nfloat omt2 = omt * omt;\nfloat omt3 = omt2 * omt;\nfloat t2 = t * t;\nfloat t3 = t2 * t;\nd /= 3.0;\n`
    sh += `float y1 = ${P(i, 'y')};\nfloat yac = ${P(i, 'y')} + d*${P(i, 'rs')};\nfloat ybc = ${P(i + 1, 'y')} - d*${P(i + 1, 'ls')};\nfloat y2 = ${P(i + 1, 'y')};\n`
    sh += 'return y1*omt3 + yac*omt2*t*3.0 + ybc*omt*t2*3.0 + y2*t3;\n}\n'
  }
  sh += 'return 0.0;\n}\n'
  return { uniforms, code: sh }
}

/** Parameter types the engine can't turn into shader code yet (they need their own editors first). */
export const UNSUPPORTED_PARAMETER_TYPES = ['polygon', 'polyline', 'splines', 'pixels', 'lattice']

// ---------- generators ----------

let nextId = 1
const MAX_SEED = 4294967296

export abstract class Gen {
  readonly id = nextId++
  name = ''
  parent: GenGraph | null = null
  parameters: Record<string, Json> = {}
  seedValue = 0
  seedLocked = false
  position = { x: 0, y: 0 }

  get genname() {
    return 'o' + this.id
  }
  abstract type(): string
  getInputDefs(): Json[] {
    return []
  }
  getOutputDefs(): Json[] {
    return []
  }
  getParameterDefs(): Json[] {
    return []
  }
  hasRandomness() {
    return false
  }
  getSeed(): number {
    let s = this.seedValue
    if (!this.seedLocked && this.parent?.transmitsSeed) s += this.parent.getSeed()
    return s
  }
  initParameters() {
    for (const p of this.getParameterDefs()) if (!(p.name in this.parameters) && 'default' in p) this.parameters[p.name] = p.default
  }
  getParameter(n: string): Json {
    if (n in this.parameters) return this.parameters[n]
    return this.getParameterDefs().find(p => p.name === n)?.default
  }
  setParameter(n: string, v: Json) {
    this.parameters[n] = v
  }
  getSource(inputIndex: number): { gen: Gen; output: number } | null {
    return this.parent ? this.parent.getPortSource(this.name, inputIndex) : null
  }
  /** Extra names a node gives to its texture outputs (buffers): `$in.texture`, `$in.size`. */
  getOutputAttributes(_output: number): Record<string, string> {
    return {}
  }
  /** Every buffer inside this node, so the renderer can fill them before the final pass. */
  buffers(): Gen[] {
    return []
  }

  getShaderCode(uv: string, output: number, ctx: GenContext): ShaderCode {
    const rv = this._getShaderCode(uv, output, ctx)
    const t = IO_TYPES[rv.outputType]
    for (const c of t?.convert ?? []) if (!(c.type in rv.outputValues)) rv.outputValues[c.type] = c.expr.replace('$(value)', rv.outputValues[rv.outputType])
    return rv
  }
  abstract _getShaderCode(uv: string, output: number, ctx: GenContext): ShaderCode

  deserialize(data: Json) {
    this._deserialize(data)
    this.loadCommon(data)
  }
  /** Name, position, parameter values and seed: the part every saved node has (gen_base.gd deserialize). */
  loadCommon(data: Json) {
    if (typeof data.name === 'string') this.name = data.name
    if (data.node_position) this.position = { x: +data.node_position.x || 0, y: +data.node_position.y || 0 }
    if (data.parameters) for (const [k, v] of Object.entries(data.parameters)) this.setParameter(k, v)
    this.seedLocked = data.seed_locked === true
    if (data.seed_int !== undefined) this.seedValue = data.seed_int / MAX_SEED
    else if (data.seed !== undefined) this.seedValue = +data.seed
    else if (data.seed_value !== undefined) {
      this.seedLocked = true
      this.seedValue = +data.seed_value
    } else this.seedValue = ((Math.trunc(this.position.x) * 0x1f1f1f1f) ^ Math.trunc(this.position.y)) % 65536
    this.initParameters()
  }
  _deserialize(_data: Json) {}
}

export function defaultShaderCode(): ShaderCode {
  const rv = new ShaderCode()
  rv.outputType = 'rgba'
  rv.outputValues = { f: '0.0', rgb: 'vec3(0.0)', rgba: 'vec4(0.0)' }
  return rv
}

// --- shader nodes (gen_shader.gd) ---

function findInstanceFunctions(code: string) {
  const functions: string[] = []
  const re = /(\w+)\s+(\w*\$(?:\(name\)\w*|name))\s*\((.*)\)\s*{/g
  for (const m of [...code.matchAll(re)]) {
    if (m[1] === 'return') continue
    functions.push(m[2])
    code = code.replace(m[0], `${m[1]} ${m[2]}(${m[3]}, float _seed_variation_, vec4 _controlled_variation_) {`)
  }
  return { code, functions }
}

function fixInstanceFunctions(code: string, functions: string[]): string {
  const extra = ', _seed_variation_, _controlled_variation_'
  for (const f of functions) {
    let location = 0
    for (;;) {
      location = code.indexOf(f, location)
      if (location === -1) break
      if (location > 0 && /[A-Za-z0-9_]/.test(code[location - 1])) {
        location += f.length
        continue
      }
      let p = location + f.length
      for (;;) {
        const ch = code[p]
        if (ch === '(') {
          p = findMatchingParenthesis(code, p)
          if (p === -1) return code
          let replace = true
          for (let p2 = p + 1; p2 < code.length; p2++) {
            if (' \t\n\r'.includes(code[p2])) continue
            if (code[p2] === '{') replace = false
            break
          }
          if (replace) code = code.slice(0, p) + extra + code.slice(p)
          break
        } else if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') p++
        else break
      }
      location = p
    }
  }
  return code
}

type ReplaceFn = (variable: string, suffix: string, params: string, vars: Vars, rv: ShaderCode, ctx: GenContext) => string
type Vars = Record<string, string | { hasParameters: boolean; hasSuffix: boolean; replace: ReplaceFn }>

/** Looks up node files by name, for `includes` and for graph nodes made of other nodes. */
export interface NodeLibrary {
  get(name: string): Json | undefined
}

export class GenShader extends Gen {
  model: Json = {}
  pre: Json = {}
  genericSize = 1
  usesSeedModel = false
  private library: NodeLibrary
  constructor(library: NodeLibrary) {
    super()
    this.library = library
  }
  type() {
    return 'shader'
  }
  getParameterDefs() {
    return this.pre.parameters ?? []
  }
  getInputDefs() {
    return this.pre.inputs ?? []
  }
  getOutputDefs() {
    return this.pre.outputs ?? []
  }
  hasRandomness() {
    return this.usesSeedModel || Object.values(this.parameters).some(v => typeof v === 'string' && /\$rndi?\(/.test(v))
  }
  isGeneric() {
    return [...(this.model.parameters ?? []), ...(this.model.inputs ?? [])].some((p: Json) => String(p.name).includes('#'))
  }

  setShaderModel(data: Json) {
    this.model = data
    const pre: Json = {}
    if (data.instance) {
      const inst = findInstanceFunctions(data.instance)
      pre.instance = fixInstanceFunctions(inst.code, inst.functions)
      if (data.code !== undefined) pre.code = fixInstanceFunctions(data.code, inst.functions)
      pre.parameters = (data.parameters ?? []).map((p: Json) =>
        p.type === 'enum' ? { ...p, values: p.values.map((v: Json) => ({ name: v.name, value: fixInstanceFunctions(v.value, inst.functions) })) } : p,
      )
      pre.outputs = (data.outputs ?? []).map((o: Json) => {
        o = { ...o }
        const t = o.type && o[o.type] !== undefined ? o.type : Object.keys(IO_TYPES).find(k => k in o)
        if (t) {
          o.type = t
          o[t] = fixInstanceFunctions(o[t], inst.functions)
        }
        return o
      })
    } else {
      pre.parameters = data.parameters
      pre.code = data.code
      pre.outputs = data.outputs
    }
    pre.inputs = data.inputs
    pre.includes = data.includes
    pre.global = data.global
    // outputs name their type by having a key of that type
    pre.outputs = (pre.outputs ?? []).map((o: Json) => (o.type && o[o.type] !== undefined ? o : { ...o, type: Object.keys(IO_TYPES).find(k => k in o) }))
    this.pre = pre
    if (this.isGeneric()) this.expandGeneric()
    this.usesSeedModel = [pre.code, pre.instance, ...pre.outputs.map((o: Json) => o[o.type])].some(s => typeof s === 'string' && /\$\(?seed\)?/.test(s))
  }

  private expandGenericCode(code: string, first = 1): string {
    let rv = ''
    code = code.replaceAll('#count', String(this.genericSize))
    while (code !== '') {
      const f = code.indexOf('#for')
      if (f === -1) {
        rv += code
        break
      }
      rv += code.slice(0, f)
      code = code.slice(f + 4)
      const e = code.indexOf('#end')
      const body = e === -1 ? code : code.slice(0, e)
      code = e === -1 ? '' : code.slice(e + 4)
      for (let gi = 0; gi < this.genericSize; gi++) rv += body.replaceAll('#', String(gi + first))
    }
    return rv
  }

  private genericRange(arr: Json[], field: string, indirect = false) {
    let first = -1
    let last = -1
    arr.forEach((p, i) => {
      const s = String(indirect ? p[p[field]] : p[field])
      if (s.includes('#')) {
        if (first === -1) first = i
      } else if (first !== -1 && last === -1) last = i
    })
    if (first !== -1 && last === -1) last = arr.length
    return { first, last }
  }

  private expandGeneric() {
    const m = this.model
    const pre = this.pre
    const n = this.genericSize
    const gi_ = this.genericRange(m.inputs ?? [], 'name')
    const sub = (o: Json, keys: string[], gv: number) => {
      o = { ...o }
      for (const k of keys) if (typeof o[k] === 'string') o[k] = o[k].replaceAll('#', String(gv))
      return o
    }
    if (gi_.first !== -1) {
      const inputs = m.inputs.slice(0, gi_.first)
      for (let g = 0; g < n; g++) for (let i = gi_.first; i < gi_.last; i++) inputs.push(sub(m.inputs[i], ['name', 'label', 'shortdesc', 'longdesc'], g + 1))
      pre.inputs = inputs.concat(m.inputs.slice(gi_.last))
    }
    const gp = this.genericRange(m.parameters ?? [], 'name')
    if (gp.first !== -1) {
      const params = (pre.parameters ?? []).slice(0, gp.first)
      for (let g = 0; g < n; g++) for (let i = gp.first; i < gp.last; i++) params.push(sub(pre.parameters[i], ['name', 'shortdesc', 'longdesc'], g + 1))
      pre.parameters = params.concat(pre.parameters.slice(gp.last))
    }
    const go = this.genericRange(pre.outputs ?? [], 'type', true)
    if (go.first !== -1) {
      const outs = pre.outputs.slice(0, go.first)
      for (let g = 0; g < n; g++)
        for (let i = go.first; i < go.last; i++) {
          const o = sub(pre.outputs[i], ['shortdesc', 'longdesc'], g + 1)
          o[o.type] = pre.outputs[i][o.type].replaceAll('#', String(g + 1))
          outs.push(o)
        }
      pre.outputs = outs.concat(pre.outputs.slice(go.last))
    }
    for (const f of ['code', 'instance']) if (typeof pre[f] === 'string') pre[f] = this.expandGenericCode(pre[f])
  }

  private replaceRnd(s: string, offset: number, kw: 'rnd' | 'rndi'): string {
    for (;;) {
      const at = s.indexOf(`$${kw}(`)
      if (at === -1) break
      const end = findMatchingParenthesis(s, at + kw.length + 1)
      if (end === -1) break
      const params = s.slice(at + kw.length + 2, end)
      const whole = `$${kw}(${params})`
      for (;;) {
        const pos = s.indexOf(whole)
        if (pos === -1) break
        const k = kw === 'rnd' ? Math.sin(pos + offset) * 0.5 + 0.5 : Math.sin(pos) + offset
        s = s.replace(whole, `param_${kw}(${params}, $seed+${k.toFixed(6)})`)
      }
    }
    return s
  }

  private commonVariables(uv: string, rv: ShaderCode): Vars {
    const g = this.genname
    const vars: Vars = { uv, time: 'elapsed_time', name: g, node_id: String(this.id) }
    for (const [np, info] of Object.entries(this.parent?.namedParameters() ?? {})) {
      vars[np] = info.id
      rv.addUniform(info.id, 'float', info.value)
    }
    vars.seed = this.seedLocked ? `seed_${g}` : `(seed_${g}+fract(_seed_variation_))`
    for (let i = 1; i <= 4; i++) vars['?' + i] = '_controlled_variation_.' + 'xyzw'[i - 1]
    return vars
  }

  private processParameters(rv: ShaderCode, vars: Vars, declare: boolean) {
    const g = this.genname
    let rndOffset = 0
    if (this.hasRandomness()) {
      if (declare) rv.addUniform(`seed_${g}`, 'float', this.getSeed())
      vars.seed = `(seed_${g}+fract(_seed_variation_))`
    }
    for (const p of this.pre.parameters ?? []) {
      const v = this.parameters[p.name]
      switch (p.type) {
        case 'float':
          if (typeof v === 'number') {
            if (declare) rv.addUniform(`p_${g}_${p.name}`, 'float', v)
            vars[p.name] = `p_${g}_${p.name}`
          } else {
            vars[p.name] = '(' + this.replaceRnd(this.replaceRnd(String(v), rndOffset, 'rnd'), rndOffset, 'rndi') + ')'
          }
          rndOffset += 17
          break
        case 'color': {
          const c = toColor(v)
          if (declare) rv.addUniform(`p_${g}_${p.name}`, 'vec4', [c.r, c.g, c.b, c.a])
          vars[p.name] = `p_${g}_${p.name}`
          break
        }
        case 'enum': {
          vars[p.name] = ''
          if (p.values?.length) {
            const i = typeof v === 'number' && v >= 0 && v < p.values.length ? Math.trunc(v) : 0
            vars[p.name] = p.values[i].value
          }
          break
        }
        case 'boolean':
          vars[p.name] = v ? 'true' : 'false'
          break
        case 'size':
          vars[p.name] = Math.pow(2, +v).toFixed(1)
          break
        case 'gradient': {
          const sh = gradientShader(v, `${g}_${p.name}`)
          if (declare) {
            rv.addUniforms(sh.uniforms)
            rv.defs += sh.code
          }
          vars[p.name] = `${g}_${p.name}_gradient_fct`
          break
        }
        case 'curve': {
          const sh = curveShader(v, `${g}_${p.name}`)
          if (declare) {
            rv.addUniforms(sh.uniforms)
            rv.defs += sh.code
          }
          vars[p.name] = `${g}_${p.name}_curve_fct`
          break
        }
        default:
          vars[p.name] = `(error: unsupported parameter type ${p.type})`
      }
    }
  }

  private generateInputFunction(index: number, input: Json, rv: ShaderCode, ctx: GenContext) {
    const src = this.getSource(index)
    if (!src) return
    const t = IO_TYPES[input.type]
    const s = src.gen.getShaderCode(t.params, src.output, new GenContext(ctx))
    rv.addUniforms(s.uniforms)
    rv.defs += s.defs
    rv.addGlobals(s.globals)
    rv.defs += `${t.type} ${this.genname}_input_${input.name}(${t.paramdefs}, float _seed_variation_, vec4 _controlled_variation_) {\n${s.code}\nreturn ${s.outputValues[input.type]};\n}\n`
  }

  private replaceInput(i: number): ReplaceFn {
    return (_name, suffix, params, vars, rv, ctx) => {
      const def = this.pre.inputs[i]
      const src = this.getSource(i)
      if (!src) {
        const old = vars.uv
        vars.uv = params
        const r = this.replaceVariables(String(def.default ?? '0.0'), vars, rv, ctx)
        vars.uv = old
        return r
      }
      const attrs = src.gen.getOutputAttributes(src.output)
      const attr = suffix === 'size' ? 'texture_size' : suffix
      if (suffix && attr in attrs) return attrs[attr]
      if (suffix === 'texture' || suffix === 'size') return `(error: Cannot find attribute ${suffix} for input ${def.name})`
      if (def.function) {
        const fn = `${this.genname}_input_${def.name}`
        if (suffix === 'variation') {
          const list = splitParameters(params)
          const tail = list.length === 1 ? ', _seed_variation_, _controlled_variation_)' : list.length === 2 ? ', _controlled_variation_)' : ')'
          return fn + '(' + list.join(', ') + tail
        }
        return `${fn}(${params}, _seed_variation_, _controlled_variation_)`
      }
      const s = src.gen.getShaderCode(params, src.output, ctx)
      rv.addUniforms(s.uniforms)
      rv.defs += s.defs
      rv.addGlobals(s.globals)
      rv.code += s.code
      rv.alias = s
      return s.outputValues[def.type] ?? `(error: input ${def.name} can't take ${s.outputType})`
    }
  }

  replaceVariables(str: string, vars: Vars, rv: ShaderCode, ctx: GenContext): string {
    let end = ''
    for (;;) {
      const d = str.lastIndexOf('$')
      if (d === -1) break
      let varEnd: number
      let variable: string
      if (str[d + 1] === '(') {
        varEnd = findMatchingParenthesis(str, d + 1) + 1
        if (varEnd === 0) varEnd = str.length
        variable = str.slice(d + 2, varEnd - 1)
      } else {
        varEnd = wordEnd(str, d + 1)
        variable = str.slice(d + 1, varEnd)
      }
      end = str.slice(varEnd) + end
      str = str.slice(0, d)
      const r = vars[variable]
      if (typeof r === 'string') str += r
      else if (r) {
        let replaceAll = d === 0
        end = end.trim()
        let params = ''
        let suffix = ''
        if (r.hasSuffix && end[0] === '.') {
          end = end.slice(1).trim()
          const e = wordEnd(end, 0)
          suffix = end.slice(0, e)
          end = end.slice(e).trim()
        }
        if (r.hasParameters && end[0] === '(') {
          const pe = findMatchingParenthesis(end, 0)
          if (pe < end.length - 1) replaceAll = false
          params = end.slice(0, pe + 1)
          if (params[1] === '(' && findMatchingParenthesis(params, 1) === params.length - 2) params = params.slice(1, -1)
          end = end.slice(pe + 1)
        } else replaceAll = false
        str += r.replace(variable, suffix, params, vars, rv, ctx)
        if (!replaceAll) rv.alias = null
      } else str += `(error: ${variable} not found)`
    }
    return str + end
  }

  _getShaderCode(uv: string, output: number, ctx: GenContext): ShaderCode {
    const g = this.genname
    const rv = new ShaderCode()
    const declare = !ctx.hasVariant(this)
    const out = this.pre.outputs?.[output]
    if (!out) return rv
    const vars = this.commonVariables(uv, rv)
    this.processParameters(rv, vars, declare)
    for (let i = 0; i < (this.pre.inputs ?? []).length; i++) {
      const input = this.pre.inputs[i]
      if (declare && input.function) this.generateInputFunction(i, input, rv, ctx)
      vars[input.name] = { hasParameters: true, hasSuffix: true, replace: this.replaceInput(i) }
    }
    if (declare) {
      for (const inc of this.pre.includes ?? []) {
        const glob = this.library.get(inc)?.shader_model?.global
        if (glob) rv.addGlobal(glob, inc)
      }
      if (this.pre.global) rv.addGlobal(this.pre.global, `${this.name} (${g})`)
      if (this.pre.instance) {
        const inst = this.replaceVariables(this.pre.instance, vars, rv, ctx)
        if (inst.trim() !== '') rv.defs += `\n// #instance: ${this.name} (${g})\n${inst}\n\n`
      }
    }
    if (this.pre.code && !String(out[out.type]).includes('@NOCODE')) {
      const vi = ctx.getVariant(this, uv)
      vars.name_uv = `${g}_${ctx.getVariant(this, uv)}` // asked twice on purpose: the second call gives the new index
      if (vi === -1) {
        const code = this.replaceVariables(this.pre.code, vars, rv, ctx)
        if (code !== '') rv.code += `\n// #code: ${this.name} (${g})\n${code}`
      }
    }
    const variant = uv + ',' + output
    let vi = ctx.getVariant(this, variant)
    let assign = false
    if (vi === -1) {
      vi = ctx.getVariant(this, variant)
      assign = true
    }
    let useAlias = false
    for (const f of Object.keys(IO_TYPES)) {
      if (!(f in out) || typeof out[f] !== 'string') continue
      const expr = this.replaceVariables(out[f].replace('@NOCODE', '').replace('@KEEPTYPE', '').trim(), vars, rv, ctx)
      if (rv.alias && out[f].includes('@KEEPTYPE')) useAlias = true
      if (!useAlias) {
        const v = `${g}_${output}_${vi}_${f}`
        if (assign) rv.code += `\n// #output${output}: ${this.name} (${g})\n${IO_TYPES[f].type} ${v} = ${expr};\n`
        rv.outputValues[f] = v
      }
    }
    if (useAlias && rv.alias) {
      rv.outputValues = rv.alias.outputValues
      rv.outputType = rv.alias.outputType
    } else rv.outputType = out.type
    return rv
  }

  _deserialize(data: Json) {
    if (data.shader_model) this.setShaderModel(data.shader_model)
    if (data.generic_size !== undefined && this.isGeneric()) {
      this.genericSize = Math.max(1, Math.trunc(+data.generic_size))
      this.setShaderModel(this.model)
    }
  }
}

// --- graphs and their helper nodes ---

export class GenGraph extends Gen {
  children: Gen[] = []
  connections: { from: string; from_port: number; to: string; to_port: number }[] = []
  transmitsSeed = true
  label = 'Graph'
  private library: NodeLibrary
  constructor(library: NodeLibrary) {
    super()
    this.library = library
  }
  type() {
    return 'graph'
  }
  child(name: string) {
    return this.children.find(c => c.name === name)
  }
  getParameterDefs() {
    return this.child('gen_parameters')?.getParameterDefs() ?? []
  }
  setParameter(n: string, v: Json) {
    super.setParameter(n, v)
    this.child('gen_parameters')?.setParameter(n, v)
  }
  getInputDefs() {
    return this.child('gen_inputs')?.getOutputDefs() ?? []
  }
  getOutputDefs() {
    return this.child('gen_outputs')?.getInputDefs() ?? []
  }
  hasRandomness() {
    return this.transmitsSeed && this.children.some(c => c.hasRandomness() && !c.seedLocked)
  }
  buffers() {
    return this.children.flatMap(c => c.buffers())
  }
  namedParameters(): Record<string, { id: string; value: number }> {
    const out: Record<string, { id: string; value: number }> = {}
    for (const c of this.children) if (c instanceof GenRemote) Object.assign(out, c.namedParameters())
    return out
  }

  getPortSource(genName: string, inputIndex: number): { gen: Gen; output: number } | null {
    let rv: { gen: Gen; output: number } | null = null
    if (genName === 'gen_inputs') {
      if (this.parent) rv = this.parent.getPortSource(this.name, inputIndex)
    } else {
      for (const c of this.connections) {
        if (c.to !== genName || c.to_port !== inputIndex) continue
        const src = this.child(c.from)
        if (src) rv = src instanceof GenGraph ? src.getPortSource('gen_outputs', c.from_port) : { gen: src, output: c.from_port }
      }
    }
    if (rv && rv.gen.name === 'gen_inputs' && rv.gen.parent === this) rv = this.getPortSource('gen_inputs', rv.output)
    return rv
  }

  _getShaderCode(uv: string, output: number, ctx: GenContext): ShaderCode {
    return this.child('gen_outputs')?._getShaderCode(uv, output, ctx) ?? new ShaderCode()
  }

  _deserialize(data: Json) {
    if (data.label) this.label = data.label
    for (const n of data.nodes ?? []) {
      const gen = createGen(n, this.library)
      if (!gen) continue
      gen.parent = this
      this.children.push(gen)
    }
    this.connections = Array.isArray(data.connections) ? data.connections : []
    for (const c of this.children) if (c instanceof GenRemote) c.applyAll()
  }
}

export class GenIOs extends Gen {
  ports: Json[] = []
  type() {
    return 'ios'
  }
  private io() {
    return this.ports.map(p => ({ name: p.name, type: p.type }))
  }
  getInputDefs() {
    return this.name === 'gen_inputs' ? [] : this.io()
  }
  getOutputDefs() {
    return this.name === 'gen_outputs' ? [] : this.io()
  }
  _getShaderCode(uv: string, output: number, ctx: GenContext): ShaderCode {
    const src = this.getSource(output)
    return src ? src.gen._getShaderCode(uv, src.output, ctx) : defaultShaderCode()
  }
  _deserialize(data: Json) {
    this.ports = (data.ports ?? []).map((p: Json) => ({ ...p }))
  }
}

export class GenSwitch extends Gen {
  type() {
    return 'switch'
  }
  getParameterDefs() {
    return [
      { name: 'outputs', type: 'float', default: 2 },
      { name: 'choices', type: 'float', default: 2 },
      { name: 'source', type: 'float', default: 0 },
    ]
  }
  getOutputDefs() {
    return Array.from({ length: +this.getParameter('outputs') }, (_, o) => ({ name: String.fromCharCode(65 + o), type: 'any' }))
  }
  _getShaderCode(uv: string, output: number, ctx: GenContext): ShaderCode {
    const src = this.getSource(output + Math.trunc(+this.getParameter('source')) * Math.trunc(+this.getParameter('outputs')))
    return src ? src.gen._getShaderCode(uv, src.output, ctx) : defaultShaderCode()
  }
}

/** Remote: graph-level controls that set parameters on nodes inside the graph (gen_remote.gd). */
export class GenRemote extends Gen {
  widgets: Json[] = []
  type() {
    return 'remote'
  }
  getParameterDefs() {
    const rv: Json[] = []
    for (const w of this.widgets) {
      let p: Json
      if (w.type === 'config_control') {
        const keys = Object.keys(w.configurations ?? {}).sort()
        p = keys.join() === 'False,True' ? { name: w.name, type: 'boolean' } : { name: w.name, type: 'enum', values: keys.map(k => ({ name: k, value: k })) }
      } else if (w.type === 'linked_control') {
        const l = w.linked_widgets?.[0]
        const def = l && this.parent?.child(l.node)?.getParameterDefs().find(d => d.name === l.widget)
        p = { ...(def ?? {}), name: w.name }
      } else if (w.type === 'named_parameter') p = { name: w.name, type: 'float', min: w.min, max: w.max, step: w.step, default: w.default }
      else continue
      p.label = w.label
      rv.push(p)
    }
    return rv
  }
  setParameter(n: string, v: Json) {
    const w = this.widgets.find(w => w.name === n)
    const graph = this.parent
    if (w && graph) {
      if (w.type === 'linked_control') for (const l of w.linked_widgets ?? []) graph.child(l.node)?.setParameter(l.widget, v)
      else if (w.type === 'config_control') {
        const i = typeof v === 'boolean' ? (v ? 1 : 0) : Math.trunc(+v)
        const keys = Object.keys(w.configurations ?? {}).sort()
        if (i >= 0 && i < keys.length) for (const c of w.configurations[keys[i]]) graph.child(c.node)?.setParameter(c.widget, c.value)
      }
    }
    super.setParameter(n, v)
    if (graph && this.name === 'gen_parameters') graph.parameters[n] = v
  }
  /** Pushes every stored value to its linked nodes once the whole graph is loaded. */
  applyAll() {
    for (const [k, v] of Object.entries(this.parameters)) this.setParameter(k, v)
  }
  namedParameters(): Record<string, { id: string; value: number }> {
    const out: Record<string, { id: string; value: number }> = {}
    for (const w of this.widgets) if (w.type === 'named_parameter') out[w.name] = { id: `${this.genname}_${w.name}`, value: +(this.getParameter(w.name) ?? w.default ?? 0) }
    return out
  }
  _getShaderCode() {
    return new ShaderCode()
  }
  _deserialize(data: Json) {
    this.widgets = JSON.parse(JSON.stringify(data.widgets ?? []))
  }
  deserialize(data: Json) {
    // remote values are applied in applyAll(), after their linked nodes exist
    this._deserialize(data)
    this.name = data.name ?? ''
    this.parameters = { ...(data.parameters ?? {}) }
  }
}

/** Buffer: renders its input into a texture once, so heavy nodes after it sample a picture (gen_buffer.gd). */
export class GenBuffer extends Gen {
  version = 0
  type() {
    return 'buffer'
  }
  get textureName() {
    return this.genname + '_tex'
  }
  getParameterDefs() {
    const defs: Json[] = [{ name: 'size', type: 'size', default: 9 }]
    if (this.version === 0) defs.push({ name: 'lod', type: 'float', default: 0 })
    if (this.version === 2) defs.push({ name: 'filter', type: 'boolean', default: true }, { name: 'mipmap', type: 'boolean', default: true }, { name: 'f32', type: 'boolean', default: false })
    return defs
  }
  getInputDefs() {
    return [{ name: 'in', type: 'rgba' }]
  }
  getOutputDefs() {
    return this.version === 0 ? [{ type: 'rgba' }, { type: 'rgba' }] : [{ type: 'rgba' }]
  }
  buffers() {
    return [this]
  }
  size() {
    return Math.pow(2, Math.trunc(+this.getParameter('size')))
  }
  /** The shader that fills this buffer's texture. */
  sourceCode(): ShaderCode {
    const src = this.getSource(0)
    const rv = src ? src.gen.getShaderCode('uv', src.output, new GenContext()) : defaultShaderCode()
    return rv.outputType ? rv : defaultShaderCode()
  }
  getOutputAttributes(): Record<string, string> {
    return { texture: this.textureName, texture_size: this.genname + '_tex_size' }
  }
  adjustedUv(uv: string) {
    if (this.version === 2 && !this.getParameter('filter')) return `((floor(fract(${uv}) * ${this.genname}_tex_size)+vec2(0.5))/${this.genname}_tex_size)`
    return `fract(${uv})`
  }
  _getShaderCode(uv: string, output: number, ctx: GenContext): ShaderCode {
    const lod = output === 0 ? -1 : +this.getParameter('lod')
    const rv = textureSample(this, uv, ctx, lod, this.textureName, this.adjustedUv(uv))
    rv.addUniform(this.genname + '_tex_size', 'float', this.size())
    return rv
  }
  _deserialize(data: Json) {
    this.version = data.version ?? 0
  }
}

/** Iterate buffer: renders `in` once, then feeds the picture through `loop_in` again and again (gen_iterate_buffer.gd). */
export class GenIterateBuffer extends Gen {
  /** Set by the renderer while it runs the loop. */
  iteration = 0
  type() {
    return 'iterate_buffer'
  }
  getParameterDefs() {
    return [
      { name: 'size', type: 'size', default: 9 },
      { name: 'shrink', type: 'boolean', default: false },
      { name: 'autostop', type: 'boolean', default: false },
      { name: 'iterations', type: 'float', default: 5 },
      { name: 'filter', type: 'boolean', default: true },
      { name: 'mipmap', type: 'boolean', default: true },
      { name: 'f32', type: 'boolean', default: false },
    ]
  }
  getInputDefs() {
    return [{ name: 'in', type: 'rgba' }, { name: 'loop_in', type: 'rgba' }]
  }
  getOutputDefs() {
    return [{ type: 'rgba' }, { type: 'rgba' }]
  }
  buffers() {
    return [this]
  }
  size() {
    return Math.pow(2, Math.trunc(+this.getParameter('size')))
  }
  get outputTexture() {
    return this.genname + '_it_tex'
  }
  get loopTexture() {
    return this.genname + '_loop_tex'
  }
  get iterationName() {
    return this.genname + '_iteration'
  }
  sourceCode(input: 0 | 1): ShaderCode {
    const src = this.getSource(input)
    const rv = src ? src.gen.getShaderCode('uv', src.output, new GenContext()) : defaultShaderCode()
    return rv.outputType ? rv : defaultShaderCode()
  }
  getOutputAttributes(output: number): Record<string, string> {
    const a: Record<string, string> = { texture: output === 0 ? this.outputTexture : this.loopTexture, texture_size: this.genname + '_it_tex_size' }
    if (output === 1) a.iteration = this.iterationName
    return a
  }
  _getShaderCode(uv: string, output: number, ctx: GenContext): ShaderCode {
    const g = this.genname
    const adjusted = this.getParameter('filter') ? `fract(${uv})` : `((floor(fract(${uv}) * ${g}_it_tex_size)+vec2(0.5))/${g}_it_tex_size)`
    const rv = textureSample(this, uv, ctx, -1, output === 0 ? this.outputTexture : this.loopTexture, adjusted)
    rv.addUniform(g + '_it_tex_size', 'float', this.size())
    rv.addUniform(this.iterationName, 'int', this.iteration)
    return rv
  }
}

// Buffers always hand on RGBA. Material Maker samples greyscale buffers as `.r`; since such a buffer
// holds vec4(vec3(v), 1.0), the rgba→f conversion gives the same value without knowing the type up front.
function textureSample(gen: Gen, uv: string, ctx: GenContext, lod: number, texture: string, adjustedUv: string): ShaderCode {
  const g = gen.genname
  const rv = new ShaderCode()
  rv.outputType = 'rgba'
  let vi = ctx.getVariant(gen, uv)
  if (vi === -1) {
    vi = ctx.getVariant(gen, uv)
    rv.addUniform(texture, 'sampler2D', texture)
    if (lod < 0) rv.code = `vec4 ${g}_${vi} = textureLod(${texture}, ${adjustedUv}, 0.0);\n`
    else {
      rv.addUniform(`p_${g}_lod`, 'float', lod)
      rv.code = `vec4 ${g}_${vi} = textureLod(${texture}, ${adjustedUv}, p_${g}_lod);\n`
    }
  }
  rv.outputValues[rv.outputType] = `${g}_${vi}`
  return rv
}

/** Node kinds Material Lab can't run yet. Graphs that contain them are left out of the node list. */
export const UNSUPPORTED_NODE_TYPES = ['material_export', 'meshmap', 'image', 'text', 'webcam', 'sdf', 'export', 'autoexport', 'debug', 'portal']

export class UnsupportedNodeError extends Error {}

/** Builds a generator from saved node data, following loader.gd's create_gen. */
export function createGen(data: Json, library: NodeLibrary): Gen | null {
  if (data.type === 'comment' || data.type === 'comment_line' || data.type === 'reroute') return null
  let gen: Gen
  if (data.shader_model?.preview_shader) throw new UnsupportedNodeError('material_export')
  if (data.is_brush) throw new UnsupportedNodeError('brush')
  else if (data.connections || data.nodes) gen = new GenGraph(library)
  else if (data.shader_model || data.model_data) gen = new GenShader(library)
  else if (data.widgets) gen = new GenRemote()
  else if (data.type === 'buffer') gen = new GenBuffer()
  else if (data.type === 'iterate_buffer') gen = new GenIterateBuffer()
  else if (data.type === 'ios') gen = new GenIOs()
  else if (data.type === 'switch') gen = new GenSwitch()
  else if (UNSUPPORTED_NODE_TYPES.includes(data.type)) throw new UnsupportedNodeError(data.type)
  else {
    // a node from the library: load its definition, then this copy's own values on top
    const def = library.get(data.type)
    if (!def) throw new UnsupportedNodeError(`unknown node ${data.type}`)
    const g = createGen(def, library)
    if (!g) return null
    if (g instanceof GenShader && data.generic_size !== undefined) g._deserialize({ generic_size: data.generic_size })
    g.loadCommon({ ...data, name: data.name ?? data.type })
    return g
  }
  gen.deserialize(data)
  return gen
}
