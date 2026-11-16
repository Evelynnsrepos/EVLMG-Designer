import { StreamLanguage, type StreamParser } from '@codemirror/language'

/** Our own small GDScript grammar (Godot 4): enough for colours and indenting; meaning comes from Godot's language server. */

const KEYWORDS = new Set(
  'if elif else for while match when break continue pass return class class_name extends is in as self super signal func static const enum var breakpoint preload await yield assert void and or not namespace trait'.split(' '),
)
const ATOMS = new Set('true false null PI TAU INF NAN'.split(' '))
const TYPES = new Set(
  'bool int float String StringName NodePath Vector2 Vector2i Vector3 Vector3i Vector4 Vector4i Rect2 Rect2i Transform2D Transform3D Basis Quaternion Plane AABB Projection Color RID Callable Signal Dictionary Array Variant Object PackedByteArray PackedInt32Array PackedInt64Array PackedFloat32Array PackedFloat64Array PackedStringArray PackedVector2Array PackedVector3Array PackedColorArray PackedVector4Array'.split(
    ' ',
  ),
)

interface State {
  /** Inside a `"""` or `'''` string: its quote. */
  triple: string | null
  /** The last word was `func`, `class`, `signal`…: the next word is a name being defined. */
  defining: boolean
  /** The current line's indent in columns, and whether its code ends in ":" so far (the next line goes one step in). */
  indent: number
  colon: boolean
}

function stringRest(stream: { next(): string | void; eol(): boolean }, quote: string) {
  let escaped = false
  while (!stream.eol()) {
    const ch = stream.next()
    if (ch === quote && !escaped) return
    escaped = !escaped && ch === '\\'
  }
}

const parser: StreamParser<State> = {
  name: 'gdscript',
  startState: () => ({ triple: null, defining: false, indent: 0, colon: false }),
  token(stream, state) {
    if (stream.sol() && !state.triple) {
      state.indent = stream.indentation()
      state.colon = false
    }
    if (state.triple) {
      const end = stream.string.indexOf(state.triple.repeat(3), stream.pos)
      if (end < 0) stream.skipToEnd()
      else {
        stream.pos = end + 3
        state.triple = null
      }
      return 'string'
    }
    if (stream.eatSpace()) return null
    const defining = state.defining
    state.defining = false
    if (stream.match('#')) {
      stream.skipToEnd()
      return 'comment'
    }
    state.colon = false
    // r"raw", &"StringName", ^"NodePath" and plain strings
    if (stream.match(/^[r&^]?("""|''')/)) {
      state.triple = stream.current().slice(-1)
      return parser.token!(stream, state)
    }
    if (stream.match(/^[r&^]?["']/)) {
      stringRest(stream, stream.current().slice(-1))
      return 'string'
    }
    // $Player/Sprite2D, $"Some Node", %UniqueName
    if (stream.match(/^\$"/)) {
      stringRest(stream, '"')
      return 'string-2'
    }
    if (stream.match(/^[$%][A-Za-z_][\w/%]*/)) return 'string-2'
    if (stream.match(/^@[A-Za-z_]\w*/)) return 'meta'
    if (stream.match(/^(0x[\da-f_]+|0b[01_]+|\d[\d_]*\.?[\d_]*(e[+-]?\d+)?|\.\d[\d_]*)/i)) return 'number'
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const word = stream.current()
      if (defining) return 'def'
      if (KEYWORDS.has(word)) {
        state.defining = word === 'func' || word === 'class' || word === 'class_name' || word === 'signal' || word === 'enum'
        return 'keyword'
      }
      if (ATOMS.has(word)) return 'atom'
      if (TYPES.has(word) || /^[A-Z][a-z0-9]+[A-Za-z0-9]*$/.test(word)) return 'type'
      if (/^[A-Z][A-Z0-9_]+$/.test(word)) return 'atom'
      if (stream.peek() === '(') return 'variable-2'
      return 'variable'
    }
    if (stream.match(/^(->|:=|[-+*/%&|^~<>!=]=?|\*\*|<<|>>)/)) return 'operator'
    state.colon = stream.next() === ':'
    return null
  },
  indent: (state, _textAfter, cx) => state.indent + (state.colon ? cx.unit : 0),
  languageData: { commentTokens: { line: '#' }, closeBrackets: { brackets: ['(', '[', '{', '"', "'"] } },
}

export const gdscript = StreamLanguage.define(parser)
