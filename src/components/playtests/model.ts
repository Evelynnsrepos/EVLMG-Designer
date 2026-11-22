import { newId, type Id } from '@/core/model'

/** Playtest tracker (v0.10): sessions, what testers found, and how the game scores over builds. */

export const SEVERITIES = [
  { id: 'blocker', label: 'Blocker', color: '#a61e4d' },
  { id: 'major', label: 'Major', color: '#e03131' },
  { id: 'minor', label: 'Minor', color: '#f08c00' },
  { id: 'idea', label: 'Idea / polish', color: '#3e8ef7' },
] as const
export type Severity = (typeof SEVERITIES)[number]['id']

export interface Finding {
  id: Id
  text: string
  severity: Severity
  /** Where in the game, e.g. "Level 2", "Inventory". */
  area: string
  fixed: boolean
  /** 0.28: the task made from this finding on the Task board. */
  taskId?: Id | null
  /** 0.35: a bug or other feedback (missing = feedback). */
  kind?: 'bug' | 'feedback'
  /** 0.35: steps to reproduce a bug. */
  steps?: string
  /** 0.35: the section (SectionRating id) it happened in. */
  sectionId?: Id | null
}

/** 0.35: ratings 1–5 per section; missing = not rated. Pace, length and difficulty: 3 = right. */
export const RATINGS = [
  { key: 'fun', label: 'Fun', low: 'No fun', high: 'Great' },
  { key: 'boring', label: 'Boring', low: 'Not at all', high: 'Very boring' },
  { key: 'pace', label: 'Pace', low: 'Too slow', high: 'Too fast' },
  { key: 'length', label: 'Length', low: 'Too short', high: 'Too long' },
  { key: 'difficulty', label: 'Difficulty', low: 'Too easy', high: 'Too hard' },
] as const
export type RatingKey = (typeof RATINGS)[number]['key']

/** 0.35: one part of the game as one tester felt it. `beatId` links it to a Pacing Graph beat. */
export interface SectionRating {
  id: Id
  beatId?: Id | null
  name: string
  fun?: number | null
  boring?: number | null
  pace?: number | null
  length?: number | null
  difficulty?: number | null
  /** Minutes the tester spent in this section. */
  minutes?: number | null
  notes: string
}

/** 0.35: what observers usually watch for while someone plays. */
export const WATCH_TAGS = ['Bored', 'Confused', 'Stuck', 'Frustrated', 'Lost', 'Skipped text', 'Laughed', 'Delighted', 'Surprised', 'Quit', 'Bug'] as const

/** 0.35: one thing noticed while watching, `t` seconds after the watch started. */
export interface Observation {
  id: Id
  t: number
  sectionId?: Id | null
  /** One of WATCH_TAGS, or '' for a free note. */
  tag: string
  text: string
}

export interface Session {
  id: Id
  date: string
  tester: string
  build: string
  minutes: number
  /** 1–10 scores. */
  fun: number
  difficulty: number
  clarity: number
  notes: string
  findings: Finding[]
  /** 0.35: the Pacing Graph journey whose beats are this session's sections. */
  journeyId?: Id | null
  sections?: SectionRating[]
  log?: Observation[]
}

export interface PlaytestsDoc {
  items: Session[]
}

export const createPlaytestsDoc = (): PlaytestsDoc => ({ items: [] })
export const newSession = (): Session => ({
  id: newId(),
  date: new Date().toISOString().slice(0, 10),
  tester: '',
  build: '',
  minutes: 30,
  fun: 5,
  difficulty: 5,
  clarity: 5,
  notes: '',
  findings: [],
})
export const newFinding = (kind: 'bug' | 'feedback' = 'feedback'): Finding => ({
  id: newId(),
  text: '',
  severity: kind === 'bug' ? 'major' : 'minor',
  area: '',
  fixed: false,
  kind,
})
export const newSection = (name: string, beatId: Id | null = null): SectionRating => ({ id: newId(), beatId, name, notes: '' })

/**
 * Keep a session's sections in step with its journey's beats (in beat order); hand-made sections stay at the end.
 * A new beat's section takes the beat's id, so it stays the same before it is saved.
 */
export function syncSections(sections: SectionRating[], beats: { id: Id; name: string; at: number }[]): SectionRating[] {
  const byBeat = new Map(sections.filter((x) => x.beatId).map((x) => [x.beatId, x]))
  const fromBeats = [...beats]
    .sort((a, b) => a.at - b.at)
    .map((b) => ({
      ...(byBeat.get(b.id) ?? { ...newSection(b.name, b.id), id: b.id }),
      name: b.name,
    }))
  const ids = new Set(beats.map((b) => b.id))
  // A section rated for a beat that was deleted keeps its ratings as a hand-made section.
  return [
    ...fromBeats,
    ...sections
      .filter((x) => !x.beatId || !ids.has(x.beatId))
      .map((x) => ({
        ...x,
        beatId: x.beatId && ids.has(x.beatId) ? x.beatId : null,
      })),
  ]
}

export interface SectionAverage {
  /** Beat id, or `name:<lowercase name>` for hand-made sections. */
  key: string
  name: string
  beatId: Id | null
  testers: number
  fun: number | null
  boring: number | null
  pace: number | null
  length: number | null
  difficulty: number | null
  minutes: number | null
  /** Watch tags seen here, most first. */
  tags: [string, number][]
  bugs: number
  /** Plain warnings, e.g. "boring", "too long". */
  flags: string[]
}

const round1 = (n: number) => Math.round(n * 10) / 10
const mean = (list: number[]) => (list.length ? round1(list.reduce((t, x) => t + x, 0) / list.length) : null)

/** What went wrong in a section, from its averages (1–5 scales). */
export function sectionFlags(a: Pick<SectionAverage, 'fun' | 'boring' | 'pace' | 'length' | 'difficulty'>): string[] {
  const f: string[] = []
  if (a.boring != null && a.boring >= 3.5) f.push('boring')
  if (a.fun != null && a.fun <= 2) f.push('not fun')
  if (a.pace != null && a.pace >= 4) f.push('too fast')
  if (a.pace != null && a.pace <= 2) f.push('too slow')
  if (a.length != null && a.length >= 4) f.push('too long')
  if (a.length != null && a.length <= 2) f.push('too short')
  if (a.difficulty != null && a.difficulty >= 4) f.push('too hard')
  if (a.difficulty != null && a.difficulty <= 2) f.push('too easy')
  return f
}

/**
 * Averages per section over all sessions. Sections of the same beat are merged (across sessions);
 * hand-made sections merge by name. `beatIds` limits the result to one journey's beats.
 */
export function sectionAverages(sessions: Session[], beatIds?: Set<Id>): SectionAverage[] {
  const groups = new Map<
    string,
    {
      name: string
      beatId: Id | null
      rows: SectionRating[]
      tags: Map<string, number>
      bugs: number
    }
  >()
  for (const s of sessions) {
    const keyOf = new Map<Id, string>()
    for (const r of s.sections ?? []) {
      if (beatIds && !(r.beatId && beatIds.has(r.beatId))) continue
      const key = r.beatId ?? `name:${r.name.trim().toLowerCase()}`
      keyOf.set(r.id, key)
      const g = groups.get(key) ?? {
        name: r.name,
        beatId: r.beatId ?? null,
        rows: [] as SectionRating[],
        tags: new Map<string, number>(),
        bugs: 0,
      }
      g.rows.push(r)
      groups.set(key, g)
    }
    for (const o of s.log ?? []) {
      const g = o.sectionId ? groups.get(keyOf.get(o.sectionId) ?? '') : undefined
      if (g && o.tag) g.tags.set(o.tag, (g.tags.get(o.tag) ?? 0) + 1)
    }
    for (const f of s.findings) {
      const g = f.sectionId ? groups.get(keyOf.get(f.sectionId) ?? '') : undefined
      if (g && f.kind === 'bug' && !f.fixed) g.bugs++
    }
  }
  return [...groups].map(([key, g]) => {
    const avg = (k: RatingKey | 'minutes') => mean(g.rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number'))
    const a = {
      fun: avg('fun'),
      boring: avg('boring'),
      pace: avg('pace'),
      length: avg('length'),
      difficulty: avg('difficulty'),
    }
    const rated = g.rows.filter((r) => RATINGS.some((x) => typeof r[x.key] === 'number') || (r.minutes ?? 0) > 0).length
    return {
      key,
      name: g.name,
      beatId: g.beatId,
      testers: rated,
      ...a,
      minutes: avg('minutes'),
      tags: [...g.tags].sort((x, y) => y[1] - x[1]),
      bugs: g.bugs,
      flags: sectionFlags(a),
    }
  })
}

/** Open bugs across sessions, worst first. */
export const openBugs = (sessions: Session[]) => openFindings(sessions).list.filter((f) => f.kind === 'bug')

/** m:ss for the watch timer. */
export const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

/** Average scores per build, oldest build first (by first session date). */
export function byBuild(sessions: Session[]) {
  const builds = new Map<string, Session[]>()
  for (const s of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const k = s.build.trim() || 'No build'
    builds.set(k, [...(builds.get(k) ?? []), s])
  }
  const avg = (list: Session[], key: 'fun' | 'difficulty' | 'clarity') => Math.round((list.reduce((t, s) => t + s[key], 0) / list.length) * 10) / 10
  return [...builds].map(([build, list]) => ({
    build,
    sessions: list.length,
    fun: avg(list, 'fun'),
    difficulty: avg(list, 'difficulty'),
    clarity: avg(list, 'clarity'),
  }))
}

/** Open findings across sessions, worst first, and which areas get the most. */
export function openFindings(sessions: Session[]) {
  const order: Severity[] = SEVERITIES.map((s) => s.id)
  const list = sessions.flatMap((s) => s.findings.filter((f) => !f.fixed && f.text.trim()).map((f) => ({ ...f, sessionId: s.id, tester: s.tester })))
  list.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
  const areas = new Map<string, number>()
  for (const f of list) areas.set(f.area.trim() || 'Unsorted', (areas.get(f.area.trim() || 'Unsorted') ?? 0) + 1)
  return { list, areas: [...areas].sort((a, b) => b[1] - a[1]) }
}
