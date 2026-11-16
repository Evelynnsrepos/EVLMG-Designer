import { invoke } from '@tauri-apps/api/core'
import { useSettings } from '@/core/state'
import { useAiHelper } from './ai'
import { borrowedOk, knownWords, lookup, spellAvailable, spellLangs, suggestRanked, tokenize, tokenizeParts } from './spell'
import { clauses, detectLangs, langScore, sentences, type Lang } from './lang'
import { checkRules } from './rules'
import { KNOWN_WRONG } from './words'

/**
 * Spelling and AI grammar issues for plain paragraphs, shared by the rich text
 * editor and ProofTextarea. The AI helper rewrites a paragraph correctly and
 * the differences become blue underlines.
 */
export interface Issue {
  from: number
  to: number
  /** Spelling: the misspelled word. */
  word?: string
  /** AI or a writing hint: what to write instead of text[from..to]. */
  fix?: string
  /** A writing hint (rules.ts): every word that could be meant, the short explanation and the rule's id. */
  fixes?: string[]
  why?: string
  rule?: string
  /** The language of the sentence around it. */
  lang?: Lang
}

export interface Edit {
  from: number
  to: number
  fix: string
}

const TOKEN = /\s+|[\p{L}\p{M}\p{N}'’-]+|[^\s\p{L}\p{M}\p{N}]/gu

/**
 * The changes that turn `text` into `fixed`, word by word. A pure insertion (a missing comma)
 * is attached to the word before it so there is something to underline.
 */
export function diffEdits(text: string, fixed: string): Edit[] {
  const a = [...text.matchAll(TOKEN)].map((m) => ({ s: m[0], at: m.index }))
  const b = [...fixed.matchAll(TOKEN)].map((m) => m[0])
  // ponytail: O(n·m) LCS per paragraph; fine for paragraphs, split sentences if huge ones lag.
  const n = a.length
  const m = b.length
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i].s === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const changed = n + m - 2 * lcs[0][0]
  // A rewrite of most of the paragraph is a translation or a ramble, not a correction.
  if (changed > Math.max(4, (n + m) * 0.4)) return []

  const edits: Edit[] = []
  const end = (i: number) => (i < n ? a[i].at : text.length)
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i].s === b[j]) {
      i++
      j++
      continue
    }
    // Walk the LCS through one run of changes until the texts agree again.
    const i0 = i
    const j0 = j
    while ((i < n || j < m) && !(i < n && j < m && a[i].s === b[j])) {
      if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) j++
      else i++
    }
    let from = end(i0)
    let to = end(i)
    let fix = b.slice(j0, j).join('')
    if (!text.slice(from, to).trim() && !fix.trim()) continue
    if (from === to || !text.slice(from, to).trim()) {
      // Insertion: grow it over the word before (or after, at the start).
      const k = i0 - 1 >= 0 && a[i0 - 1].s.trim() ? i0 - 1 : i0 - 2
      if (k >= 0) {
        fix = text.slice(a[k].at, from) + fix
        from = a[k].at
      } else if (i < n) {
        fix += a[i].s
        to = end(i + 1)
      }
    }
    // Underline words, not the spaces around them.
    while (from < to && text[from] === ' ' && fix.startsWith(' ')) {
      from++
      fix = fix.slice(1)
    }
    while (to > from && text[to - 1] === ' ' && fix.endsWith(' ')) {
      to--
      fix = fix.slice(0, -1)
    }
    if (to > from) edits.push({ from, to, fix })
  }
  return edits
}

/** "de" or "en", from common words and letters; limited to the spell check languages the user picked. */
export function guessLang(text: string): Lang {
  const langs = spellLangs()
  if (langs.length < 2) return langs[0] ?? 'en'
  const s = langScore(text)
  return s.de > s.en ? 'de' : s.en > s.de ? 'en' : langs[0]
}

/** AI results per model and paragraph text, so switching to the better model checks everything again. */
const fixes = new Map<string, Edit[]>()
const fixKey = (text: string) => `${useSettings.getState().aiModel}\u0000${text}`
const listeners = new Set<() => void>()
let queue: { text: string; lang: Lang }[] = []
let busy = false

export function aiReady(): boolean {
  const s = useSettings.getState()
  return s.spellCheck && s.aiHelper && useAiHelper.getState().installed === true
}

/** Called whenever the AI helper finished a paragraph, so editors can underline it. */
export function onAiResult(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Sentences around the cursor the AI helper looks at per pause; the rest waits until you work there. */
const NEAR = 12

/**
 * Queue paragraphs for the AI helper, nearest to where the user is writing first. The queue is replaced,
 * not added to: older versions of edited paragraphs and far-away ones used to pile up, so the helper
 * spent its time on stale text and the paragraph being written got its suggestions later and later.
 */
function want(texts: { text: string; lang: Lang; d: number }[]) {
  const seen = new Set<string>()
  queue = texts
    .filter(({ text }) => !fixes.has(fixKey(text)) && text.split(/\s+/).length >= 3 && !seen.has(text) && seen.add(text))
    .sort((a, b) => a.d - b.d)
    .slice(0, NEAR)
  void pump()
}

async function pump() {
  if (busy) return
  busy = true
  try {
    while (queue.length && aiReady()) {
      const { text, lang } = queue.shift()!
      if (fixes.has(fixKey(text))) continue
      try {
        const model = useSettings.getState().aiModel
        fixes.set(`${model}\u0000${text}`, diffEdits(text, await invoke<string>('llm_check', { text, lang, model })))
      } catch (e) {
        // Do not hammer a broken helper; show why in Settings and try again on the next edit.
        useAiHelper.setState({ error: String(e) })
        queue = []
        break
      }
      listeners.forEach((l) => l())
    }
  } finally {
    busy = false
  }
}

/** "Dismiss" on the card: this exact suggestion (fix "" for a misspelled word) stays hidden until the app restarts. */
const ignored = new Set<string>()
export function ignoreFix(bad: string, fix: string) {
  ignored.add(`${bad}\u0000${fix}`)
  listeners.forEach((l) => l())
}

const DE_DET = new Set('der die das den dem des ein eine einen einem einer eines kein keine keinen mein meine meinen dein deine deinen sein seine seinen ihr ihre ihren unser unsere dieser diese dieses diesen jeder jede jedes zum zur im am vom beim ins'.split(' '))
const OTHER_WORD = {
  en: (w: string) => `"${w}" is a German word. In an English sentence you may mean:`,
  de: (w: string) => `„${w}“ ist ein englisches Wort. In einem deutschen Satz meinst du vielleicht:`,
}
const NOUN_CAP = 'Nomen schreibt man groß: der Hund, das Haus'
const cap = (w: string) => w[0].toUpperCase() + w.slice(1)

/**
 * Spelling and grammar issues for each paragraph (`focus` = the one with the cursor). Every sentence
 * is checked in its own language, so English and German can share a paragraph. AI results arrive
 * later through `onAiResult`.
 */
export async function findIssues(paragraphs: string[], focus = 0): Promise<Issue[][]> {
  const settings = useSettings.getState()
  const langs = spellLangs()
  const on = settings.spellCheck && spellAvailable() && langs.length > 0
  const ai = aiReady()
  if (!on && !ai) return paragraphs.map(() => [])
  const paras = paragraphs.map((text) => sentences(text).map((s) => ({ ...s, words: tokenizeParts(s.text) })))
  const all = paras.flat().flatMap((s) => s.words.map((w) => w.word))
  const info = on ? await lookup([...all, ...all.filter((w) => w[0] === w[0].toLowerCase()).map(cap)]).catch(() => null) : null
  const known = knownWords()
  const off = new Set(settings.spellRulesOff)
  const out: Issue[][] = paragraphs.map(() => [])
  /** Words no dictionary knows, and German words in English sentences: both need one more question to the dictionaries. */
  const unknown: { p: number; issue: Issue; german: boolean }[] = []
  const foreign: { p: number; issue: Issue }[] = []
  const forAi: { text: string; lang: Lang; d: number }[] = []
  let before: Lang = langs[0] ?? 'en'

  paras.forEach((sents, p) => {
    // The language is decided per clause (between commas), because that is where mixed writing switches.
    const parts = sents.flatMap((s) => clauses(s.text).map((c) => ({ from: s.from + c.from, text: c.text })))
    const detected = detectLangs(parts.map((c) => c.text), langs, before, info ?? undefined)
    const at = (pos: number) => detected[Math.max(0, parts.findLastIndex((c) => c.from <= pos))] ?? { lang: before, sure: false }
    // Notes typed all in lower case are a style, not a mistake: no capital-letter hints there.
    const casual = sents.every((s) => /^\s*[^\p{L}]*\p{Ll}/u.test(s.text))
    const prose = !casual && (sents.length > 1 || /[.!?]\s*$/.test(paragraphs[p]))
    const offHere = casual ? new Set([...off, 'i-cap']) : off
    sents.forEach((s) => {
      if (ai) forAi.push({ text: s.text.trimEnd(), lang: guessLang(s.text), d: Math.abs(p - focus) })
      if (!info) return
      const spots: Issue[] = []
      s.words.forEach((w, n) => {
        const { lang, sure } = at(s.from + w.from)
        const other: Lang = lang === 'en' ? 'de' : 'en'
        const lower = w.word.toLowerCase()
        if (known.has(lower) || ignored.has(`${w.word}\u0000`)) return
        const i = info(w.word)
        if (i[lang]) return
        const issue: Issue = { from: s.from + w.from, to: s.from + w.to, lang }
        if (!i[other]) {
          // Known slips ("Standart") are never excused as a made-up compound.
          if (KNOWN_WRONG.en.has(lower) || KNOWN_WRONG.de.has(lower)) spots.push({ ...issue, word: w.word })
          else unknown.push({ p, issue: { ...issue, word: w.word }, german: lang === 'de' && sure })
          return
        }
        // Right in the other language. Next to more words of that language it is how the writer talks; alone in a clear sentence it may be a slip.
        const foreignToo = (x?: { word: string }) => !!x && !info(x.word)[lang] && info(x.word)[other]
        if (!sure || off.has('other-language') || foreignToo(s.words[n - 1]) || foreignToo(s.words[n + 1])) return
        const fix = KNOWN_WRONG[lang].get(lower)
        if (fix) spots.push({ ...issue, fix, fixes: [fix], why: OTHER_WORD[lang](w.word), rule: 'other-language' })
        else if (lang === 'de' && w.word === lower && info(cap(w.word)).de && DE_DET.has(s.words[n - 1]?.word.toLowerCase())) {
          if (!off.has('noun-capital')) spots.push({ ...issue, fix: cap(w.word), fixes: [cap(w.word)], why: NOUN_CAP, rule: 'noun-capital' })
        } else if (lang === 'en' && w.word === lower && lower.length >= 3) foreign.push({ p, issue: { ...issue, rule: 'other-language', why: OTHER_WORD.en(w.word) } })
      })
      const here = new Set(parts.map((c, k) => (c.from >= s.from && c.from < s.from + s.text.length && detected[k].sure ? detected[k].lang : null)))
      for (const lang of langs)
        if (here.has(lang))
          for (const h of checkRules(s.text, lang, offHere, prose)) {
            const a = at(s.from + h.from)
            const b = at(s.from + h.to - 1)
            if (a.sure && a.lang === lang && b.lang === lang) spots.push({ from: s.from + h.from, to: s.from + h.to, fix: h.fixes[0], fixes: h.fixes, why: h.why, rule: h.rule, lang })
          }
      out[p].push(...spots)
    })
    before = detected[detected.length - 1]?.lang ?? before
  })

  if (unknown.length) {
    const fine = await borrowedOk(unknown.map((u) => ({ word: u.issue.word!, german: u.german }))).catch(() => new Set<string>())
    for (const u of unknown) if (!fine.has(u.issue.word!)) out[u.p].push(u.issue)
  }
  for (const f of foreign) {
    const word = paragraphs[f.p].slice(f.issue.from, f.issue.to)
    const close = (await suggestRanked(word, 'en').catch(() => [])).filter((r) => r.lang === 'en' && r.score < 1 && !/[ -]/.test(r.word)).slice(0, 3)
    if (close.length) out[f.p].push({ ...f.issue, fix: close[0].word, fixes: close.map((r) => r.word) })
  }
  if (ai) want(forAi)

  return out.map((list, p) => {
    const text = paragraphs[p]
    // One underline per spot: a misspelled word wins over a hint on the same words.
    const red = list.filter((x) => x.word)
    const hints = list.filter((x) => !x.word && !ignored.has(`${text.slice(x.from, x.to)}\u0000${x.fix}`) && !red.some((r) => r.from < x.to && x.from < r.to))
    const found = [...red, ...hints]
    if (ai)
      for (const s of paras[p])
        for (const e of fixes.get(fixKey(s.text.trimEnd())) ?? []) {
          const edit = { from: e.from + s.from, to: e.to + s.from, fix: e.fix }
          const was = text.slice(edit.from, edit.to)
          // Made-up names the user taught the app stay as they are; a hint already there is enough.
          if (ignored.has(`${was}\u0000${e.fix}`) || (tokenize(was).length > 0 && tokenize(was).every((w) => known.has(w.word.toLowerCase())))) continue
          if (hints.some((h) => h.from < edit.to && edit.from < h.to)) continue
          found.push(edit)
        }
    return found.sort((a, b) => a.from - b.from)
  })
}

/** The sentence around text[from..to] and one sentence on each side (so the helper knows the context), with that spot marked `[[like this]]`. */
export function markedSentence(text: string, from: number, to: number): string {
  const ends = [...text.slice(0, from).matchAll(/[.!?]\s+/g)].map((m) => m.index + m[0].length)
  const start = ends.length > 1 ? ends[ends.length - 2] : 0
  const after = [...text.slice(to).matchAll(/[.!?](\s|$)/g)]
  const end = after.length > 1 ? to + after[1].index + 1 : after.length ? to + after[0].index + 1 : text.length
  return `${text.slice(start, from)}[[${text.slice(from, to)}]]${text.slice(to, end)}`.trim()
}

/** Model lines → replacement options: no numbering or quotes, no repeats, nothing that rewrites the whole sentence. */
export function cleanOptions(lines: string[], bad: string): string[] {
  const max = bad.split(/\s+/).length + 3
  const out: string[] = []
  for (const line of lines) {
    const o = line
      .trim()
      .replace(/^(\d+[.)]|[-*•])\s*/, '')
      .replace(/^["'„“”`]+|["'„“”`]+$/g, '')
      .trim()
    if (o && o !== bad && !o.includes('[[') && !o.includes(']]') && o.split(/\s+/).length <= max && !out.includes(o)) out.push(o)
  }
  return out
}

/**
 * About 3 ways to fix text[from..to], best first: a writing hint's own words; otherwise the background
 * fix, the dictionary's closest word, the AI helper's options for this spot, then the dictionary's
 * other words. `onUpdate` gets the list again once more answers arrived.
 */
export function fixOptions(text: string, from: number, to: number, fix: string | undefined, word: string | undefined, onUpdate: (options: string[]) => void, hint?: { fixes?: string[]; lang?: Lang }) {
  const bad = text.slice(from, to)
  if (hint?.fixes) {
    onUpdate(hint.fixes.slice(0, 4))
    return Promise.resolve()
  }
  let ai: string[] = []
  let dictionary: string[] = []
  let sureFirst = false
  const emit = () => onUpdate([...new Set([...(fix === undefined ? [] : [fix]), ...(sureFirst ? dictionary.slice(0, 1) : []), ...ai, ...dictionary])].filter((o) => o !== bad).slice(0, 3))
  emit()
  const sentence = markedSentence(text, from, to)
  const lang = hint?.lang ?? guessLang(sentence)
  if (word)
    void suggestRanked(word, lang).then((s) => {
      dictionary = s.slice(0, 6).map((r) => r.word)
      sureFirst = s.length > 0 && s[0].score <= 1.5
      emit()
    })
  if (!aiReady()) return Promise.resolve()
  const { aiModel: model } = useSettings.getState()
  return invoke<string[]>('llm_options', { sentence, lang, model })
    .then((lines) => ((ai = cleanOptions(lines, bad)), emit()))
    .catch(() => {})
}

/** Suggestion card title for a fix. */
export function fixTitle(bad: string, fix: string | undefined, misspelled: boolean): string {
  if (misspelled || fix === undefined) return 'Correct the spelling'
  const letters = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '')
  if (letters(bad) === letters(fix)) return bad.toLowerCase() === fix.toLowerCase() && bad !== fix && /^[\p{L}\s]+$/u.test(bad) ? 'Fix the capitalization' : 'Fix the punctuation'
  if (bad.toLowerCase() === fix.toLowerCase()) return 'Fix the capitalization'
  const a = bad.split(/\s+/)
  const b = fix.split(/\s+/)
  if (a.length === b.length && a.every((w, i) => w.slice(0, 4).toLowerCase() === b[i].slice(0, 4).toLowerCase())) return 'Change the word form'
  return 'Change the wording'
}
