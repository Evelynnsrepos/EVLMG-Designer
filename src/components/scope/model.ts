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

/** A feature in a version: a link to the full plan (`ref`) or a feature only this version has (`feature`). */
export interface VersionItem {
  id: Id
  mark: Mark
  ref?: Id
  feature?: Feature
}

/** 0.35: one release or update (0.1, 1.0, 1.1 …) with its own scope. */
export interface Version {
  id: Id
  name: string
  /** Days available for this version. */
  capacity: number
  notes: string
  items: VersionItem[]
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

const editVersion = (doc: ScopeDoc, versionId: Id, fn: (v: Version) => Version): ScopeDoc => ({
  ...doc,
  versions: (doc.versions ?? []).map((v) => (v.id === versionId ? fn(v) : v)),
})

export const addToVersion = (doc: ScopeDoc, versionId: Id, item: VersionItem) => editVersion(doc, versionId, (v) => ({ ...v, items: [...v.items, item] }))

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
