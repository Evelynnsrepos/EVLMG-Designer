import { unzipSync, zipSync } from 'fflate'
import { getFs, safeFolderName } from '../fs'
import { newId, type ProjectMeta } from '../model'
import { projectPaths } from './paths'
import { defaultProjectsDir } from './projectIO'
import { readVersioned, writeVersioned } from './versioned'

/**
 * Whole-project zip export and import. `.backups/` is left out (it can be huge
 * and is per computer) and so is `collab/` (sharing keys and members of a
 * shared project must never travel in a file someone passes around).
 */
const SKIPPED_DIRS = new Set(['.backups', 'collab'])

/** Unpacked size limit; protects against zip bombs. */
export const MAX_IMPORT_BYTES = 4 * 1024 ** 3

export async function zipProject(root: string): Promise<Uint8Array> {
  const fs = getFs()
  const files: Record<string, Uint8Array> = {}
  const walk = async (dir: string, rel: string[]) => {
    for (const entry of await fs.list(dir)) {
      if (rel.length === 0 && SKIPPED_DIRS.has(entry.name)) continue
      if (entry.name.endsWith('.tmp')) continue
      const path = await fs.join(dir, entry.name)
      if (entry.isDirectory) await walk(path, [...rel, entry.name])
      else files[[...rel, entry.name].join('/')] = await fs.readBinary(path)
    }
  }
  await walk(root, [])
  // Images and audio are already compressed; deflating them again only costs time.
  return zipSync(files, { level: 6, mem: 8 })
}

/** A zip entry path is safe when it stays inside the target folder. */
export function isSafeEntryPath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path)) return false
  return path.split('/').every((part) => part !== '..' && part !== '.')
}

/**
 * Unpack a project zip into the projects folder under a free name and return
 * the new project folder. The copy gets a new project id so it is never
 * mistaken for the original (recent list, peer-to-peer sharing).
 */
export async function importProjectZip(bytes: Uint8Array, parentDir?: string): Promise<string> {
  let total = 0
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize
        if (total > MAX_IMPORT_BYTES) throw new Error('The zip is too large to import.')
        return !f.name.endsWith('/')
      },
    })
  } catch (e) {
    throw new Error((e as Error).message.includes('too large') ? (e as Error).message : 'This file is not a valid zip.')
  }

  // Exports have project.json at the top; also accept a zip of the project folder itself.
  const names = Object.keys(files)
  let prefix = ''
  if (!names.includes('project.json')) {
    const nested = names.filter((n) => /^[^/]+\/project\.json$/.test(n))
    if (nested.length !== 1) throw new Error('This zip is not an Eve.Lopment Games Designer project (no project.json).')
    prefix = nested[0].slice(0, -'project.json'.length)
  }

  const bad = names.find((n) => n.startsWith(prefix) && !isSafeEntryPath(n.slice(prefix.length)))
  if (bad) throw new Error(`Unsafe path in zip: ${bad}`)

  const fs = getFs()
  const parent = parentDir ?? (await defaultProjectsDir())
  await fs.mkdir(parent)
  const meta = JSON.parse(new TextDecoder().decode(files[`${prefix}project.json`])) as { data?: Partial<ProjectMeta> }
  const base = safeFolderName(meta.data?.name ?? 'Imported project')
  let root = await fs.join(parent, base)
  for (let n = 2; await fs.exists(root); n++) root = await fs.join(parent, `${base} (${n})`)

  await fs.mkdir(root)
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith(prefix)) continue
    const rel = name.slice(prefix.length)
    if (SKIPPED_DIRS.has(rel.split('/')[0])) continue
    const path = await fs.join(root, ...rel.split('/'))
    // JSON goes through the text API so every FileSystem stores it as readable text.
    if (rel.endsWith('.json')) await fs.writeTextAtomic(path, new TextDecoder().decode(data))
    else await fs.writeBinaryAtomic(path, data)
  }

  const metaPath = await projectPaths.meta(root)
  const loaded = await readVersioned<ProjectMeta>(metaPath)
  await writeVersioned(metaPath, { ...loaded, id: newId(), updatedAt: new Date().toISOString() })
  return root
}
