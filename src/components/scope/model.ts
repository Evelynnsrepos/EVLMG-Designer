import { newId, type Id } from '@/core/model'

export const COLUMNS = [
  { id: 'must', title: 'Must have', color: '#e03131' },
  { id: 'should', title: 'Should have', color: '#f08c00' },
  { id: 'could', title: 'Could have', color: '#3e8ef7' },
  { id: 'wont', title: 'Won’t have (now)', color: '#9aa0a6' },
  { id: 'cut', title: 'Cut', color: '#495057' },
] as const
export type Priority = (typeof COLUMNS)[number]['id']
export const STATUSES = ['Idea', 'Planned', 'In progress', 'Done'] as const
export const DISCIPLINES = ['Design', 'Code', 'Art', 'Sound', 'Writing', 'QA'] as const
export type Discipline = (typeof DISCIPLINES)[number]

export interface Feature {
  id: Id
  title: string
  description: string
  priority: Priority
  /** Days of work. */
  effort: number
  status: (typeof STATUSES)[number]
  /** Vision pillar it serves. */
  pillarId: Id | null
  /** 0.28: days per discipline; when set, effort is their sum. */
  split?: Partial<Record<Discipline, number>>
  /** 0.35: the version it was first made in, when it was fed back from a version into the full plan. */
  addedIn?: Id
}

/** 0.35: how a feature stands in one version: planned from the start, added later, or cut from it. */
export const MARKS = [
  { id: 'planned', title: 'Planned', color: '#3e8ef7' },
  { id: 'added', title: 'Added', color: '#2f9e44' },
  { id: 'cut', title: 'Cut', color: '#495057' },
] as const
export type Mark = (typeof MARKS)[number]['id']

/** One change of a feature's mark in a version, newest last. */
export interface LogEntry {
  at: string
  mark: Mark
  note?: string
}

/** A feature in a version: a link to the full plan (`ref`) or a feature only this version has (`feature`). */
export interface VersionItem {
  id: Id
  mark: Mark
  ref?: Id
  feature?: Feature
  /** Why it was cut. */
  reason?: string
  log?: LogEntry[]
  /** Version it was moved on to (it stays here as cut). */
  movedTo?: Id
}

export const VERSION_STATES = [
  { id: 'planned', title: 'Planned' },
  { id: 'active', title: 'In progress' },
  { id: 'shipped', title: 'Shipped' },
] as const
export type VersionState = (typeof VERSION_STATES)[number]['id']

/** 0.35: one release or update (0.1, 1.0, 1.1 …) with its own scope. */
export interface Version {
  id: Id
  name: string
  /** Days available for this version. */
  capacity: number
  notes: string
  items: VersionItem[]
  state?: VersionState
  /** Planned release day, YYYY-MM-DD. */
  target?: string
  /** When the scope was locked; features added after count as Added. */
  lockedAt?: string
  shippedAt?: string
}

export interface ScopeDoc {
  /** The full release plan: everything the game needs. */
  items: Feature[]
  /** Days available until release. */
  capacity: number
  /** 0.35, optional: versions in order. */
  versions?: Version[]
}

export const createScopeDoc = (): ScopeDoc => ({ items: [], capacity: 120 })
export const newFeature = (priority: Priority): Feature => ({ id: newId(), title: 'New feature', description: '', priority, effort: 3, status: 'Idea', pillarId: null })

/** "0.1" → "0.2", "1.0 Beta" → "1.1 Beta"; no number → add " 2". */
export function nextVersionName(prev: string | undefined): string {
  if (!prev) return '0.1'
  const m = /(\d+)(?!.*\d)/.exec(prev)
  return m ? prev.slice(0, m.index) + (Number(m[1]) + 1) + prev.slice(m.index + m[1].length) : `${prev} 2`
}

export const newVersion = (versions: Version[]): Version => ({ id: newId(), name: nextVersionName(versions.at(-1)?.name), capacity: 30, notes: '', items: [] })

/** Each item with its feature; links to deleted features are left out. */
export function resolveItems(doc: ScopeDoc, v: Version): { item: VersionItem; feature: Feature; custom: boolean }[] {
  return v.items.flatMap((item) => {
    const feature = item.ref ? doc.items.find((f) => f.id === item.ref) : item.feature
    return feature ? [{ item, feature, custom: !item.ref }] : []
  })
}

/** Days of planned + added work and of cut work in a version. */
export function versionDays(doc: ScopeDoc, v: Version) {
  const rows = resolveItems(doc, v)
  const days = (marks: Mark[]) => rows.filter((r) => marks.includes(r.item.mark)).reduce((s, r) => s + r.feature.effort, 0)
  return { inScope: days(['planned', 'added']), added: days(['added']), cut: days(['cut']) }
}

/** Versions a full-plan feature is in (not cut there), for its card. */
export const versionsOf = (doc: ScopeDoc, featureId: Id) => (doc.versions ?? []).filter((v) => v.items.some((i) => i.ref === featureId && i.mark !== 'cut'))

/** Full-plan features this version does not have yet. */
export const notInVersion = (doc: ScopeDoc, v: Version) => doc.items.filter((f) => !v.items.some((i) => i.ref === f.id))

export const editVersion = (doc: ScopeDoc, versionId: Id, fn: (v: Version) => Version): ScopeDoc => ({
  ...doc,
  versions: (doc.versions ?? []).map((v) => (v.id === versionId ? fn(v) : v)),
})

export const addToVersion = (doc: ScopeDoc, versionId: Id, item: VersionItem) => editVersion(doc, versionId, (v) => ({ ...v, items: [...v.items, item] }))

const stamp = () => new Date().toISOString()

/** After the scope is locked, anything new is Added. */
export const markForNew = (v: Version): Mark => (v.lockedAt ? 'added' : 'planned')

/** A new item for a version, with its first history line. */
export function newItem(v: Version, what: { ref: Id } | { feature: Feature }, note?: string, at = stamp()): VersionItem {
  const mark = markForNew(v)
  return { id: newId(), mark, ...what, log: [{ at, mark, ...(note ? { note } : {}) }] }
}

/** Change an item's mark and write it into its history. */
export function setMark(doc: ScopeDoc, versionId: Id, itemId: Id, mark: Mark, note?: string, at = stamp()): ScopeDoc {
  return editVersion(doc, versionId, (v) => ({
    ...v,
    items: v.items.map((i) => (i.id === itemId && i.mark !== mark ? { ...i, mark, ...(note !== undefined ? { reason: note } : {}), log: [...(i.log ?? []), { at, mark, ...(note ? { note } : {}) }] } : i)),
  }))
}

/** Put a full-plan feature into a version (a cut one comes back). Shipped versions take nothing. */
export function putFeature(doc: ScopeDoc, versionId: Id, what: { ref: Id } | { feature: Feature }, note?: string, at = stamp()): ScopeDoc {
  const v = doc.versions?.find((x) => x.id === versionId)
  if (!v || v.state === 'shipped') return doc
  const had = 'ref' in what ? v.items.find((i) => i.ref === what.ref) : undefined
  if (had) return had.mark === 'cut' ? setMark(doc, versionId, had.id, markForNew(v), note ?? 'Back in', at) : doc
  return addToVersion(doc, versionId, newItem(v, what, note, at))
}

/**
 * Move an item to another version (or out of all, `to` null). A locked or shipped version keeps it as cut,
 * "Moved to …", so the history shows what left; an open one just lets it go.
 */
export function moveItem(doc: ScopeDoc, fromId: Id, itemId: Id, to: Id | null, at = stamp()): ScopeDoc {
  const from = doc.versions?.find((v) => v.id === fromId)
  const item = from?.items.find((i) => i.id === itemId)
  const target = doc.versions?.find((v) => v.id === to)
  if (!from || !item || fromId === to || target?.state === 'shipped') return doc
  let d = doc
  if (target) d = putFeature(d, target.id, item.ref ? { ref: item.ref } : { feature: { ...item.feature!, id: newId() } }, `From ${from.name}`, at)
  const keep = from.lockedAt || from.state === 'shipped'
  if (!keep) return editVersion(d, fromId, (v) => ({ ...v, items: v.items.filter((i) => i.id !== itemId) }))
  const reason = target ? `Moved to ${target.name}` : 'Taken out'
  d = setMark(d, fromId, itemId, 'cut', reason, at)
  return target ? editVersion(d, fromId, (v) => ({ ...v, items: v.items.map((i) => (i.id === itemId ? { ...i, movedTo: target.id } : i)) })) : d
}

/** Planned or added features that are not Done. */
export const unfinished = (doc: ScopeDoc, v: Version) => resolveItems(doc, v).filter((r) => r.item.mark !== 'cut' && r.feature.status !== 'Done')

/** Mark a version shipped; unfinished features move on to `carryTo` (they stay in this one as cut, "Moved to …"). */
export function ship(doc: ScopeDoc, versionId: Id, carryTo: Id | null, at = stamp()): ScopeDoc {
  const v = doc.versions?.find((x) => x.id === versionId)
  if (!v) return doc
  let d = editVersion(doc, versionId, (x) => ({ ...x, state: 'shipped', shippedAt: at, lockedAt: x.lockedAt ?? at }))
  if (carryTo) for (const r of unfinished(doc, v)) d = moveItem(d, versionId, r.item.id, carryTo, at)
  return d
}

/** Full-plan features (not cut or won't) that no version has yet, or only as cut. */
export const unplanned = (doc: ScopeDoc) =>
  doc.items.filter((f) => f.priority !== 'cut' && f.priority !== 'wont' && !(doc.versions ?? []).some((v) => v.items.some((i) => i.ref === f.id && i.mark !== 'cut')))

const day = (iso?: string) => iso?.slice(0, 10)

/** Patch notes / changelog in Markdown, newest version first. */
export function patchNotes(doc: ScopeDoc, versions: Version[]): string {
  const line = (f: Feature) => `- ${f.title}${f.description.trim() ? ` — ${f.description.trim().split('\n')[0]}` : ''}`
  return versions
    .slice()
    .reverse()
    .map((v) => {
      const rows = resolveItems(doc, v)
      const when = v.shippedAt ? `released ${day(v.shippedAt)}` : v.target ? `planned for ${v.target}` : 'not released yet'
      const part = (title: string, list: typeof rows, fmt = (r: (typeof rows)[number]) => line(r.feature)) => (list.length ? `### ${title}\n\n${list.map(fmt).join('\n')}\n` : '')
      const shipped = v.state === 'shipped'
      const isIn = rows.filter((r) => r.item.mark !== 'cut')
      return [
        `## ${v.name} (${when})\n`,
        v.notes.trim() ? `${v.notes.trim()}\n` : '',
        part(shipped ? 'In this version' : 'Planned', isIn.filter((r) => r.item.mark === 'planned' && (!shipped || r.feature.status === 'Done'))),
        part('Added later', isIn.filter((r) => r.item.mark === 'added' && (!shipped || r.feature.status === 'Done'))),
        part('Cut', rows.filter((r) => r.item.mark === 'cut'), (r) => `- ${r.feature.title}${r.item.reason ? ` (${r.item.reason})` : ''}`),
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')
}

/** Move a version-only feature into the full release plan; the version keeps it as a link. */
export function feedBack(doc: ScopeDoc, versionId: Id, itemId: Id): ScopeDoc {
  const item = doc.versions?.find((v) => v.id === versionId)?.items.find((i) => i.id === itemId)
  if (!item?.feature) return doc
  const feature: Feature = { ...item.feature, addedIn: versionId }
  return editVersion({ ...doc, items: [...doc.items, feature] }, versionId, (v) => ({
    ...v,
    items: v.items.map((i) => (i.id === itemId ? { id: i.id, mark: i.mark, ref: feature.id } : i)),
  }))
}

/** Delete a full-plan feature and its links in every version. */
export const deleteFeature = (doc: ScopeDoc, featureId: Id): ScopeDoc => ({
  ...doc,
  items: doc.items.filter((f) => f.id !== featureId),
  versions: doc.versions?.map((v) => ({ ...v, items: v.items.filter((i) => i.ref !== featureId) })),
})
