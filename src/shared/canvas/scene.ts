import { newId, type Id } from '@/core/model'
import type { BuiltinNode, Layer, NodeBase, Scene } from './types'

/**
 * Pure scene operations. All return a new scene (or the same object when
 * nothing changed), so they plug straight into `doc.update` and undo.
 */

export const DEFAULT_LAYER_NAME = 'Layer 1'

export function createScene<N extends NodeBase = BuiltinNode>(layerName = DEFAULT_LAYER_NAME): Scene<N> {
  return { layers: [{ id: newId(), name: layerName }], nodes: [] }
}

/** Layers in drawing order: normal layers, then always-on-top layers (MB-6). */
export function orderedLayers(scene: Scene<NodeBase>): Layer[] {
  return [...scene.layers.filter((l) => !l.alwaysOnTop), ...scene.layers.filter((l) => l.alwaysOnTop)]
}

/** Visible nodes grouped by layer, in drawing order (bottom first). Nodes on unknown layers go into the first layer. */
export function renderOrder<N extends NodeBase>(scene: Scene<N>): { layer: Layer; nodes: N[] }[] {
  const layers = orderedLayers(scene)
  const byLayer = new Map<Id, N[]>(layers.map((l) => [l.id, []]))
  const fallback = layers[0]?.id
  for (const n of scene.nodes) {
    const list = byLayer.get(n.layerId) ?? (fallback ? byLayer.get(fallback) : undefined)
    list?.push(n)
  }
  return layers.map((layer) => ({ layer, nodes: byLayer.get(layer.id)! }))
}

/** Nodes drawn and hit-testable: not hidden and not on a hidden layer. */
export function visibleNodes<N extends NodeBase>(scene: Scene<N>): N[] {
  return renderOrder(scene).flatMap(({ layer, nodes }) => (layer.hidden ? [] : nodes.filter((n) => !n.hidden)))
}

/** Nodes the user can select: visible and not locked (node or layer); with `layerId`, only that layer's (layer-scoped tools). */
export function selectableNodes<N extends NodeBase>(scene: Scene<N>, layerId?: Id | null): N[] {
  const locked = new Set(scene.layers.filter((l) => l.locked).map((l) => l.id))
  return visibleNodes(scene).filter((n) => !n.locked && !locked.has(n.layerId) && (layerId == null || n.layerId === layerId))
}

/** Layer for new nodes: the requested one if usable, else the topmost visible unlocked layer. */
export function resolveActiveLayer(scene: Scene<NodeBase>, preferred: Id | null): Id {
  const usable = (l: Layer) => !l.hidden && !l.locked
  const pref = scene.layers.find((l) => l.id === preferred)
  if (pref && usable(pref)) return pref.id
  const ordered = orderedLayers(scene).filter((l) => !l.alwaysOnTop)
  return ([...ordered].reverse().find(usable) ?? ordered[ordered.length - 1] ?? scene.layers[0])?.id ?? ''
}

export function getNode<N extends NodeBase>(scene: Scene<N>, id: Id): N | undefined {
  return scene.nodes.find((n) => n.id === id)
}

export function addNodes<N extends NodeBase>(scene: Scene<N>, nodes: N[]): Scene<N> {
  return nodes.length ? { ...scene, nodes: [...scene.nodes, ...nodes] } : scene
}

export function updateNode<N extends NodeBase>(scene: Scene<N>, id: Id, patch: Partial<N> | ((n: N) => N)): Scene<N> {
  let changed = false
  const nodes = scene.nodes.map((n) => {
    if (n.id !== id) return n
    changed = true
    return typeof patch === 'function' ? patch(n) : { ...n, ...patch }
  })
  return changed ? { ...scene, nodes } : scene
}

export function updateNodes<N extends NodeBase>(scene: Scene<N>, ids: Iterable<Id>, fn: (n: N) => N): Scene<N> {
  const set = new Set(ids)
  if (set.size === 0) return scene
  return { ...scene, nodes: scene.nodes.map((n) => (set.has(n.id) ? fn(n) : n)) }
}

/** Nodes that point at another node through `fromId`/`toId` (connectors). */
function attachedIds(n: NodeBase): Id[] {
  const r = n as NodeBase & { fromId?: unknown; toId?: unknown }
  return [r.fromId, r.toId].filter((v): v is Id => typeof v === 'string')
}

/** Delete nodes plus every connector attached to them. */
export function deleteNodes<N extends NodeBase>(scene: Scene<N>, ids: Iterable<Id>): Scene<N> {
  const gone = new Set(ids)
  if (gone.size === 0) return scene
  // Repeat so connectors attached to deleted connectors also go.
  let size = -1
  while (size !== gone.size) {
    size = gone.size
    for (const n of scene.nodes) if (!gone.has(n.id) && attachedIds(n).some((a) => gone.has(a))) gone.add(n.id)
  }
  const nodes = scene.nodes.filter((n) => !gone.has(n.id))
  return nodes.length === scene.nodes.length ? scene : { ...scene, nodes }
}

/** Move nodes by (dx, dy). Absolute nodes (connectors) stay, since they follow their ends. */
export function translateNodes<N extends NodeBase>(scene: Scene<N>, ids: Iterable<Id>, dx: number, dy: number, isAbsolute: (n: N) => boolean = () => false): Scene<N> {
  if (dx === 0 && dy === 0) return scene
  return updateNodes(scene, ids, (n) => (isAbsolute(n) ? n : { ...n, x: n.x + dx, y: n.y + dy }))
}

/**
 * Copy nodes with new ids, offset by (dx, dy). Connectors are copied only when
 * both ends are copied, and then point at the copies. Returns the scene and new ids.
 */
export function duplicateNodes<N extends NodeBase>(scene: Scene<N>, ids: Iterable<Id>, dx = 20, dy = 20): { scene: Scene<N>; ids: Id[] } {
  const set = new Set(ids)
  const idMap = new Map<Id, Id>()
  for (const n of scene.nodes) if (set.has(n.id) && attachedIds(n).length === 0) idMap.set(n.id, newId())
  for (const n of scene.nodes) if (set.has(n.id) && attachedIds(n).length > 0 && attachedIds(n).every((a) => idMap.has(a))) idMap.set(n.id, newId())

  const copies: N[] = []
  for (const n of scene.nodes) {
    const id = idMap.get(n.id)
    if (!id) continue
    const copy = { ...n, id, x: n.x + dx, y: n.y + dy } as N & { fromId?: Id; toId?: Id }
    if (copy.fromId) copy.fromId = idMap.get(copy.fromId)!
    if (copy.toId) copy.toId = idMap.get(copy.toId)!
    copies.push(copy)
  }
  return { scene: addNodes(scene, copies), ids: copies.map((c) => c.id) }
}

/** Z-order inside each node's layer. */
export type ZMove = 'forward' | 'backward' | 'front' | 'back'

export function reorderNodes<N extends NodeBase>(scene: Scene<N>, ids: Iterable<Id>, move: ZMove): Scene<N> {
  const set = new Set(ids)
  if (set.size === 0) return scene
  const nodes = scene.nodes.slice()
  const sameLayer = (i: number, j: number) => nodes[i].layerId === nodes[j].layerId

  if (move === 'front' || move === 'back') {
    const picked = nodes.filter((n) => set.has(n.id))
    const rest = nodes.filter((n) => !set.has(n.id))
    // Keep layer membership: put picked nodes at the end (front) or start (back) of the array;
    // layers render separately, so this only changes order within their layer.
    return { ...scene, nodes: move === 'front' ? [...rest, ...picked] : [...picked, ...rest] }
  }

  if (move === 'forward') {
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (!set.has(nodes[i].id)) continue
      let j = i + 1
      while (j < nodes.length && !sameLayer(i, j)) j++
      if (j < nodes.length && !set.has(nodes[j].id)) {
        const [n] = nodes.splice(i, 1)
        nodes.splice(j, 0, n)
      }
    }
  } else {
    for (let i = 0; i < nodes.length; i++) {
      if (!set.has(nodes[i].id)) continue
      let j = i - 1
      while (j >= 0 && !sameLayer(i, j)) j--
      if (j >= 0 && !set.has(nodes[j].id)) {
        const [n] = nodes.splice(i, 1)
        nodes.splice(j, 0, n)
      }
    }
  }
  return { ...scene, nodes }
}

/** Move one node to an exact position in its layer's z-order (0 = bottom), e.g. from a layers panel drag. */
export function moveNodeInLayer<N extends NodeBase>(scene: Scene<N>, id: Id, index: number): Scene<N> {
  const node = getNode(scene, id)
  if (!node) return scene
  const others = scene.nodes.filter((n) => n.id !== id)
  const layerPositions = others.flatMap((n, i) => (n.layerId === node.layerId ? [i] : []))
  const clamped = Math.max(0, Math.min(index, layerPositions.length))
  const insertAt = clamped < layerPositions.length ? layerPositions[clamped] : (layerPositions.at(-1) ?? others.length - 1) + 1
  others.splice(insertAt, 0, node)
  return { ...scene, nodes: others }
}

export function moveNodesToLayer<N extends NodeBase>(scene: Scene<N>, ids: Iterable<Id>, layerId: Id): Scene<N> {
  if (!scene.layers.some((l) => l.id === layerId)) return scene
  return updateNodes(scene, ids, (n) => (n.layerId === layerId ? n : { ...n, layerId }))
}

// ---- Layers ----

export function addLayer<N extends NodeBase>(scene: Scene<N>, layer: Partial<Layer> = {}): { scene: Scene<N>; id: Id } {
  const id = layer.id ?? newId()
  const name = layer.name ?? `Layer ${scene.layers.length + 1}`
  return { scene: { ...scene, layers: [...scene.layers, { ...layer, id, name }] }, id }
}

export function updateLayer<N extends NodeBase>(scene: Scene<N>, id: Id, patch: Partial<Omit<Layer, 'id'>>): Scene<N> {
  return { ...scene, layers: scene.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }
}

/** Remove a layer and its nodes. The last layer cannot be removed. */
export function removeLayer<N extends NodeBase>(scene: Scene<N>, id: Id): Scene<N> {
  if (scene.layers.length <= 1 || !scene.layers.some((l) => l.id === id)) return scene
  const removed = deleteNodes(
    scene,
    scene.nodes.filter((n) => n.layerId === id).map((n) => n.id),
  )
  return { ...removed, layers: removed.layers.filter((l) => l.id !== id) }
}

/** Move a layer to `index` in the bottom-to-top list. */
export function moveLayer<N extends NodeBase>(scene: Scene<N>, id: Id, index: number): Scene<N> {
  const from = scene.layers.findIndex((l) => l.id === id)
  if (from < 0) return scene
  const layers = scene.layers.slice()
  const [layer] = layers.splice(from, 1)
  layers.splice(Math.max(0, Math.min(index, layers.length)), 0, layer)
  return { ...scene, layers }
}

/** The always-on-top layer (MB-6), created on first use. */
export function ensureTopLayer<N extends NodeBase>(scene: Scene<N>, name = 'Always on top'): { scene: Scene<N>; id: Id } {
  const existing = scene.layers.find((l) => l.alwaysOnTop)
  if (existing) return { scene, id: existing.id }
  // A fixed id: teammates turning it on at the same time get one layer, not two.
  return addLayer(scene, { id: 'always-on-top', name, alwaysOnTop: true })
}
