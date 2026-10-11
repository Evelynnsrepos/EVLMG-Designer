import { create } from 'zustand'
import {
  createEntity,
  ENTITY_TYPES,
  newId,
  type Category,
  type ComponentType,
  type DocumentRef,
  type Entity,
  type EntityOf,
  type EntityType,
  type Id,
  type LayoutNode,
  type ProjectMeta,
} from '../model'
import {
  computeStats,
  createProject,
  deleteDocument,
  loadProject,
  saveCategories,
  saveCollection,
  saveMeta,
  upsertRecent,
  type EntityCollections,
  type NewProjectInput,
} from '../project'
import { flushAll, scheduleSave } from './autosave'
import { collabNames, getCollabBinding, isLocalOnlyType } from './collabBinding'

/**
 * The open project: meta, entities and categories. Every mutation updates
 * memory immediately and schedules a debounced write of the affected file.
 * Component documents live in documentStore.ts, not here.
 */
interface ProjectState {
  root: string | null
  meta: ProjectMeta | null
  entities: EntityCollections
  categories: Category[]

  open(root: string): Promise<void>
  create(input: NewProjectInput): Promise<void>
  close(): Promise<void>

  updateMeta(patch: Partial<ProjectMeta>): void
  setLayout(layout: LayoutNode | null): void
  enableComponent(type: ComponentType): void

  addDocument(type: ComponentType, title: string): DocumentRef
  renameDocument(id: Id, title: string): void
  removeDocument(id: Id): Promise<void>

  addEntity<T extends EntityType>(type: T, name?: string): EntityOf<T>
  updateEntity<T extends EntityType>(type: T, id: Id, patch: Partial<EntityOf<T>>): void
  removeEntity(type: EntityType, id: Id): void
  getEntity<T extends EntityType>(type: T, id: Id): EntityOf<T> | undefined
  /** Replace a whole collection at once, e.g. to restore an undo snapshot. */
  setEntities<T extends EntityType>(type: T, list: EntityOf<T>[]): void

  setCategories(categories: Category[]): void
}

const emptyEntities = (): EntityCollections => ({ item: [], character: [], town: [], enemy: [] })

/** Meta fields each person keeps for themselves in a shared project (their own layout). */
export const PERSONAL_META_KEYS = ['layout', 'sidebarCollapsed'] as const

export type SharedMeta = Omit<ProjectMeta, (typeof PERSONAL_META_KEYS)[number]>

export function sharedMeta(meta: ProjectMeta): SharedMeta {
  const { layout: _layout, sidebarCollapsed: _collapsed, ...shared } = meta
  // Local-only documents (Sketch drawings) are not listed for the others.
  return { ...shared, documents: shared.documents.filter((d) => !isLocalOnlyType(d.type)) }
}

/**
 * Called around opening and closing a project, e.g. to start collaboration
 * when the project is shared. `opened` runs before `open()` resolves.
 */
export interface ProjectLifecycleHook {
  opened(root: string): Promise<void>
  closing(root: string): Promise<void>
}
const lifecycleHooks = new Set<ProjectLifecycleHook>()
export function addProjectLifecycleHook(hook: ProjectLifecycleHook) {
  lifecycleHooks.add(hook)
  return () => void lifecycleHooks.delete(hook)
}

export const useProjectStore = create<ProjectState>()((set, get) => {
  const saveMetaSoon = () => {
    const { root, meta } = get()
    if (root && meta) scheduleSave(`${root}|meta`, () => saveMeta(root, get().meta!))
  }
  const saveCollectionSoon = (type: EntityType) => {
    const root = get().root
    if (root) scheduleSave(`${root}|entities/${type}`, () => saveCollection(root, type, get().entities[type]))
  }
  /** Mirror a change into the shared project, if this project is shared. */
  const share = (name: string, prev: unknown, next: unknown) => getCollabBinding(get().root)?.write(name, prev, next)
  const setList = (type: EntityType, next: Entity[]) => {
    share(collabNames.entities(type), get().entities[type], next)
    set({ entities: { ...get().entities, [type]: next } })
    saveCollectionSoon(type)
  }

  const afterOpen = async (root: string, meta: ProjectMeta) => {
    await upsertRecent({
      path: root,
      name: meta.name,
      description: meta.description,
      image: meta.image ?? null,
      lastOpened: new Date().toISOString(),
      stats: await computeStats(root),
    })
  }

  return {
    root: null,
    meta: null,
    entities: emptyEntities(),
    categories: [],

    async open(root) {
      await get().close()
      const p = await loadProject(root)
      set({ root: p.root, meta: p.meta, entities: p.entities, categories: p.categories })
      for (const hook of lifecycleHooks) await hook.opened(p.root)
      await afterOpen(p.root, get().meta!)
    },

    async create(input) {
      await get().close()
      const p = await createProject(input)
      set({ root: p.root, meta: p.meta, entities: p.entities, categories: p.categories })
      await afterOpen(p.root, p.meta)
    },

    async close() {
      const { root, meta } = get()
      if (!root) return
      await flushAll(root)
      for (const hook of lifecycleHooks) await hook.closing(root)
      if (meta) {
        // Refresh launcher stats with everything just saved.
        await afterOpen(root, meta)
      }
      set({ root: null, meta: null, entities: emptyEntities(), categories: [] })
    },

    updateMeta(patch) {
      const meta = get().meta
      if (!meta) return
      const next = { ...meta, ...patch }
      const collab = getCollabBinding(get().root)
      if (collab && Object.keys(patch).some((k) => !(PERSONAL_META_KEYS as readonly string[]).includes(k))) {
        collab.write(collabNames.meta, sharedMeta(meta), sharedMeta(next), { track: false })
      }
      set({ meta: next })
      saveMetaSoon()
    },

    setLayout(layout) {
      get().updateMeta({ layout })
    },

    enableComponent(type) {
      const meta = get().meta
      if (!meta || meta.enabledComponents.includes(type)) return
      get().updateMeta({ enabledComponents: [...meta.enabledComponents, type] })
    },

    addDocument(type, title) {
      const meta = get().meta!
      const t = new Date().toISOString()
      const doc: DocumentRef = { id: newId(), type, title, createdAt: t, updatedAt: t }
      get().updateMeta({ documents: [...meta.documents, doc] })
      return doc
    },

    renameDocument(id, title) {
      const meta = get().meta!
      get().updateMeta({ documents: meta.documents.map((d) => (d.id === id ? { ...d, title } : d)) })
    },

    async removeDocument(id) {
      const { meta, root } = get()
      const doc = meta?.documents.find((d) => d.id === id)
      if (!meta || !root || !doc) return
      get().updateMeta({ documents: meta.documents.filter((d) => d.id !== id) })
      await deleteDocument(root, doc.type, id)
    },

    addEntity(type, name) {
      const entity = createEntity(type, name)
      setList(type, [...(get().entities[type] as Entity[]), entity])
      return entity
    },

    updateEntity(type, id, patch) {
      const list = get().entities[type] as Entity[]
      const next = list.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e))
      setList(type, next)
    },

    removeEntity(type, id) {
      const list = get().entities[type] as Entity[]
      setList(type, list.filter((e) => e.id !== id))
    },

    getEntity(type, id) {
      return (get().entities[type] as Entity[]).find((e) => e.id === id) as EntityOf<typeof type> | undefined
    },

    setEntities(type, list) {
      setList(type, list as Entity[])
    },

    setCategories(categories) {
      share(collabNames.categories, get().categories, categories)
      set({ categories })
      const root = get().root
      if (root) scheduleSave(`${root}|categories`, () => saveCategories(root, get().categories))
    },
  }
})

/** All entities of every type, handy for pickers and `[[` link search. */
export function allEntities(collections: EntityCollections): Entity[] {
  return ENTITY_TYPES.flatMap((t) => collections[t] as Entity[])
}

// ---------------------------------------------------------------------------
// Shared projects: changes that arrived from another device (or by undo).

export function receiveSharedMeta(root: string, shared: SharedMeta) {
  const s = useProjectStore.getState()
  if (s.root !== root || !s.meta) return
  const local = s.meta.documents.filter((d) => isLocalOnlyType(d.type))
  const meta: ProjectMeta = {
    ...shared,
    documents: [...shared.documents.filter((d) => !isLocalOnlyType(d.type)), ...local],
    layout: s.meta.layout,
    sidebarCollapsed: s.meta.sidebarCollapsed,
  }
  useProjectStore.setState({ meta })
  scheduleSave(`${root}|meta`, () => saveMeta(root, useProjectStore.getState().meta!))
}

export function receiveSharedEntities(root: string, type: EntityType, list: Entity[]) {
  const s = useProjectStore.getState()
  if (s.root !== root) return
  useProjectStore.setState({ entities: { ...s.entities, [type]: list } })
  scheduleSave(`${root}|entities/${type}`, () => saveCollection(root, type, useProjectStore.getState().entities[type]))
}

export function receiveSharedCategories(root: string, categories: Category[]) {
  const s = useProjectStore.getState()
  if (s.root !== root) return
  useProjectStore.setState({ categories })
  scheduleSave(`${root}|categories`, () => saveCategories(root, useProjectStore.getState().categories))
}
