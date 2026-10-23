import { zipSync } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { getFs, MemoryFs, setFs } from '../fs'
import { createProject, importProjectZip, isSafeEntryPath, loadProject, writeDocument, zipProject } from '.'

describe('project zip', () => {
  beforeEach(() => setFs(new MemoryFs()))

  it('round-trips a project under a new name and id, without backups', async () => {
    const p = await createProject({ name: 'Game', description: 'd', components: ['wiki'] })
    await writeDocument(p.root, 'wiki', 'index', { articles: ['a'] })
    await getFs().writeBinaryAtomic(await getFs().join(p.root, 'assets', 'images', 'x.png'), new Uint8Array([1, 2, 3]))
    await getFs().writeTextAtomic(await getFs().join(p.root, '.backups', 'b.json'), '{}')

    const root = await importProjectZip(await zipProject(p.root))
    expect(root).toBe('/Documents/Evelopment Games Designer/Game (2)')
    const copy = await loadProject(root)
    expect(copy.meta.name).toBe('Game')
    expect(copy.meta.id).not.toBe(p.meta.id)
    expect(await getFs().readBinary(await getFs().join(root, 'assets', 'images', 'x.png'))).toEqual(new Uint8Array([1, 2, 3]))
    expect(await getFs().exists(await getFs().join(root, '.backups'))).toBe(false)
  })

  it('rejects zips without a project and unsafe paths', async () => {
    await expect(importProjectZip(zipSync({ 'a.txt': new Uint8Array() }))).rejects.toThrow(/not an EDG project/)
    const evil = zipSync({ 'project.json': new TextEncoder().encode('{"data":{"name":"x"}}'), '../evil.txt': new Uint8Array() })
    await expect(importProjectZip(evil)).rejects.toThrow(/Unsafe/)
    expect(isSafeEntryPath('C:/x')).toBe(false)
    expect(isSafeEntryPath('components/wiki/a.json')).toBe(true)
  })
})
