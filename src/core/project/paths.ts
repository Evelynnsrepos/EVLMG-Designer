import type { ComponentType, EntityType } from '../model'
import { ENTITY_COLLECTION } from '../model'
import { getFs } from '../fs'

/** Folder layout from spec 2.1. Every path helper lives here so the layout changes in one place. */
export const projectPaths = {
  meta: (root: string) => getFs().join(root, 'project.json'),
  entitiesDir: (root: string) => getFs().join(root, 'entities'),
  collection: (root: string, type: EntityType) => getFs().join(root, 'entities', `${ENTITY_COLLECTION[type]}.json`),
  categories: (root: string) => getFs().join(root, 'entities', 'categories.json'),
  componentDir: (root: string, type: ComponentType) => getFs().join(root, 'components', type),
  document: (root: string, type: ComponentType, id: string) => getFs().join(root, 'components', type, `${id}.json`),
  imagesDir: (root: string) => getFs().join(root, 'assets', 'images'),
  audioDir: (root: string) => getFs().join(root, 'assets', 'audio'),
  backupsDir: (root: string) => getFs().join(root, '.backups'),
  /** Collaboration state of a shared project (Yjs), see core/collab. */
  collabDir: (root: string) => getFs().join(root, 'collab'),
  collabState: (root: string) => getFs().join(root, 'collab', 'state.bin'),
  /** Present after a backup was restored into a shared project: share the restored files on next open. */
  collabRestored: (root: string) => getFs().join(root, 'collab', 'restored.txt'),
}

// The app is called EDG (Eve.Lopment Games Designer) now, but the folder keeps its
// old name: renaming it would hide everyone's existing projects.
export const APP_FOLDER_NAME = 'Evelopment Games Designer'
