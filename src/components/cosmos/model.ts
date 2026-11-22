import { newId, type Id } from '@/core/model'
import type { ArtStyle } from './art'

/** Everything that can be placed in a cosmos, roughly from biggest to smallest. */
export const BODY_KINDS = [
  'universe',
  'galaxy',
  'nebula',
  'cluster',
  'solar-system',
  'star',
  'black-hole',
  'planet',
  'dwarf-planet',
  'moon',
  'asteroid-belt',
  'comet',
  'station',
  'other',
] as const

export type BodyKind = (typeof BODY_KINDS)[number]

export const KIND_LABEL: Record<BodyKind, string> = {
  universe: 'Universe',
  galaxy: 'Galaxy',
  nebula: 'Nebula',
  cluster: 'Star cluster',
  'solar-system': 'Solar system',
  star: 'Star',
  'black-hole': 'Black hole',
  planet: 'Planet',
  'dwarf-planet': 'Dwarf planet',
  moon: 'Moon',
  'asteroid-belt': 'Asteroid belt',
  comet: 'Comet',
  station: 'Station',
  other: 'Other',
}

/** Default color and drawn size (radius in the orbit view) of each kind. */
export const KIND_STYLE: Record<BodyKind, { color: string; size: number }> = {
  universe: { color: '#7b6cf0', size: 30 },
  galaxy: { color: '#b38cff', size: 26 },
  nebula: { color: '#f07bc4', size: 24 },
  cluster: { color: '#ffd98a', size: 20 },
  'solar-system': { color: '#ffb84d', size: 20 },
  star: { color: '#ffd23f', size: 18 },
  'black-hole': { color: '#3a3448', size: 16 },
  planet: { color: '#4fa3e0', size: 13 },
  'dwarf-planet': { color: '#a0a6b0', size: 9 },
  moon: { color: '#c9ccd3', size: 7 },
  'asteroid-belt': { color: '#9b8a74', size: 8 },
  comet: { color: '#8fe3f0', size: 6 },
  station: { color: '#7fe0a0', size: 6 },
  other: { color: '#d0d0d0', size: 10 },
}

/** What "Add inside" creates by default under a body of this kind. */
export const CHILD_KIND: Record<BodyKind, BodyKind> = {
  universe: 'galaxy',
  galaxy: 'solar-system',
  nebula: 'star',
  cluster: 'solar-system',
  'solar-system': 'planet',
  star: 'planet',
  'black-hole': 'other',
  planet: 'moon',
  'dwarf-planet': 'moon',
  moon: 'station',
  'asteroid-belt': 'dwarf-planet',
  comet: 'other',
  station: 'other',
  other: 'other',
}

export interface Body {
  id: Id
  /** null = top level of the cosmos. */
  parentId: Id | null
  kind: BodyKind
  name: string
  notes: string
  /** null = the kind's default color. */
  color: string | null
  /** Custom picture (`assets/images/<uuid>.png`), drawn instead of the colored ball. Added in v0.4. */
  image?: string | null
  /** Which of the style's pictures to use (null/absent = picked from the id). Added in v0.35. */
  look?: number | null
}

/** One cosmos document. Bodies are a flat list; order among siblings is list order. */
export interface Cosmos {
  bodies: Body[]
  /** Art style (absent = painted). Added in v0.35. */
  style?: ArtStyle
  /** "Your own set": one picture per kind (`assets/images/<uuid>.png`). Added in v0.35. */
  customArt?: Partial<Record<BodyKind, string>>
  /** "Your own set": tint the pictures with each body's colour (absent = yes). Added in v0.35. */
  customTint?: boolean
}

export const createCosmos = (): Cosmos => ({ bodies: [] })

export const colorOf = (b: Body) => b.color ?? KIND_STYLE[b.kind].color

export const childrenOf = (c: Cosmos, parentId: Id | null) => c.bodies.filter((b) => b.parentId === parentId)

export const findBody = (c: Cosmos, id: Id | null) => (id ? c.bodies.find((b) => b.id === id) : undefined)

/** The body and its ancestors, outermost first (for the breadcrumb). */
export function pathTo(c: Cosmos, id: Id | null): Body[] {
  const out: Body[] = []
  for (let b = findBody(c, id); b && out.length <= c.bodies.length; b = findBody(c, b.parentId)) out.unshift(b)
  return out
}

/** Ids of a body and everything inside it. */
export function subtreeIds(c: Cosmos, id: Id): Set<Id> {
  const ids = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const b of c.bodies) {
      if (b.parentId && ids.has(b.parentId) && !ids.has(b.id)) {
        ids.add(b.id)
        grew = true
      }
    }
  }
  return ids
}

export function addBody(c: Cosmos, parentId: Id | null, kind?: BodyKind): { cosmos: Cosmos; body: Body } {
  const parent = findBody(c, parentId)
  const k = kind ?? (parent ? CHILD_KIND[parent.kind] : 'galaxy')
  const n = childrenOf(c, parentId).filter((b) => b.kind === k).length + 1
  const body: Body = { id: newId(), parentId: parent?.id ?? null, kind: k, name: `${KIND_LABEL[k]} ${n}`, notes: '', color: null }
  return { cosmos: { ...c, bodies: [...c.bodies, body] }, body }
}

export function updateBody(c: Cosmos, id: Id, patch: Partial<Omit<Body, 'id' | 'parentId'>>): Cosmos {
  return { ...c, bodies: c.bodies.map((b) => (b.id === id ? { ...b, ...patch } : b)) }
}

/** Removes the body and everything inside it. */
export function removeBody(c: Cosmos, id: Id): Cosmos {
  const gone = subtreeIds(c, id)
  return { ...c, bodies: c.bodies.filter((b) => !gone.has(b.id)) }
}

/** Put a body inside another (or at the top level). Refuses to move a body into itself. */
export function moveBody(c: Cosmos, id: Id, parentId: Id | null): Cosmos {
  if (parentId && subtreeIds(c, id).has(parentId)) return c
  const body = findBody(c, id)
  if (!body || body.parentId === parentId) return c
  // Moved bodies go last among their new siblings.
  return { ...c, bodies: [...c.bodies.filter((b) => b.id !== id), { ...body, parentId }] }
}

/** Where to draw the children of the focused body: one orbit each, spread around by the golden angle. */
export function orbitLayout(count: number, inner = 70, outer = 280) {
  const step = count > 1 ? (outer - inner) / (count - 1) : 0
  return Array.from({ length: count }, (_, i) => {
    const r = count === 1 ? (inner + outer) / 2 : inner + i * step
    // Start front-right: in the tilted view a body straight up would hide behind the center.
    const a = i * 2.39996 + Math.PI / 6
    return { r, x: r * Math.cos(a), y: r * Math.sin(a) }
  })
}

/** Isometric tilt of the orbit plane: vertical distances are multiplied by this. */
export const ISO = 0.5

/**
 * Looking inside these shows orbits; at the top level and inside these
 * containers the contents are drawn as a node graph instead (v0.4).
 */
export const GRAPH_KINDS: readonly BodyKind[] = ['universe', 'nebula', 'cluster', 'other']

export const showsOrbits = (focus: Body | null) => !!focus && !GRAPH_KINDS.includes(focus.kind)

export interface GraphNode {
  body: Body
  x: number
  y: number
}

/**
 * Top-down tree of everything under `rootId` (null = the whole cosmos): one row per
 * depth, leaves side by side, each parent centered over its children.
 */
export function treeLayout(c: Cosmos, rootId: Id | null, dx = 110, dy = 120): { nodes: GraphNode[]; edges: [GraphNode, GraphNode][] } {
  const nodes: GraphNode[] = []
  const edges: [GraphNode, GraphNode][] = []
  let nextX = 0
  const place = (b: Body, depth: number, seen: Set<Id>): GraphNode => {
    seen.add(b.id)
    const kids = childrenOf(c, b.id).filter((k) => !seen.has(k.id)).map((k) => place(k, depth + 1, seen))
    const x = kids.length ? (kids[0].x + kids[kids.length - 1].x) / 2 : nextX++ * dx
    const node = { body: b, x, y: depth * dy }
    nodes.push(node)
    for (const k of kids) edges.push([node, k])
    return node
  }
  const seen = new Set<Id>()
  for (const b of childrenOf(c, rootId)) place(b, 0, seen)
  return { nodes, edges }
}
