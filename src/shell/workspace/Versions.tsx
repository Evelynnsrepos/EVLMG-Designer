import { History } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fileVersions } from '@/core/backups'
import type { ComponentType, Id } from '@/core/model'
import { updateDocument, useProjectStore } from '@/core/state'
import { Modal } from '@/shared/ui'

/** Tools whose data is not one document file (entry lists live in entities/; History and Reviews are views). */
const NO_VERSIONS = new Set<ComponentType>(['item-list', 'character-list', 'town-list', 'enemy-list', 'family-tree', 'history', 'reviews', 'ask', 'balance'])

/** Earlier versions of a tool's document from the project backups (0.28), with Restore (undoable). */
export function VersionsButton({ type, documentId }: { type: ComponentType; documentId: Id | null }) {
  const [open, setOpen] = useState(false)
  if (NO_VERSIONS.has(type)) return null
  return (
    <>
      <button className="panel-font" title="Earlier versions of this document" aria-label="Earlier versions" onClick={() => setOpen(true)}>
        <History size={12} />
      </button>
      {open && <VersionsDialog type={type} id={documentId ?? type} onClose={() => setOpen(false)} />}
    </>
  )
}

function VersionsDialog({ type, id, onClose }: { type: ComponentType; id: Id; onClose(): void }) {
  const root = useProjectStore((s) => s.root)
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof fileVersions>> | null>(null)
  const [restored, setRestored] = useState<string | null>(null)
  useEffect(() => {
    if (root) void fileVersions(root, `components/${type}/${id}.json`).then(setVersions)
  }, [root, type, id])
  return (
    <Modal onClose={onClose}>
      <h3>Earlier versions</h3>
      <p className="muted">Taken from the project backups (when the project opens, every few minutes while you work, and when it closes; the last 10 are kept). Restore puts this document back as it was, and Ctrl+Z undoes it.</p>
      {versions === null ? (
        <p className="muted">Looking through the backups…</p>
      ) : versions.length === 0 ? (
        <p className="muted">No earlier version of this document in the backups yet.</p>
      ) : (
        <ul className="versions-list">
          {versions.map((v) => (
            <li key={v.createdAt}>
              <span>{new Date(v.createdAt).toLocaleString()}</span>
              <span className="muted">{JSON.stringify(v.data).length.toLocaleString()} characters</span>
              <button
                className="btn"
                onClick={() => {
                  if (!root) return
                  updateDocument(root, type, id, () => v.data)
                  setRestored(v.createdAt)
                }}
              >
                {restored === v.createdAt ? 'Restored' : 'Restore'}
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
