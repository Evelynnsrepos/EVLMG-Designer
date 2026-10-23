import { Copy, Link2, RefreshCw, Server, Users, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  clearEnded,
  forgetSharing,
  inviteCode,
  joinProject,
  moveToServer,
  newInviteCode,
  parseInvite,
  PROFILE_COLORS,
  removeMember,
  setProfile,
  shareProject,
  stopSharingHere,
  useCollab,
  usePresence,
  useTeammatesAt,
  type JoinHandle,
} from '@/core/collab'
import { getFs } from '@/core/fs'
import { defaultProjectsDir, deleteProject, removeRecent } from '@/core/project'
import { useProjectStore } from '@/core/state'
import { confirmDialog } from '@/shared/dialogs'
import { Modal } from '@/shared/ui'
import { backToProjects } from '../editor/actions'
import './collab.css'

/** Text shown to users, kept together for translation later. */
const T = {
  shareTitle: 'Work together',
  shareIntro:
    'Share this project so others can edit it live from their own computer (Windows, Mac or Linux). Everyone keeps a full copy, and changes made offline merge when you reconnect. No account or server needed.',
  privacy: 'Privacy: computers connect directly, so the people you work with can see your IP address. To find each other, and when a direct connection is not possible, the app uses public lookup and relay servers run by n0, a US company (iroh); they see your IP address and a random device ID. Project contents stay end-to-end encrypted.',
  yourName: 'Your name',
  namePlaceholder: 'How others see you',
  startSharing: 'Share project',
  inviteLabel: 'Invite code',
  inviteHelp: 'Send this code to a teammate. They choose "Join project" on the start screen and paste it. You will be asked to let them in.',
  copy: 'Copy',
  copied: 'Copied',
  newCode: 'New invite code',
  newCodeHelp: 'Codes you already sent stop working.',
  people: 'People in this project',
  gitBackup: (name: string) => `Git backup by ${name}`,
  you: '(you)',
  online: 'Online',
  offline: 'Offline',
  remove: 'Remove from project',
  host: '(host)',
  stopSharing: 'Stop sharing for everyone',
  leave: 'Leave project',
  keepCopy: 'Keep my copy',
  deleteCopy: 'Delete my copy',
  endedTitle: (host: string) => `${host} closed the project`,
  endedText: (project: string) =>
    `You are no longer connected to "${project}". Keep your copy on this computer as a normal project, or delete it?`,
  leaveTitle: 'Leave this project?',
  leaveText: 'You stop working together with the others. Keep your copy on this computer as a normal project, or delete it?',
  close: 'Close',
  joinTitle: 'Join a shared project',
  joinIntro:
    'Paste the invite code someone sent you, or a connect code from an EDG server. The project is copied to this computer and stays in sync.',
  codePlaceholder: 'EGD1-... or EGS1-...',
  saveIn: 'Save in',
  change: 'Change…',
  join: 'Join',
  cancel: 'Cancel',
  connecting: 'Connecting…',
  waiting: (project: string) => `Waiting to be let in to "${project}"…`,
  invalidCode: 'That is not a valid invite code.',
  needName: 'Please enter your name so the others know who you are.',
  serverTitle: 'Or work through a server',
  serverIntro:
    'With an EDG server, people can sync even when nobody else is online. Paste the connect code you got from the server’s admin; this project is copied to the server.',
  serverPlaceholder: 'EGS1-...',
  moveToServer: 'Move to server',
  moving: 'Moving…',
  movedP2pNote: 'People you shared with directly are disconnected and need their own connect code from the server’s admin.',
  connectedVia: (server: string) => `Working through the server “${server}”.`,
  viewOnly: 'Your connect code can only view this project. Changes you make here are not sent to anyone.',
  serverInvite: 'New people get their own connect code from the server’s admin page.',
  onlineNow: 'Online now',
  nobodyElse: 'Nobody else is online.',
  nameNote: 'Names are chosen by each person and not checked.',
}

function ProfileFields() {
  const profile = useCollab((s) => s.profile)
  return (
    <div className="collab-profile">
      <label className="collab-field">
        <span>{T.yourName}</span>
        <input className="input" value={profile.name} placeholder={T.namePlaceholder} maxLength={40} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
      </label>
      <div className="collab-colors" role="radiogroup" aria-label="Your color">
        {PROFILE_COLORS.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={profile.color === c}
            className={`collab-color${profile.color === c ? ' selected' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => setProfile({ ...profile, color: c })}
          />
        ))}
      </div>
    </div>
  )
}

/** Sidebar dialog: start sharing, invite code, people. */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const { shared, online, peers, members, selfId, error, profile, isHost, hostId, server } = useCollab()
  const gitBackup = useProjectStore((s) => s.meta?.gitBackup)
  const [leaving, setLeaving] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!shared || code || server) return
    let cancelled = false
    inviteCode()
      .then((c) => !cancelled && setCode(c))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [shared, online, code, server])

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await fn()
      if (typeof result === 'string') setCode(result)
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!code) return
    await navigator.clipboard.writeText(code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const onlineIds = new Set(peers.map((p) => p.id))

  return (
    <Modal onClose={onClose}>
      <h3 className="collab-title">
        <Users size={18} /> {T.shareTitle}
      </h3>
      {!shared && <p className="muted">{T.shareIntro}</p>}
      <p className="muted collab-small">{T.privacy}</p>
      <ProfileFields />

      {shared && server ? (
        <>
          <ServerInfo name={server.name} viewOnly={server.role === 'view'} />
          <div className="modal-actions collab-actions">
            <button className="btn btn-ghost collab-danger" onClick={() => setLeaving(true)}>
              {T.leave}
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              {T.close}
            </button>
          </div>
        </>
      ) : !shared ? (
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {T.cancel}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              if (!profile.name.trim()) return setMessage(T.needName)
              void run(shareProject)
            }}
          >
            <Link2 size={15} /> {T.startSharing}
          </button>
        </div>
      ) : (
        <>
          <div className="collab-field">
            <span>{T.inviteLabel}</span>
            <div className="collab-code-row">
              <input className="input collab-code" readOnly value={code ?? T.connecting} onFocus={(e) => e.target.select()} />
              <button className="btn" disabled={!code} onClick={() => void copy()}>
                <Copy size={14} /> {copied ? T.copied : T.copy}
              </button>
            </div>
            <span className="muted collab-small">{T.inviteHelp}</span>
            <button className="btn btn-ghost collab-small" title={T.newCodeHelp} disabled={busy} onClick={() => void run(newInviteCode)}>
              <RefreshCw size={13} /> {T.newCode}
            </button>
          </div>

          <div className="collab-field">
            <span>{T.people}</span>
            <ul className="collab-people">
              {members.map((m) => {
                const isSelf = m.id === selfId
                const isOnline = isSelf ? online : onlineIds.has(m.id)
                const live = peers.find((p) => p.id === m.id)
                return (
                  <li key={m.id}>
                    <span className="collab-dot" style={{ background: (isSelf ? profile.color : live?.color) || m.color || 'var(--text-muted)' }} />
                    <span className="collab-person">
                      {(isSelf ? profile.name : live?.name) || m.name || 'Someone'} {isSelf && <span className="muted">{T.you}</span>}{' '}
                      {m.id === hostId && <span className="muted">{T.host}</span>}
                    </span>
                    <span className={`collab-state${isOnline ? ' online' : ''}`}>{isOnline ? T.online : T.offline}</span>
                    {isHost && !isSelf && (
                      <button
                        className="icon-btn"
                        title={T.remove}
                        onClick={async () => {
                          const ok = await confirmDialog({
                            title: `Remove ${m.name || 'this person'}?`,
                            message: 'They keep their own copy but can no longer connect. Consider making a new invite code too.',
                            confirmLabel: 'Remove',
                            danger: true,
                          })
                          if (ok) removeMember(m.id)
                        }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            {gitBackup && <span className="muted collab-small">{T.gitBackup(gitBackup.name)}</span>}
          </div>

          <div className="modal-actions collab-actions">
            {isHost ? (
              <button
                className="btn btn-ghost collab-danger"
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: 'Stop sharing for everyone?',
                    message: 'Everyone connected is disconnected and asked whether to keep their copy. The project stays here with everything in it.',
                    confirmLabel: 'Stop sharing',
                    danger: true,
                  })
                  if (ok) {
                    await stopSharingHere()
                    onClose()
                  }
                }}
              >
                {T.stopSharing}
              </button>
            ) : (
              <button className="btn btn-ghost collab-danger" onClick={() => setLeaving(true)}>
                {T.leave}
              </button>
            )}
            <button className="btn btn-primary" onClick={onClose}>
              {T.close}
            </button>
          </div>
        </>
      )}
      {(!shared || (isHost && !server)) && <MoveToServer shared={shared} />}
      {(message || error) && <div className="collab-error">{message ?? error}</div>}
      {leaving && (
        <KeepCopyDialog
          title={T.leaveTitle}
          text={T.leaveText}
          onDone={async (choice) => {
            setLeaving(false)
            if (!choice) return
            const root = useProjectStore.getState().root
            await stopSharingHere()
            onClose()
            if (choice === 'delete' && root) await deleteOpenProject(root)
          }}
        />
      )}
    </Modal>
  )
}

/** Working through a server: who is online (from presence, since the only direct connection is the server). */
function ServerInfo({ name, viewOnly }: { name: string; viewOnly: boolean }) {
  const remotes = usePresence((s) => s.remotes)
  return (
    <div className="collab-field">
      <p>
        <Server size={14} /> {T.connectedVia(name)}
      </p>
      {viewOnly && <p className="collab-status">{T.viewOnly}</p>}
      <span className="muted collab-small">{T.serverInvite}</span>
      <span>{T.onlineNow}</span>
      <ul className="collab-people">
        {remotes.length === 0 && <li className="muted">{T.nobodyElse}</li>}
        {remotes.map((r) => (
          <li key={r.clientId}>
            <span className="collab-dot" style={{ background: r.color || 'var(--text-muted)' }} />
            <span className="collab-person">{r.name || 'Someone'}</span>
          </li>
        ))}
      </ul>
      <span className="muted collab-small">{T.nameNote}</span>
    </div>
  )
}

/** Paste a server connect code to move this project to the server. */
function MoveToServer({ shared }: { shared: boolean }) {
  const profile = useCollab((s) => s.profile)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <details className="collab-field">
      <summary>
        <Server size={14} /> {T.serverTitle}
      </summary>
      <p className="muted collab-small">{T.serverIntro}</p>
      {shared && <p className="muted collab-small">{T.movedP2pNote}</p>}
      <textarea className="input collab-code" rows={3} placeholder={T.serverPlaceholder} value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} />
      <div className="modal-actions">
        <button
          className="btn btn-primary"
          disabled={busy || !code.trim()}
          onClick={async () => {
            if (!profile.name.trim()) return setError(T.needName)
            setBusy(true)
            setError(null)
            try {
              await moveToServer(code)
              setCode('')
            } catch (e) {
              setError((e as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? T.moving : T.moveToServer}
        </button>
      </div>
      {error && <div className="collab-error">{error}</div>}
    </details>
  )
}

/** Close the project, delete its folder and go back to the start screen. */
async function deleteOpenProject(root: string) {
  await backToProjects()
  await deleteProject(root)
  await removeRecent(root)
}

/** Keep or delete this computer's copy (leaving, or after the host ended the project). */
function KeepCopyDialog({ title, text, onDone }: { title: string; text: string; onDone: (choice: 'keep' | 'delete' | null) => void }) {
  const [sure, setSure] = useState(false)
  return (
    <Modal onClose={() => onDone(null)}>
      <h3 className="collab-title">{title}</h3>
      <p className="muted">{text}</p>
      <div className="modal-actions">
        <button className={`btn btn-danger${sure ? ' armed' : ''}`} onClick={() => (sure ? onDone('delete') : setSure(true))}>
          {sure ? 'Press again to delete' : T.deleteCopy}
        </button>
        <button className="btn btn-primary" autoFocus onClick={() => onDone('keep')}>
          {T.keepCopy}
        </button>
      </div>
    </Modal>
  )
}

/** Shown when the host closes the shared project: everyone else is disconnected and decides what to do with their copy. */
export function SharingEndedHost() {
  const ended = useCollab((s) => s.ended)
  if (!ended) return null
  return (
    <KeepCopyDialog
      title={T.endedTitle(ended.host)}
      text={T.endedText(ended.projectName)}
      onDone={async (choice) => {
        if (choice === 'delete') {
          clearEnded()
          await deleteOpenProject(ended.root)
        } else {
          // Closing the dialog keeps the copy too: deleting is never the default.
          await forgetSharing(ended.root)
        }
      }}
    />
  )
}

/** Launcher dialog: paste an invite code and join. */
export function JoinDialog({ onClose, onJoined }: { onClose: () => void; onJoined: (root: string) => void }) {
  const profile = useCollab((s) => s.profile)
  const [code, setCode] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [handle, setHandle] = useState<JoinHandle | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void defaultProjectsDir().then((d) => setFolder((f) => f ?? d))
  }, [])

  const invite = parseInvite(code)

  const start = () => {
    setError(null)
    if (!profile.name.trim()) return setError(T.needName)
    if (!invite) return setError(T.invalidCode)
    setStatus(T.connecting)
    const h = joinProject(code, folder ?? undefined, () => setStatus(T.waiting(invite.projectName)))
    setHandle(h)
    setStatus(T.waiting(invite.projectName))
    h.done.then(
      (root) => {
        setHandle(null)
        onJoined(root)
      },
      (e: Error) => {
        setHandle(null)
        setStatus(null)
        if (e.message !== 'Cancelled') setError(e.message)
      },
    )
  }

  const cancel = () => {
    handle?.cancel()
    onClose()
  }

  return (
    <Modal onClose={cancel}>
      <h3 className="collab-title">
        <Users size={18} /> {T.joinTitle}
      </h3>
      <p className="muted">{T.joinIntro}</p>
      <ProfileFields />
      <label className="collab-field">
        <span>{T.inviteLabel}</span>
        <textarea className="input collab-code" rows={3} placeholder={T.codePlaceholder} value={code} onChange={(e) => setCode(e.target.value)} disabled={!!handle} />
      </label>
      <div className="collab-field">
        <span>{T.saveIn}</span>
        <div className="collab-code-row">
          <input className="input" readOnly value={folder ?? ''} />
          <button
            className="btn"
            disabled={!!handle}
            onClick={async () => {
              const picked = await getFs().pickFolder(T.saveIn)
              if (picked) setFolder(picked)
            }}
          >
            {T.change}
          </button>
        </div>
      </div>
      {status && <div className="collab-status">{status}</div>}
      {error && <div className="collab-error">{error}</div>}
      <div className="modal-actions">
        <button className="btn" onClick={cancel}>
          {T.cancel}
        </button>
        <button className="btn btn-primary" disabled={!!handle || !code.trim()} onClick={start}>
          {T.join}
        </button>
      </div>
    </Modal>
  )
}

/** Small sidebar indicator: colored dots for who is online. */
export function PresenceDots() {
  const direct = useCollab((s) => s.peers)
  const server = useCollab((s) => s.server)
  const remotes = usePresence((s) => s.remotes)
  // Through a server the only direct peer is the server itself; teammates are known from presence.
  const peers = server ? remotes.map((r) => ({ id: String(r.clientId), name: r.name, color: r.color })) : direct
  if (peers.length === 0) return null
  return (
    <span className="collab-dots" title={peers.map((p) => p.name).join(', ')}>
      {peers.slice(0, 4).map((p) => (
        <span key={p.id} className="collab-dot" style={{ background: p.color || 'var(--accent)' }} />
      ))}
    </span>
  )
}

/** Dots for teammates working in a tool or document right now (sidebar rows). */
export function TeammateDots({ at, wholeType = false }: { at: string; wholeType?: boolean }) {
  const here = useTeammatesAt(at, wholeType)
  if (here.length === 0) return null
  return (
    <span className="collab-dots" title={`${here.map((r) => r.name).join(', ')} ${here.length === 1 ? 'is' : 'are'} here`}>
      {here.slice(0, 3).map((r) => (
        <span key={r.clientId} className="collab-dot" style={{ background: r.color }} />
      ))}
    </span>
  )
}
