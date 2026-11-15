import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFs, MemoryFs, setFs } from '../fs'
import { createEntity } from '../model'
import { createProject, loadProject, saveCollection, writeDocument } from '../project'
import { flushAll, useProjectStore } from '../state'
import { backupsToKeep, collectProjectFiles, createBackup, fileVersions, installAutoBackup, listBackups, MAX_BACKUPS, restoreBackup, retireAssets, sweepRetiredAssets, waitForBackups } from '.'

describe('backups', () => {
  beforeEach(() => setFs(new MemoryFs()))

  it('snapshots every JSON file except assets and old backups', async () => {
    const p = await createProject({ name: 'B', description: '', components: ['wiki'] })
    await writeDocument(p.root, 'wiki', 'index', { articles: [] })
    await getFs().writeBinaryAtomic(await getFs().join(p.root, 'assets', 'images', 'x.png'), new Uint8Array([1]))
    await createBackup(p.root, 'open')
    const files = Object.keys(await collectProjectFiles(p.root)).sort()
    expect(files).toEqual([
      'components/wiki/index.json',
      'entities/categories.json',
      'entities/characters.json',
      'entities/enemies.json',
      'entities/items.json',
      'entities/towns.json',
      'project.json',
    ])
  })

  it('lists the earlier versions of one document, only where it changed (0.28)', async () => {
    const p = await createProject({ name: 'B', description: '', components: ['quests'] })
    const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n))
    await writeDocument(p.root, 'quests', 'quests', { quests: [1] })
    await createBackup(p.root, 'open', t(1))
    await writeDocument(p.root, 'wiki', 'index', { other: true })
    await createBackup(p.root, 'autosave', t(2))
    await writeDocument(p.root, 'quests', 'quests', { quests: [1, 2] })
    await createBackup(p.root, 'close', t(3))
    const v = await fileVersions(p.root, 'components/quests/quests.json')
    expect(v.map((x) => x.data)).toEqual([{ quests: [1, 2] }, { quests: [1] }])
    expect(v[1].reason).toBe('autosave')
  })

  it('skips a snapshot identical to the newest one', async () => {
    const p = await createProject({ name: 'B', description: '', components: [] })
    expect(await createBackup(p.root, 'open')).not.toBeNull()
    expect(await createBackup(p.root, 'close')).toBeNull()
    expect(await listBackups(p.root)).toHaveLength(1)
  })

  it(`keeps only the newest ${MAX_BACKUPS}`, async () => {
    const p = await createProject({ name: 'B', description: '', components: [] })
    const start = Date.parse('2026-10-01T12:00:00Z')
    for (let i = 0; i < 14; i++) {
      await saveCollection(p.root, 'item', [createEntity('item', `Item ${i}`)])
      await createBackup(p.root, 'autosave', new Date(start + i * 1000))
    }
    const list = await listBackups(p.root)
    expect(list).toHaveLength(MAX_BACKUPS)
    expect(list[0].createdAt).toBe('2026-10-01T12:00:13.000Z')
    expect(list.at(-1)!.createdAt).toBe('2026-10-01T12:00:04.000Z')
  })

  it('restores a backup, removes files created later, and backs up the current state first', async () => {
    const p = await createProject({ name: 'B', description: '', components: [] })
    await saveCollection(p.root, 'item', [createEntity('item', 'Sword')])
    const good = await createBackup(p.root, 'open', new Date('2026-10-01T12:00:00Z'))

    await saveCollection(p.root, 'item', [])
    await writeDocument(p.root, 'timeline', 't1', { lines: [] })

    await restoreBackup(p.root, good!.id)
    const loaded = await loadProject(p.root)
    expect(loaded.entities.item.map((i) => i.name)).toEqual(['Sword'])
    expect(await getFs().exists(await getFs().join(p.root, 'components', 'timeline', 't1.json'))).toBe(false)
    expect((await listBackups(p.root)).map((b) => b.reason)).toEqual(['before-restore', 'open'])
  })
})

describe('automatic backups', () => {
  let uninstall: () => void
  beforeEach(() => {
    setFs(new MemoryFs())
    uninstall = installAutoBackup()
  })
  afterEach(() => uninstall())

  it('backs up when a project opens and when it closes after edits', async () => {
    await useProjectStore.getState().create({ name: 'Auto', description: '', components: [] })
    const root = useProjectStore.getState().root!
    await waitForBackups()
    expect((await listBackups(root)).map((b) => b.reason)).toEqual(['open'])

    useProjectStore.getState().addEntity('town', 'Ironhold')
    await flushAll(root)
    await useProjectStore.getState().close()
    await waitForBackups()
    expect((await listBackups(root)).map((b) => b.reason)).toEqual(['close', 'open'])
  })

  it('takes an autosave backup once the interval has passed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      await useProjectStore.getState().create({ name: 'Timed', description: '', components: [] })
      const root = useProjectStore.getState().root!
      await waitForBackups()

      vi.advanceTimersByTime(6 * 60 * 1000)
      useProjectStore.getState().addEntity('item', 'Shield')
      await vi.advanceTimersByTimeAsync(1000) // autosave writes
      await vi.advanceTimersByTimeAsync(2000) // backup settles
      await waitForBackups()
      expect((await listBackups(root)).map((b) => b.reason)).toEqual(['autosave', 'open'])
      await useProjectStore.getState().close()
      await waitForBackups()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('backups keep days and weeks (0.31.1)', () => {
  const at = (iso: string) => ({ id: iso, createdAt: iso })
  it('keeps the newest 10, one per day for a week and one per week for a month', () => {
    const now = new Date('2026-11-30T12:00:00Z')
    const list: { id: string; createdAt: string }[] = []
    // 20 backups today, then 3 a day for 40 days back, newest first.
    for (let i = 0; i < 20; i++) list.push(at(new Date(now.getTime() - i * 60_000).toISOString()))
    for (let d = 1; d <= 40; d++) for (let h = 0; h < 3; h++) list.push(at(new Date(now.getTime() - d * 86_400_000 - h * 3_600_000).toISOString()))
    const keep = backupsToKeep(list, now)
    expect(list.slice(0, 10).every((b) => keep.has(b.id))).toBe(true)
    // Newest of days 1-6 (day 0 is in the newest 10) and of weeks 1-3; day 7, 14, 21 start a week.
    expect(keep.size).toBe(10 + 6 + 3)
    expect(keep.has(list[20].id)).toBe(true) // newest of yesterday
    expect(keep.has(list[21].id)).toBe(false) // an older one of yesterday
    expect([...keep].every((id) => now.getTime() - Date.parse(id) < 28 * 86_400_000)).toBe(true)
  })
})

describe('retired assets (a restored backup brings drawings back, 0.31.1)', () => {
  beforeEach(() => setFs(new MemoryFs()))

  it('keeps a replaced picture while a backup mentions it, then deletes it', async () => {
    const fs = getFs()
    const p = await createProject({ name: 'R', description: '', components: ['sketch'] })
    const png = async (name: string) => {
      const rel = `assets/images/${name}.png`
      await fs.writeBinaryAtomic(await fs.join(p.root, ...rel.split('/')), new Uint8Array([1]))
      return rel
    }
    const exists = async (rel: string) => fs.exists(await fs.join(p.root, ...rel.split('/')))
    const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n))

    const first = await png('aaaaaaaa-0000-0000-0000-000000000001')
    await writeDocument(p.root, 'sketch', 'd', { layers: [{ id: 'l', image: first }] })
    await createBackup(p.root, 'open', t(0))
    // Draw saves the layer again: a new picture, the old one retired.
    const second = await png('aaaaaaaa-0000-0000-0000-000000000002')
    await writeDocument(p.root, 'sketch', 'd', { layers: [{ id: 'l', image: second }] })
    await retireAssets(p.root, [first])
    await createBackup(p.root, 'autosave', t(1))
    expect(await exists(first)).toBe(true)

    await restoreBackup(p.root, (await listBackups(p.root)).at(-1)!.id)
    expect(JSON.stringify((await collectProjectFiles(p.root))['components/sketch/d.json'])).toContain(first)
    expect(await exists(first)).toBe(true)

    // Once no backup and no document mentions it any more, it goes.
    await writeDocument(p.root, 'sketch', 'd', { layers: [{ id: 'l', image: second }] })
    for (let i = 0; i < MAX_BACKUPS + 2; i++) {
      await writeDocument(p.root, 'wiki', 'index', { n: i })
      await createBackup(p.root, 'autosave', t(2 + i))
    }
    // All backups are within one day, so only the newest 10 stay; none mentions the first picture.
    expect(await exists(first)).toBe(false)
    expect(await exists(second)).toBe(true)
    expect(await sweepRetiredAssets(p.root)).toBe(0)
  })

  it('never retires anything outside assets/', async () => {
    const fs = getFs()
    const p = await createProject({ name: 'S', description: '', components: [] })
    await retireAssets(p.root, ['project.json', 'assets/images/../project.json', 'assets/images'])
    await createBackup(p.root, 'open')
    expect(await fs.exists(await fs.join(p.root, 'project.json'))).toBe(true)
  })
})
