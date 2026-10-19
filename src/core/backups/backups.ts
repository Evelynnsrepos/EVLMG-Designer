import { getFs } from '../fs'
import { projectPaths, readVersioned, writeVersioned } from '../project'

/**
 * Rolling project backups (spec 3.5): the last MAX_BACKUPS snapshots of every
 * JSON file in the project, kept in `<project>/.backups/`. Assets are not
 * copied: they are write-once `<uuid>.<ext>` files that edits never change.
 *
 * Each backup is one file, `<time>_<reason>_<hash>.json`, so listing needs no
 * reads and a snapshot identical to the newest one is skipped.
 */
export const MAX_BACKUPS = 10

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
const SKIPPED_DIRS = new Set(['.backups', 'assets', 'collab'])

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

  for (const old of existing.slice(MAX_BACKUPS - 1)) await fs.remove(await fs.join(dir, old.id))
  return { id, createdAt, reason }
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
