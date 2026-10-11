import { newId, type Id } from '@/core/model'
import type { SketchLayer } from './model'

/**
 * Layer groups and masks (Sketch Pro). `doc.layers` stays a flat list, bottom to top,
 * so older code still sees every pixel layer; groups are entries that other layers
 * point to with `parent`, and a mask entry applies to the entry right below it
 * (in its group). Everything here is pure.
 */

export interface LayerNode {
  layer: SketchLayer
  /** Only for groups, bottom to top. */
  children?: LayerNode[]
  /** Mask entry hiding this node where it is dark or empty. */
  mask?: SketchLayer
}

export const isGroup = (l: SketchLayer) => l.kind === 'group'
export const isMask = (l: SketchLayer) => l.kind === 'mask'
/** Layers with their own paintable pixels (pixel layers and masks). */
export const hasPixels = (l: SketchLayer) => l.kind !== 'group' && l.kind !== 'adjust'

/** The group a layer is really in: a parent that is missing, not a group, or would make a loop counts as top level. */
function parentOf(byId: Map<Id, SketchLayer>, l: SketchLayer): Id | null {
  const p = l.parent ? byId.get(l.parent) : undefined
  if (!p || !isGroup(p)) return null
  // Walk up to make sure we never come back to `l`.
  const seen = new Set<Id>([l.id])
  for (let q: SketchLayer | undefined = p; q; q = q.parent ? byId.get(q.parent) : undefined) {
    if (seen.has(q.id)) return null
    seen.add(q.id)
  }
  return p.id
}

/** The layer stack as a tree, bottom to top. Tolerates any old or odd list. */
export function layerTree(layers: SketchLayer[]): LayerNode[] {
  const byId = new Map(layers.map((l) => [l.id, l]))
  const kids = new Map<Id | null, SketchLayer[]>()
  for (const l of layers) {
    const p = parentOf(byId, l)
    kids.set(p, [...(kids.get(p) ?? []), l])
  }
  const build = (parent: Id | null): LayerNode[] => {
    const out: LayerNode[] = []
    for (const l of kids.get(parent) ?? []) {
      if (isMask(l)) {
        const prev = out[out.length - 1]
        if (prev && !prev.mask) prev.mask = l
        continue
      }
      out.push(isGroup(l) ? { layer: l, children: build(l.id) } : { layer: l })
    }
    return out
  }
  return build(null)
}

/** Back to the flat list: children, then their group, then its mask. Stray masks are dropped. */
export function flattenTree(nodes: LayerNode[]): SketchLayer[] {
  return nodes.flatMap((n) => [...(n.children ? flattenTree(n.children) : []), n.layer, ...(n.mask ? [n.mask] : [])])
}

/** Ids of a group and everything inside it (or just the layer), plus attached masks. */
export function subtreeIds(layers: SketchLayer[], id: Id): Set<Id> {
  const self = layers.find((l) => l.id === id)
  if (self && isMask(self)) return new Set([id])
  const out = new Set<Id>()
  const add = (n: LayerNode) => {
    out.add(n.layer.id)
    if (n.mask) out.add(n.mask.id)
    n.children?.forEach(add)
  }
  const at = locate(layerTree(layers), id)
  if (at) add(at.list[at.index])
  return out
}

/** Find a node and the sibling list it lives in. */
function locate(nodes: LayerNode[], id: Id): { list: LayerNode[]; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].layer.id === id) return { list: nodes, index: i }
    const inner = nodes[i].children && locate(nodes[i].children!, id)
    if (inner) return inner
  }
  return null
}

/** Change the tree in place and return the flat list again (with `parent` fields fixed). */
function editTree(layers: SketchLayer[], fn: (tree: LayerNode[]) => void): SketchLayer[] {
  const tree = layerTree(layers)
  fn(tree)
  const fix = (nodes: LayerNode[], parent: Id | null): LayerNode[] =>
    nodes.map((n) => ({
      layer: (n.layer.parent ?? null) === parent ? n.layer : { ...n.layer, parent },
      mask: n.mask && (n.mask.parent ?? null) !== parent ? { ...n.mask, parent } : n.mask,
      children: n.children && fix(n.children, n.layer.id),
    }))
  return flattenTree(fix(tree, null))
}

/** Move a layer (with its group contents and mask) one step up (+1) or down (-1) among its siblings. */
export function moveSibling(layers: SketchLayer[], id: Id, dir: 1 | -1): SketchLayer[] {
  return editTree(layers, (tree) => {
    const at = locate(tree, id)
    if (!at) return
    const j = at.index + dir
    if (j < 0 || j >= at.list.length) return
    ;[at.list[at.index], at.list[j]] = [at.list[j], at.list[at.index]]
  })
}

/** Drag and drop: put `id` above or below `target`, or inside it when it is a group. */
export function moveTo(layers: SketchLayer[], id: Id, target: Id, where: 'above' | 'below' | 'inside'): SketchLayer[] {
  if (id === target || subtreeIds(layers, id).has(target)) return layers
  return editTree(layers, (tree) => {
    const from = locate(tree, id)
    if (!from) return
    const [node] = from.list.splice(from.index, 1)
    const to = locate(tree, target)
    if (!to) return from.list.splice(from.index, 0, node)
    if (where === 'inside' && to.list[to.index].children) to.list[to.index].children!.push(node)
    else to.list.splice(where === 'above' ? to.index + 1 : to.index, 0, node)
  })
}

/** Put layers (ids) into a new group placed where the topmost of them was. Returns the list and the group. */
export function groupLayers(layers: SketchLayer[], ids: Id[], name: string): { layers: SketchLayer[]; group: SketchLayer } {
  const group: SketchLayer = { id: newId(), name, visible: true, opacity: 1, blend: 'source-over', alphaLock: false, clip: false, image: null, kind: 'group' }
  const out = editTree(layers, (tree) => {
    // Only the outermost picked nodes move; a picked group brings its contents.
    const picked: LayerNode[] = []
    let anchor: { list: LayerNode[]; index: number } | null = null
    const walk = (nodes: LayerNode[]) => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        if (ids.includes(n.layer.id) || (n.mask && ids.includes(n.mask.id))) {
          picked.push(n)
          anchor = { list: nodes, index: i }
        } else if (n.children) walk(n.children)
      }
    }
    walk(tree)
    if (!anchor) return
    const a = anchor as { list: LayerNode[]; index: number }
    const node: LayerNode = { layer: group, children: picked }
    a.list.splice(a.index + 1, 0, node)
    const drop = (nodes: LayerNode[]) => {
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (picked.includes(nodes[i])) nodes.splice(i, 1)
        else if (nodes[i].children && nodes[i] !== node) drop(nodes[i].children!)
      }
    }
    drop(tree)
  })
  return { layers: out, group }
}

/** Insert a new layer right above another one (same group), or on top when `aboveId` is missing. */
export function insertAbove(layers: SketchLayer[], layer: SketchLayer, aboveId: Id | undefined): SketchLayer[] {
  const out = editTree(layers, (tree) => {
    const at = aboveId ? locate(tree, aboveId) : null
    if (at) at.list.splice(at.index + 1, 0, { layer })
    else tree.push({ layer })
  })
  return out
}

/** A layer or group with everything inside, as its own stack (for merging and exporting). */
export function subtreeStack(layers: SketchLayer[], id: Id): SketchLayer[] {
  const ids = subtreeIds(layers, id)
  return layers.filter((l) => ids.has(l.id)).map((l) => (l.id === id ? { ...l, parent: null, visible: true } : l))
}

/** Dissolve a group: its contents take its place. */
export function ungroup(layers: SketchLayer[], groupId: Id): SketchLayer[] {
  return editTree(layers, (tree) => {
    const at = locate(tree, groupId)
    const g = at?.list[at.index]
    if (!at || !g?.children) return
    at.list.splice(at.index, 1, ...g.children)
  })
}

/** "Combine down": the layer and the one below become a group (or the layer joins the group below). */
export function combineDown(layers: SketchLayer[], id: Id, name: string): { layers: SketchLayer[]; group: Id | null } {
  const tree = layerTree(layers)
  const at = locate(tree, id)
  if (!at || at.index === 0) return { layers, group: null }
  const below = at.list[at.index - 1]
  if (below.children) return { layers: moveTo(layers, id, below.layer.id, 'inside'), group: below.layer.id }
  const r = groupLayers(layers, [below.layer.id, id], name)
  return { layers: r.layers, group: r.group.id }
}

/** The sibling right below a layer (what merge down merges into), or null. */
export function siblingBelow(layers: SketchLayer[], id: Id): SketchLayer | null {
  const at = locate(layerTree(layers), id)
  return at && at.index > 0 ? at.list[at.index - 1].layer : null
}

/** A copy of a layer or a whole group with new ids; `map` tells old id -> new id (for copying pixels). */
export function duplicateTree(layers: SketchLayer[], id: Id): { layers: SketchLayer[]; map: Map<Id, Id>; top: Id | null } {
  const map = new Map<Id, Id>()
  let top: Id | null = null
  const out = editTree(layers, (tree) => {
    const at = locate(tree, id)
    if (!at) return
    const copy = (n: LayerNode): LayerNode => {
      const re = (l: SketchLayer, name = l.name): SketchLayer => {
        const nid = newId()
        map.set(l.id, nid)
        return { ...l, id: nid, name, image: null, reference: false }
      }
      const layer = re(n.layer, n === at.list[at.index] ? `${n.layer.name} copy` : n.layer.name)
      return { layer, mask: n.mask && re(n.mask), children: n.children?.map(copy) }
    }
    const node = copy(at.list[at.index])
    top = node.layer.id
    at.list.splice(at.index + 1, 0, node)
  })
  return { layers: out, map, top }
}

/** The mask entry attached to a layer or group, if any. */
export function maskOf(layers: SketchLayer[], id: Id): SketchLayer | undefined {
  const at = locate(layerTree(layers), id)
  return at?.list[at.index].mask
}

/** A layer and everything inside or attached to it is gone. */
export function removeTree(layers: SketchLayer[], id: Id): SketchLayer[] {
  const gone = subtreeIds(layers, id)
  return layers.filter((l) => !gone.has(l.id))
}

/** Insert a new mask entry right above a layer (same group). */
export function addMask(layers: SketchLayer[], id: Id): { layers: SketchLayer[]; mask: SketchLayer | null } {
  const owner = layers.find((l) => l.id === id)
  if (!owner || isMask(owner)) return { layers, mask: null }
  const mask: SketchLayer = { id: newId(), name: 'Mask', visible: true, opacity: 1, blend: 'source-over', alphaLock: false, clip: false, image: null, kind: 'mask' }
  let added = false
  const out = editTree(layers, (tree) => {
    const at = locate(tree, id)
    if (at && !at.list[at.index].mask) {
      at.list[at.index].mask = mask
      added = true
    }
  })
  return added ? { layers: out, mask: out.find((l) => l.id === mask.id)! } : { layers, mask: null }
}

/** True when the layer or any group around it is hidden. */
export function shownInTree(layers: SketchLayer[], id: Id): boolean {
  const byId = new Map(layers.map((l) => [l.id, l]))
  for (let l = byId.get(id), n = 0; l && n < 100; l = l.parent ? byId.get(l.parent) : undefined, n++) if (!l.visible) return false
  return true
}

/** True when the layer or a group around it is locked. */
export function lockedInTree(layers: SketchLayer[], id: Id): boolean {
  const byId = new Map(layers.map((l) => [l.id, l]))
  for (let l = byId.get(id), n = 0; l && n < 100; l = l.parent ? byId.get(l.parent) : undefined, n++) if (l.locked) return true
  return false
}

/** How deep a layer sits in groups (0 = top level). */
export function depthOf(layers: SketchLayer[], id: Id): number {
  const byId = new Map(layers.map((l) => [l.id, l]))
  let d = 0
  for (let l = byId.get(id); l?.parent && byId.get(l.parent) && d < 100; l = byId.get(l.parent)) d++
  return d
}

/** The stack without private layers (and what is inside private groups), for exports. */
export function exportLayers(layers: SketchLayer[]): SketchLayer[] {
  const gone = new Set<Id>()
  for (const l of layers) if (l.private) for (const id of subtreeIds(layers, l.id)) gone.add(id)
  return gone.size ? layers.filter((l) => !gone.has(l.id)) : layers
}

/** Rows for the layer list, top to bottom, skipping the insides of folded groups. */
export function layerRows(layers: SketchLayer[]): { layer: SketchLayer; depth: number; mask?: SketchLayer }[] {
  const rows: { layer: SketchLayer; depth: number; mask?: SketchLayer }[] = []
  const walk = (nodes: LayerNode[], depth: number) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      rows.push({ layer: n.layer, depth, mask: n.mask })
      if (n.children && !n.layer.collapsed) walk(n.children, depth + 1)
    }
  }
  walk(layerTree(layers), 0)
  return rows
}
