import type { ComponentType } from '@/core/model'
import { DATA_TOOLS, type ExportInput, type OutFile } from '@/shell/engineExport/build'

/**
 * The project's design data as the game sees it after "Export to engine" (`Egd.find("items", "fire_sword")`,
 * `Egd.tool("skill-tree", "warrior")`, `tr("KEY")`), so the editor can complete, explain and check those ids.
 * Built from the export's own files, so the ids are always exactly the exported ones.
 */

export interface DesignEntry {
  id: string
  name: string
  /** One line for the hover card: description, stats. */
  detail: string
  /** The tool (and document) the entry lives in, for Ctrl+click. */
  tool: ComponentType
  documentId: string | null
}

export interface DesignData {
  /** By list name: items, characters, towns, enemies, quests. */
  kinds: Record<string, DesignEntry[]>
  /** By data tool type: skill-tree, crafting… */
  tools: Record<string, DesignEntry[]>
  strings: { key: string; values: Record<string, string> }[]
}

export const EMPTY_DATA: DesignData = { kinds: {}, tools: {}, strings: [] }

const KIND_TOOL: Record<string, ComponentType> = { items: 'item-list', characters: 'character-list', towns: 'town-list', enemies: 'enemy-list', quests: 'quests' }
/** Lists `Egd` has that carry no ids to look up. */
const OTHER_KINDS = ['dialogues', 'flags']

export function designDataFrom(files: OutFile[], strings: ExportInput['strings']): DesignData {
  const data: DesignData = { kinds: {}, tools: {}, strings: strings?.items ?? [] }
  for (const f of files) {
    const kind = /^egd\/(\w+)\.json$/.exec(f.path)?.[1]
    const tool = /^egd\/tools\/([\w-]+)\.json$/.exec(f.path)?.[1]
    if (kind && KIND_TOOL[kind]) {
      type Rec = { id: string; name: string; description?: string; summary?: string; stats?: { name: string; value: number }[] }
      data.kinds[kind] = ((JSON.parse(f.text) as Record<string, Rec[]>)[kind] ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        detail: [r.description || r.summary, (r.stats ?? []).map((s) => `${s.name} ${s.value}`).join(', ')].filter(Boolean).join(' · '),
        tool: KIND_TOOL[kind],
        documentId: null,
      }))
    } else if (tool) {
      const docs = (JSON.parse(f.text) as { documents: { id: string; uid: string; title: string }[] }).documents
      // Single-document tools use the tool's name as their document id; they open without one.
      data.tools[tool] = docs.map((d) => ({ id: d.id, name: d.title, detail: '', tool: tool as ComponentType, documentId: d.uid === tool ? null : d.uid }))
    }
  }
  return data
}

export interface Ref {
  call: 'find' | 'tool' | 'tr'
  /** First text: the list or tool type (for `tr`: the key). */
  a: { text: string; from: number; to: number }
  /** Second text: the id, when written. */
  b: { text: string; from: number; to: number } | null
}

/** Every finished `Egd.find("…", "…")`, `Egd.tool("…"[, "…"])` and `tr("…")` in the text. */
export function findRefs(text: string): Ref[] {
  const out: Ref[] = []
  for (const m of text.matchAll(/\bEgd\.(find|tool)\(\s*"([^"\n]*)"(\s*,\s*")?([^"\n]*)("?)/g)) {
    const aFrom = m.index + m[0].indexOf('"') + 1
    const a = { text: m[2], from: aFrom, to: aFrom + m[2].length }
    const bFrom = m[3] ? a.to + 1 + m[3].length : -1 // past the first text's closing quote
    out.push({ call: m[1] as 'find' | 'tool', a, b: m[3] && m[5] ? { text: m[4], from: bFrom, to: bFrom + m[4].length } : null })
  }
  for (const m of text.matchAll(/\btr\(\s*"([^"\n]*)"/g)) {
    const from = m.index + m[0].length - 1 - m[1].length
    out.push({ call: 'tr', a: { text: m[1], from, to: from + m[1].length }, b: null })
  }
  return out
}

export interface Suggestion {
  label: string
  detail: string
}

/** What to offer while typing inside one of those texts; `from` is where the typed part starts in `before`. */
export function completionsAt(before: string, data: DesignData): { from: number; options: Suggestion[] } | null {
  const entries = (list: DesignEntry[] | undefined) => (list ?? []).map((e) => ({ label: e.id, detail: e.name }))
  let m = /\bEgd\.(find|tool)\(\s*"([^"\n]*)"\s*,\s*"([^"\n]*)$/.exec(before)
  if (m) return { from: before.length - m[3].length, options: entries(m[1] === 'find' ? data.kinds[m[2]] : data.tools[m[2]]) }
  m = /\bEgd\.(find|tool)\(\s*"([^"\n]*)$/.exec(before)
  if (m) {
    const names = m[1] === 'find' ? [...Object.keys(KIND_TOOL), ...OTHER_KINDS] : Object.keys(data.tools)
    return { from: before.length - m[2].length, options: names.map((n) => ({ label: n, detail: m![1] === 'find' ? 'list' : 'data tool' })) }
  }
  m = /\btr\(\s*"([^"\n]*)$/.exec(before)
  if (m && data.strings.length) return { from: before.length - m[1].length, options: data.strings.map((s) => ({ label: s.key, detail: Object.values(s.values).find(Boolean) ?? '' })) }
  return null
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length]
}

/** The closest known name, when it is close enough to be a typo. */
export function didYouMean(wrong: string, known: string[]): string | null {
  let best: string | null = null
  let bestD = Math.max(2, Math.floor(wrong.length / 3)) + 1
  for (const k of known) {
    const d = distance(wrong, k)
    if (d < bestD) [best, bestD] = [k, d]
  }
  return best
}

export interface Problem {
  from: number
  to: number
  message: string
  fix: string | null
}

/** Ids and list names the project does not have (wrong, renamed or deleted). */
export function findProblems(text: string, data: DesignData): Problem[] {
  const out: Problem[] = []
  const bad = (part: { text: string; from: number; to: number }, what: string, known: string[]) => {
    const fix = didYouMean(part.text, known)
    out.push({ from: part.from, to: part.to, message: `${what} "${part.text}" is not in this project.${fix ? ` Did you mean "${fix}"?` : ''}`, fix })
  }
  for (const r of findRefs(text)) {
    if (r.call === 'find') {
      const kinds = [...Object.keys(KIND_TOOL), ...OTHER_KINDS]
      if (!kinds.includes(r.a.text)) bad(r.a, 'The list', kinds)
      else if (r.b && data.kinds[r.a.text] && !data.kinds[r.a.text].some((e) => e.id === r.b!.text)) bad(r.b, 'The id', data.kinds[r.a.text].map((e) => e.id))
    } else if (r.call === 'tool') {
      if (!(DATA_TOOLS as readonly string[]).includes(r.a.text)) bad(r.a, 'The data tool', [...DATA_TOOLS])
      else if (r.b && r.b.text && data.tools[r.a.text] && !data.tools[r.a.text].some((e) => e.id === r.b!.text)) bad(r.b, 'The id', data.tools[r.a.text].map((e) => e.id))
    }
  }
  return out
}

/** What the text under `pos` points at: an entry (hover card, Ctrl+click) or a translation key. */
export function refAt(text: string, pos: number, data: DesignData): { from: number; to: number; title: string; detail: string; entry: DesignEntry | null } | null {
  for (const r of findRefs(text)) {
    if (r.call === 'tr' && pos >= r.a.from && pos <= r.a.to) {
      const s = data.strings.find((x) => x.key === r.a.text)
      if (s) return { ...r.a, title: s.key, detail: Object.entries(s.values).map(([lang, v]) => `${lang}: ${v}`).join('\n'), entry: null }
    }
    if (r.call !== 'tr' && r.b && pos >= r.b.from && pos <= r.b.to) {
      const entry = (r.call === 'find' ? data.kinds : data.tools)[r.a.text]?.find((e) => e.id === r.b!.text)
      if (entry) return { ...r.b, title: entry.name, detail: entry.detail, entry }
    }
  }
  return null
}
