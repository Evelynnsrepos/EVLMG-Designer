import { GitBranch } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useCollab } from '@/core/collab'
import { isTauri } from '@/core/fs'
import { backupHolder, checkGit, connectGitHub, inSharedRepo, splitIntoProjectRepos, syncNow, syncOpenToGit, turnOffGitSync, turnOnGitSync, useGitSync, type ConflictChoice } from '@/core/gitsync'
import { useProjectStore, useSettings } from '@/core/state'
import { confirmDialog, promptDialog } from '@/shared/dialogs'
import { Linkified } from '@/shared/links'
import { Modal } from '@/shared/ui'
import { GIT_LEARN_LINKS, GIT_SETUP_STEPS } from './setupSteps'
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
  syncTo: 'Sync to Git',
  syncFrom: 'Sync from Git',
  noGit: 'Install Git to use this (git-scm.com), then open this window again.',
  checking: 'Checking for Git…',
  on: (remote: string) => `On: ${remote}`,
  backupOn: (remote: string) => `Backing up to: ${remote}`,
  last: (when: string) => `Last sync ${new Date(when).toLocaleString()}`,
  heldBy: (name: string) => `${name} backs this project up to Git. Only one person can.`,
  login: 'Git uses your own GitHub login on this computer (step 3 of the setup, also in the guide).',
  connect: 'Connect GitHub',
  connectHint: 'Once per computer. After that, every project gets its own private GitHub repository automatically and is saved to it when you leave the project.',
  connected: (login: string) => `GitHub: ${login}. New projects get their own private repository (egd-…) automatically.`,
  turnOnAuto: 'Turn on Git saving',
  ownAddress: 'Use my own repository address instead',
  split: 'Give each project its own repository',
  advanced: 'Advanced',
  allowPublic: 'Allow syncing to a public repository',
  publicOn: 'Public repositories are allowed for this project. Anyone on the internet may be able to see it.',
  publicTitle: 'Allow a public repository?',
  publicWarning:
    'A public repository can be seen by everyone on the internet: all your text, story, notes, pictures and drawings in this project, and every older version of them, forever (copies may be made the moment it is public). New repositories are still made private; this only lets the project use a public repository you choose. Only turn this on for a project you really want to show the world.',
  publicConfirm: 'I understand',
  typeName: (name: string) => `Type the project name (${name}) to allow public repositories`,
  splitHint: 'This project shares one repository with other projects. Each of them gets its own private GitHub repository; the old one stays as it is, as a backup.',
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
  const githubLogin = useSettings((s) => s.githubLogin)
  const [shareRepo, setShareRepo] = useState(false)
  const meta = useProjectStore((s) => s.meta)
  const allowPublic = !!meta?.gitAllowPublic
  /** 0.20: public repositories only after a red warning and typing the project's name. */
  const setAllowPublic = async (on: boolean) => {
    if (!meta) return
    if (on) {
      if (!(await confirmDialog({ title: T.publicTitle, message: T.publicWarning, confirmLabel: T.publicConfirm, danger: true }))) return
      if ((await promptDialog(T.typeName(meta.name), ''))?.trim() !== meta.name.trim()) return
    }
    useProjectStore.getState().updateMeta({ gitAllowPublic: on })
  }
  useEffect(() => void inSharedRepo().then(setShareRepo), [mode])

  const body = () => {
    if (version === null) return <p className="muted">{T.checking}</p>
    if (!version) return <p className="gitsync-error">{T.noGit}</p>
    if (mode) {
      return (
        <>
          <p>{mode === 'backup' ? T.backupOn(remote) : T.on(remote)}</p>
          {lastSync && <p className="muted">{T.last(lastSync)}</p>}
          <div className="gitsync-actions">
            <button className="btn btn-primary" disabled={!!busy} title="Save this project to the repository now" onClick={() => void syncOpenToGit()}>
              {T.syncTo}
            </button>
            {mode === 'full' && (
              <button className="btn" disabled={!!busy} title="Get the repository's latest version now (saves yours first)" onClick={() => void syncNow()}>
                {T.syncFrom}
              </button>
            )}
            <button className="btn" disabled={!!busy} onClick={() => void turnOffGitSync()}>
              {T.turnOff}
            </button>
          </div>
          {shareRepo && (
            <>
              <p className="muted gitsync-small">{T.splitHint}</p>
              <button className="btn" disabled={!!busy} onClick={() => void (githubLogin ? splitIntoProjectRepos() : connectGitHub())}>
                {githubLogin ? T.split : T.connect}
              </button>
            </>
          )}
        </>
      )
    }
    if (shared && holder) return <p>{T.heldBy(holder.name)}</p>
    const manual = (
      <>
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
    return (
      <>
        <p className="gitsync-warning">{shared ? T.backupWarning : T.warning}</p>
        {githubLogin ? (
          <>
            <p className="muted">{T.connected(githubLogin)}</p>
            <label className="settings-check">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              {T.agree}
            </label>
            <div className="gitsync-actions">
              <button className="btn btn-primary" disabled={!agreed || !!busy} onClick={() => void turnOnGitSync('')}>
                {T.turnOnAuto}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted gitsync-small">{T.connectHint}</p>
            <div className="gitsync-actions">
              <button className="btn btn-primary" disabled={!!busy} onClick={() => void connectGitHub()}>
                {T.connect}
              </button>
            </div>
          </>
        )}
        <details className="gitsync-steps">
          <summary>{T.ownAddress}</summary>
          {manual}
        </details>
      </>
    )
  }

  return (
    <Modal onClose={onClose}>
      <div className="gitsync-dialog">
        <h3>{T.title}</h3>
        <p className="muted">{shared ? T.backupIntro : T.intro}</p>
        {body()}
        {!mode && <SetupSteps open={version === ''} />}
        {allowPublic && <p className="gitsync-error">{T.publicOn}</p>}
        <details className="gitsync-steps">
          <summary>{T.advanced}</summary>
          <label className="settings-check">
            <input type="checkbox" checked={allowPublic} onChange={(e) => void setAllowPublic(e.target.checked)} />
            {T.allowPublic}
          </label>
        </details>
        {busy && <p className="muted">{busy}</p>}
        {error && <p className="gitsync-error">{error}</p>}
        {notice && <p className="gitsync-notice">{notice}</p>}
        <p className="muted gitsync-small">{T.login}</p>
      </div>
    </Modal>
  )
}

/** The whole setup for people who never used Git, with links to learn more. */
function SetupSteps({ open }: { open: boolean }) {
  return (
    <details className="gitsync-steps" open={open}>
      <summary>New to Git? Set it up step by step (about 10 minutes, once)</summary>
      <ol>
        {GIT_SETUP_STEPS.map((step) => (
          <li key={step}>
            <Linkified text={step} />
          </li>
        ))}
      </ol>
      <h4>Learn more</h4>
      <ul>
        {GIT_LEARN_LINKS.map((link) => (
          <li key={link}>
            <Linkified text={link} />
          </li>
        ))}
      </ul>
    </details>
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
