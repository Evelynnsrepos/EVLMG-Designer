import { onSaved, useProjectStore } from '../state'
import { createBackup, type BackupReason } from './backups'

/**
 * When backups are taken [Default]: when a project opens (the state before
 * this session's edits), at most every BACKUP_INTERVAL_MS while edits are
 * being saved, and when it closes. Unchanged snapshots are skipped, so the
 * kept backups always differ from each other.
 */
export const BACKUP_INTERVAL_MS = 5 * 60 * 1000
/** Wait for a burst of saves to finish before snapshotting. */
const SETTLE_MS = 2000

const lastBackupAt = new Map<string, number>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const running = new Set<Promise<unknown>>()

function backup(root: string, reason: BackupReason) {
  lastBackupAt.set(root, Date.now())
  const job = createBackup(root, reason)
    .catch((error) => console.error(`Backup of ${root} failed`, error))
    .finally(() => running.delete(job))
  running.add(job)
  return job
}

/** Resolves when every backup in progress has been written (used before the app window closes). */
export async function waitForBackups(): Promise<void> {
  while (running.size > 0) await Promise.all([...running])
}

let installed: (() => void) | null = null

/** Start automatic backups. Call once at app start; returns an uninstall function. */
export function installAutoBackup(): () => void {
  if (installed) return installed

  const unsubscribeSaved = onSaved((key) => {
    const root = key.slice(0, key.indexOf('|'))
    if (!root || root !== useProjectStore.getState().root) return
    if (Date.now() - (lastBackupAt.get(root) ?? 0) < BACKUP_INTERVAL_MS || timers.has(root)) return
    timers.set(
      root,
      setTimeout(() => {
        timers.delete(root)
        void backup(root, 'autosave')
      }, SETTLE_MS),
    )
  })

  // projectStore.close() flushes every save before clearing `root`, so the
  // close backup sees the final state.
  const unsubscribeStore = useProjectStore.subscribe((state, prev) => {
    if (state.root === prev.root) return
    if (prev.root) {
      clearTimeout(timers.get(prev.root))
      timers.delete(prev.root)
      void backup(prev.root, 'close')
    }
    if (state.root) void backup(state.root, 'open')
  })

  installed = () => {
    unsubscribeSaved()
    unsubscribeStore()
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
    installed = null
  }
  return installed
}
