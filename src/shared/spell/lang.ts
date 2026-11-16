/**
 * Which language a sentence is written in, for people who mix English and German in one text.
 * No model: common words, German letters and which dictionary knows each word.
 */

export type Lang = 'en' | 'de'

export interface Sentence {
  text: string
  /** Offset of the sentence in its paragraph. */
  from: number
}

const ABBREV = /(?:^|[\s(])(?:z\.\s?B|d\.\s?h|u\.\s?a|e\.\s?g|i\.\s?e|bzw|ca|etc|vs|usw|Nr|No|Mr|Mrs|Dr|Inc|Ltd|Co|St|evtl|ggf|inkl|max|min|vgl|sog|approx|\p{L})\.$/u

/** Splits a paragraph into sentences. Abbreviations ("z.B.", "e.g.", "3.") do not end one. */
export function sentences(text: string): Sentence[] {
  const out: Sentence[] = []
  let from = 0
  for (const m of text.matchAll(/[.!?]+["'”“)\]]*\s+/g)) {
    const end = m.index + m[0].length
    const before = text.slice(from, m.index + 1)
    // "..." trails off, it does not end the sentence.
    if (m[0][0] === '.' && (m[0][1] === '.' || ABBREV.test(before) || /\d\.$/.test(before))) continue
    out.push({ text: text.slice(from, end), from })
    from = end
  }
  if (from < text.length) out.push({ text: text.slice(from), from })
  return out.filter((s) => s.text.trim())
}

/** The parts of a sentence between commas: people who mix languages often switch at a comma. */
export function clauses(text: string): Sentence[] {
  const out: Sentence[] = []
  let from = 0
  for (const m of text.matchAll(/[,;:–—]\s+/g)) {
    out.push({ text: text.slice(from, m.index), from })
    from = m.index + m[0].length
  }
  out.push({ text: text.slice(from), from })
  return out.filter((c) => c.text.trim())
}

const words = (s: string) => new Set(s.split(' '))
export const GERMAN = words(
  'der die das und ist nicht ein eine einen einem einer eines sie wir ich du ihr hat sind mit von zu den dem des auf für auch es sich war aber oder wenn dass weil wie was wer wo noch nur schon sehr kann muss soll wird werden wurde haben habe hast sein bin bist seid mein dein kein keine mehr als bei nach aus über unter vor durch gegen ohne um bis man dann doch mal hier dort jetzt immer nie wieder weil damit dieser diese dieses jeder alle viel viele etwas nichts ja nein vielleicht zum zur im am vom beim gibt geht machen macht gut neu groß klein also oder denn ob mir mich dir dich ihm ihn uns euch',
)
export const ENGLISH = words(
  'the and is not a an of to in it was he she they we with for on are that this you i have has had be been do does did but or if when what who where why how which there their then than so very can could will would should must my your his her its our me him them us at by from as about into over after before because just only also more most some any all no yes one two up out down off again here now always never still too much many these those were am being not maybe each other make made get got like want need',
)

/** How strongly a sentence looks English or German. `known` = which dictionaries know each word (optional). */
export function langScore(text: string, known?: (word: string) => { en: boolean; de: boolean } | undefined): { en: number; de: number } {
  let en = 0
  let de = 0
  for (const raw of text.split(/[^\p{L}\p{M}'’]+/u)) {
    if (!raw) continue
    const w = raw.toLowerCase()
    if (GERMAN.has(w)) de += 2
    if (ENGLISH.has(w)) en += 2
    if (/[äöüß]/.test(w)) de += 2
    const k = known?.(raw)
    if (k && k.de !== k.en) {
      if (k.de) de++
      else en++
    }
  }
  return { en, de }
}

export interface SentenceLang {
  lang: Lang
  /** True when one language clearly wins: only then context rules and cross-language checks run. */
  sure: boolean
}

/**
 * The language of every sentence. A sentence without a clear winner takes the language of the
 * sentence before it (or after it), then of the whole paragraph, then `fallback`.
 */
export function detectLangs(list: string[], allowed: Lang[], fallback: Lang, known?: (word: string) => { en: boolean; de: boolean } | undefined): SentenceLang[] {
  if (allowed.length < 2) return list.map(() => ({ lang: allowed[0] ?? fallback, sure: true }))
  const scores = list.map((s) => langScore(s, known))
  const pick = (s: { en: number; de: number }): Lang | null => (s.en === s.de ? null : s.en > s.de ? 'en' : 'de')
  const total = scores.reduce((a, s) => ({ en: a.en + s.en, de: a.de + s.de }), { en: 0, de: 0 })
  const own = scores.map(pick)
  return scores.map((s, i) => {
    const hi = Math.max(s.en, s.de)
    const lo = Math.min(s.en, s.de)
    const lang = own[i] ?? own[i - 1] ?? own[i + 1] ?? pick(total) ?? fallback
    return { lang, sure: own[i] !== null && hi >= 2 && hi >= lo * 2 + 1 }
  })
}
