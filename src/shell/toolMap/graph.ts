import type { ComponentType, Entity, Id, LinkTarget, ProjectMeta } from '@/core/model'
import type { ReferenceIndex } from '@/core/references'
import { ENTITY_COMPONENT } from '@/shared/entityList/navigation'

/**
 * The data behind the Tool map (Tab): the project's tools in their sidebar groups, the links between
 * them, and where each bubble sits. Pure functions; nothing here is stored in the project.
 */

export interface MapGroup {
  id: string
  /** Empty for the only group of a project without stars or folders. */
  name: string
  tools: ComponentType[]
}

/** The sidebar's own order: starred tools, then each folder, then the rest. */
export function groupTools(meta: Pick<ProjectMeta, 'favorites' | 'folders'>, shown: ComponentType[]): MapGroup[] {
  const left = new Set(shown)
  const take = (tools: ComponentType[]) => tools.filter((t) => left.delete(t))
  const groups: MapGroup[] = [{ id: 'starred', name: 'Starred', tools: take(meta.favorites ?? []) }]
  for (const f of meta.folders ?? []) groups.push({ id: f.id, name: f.name, tools: take(f.tools) })
  const named = groups.filter((g) => g.tools.length)
  if (left.size) named.push({ id: 'rest', name: named.length ? 'Other tools' : '', tools: shown.filter((t) => left.has(t)) })
  return named
}

/** 'link' = the user linked the two tools; 'route' = the app can send things this way. */
export type EdgeKind = 'link' | 'route'

export interface MapEdge {
  a: ComponentType
  b: ComponentType
  kind: EdgeKind
  /** Why the line is there, e.g. "2 jump points, 5 mentions" or "Send to". */
  why: string
  /** How many links it stands for (1 for routes). */
  count: number
}

/** [from, to, what travels]. Routes that exist in code, not in data; graph.test.ts checks every tool still exists. */
export const ROUTES: readonly (readonly [ComponentType, ComponentType, string])[] = [
  ['level-layout', 'pixel-art', 'Tilesets'],
  ['sketch', 'storyboard', 'Frames'],
  ['pixel-art', 'storyboard', 'Frames'],
  ['storyboard', 'pitch', 'Slides'],
  ['storyboard', 'writer', 'Script'],
  ['moodboard', 'sketch', 'Pictures'],
  ['asset-pool', 'tasks', 'Tasks'],
  ['wiki', 'item-list', 'Articles'],
  ['wiki', 'character-list', 'Articles'],
  ['wiki', 'town-list', 'Articles'],
  ['wiki', 'enemy-list', 'Articles'],
]

/** Tools with a "Send to…" menu; where they can send to is `IMAGE_TARGETS` (plugins may add targets). */
export const IMAGE_SENDERS: readonly ComponentType[] = ['sketch', 'vector', 'texture-paint', 'card-designer']

const toolOf = (t: LinkTarget): ComponentType => (t.kind === 'entity' ? ENTITY_COMPONENT[t.type] : t.type)
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * Every line of the map between two shown tools. `index` (the slow file scan) may come later; the
 * jump points and entry connections are known at once.
 */
export function mapEdges(
  shown: ComponentType[],
  meta: Pick<ProjectMeta, 'jumps' | 'documents'>,
  entities: Entity[],
  imageTargets: ComponentType[],
  index?: ReferenceIndex,
): MapEdge[] {
  const ok = new Set(shown)
  const links = new Map<string, { a: ComponentType; b: ComponentType; jumps: number; connections: number; mentions: number }>()
  const link = (a: ComponentType, b: ComponentType, what: 'jumps' | 'connections' | 'mentions') => {
    if (a === b || !ok.has(a) || !ok.has(b)) return
    const [x, y] = a < b ? [a, b] : [b, a]
    const key = `${x}|${y}`
    const e = links.get(key) ?? { a: x, b: y, jumps: 0, connections: 0, mentions: 0 }
    e[what]++
    links.set(key, e)
  }
  for (const j of meta.jumps ?? []) link(toolOf(j.from), toolOf(j.to), 'jumps')
  for (const e of entities) for (const c of e.connections ?? []) link(ENTITY_COMPONENT[e.type], toolOf(c), 'connections')
  if (index) {
    // shortcut: only ids of list entries and documents are known here; ids inside a document (assets, wiki articles) are skipped, map them when someone misses those lines.
    const owner = new Map<Id, ComponentType>()
    for (const e of entities) owner.set(e.id.toLowerCase(), ENTITY_COMPONENT[e.type])
    for (const d of meta.documents) owner.set(d.id.toLowerCase(), d.type)
    for (const [id, refs] of index) {
      const to = owner.get(id)
      if (to) for (const r of refs) link(r.source.kind === 'entity' ? ENTITY_COMPONENT[r.source.entityType] : r.source.componentType, to, 'mentions')
    }
  }
  const out: MapEdge[] = [...links.values()].map((e) => ({
    a: e.a,
    b: e.b,
    kind: 'link',
    count: e.jumps + e.connections + e.mentions,
    why: [e.jumps && plural(e.jumps, 'jump point'), e.connections && plural(e.connections, 'connection'), e.mentions && plural(e.mentions, 'mention')].filter(Boolean).join(', '),
  }))

  const routes = new Map<string, MapEdge>()
  const route = (a: ComponentType, b: ComponentType, why: string) => {
    if (a === b || !ok.has(a) || !ok.has(b)) return
    const [x, y] = a < b ? [a, b] : [b, a]
    const key = `${x}|${y}`
    const e = routes.get(key)
    if (!e) routes.set(key, { a: x, b: y, kind: 'route', count: 1, why })
    else if (!e.why.split(', ').includes(why)) e.why += `, ${why}`
  }
  for (const from of IMAGE_SENDERS) for (const to of imageTargets) route(from, to, 'Send to')
  for (const [a, b, why] of ROUTES) route(a, b, why)
  return [...out, ...routes.values()]
}

// ---- Layout ----

export interface Point {
  x: number
  y: number
}

/** Distance between two neighbouring bubbles. */
export const STEP = 132
const GROUP_PAD = 86
const GROUP_GAP = 36

export interface MapLayout {
  nodes: Map<ComponentType, Point>
  groups: (MapGroup & Point & { r: number })[]
  bounds: { x: number; y: number; w: number; h: number }
}

/** A honeycomb: one bubble in the middle, then rings of 6, 12, 18… around it. */
function honeycomb(n: number): { points: Point[]; r: number } {
  const points: Point[] = n ? [{ x: 0, y: 0 }] : []
  let ring = 0
  while (points.length < n) {
    ring++
    const count = Math.min(6 * ring, n - points.length)
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 - Math.PI / 2
      points.push({ x: Math.cos(a) * ring * STEP, y: Math.sin(a) * ring * STEP })
    }
  }
  return { points, r: ring * STEP + GROUP_PAD }
}

/**
 * Always the same picture for the same sidebar, so users learn where things are: each group is a
 * honeycomb of its tools, and the groups sit on a circle just wide enough that none overlap.
 */
export function layoutMap(groups: MapGroup[]): MapLayout {
  const combs = groups.map((g) => honeycomb(g.tools.length))
  const n = groups.length
  // Each group gets a slice of the circle as wide as it is big.
  const total = combs.reduce((s, c) => s + c.r, 0) || 1
  let at = -Math.PI / 2
  const angles = combs.map((c) => {
    const slice = (c.r / total) * Math.PI * 2
    const mid = at + slice / 2
    at += slice
    return mid
  })
  const centers = (R: number) => angles.map((a) => ({ x: Math.cos(a) * R * 1.25, y: Math.sin(a) * R })) // wider than high, like a screen
  const overlaps = (cs: Point[]) => cs.some((c, i) => cs.some((d, j) => j > i && Math.hypot(c.x - d.x, c.y - d.y) < combs[i].r + combs[j].r + GROUP_GAP))
  let R = n > 1 ? Math.max(...combs.map((c) => c.r)) / 2 : 0
  while (n > 1 && overlaps(centers(R))) R += 20
  const cs = centers(R)

  const nodes = new Map<ComponentType, Point>()
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  groups.forEach((g, i) => {
    g.tools.forEach((t, k) => nodes.set(t, { x: cs[i].x + combs[i].points[k].x, y: cs[i].y + combs[i].points[k].y }))
    x1 = Math.min(x1, cs[i].x - combs[i].r)
    y1 = Math.min(y1, cs[i].y - combs[i].r)
    x2 = Math.max(x2, cs[i].x + combs[i].r)
    y2 = Math.max(y2, cs[i].y + combs[i].r)
  })
  if (!n) x1 = y1 = x2 = y2 = 0
  return { nodes, groups: groups.map((g, i) => ({ ...g, ...cs[i], r: combs[i].r })), bounds: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } }
}

/** Arrow keys: the nearest bubble in that direction (sideways distance counts double). */
export function neighbourIn(nodes: Map<ComponentType, Point>, from: ComponentType, dx: number, dy: number): ComponentType | null {
  const p = nodes.get(from)
  if (!p) return null
  let best: ComponentType | null = null
  let bestScore = Infinity
  for (const [t, q] of nodes) {
    const along = (q.x - p.x) * dx + (q.y - p.y) * dy
    if (t === from || along <= 1) continue
    const side = Math.abs((q.x - p.x) * dy) + Math.abs((q.y - p.y) * dx)
    if (side > along * 2.5) continue // not really in that direction
    const score = along + side * 2
    if (score < bestScore) [best, bestScore] = [t, score]
  }
  return best
}

// ---- Lines ----

/** How far a line bows out sideways, as a share of its length; the sign is the side. Gentle bends are tried first. */
const BENDS = [0.16, -0.16, 0.05, -0.05, 0.3, -0.3, 0.45, -0.45]
const SAMPLES = 12
/** A line this close to the middle of a bubble that is not its own runs through it. */
const BUBBLE_CLEAR = 44

const curve = (a: Point, b: Point, bend: number): Point[] => {
  const c = { x: (a.x + b.x) / 2 + (b.y - a.y) * bend, y: (a.y + b.y) / 2 - (b.x - a.x) * bend }
  return Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const t = i / SAMPLES
    return { x: (1 - t) ** 2 * a.x + 2 * t * (1 - t) * c.x + t ** 2 * b.x, y: (1 - t) ** 2 * a.y + 2 * t * (1 - t) * c.y + t ** 2 * b.y }
  })
}
const side = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
const crossings = (p: Point[], q: Point[]) => {
  let n = 0
  for (let i = 0; i < SAMPLES; i++)
    for (let j = 0; j < SAMPLES; j++) if (side(p[i], p[i + 1], q[j]) * side(p[i], p[i + 1], q[j + 1]) < 0 && side(q[j], q[j + 1], p[i]) * side(q[j], q[j + 1], p[i + 1]) < 0) n++
  return n
}

/** The SVG path of a line with this bend. */
export function edgePath(a: Point, b: Point, bend: number): string {
  return `M${a.x} ${a.y} Q${(a.x + b.x) / 2 + (b.y - a.y) * bend} ${(a.y + b.y) / 2 - (b.x - a.x) * bend} ${b.x} ${b.y}`
}

/**
 * A bend for every line, so that lines cross each other and run through bubbles as little as possible.
 * The bubbles stay where they are (the map must look the same every time); only the lines give way.
 * Greedy: each line in turn takes its best bend against the others, twice over. Same input, same result.
 */
export function bendEdges(nodes: Map<ComponentType, Point>, edges: Pick<MapEdge, 'a' | 'b'>[]): number[] {
  const ends = edges.map((e) => [nodes.get(e.a), nodes.get(e.b)] as const)
  const bends = edges.map(() => BENDS[0])
  const lines = ends.map(([a, b]) => (a && b ? curve(a, b, BENDS[0]) : null))
  const others = [...nodes]
  for (let pass = 0; pass < 2; pass++)
    edges.forEach((e, i) => {
      const [a, b] = ends[i]
      if (!a || !b) return
      let best = Infinity
      for (const bend of BENDS) {
        const line = curve(a, b, bend)
        let cost = Math.abs(bend) // of two equally good bends, the gentler one
        for (const [t, p] of others) if (t !== e.a && t !== e.b && line.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < BUBBLE_CLEAR)) cost += 6
        // Lines that share a bubble meet there anyway.
        lines.forEach((l, j) => l && j !== i && edges[j].a !== e.a && edges[j].a !== e.b && edges[j].b !== e.a && edges[j].b !== e.b && (cost += crossings(line, l) * 10))
        if (cost < best) [best, bends[i], lines[i]] = [cost, bend, line]
      }
    })
  return bends
}
