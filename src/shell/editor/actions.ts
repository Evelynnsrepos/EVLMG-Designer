import { newId, type ComponentType, type Id } from '@/core/model'
import { getManifest } from '@/core/registry'
import { importAssetFromBlob } from '@/core/assets'
import { clearDocumentCache, flushAll, postIntent, useAppStore, useProjectStore } from '@/core/state'
import { autoPlacement, findOpen, insertPanel, leaves, neighbor, removePanel, swapPanels, type Direction, type DropSide } from '../workspace/layoutTree'

/**
 * Editor commands shared by the sidebar, workspace and keyboard handling.
 * Feature modules may call `openComponent` to open other tools (e.g. the
 * Wiki opening an entity's list).
 */

export interface Placement {
  targetId: Id | null
  side: DropSide
}

/** The document a component opens with: the given one, else its first (created if none); null for single-document tools. */
function resolveDocument(type: ComponentType, documentId: Id | null): Id | null {
  const project = useProjectStore.getState()
  const manifest = getManifest(type)
  project.enableComponent(type)
  if (!manifest?.multiDocument) return null
  if (documentId) return documentId
  const existing = useProjectStore.getState().meta!.documents.find((d) => d.type === type)
  return existing ? existing.id : project.addDocument(type, manifest.newDocumentTitle ?? 'Untitled').id
}

/** Open a component (and document) next to the open ones. Focuses it if already open (ED-10). Shift-click in the sidebar. */
export function openComponent(type: ComponentType, documentId: Id | null = null, placement?: Placement) {
  const app = useAppStore.getState()
  if (!useProjectStore.getState().meta) return
  const docId = resolveDocument(type, documentId)

  const layout = useProjectStore.getState().meta!.layout
  const open = findOpen(layout, type, docId)
  if (open) {
    app.setActivePanel(open.id)
    return
  }
  const panel = { id: newId(), type, documentId: docId }
  const where = placement ?? autoPlacement(layout, window.innerWidth / Math.max(1, window.innerHeight))
  useProjectStore.getState().setLayout(insertPanel(layout, panel, where.targetId, where.side))
  app.setActivePanel(panel.id)
}

/**
 * Plain click in the sidebar (v0.4): show only this component. Everything is saved first.
 * v0.13: no question any more; Shift-click opens next to the others instead.
 */
export async function replaceWithComponent(type: ComponentType, documentId: Id | null = null) {
  const { root, meta } = useProjectStore.getState()
  if (!root || !meta) return
  const docId = resolveDocument(type, documentId)
  const current = leaves(useProjectStore.getState().meta!.layout)
  const keep = current.length === 1 && current[0].type === type && current[0].documentId === docId ? current[0] : null
  await flushAll(root)
  const panel = keep ?? { id: newId(), type, documentId: docId }
  if (!keep) useProjectStore.getState().setLayout(insertPanel(null, panel, null, 'right'))
  useAppStore.getState().setActivePanel(panel.id)
}

/** Create a new document for a multi-document component and open it (SB-4): alone, or next to the others. */
export function newDocument(type: ComponentType, replace = false) {
  const manifest = getManifest(type)
  const doc = useProjectStore.getState().addDocument(type, manifest?.newDocumentTitle ?? 'Untitled')
  if (replace) void replaceWithComponent(type, doc.id)
  else openComponent(type, doc.id)
}

/** Close a panel; everything is saved first (ED-8). */
export async function closePanel(panelId: Id) {
  const { root, meta } = useProjectStore.getState()
  if (!root || !meta) return
  await flushAll(root)
  const layout = useProjectStore.getState().meta!.layout
  useProjectStore.getState().setLayout(removePanel(layout, panelId))
  const app = useAppStore.getState()
  if (app.activePanelId === panelId) app.setActivePanel(null)
}

/** Swap a panel with its neighbour (ED-6 arrows). */
export function movePanel(panelId: Id, dir: Direction) {
  const layout = useProjectStore.getState().meta?.layout ?? null
  const other = neighbor(layout, panelId, dir)
  if (layout && other) useProjectStore.getState().setLayout(swapPanels(layout, panelId, other.id))
}

/** Restore the last layout, or open the first enabled component for a new project (ED-1). */
export function openInitialLayout() {
  const meta = useProjectStore.getState().meta
  if (!meta || meta.layout) return
  const first = meta.enabledComponents[0]
  if (first) openComponent(first)
}

/** Save everything and return to the launcher (SB-7). */
export async function backToProjects() {
  await useProjectStore.getState().close()
  clearDocumentCache()
  useAppStore.getState().setActivePanel(null)
  useAppStore.getState().go('launcher')
}

/** Drag-and-drop payload from the sidebar (SB-3, ED-2). */
export const DRAG_MIME = 'application/x-egd-component'
export interface DragPayload {
  type: ComponentType
  documentId: Id | null
}

/** Tools that accept a picture from another tool (intent `add-image` with `path` and `name`). */
export const IMAGE_TARGETS: { type: ComponentType; label: string }[] = [
  { type: 'moodboard', label: 'Moodboard' },
  { type: 'design-language', label: 'Design Language' },
  { type: 'asset-pool', label: 'Asset Pool' },
  { type: 'storyboard', label: 'Storyboard' },
  { type: 'pixel-art', label: 'Pixel Art (as a tracing layer)' },
]

/**
 * Send a picture to another tool (v0.5, e.g. a drawing from the Sketch tool):
 * it is saved into the project's assets, the target opens next to the current
 * tool and receives an `add-image` intent.
 */
export async function sendImageTo(type: ComponentType, blob: Blob, name: string) {
  const root = useProjectStore.getState().root
  if (!root) return
  const asset = await importAssetFromBlob(root, blob, 'image', `${name}.png`)
  if (!asset) return
  postIntent(type, { action: 'add-image', path: asset.path, name })
  openComponent(type)
}
