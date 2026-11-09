import { newId, type Id } from '@/core/model'
import { toCSV } from '@/shared/csv'
import type { Condition, Flag, FlagChange } from '@/shared/flags'

/**
 * Dialogue Editor (v0.7): a conversation is a set of lines. Each line has a
 * speaker and text, and either goes on to one next line or offers choices.
 * Lines and choices can depend on flags and change them.
 */

export interface Choice {
  id: Id
  text: string
  /** Line this choice leads to; null = the conversation ends. */
  to: Id | null
  conditions: Condition[]
  changes: FlagChange[]
}

export interface Line {
  id: Id
  /** A character from the Character List, or null for `speakerName` (Narrator, Player…). */
  speakerId: Id | null
  speakerName: string
  text: string
  /** Without choices: the line that follows; null = the end. */
  next: Id | null
  choices: Choice[]
  /** Only said if these hold (otherwise the conversation skips to `next`). */
  conditions: Condition[]
  /** Flag changes when this line is said. */
  changes: FlagChange[]
  /** 0.28: voice-over direction for the actor ("whispered, out of breath"). */
  direction?: string
  /** 0.28: voice-over file name; empty = made from the conversation and line number. */
  voiceFile?: string
}

export interface DialogueDoc {
  startId: Id | null
  lines: Line[]
}

export const createDialogueDoc = (): DialogueDoc => ({ startId: null, lines: [] })

export const newLine = (speakerId: Id | null = null): Line => ({
  id: newId(),
  speakerId,
  speakerName: speakerId ? '' : 'Narrator',
  text: '',
  next: null,
  choices: [],
  conditions: [],
  changes: [],
})

export const newChoice = (): Choice => ({ id: newId(), text: '', to: null, conditions: [], changes: [] })

/** Lines nothing leads to (except the start): probably forgotten. */
export function unreachable(doc: DialogueDoc): Set<Id> {
  const byId = new Map(doc.lines.map((l) => [l.id, l]))
  const seen = new Set<Id>()
  const stack = doc.startId ? [doc.startId] : []
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const l = byId.get(id)
    if (!l) continue
    if (l.next) stack.push(l.next)
    for (const c of l.choices) if (c.to) stack.push(c.to)
  }
  return new Set(doc.lines.filter((l) => !seen.has(l.id)).map((l) => l.id))
}

// ---- export -------------------------------------------------------------------

export type SpeakerName = (line: Line) => string

/** Stable names for lines in exports: n1, n2… in document order. */
const lineNames = (doc: DialogueDoc) => new Map(doc.lines.map((l, i) => [l.id, `n${i + 1}`]))

const flagName = (flags: Flag[], id: Id) => flags.find((f) => f.id === id)?.name ?? 'unknown_flag'

function conditionExpr(c: Condition, flags: Flag[], prefix = '$'): string {
  const f = flags.find((x) => x.id === c.flagId)
  const name = prefix + flagName(flags, c.flagId)
  if (f?.kind === 'bool') return c.value ? (c.op === '!=' ? `not ${name}` : name) : c.op === '!=' ? name : `not ${name}`
  return `${name} ${c.op === '==' ? '==' : c.op} ${c.value}`
}

function changeStmt(c: FlagChange, flags: Flag[], prefix = '$'): string {
  const f = flags.find((x) => x.id === c.flagId)
  const name = prefix + flagName(flags, c.flagId)
  if (f?.kind === 'bool') return `${name} = ${c.value ? 'true' : 'false'}`
  return c.op === 'add' ? `${name} = ${name} + ${c.value}` : `${name} = ${c.value}`
}

/** Plain JSON a game can load: lines keyed by name, flag ids replaced by flag names. */
export function exportJson(doc: DialogueDoc, flags: Flag[], speaker: SpeakerName): string {
  const names = lineNames(doc)
  const cond = (cs: Condition[]) => cs.map((c) => ({ flag: flagName(flags, c.flagId), op: c.op, value: c.value }))
  const chg = (cs: FlagChange[]) => cs.map((c) => ({ flag: flagName(flags, c.flagId), op: c.op, value: c.value }))
  return JSON.stringify(
    {
      start: doc.startId ? names.get(doc.startId) : null,
      lines: Object.fromEntries(
        doc.lines.map((l) => [
          names.get(l.id),
          {
            speaker: speaker(l),
            text: l.text,
            ...(l.voiceFile?.trim() ? { voice: l.voiceFile.trim() } : {}),
            next: l.next ? names.get(l.next) : null,
            conditions: cond(l.conditions),
            changes: chg(l.changes),
            choices: l.choices.map((c) => ({ text: c.text, to: c.to ? names.get(c.to) : null, conditions: cond(c.conditions), changes: chg(c.changes) })),
          },
        ]),
      ),
    },
    null,
    2,
  )
}

/** Yarn Spinner 2 script. */
export function exportYarn(doc: DialogueDoc, flags: Flag[], speaker: SpeakerName): string {
  const names = lineNames(doc)
  const ordered = doc.startId ? [...doc.lines].sort((a, b) => Number(b.id === doc.startId) - Number(a.id === doc.startId)) : doc.lines
  return ordered
    .map((l) => {
      const out = [`title: ${names.get(l.id)}`, '---']
      const body: string[] = []
      for (const c of l.changes) body.push(`<<set ${changeStmt(c, flags)}>>`)
      body.push(`${speaker(l)}: ${l.text.replace(/\n/g, ' ')}`)
      if (l.choices.length) {
        for (const ch of l.choices) {
          const cond = ch.conditions.length ? ` <<if ${ch.conditions.map((c) => conditionExpr(c, flags)).join(' and ')}>>` : ''
          body.push(`-> ${ch.text.replace(/\n/g, ' ')}${cond}`)
          for (const c of ch.changes) body.push(`    <<set ${changeStmt(c, flags)}>>`)
          body.push(ch.to ? `    <<jump ${names.get(ch.to)}>>` : '    <<stop>>')
        }
      } else if (l.next) body.push(`<<jump ${names.get(l.next)}>>`)
      if (l.conditions.length) {
        out.push(`<<if ${l.conditions.map((c) => conditionExpr(c, flags)).join(' and ')}>>`)
        out.push(...body.map((b) => `    ${b}`))
        out.push('<<else>>', l.next ? `    <<jump ${names.get(l.next)}>>` : '    <<stop>>', '<<endif>>')
      } else out.push(...body)
      out.push('===')
      return out.join('\n')
    })
    .join('\n\n')
}

/** Ink script. */
export function exportInk(doc: DialogueDoc, flags: Flag[], speaker: SpeakerName): string {
  const names = lineNames(doc)
  const vars = flags.map((f) => `VAR ${f.name} = ${f.kind === 'bool' ? (f.initial ? 'true' : 'false') : f.initial}`)
  const knots = doc.lines.map((l) => {
    const out = [`=== ${names.get(l.id)} ===`]
    for (const c of l.changes) out.push(`~ ${changeStmt(c, flags, '')}`)
    out.push(`${speaker(l)}: ${l.text.replace(/\n/g, ' ')}`)
    if (l.choices.length) {
      for (const ch of l.choices) {
        const cond = ch.conditions.length ? `{${ch.conditions.map((c) => conditionExpr(c, flags, '')).join(' and ')}} ` : ''
        out.push(`* ${cond}[${ch.text.replace(/\n/g, ' ')}]`)
        for (const c of ch.changes) out.push(`    ~ ${changeStmt(c, flags, '')}`)
        out.push(`    -> ${ch.to ? names.get(ch.to) : 'END'}`)
      }
    } else out.push(`-> ${l.next ? names.get(l.next) : 'END'}`)
    return out.join('\n')
  })
  const start = doc.startId ? `-> ${names.get(doc.startId)}` : ''
  return [...vars, '', start, '', ...knots].join('\n')
}

/** 0.28: the voice file name of a line: its own, or `<conversation>_<NNN>_<speaker>`. */
export const voiceFileOf = (doc: DialogueDoc, line: Line, conversation: string, speaker: SpeakerName) =>
  line.voiceFile?.trim() || `${conversation}_${String(doc.lines.indexOf(line) + 1).padStart(3, '0')}_${speaker(line)}`.toLowerCase().replace(/[^a-z0-9_]+/g, '_')

/** 0.28: an actor script, one row per spoken line (choices are spoken too), for a recording session. Filter by speaker in your sheet program. */
export function actorScript(doc: DialogueDoc, conversation: string, speaker: SpeakerName): string {
  return toCSV([
    ['File', 'Speaker', 'Line', 'Direction', 'Conversation'],
    ...doc.lines.filter((l) => l.text.trim()).map((l) => [voiceFileOf(doc, l, conversation, speaker), speaker(l), l.text, l.direction ?? '', conversation]),
  ])
}
