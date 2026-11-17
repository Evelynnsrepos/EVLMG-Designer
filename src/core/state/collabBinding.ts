import type { ComponentType, EntityType, Id } from '../model'

/**
 * How the stores talk to a running collaboration session (`core/collab`)
 * without importing it. When no project is shared, there is no binding and
 * the stores behave exactly as before.
 *
 * Names of shared documents: `meta`, `categories`, `entities:<type>`,
 * `doc:<component type>/<id>`. The `project` undo scope covers entities and
 * categories together (the entity lists undo both at once).
 */
export interface CollabBinding {
  readonly root: string
  /** Current shared JSON of a document, undefined if nobody wrote it yet. */
  read(name: string): unknown
  /**
   * Record a local change. `prev` must be the value the store held (which is
   * what is shared). `undoable: false` changes still sync, and are merged into
   * the next undo step, like a drag that ends with an undoable release.
   */
  write(name: string, prev: unknown, next: unknown, options?: { undoable?: boolean; track?: boolean }): void
  /** Store an existing file's contents the first time a document is opened in a shared project. */
  importDocument(name: string, value: unknown): void
  /** Undo only this device's changes. */
  undo(scope: string): void
  redo(scope: string): void
  canUndo(scope: string): boolean
  canRedo(scope: string): boolean
  /** Start a new undo step even if the next change comes quickly. */
  boundary(scope: string): void
  /** A document was deleted: remove it on every device. */
  removeDocument?(name: string): void
  /** Every document of a tool was deleted (Delete tool): remove them on every device. */
  removeDocumentsOfType?(type: ComponentType): void
}

let binding: CollabBinding | null = null

export function setCollabBinding(next: CollabBinding | null) {
  binding = next
}

/**
 * Tools whose documents stay on each computer, even in shared projects.
 * Draw drawings are shared since 0.35: layer files are no longer deleted on save (so a teammate can still fetch
 * them), and one person draws at a time (components/sketch/drawLock.ts).
 */
export const LOCAL_ONLY_TYPES: readonly ComponentType[] = ['history']

export const isLocalOnlyType = (type: ComponentType) => LOCAL_ONLY_TYPES.includes(type)

/** The binding for a document of this tool: none for local-only tools. */
export function documentBinding(root: string | null | undefined, type: ComponentType): CollabBinding | null {
  return isLocalOnlyType(type) ? null : getCollabBinding(root)
}

/** The binding for this project root, if it is shared. */
export function getCollabBinding(root?: string | null): CollabBinding | null {
  if (!binding) return null
  if (root !== undefined && root !== binding.root) return null
  return binding
}

export const collabNames = {
  meta: 'meta',
  categories: 'categories',
  entities: (type: EntityType) => `entities:${type}`,
  document: (type: ComponentType, id: Id) => `doc:${type}/${id}`,
  /** Undo scope for entity lists. */
  project: 'project',
  /** Live rich text of one field of a document (a Y.XmlFragment, edited character by character). */
  text: (document: string, field: string) => `text:${document}#${field}`,
}

/** Names made by `collabNames.text`: these are not JSON values. */
export function isTextName(name: string): boolean {
  return name.startsWith('text:')
}

/** Inverse of `collabNames.document`. */
export function parseDocumentName(name: string): { type: ComponentType; id: Id } | null {
  if (!name.startsWith('doc:')) return null
  const rest = name.slice(4)
  const slash = rest.indexOf('/')
  if (slash < 1) return null
  return { type: rest.slice(0, slash) as ComponentType, id: rest.slice(slash + 1) }
}
