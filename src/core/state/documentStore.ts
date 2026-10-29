import { useCallback, useEffect, useRef } from 'react'
import { create } from 'zustand'
import { getFs } from '../fs'
import type { ComponentType, Id } from '../model'
import { projectPaths, readDocument, writeDocument } from '../project'
import { flush, scheduleSave } from './autosave'
import { collabNames, documentBinding } from './collabBinding'
import { History } from './history'
import { useProjectStore } from './projectStore'

/**
 * Component documents (`components/<type>/<id>.json`), loaded on demand and
 * cached in memory. Use `useDocument` from a component; it gives you the
 * data, an `update` that auto-saves, and per-document undo/redo.
 */
interface DocState {
  docs: Record<string, unknown>
}

const useDocs = create<DocState>()(() => ({ docs: {} }))
const histories = new Map<string, History<unknown>>()
const loading = new Map<string, Promise<void>>()

const keyOf = (root: string, type: ComponentType, id: Id) => `${root}|${type}/${id}`

function historyFor(key: string) {
  let h = histories.get(key)
  if (!h) histories.set(key, (h = new History()))
  return h
}

async function ensureLoaded<T>(root: string, type: ComponentType, id: Id, createDefault: () => T) {
  const key = keyOf(root, type, id)
  if (key in useDocs.getState().docs) return
  if (!loading.has(key)) {
    loading.set(
      key,
      loadDocument(root, type, id, createDefault).then((data) => {
        useDocs.setState((s) => ({ docs: { ...s.docs, [key]: data } }))
        loading.delete(key)
      }),
    )
  }
  await loading.get(key)
}

/** In a shared project the shared copy wins; a file that is not shared yet is added to it. */
async function loadDocument<T>(root: string, type: ComponentType, id: Id, createDefault: () => T): Promise<T> {
  const collab = documentBinding(root, type)
  const name = collabNames.document(type, id)
  const shared = collab?.read(name)
  if (shared !== undefined) return shared as T
  const data = await readDocument(root, type, id, createDefault)
  if (collab && (await getFs().exists(await projectPaths.document(root, type, id)))) collab.importDocument(name, data)
  return data
}

function setDoc(root: string, type: ComponentType, id: Id, data: unknown) {
  const key = keyOf(root, type, id)
  useDocs.setState((s) => ({ docs: { ...s.docs, [key]: data } }))
  scheduleSave(key, () => writeDocument(root, type, id, useDocs.getState().docs[key]))
}

export interface UseDocumentResult<T> {
  /** undefined while loading. */
  data: T | undefined
  /** Apply a change. Pass `{ undoable: false }` for transient changes such as a drag in progress. */
  update(recipe: (current: T) => T, options?: { undoable?: boolean }): void
  undo(): void
  redo(): void
  canUndo: boolean
  canRedo: boolean
}

export function useDocument<T>(type: ComponentType, id: Id, createDefault: () => T): UseDocumentResult<T> {
  const root = useProjectStore((s) => s.root)
  const key = root ? keyOf(root, type, id) : ''
  const data = useDocs((s) => (key ? (s.docs[key] as T | undefined) : undefined))

  // createDefault only matters for the first load, so keep the latest one in a ref.
  const createDefaultRef = useRef(createDefault)
  useEffect(() => {
    createDefaultRef.current = createDefault
  })
  useEffect(() => {
    if (root) void ensureLoaded(root, type, id, createDefaultRef.current)
  }, [root, type, id])

  const update = useCallback(
    (recipe: (current: T) => T, options?: { undoable?: boolean }) => {
      if (root) updateDocument(root, type, id, recipe, options)
    },
    [root, type, id],
  )
  const undo = useCallback(() => {
    if (root) undoDocument(root, type, id)
  }, [root, type, id])
  const redo = useCallback(() => {
    if (root) redoDocument(root, type, id)
  }, [root, type, id])

  const collab = root ? documentBinding(root, type) : null
  if (collab) {
    const name = collabNames.document(type, id)
    return { data, update, undo, redo, canUndo: collab.canUndo(name), canRedo: collab.canRedo(name) }
  }
  const h = key ? historyFor(key) : null
  return { data, update, undo, redo, canUndo: !!h?.canUndo, canRedo: !!h?.canRedo }
}

/** What `useDocument().update` does, usable outside React. No-op until the document is loaded. */
export function updateDocument<T>(
  root: string,
  type: ComponentType,
  id: Id,
  recipe: (current: T) => T,
  options?: { undoable?: boolean },
) {
  const key = keyOf(root, type, id)
  const current = useDocs.getState().docs[key] as T | undefined
  if (current === undefined) return
  const next = recipe(current)
  if (next === current) return
  const collab = documentBinding(root, type)
  if (collab) collab.write(collabNames.document(type, id), current, next, options)
  else if (options?.undoable !== false) historyFor(key).record(current)
  setDoc(root, type, id, next)
}

export function undoDocument(root: string, type: ComponentType, id: Id) {
  const collab = documentBinding(root, type)
  if (collab) return collab.undo(collabNames.document(type, id))
  const key = keyOf(root, type, id)
  const prev = historyFor(key).undo(useDocs.getState().docs[key])
  if (prev !== undefined) setDoc(root, type, id, prev)
}

export function redoDocument(root: string, type: ComponentType, id: Id) {
  const collab = documentBinding(root, type)
  if (collab) return collab.redo(collabNames.document(type, id))
  const key = keyOf(root, type, id)
  const next = historyFor(key).redo(useDocs.getState().docs[key])
  if (next !== undefined) setDoc(root, type, id, next)
}

/** Load a document outside React (tests, background work). */
export async function loadDocumentNow<T>(root: string, type: ComponentType, id: Id, createDefault: () => T): Promise<T> {
  await ensureLoaded(root, type, id, createDefault)
  return useDocs.getState().docs[keyOf(root, type, id)] as T
}

/** Current in-memory copy of a loaded document. */
export function peekDocument<T>(root: string, type: ComponentType, id: Id): T | undefined {
  return useDocs.getState().docs[keyOf(root, type, id)] as T | undefined
}

/** v0.24.3: give document `toId` a copy of `fromId`'s content (Duplicate in the sidebar). */
export async function copyDocument(type: ComponentType, fromId: Id, toId: Id) {
  const root = useProjectStore.getState().root
  if (!root) return
  const data = peekDocument(root, type, fromId) ?? (await loadDocument<unknown>(root, type, fromId, () => undefined))
  if (data === undefined) return // never saved: the copy starts empty like a new document
  const copy = structuredClone(data)
  documentBinding(root, type)?.importDocument(collabNames.document(type, toId), copy)
  setDoc(root, type, toId, copy)
}

/** Save a document now (ED-8: closing a component saves it). */
export async function flushDocument(type: ComponentType, id: Id) {
  const root = useProjectStore.getState().root
  if (root) await flush(keyOf(root, type, id))
}

/**
 * A shared document changed on another device (or by undo). Updates the open
 * copy, if any, and saves the file either way so the folder stays readable.
 */
export function receiveSharedDocument(root: string, type: ComponentType, id: Id, data: unknown) {
  const key = keyOf(root, type, id)
  if (key in useDocs.getState().docs) setDoc(root, type, id, data)
  else scheduleSave(key, () => writeDocument(root, type, id, data))
}

/** A teammate deleted this document: drop it here too (its pending save becomes the delete). */
export function forgetSharedDocument(root: string, type: ComponentType, id: Id) {
  const key = keyOf(root, type, id)
  histories.delete(key)
  if (key in useDocs.getState().docs) {
    const docs = { ...useDocs.getState().docs }
    delete docs[key]
    useDocs.setState({ docs })
  }
  scheduleSave(key, async () => {
    const path = await projectPaths.document(root, type, id)
    if (await getFs().exists(path)) await getFs().remove(path)
  })
}

/** Drop cached documents when a project closes. */
export function clearDocumentCache() {
  useDocs.setState({ docs: {} })
  histories.clear()
}

/** Drop cached copies and undo history of every document of a type, e.g. after its files were deleted. */
export function forgetDocuments(type: ComponentType) {
  const root = useProjectStore.getState().root
  if (!root) return
  const prefix = `${root}|${type}/`
  useDocs.setState((s) => ({ docs: Object.fromEntries(Object.entries(s.docs).filter(([k]) => !k.startsWith(prefix))) }))
  for (const k of [...histories.keys()]) if (k.startsWith(prefix)) histories.delete(k)
}
