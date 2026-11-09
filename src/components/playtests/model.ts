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
export const newFinding = (): Finding => ({ id: newId(), text: '', severity: 'minor', area: '', fixed: false })

/** Average scores per build, oldest build first (by first session date). */
export function byBuild(sessions: Session[]) {
  const builds = new Map<string, Session[]>()
  for (const s of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const k = s.build.trim() || 'No build'
    builds.set(k, [...(builds.get(k) ?? []), s])
  }
  const avg = (list: Session[], key: 'fun' | 'difficulty' | 'clarity') => Math.round((list.reduce((t, s) => t + s[key], 0) / list.length) * 10) / 10
  return [...builds].map(([build, list]) => ({ build, sessions: list.length, fun: avg(list, 'fun'), difficulty: avg(list, 'difficulty'), clarity: avg(list, 'clarity') }))
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
