// @vitest-environment node
/// <reference types="node" />
import { execFile, execFileSync } from 'node:child_process'
import * as nodeFs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getFs, setFs, type FileSystem } from '../fs'
import { listBackups } from '../backups'
import { cloneProject, commitAll, pullLatest, pushLatest, readMode, setGitRunner, useGitSync, type ConflictChoice } from './gitsync'

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
  afterAll(() => nodeFs.rm(home, { recursive: true, force: true }))

  it('pushes the project but never backups or collaboration secrets', async () => {
    expect(await readMode(a)).toBe('full')
    await pushLatest(a)
    const files = sh(remote, 'ls-tree', '-r', '--name-only', 'main').split('\n')
    expect(files.sort()).toEqual(['.gitignore', 'project.json'])
    expect(await commitAll(a)).toBe(false)
  })

  it('opens a repository as a new project on another computer', async () => {
    b = await cloneProject(remote)
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
})
