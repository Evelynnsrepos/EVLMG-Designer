import { getFs } from '../fs'
import { projectPaths, readVersioned, writeVersioned } from '../project'

/**
 * Rolling project backups (spec 3.5): snapshots of every JSON file in the project,
 * kept in `<project>/.backups/` (the newest MAX_BACKUPS, plus one per day and one per
 * week, see backupsToKeep). Assets are not copied: they are write-once `<uuid>.<ext>`
 * files. A tool that replaces one (Draw's layer pictures) retires it with retireAssets
 * instead of deleting it, so it stays while a kept backup still mentions it.
 *
 * Each backup is one file, `<time>_<reason>_<hash>.json`, so listing needs no
 * reads and a snapshot identical to the newest one is skipped.
 */
export const MAX_BACKUPS = 10
/** On top of the newest MAX_BACKUPS: the newest backup of each of the last DAILY_DAYS days and WEEKLY_WEEKS weeks. */
export const DAILY_DAYS = 7
export const WEEKLY_WEEKS = 4
const DAY_MS = 24 * 60 * 60 * 1000

export type BackupReason = 'open' | 'autosave' | 'close' | 'before-restore' | 'before-git'

export interface BackupInfo {
  /** File name inside `.backups/`; pass to restoreBackup. */
  id: string
  createdAt: string
  reason: BackupReason
}

interface Snapshot {
  createdAt: string
  reason: BackupReason
  /** Project-relative path with `/` separators -> file text. */
  files: Record<string, string>
}

/** Top-level folders that are not part of a snapshot. */
const SKIPPED_DIRS = new Set(['.backups', 'assets', 'collab', '.history'])

const NAME_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_([a-z-]+)_([0-9a-f]{8})\.json$/

/** Read every JSON file of the project, keyed by relative path. */
export async function collectProjectFiles(root: string): Promise<Record<string, string>> {
  const fs = getFs()
  const files: Record<string, string> = {}
  const walk = async (dir: string, rel: string[]) => {
    for (const entry of await fs.list(dir)) {
      if (rel.length === 0 && SKIPPED_DIRS.has(entry.name)) continue
      const path = await fs.join(dir, entry.name)
      if (entry.isDirectory) await walk(path, [...rel, entry.name])
      else if (entry.name.endsWith('.json')) files[[...rel, entry.name].join('/')] = await fs.readText(path)
    }
  }
  await walk(root, [])
  return files
}

function hashFiles(files: Record<string, string>): string {
  // FNV-1a over sorted paths and contents; only used to skip duplicate snapshots.
  let h = 0x811c9dc5
  const feed = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
  }
  for (const key of Object.keys(files).sort()) {
    feed(key)
    feed('\u0000')
    feed(files[key])
    feed('\u0001')
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function parseName(name: string): (BackupInfo & { hash: string }) | null {
  const m = NAME_PATTERN.exec(name)
  if (!m) return null
  const [, stamp, reason, hash] = m
  const createdAt = stamp.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/, '$1:$2:$3.$4')
  return { id: name, createdAt, reason: reason as BackupReason, hash }
}

/** Backups of a project, newest first. */
export async function listBackups(root: string): Promise<BackupInfo[]> {
  return (await listWithHash(root)).map(({ id, createdAt, reason }) => ({ id, createdAt, reason }))
}

async function listWithHash(root: string) {
  const fs = getFs()
  const dir = await projectPaths.backupsDir(root)
  if (!(await fs.exists(dir))) return []
  return (await fs.list(dir))
    .filter((e) => !e.isDirectory)
    .map((e) => parseName(e.name))
    .filter((b): b is BackupInfo & { hash: string } => !!b)
    .sort((a, b) => b.id.localeCompare(a.id))
}

/**
 * Snapshot the project now. Returns the new backup, or null when nothing
 * changed since the newest backup. Keeps only the newest MAX_BACKUPS.
 */
export async function createBackup(root: string, reason: BackupReason, now = new Date()): Promise<BackupInfo | null> {
  const fs = getFs()
  const files = await collectProjectFiles(root)
  const hash = hashFiles(files)
  const existing = await listWithHash(root)
  if (existing[0]?.hash === hash) return null

  // Never let a clock step backwards sort a new backup below an old one.
  const newest = existing[0] ? Date.parse(existing[0].createdAt) : 0
  const createdAt = new Date(Math.max(now.getTime(), newest + 1)).toISOString()
  const id = `${createdAt.replace(/[:.]/g, '-')}_${reason}_${hash}.json`
  const snapshot: Snapshot = { createdAt, reason, files }
  const dir = await projectPaths.backupsDir(root)
  await writeVersioned(await fs.join(dir, id), snapshot)

  const keep = backupsToKeep([{ id, createdAt }, ...existing], now)
  for (const old of existing) if (!keep.has(old.id)) await fs.remove(await fs.join(dir, old.id))
  await sweepRetiredAssets(root).catch((error) => console.error('Cleaning up replaced pictures failed', error))
  return { id, createdAt, reason }
}

/**
 * Which backups to keep (list newest first): the newest MAX_BACKUPS, plus the newest of each
 * of the last DAILY_DAYS days and of each of the last WEEKLY_WEEKS weeks (at most 21 in all).
 */
export function backupsToKeep(list: { id: string; createdAt: string }[], now = new Date()): Set<string> {
  const keep = new Set(list.slice(0, MAX_BACKUPS).map((b) => b.id))
  const days = new Set<number>()
  const weeks = new Set<number>()
  for (const b of list) {
    const age = now.getTime() - Date.parse(b.createdAt)
    const day = Math.floor(age / DAY_MS)
    const week = Math.floor(age / (7 * DAY_MS))
    if (day < DAILY_DAYS && !days.has(day)) {
      days.add(day)
      keep.add(b.id)
    }
    if (week < WEEKLY_WEEKS && !weeks.has(week)) {
      weeks.add(week)
      keep.add(b.id)
    }
  }
  return keep
}

const RETIRED_FILE = 'retired-assets.json'
/** Only files right inside assets/<kind>/ can be retired, never anything else in the project. */
const ASSET_FILE = /^assets\/(images|audio|files)\/[\w-]+\.[a-z0-9]{1,10}$/
/** One job at a time per project, so two saves never overwrite each other's list. */
const queues = new Map<string, Promise<unknown>>()
function queued<T>(root: string, job: () => Promise<T>): Promise<T> {
  const next = (queues.get(root) ?? Promise.resolve()).then(job, job)
  queues.set(root, next.catch(() => {}))
  return next
}

async function readRetired(root: string): Promise<string[]> {
  try {
    const list: unknown = JSON.parse(await getFs().readText(await getFs().join(await projectPaths.backupsDir(root), RETIRED_FILE)))
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string' && ASSET_FILE.test(p)) : []
  } catch {
    return []
  }
}

async function writeRetired(root: string, list: string[]) {
  const fs = getFs()
  const dir = await projectPaths.backupsDir(root)
  await fs.mkdir(dir)
  await fs.writeTextAtomic(await fs.join(dir, RETIRED_FILE), JSON.stringify(list))
}

/**
 * Asset files a newer save replaced (`assets/images/<uuid>.png`). They are deleted by
 * sweepRetiredAssets once neither the project nor any kept backup mentions them.
 */
export function retireAssets(root: string, paths: (string | null | undefined)[]): Promise<void> {
  const fresh = paths.filter((p): p is string => !!p && ASSET_FILE.test(p))
  if (!fresh.length) return Promise.resolve()
  return queued(root, async () => writeRetired(root, [...new Set([...(await readRetired(root)), ...fresh])]))
}

/** Delete the retired assets that nothing mentions any more; returns how many were deleted. */
export function sweepRetiredAssets(root: string): Promise<number> {
  return queued(root, async () => {
    const retired = await readRetired(root)
    if (!retired.length) return 0
    const fs = getFs()
    const dir = await projectPaths.backupsDir(root)
    const texts = Object.values(await collectProjectFiles(root))
    for (const b of await listWithHash(root)) texts.push(await fs.readText(await fs.join(dir, b.id)).catch(() => ''))
    const still = retired.filter((p) => texts.some((t) => t.includes(p)))
    const gone = retired.filter((p) => !still.includes(p))
    for (const p of gone) await fs.remove(await fs.join(root, ...p.split('/'))).catch(() => {})
    await writeRetired(root, still)
    return gone.length
  })
}

/**
 * Earlier versions of one file (e.g. `components/quests/quests.json`) from the backups, newest first,
 * each only when it differs from the next newer one (0.28). `data` is the unwrapped document.
 */
export async function fileVersions(root: string, rel: string): Promise<{ createdAt: string; reason: BackupReason; data: unknown }[]> {
  const fs = getFs()
  const dir = await projectPaths.backupsDir(root)
  const out: { createdAt: string; reason: BackupReason; data: unknown; text: string }[] = []
  for (const b of await listWithHash(root)) {
    let text: string | undefined
    try {
      text = (await readVersioned<Snapshot>(await fs.join(dir, b.id))).files[rel]
    } catch {
      continue // a damaged backup is skipped, the others still count
    }
    if (text === undefined || out.at(-1)?.text === text) continue
    try {
      out.push({ createdAt: b.createdAt, reason: b.reason, data: (JSON.parse(text) as { data: unknown }).data, text })
    } catch {
      continue
    }
  }
  return out.map(({ text: _t, ...v }) => v)
}

/**
 * Put the project back to a backup. The current state is backed up first, so
 * a restore can itself be undone. The project must not be open.
 */
export async function restoreBackup(root: string, id: string): Promise<void> {
  const fs = getFs()
  const dir = await projectPaths.backupsDir(root)
  const snapshot = await readVersioned<Snapshot>(await fs.join(dir, id))
  if (!snapshot.files['project.json']) throw new Error('This backup is damaged (no project.json).')

  await createBackup(root, 'before-restore')
  const current = await collectProjectFiles(root)
  for (const rel of Object.keys(current)) {
    if (!(rel in snapshot.files)) await fs.remove(await fs.join(root, ...rel.split('/')))
  }
  for (const [rel, text] of Object.entries(snapshot.files)) {
    if (current[rel] !== text) await fs.writeTextAtomic(await fs.join(root, ...rel.split('/')), text)
  }
  // A shared project would load its shared copy over the restored files; this asks it to share them instead.
  if (await fs.exists(await projectPaths.collabState(root))) {
    await fs.writeTextAtomic(await projectPaths.collabRestored(root), `Restored ${id}\n`)
  }
}
