import { create } from 'zustand'
import { createBackup } from '../backups'
import { useCollab } from '../collab'
import { getFs, isTauri, safeFolderName } from '../fs'
import { defaultProjectsDir } from '../project'
import { addProjectLifecycleHook, flushAll, useProjectStore } from '../state'

/**
 * Git sync (0.19): keeps a project folder in a Git repository with the user's own installed git.
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
export type GitRunner = (cwd: string, args: string[], timeoutMs: number) => Promise<GitResult>

const QUICK_MS = 15_000
const NETWORK_MS = 60_000
/** Closing must never hang for long, even offline. */
const CLOSE_PUSH_MS = 30_000
const WARN_BYTES = 50 * 1024 * 1024
const MAX_BYTES = 100 * 1024 * 1024
const IGNORED = ['.backups/', 'collab/']

let runner: GitRunner = async (cwd, args, timeoutMs) => {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<GitResult>('git_run', { cwd, args, timeoutMs })
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
    return 'Git needs you to log in. Log in once with Git in a terminal (or GitHub Desktop), then try again.'
  }
  if (/Could not resolve host|Network is unreachable|Connection (timed out|refused)|Failed to connect/i.test(text)) return 'Could not reach the repository. Check your internet connection.'
  if (/\[rejected\]|non-fast-forward|fetch first/i.test(text)) return 'The repository has newer changes. Use Sync now (or close and open the project) to get them first.'
  if (/repository .* not found|does not appear to be a git repository/i.test(text)) return 'Git could not find that repository. Check the address.'
  return text.split('\n').filter(Boolean).pop() ?? `Git failed (code ${r.code}).`
}

function git(root: string, args: string[], timeout = QUICK_MS) {
  // An empty folder would make git run wherever the app was started, in someone else's repository.
  if (!root.trim()) throw new GitError('No project folder for Git.')
  return runner(root, args, timeout)
}
async function must(root: string, args: string[], timeout = QUICK_MS) {
  const r = await git(root, args, timeout)
  if (r.code !== 0) throw new GitError(explainGit(r))
  return r.stdout.trim()
}

const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace('T', ' ')

/** The installed git, checked once. Never available in the browser build. */
export async function checkGit(): Promise<boolean> {
  if (!isTauri()) return false
  if (useGitSync.getState().version === null) {
    const { invoke } = await import('@tauri-apps/api/core')
    useGitSync.setState({ version: (await invoke<string | null>('git_version').catch(() => null)) ?? '' })
  }
  return !!useGitSync.getState().version
}

/** This folder's sync mode, from its own git config. */
export async function readMode(root: string): Promise<GitSyncMode | null> {
  const fs = getFs()
  if (!(await fs.exists(await fs.join(root, '.git')))) return null
  const value = (await git(root, ['config', '--local', '--get', 'egd.sync'])).stdout.trim()
  return value === 'full' || value === 'backup' ? value : null
}

async function ensureGitignore(root: string) {
  const fs = getFs()
  const path = await fs.join(root, '.gitignore')
  const text = (await fs.exists(path)) ? await fs.readText(path) : ''
  const missing = IGNORED.filter((line) => !text.split(/\r?\n/).includes(line))
  if (missing.length) await fs.writeTextAtomic(path, (text && !text.endsWith('\n') ? text + '\n' : text) + missing.join('\n') + '\n')
}

const branch = (root: string) => must(root, ['symbolic-ref', '--short', 'HEAD'])

/** Commit everything that changed. False when there was nothing to commit. */
export async function commitAll(root: string): Promise<boolean> {
  await ensureGitignore(root)
  await must(root, ['add', '-A'])
  if ((await git(root, ['diff', '--cached', '--quiet'])).code === 0) return false
  // Commits need a name; people who never set one up in git get the app's.
  const named = (await git(root, ['config', 'user.email'])).code === 0
  const who = named ? [] : ['-c', `user.name=${useCollab.getState().profile.name || 'Evelopment Games Designer'}`, '-c', 'user.email=egd@localhost']
  await must(root, [...who, 'commit', '-q', '-m', `EGD sync ${stamp()}`])
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

async function push(root: string, force: boolean, timeout = NETWORK_MS) {
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
  await must(root, ['fetch', '-q', 'origin'], NETWORK_MS)
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
export async function pushLatest(root: string, timeout = NETWORK_MS) {
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

/** Called once at startup (desktop): pull on open, push on close. */
export function installGitSync() {
  if (installed || !isTauri()) return
  installed = true
  addProjectLifecycleHook({
    async opening(root) {
      if ((await loadStatus(root)) !== 'full') return
      const ok = await step('Getting the latest version from Git…', () => pullLatest(root))
      if (!ok) useGitSync.setState((s) => ({ error: `Couldn't get the latest version from Git. ${s.error}` }))
    },
    async opened() {},
    async closing(root) {
      if (useGitSync.getState().mode) await step('Saving to Git…', () => pushLatest(root, CLOSE_PUSH_MS))
    },
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

/** Turn Git sync on for the open project. Shared projects get the push-only backup. */
export async function turnOnGitSync(url: string): Promise<boolean> {
  const store = useProjectStore.getState()
  const root = store.root
  if (!root || !url.trim()) return false
  const shared = useCollab.getState().shared
  const mode: GitSyncMode = shared ? 'backup' : 'full'
  const holder = backupHolder()
  if (shared && holder) {
    useGitSync.setState({ error: `${holder.name} already backs this project up to Git. Only one person can.` })
    return false
  }
  const configure = () =>
    step('Setting up Git sync…', async () => {
      const fs = getFs()
      if (!(await fs.exists(await fs.join(root, '.git')))) {
        await must(root, ['init', '-q'])
        await must(root, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
      }
      const hasRemote = (await git(root, ['remote', 'get-url', 'origin'])).code === 0
      await must(root, ['remote', hasRemote ? 'set-url' : 'add', 'origin', url.trim()])
      await must(root, ['config', '--local', 'egd.sync', mode])
    })

  if (mode === 'backup') {
    await flushAll(root)
    if (!(await configure())) return false
    const { selfId, profile } = useCollab.getState()
    store.updateMeta({ gitBackup: { id: selfId, name: profile.name || 'Someone' } })
    await loadStatus(root)
    return syncNow()
  }
  // Full sync: close, set up, and open again, so the repository's version can be pulled in cleanly.
  await store.close()
  const ok = await configure()
  await store.open(root)
  return ok && (await step('Saving to Git…', () => pushLatest(root)))
}

/** Turn Git sync off for the open project. The folder stays a git repository. */
export async function turnOffGitSync() {
  const root = useProjectStore.getState().root
  if (!root) return
  await git(root, ['config', '--local', '--unset', 'egd.sync'])
  if (useProjectStore.getState().meta?.gitBackup && !backupHolder()) useProjectStore.getState().updateMeta({ gitBackup: null })
  useGitSync.setState({ mode: null, error: null, notice: null })
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

/** "Open from Git": clone a repository into the projects folder and turn on full sync. Returns the folder. */
export async function cloneProject(url: string): Promise<string> {
  const fs = getFs()
  const parent = await defaultProjectsDir()
  await fs.mkdir(parent)
  const base = safeFolderName(url.trim().replace(/\/+$/, '').split(/[/:]/).pop()!.replace(/\.git$/i, '')) || 'Project'
  let name = base
  for (let i = 2; await fs.exists(await fs.join(parent, name)); i++) name = `${base} ${i}`
  const r = await git(parent, ['clone', '-q', url.trim(), name], 5 * 60_000)
  if (r.code !== 0) throw new GitError(explainGit(r))
  const root = await fs.join(parent, name)
  if (!(await fs.exists(await fs.join(root, 'project.json')))) {
    throw new GitError(`This repository has no Evelopment Games Designer project in it. It was downloaded to ${root}.`)
  }
  await must(root, ['config', '--local', 'egd.sync', 'full'])
  return root
}
