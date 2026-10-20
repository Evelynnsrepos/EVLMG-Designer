import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { isTauri } from '@/core/fs'
import { parseGitConfig, testRemote, type RepoVisibility } from '@/core/gitsync'
import { gitDefaults, useSettings, type GitSettings } from '@/core/state'
import { confirmDialog } from '@/shared/dialogs'
import { Linkified } from '@/shared/links'

const T = {
  title: 'Git',
  hint: 'Options for Git sync (Git sync in the sidebar, Open from Git on the start screen). It works with any Git host: GitHub, GitLab, Gitea, Forgejo, Codeberg or your own server.',
  desktopOnly: 'Git sync works in the desktop app.',
  privateOnly: 'Git sync only uses private repositories, so unreleased story and art stay yours. Before it sends anything, it checks that the repository can not be read without a login.',
  check: 'Check a repository address',
  checkHint: 'Paste the address of a repository to see if Git on this computer can reach it with your login, and if it is private.',
  checkBtn: 'Check',
  checking: 'Checking…',
  visibility: {
    private: 'It is private.',
    public: 'It is PUBLIC: anyone on the internet can read it.',
    unknown: 'Could not check if it is private.',
  } satisfies Record<RepoVisibility, string>,
  branch: 'Branch for new repositories',
  branchHint: 'Used when Git sync makes a new repository. Most hosts use main.',
  message: 'Commit message',
  messageHint: '{date} becomes the date and time of the sync.',
  config: 'Extra Git settings',
  configHint: 'One key=value per line, added to every Git command of the app. Examples: http.sslVerify=false for your own server with a self-made certificate (only for a server you trust), http.proxy=http://proxy:8080 behind a proxy, http.postBuffer=524288000 for big pushes.',
  ignored: (lines: string[]) => `Not used (not key=value): ${lines.join(', ')}`,
  reset: 'Reset Git options',
  publicTitle: 'Public repositories',
  allowPublic: 'Allow syncing to public repositories (dangerous)',
  publicOn: 'Public repositories are allowed. Everything in a synced project, like story, characters, art and notes, can be read by anyone on the internet and stays in the repository history even after you delete it.',
  publicAsk:
    'A public repository can be read by anyone on the internet. Everything in the project goes there: unreleased story, characters, art, notes and names. It stays in the repository history even if you delete it later, and others can copy it.\n\nOnly turn this on for a project you really want to share with everyone.',
  publicConfirm: 'Allow public repositories',
  hostsTitle: 'Using GitLab, Gitea, Forgejo, Codeberg or your own server',
}

const HOST_STEPS = [
  'Make an empty, private repository on your host (on GitLab "Visibility: Private", on Gitea, Forgejo and Codeberg tick "Make repository private"). Leave "Initialize with a README" off.',
  'Copy its HTTPS address (it ends in .git) and paste it into Git sync or Open from Git, like with GitHub.',
  'Logging in, GitLab: on Windows, Git for Windows opens a sign-in window by itself. On Mac and Linux, make a personal access token (GitLab: Preferences, Access tokens, with read_repository and write_repository) and use it as the password the first time; or install GitLab CLI from https://gitlab.com/gitlab-org/cli and run "glab auth login".',
  'Logging in, Gitea, Forgejo and Codeberg: make an access token (Settings, Applications, with repository read and write) and use it as the password the first time. Git for Windows remembers it; on Mac and Linux run "git config --global credential.helper store" once, or use an SSH key.',
  'SSH works too: add your SSH key on the host\'s website, then use the SSH address (like git@your-server:you/game.git). The app never asks for a key password, so use a key without one or an ssh-agent.',
  'Own server with a self-made certificate: add http.sslVerify=false under Extra Git settings, only for a server you trust.',
  'Use "Check a repository address" above to test it before you turn sync on.',
]

/** v0.20: Settings, Git: options for other Git hosts, and the private-only rule with its opt-out. */
export function GitSettingsSection() {
  const git = useSettings((s) => s.git)
  const set = (patch: Partial<GitSettings>) => useSettings.getState().update({ git: { ...useSettings.getState().git, ...patch } })
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const desktop = isTauri()
  const ignored = git.config.map((l) => l.trim()).filter((l) => l && !parseGitConfig([l]).length)

  const check = async () => {
    setBusy(true)
    setResult(null)
    try {
      const r = await testRemote(url)
      setResult(`${r.message} ${T.visibility[r.visibility]}`)
    } catch (e) {
      setResult((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const togglePublic = async (on: boolean) => {
    if (on && !(await confirmDialog({ title: T.publicTitle, message: T.publicAsk, confirmLabel: T.publicConfirm, danger: true }))) return
    set({ allowPublic: on })
  }

  return (
    <section data-section="git">
      <h3>{T.title}</h3>
      <p className="muted settings-hint">{T.hint}</p>
      {!desktop && <p className="muted">{T.desktopOnly}</p>}
      <p className="settings-hint">{T.privateOnly}</p>

      <h4>{T.check}</h4>
      <p className="muted settings-hint">{T.checkHint}</p>
      <div className="settings-row">
        <input className="input settings-grow" placeholder="https://gitlab.com/you/my-game.git" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button className="btn" disabled={!desktop || busy || !url.trim()} onClick={() => void check()}>
          {busy ? T.checking : T.checkBtn}
        </button>
      </div>
      {result && <p className="settings-hint">{result}</p>}

      <label className="settings-field">
        <span>{T.branch}</span>
        <input className="input" value={git.branch} onChange={(e) => set({ branch: e.target.value })} />
      </label>
      <p className="muted settings-hint">{T.branchHint}</p>
      <label className="settings-field">
        <span>{T.message}</span>
        <input className="input" value={git.commitMessage} onChange={(e) => set({ commitMessage: e.target.value })} />
      </label>
      <p className="muted settings-hint">{T.messageHint}</p>
      <label className="settings-field">
        <span>{T.config}</span>
        <textarea className="input settings-mono" rows={3} spellCheck={false} placeholder="http.sslVerify=false" value={git.config.join('\n')} onChange={(e) => set({ config: e.target.value.split('\n') })} />
      </label>
      <p className="muted settings-hint">{T.configHint}</p>
      {ignored.length > 0 && <p className="settings-error">{T.ignored(ignored)}</p>}

      <h4>{T.publicTitle}</h4>
      <label className="settings-check">
        <input type="checkbox" checked={git.allowPublic} onChange={(e) => void togglePublic(e.target.checked)} />
        {T.allowPublic}
      </label>
      {git.allowPublic && (
        <p className="settings-danger">
          <ShieldAlert size={16} /> {T.publicOn}
        </p>
      )}

      <details className="settings-card">
        <summary>{T.hostsTitle}</summary>
        <ol className="settings-steps">
          {HOST_STEPS.map((s) => (
            <li key={s}>
              <Linkified text={s} />
            </li>
          ))}
        </ol>
      </details>
      <div>
        <button className="btn btn-ghost" onClick={() => set({ ...gitDefaults(), allowPublic: git.allowPublic })}>
          {T.reset}
        </button>
      </div>
    </section>
  )
}
