/**
 * Engine export from the command line (0.28), for build servers:
 *   npm run export -- <project folder> <godot|unity|unreal|json> <game project folder>
 * Writes the same files as Engine export in the app, with the pictures they use.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ENTITY_COLLECTION, ENTITY_TYPES, type Category, type Entity, type EntityType, type ProjectMeta } from '@/core/model'
import { assetPaths, buildExport, gatherExport, type Engine } from '@/shell/engineExport/build'

const [project, engine, out] = process.argv.slice(2)
if (!project || !out || !['godot', 'unity', 'unreal', 'json'].includes(engine)) {
  console.error('Usage: npm run export -- <project folder> <godot|unity|unreal|json> <output folder>')
  process.exit(2)
}

/** Every file the app writes is `{ schemaVersion, data }`; a missing file is null. */
async function data<T>(...path: string[]): Promise<T | null> {
  try {
    return (JSON.parse(await readFile(join(project, ...path), 'utf8')) as { data: T }).data
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`Could not read ${join(...path)}: ${e instanceof Error ? e.message : e}`)
  }
}

const meta = await data<ProjectMeta>('project.json')
if (!meta) throw new Error(`${project} is not an EVLMG Designer project (no project.json)`)
const entities = Object.fromEntries(await Promise.all(ENTITY_TYPES.map(async (t) => [t, (await data<Entity[]>('entities', `${ENTITY_COLLECTION[t]}.json`)) ?? []]))) as Record<EntityType, Entity[]>
const categories = (await data<Category[]>('entities', 'categories.json')) ?? []
const input = await gatherExport((type, id) => data('components', type, `${id}.json`), meta, entities, categories)
const files = buildExport(input, engine as Engine)
for (const f of files) {
  const to = join(out, ...f.path.split('/'))
  await mkdir(dirname(to), { recursive: true })
  await writeFile(to, f.text)
}
const dataDir = engine === 'unity' ? ['Assets', 'Resources', 'egd'] : engine === 'godot' ? ['egd'] : engine === 'unreal' ? ['json'] : []
const pictures = new Set(Object.values(entities).flat().flatMap((e) => (e.image ? [e.image] : [])))
for (const t of input.tools ?? []) assetPaths(t.documents, pictures)
let copied = 0
for (const p of pictures) {
  const to = join(out, ...dataDir, 'images', p.split('/').pop()!)
  await mkdir(dirname(to), { recursive: true })
  try {
    await copyFile(join(project, ...p.split('/')), to)
    copied++
  } catch {
    console.warn(`Missing picture ${p}`)
  }
}
console.log(`Exported ${files.length} files and ${copied} pictures to ${out}`)
