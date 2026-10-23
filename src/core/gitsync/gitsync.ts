import { create } from 'zustand'
import { createBackup } from '../backups'
import { useCollab } from '../collab'
import { getFs, isTauri, safeFolderName } from '../fs'
import { defaultProjectsDir } from '../project'
import { addProjectLifecycleHook, flushAll, useProjectStore, useSettings } from '../state'
import { checkPrivate, createProjectRepo, gitHubLogin, setCredentialAsker } from './github'

/**
 * Git sync (0.19): keeps a project folder in a Git repository with the user's own installed git.
 * Git saving (0.20): with GitHub connected, every project gets its own private repository, made by
 * the app, and pushing after leaving a project runs in the background.
 *
 * - "full" (one person, several computers): pull when the project opens, commit and push when it
 *   closes. Never merges: when both sides changed, the user picks which version wins.
 * - "backup" (a shared project): one member's computer commits and pushes the merged project when
 *   it closes. It never pulls, so it can never undo teammates' newer work.
 *
 * The mode lives in the folder's own `.git/config` (`egd.sync`), so it is per computer and never
 * committed. Everything here runs git through `runner`; tests swap in a real local git.
 */

export type GitSyncMode = 'full' | 'backup'
export type ConflictChoice = 'git' | 'mine' | 'cancel'

export interface GitResult {
  /** -1 when git took too long and was stopped. */
  code: number
  stdout: string
  stderr: string
}
export type GitRunner = (cwd: string, args: string[], timeoutMs: number, input?: string) => Promise<GitResult>

const QUICK_MS = 15_000
const NETWORK_MS = 60_000
/** While turning sync on, Git may open a sign-in window (Windows); give the person time to sign in. */
const SIGN_IN_MS = 5 * 60_000
let networkMs = NETWORK_MS
/** Closing must never hang for long, even offline. */
const CLOSE_PUSH_MS = 30_000
const WARN_BYTES = 50 * 1024 * 1024
const MAX_BYTES = 100 * 1024 * 1024
const IGNORED = ['.backups/', 'collab/']

let runner: GitRunner = async (cwd, args, timeoutMs, input) => {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<GitResult>('git_run', { cwd, args, timeoutMs, input: input ?? null })
}
/** For tests: run git some other way. */
export const setGitRunner = (next: GitRunner) => void (runner = next)

interface GitSyncState {
  /** The installed git's version, '' when none, null until checked (desktop only). */
  version: string | null
  /** Git sync of the open project; null = off. */
  mode: GitSyncMode | null
  remote: string
  lastSync: string | null
  /** What is running right now, in plain words. */
  busy: string | null
  error: string | null
  /** Something worth knowing that is not an error (big files, sync turned off). */
  notice: string | null
  /** Set while the user must choose between this computer's version and the Git version. */
  conflict: { resolve(choice: ConflictChoice): void } | null
}

export const useGitSync = create<GitSyncState>(() => ({
  version: null,
  mode: null,
  remote: '',
  lastSync: null,
  busy: null,
  error: null,
  notice: null,
  conflict: null,
}))

export class GitError extends Error {}

/** A git failure in plain words. */
export function explainGit(r: GitResult): string {
  if (r.code === -1) return 'Git took too long and was stopped. Check your internet connection and try again.'
  const text = (r.stderr || r.stdout).trim()
  if (/terminal prompts disabled|could not read (Username|Password)|Authentication failed|Permission denied \(publickey|Host key verification failed/i.test(text)) {
    return 'Git needs you to log in to your Git host (GitHub, GitLab, Gitea, ...). Follow step 3 of the setup (in the Git sync window or the guide), then try again.'
  }
  if (/Could not resolve host|Network is unreachable|Connection (timed out|refused)|Failed to connect/i.test(text)) return 'Could not reach the repository. Check your internet connection.'
  if (/\[rejected\]|non-fast-forward|fetch first/i.test(text)) return 'The repository has newer changes. Use Sync from Git to get them first.'
  if (/repository .* not found|does not appear to be a git repository/i.test(text)) return 'Git could not find that repository. Check the address.'
  if (/SSL certificate problem|server certificate verification failed/i.test(text)) {
    return 'Git does not trust the server\'s certificate. For your own server (like a home Gitea) you can add http.sslVerify=false under Settings, Git, Extra Git settings.'
  }
  return text.split('\n').filter(Boolean).pop() ?? `Git failed (code ${r.code}).`
}

/** "key=value" lines from Settings, Git; anything else is ignored. */
export function parseGitConfig(lines: string[]): string[] {
  return lines.map((l) => l.trim()).filter((l) => /^[A-Za-z][\w-]*(\.[^=\s]+)+=.*$/.test(l))
}

/** The user's extra Git settings (Settings, Git) go in front of every command as `-c key=value`. */
const extraConfig = () => parseGitConfig(useSettings.getState().git.config).flatMap((l) => ['-c', l])

function git(root: string, args: string[], timeout = QUICK_MS, input?: string) {
  // An empty folder would make git run wherever the app was started, in someone else's repository.
  if (!root.trim()) throw new GitError('No project folder for Git.')
  return runner(root, [...extraConfig(), ...args], timeout, input)
}

/** The GitHub token the computer's git already uses (gh, Git Credential Manager, a keychain); '' when none. */
async function gitHubToken(): Promise<string> {
  const r = await git(await getFs().documentDir(), ['credential', 'fill'], SIGN_IN_MS, 'protocol=https\nhost=github.com\n\n')
  return r.code === 0 ? (/^password=(.*)$/m.exec(r.stdout)?.[1]?.trim() ?? '') : ''
}
async function must(root: string, args: string[], timeout = QUICK_MS) {
  const r = await git(root, args, timeout)
  if (r.code !== 0) throw new GitError(explainGit(r))
  return r.stdout.trim()
}

const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace('T', ' ')

// ---- private repositories only (v0.20) -----------------------------------------------

export type RepoVisibility = 'private' | 'public' | 'unknown'

/** Where an anonymous visitor would read the repository: SSH addresses become HTTPS, logins are dropped. Null for folders on this computer. */
export function publicReadUrl(url: string): string | null {
  const u = url.trim()
  const scp = /^[\w.-]+@([\w.-]+):(?!\/\/)(.+)$/.exec(u)
  if (scp) return `https://${scp[1]}/${scp[2].replace(/^\/+/, '')}`
  const full = /^(?:ssh|git|https?):\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(u)
  if (!full) return null
  const keepPort = /^https?:/i.test(u) ? (/^[a-z]+:\/\/(?:[^@/]*@)?[^/:]+(:\d+)/i.exec(u)?.[1] ?? '') : ''
  return `${/^http:/i.test(u) ? 'http' : 'https'}://${full[1]}${keepPort}/${full[2]}`
}

/**
 * Whether anyone on the internet can read the repository: Git asks for it without any login.
 * Folders on this computer count as private.
 */
export async function checkVisibility(url: string): Promise<RepoVisibility> {
  const open = publicReadUrl(url)
  if (!open) return 'private'
  const cwd = await defaultProjectsDir()
  await getFs().mkdir(cwd)
  // No saved logins and no login window, so only a public repository answers.
  const r = await runner(cwd, [...extraConfig(), '-c', 'credential.helper=', '-c', 'core.askPass=', 'ls-remote', '--heads', open], 15_000)
  if (r.code === 0) return 'public'
  const text = r.stderr + r.stdout
  if (/terminal prompts disabled|could not read (Username|Password)|Authentication failed|requested URL returned error: (401|403|404)|not found|HTTP Basic: Access denied/i.test(text)) return 'private'
  return 'unknown'
}

export const PUBLIC_REPO_ERROR =
  'This repository is public: anyone on the internet can see it, including unreleased story and art. Git sync only uses private repositories. Make it private on the website of your Git host, or allow a public repository for this project in its Git sync window (not recommended).'

/** Settings, Git, "Check": can this computer reach the repository with its login, and is it private? */
export async function testRemote(url: string): Promise<{ ok: boolean; message: string; visibility: RepoVisibility }> {
  const cwd = await defaultProjectsDir()
  await getFs().mkdir(cwd)
  const [r, visibility] = await Promise.all([runner(cwd, [...extraConfig(), 'ls-remote', '--heads', url.trim()], NETWORK_MS), checkVisibility(url)])
  return { ok: r.code === 0, message: r.code === 0 ? 'Git can reach this repository.' : explainGit(r), visibility }
}

/**
 * Stops before anything is sent to a public repository on any host, unless the project allows one
 * (its Git sync window, behind a warning). github.com addresses are also checked by `checkPrivate`.
 */
async function mustBePrivate(url: string, allowPublic: boolean) {
  if (allowPublic) return
  if ((await checkVisibility(url)) === 'public') throw new GitError(PUBLIC_REPO_ERROR)
}

/** The branch name from Settings, Git, when Git would accept it. */
const safeBranch = () => {
  const b = useSettings.getState().git.branch.trim()
  return /^(?!-)(?!.*\.\.)[\w./-]+(?<![./])$/.test(b) ? b : 'main'
}

const commitMessage = () => (useSettings.getState().git.commitMessage.trim() || 'EGD sync {date}').replaceAll('{date}', stamp())

/** The installed git, checked once. Never available in the browser build. */
export async function checkGit(): Promise<boolean> {
  if (useGitSync.getState().version === null) {
    if (!isTauri()) return false
    const { invoke } = await import('@tauri-apps/api/core')
    useGitSync.setState({ version: (await invoke<string | null>('git_version').catch(() => null)) ?? '' })
  }
  return !!useGitSync.getState().version
}

/**
 * This folder's sync mode, from the git config of the repository it is in. The project can be the
 * repository itself or a folder inside a bigger one (e.g. a repository holding all your projects).
 */
export async function readMode(root: string): Promise<GitSyncMode | null> {
  const value = (await git(root, ['config', '--get', 'egd.sync'])).stdout.trim()
  return value === 'full' || value === 'backup' ? value : null
}

/** Backups and sharing state stay out of the repository, also for projects inside a bigger one. */
async function ensureGitignore(root: string) {
  const fs = getFs()
  const path = await fs.join(await must(root, ['rev-parse', '--show-toplevel']), '.gitignore')
  const text = (await fs.exists(path)) ? await fs.readText(path) : ''
  const missing = IGNORED.filter((line) => !text.split(/\r?\n/).includes(line))
  if (missing.length) await fs.writeTextAtomic(path, (text && !text.endsWith('\n') ? text + '\n' : text) + missing.join('\n') + '\n')
}

const branch = (root: string) => must(root, ['symbolic-ref', '--short', 'HEAD'])

/** Commit everything that changed. False when there was nothing to commit. */
export async function commitAll(root: string): Promise<boolean> {
  await ensureGitignore(root)
  // Ones already committed earlier (by hand) leave the repository too; the files stay on disk.
  await must(root, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', ':(top,glob)**/.backups/**', ':(top,glob)**/collab/**'])
  await must(root, ['add', '-A'])
  if ((await git(root, ['diff', '--cached', '--quiet'])).code === 0) return false
  // Commits need a name; people who never set one up in git get the app's.
  const named = (await git(root, ['config', 'user.email'])).code === 0
  const who = named ? [] : ['-c', `user.name=${useCollab.getState().profile.name || 'EDG'}`, '-c', 'user.email=egd@localhost']
  await must(root, [...who, 'commit', '-q', '-m', commitMessage()])
  return true
}

/** Files over 50 MB get a notice; over 100 MB stop the push, because GitHub refuses them. */
async function checkBigFiles(root: string) {
  const big = (await must(root, ['ls-tree', '-r', '-l', 'HEAD']))
    .split('\n')
    .map((line) => /^\S+ blob \S+\s+(\d+)\t(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => !!m && Number(m[1]) > WARN_BYTES)
  const tooBig = big.filter((m) => Number(m[1]) > MAX_BYTES).map((m) => m[2])
  if (tooBig.length) throw new GitError(`Too big for GitHub (over 100 MB): ${tooBig.join(', ')}. Remove or shrink it, then sync again.`)
  if (big.length) useGitSync.setState({ notice: `Big files (over 50 MB), GitHub may warn about them: ${big.map((m) => m[2]).join(', ')}` })
}

async function push(root: string, force: boolean, timeout = networkMs) {
  await mustBePrivate(await must(root, ['remote', 'get-url', 'origin']), allowsPublic(root))
  await checkBigFiles(root)
  const b = await branch(root)
  await must(root, ['push', '-q', ...(force ? ['--force-with-lease'] : []), '-u', 'origin', `HEAD:refs/heads/${b}`], timeout)
}

/** True when this computer has commits the repository doesn't have yet. */
async function hasUnpushed(root: string) {
  const b = await branch(root)
  if ((await git(root, ['rev-parse', '--verify', '-q', `origin/${b}`])).code !== 0) return true
  return Number(await must(root, ['rev-list', '--count', `origin/${b}..HEAD`])) > 0
}

const askConflict = () => new Promise<ConflictChoice>((resolve) => useGitSync.setState({ conflict: { resolve: (c) => (useGitSync.setState({ conflict: null }), resolve(c)) } }))

/**
 * Bring this computer up to date with the repository (full mode). Local changes are committed
 * first. When both sides changed, the user chooses; nothing is ever merged.
 */
export async function pullLatest(root: string): Promise<'same' | 'pulled' | 'pushed' | 'cancelled'> {
  await commitAll(root)
  await must(root, ['fetch', '-q', 'origin'], networkMs)
  const remote = `origin/${await branch(root)}`
  if ((await git(root, ['rev-parse', '--verify', '-q', remote])).code !== 0) return 'same'
  const [ahead, behind] = (await must(root, ['rev-list', '--left-right', '--count', `HEAD...${remote}`])).split(/\s+/).map(Number)
  if (!behind) return 'same'
  if (!ahead) {
    await must(root, ['merge', '-q', '--ff-only', remote])
    return 'pulled'
  }
  const choice = await askConflict()
  if (choice === 'git') {
    // This computer's version is kept twice: in the project backups and as a git branch.
    await createBackup(root, 'before-git')
    await must(root, ['branch', '-f', `egd-backup-${stamp().replace(/[ :]/g, '-')}`])
    await must(root, ['reset', '-q', '--hard', remote])
    return 'pulled'
  }
  if (choice === 'mine') {
    await push(root, true)
    return 'pushed'
  }
  return 'cancelled'
}

/** Commit and push if anything is new (both modes). */
export async function pushLatest(root: string, timeout = networkMs) {
  if ((await commitAll(root)) || (await hasUnpushed(root))) await push(root, false, timeout)
}

/** Runs a git job with a status line; failures become the shown error, never a thrown one. */
async function step(label: string, job: () => Promise<unknown>): Promise<boolean> {
  useGitSync.setState({ busy: label, error: null })
  try {
    await job()
    useGitSync.setState({ lastSync: new Date().toISOString() })
    return true
  } catch (e) {
    console.error('Git sync failed', e)
    useGitSync.setState({ error: e instanceof GitError ? e.message : `Git sync failed: ${(e as Error).message}` })
    return false
  } finally {
    useGitSync.setState({ busy: null })
  }
}

async function loadStatus(root: string) {
  const mode = await readMode(root)
  const remote = mode ? (await git(root, ['remote', 'get-url', 'origin'])).stdout.trim() : ''
  useGitSync.setState({ mode, remote, error: null, notice: null, lastSync: null })
  return mode
}

let installed = false
/** The last Git failure per project folder, for the start screen's markers; cleared by the next success. */
const failures = new Map<string, string>()
async function tracked(root: string, done: Promise<boolean>) {
  const ok = await done
  if (ok) failures.delete(root)
  else failures.set(root, useGitSync.getState().error ?? 'Git sync failed.')
  return ok
}
/** The push started when a project was left; opening a project (or quitting) waits for it. */
let pending: Promise<unknown> = Promise.resolve()
/** Resolves once nothing is being saved to Git any more. Quitting the app waits for this. */
export const gitSyncIdle = () => pending.then(() => undefined)

/** Called once at startup (desktop): pull on open, push on close. */
export function installGitSync() {
  if (installed || !isTauri()) return
  installed = true
  addProjectLifecycleHook({
    async opening(root) {
      await pending
      // Git sync must never stop a project from opening.
      const mode = await loadStatus(root).catch((e) => (console.error('Git sync status failed', e), null))
      if (mode !== 'full') return
      const ok = await tracked(root, step('Getting the latest version from Git…', () => pullLatest(root)))
      if (!ok) useGitSync.setState((s) => ({ error: `Couldn't get the latest version from Git. ${s.error}` }))
    },
    async opened() {},
    async closing(root) {
      // Everything is on disk already; the push runs in the background while you go on working.
      if (useGitSync.getState().mode) pending = pending.then(() => tracked(root, step('Saving to Git…', () => pushLatest(root, CLOSE_PUSH_MS))))
    },
  })
  setCredentialAsker(gitHubToken)
  // Git saving is on by default: a project without a repository of its own gets one when it opens.
  useProjectStore.subscribe((s, prev) => {
    if (s.root && s.root !== prev.root) void autoTurnOn(s.root)
  })
  // One sync method per project: sharing a fully synced project turns Git sync off.
  useCollab.subscribe((s, prev) => {
    const root = useProjectStore.getState().root
    if (!s.shared || prev.shared || !root || useGitSync.getState().mode !== 'full') return
    void git(root, ['config', '--local', '--unset', 'egd.sync']).then(() =>
      useGitSync.setState({
        mode: null,
        notice: 'Git sync was turned off because this project is now shared. You can turn on a Git backup (push only) for it in Git sync.',
      }),
    )
  })
}

// ---- actions for the UI ------------------------------------------------------------

/** Who has the Git backup of the shared project, if someone else than this computer. */
export function backupHolder(): { id: string; name: string } | null {
  const holder = useProjectStore.getState().meta?.gitBackup
  return holder && holder.id !== useCollab.getState().selfId ? holder : null
}

/** Connect GitHub once per computer: checks that git is logged in and remembers the user name. */
export async function connectGitHub(): Promise<boolean> {
  const ok = await step('Connecting GitHub…', async () => useSettings.getState().update({ githubLogin: await gitHubLogin() }))
  const root = useProjectStore.getState().root
  if (ok && root) await autoTurnOn(root)
  return ok
}

/** True when this folder is the top of a git repository of its own. */
async function ownRepo(root: string) {
  const r = await git(root, ['rev-parse', '--show-prefix'])
  return r.code === 0 && r.stdout.trim() === ''
}

/** Make the folder its own repository with `url` as origin and full sync on. */
/** True when the open project `root` allows a public repository (never for closed projects). */
const allowsPublic = (root: string) => useProjectStore.getState().root === root && !!useProjectStore.getState().meta?.gitAllowPublic

async function setUpRepo(root: string, url: string, mode: GitSyncMode = 'full') {
  await checkPrivate(url, allowsPublic(root))
  await mustBePrivate(url, allowsPublic(root))
  if (!(await ownRepo(root))) {
    await must(root, ['init', '-q'])
    await must(root, ['symbolic-ref', 'HEAD', `refs/heads/${safeBranch()}`])
  }
  const hasRemote = (await git(root, ['remote', 'get-url', 'origin'])).code === 0
  await must(root, ['remote', hasRemote ? 'set-url' : 'add', 'origin', url.trim()])
  await must(root, ['config', '--local', 'egd.sync', mode])
}

/**
 * Git saving is on by default (0.20): with GitHub connected, a project opened without a repository of
 * its own gets a private one. Projects in a repository of several projects (0.19), shared projects,
 * and projects where it was turned off keep what they have.
 */
export async function autoTurnOn(root: string): Promise<boolean> {
  if (!(await checkGit())) return false
  // A new project never went through `opening`, so its status is read here.
  const mode = await loadStatus(root).catch(() => null)
  if (mode || !useSettings.getState().githubLogin || useCollab.getState().shared || (await ownRepo(root))) return false
  const meta = useProjectStore.getState().meta
  if (!meta || useProjectStore.getState().root !== root) return false
  const ok = await turnOnFor(root, meta.name)
  if (ok) await loadStatus(root)
  return ok
}

/** Give a project folder its own private GitHub repository and save it there (open or not). */
function turnOnFor(root: string, name: string) {
  return tracked(
    root,
    step('Making a private GitHub repository for this project…', async () => {
      // New repositories are always made private, also when public ones are allowed.
      await setUpRepo(root, (await createProjectRepo(name, allowsPublic(root))).cloneUrl)
      await pullLatest(root)
      await pushLatest(root)
    }),
  )
}

export type ProjectGitState = { state: 'synced' | 'off' | 'error' | 'public'; detail: string }

/** For the start screen: is this (closed) project saved to Git, and did the last try work? */
export async function projectGitState(root: string): Promise<ProjectGitState> {
  const mode = (await checkGit()) ? await readMode(root).catch(() => null) : null
  if (!mode) return { state: 'off', detail: 'Not saved to Git' }
  const failed = failures.get(root)
  if (failed) return { state: 'error', detail: failed }
  // A project that may use a public repository always says so on its mark.
  const allowed = (JSON.parse(await getFs().readText(await getFs().join(root, 'project.json')).catch(() => '{}')) as { data?: { gitAllowPublic?: boolean } }).data?.gitAllowPublic
  if (allowed) return { state: 'public', detail: 'Public repositories allowed: anyone on the internet may be able to see this project.' }
  const remote = (await git(root, ['remote', 'get-url', 'origin'])).stdout.trim()
  return { state: 'synced', detail: `Saved to Git: ${remote}` }
}

/**
 * "Sync to Git" for a project on the start screen: save it to its repository now. A project without
 * one gets its own private GitHub repository (GitHub is connected first if needed).
 */
export async function syncProjectToGit(root: string, name: string): Promise<boolean> {
  await pending
  if (await readMode(root).catch(() => null)) return tracked(root, step('Saving to Git…', () => pushLatest(root)))
  // A shared project must be turned on from inside (it gets the push-only backup there).
  if (await getFs().exists(await getFs().join(root, 'collab'))) {
    useGitSync.setState({ error: 'This project is shared. Open it and turn on the Git backup in Git sync instead.' })
    return false
  }
  if (!useSettings.getState().githubLogin && !(await connectGitHub())) return false
  return turnOnFor(root, name)
}

/** "Sync from Git" for a project on the start screen: get the repository's latest version now. */
export async function syncProjectFromGit(root: string): Promise<boolean> {
  await pending
  if (!(await readMode(root).catch(() => null))) return false
  return tracked(root, step('Getting the latest version from Git…', () => pullLatest(root)))
}

/** Turn Git sync on for the open project. Shared projects get the push-only backup. Without an address, GitHub makes the repository. */
export async function turnOnGitSync(url: string): Promise<boolean> {
  const store = useProjectStore.getState()
  const root = store.root
  if (!root) return false
  if (!url.trim()) {
    if (!useSettings.getState().githubLogin || !store.meta) return false
    const made = await step('Making a private GitHub repository for this project…', async () => (url = (await createProjectRepo(store.meta!.name, allowsPublic(root))).cloneUrl))
    if (!made) return false
  }
  const shared = useCollab.getState().shared
  const mode: GitSyncMode = shared ? 'backup' : 'full'
  const holder = backupHolder()
  if (shared && holder) {
    useGitSync.setState({ error: `${holder.name} already backs this project up to Git. Only one person can.` })
    return false
  }
  // Every project gets a repository of its own, also inside a folder that is a repository (0.20).
  const configure = () => step('Setting up Git sync…', () => setUpRepo(root, url, mode))

  if (mode === 'backup') {
    await flushAll(root)
    if (!(await configure())) return false
    const { selfId, profile } = useCollab.getState()
    store.updateMeta({ gitBackup: { id: selfId, name: profile.name || 'Someone' } })
    await loadStatus(root)
    return syncNow()
  }
  // Full sync: close, set up, and open again, so the repository's version can be pulled in cleanly.
  networkMs = SIGN_IN_MS
  try {
    await store.close()
    const ok = await configure()
    await store.open(root)
    return ok && (await step('Saving to Git…', () => pushLatest(root)))
  } finally {
    networkMs = NETWORK_MS
  }
}

/** Turn Git sync off for the open project. The folder stays a git repository. */
export async function turnOffGitSync() {
  const root = useProjectStore.getState().root
  if (!root) return
  await git(root, ['config', '--local', '--unset', 'egd.sync'])
  if (useProjectStore.getState().meta?.gitBackup && !backupHolder()) useProjectStore.getState().updateMeta({ gitBackup: null })
  useGitSync.setState({ mode: null, error: null, notice: null })
}

/** "Sync to Git" in the open project: save everything to the repository now, without leaving. */
export async function syncOpenToGit(): Promise<boolean> {
  const root = useProjectStore.getState().root
  if (!root || !useGitSync.getState().mode) return false
  await flushAll(root)
  return tracked(root, step('Saving to Git…', () => pushLatest(root)))
}

/** Sync the open project now: full sync closes and opens it again (push, then pull); a backup just pushes. */
export async function syncNow(): Promise<boolean> {
  const store = useProjectStore.getState()
  const root = store.root
  const mode = useGitSync.getState().mode
  if (!root || !mode) return false
  if (mode === 'full') {
    await store.open(root)
    return !useGitSync.getState().error
  }
  await flushAll(root)
  return step('Saving to Git…', () => pushLatest(root))
}

/**
 * One repository per project (0.20): every project in the open project's shared repository gets its
 * own private GitHub repository. The old repository stays as it is, on GitHub and on disk, as a backup;
 * this computer just stops syncing it.
 */
export async function splitIntoProjectRepos(): Promise<boolean> {
  const store = useProjectStore.getState()
  const root = store.root
  if (!root || !useSettings.getState().githubLogin || (await ownRepo(root))) return false
  const fs = getFs()
  const top = await must(root, ['rev-parse', '--show-toplevel'])
  await store.close()
  await pending
  const ok = await step('Giving each project its own GitHub repository…', async () => {
    for (const e of await fs.list(top)) {
      const dir = await fs.join(top, e.name)
      const file = await fs.join(dir, 'project.json')
      if (!e.isDirectory || e.name.startsWith('.') || !(await fs.exists(file))) continue
      const name = (JSON.parse(await fs.readText(file)) as { data?: { name?: string } }).data?.name || e.name
      await setUpRepo(dir, (await createProjectRepo(name)).cloneUrl)
      await pushLatest(dir)
    }
    await must(top, ['config', '--local', '--unset', 'egd.sync'])
  })
  await store.open(root)
  return ok
}

/** True when the open project syncs through a repository it shares with other projects (0.19 layout). */
export async function inSharedRepo(): Promise<boolean> {
  const root = useProjectStore.getState().root
  return !!root && !!useGitSync.getState().mode && !(await ownRepo(root))
}

/**
 * "Import from Git": clone a repository into the projects folder and turn on full sync. Returns the
 * project folders: the repository itself, or the projects one level inside it.
 */
export async function cloneProject(url: string): Promise<string[]> {
  const fs = getFs()
  const parent = await defaultProjectsDir()
  await fs.mkdir(parent)
  const base = safeFolderName(url.trim().replace(/\/+$/, '').split(/[/:]/).pop()!.replace(/\.git$/i, '')) || 'Project'
  let name = base
  for (let i = 2; await fs.exists(await fs.join(parent, name)); i++) name = `${base} ${i}`
  // Nothing is open yet, so no project can have allowed a public repository.
  await mustBePrivate(url, false)
  const r = await git(parent, ['clone', '-q', url.trim(), name], 5 * 60_000)
  if (r.code !== 0) throw new GitError(explainGit(r))
  const root = await fs.join(parent, name)
  const isProject = async (dir: string) => fs.exists(await fs.join(dir, 'project.json'))
  const roots = (await isProject(root))
    ? [root]
    : (
        await Promise.all(
          (await fs.list(root)).filter((e) => e.isDirectory && !e.name.startsWith('.')).map(async (e) => {
            const dir = await fs.join(root, e.name)
            return (await isProject(dir)) ? dir : null
          }),
        )
      ).filter((d): d is string => !!d)
  if (!roots.length) throw new GitError(`This repository has no EDG project in it. It was downloaded to ${root}.`)
  await must(root, ['config', '--local', 'egd.sync', 'full'])
  return roots
}
