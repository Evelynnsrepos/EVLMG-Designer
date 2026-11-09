// Godot's shader language accepts a few things WebGL2 GLSL doesn't. This rewrites them.
import { findMatchingParenthesis, splitParameters } from './gen'

const INT = /^-?\d+$/
// built-ins where Godot quietly turns a whole number into a float when the other arguments are floats
const MIXED_BUILTINS = new Set(['min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'pow', 'mod', 'atan', 'distance'])

/** `T a[] = { … };` → `T a[] = T[](…);` */
function fixArrayInitializers(src: string): string {
  const re = /\b(\w+)\s+(\w+)\s*\[\s*(\w*)\s*\]\s*=\s*\{/g
  let out = ''
  let last = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const open = m.index + m[0].length - 1
    const close = findMatchingParenthesis(src, open, '{', '}')
    if (close === -1) break
    out += src.slice(last, m.index) + `${m[1]} ${m[2]}[${m[3]}] = ${m[1]}[${m[3]}](${src.slice(open + 1, close).trim().replace(/,\s*$/, '')})`
    last = close + 1
    re.lastIndex = last
  }
  return out + src.slice(last)
}

/** Parameter types of every function declared in the source, by name (one entry per overload). */
function functionSignatures(src: string): Map<string, string[][]> {
  const sigs = new Map<string, string[][]>()
  for (const m of src.matchAll(/\b(?:void|float|int|bool|[biu]?vec[234]|mat[234])\s+(\w+)\s*\(([^()]*)\)\s*\{/g)) {
    const types = m[2].trim() === '' ? [] : m[2].split(',').map(p => p.trim().replace(/^(in|out|inout|const)\s+/, '').split(/\s+/)[0])
    sigs.set(m[1], [...(sigs.get(m[1]) ?? []), types])
  }
  return sigs
}

/** Rough types of declared variables: enough to tell float from int arguments. */
function variableTypes(src: string): { ints: Set<string>; floats: Set<string> } {
  const ints = new Set<string>()
  const floats = new Set<string>()
  for (const m of src.matchAll(/\b(int|float|[biu]?vec[234])\s+(\w+)/g)) (m[1] === 'int' || m[1].startsWith('ivec') ? ints : floats).add(m[2])
  for (const n of [...floats]) if (ints.has(n)) {
    floats.delete(n)
    ints.delete(n)
  }
  return { ints, floats }
}
// names in an expression, without swizzles and fields (`v.x` is just `v`)
const idents = (a: string) => a.replace(/\.\s*[A-Za-z_]\w*/g, '').match(/[A-Za-z_]\w*/g) ?? []
const looksFloat = (a: string, n: { floats: Set<string> }) => /\d\.\d*|\.\d/.test(a) || /\.[xyzwrgba]{1,4}\b/.test(a) || idents(a).some(i => n.floats.has(i) || i.startsWith('p_'))
const looksInt = (a: string, n: { ints: Set<string> }) => /\bint\s*\(/.test(a) || idents(a).some(i => n.ints.has(i))

/** Writes whole-number arguments as floats where the function wants a float. */
function fixIntArguments(src: string): string {
  const sigs = functionSignatures(src)
  const names = variableTypes(src)
  const re = /\b(\w+)\s*\(/g
  let out = ''
  let last = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const name = m[1]
    const own = sigs.get(name)
    if (!own && !MIXED_BUILTINS.has(name)) continue
    const open = m.index + m[0].length - 1
    const close = findMatchingParenthesis(src, open)
    if (close === -1) continue
    // a declaration, not a call
    if (/^\s*\{/.test(src.slice(close + 1, close + 20))) continue
    const args = splitParameters(src.slice(open, close + 1))
    let fixed: string[] | null = null
    if (own) {
      const sig = own.find(t => t.length === args.length)
      if (sig && own.filter(t => t.length === args.length).length === 1) fixed = args.map((a, i) => (sig[i] === 'float' && INT.test(a) ? a + '.0' : a))
    } else if (args.some(a => INT.test(a)) && args.some(a => !INT.test(a) && looksFloat(a, names)) && !args.some(a => looksInt(a, names))) {
      fixed = args.map(a => (INT.test(a) ? a + '.0' : a))
    }
    if (!fixed || fixed.join() === args.join()) continue
    out += src.slice(last, open) + '(' + fixed.join(', ') + ')'
    last = close + 1
    re.lastIndex = last
  }
  return out + src.slice(last)
}

export function godotToGlsl(src: string): string {
  src = fixArrayInitializers(src)
  // calls inside a fixed call's arguments get their turn on the next round
  for (let i = 0; i < 4; i++) {
    const next = fixIntArguments(src)
    if (next === src) break
    src = next
  }
  return src
}
