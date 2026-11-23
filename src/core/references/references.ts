import { getFs } from '../fs'
import { COMPONENT_TYPES, ENTITY_TYPES, type ComponentType, type Entity, type EntityType, type Id } from '../model'
import { loadProject, projectPaths, readVersioned } from '../project'
import { flushAll, useProjectStore } from '../state'

/**
 * "Where is this used?" (spec 3.3). Records reference each other by id, so
 * any UUID found anywhere in an entity or component document (in a value, an
 * object key, or inside a string such as rich-text HTML) counts as a
 * reference to that id. Values under a key named exactly `id` are the
 * record's own id, not a reference, and are skipped.
 */
export type ReferenceSource =
  | { kind: 'entity'; entityType: EntityType; entityId: Id; name: string }
  /** title is null when the document has no title of its own (single-document components). */
  | { kind: 'document'; componentType: ComponentType; documentId: Id; title: string | null }

export interface Reference {
  source: ReferenceSource
  /** Where in the source the id appears, e.g. `dropTable.itemId` (array positions omitted). */
  fields: string[]
}

/** Referenced id -> everything that references it. */
export type ReferenceIndex = Map<Id, Reference[]>

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Every id referenced by `value`, with the field paths where each appears. */
export function collectIds(value: unknown): Map<Id, Set<string>> {
  const found = new Map<Id, Set<string>>()
  const add = (id: string, path: string[]) => {
    const key = id.toLowerCase()
    let fields = found.get(key)
    if (!fields) found.set(key, (fields = new Set()))
    fields.add(path.join('.'))
  }
  const walk = (v: unknown, path: string[]) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(UUID)) add(m[0], path)
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item, path)
    } else if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        for (const m of k.matchAll(UUID)) add(m[0], path)
        if (k === 'id' && typeof child === 'string') continue
        // Records keyed by id (e.g. `categories`) keep the parent field name.
        walk(child, IS_UUID.test(k) ? path : [...path, k])
      }
    }
  }
  walk(value, [])
  return found
}

/** Ids of the records kept inside `value` (wiki articles, assets, nodes): every UUID under a key named `id`. */
export function collectOwnIds(value: unknown): Id[] {
  const out: Id[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object')
      for (const [k, child] of Object.entries(v)) {
        if (k === 'id' && typeof child === 'string' && IS_UUID.test(child)) out.push(child.toLowerCase())
        else walk(child)
      }
  }
  walk(value)
  return out
}

function addSource(index: ReferenceIndex, source: ReferenceSource, value: unknown, owned?: Map<Id, ReferenceSource>) {
  if (owned) for (const id of collectOwnIds(value)) if (!owned.has(id)) owned.set(id, source)
  for (const [id, fields] of collectIds(value)) {
    let list = index.get(id)
    if (!list) index.set(id, (list = []))
    list.push({ source, fields: [...fields] })
  }
}

function titleOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const d = data as { title?: unknown; name?: unknown }
  if (typeof d.title === 'string' && d.title.trim()) return d.title
  if (typeof d.name === 'string' && d.name.trim()) return d.name
  return null
}

async function listJsonFiles(dir: string): Promise<{ id: string; path: string }[]> {
  const fs = getFs()
  if (!(await fs.exists(dir))) return []
  const out: { id: string; path: string }[] = []
  for (const entry of await fs.list(dir)) {
    const path = await fs.join(dir, entry.name)
    if (entry.isDirectory) out.push(...(await listJsonFiles(path)))
    else if (entry.name.endsWith('.json')) out.push({ id: entry.name.slice(0, -'.json'.length), path })
  }
  return out
}

/**
 * Scan every entity and component document saved in the project. `owned`, if given, is filled with
 * every record id found inside a source (lower case) and the source that keeps it.
 */
export async function buildReferenceIndex(root: string, owned?: Map<Id, ReferenceSource>): Promise<ReferenceIndex> {
  const index: ReferenceIndex = new Map()
  const { meta, entities } = await loadProject(root)

  for (const type of ENTITY_TYPES) {
    for (const e of entities[type] as Entity[]) {
      addSource(index, { kind: 'entity', entityType: type, entityId: e.id, name: e.name }, e, owned)
    }
  }

  const titles = new Map(meta.documents.map((d) => [d.id, d.title]))
  for (const type of COMPONENT_TYPES) {
    for (const file of await listJsonFiles(await projectPaths.componentDir(root, type))) {
      let data: unknown
      try {
        data = await readVersioned<unknown>(file.path)
      } catch {
        continue // a broken document should not block deleting
      }
      const title = titles.get(file.id) ?? titleOf(data)
      addSource(index, { kind: 'document', componentType: type, documentId: file.id, title }, data, owned)
    }
  }
  return index
}

function isSelf(source: ReferenceSource, id: Id) {
  return (source.kind === 'entity' ? source.entityId : source.documentId).toLowerCase() === id.toLowerCase()
}

/** Everything in the saved project that references `id` (not counting the record itself). */
export async function findReferencesIn(root: string, id: Id): Promise<Reference[]> {
  const refs = (await buildReferenceIndex(root)).get(id.toLowerCase()) ?? []
  return refs.filter((r) => !isSelf(r.source, id))
}

/** Like findReferencesIn, for the open project; pending edits are saved first so nothing is missed. */
export async function findReferences(id: Id): Promise<Reference[]> {
  const root = useProjectStore.getState().root
  if (!root) return []
  await flushAll(root)
  return findReferencesIn(root, id)
}
