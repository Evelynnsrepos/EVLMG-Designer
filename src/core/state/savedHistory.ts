/**
 * Undo history kept between sessions (0.31) for the document types in SAVED_HISTORY: written to
 * `.history/<type>/<id>.json` a few seconds after a step, read when the document opens. The steps are whole
 * snapshots; long strings (the PNG data of Pixel Art cels) are kept once in a table, since most steps share them.
 * A saved history is only used when its current state is the document as it is on disk now.
 */

export const SAVED_HISTORY = new Set<string>(['pixel-art'])

/** History files stop growing here: the oldest steps go first. */
export const MAX_HISTORY_BYTES = 64 * 1024 * 1024

const LONG = 256
const REF = '\u0001'

/** A short fingerprint of a document (FNV-1a over its JSON). */
export function fingerprint(value: unknown): string {
  const s = JSON.stringify(value) ?? ''
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return `${(h >>> 0).toString(16)}:${s.length}`
}

function pack(current: unknown, past: readonly unknown[], future: readonly unknown[]): string {
  const strings: string[] = []
  const index = new Map<string, number>()
  const body = JSON.stringify({ past, future }, (_k, v) => {
    if (typeof v !== 'string' || v.length < LONG) return v
    let i = index.get(v)
    if (i === undefined) index.set(v, (i = strings.push(v) - 1))
    return REF + i
  })
  return JSON.stringify({ version: 1, current: fingerprint(current), strings }) + '\n' + body
}

/** The history as file text, the oldest steps dropped until it fits `max` bytes (null when nothing to keep). */
export function packHistory(current: unknown, past: readonly unknown[], future: readonly unknown[], max = MAX_HISTORY_BYTES): string | null {
  let from = 0
  for (;;) {
    const text = pack(current, past.slice(from), future)
    if (text.length <= max || from >= past.length) return past.length - from + future.length ? text : null
    from += Math.max(1, Math.ceil((past.length - from) / 10))
  }
}

/** The saved steps, or null when the file is from another version of the document (or unreadable). */
export function unpackHistory(text: string, current: unknown): { past: unknown[]; future: unknown[] } | null {
  try {
    const cut = text.indexOf('\n')
    const head = JSON.parse(text.slice(0, cut)) as { version: number; current: string; strings: string[] }
    if (head.version !== 1 || head.current !== fingerprint(current)) return null
    const body = JSON.parse(text.slice(cut + 1), (_k, v) => (typeof v === 'string' && v.startsWith(REF) ? head.strings[Number(v.slice(1))] : v)) as { past: unknown[]; future: unknown[] }
    return Array.isArray(body.past) && Array.isArray(body.future) ? body : null
  } catch {
    return null
  }
}
