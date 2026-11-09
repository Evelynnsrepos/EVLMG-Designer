import { newId, type Id } from '@/core/model'
import { parseCSV, toCSV } from '@/shared/csv'

/** Localization string table (v0.10): every player-facing text by key, in every language. */

export interface LocString {
  id: Id
  key: string
  /** Where it is used, a hint for translators. */
  context: string
  values: Record<string, string>
  /** 0.28: what the text belongs to (`dialogue:<doc>:<line>`), so renames and moved lines keep their translations. Missing = added by hand. */
  ref?: string
  /** 0.28: the source text each translation was made from; a different source now = "needs update". */
  base?: Record<string, string>
}

export interface LocDoc {
  /** Language codes, the first is the source language. */
  languages: string[]
  items: LocString[]
}

export const createLocDoc = (): LocDoc => ({ languages: ['en', 'de'], items: [] })
export const newString = (key = ''): LocString => ({ id: newId(), key, context: '', values: {} })

/** "The Old King's Crown" → "the_old_kings_crown". */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'text'

/** Share of strings translated per language (0–1). */
export function progress(d: LocDoc): Record<string, number> {
  const out: Record<string, number> = {}
  for (const l of d.languages) out[l] = d.items.length ? d.items.filter((s) => s.values[l]?.trim()).length / d.items.length : 1
  return out
}

export interface Found {
  /** Stable id of what the text belongs to; matched before the key. */
  ref?: string
  /** Readable key for a new string; an existing string keeps its key. */
  key: string
  context: string
  text: string
}

/** Translations made from an older source text: they need a look. */
export const needsUpdate = (d: LocDoc, s: LocString, lang: string) => {
  const was = s.base?.[lang]
  return lang !== d.languages[0] && was !== undefined && !!s.values[lang]?.trim() && was !== (s.values[d.languages[0]] ?? '')
}

/** Remember the current source text for every translated language (after someone translated or checked it). */
export const markTranslated = (d: LocDoc, s: LocString, langs = d.languages.slice(1)): LocString => {
  const src = s.values[d.languages[0]] ?? ''
  const base = { ...s.base }
  for (const l of langs) if (s.values[l]?.trim()) base[l] = src
  return { ...s, base }
}

/**
 * Add texts from the project as source strings. A string is found by its ref first (so a rename or a moved
 * dialogue line keeps its key and translations), then, for tables made before 0.28, by key.
 * A changed source keeps the translations but marks them "needs update". New keys never clash with old ones.
 */
export function merge(d: LocDoc, found: Found[]): { doc: LocDoc; added: number; updated: number } {
  const src = d.languages[0]
  let added = 0
  let updated = 0
  const items = [...d.items]
  const keys = new Set(items.map((s) => s.key))
  const freeKey = (k: string) => {
    let out = k
    for (let n = 2; keys.has(out); n++) out = `${k}_${n}`
    keys.add(out)
    return out
  }
  const claimed = new Set<number>()
  const legacy = (j: number) => !items[j].ref && !claimed.has(j)
  const todo = found.filter((f) => f.text.trim())
  // Pass 1: the same ref, or (tables before 0.28, whose keys came from positions) an unclaimed row with the same text.
  const at = todo.map((f) => {
    let i = f.ref ? items.findIndex((s) => s.ref === f.ref) : -1
    if (i < 0) i = items.findIndex((s, j) => legacy(j) && s.key === f.key && s.values[src] === f.text)
    if (i < 0) i = items.findIndex((s, j) => legacy(j) && s.values[src] === f.text)
    if (i >= 0) claimed.add(i)
    return i
  })
  // Pass 2: an unclaimed old row with the same key; its text changed, so its translations get marked.
  todo.forEach((f, n) => {
    if (at[n] >= 0) return
    at[n] = items.findIndex((s, j) => legacy(j) && s.key === f.key)
    if (at[n] >= 0) claimed.add(at[n])
  })
  todo.forEach((f, n) => {
    const i = at[n]
    if (i < 0) {
      items.push({ ...newString(freeKey(f.key)), context: f.context, values: { [src]: f.text }, ...(f.ref ? { ref: f.ref } : {}) })
      added++
      return
    }
    const s = items[i]
    const old = s.values[src] ?? ''
    let next: LocString = { ...s, context: f.context || s.context, ...(f.ref ? { ref: f.ref } : {}) }
    if (old !== f.text) {
      // Keep each translation's own base, or the text it was made from (the old source).
      const base = { ...s.base }
      for (const l of d.languages.slice(1)) if (s.values[l]?.trim() && base[l] === undefined) base[l] = old
      next = { ...next, base, values: { ...s.values, [src]: f.text } }
      updated++
    }
    items[i] = next
  })
  return { doc: { ...d, items }, added, updated }
}

export const exportCSV = (d: LocDoc) => toCSV([['key', 'context', ...d.languages], ...d.items.map((s) => [s.key, s.context, ...d.languages.map((l) => s.values[l] ?? '')])])

/** Read a CSV with a key column and one column per language; existing keys are updated. */
export function importCSV(d: LocDoc, text: string): LocDoc {
  const rows = parseCSV(text)
  if (rows.length < 2) return d
  const head = rows[0].map((h) => h.trim())
  const ki = head.findIndex((h) => h.toLowerCase() === 'key')
  if (ki < 0) return d
  const ci = head.findIndex((h) => h.toLowerCase() === 'context')
  const langs = head.filter((_, i) => i !== ki && i !== ci && head[i])
  const languages = [...d.languages, ...langs.filter((l) => !d.languages.includes(l))]
  const items = [...d.items]
  for (const r of rows.slice(1)) {
    const key = r[ki]?.trim()
    if (!key) continue
    const values: Record<string, string> = {}
    head.forEach((h, i) => i !== ki && i !== ci && h && r[i] !== undefined && r[i] !== '' && (values[h] = r[i]))
    const at = items.findIndex((s) => s.key === key)
    const translated = Object.keys(values).filter((l) => l !== languages[0])
    const doc = { languages, items }
    if (at < 0) items.push(markTranslated(doc, { ...newString(key), context: ci >= 0 ? (r[ci] ?? '') : '', values }, translated))
    else items[at] = markTranslated(doc, { ...items[at], values: { ...items[at].values, ...values } }, translated)
  }
  return { languages, items }
}
