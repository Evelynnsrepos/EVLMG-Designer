import { allowProjectFolder, getFs, safeFolderName } from '../fs'
import {
  builtInCategories,
  ENTITY_TYPES,
  newId,
  type Category,
  type ComponentType,
  type EntityOf,
  type EntityType,
  type ProjectMeta,
  type ProjectStats,
} from '../model'
import { collabNames, documentBinding } from '../state/collabBinding'
import { APP_FOLDER_NAME, projectPaths } from './paths'
import { readVersioned, writeVersioned } from './versioned'
import { countWords } from './stats'

export type EntityCollections = { [T in EntityType]: EntityOf<T>[] }

export interface LoadedProject {
  root: string
  meta: ProjectMeta
  entities: EntityCollections
  categories: Category[]
}

export interface NewProjectInput {
  name: string
  description: string
  components: ComponentType[]
  /** Parent folder; defaults to Documents/Evelopment Games Designer (NP-6). */
  parentDir?: string
}

export async function defaultProjectsDir(): Promise<string> {
  const fs = getFs()
  return fs.join(await fs.documentDir(), APP_FOLDER_NAME)
}

/** Create the folder structure from spec 2.1 and return the loaded project. */
export async function createProject(input: NewProjectInput): Promise<LoadedProject> {
  const name = input.name.trim()
  if (!name) throw new Error('Project name is required')
  const fs = getFs()
  const parent = input.parentDir ?? (await defaultProjectsDir())
  await fs.mkdir(parent)

  const base = safeFolderName(name)
  let root = await fs.join(parent, base)
  for (let n = 2; await fs.exists(root); n++) root = await fs.join(parent, `${base} (${n})`)

  const t = new Date().toISOString()
  const meta: ProjectMeta = {
    id: newId(),
    name,
    description: input.description.trim(),
    enabledComponents: [...input.components],
    documents: [],
    layout: null,
    sidebarCollapsed: false,
    createdAt: t,
    updatedAt: t,
  }
  await fs.mkdir(root)
  await fs.mkdir(await projectPaths.entitiesDir(root))
  await fs.mkdir(await projectPaths.imagesDir(root))
  await fs.mkdir(await projectPaths.audioDir(root))

  const entities = emptyCollections()
  const categories = builtInCategories()
  await saveMeta(root, meta)
  for (const type of ENTITY_TYPES) await saveCollection(root, type, entities[type])
  await saveCategories(root, categories)
  return { root, meta, entities, categories }
}

export async function isProjectFolder(root: string): Promise<boolean> {
  return getFs().exists(await projectPaths.meta(root))
}

export async function loadProject(root: string): Promise<LoadedProject> {
  await allowProjectFolder(root)
  const meta = await readVersioned<ProjectMeta>(await projectPaths.meta(root))
  const entities = emptyCollections()
  for (const type of ENTITY_TYPES) {
    entities[type] = await readVersioned(await projectPaths.collection(root, type), () => [])
  }
  const categories = await readVersioned<Category[]>(await projectPaths.categories(root), builtInCategories)
  return { root, meta, entities, categories }
}

export async function saveMeta(root: string, meta: ProjectMeta) {
  await writeVersioned(await projectPaths.meta(root), { ...meta, updatedAt: new Date().toISOString() })
}

export async function saveCollection<T extends EntityType>(root: string, type: T, items: EntityOf<T>[]) {
  await writeVersioned(await projectPaths.collection(root, type), items)
}

export async function saveCategories(root: string, categories: Category[]) {
  await writeVersioned(await projectPaths.categories(root), categories)
}

export async function readDocument<T>(root: string, type: ComponentType, id: string, fallback: () => T): Promise<T> {
  return readVersioned(await projectPaths.document(root, type, id), fallback)
}

export async function writeDocument<T>(root: string, type: ComponentType, id: string, data: T) {
  await writeVersioned(await projectPaths.document(root, type, id), data)
}

export async function deleteDocument(root: string, type: ComponentType, id: string) {
  documentBinding(root, type)?.removeDocument?.(collabNames.document(type, id))
  await getFs().remove(await projectPaths.document(root, type, id))
}

export async function deleteProject(root: string) {
  await getFs().remove(root)
}

/** Word and image counts for the launcher (PM-3). */
export async function computeStats(root: string): Promise<ProjectStats> {
  const fs = getFs()
  let words = 0
  const { entities } = await loadProject(root)
  for (const type of ENTITY_TYPES) {
    for (const e of entities[type]) words += countWords(e.description) + countWords(e.notes)
  }
  const componentsDir = await fs.join(root, 'components')
  if (await fs.exists(componentsDir)) {
    for (const typeDir of await fs.list(componentsDir)) {
      if (!typeDir.isDirectory) continue
      words += await countWordsInTree(await fs.join(componentsDir, typeDir.name))
    }
  }
  const imagesDir = await projectPaths.imagesDir(root)
  const images = (await fs.exists(imagesDir)) ? (await fs.list(imagesDir)).filter((e) => !e.isDirectory).length : 0
  return { words, images }
}

async function countWordsInTree(dir: string): Promise<number> {
  const fs = getFs()
  let total = 0
  for (const entry of await fs.list(dir)) {
    const path = await fs.join(dir, entry.name)
    if (entry.isDirectory) total += await countWordsInTree(path)
    else if (entry.name.endsWith('.json')) {
      try {
        const parsed = JSON.parse(await fs.readText(path)) as { data?: unknown }
        total += countWordsInValue(parsed.data)
      } catch {
        // A broken document should not break the launcher.
      }
    }
  }
  return total
}

/**
 * Generic word counter for component documents: counts every string except
 * fields that hold ids, paths, colors or enum values. Components keep user
 * text in fields not matching IGNORED_KEYS (see AGENTS.md).
 */
const IGNORED_KEYS = /^(id|.*Id|.*Ids|type|kind|tool|image|src|path|asset|color|.*Color|mode|url|href|icon|createdAt|updatedAt)$/

export function countWordsInValue(value: unknown, key = ''): number {
  if (typeof value === 'string') return IGNORED_KEYS.test(key) ? 0 : countWords(stripTags(value))
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + countWordsInValue(v, key), 0)
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((n, [k, v]) => n + countWordsInValue(v, k), 0)
  }
  return 0
}

function stripTags(text: string) {
  return text.replace(/<[^>]*>/g, ' ')
}

function emptyCollections(): EntityCollections {
  return { item: [], character: [], town: [], enemy: [] }
}
