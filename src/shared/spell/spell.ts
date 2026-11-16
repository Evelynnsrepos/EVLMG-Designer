import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/core/fs'
import { useProjectStore, useSettings } from '@/core/state'
import { ENTITY_TYPES } from '@/core/model'
import type { Lang } from './lang'
import { GAME_WORDS, KNOWN_WRONG } from './words'

/**
 * Offline spell checking (v0.4). The dictionaries live in the Rust side
 * (src-tauri/src/spell.rs); this module tokenizes text, caches answers and
 * adds the words the app already knows: the personal dictionary and the names
 * of the project's items, characters, towns and enemies.
 */

export interface WordRange {
  word: string
  from: number
  to: number
}

const WORD = /[\p{L}\p{M}][\p{L}\p{M}'’-]*[\p{L}\p{M}]|[\p{L}\p{M}]/gu

/** Words worth checking in a piece of text, with offsets. Skips single letters and words with digits. */
export function tokenize(text: string): WordRange[] {
  const out: WordRange[] = []
  for (const m of text.matchAll(WORD)) {
    const word = m[0]
    if (word.length < 2) continue
    const before = text[m.index - 1]
    const after = text[m.index + word.length]
    if ((before && /\d/.test(before)) || (after && /\d/.test(after))) continue
    out.push({ word, from: m.index, to: m.index + word.length })
  }
  return out
}

/** Like `tokenize`, but "Boss-Fight" is two words, so each half is checked in its own language. */
export function tokenizeParts(text: string): WordRange[] {
  return tokenize(text).flatMap((w) => {
    // Not prose: ABBREVIATIONS, camelCase names, and parts of links, e-mail addresses and file names.
    if (w.word === w.word.toUpperCase() || /\p{Ll}\p{Lu}/u.test(w.word)) return []
    if (/[\p{L}\d][./\\@_]$|:\/\/$/u.test(text.slice(0, w.from)) || /^(?:[./\\@_][\p{L}\d]|:\/\/)/u.test(text.slice(w.to))) return []
    if (!w.word.includes('-')) return [w]
    let at = w.from
    return w.word.split('-').flatMap((part) => {
      const from = at
      at += part.length + 1
      return part.length < 2 ? [] : [{ word: part, from, to: from + part.length }]
    })
  })
}

/** Where the dictionaries come from: the desktop app, or a stand-in for tests. */
export interface SpellBackend {
  check(lang: string, words: string[]): Promise<boolean[]>
  suggest(lang: string, word: string): Promise<string[]>
}
const tauriBackend: SpellBackend = {
  check: (lang, words) => invoke<boolean[]>('spell_check', { langs: [lang], words }),
  suggest: (lang, word) => invoke<string[]>('spell_suggest', { langs: [lang], word, limit: 12 }),
}
let backend: SpellBackend | null = null
export function setSpellBackend(b: SpellBackend | null) {
  backend = b
  cache.en.clear()
  cache.de.clear()
  suggestions.clear()
}

export function spellAvailable(): boolean {
  return backend !== null || isTauri()
}

const cache: Record<Lang, Map<string, boolean>> = { en: new Map(), de: new Map() }

/** The spell check languages the user turned on. */
export function spellLangs(): Lang[] {
  return useSettings.getState().spellLanguages.filter((l): l is Lang => l === 'en' || l === 'de')
}

/** Lowercased words the user or the project already defined. */
export function knownWords(): Set<string> {
  const known = new Set(useSettings.getState().personalWords.map((w) => w.toLowerCase()))
  const { entities } = useProjectStore.getState()
  for (const type of ENTITY_TYPES) {
    for (const e of entities[type] ?? []) for (const w of tokenize(e.name)) known.add(w.word.toLowerCase())
  }
  return known
}

export interface WordInfo {
  en: boolean
  de: boolean
}

/** Which dictionary knows each word. A language that is turned off knows nothing. */
export async function lookup(words: string[]): Promise<(word: string) => WordInfo> {
  const b = backend ?? tauriBackend
  for (const lang of spellLangs()) {
    const todo = [...new Set(words)].filter((w) => !cache[lang].has(w))
    if (!todo.length) continue
    const ok = await b.check(lang, todo)
    todo.forEach((w, i) => cache[lang].set(w, ok[i]))
  }
  const on = spellLangs()
  return (w) => ({ en: on.includes('en') && cache.en.get(w) === true, de: on.includes('de') && cache.de.get(w) === true })
}

const cap = (w: string) => w[0].toUpperCase() + w.slice(1)

/** American spellings of a British word ("colour" → "color"); the English dictionary is American. */
function british(w: string): string[] {
  const out = [w.replace(/our(?=$|s$|ed$|ing$|ful|able|ite)/, 'or'), w.replace(/is(?=e$|es$|ed$|ing$|ation)/, 'iz'), w.replace(/ys(?=e$|es$|ed$|ing$)/, 'yz'), w.replace(/tre(s?)$/, 'ter$1'), w.replace(/ll(?=ed$|ing$|er$|ers$)/, 'l'), w.replace(/ence(s?)$/, 'ense$1'), w.replace(/grey/, 'gray'), w.replace(/ogue(s?)$/, 'og$1')]
  return out.filter((x) => x !== w)
}

/**
 * Words no dictionary lists but that are fine: game words, English + German compounds
 * ("Bosskampf", "Levelaufstieg") and English verbs used the German way ("gespawnt").
 * Returns the ones from `words` that are fine; `german` = the sentence is clearly German.
 */
export async function borrowedOk(words: { word: string; german: boolean }[]): Promise<Set<string>> {
  const ok = new Set<string>()
  const tries: { word: string; parts: [string, string][]; stems: string[] }[] = []
  for (const { word, german } of words) {
    const lower = word.toLowerCase()
    if (GAME_WORDS.has(lower) || GAME_WORDS.has(lower.replace(/s$/, ''))) {
      ok.add(word)
      continue
    }
    if (!/^\p{L}+$/u.test(word)) continue
    const us = british(lower)
    const parts: [string, string][] = []
    // A noun made of two words: the second one has to be a German noun or a game word.
    if (word[0] !== lower[0] && word.length >= 7)
      for (let k = 4; k <= word.length - 3; k++) {
        parts.push([word.slice(0, k), word.slice(k)])
        if (word[k - 1] === 's' && k > 4) parts.push([word.slice(0, k - 1), word.slice(k)])
      }
    const stems: string[] = []
    if (german) {
      const m = /^ge(\p{L}{3,}?)e?t$/u.exec(lower) ?? /^(\p{L}{4,}?)(?:e?t|e?st|en|te|ten)$/u.exec(lower)
      if (m) stems.push(m[1])
    }
    if (parts.length || stems.length || us.length) tries.push({ word, parts, stems: [...stems, ...us] })
  }
  if (!tries.length) return ok
  const info = await lookup(tries.flatMap((t) => [...t.parts.flatMap(([a, b]) => [a, a.toLowerCase(), cap(b), b]), ...t.stems]))
  const any = (w: string) => info(w).en || info(w).de
  for (const t of tries) {
    const compound = t.parts.some(([a, b]) => (any(a) || any(a.toLowerCase()) || GAME_WORDS.has(a.toLowerCase())) && (info(cap(b)).de || GAME_WORDS.has(b)))
    if (compound || t.stems.some((s) => info(s).en && !info(s).de)) ok.add(t.word)
  }
  return ok
}

/** The words from `words` that are misspelled in every language that is turned on. Kept for callers that only need a yes/no. */
export async function findMisspelled(words: string[]): Promise<Set<string>> {
  if (!spellAvailable() || spellLangs().length === 0) return new Set()
  const info = await lookup(words)
  const known = knownWords()
  const bad = words.filter((w) => !info(w).en && !info(w).de && !known.has(w.toLowerCase()))
  const fine = await borrowedOk(bad.map((word) => ({ word, german: false })))
  return new Set(bad.filter((w) => !fine.has(w)))
}

// Letters that people who spell by sound swap: cheap to change, so the word they mean wins.
const GROUPS = ['aeiouyäöü', 'bdpq', 'mn', 'cksz', 'fvw', 'gj', 'td']
const group = (c: string) => GROUPS.findIndex((g) => g.includes(c))

/** How far `b` is from `a`, where swapped neighbours, doubled letters and sound-alike letters count less than a full change. */
export function soundDistance(a: string, b: string): number {
  a = a.toLowerCase().replace(/ß/g, 'ss').replace(/['’]/g, '')
  b = b.toLowerCase().replace(/ß/g, 'ss').replace(/['’]/g, '')
  const n = a.length
  const m = b.length
  const d = Array.from({ length: n + 1 }, () => new Float32Array(m + 1))
  // A doubled letter, a silent h or an e costs less to add or drop.
  // "ck" for "k" and "ie" for "i" sound the same too.
  const gap = (s: string, i: number) =>
    s[i] === s[i - 1] || s[i] === s[i + 1] || (s[i] === 'c' && s[i + 1] === 'k') ? 0.3 : s[i] === 'h' ? 0.5 : s[i] === 'e' ? 0.7 : 1
  for (let i = 1; i <= n; i++) d[i][0] = d[i - 1][0] + gap(a, i - 1)
  for (let j = 1; j <= m; j++) d[0][j] = d[0][j - 1] + gap(b, j - 1)
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const x = a[i - 1]
      const y = b[j - 1]
      const sub = x === y ? 0 : group(x) >= 0 && group(x) === group(y) ? 0.6 : 1
      let best = Math.min(d[i - 1][j - 1] + sub, d[i - 1][j] + gap(a, i - 1), d[i][j - 1] + gap(b, j - 1))
      if (i > 1 && j > 1 && x === b[j - 2] && a[i - 2] === y) best = Math.min(best, d[i - 2][j - 2] + 0.5)
      d[i][j] = best
    }
  return d[n][m]
}

/** Common words of a language, most used first (freq/*.txt), loaded when the first suggestion is asked for. */
const common: Partial<Record<Lang, Promise<string[]>>> = {}
const rankOf: Partial<Record<Lang, Map<string, number>>> = {}
function commonWords(lang: Lang): Promise<string[]> {
  return (common[lang] ??= (lang === 'en' ? import('./freq/en.txt?raw') : import('./freq/de.txt?raw')).then((m) => {
    const list = m.default.split('\n')
    rankOf[lang] = new Map(list.map((w, i) => [w.toLowerCase(), i]))
    return list
  }))
}
/** 0 for the most used word, 1 for a rare or unlisted one: of two words that fit, the everyday one is meant more often. */
const rarity = (lang: Lang, word: string) => ((rankOf[lang]?.get(word.toLowerCase()) ?? 45000) / 30000) ** 0.5 * 0.8

/** Common words that sound like `word`. The dictionary guesses by letters and misses these ("buisness" → "business"). */
async function soundAlikes(word: string, lang: Lang): Promise<{ word: string; d: number }[]> {
  const w = word.toLowerCase()
  const max = Math.max(1.3, w.length * 0.3)
  const out: { word: string; d: number }[] = []
  for (const c of await commonWords(lang)) {
    if (Math.abs(c.length - w.length) > 3) continue
    const l = c.toLowerCase()
    // Spelling by sound keeps the start of a word: same first letter, or the first two swapped.
    if (l[0] !== w[0] && !(l[0] === w[1] && l[1] === w[0])) continue
    const d = soundDistance(w, l)
    if (d <= max) out.push({ word: c, d })
  }
  return out
}

export interface Ranked {
  word: string
  lang: Lang
  score: number
}
const suggestions = new Map<string, Ranked[]>()

/**
 * Ways to spell `word`, best first: the list of known misspellings, then both dictionaries'
 * ideas sorted by how alike they sound, with the sentence's language in front.
 */
export async function suggestRanked(word: string, lang: Lang): Promise<Ranked[]> {
  const langs = spellLangs()
  if (!spellAvailable() || langs.length === 0) return []
  const key = `${lang}\u0000${langs.join()}\u0000${word}`
  const hit = suggestions.get(key)
  if (hit) return hit
  const b = backend ?? tauriBackend
  const lower = word.toLowerCase()
  const out = new Map<string, Ranked>()
  const add = (w: string, l: Lang, score: number) => {
    if (w !== word && (!out.has(w) || out.get(w)!.score > score)) out.set(w, { word: w, lang: l, score })
  }
  for (const l of [lang, ...langs.filter((x) => x !== lang)]) {
    const typedCap = word[0] !== lower[0]
    for (const c of await soundAlikes(word, l).catch(() => [])) add(typedCap && c.word[0] === c.word[0].toLowerCase() ? cap(c.word) : c.word, l, c.d + rarity(l, c.word) + (l === lang ? 0 : 0.8))
    const known = KNOWN_WRONG[l].get(lower)
    // Typed with a capital (start of a sentence): keep it.
    if (known) add(word[0] !== lower[0] && known[0] === known[0].toLowerCase() ? cap(known) : known, l, l === lang ? -2 : -1)
    for (const s of await b.suggest(l, word).catch(() => [])) {
      let score = soundDistance(word, s) + rarity(l, s)
      if (/[ -]/.test(s)) score += 1.5
      if (l !== lang) score += 0.8
      // A name where a normal word was typed is rarely meant; in German a capital is just a noun.
      if (s[0] !== s[0].toLowerCase() && word[0] === lower[0] && l === 'en') score += 0.7
      add(s, l, score)
    }
  }
  // Two words typed as one ("andthen"): split where both halves are words, best when one is an everyday word.
  if (lower.length >= 5 && /^\p{L}+$/u.test(word)) {
    const cuts = Array.from({ length: lower.length - 3 }, (_, k) => [word.slice(0, k + 2), word.slice(k + 2)])
    const info = await lookup(cuts.flat()).catch(() => null)
    for (const [a, b2] of info ? cuts : []) if (info!(a)[lang] && info!(b2)[lang]) add(`${a} ${b2}`, lang, 0.7 + rarity(lang, a) + rarity(lang, b2))
  }
  const ranked = [...out.values()].sort((x, y) => x.score - y.score)
  suggestions.set(key, ranked)
  return ranked
}

/** Suggestions for a misspelled word (the first enabled language leads). */
export async function suggest(word: string, limit = 6): Promise<string[]> {
  return (await suggestRanked(word, spellLangs()[0] ?? 'en')).slice(0, limit).map((r) => r.word)
}
