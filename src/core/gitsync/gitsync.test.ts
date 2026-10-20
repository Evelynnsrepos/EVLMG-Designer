// @vitest-environment node
/// <reference types="node" />
import { execFile, execFileSync } from 'node:child_process'
import * as nodeFs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getFs, setFs, type FileSystem } from '../fs'
import { listBackups } from '../backups'
import { useProjectStore, useSettings } from '../state'
import { autoTurnOn, cloneProject, commitAll, projectGitState, pullLatest, pushLatest, readMode, setGitRunner, splitIntoProjectRepos, syncProjectFromGit, syncProjectToGit, useGitSync, type ConflictChoice } from './gitsync'
import { repoNameFor, setCredentialAsker, setGitHubFetch } from './github'

// Starting git is slow on Windows runners; a few runs per test easily pass the 5 s default.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

/** Real disk and a real git, so the tests check what git actually does. No network: the "server" is a local bare repo. */
let hasGit = true
try {
  execFileSync('git', ['--version'])
} catch {
  hasGit = false
}

const diskFs = (home: string): FileSystem => ({
  kind: 'tauri',
  join: async (...parts) => path.join(...parts),
  documentDir: async () => home,
  appDataDir: async () => path.join(home, 'appdata'),
  exists: (p) => nodeFs.access(p).then(() => true, () => false),
  readText: (p) => nodeFs.readFile(p, 'utf8'),
  writeTextAtomic: async (p, text) => {
    await nodeFs.mkdir(path.dirname(p), { recursive: true })
    await nodeFs.writeFile(p, text)
  },
  readBinary: async (p) => new Uint8Array(await nodeFs.readFile(p)),
  writeBinaryAtomic: (p, bytes) => nodeFs.writeFile(p, bytes),
  mkdir: async (p) => void (await nodeFs.mkdir(p, { recursive: true })),
  list: async (p) => (await nodeFs.readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
  remove: (p) => nodeFs.rm(p, { recursive: true, force: true }),
  copyFile: (a, b) => nodeFs.copyFile(a, b),
  pickFolder: async () => null,
  revealInFolder: async () => {},
  pickFiles: async () => [],
})

describe.skipIf(!hasGit)('git sync with a local repository', () => {
  let home = ''
  let remote = ''
  let a = ''
  let b = ''
  const write = (root: string, rel: string, text: string) => getFs().writeTextAtomic(path.join(root, rel), text)
  const read = (root: string, rel: string) => nodeFs.readFile(path.join(root, rel), 'utf8')
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  /** Answer the next "which version?" question. */
  const answer = (choice: ConflictChoice) => {
    const stop = useGitSync.subscribe((s) => {
      if (!s.conflict) return
      stop()
      s.conflict.resolve(choice)
    })
  }

  beforeAll(async () => {
    home = await nodeFs.mkdtemp(path.join(tmpdir(), 'egd-git-'))
    setFs(diskFs(home))
    setGitRunner(
      (cwd, args, timeout) =>
        new Promise((resolve) =>
          execFile('git', args, { cwd, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) =>
            resolve({ code: error ? (typeof error.code === 'number' ? error.code : -1) : 0, stdout, stderr }),
          ),
        ),
    )
    // "GitHub": every repository it makes is a local bare repository.
    setCredentialAsker(async () => 'token')
    setGitHubFetch((async (url: string, init?: RequestInit) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
      if (url.endsWith('/user')) return json({ login: 'me' })
      const { name } = JSON.parse(String(init?.body)) as { name: string }
      const bare = path.join(home, 'github', `${name}.git`)
      execFileSync('git', ['init', '-q', '--bare', bare])
      execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bare })
      return json({ name, clone_url: bare, updated_at: '' })
    }) as typeof fetch)
    useGitSync.setState({ version: 'git version test' })
    remote = path.join(home, 'remote.git')
    execFileSync('git', ['init', '-q', '--bare', remote])
    sh(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    a = path.join(home, 'A')
    await write(a, 'project.json', '{"name":"one"}')
    await write(a, 'collab/share.json', 'secret')
    await write(a, '.backups/old.json', '{}')
    sh(home, 'init', '-q', a)
    sh(a, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    sh(a, 'remote', 'add', 'origin', remote)
    sh(a, 'config', 'egd.sync', 'full')
  })
  // Windows may still hold a just-closed git folder for a moment.
  afterAll(() => nodeFs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {}))

  it('pushes the project but never backups or collaboration secrets', async () => {
    expect(await readMode(a)).toBe('full')
    await pushLatest(a)
    const files = sh(remote, 'ls-tree', '-r', '--name-only', 'main').split('\n')
    expect(files.sort()).toEqual(['.gitignore', 'project.json'])
    expect(await commitAll(a)).toBe(false)
  })

  it('opens a repository as a new project on another computer', async () => {
    ;[b] = await cloneProject(remote)
    expect(await read(b, 'project.json')).toBe('{"name":"one"}')
    expect(await readMode(b)).toBe('full')
  })

  it('gets the newer version when only the other computer changed', async () => {
    await write(b, 'project.json', '{"name":"two"}')
    await pushLatest(b)
    expect(await pullLatest(a)).toBe('pulled')
    expect(await read(a, 'project.json')).toBe('{"name":"two"}')
  })

  it('takes the Git version on request and keeps this one as a backup', async () => {
    await write(a, 'project.json', '{"name":"mine"}')
    await write(b, 'project.json', '{"name":"theirs"}')
    await pushLatest(b)
    answer('git')
    expect(await pullLatest(a)).toBe('pulled')
    expect(await read(a, 'project.json')).toBe('{"name":"theirs"}')
    expect(sh(a, 'branch', '--list', 'egd-backup-*')).not.toBe('')
    expect((await listBackups(a)).some((x) => x.reason === 'before-git')).toBe(true)
  })

  it("keeps this computer's version on request", async () => {
    await write(a, 'project.json', '{"name":"keep me"}')
    await write(b, 'project.json', '{"name":"lose me"}')
    await pushLatest(b)
    answer('mine')
    expect(await pullLatest(a)).toBe('pushed')
    expect(sh(remote, 'show', 'main:project.json')).toBe('{"name":"keep me"}')
  })

  it('leaves both sides alone on cancel', async () => {
    // b's "lose me" was overwritten above, so b first takes the repository's version.
    answer('git')
    await pullLatest(b)
    await write(b, 'project.json', '{"name":"b"}')
    await pushLatest(b)
    await write(a, 'project.json', '{"name":"a"}')
    answer('cancel')
    expect(await pullLatest(a)).toBe('cancelled')
    expect(await read(a, 'project.json')).toBe('{"name":"a"}')
    expect(sh(remote, 'show', 'main:project.json')).toBe('{"name":"b"}')
  })

  it('syncs a project that sits inside a repository of several projects', async () => {
    const folderRemote = path.join(home, 'folder.git')
    execFileSync('git', ['init', '-q', '--bare', folderRemote])
    sh(folderRemote, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    const all = path.join(home, 'All projects')
    await write(all, 'one/project.json', '{"name":"one"}')
    await write(all, 'two/project.json', '{"name":"two"}')
    await write(all, 'two/.backups/old.json', '{}')
    sh(home, 'init', '-q', all)
    sh(all, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    sh(all, 'remote', 'add', 'origin', folderRemote)
    sh(all, 'add', '-A')
    sh(all, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'by hand, with backups')
    sh(all, 'config', 'egd.sync', 'full')
    const one = path.join(all, 'one')
    expect(await readMode(one)).toBe('full')
    await pushLatest(one)
    expect(sh(folderRemote, 'show', 'main:two/project.json')).toBe('{"name":"two"}')
    expect(sh(folderRemote, 'ls-tree', '-r', '--name-only', 'main').split('\n').sort()).toEqual(['.gitignore', 'one/project.json', 'two/project.json'])
    const roots = await cloneProject(folderRemote)
    expect(roots.map((r) => path.basename(r)).sort()).toEqual(['one', 'two'])
    expect(await readMode(roots[0])).toBe('full')
  })

  it('gives a project in a non-syncing folder repository its own GitHub repository when it opens', async () => {
    const folder = path.join(home, 'Projects folder')
    await write(folder, 'old/project.json', '{}')
    sh(home, 'init', '-q', folder)
    const p = path.join(folder, 'Homeorg')
    await write(p, 'project.json', '{"data":{"name":"Homeorg"}}')
    useSettings.setState({ githubLogin: 'me' })
    useProjectStore.setState({ root: p, meta: { name: 'Homeorg' } as never })
    useGitSync.setState({ mode: null })
    expect(await autoTurnOn(p)).toBe(true)
    expect(useGitSync.getState().mode).toBe('full')
    expect(sh(path.join(home, 'github', 'egd-homeorg.git'), 'show', 'main:project.json')).toBe('{"data":{"name":"Homeorg"}}')
    // The folder's own repository is left alone.
    expect(sh(folder, 'log', '--oneline', '--all')).toBe('')
  })

  it('splits a repository of several projects into one repository each and leaves the old one as it was', async () => {
    const all = path.join(home, 'All projects')
    const before = sh(all, 'rev-parse', 'HEAD')
    useProjectStore.setState({ root: path.join(all, 'one'), close: async () => {}, open: async () => {} } as never)
    await write(all, 'one/project.json', '{"data":{"name":"One"}}')
    await write(all, 'two/project.json', '{"data":{"name":"Two!"}}')
    expect(await splitIntoProjectRepos()).toBe(true)
    expect(sh(path.join(home, 'github', 'egd-one.git'), 'show', 'main:project.json')).toBe('{"data":{"name":"One"}}')
    expect(sh(path.join(home, 'github', 'egd-two.git'), 'show', 'main:project.json')).toBe('{"data":{"name":"Two!"}}')
    expect(await readMode(path.join(all, 'one'))).toBe('full')
    expect(sh(all, 'rev-parse', 'HEAD')).toBe(before)
    expect(await readMode(all)).toBe(null)
  })

  it('syncs existing projects to and from Git from the start screen, with a marker', async () => {
    const p = path.join(home, 'Existing')
    await write(p, 'project.json', '{"v":1}')
    expect((await projectGitState(p)).state).toBe('off')
    expect(await syncProjectToGit(p, 'Existing')).toBe(true)
    const bare = path.join(home, 'github', 'egd-existing.git')
    expect(sh(bare, 'show', 'main:project.json')).toBe('{"v":1}')
    expect(await projectGitState(p)).toEqual({ state: 'synced', detail: `Saved to Git: ${bare}` })
    // Another computer changes it; "Sync from Git" brings that in.
    const [other] = await cloneProject(bare)
    await write(other, 'project.json', '{"v":2}')
    await pushLatest(other)
    expect(await syncProjectFromGit(p)).toBe(true)
    expect(await read(p, 'project.json')).toBe('{"v":2}')
    // A failed push shows as an error marker until the next success.
    sh(p, 'remote', 'set-url', 'origin', path.join(home, 'missing.git'))
    await write(p, 'project.json', '{"v":3}')
    expect(await syncProjectToGit(p, 'Existing')).toBe(false)
    expect((await projectGitState(p)).state).toBe('error')
  })

  it('marks a synced project that allows public repositories', async () => {
    const p = path.join(home, 'Existing')
    sh(p, 'remote', 'set-url', 'origin', path.join(home, 'github', 'egd-existing.git'))
    await write(p, 'project.json', '{"data":{"gitAllowPublic":true}}')
    expect(await syncProjectToGit(p, 'Existing')).toBe(true)
    expect((await projectGitState(p)).state).toBe('public')
  })

  it('does not turn on full sync for a shared project from the start screen', async () => {
    const p = path.join(home, 'Shared')
    await write(p, 'project.json', '{}')
    await write(p, 'collab/share.json', '{}')
    expect(await syncProjectToGit(p, 'Shared')).toBe(false)
    expect((await projectGitState(p)).state).toBe('off')
  })
})

describe('repository names', () => {
  it('turns project names into GitHub repository names', () => {
    expect(repoNameFor('My Game: Part 2')).toBe('egd-my-game-part-2')
    expect(repoNameFor('Schloß Über')).toBe('egd-schlo-uber')
    expect(repoNameFor('???')).toBe('egd-project')
  })
})
