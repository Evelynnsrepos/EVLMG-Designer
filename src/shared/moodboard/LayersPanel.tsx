import { ArrowUpToLine, ChevronDown, ChevronUp, Circle, Eye, EyeOff, Image, Lock, LockOpen, MoveUpRight, Pencil, Plus, Shapes, Slash, Square, StickyNote, Trash, Type, X, type LucideIcon } from 'lucide-react'
import { useState, type DragEvent, type ReactNode } from 'react'
import type { Id } from '@/core/model'
import { confirmDialog, promptDialog } from '@/shared/dialogs'
import {
  addLayer,
  deleteNodes,
  moveLayer,
  moveNodeInLayer,
  moveNodesToLayer,
  orderedLayers,
  removeLayer,
  updateLayer,
  updateNode,
  type Layer,
  type SceneRecipe,
} from '@/shared/canvas'
import { layerNodesTopFirst, type MoodNode, type MoodboardDoc } from './model'

const LAYER_TEXT = {
  title: 'Layers',
  addLayer: 'New layer',
  close: 'Hide layers panel',
  renameLayer: 'Rename layer',
  renameItem: 'Rename',
  show: 'Show',
  hide: 'Hide',
  lock: 'Lock',
  unlock: 'Unlock',
  up: 'Move layer up',
  down: 'Move layer down',
  deleteLayer: 'Delete layer',
  deleteItem: 'Delete',
  onTop: 'Always on top',
  onTopHint: 'Drawings and text here stay above all images',
  active: 'New drawings go here',
  empty: 'Empty',
  confirmDeleteLayer: (name: string, count: number) => ({
    title: `Delete "${name}"?`,
    message: `This layer holds ${count} ${count === 1 ? 'item' : 'items'}. They will be deleted too. You can undo this with Ctrl+Z.`,
  }),
  kinds: {
    image: 'Image',
    cutout: 'Image cutout',
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    line: 'Line',
    arrow: 'Arrow',
    pen: 'Drawing',
    text: 'Text',
    note: 'Note',
    connector: 'Connection',
  },
}

const KIND_ICON: Record<string, LucideIcon> = { image: Image, rect: Square, ellipse: Circle, text: Type, note: StickyNote, connector: Slash, 'card-text': Type, 'card-image': Image }

function iconOf(n: MoodNode): LucideIcon {
  if (n.kind === 'line') return n.smooth ? Pencil : n.arrow ? MoveUpRight : Slash
  return KIND_ICON[n.kind] ?? Shapes
}

/** What a node is called in the panel: its name, its text, or its kind. */
function itemLabel(n: MoodNode): string {
  if (n.name?.trim()) return n.name.trim()
  const k = LAYER_TEXT.kinds
  switch (n.kind) {
    case 'image':
      return n.cutout ? k.cutout : k.image
    case 'line':
      return n.smooth ? k.pen : n.arrow ? k.arrow : k.line
    case 'text':
    case 'note':
      return n.text.trim().split('\n')[0].slice(0, 40) || k[n.kind]
    default: {
      // Other tools' kinds (0.22 Card Designer) are named by their text when they have one.
      const text = (n as { text?: unknown }).text
      return (typeof text === 'string' && text.trim().split('\n')[0].slice(0, 40)) || (k[n.kind as keyof typeof k] ?? n.kind)
    }
  }
}

export interface LayersPanelProps {
  doc: MoodboardDoc
  onChange(recipe: SceneRecipe<MoodNode>): void
  selection: Id[]
  onSelect(ids: Id[], mode: 'replace' | 'toggle'): void
  /** The normal layer new images and (with always-on-top off) drawings go to. */
  activeLayerId: Id
  onActiveLayer(id: Id): void
  onClose(): void
  /** Optional per-layer extras (0.23.3 Card Designer): a small picture before the name, buttons after the built-in ones. */
  layerPreview?(layer: Layer): ReactNode
  layerActions?(layer: Layer): ReactNode
  /** Extra class names and buttons per layer and item (the Card Designer marks what is on every card). */
  layerClass?(layer: Layer): string
  itemClass?(node: MoodNode): string
  itemActions?(node: MoodNode): ReactNode
}

type DragData = { kind: 'node'; id: Id } | { kind: 'layer'; id: Id }
const DND_TYPE = 'application/x-egd-moodboard-layer'

/**
 * MB-5: every image and drawing, grouped by layer, top first. Reorder by
 * dragging rows (also between layers), hide, lock, rename and delete at any time.
 */
export function LayersPanel(p: LayersPanelProps) {
  const scene = p.doc.scene
  const layers = orderedLayers(scene).reverse()
  const normalLayers = scene.layers.filter((l) => !l.alwaysOnTop)
  const [dragging, setDragging] = useState<DragData | null>(null)
  const [dropAt, setDropAt] = useState<{ id: Id; above: boolean } | null>(null)

  const renameLayer = async (l: Layer) => {
    const name = await promptDialog(LAYER_TEXT.renameLayer, l.name)
    if (name?.trim()) p.onChange((s) => updateLayer(s, l.id, { name: name.trim() }))
  }
  const renameItem = async (n: MoodNode) => {
    const name = await promptDialog(LAYER_TEXT.renameItem, n.name ?? itemLabel(n))
    if (name !== null) p.onChange((s) => updateNode(s, n.id, { name: name.trim() || undefined }))
  }
  const deleteLayer = async (l: Layer) => {
    const count = scene.nodes.filter((n) => n.layerId === l.id).length
    if (count > 0 && !(await confirmDialog({ ...LAYER_TEXT.confirmDeleteLayer(l.name, count), confirmLabel: LAYER_TEXT.deleteLayer, danger: true }))) return
    p.onChange((s) => removeLayer(s, l.id))
  }
  // Up/down in the panel = up/down in the stack; always-on-top layers only swap among themselves.
  const shiftLayer = (l: Layer, dir: 1 | -1) => {
    const group = scene.layers.filter((x) => !!x.alwaysOnTop === !!l.alwaysOnTop)
    const neighbour = group[group.indexOf(l) + dir]
    if (!neighbour) return
    p.onChange((s) => moveLayer(s, l.id, s.layers.indexOf(s.layers.find((x) => x.id === neighbour.id)!)))
  }

  const dropOnNode = (target: MoodNode, above: boolean) => {
    if (dragging?.kind !== 'node' || dragging.id === target.id) return
    const id = dragging.id
    p.onChange((s) => {
      const moved = moveNodesToLayer(s, [id], target.layerId)
      // z-order of the layer without the dragged node, bottom first; "above" in the panel = higher.
      const others = moved.nodes.filter((n) => n.layerId === target.layerId && n.id !== id)
      const i = others.findIndex((n) => n.id === target.id)
      return moveNodeInLayer(moved, id, above ? i + 1 : i)
    })
  }
  const dropOnLayer = (l: Layer) => {
    if (dragging?.kind !== 'node') return
    const id = dragging.id
    // Onto a layer header: top of that layer.
    p.onChange((s) => moveNodeInLayer(moveNodesToLayer(s, [id], l.id), id, Number.MAX_SAFE_INTEGER))
  }

  const dragProps = (data: DragData) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DND_TYPE, data.id)
      e.dataTransfer.effectAllowed = 'move'
      setDragging(data)
    },
    onDragEnd: () => {
      setDragging(null)
      setDropAt(null)
    },
  })
  const overRow = (id: Id) => (e: DragEvent) => {
    if (!dragging) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const above = e.clientY < r.top + r.height / 2
    if (dropAt?.id !== id || dropAt.above !== above) setDropAt({ id, above })
  }

  return (
    <aside className="moodboard-layers" aria-label={LAYER_TEXT.title} onPointerDown={(e) => e.stopPropagation()}>
      <header className="moodboard-layers-head">
        <span>{LAYER_TEXT.title}</span>
        <button className="moodboard-icon-btn" title={LAYER_TEXT.addLayer} aria-label={LAYER_TEXT.addLayer} onClick={() => p.onChange((s) => addLayer(s, { name: `Layer ${s.layers.length + 1}` }).scene)}>
          <Plus size={15} />
        </button>
        <button className="moodboard-icon-btn" title={LAYER_TEXT.close} aria-label={LAYER_TEXT.close} onClick={p.onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="moodboard-layers-list" role="tree">
        {layers.map((l) => {
          const nodes = layerNodesTopFirst(scene, l.id)
          const group = scene.layers.filter((x) => !!x.alwaysOnTop === !!l.alwaysOnTop)
          const gi = group.indexOf(l)
          const isActive = !l.alwaysOnTop && l.id === p.activeLayerId
          const canDelete = l.alwaysOnTop ? true : normalLayers.length > 1
          return (
            <div key={l.id} className={'moodboard-layer' + (l.hidden ? ' is-hidden' : '')} role="treeitem" aria-expanded>
              <div
                className={'moodboard-layer-row' + (isActive ? ' is-active' : '') + (dropAt?.id === l.id ? ' is-drop' : '') + (p.layerClass?.(l) ?? '')}
                tabIndex={0}
                onClick={() => !l.alwaysOnTop && p.onActiveLayer(l.id)}
                onDoubleClick={() => renameLayer(l)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    if (!l.alwaysOnTop) p.onActiveLayer(l.id)
                  } else if (e.key === 'F2') void renameLayer(l)
                  else return
                  e.preventDefault()
                }}
                onDragOver={(e) => {
                  if (dragging?.kind !== 'node') return
                  e.preventDefault()
                  if (dropAt?.id !== l.id) setDropAt({ id: l.id, above: true })
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  dropOnLayer(l)
                  setDropAt(null)
                }}
                title={l.alwaysOnTop ? LAYER_TEXT.onTopHint : isActive ? LAYER_TEXT.active : undefined}
              >
                {l.alwaysOnTop ? <ArrowUpToLine size={14} className="moodboard-layer-badge" aria-label={LAYER_TEXT.onTop} /> : null}
                {p.layerPreview?.(l)}
                <span className="moodboard-layer-name">{l.name}</span>
                <span className="moodboard-row-actions">
                  {p.layerPreview ? <RowButton label={LAYER_TEXT.renameLayer} onClick={() => void renameLayer(l)} icon={Pencil} /> : null}
                  <RowButton label={LAYER_TEXT.up} disabled={gi === group.length - 1} onClick={() => shiftLayer(l, 1)} icon={ChevronUp} />
                  <RowButton label={LAYER_TEXT.down} disabled={gi === 0} onClick={() => shiftLayer(l, -1)} icon={ChevronDown} />
                  <RowButton label={l.locked ? LAYER_TEXT.unlock : LAYER_TEXT.lock} on={!!l.locked} onClick={() => p.onChange((s) => updateLayer(s, l.id, { locked: !l.locked }))} icon={l.locked ? Lock : LockOpen} />
                  <RowButton label={l.hidden ? LAYER_TEXT.show : LAYER_TEXT.hide} on={!!l.hidden} onClick={() => p.onChange((s) => updateLayer(s, l.id, { hidden: !l.hidden }))} icon={l.hidden ? EyeOff : Eye} />
                  <RowButton label={LAYER_TEXT.deleteLayer} disabled={!canDelete} onClick={() => deleteLayer(l)} icon={Trash} />
                  {p.layerActions?.(l)}
                </span>
              </div>
              {nodes.length === 0 ? <div className="moodboard-item-empty">{LAYER_TEXT.empty}</div> : null}
              {nodes.map((n) => {
                const Icon = iconOf(n)
                const selected = p.selection.includes(n.id)
                const drop = dropAt?.id === n.id ? (dropAt.above ? ' drop-above' : ' drop-below') : ''
                return (
                  <div
                    key={n.id}
                    className={'moodboard-item' + (selected ? ' is-selected' : '') + (n.hidden ? ' is-hidden' : '') + drop + (p.itemClass?.(n) ?? '')}
                    role="treeitem"
                    aria-selected={selected}
                    {...dragProps({ kind: 'node', id: n.id })}
                    onDragOver={overRow(n.id)}
                    onDrop={(e) => {
                      e.preventDefault()
                      dropOnNode(n, dropAt?.above ?? true)
                      setDropAt(null)
                    }}
                    tabIndex={0}
                    onClick={(e) => p.onSelect([n.id], e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace')}
                    onDoubleClick={() => renameItem(n)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === 'Enter' || e.key === ' ') p.onSelect([n.id], e.shiftKey ? 'toggle' : 'replace')
                      else if (e.key === 'F2') void renameItem(n)
                      else if (e.key === 'Delete') p.onChange((s) => deleteNodes(s, [n.id]))
                      else return
                      e.preventDefault()
                    }}
                  >
                    <Icon size={14} className="moodboard-item-icon" />
                    <span className="moodboard-item-name">{itemLabel(n)}</span>
                    <span className="moodboard-row-actions">
                      <RowButton label={n.locked ? LAYER_TEXT.unlock : LAYER_TEXT.lock} on={!!n.locked} onClick={() => p.onChange((s) => updateNode(s, n.id, { locked: !n.locked || undefined }))} icon={n.locked ? Lock : LockOpen} />
                      <RowButton label={n.hidden ? LAYER_TEXT.show : LAYER_TEXT.hide} on={!!n.hidden} onClick={() => p.onChange((s) => updateNode(s, n.id, { hidden: !n.hidden || undefined }))} icon={n.hidden ? EyeOff : Eye} />
                      <RowButton label={LAYER_TEXT.deleteItem} onClick={() => p.onChange((s) => deleteNodes(s, [n.id]))} icon={Trash} />
                      {p.itemActions?.(n)}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

function RowButton({ label, icon: Icon, onClick, disabled, on }: { label: string; icon: LucideIcon; onClick(): void; disabled?: boolean; on?: boolean }) {
  return (
    <button
      className={'moodboard-icon-btn' + (on ? ' is-on' : '')}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <Icon size={14} />
    </button>
  )
}
