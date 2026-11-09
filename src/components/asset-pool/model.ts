import { newId, type AssetPath, type EntityType, type Id } from '@/core/model'

/**
 * Asset Pool (v0.5): everything that still has to be made for the game
 * (art, models, sounds…), its status, and the picture once it exists.
 * Entries made from items, characters, towns or enemies keep a link by id,
 * so their names follow renames.
 */

export const ASSET_KINDS = ['2D art', 'Icon', 'Sprite', '3D model', 'Animation', 'Sound', 'Music', 'UI', 'VFX', 'Other'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const STATUSES = [
  { id: 'needed', label: 'Needed' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
] as const
export type Status = (typeof STATUSES)[number]['id']

/** Same words as the Task Board, so a task made from an asset keeps them. */
export const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

/** A file kept with the asset (v0.26): the sound, the model, the .psd… `name` is the original file name. */
export interface AssetFile {
  path: AssetPath
  name: string
}

export interface AssetEntry {
  id: Id
  /** For linked entries the entity's name is shown instead (kept as a fallback if the entity is deleted). */
  name: string
  kind: AssetKind
  status: Status
  /** The item, character, town or enemy this asset is for. */
  sourceType: EntityType | null
  sourceId: Id | null
  notes: string
  /** The first picture is the main one (shown in the list). */
  images: AssetPath[]
  createdAt: string
  /** v0.26, all optional so older projects and the mobile app keep working. */
  files?: AssetFile[]
  /** Who makes it. */
  owner?: string
  /** yyyy-mm-dd, or empty. */
  due?: string
  priority?: Priority
  /** The Task Board task made from this asset. */
  taskId?: Id | null
}

export interface AssetPool {
  entries: AssetEntry[]
}

export const createPool = (): AssetPool => ({ entries: [] })

export function newEntry(name: string, kind: AssetKind, source?: { type: EntityType; id: Id }): AssetEntry {
  return {
    id: newId(),
    name,
    kind,
    status: 'needed',
    sourceType: source?.type ?? null,
    sourceId: source?.id ?? null,
    notes: '',
    images: [],
    createdAt: new Date().toISOString(),
  }
}

/** Ids of entities that already have an entry of this kind. */
export function trackedIds(pool: AssetPool, type: EntityType, kind: AssetKind): Set<Id> {
  return new Set(pool.entries.filter((e) => e.sourceType === type && e.kind === kind && e.sourceId).map((e) => e.sourceId!))
}

/**
 * One entry name per checklist line. Understands plain lines, bullets and
 * Markdown checkboxes ("- [ ] Sword icon"); blank lines are skipped.
 */
export function parseChecklist(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*+•]|\d+[.)])?\s*(?:\[[ xX]?\])?\s*/, '').trim())
    .filter(Boolean)
}

/** One step forward; Done stays Done, so a stray click can't throw finished work back to Needed. */
export function nextStatus(s: Status): Status {
  const i = STATUSES.findIndex((x) => x.id === s)
  return STATUSES[Math.min(i + 1, STATUSES.length - 1)].id
}

/** Move picture `i` to the front, making it the main picture. */
export function makeMain(images: AssetPath[], i: number): AssetPath[] {
  if (i <= 0 || i >= images.length) return images
  return [images[i], ...images.slice(0, i), ...images.slice(i + 1)]
}

/** True when the due date has passed and the asset isn't done. `today` is yyyy-mm-dd. */
export function isLate(e: AssetEntry, today: string): boolean {
  return !!e.due && e.status !== 'done' && e.due < today
}

export function progress(entries: AssetEntry[]): { done: number; total: number } {
  return { done: entries.filter((e) => e.status === 'done').length, total: entries.length }
}
