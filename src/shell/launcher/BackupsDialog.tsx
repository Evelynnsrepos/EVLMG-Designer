import { useEffect, useState } from 'react'
import { listBackups, restoreBackup, type BackupInfo, type BackupReason } from '@/core/backups'
import type { RecentProject } from '@/core/model'
import { computeStats, upsertRecent } from '@/core/project'
import { confirmDialog } from '@/shared/dialogs'
import { Modal } from '@/shared/ui'

const REASON_LABEL: Record<BackupReason, string> = {
  open: 'Opened',
  autosave: 'While editing',
  close: 'Closed',
  'before-restore': 'Before a restore',
  'before-git': 'Before taking the Git version',
}

/** Pick one of a project's rolling backups and restore it (spec 3.5). */
export function BackupsDialog({ project, onClose, onRestored }: { project: RecentProject; onClose: () => void; onRestored: () => void }) {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listBackups(project.path)
      .then(setBackups)
      .catch((e: Error) => setError(e.message))
  }, [project.path])

  const restore = async (b: BackupInfo) => {
    const when = new Date(b.createdAt).toLocaleString()
    const ok = await confirmDialog({
      title: `Restore "${project.name}"?`,
      message: `The project goes back to how it was on ${when}.\nThe current state is backed up first, so you can undo this.`,
      confirmLabel: 'Restore',
    })
    if (!ok) return
    setBusy(true)
    try {
      await restoreBackup(project.path, b.id)
      await upsertRecent({ ...project, stats: await computeStats(project.path) })
      onRestored()
      onClose()
    } catch (e) {
      setError(`Could not restore: ${(e as Error).message}`)
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h3>Backups of "{project.name}"</h3>
      <p className="muted">The last 10 versions are kept: when the project opens and closes, and every few minutes while you edit.</p>
      {error && <div className="launcher-error">{error}</div>}
      {backups?.length === 0 && <p className="muted">No backups yet. One is made the next time you open the project.</p>}
      {backups && backups.length > 0 && (
        <ul className="launcher-backups">
          {backups.map((b) => (
            <li key={b.id}>
              <span>
                {new Date(b.createdAt).toLocaleString()}
                <span className="muted"> · {REASON_LABEL[b.reason] ?? b.reason}</span>
              </span>
              <button className="btn" disabled={busy} onClick={() => void restore(b)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}
