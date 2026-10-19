import { GitBranch } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useCollab } from '@/core/collab'
import { isTauri } from '@/core/fs'
import { backupHolder, checkGit, syncNow, turnOffGitSync, turnOnGitSync, useGitSync, type ConflictChoice } from '@/core/gitsync'
import { confirmDialog } from '@/shared/dialogs'
import { Modal } from '@/shared/ui'
import './gitsync.css'

/** Git sync (0.19): the sidebar row, its window, and the "which version?" question. Desktop only. */

const T = {
  title: 'Git sync',
  intro: 'Keep this project in a Git repository, with the Git installed on your computer. It gets the latest version when the project opens and saves to the repository when it closes.',
  backupIntro:
    'This project is shared, so Git can only back it up: when you close the project, everyone’s merged work is saved to the repository. It never takes anything from the repository, so it can never undo a teammate’s newer work.',
  warning:
    'Git sync is for one person only. Use it to move your own project between your own computers or to keep its history on GitHub. If two people sync the same project through Git, one person’s work can overwrite the other’s. To work together, use Work together or a server instead.',
  backupWarning: 'Only one person can back up a shared project. Turning it on shows your name to the others.',
  agree: 'I understand',
  url: 'Repository address',
  urlHint: 'Make an empty, private repository (on GitHub or anywhere else) and paste its address. Private is best: projects hold unreleased story and art.',
  turnOn: 'Turn on',
  turnOff: 'Turn off',
  syncNow: 'Sync now',
  noGit: 'Install Git to use this (git-scm.com), then open this window again.',
  checking: 'Checking for Git…',
  on: (remote: string) => `On: ${remote}`,
  backupOn: (remote: string) => `Backing up to: ${remote}`,
  last: (when: string) => `Last sync ${new Date(when).toLocaleString()}`,
  heldBy: (name: string) => `${name} backs this project up to Git. Only one person can.`,
  login: 'Git uses your own login. If it asks for one, log in once with Git in a terminal (or GitHub Desktop).',
}

/** Sidebar row; hidden in the browser build. */
export function GitSyncRow({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false)
  const { mode, error, busy } = useGitSync()
  if (!isTauri()) return null
  return (
    <>
      <button className="sidebar-row" title={error ?? busy ?? T.title} onClick={() => setOpen(true)}>
        <GitBranch size={16} />
        {!collapsed && <span>{T.title}</span>}
        {!collapsed && mode && <span className={`gitsync-dot${error ? ' error' : ''}`} />}
      </button>
      {open && <GitSyncDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function GitSyncDialog({ onClose }: { onClose: () => void }) {
  const { version, mode, remote, lastSync, busy, error, notice } = useGitSync()
  const shared = useCollab((s) => s.shared)
  const [url, setUrl] = useState('')
  const [agreed, setAgreed] = useState(false)
  useEffect(() => void checkGit(), [])
  const holder = backupHolder()

  const body = () => {
    if (version === null) return <p className="muted">{T.checking}</p>
    if (!version) return <p className="gitsync-error">{T.noGit}</p>
    if (mode) {
      return (
        <>
          <p>{mode === 'backup' ? T.backupOn(remote) : T.on(remote)}</p>
          {lastSync && <p className="muted">{T.last(lastSync)}</p>}
          <div className="gitsync-actions">
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void syncNow()}>
              {T.syncNow}
            </button>
            <button className="btn" disabled={!!busy} onClick={() => void turnOffGitSync()}>
              {T.turnOff}
            </button>
          </div>
        </>
      )
    }
    if (shared && holder) return <p>{T.heldBy(holder.name)}</p>
    return (
      <>
        <p className="gitsync-warning">{shared ? T.backupWarning : T.warning}</p>
        <label className="gitsync-field">
          <span>{T.url}</span>
          <input className="input" value={url} placeholder="https://github.com/you/my-game.git" onChange={(e) => setUrl(e.target.value)} />
        </label>
        <p className="muted gitsync-small">{T.urlHint}</p>
        <label className="settings-check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          {T.agree}
        </label>
        <div className="gitsync-actions">
          <button className="btn btn-primary" disabled={!agreed || !url.trim() || !!busy} onClick={() => void turnOnGitSync(url)}>
            {T.turnOn}
          </button>
        </div>
      </>
    )
  }

  return (
    <Modal onClose={onClose}>
      <div className="gitsync-dialog">
        <h3>{T.title}</h3>
        <p className="muted">{shared ? T.backupIntro : T.intro}</p>
        {body()}
        {busy && <p className="muted">{busy}</p>}
        {error && <p className="gitsync-error">{error}</p>}
        {notice && <p className="gitsync-notice">{notice}</p>}
        <p className="muted gitsync-small">{T.login}</p>
      </div>
    </Modal>
  )
}

/** Shown anywhere (also while a project opens from the start screen): progress and the "which version?" question. */
export function GitSyncHost() {
  const { conflict, busy, error } = useGitSync()
  const [dismissed, setDismissed] = useState<string | null>(null)
  if (conflict) return <ConflictDialog onChoose={conflict.resolve} />
  if (busy) return <div className="gitsync-toast">{busy}</div>
  if (error && error !== dismissed) {
    return (
      <div className="gitsync-toast error" role="alert">
        {error}
        <button className="icon-btn" aria-label="Dismiss" onClick={() => setDismissed(error)}>
          ×
        </button>
      </div>
    )
  }
  return null
}

function ConflictDialog({ onChoose }: { onChoose: (choice: ConflictChoice) => void }) {
  const keepMine = async () => {
    const ok = await confirmDialog({
      title: 'Overwrite the repository?',
      message: 'The version in the repository is replaced by this computer’s version. The repository’s version can only be found in its history afterwards.',
      confirmLabel: 'Overwrite',
      danger: true,
    })
    if (ok) onChoose('mine')
  }
  return (
    <Modal onClose={() => onChoose('cancel')}>
      <div className="gitsync-dialog">
        <h3>This project changed in two places</h3>
        <p>It was changed on this computer and in the Git repository since the last sync. Git sync never mixes them, so pick one.</p>
        <div className="gitsync-choices">
          <button className="btn btn-primary" onClick={() => onChoose('git')}>
            Use the Git version
          </button>
          <span className="muted gitsync-small">This computer’s version is saved as a backup first (Restore a backup… in the project’s menu on the start screen).</span>
          <button className="btn" onClick={() => void keepMine()}>
            Keep this computer’s version
          </button>
          <span className="muted gitsync-small">It replaces the version in the repository.</span>
          <button className="btn btn-ghost" onClick={() => onChoose('cancel')}>
            Cancel
          </button>
          <span className="muted gitsync-small">Leave both as they are. Saving to Git fails until you choose.</span>
        </div>
      </div>
    </Modal>
  )
}
