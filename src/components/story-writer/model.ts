import { newId, type Id } from '@/core/model'
import { addNodes, createScene, deleteNodes, getNode, updateNode, type ConnectorNode, type NodeBase, type Scene } from '@/shared/canvas'

/**
 * Story Branch Writer data (spec 8.5). Nodes and their arrows live in one
 * canvas scene: `story-node` nodes plus built-in `connector` nodes from an
 * earlier node to a later one (SW-10).
 */

/** A web address, another story node, or an entity/wiki article (`kind` = `character`, `article`, ...). SW-2. */
export type StoryLink = { kind: 'url'; url: string } | { kind: string; targetId: Id }

export interface StoryNode extends NodeBase {
  kind: 'story-node'
  /** Upper text: title or heading (SW-1). */
  title: string
  /** Lower text: body (SW-1). */
  body: string
  width: number
  fillColor: string
  /** Optional image, a project asset path (SW-2). */
  src?: string | null
  link?: StoryLink | null
  /** 0.21: new nodes start as a roomy card with space for the story text; older nodes fit their text. */
  minHeight?: number
  /** v0.33: Start or Ending marker; missing = an ordinary node. */
  role?: StoryRole
}

export type StoryItem = StoryNode | ConnectorNode

export interface StoryDoc {
  scene: Scene<StoryItem>
}

export const createDefaultStory = (): StoryDoc => ({ scene: createScene<StoryItem>() })

/** Colors offered for new branches (SW-3). User content colors, so fixed values are fine. */
export const STORY_COLORS = ['#d46cf0', '#8fb4ff', '#5fd3a0', '#ffd166', '#ff9061', '#ff6b9a', '#9aa0ad']

export const NODE_WIDTH = 280
/** 0.21: height of a new, empty node. */
export const NEW_NODE_HEIGHT = 140
export const MIN_NODE_WIDTH = 140

export const isStoryNode = (n: NodeBase | undefined): n is StoryNode => n?.kind === 'story-node'
export const isConnector = (n: NodeBase | undefined): n is ConnectorNode => n?.kind === 'connector'

export function isUrlLink(link: StoryLink): link is { kind: 'url'; url: string } {
  return link.kind === 'url'
}

export function storyNodes(scene: Scene<StoryItem>): StoryNode[] {
  return scene.nodes.filter(isStoryNode)
}

/** Connectors leaving a node, i.e. the choices that follow it. */
export function outgoing(scene: Scene<StoryItem>, id: Id): ConnectorNode[] {
  return scene.nodes.filter((n): n is ConnectorNode => isConnector(n) && n.fromId === id)
}

export function findConnector(scene: Scene<StoryItem>, fromId: Id, toId: Id): ConnectorNode | undefined {
  return scene.nodes.find((n): n is ConnectorNode => isConnector(n) && n.fromId === fromId && n.toId === toId)
}

export function makeStoryNode(layerId: Id, at: { x: number; y: number }, fillColor: string): StoryNode {
  // Centered horizontally on the click, title row at the click.
  return { id: newId(), kind: 'story-node', layerId, x: at.x - NODE_WIDTH / 2, y: at.y - 20, title: '', body: '', width: NODE_WIDTH, minHeight: NEW_NODE_HEIGHT, fillColor }
}

function makeConnector(layerId: Id, fromId: Id, toId: Id, strokeColor: string): ConnectorNode {
  return { id: newId(), kind: 'connector', layerId, x: 0, y: 0, fromId, toId, strokeColor }
}

/** A color the node's other children do not use yet, so a new branch stands out. */
export function nextBranchColor(scene: Scene<StoryItem>, fromId: Id): string {
  const used = new Set(
    outgoing(scene, fromId)
      .map((c) => getNode(scene, c.toId))
      .filter(isStoryNode)
      .map((n) => n.fillColor),
  )
  const from = getNode(scene, fromId)
  if (isStoryNode(from)) used.add(from.fillColor)
  return STORY_COLORS.find((c) => !used.has(c)) ?? STORY_COLORS[0]
}

export interface CreateResult {
  scene: Scene<StoryItem>
  node: StoryNode
  /** True when the new node is a second (or later) choice after `fromId` (SW-3, SW-5). */
  isBranch: boolean
}

/**
 * Create tool click on empty space (SW-4, SW-5): a new node, connected from
 * `fromId` when that node still exists. Continuing a line keeps its color; a
 * new branch gets a fresh one.
 */
export function createNodeAfter(scene: Scene<StoryItem>, fromId: Id | null, layerId: Id, at: { x: number; y: number }): CreateResult {
  const from = fromId ? getNode(scene, fromId) : undefined
  if (!isStoryNode(from)) {
    const node = makeStoryNode(layerId, at, STORY_COLORS[0])
    return { scene: addNodes(scene, [node]), node, isBranch: false }
  }
  const isBranch = outgoing(scene, from.id).length > 0
  const node = makeStoryNode(layerId, at, isBranch ? nextBranchColor(scene, from.id) : from.fillColor)
  return { scene: addNodes(scene, [node, makeConnector(layerId, from.id, node.id, node.fillColor)]), node, isBranch }
}

/** Connect tool (SW-7). No duplicates, no self links. */
export function connectNodes(scene: Scene<StoryItem>, fromId: Id, toId: Id): Scene<StoryItem> {
  const from = getNode(scene, fromId)
  const to = getNode(scene, toId)
  if (fromId === toId || !isStoryNode(from) || !isStoryNode(to) || findConnector(scene, fromId, toId)) return scene
  return addNodes(scene, [makeConnector(from.layerId, fromId, toId, to.fillColor)])
}

/** Sever tool (SW-6). */
export function severConnector(scene: Scene<StoryItem>, connectorId: Id): Scene<StoryItem> {
  return isConnector(getNode(scene, connectorId)) ? deleteNodes(scene, [connectorId]) : scene
}

/** Recolor a node and the arrows leading into it, so a branch reads as one color. */
export function setNodeColor(scene: Scene<StoryItem>, id: Id, fillColor: string): Scene<StoryItem> {
  if (!isStoryNode(getNode(scene, id))) return scene
  return {
    ...scene,
    nodes: scene.nodes.map((n) => {
      if (n.id === id && isStoryNode(n)) return { ...n, fillColor }
      if (isConnector(n) && n.toId === id) return { ...n, strokeColor: fillColor }
      return n
    }),
  }
}

export function patchStoryNode(scene: Scene<StoryItem>, id: Id, patch: Partial<Omit<StoryNode, 'id' | 'kind'>>): Scene<StoryItem> {
  return updateNode(scene, id, (n) => (isStoryNode(n) ? { ...n, ...patch } : n))
}

/** False for a link whose target or address has not been filled in yet. */
export function isLinkSet(link: StoryLink | null | undefined): link is StoryLink {
  if (!link) return false
  return isUrlLink(link) ? link.url.trim() !== '' : link.targetId !== ''
}

// ---- v0.33 overhaul: start/ending, quick add, story check, tidy, play, Twine export ----

/** Optional node role (v0.33, additive field): where the story starts, or one of its endings. */
export type StoryRole = 'start' | 'end'

/** Arrows coming into a node. */
export function incoming(scene: Scene<StoryItem>, id: Id): ConnectorNode[] {
  return scene.nodes.filter((n): n is ConnectorNode => isConnector(n) && n.toId === id)
}

/** Where reading starts: nodes marked Start, else nodes nothing points to (oldest first). */
export function storyStarts(scene: Scene<StoryItem>): StoryNode[] {
  const nodes = storyNodes(scene)
  const marked = nodes.filter((n) => n.role === 'start')
  if (marked.length) return marked
  const roots = nodes.filter((n) => incoming(scene, n.id).length === 0)
  return roots.length ? roots : nodes.slice(0, 1)
}

/** The choices after a node: each arrow with its target, in the order they were made. */
export function choicesOf(scene: Scene<StoryItem>, id: Id): { arrow: ConnectorNode; to: StoryNode }[] {
  return outgoing(scene, id).flatMap((arrow) => {
    const to = getNode(scene, arrow.toId)
    return isStoryNode(to) ? [{ arrow, to }] : []
  })
}

/** Every node once, in reading order (starts first, then breadth first); unreachable nodes at the end. */
export function readingOrder(scene: Scene<StoryItem>): StoryNode[] {
  const seen = new Set<Id>()
  const out: StoryNode[] = []
  const queue = [...storyStarts(scene)]
  const visit = () => {
    while (queue.length) {
      const n = queue.shift()!
      if (seen.has(n.id)) continue
      seen.add(n.id)
      out.push(n)
      queue.push(...choicesOf(scene, n.id).map((c) => c.to))
    }
  }
  visit()
  for (const n of storyNodes(scene)) {
    if (seen.has(n.id)) continue
    queue.push(n)
    visit()
  }
  return out
}

export type StoryProblem = { id: Id; kind: 'dead-end' | 'unreachable' | 'untitled' }

/** Story check: lines that stop without being an ending, nodes no path reaches, nodes without a title. */
export function storyProblems(scene: Scene<StoryItem>): StoryProblem[] {
  const nodes = storyNodes(scene)
  const reached = new Set<Id>()
  const queue = storyStarts(scene).map((n) => n.id)
  while (queue.length) {
    const id = queue.shift()!
    if (reached.has(id)) continue
    reached.add(id)
    queue.push(...outgoing(scene, id).map((c) => c.toId))
  }
  const out: StoryProblem[] = []
  for (const n of nodes) {
    if (!reached.has(n.id)) out.push({ id: n.id, kind: 'unreachable' })
    else if (n.role !== 'end' && outgoing(scene, n.id).length === 0 && nodes.length > 1) out.push({ id: n.id, kind: 'dead-end' })
    if (!n.title.trim()) out.push({ id: n.id, kind: 'untitled' })
  }
  return out
}

const wordsIn = (s: string) => s.split(/\s+/).filter(Boolean).length

export function storyStats(scene: Scene<StoryItem>) {
  const nodes = storyNodes(scene)
  return {
    nodes: nodes.length,
    choices: nodes.filter((n) => outgoing(scene, n.id).length > 1).length,
    endings: nodes.filter((n) => n.role === 'end').length,
    words: nodes.reduce((sum, n) => sum + wordsIn(n.title) + wordsIn(n.body), 0),
  }
}

export const COLUMN_GAP = 90
export const ROW_GAP = 40

/**
 * Quick add (the + button under a node): a new node to the right, below the node's other followers,
 * connected from it. The first follower continues the line's color; later ones are new choices.
 */
export function addFollower(scene: Scene<StoryItem>, fromId: Id, heights: (id: Id) => number): CreateResult | null {
  const from = getNode(scene, fromId)
  if (!isStoryNode(from)) return null
  const kids = choicesOf(scene, fromId).map((c) => c.to)
  const x = from.x + from.width + COLUMN_GAP + NODE_WIDTH / 2
  const y = kids.length ? Math.max(...kids.map((k) => k.y + heights(k.id))) + ROW_GAP : from.y
  return createNodeAfter(scene, fromId, from.layerId, { x, y: y + 20 })
}

/**
 * Tidy: lay the story out left to right, one column per step from the start, each column stacked
 * without overlaps. Nodes keep their order inside a column (top to bottom).
 */
export function tidyLayout(scene: Scene<StoryItem>, heights: (id: Id) => number): Scene<StoryItem> {
  const depth = new Map<Id, number>()
  const walk = (startIds: Id[]) => {
    const queue = startIds.map((id) => ({ id, d: 0 }))
    while (queue.length) {
      const { id, d } = queue.shift()!
      if (depth.has(id)) continue
      depth.set(id, d)
      for (const c of outgoing(scene, id)) queue.push({ id: c.toId, d: d + 1 })
    }
  }
  walk(storyStarts(scene).map((n) => n.id))
  const order = readingOrder(scene)
  // An island no start reaches gets its own columns from 0.
  for (const n of order) if (!depth.has(n.id)) walk([n.id])
  const columns = new Map<number, StoryNode[]>()
  for (const n of order) {
    const d = depth.get(n.id) ?? 0
    columns.set(d, [...(columns.get(d) ?? []), n])
  }
  const all = storyNodes(scene)
  const left = all.length ? Math.min(...all.map((n) => n.x)) : 0
  const top = all.length ? Math.min(...all.map((n) => n.y)) : 0
  const colWidth = (d: number) => Math.max(...(columns.get(d) ?? []).map((n) => n.width))
  const pos = new Map<Id, { x: number; y: number }>()
  let x = left
  for (let d = 0; columns.has(d); d++) {
    let y = top
    for (const n of columns.get(d)!) {
      pos.set(n.id, { x, y })
      y += heights(n.id) + ROW_GAP
    }
    x += colWidth(d) + COLUMN_GAP
  }
  return { ...scene, nodes: scene.nodes.map((n) => (isStoryNode(n) && pos.has(n.id) ? { ...n, ...pos.get(n.id)! } : n)) }
}

/** The arrow's choice text (what the player picks), stored as the connector's label. */
export function setChoiceText(scene: Scene<StoryItem>, connectorId: Id, label: string): Scene<StoryItem> {
  return updateNode(scene, connectorId, (n) => (isConnector(n) ? { ...n, label } : n))
}

/** Twine (Twee 3) text, so the story opens in Twine and engines that read Twee. */
export function toTwee(scene: Scene<StoryItem>, title: string): string {
  const order = readingOrder(scene)
  const names = new Map<Id, string>()
  const used = new Set<string>()
  for (const n of order) {
    const base = (n.title.trim() || 'Untitled').replace(/[[\]{}|]/g, '').replace(/->|<-/g, '')
    let name = base
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`
    used.add(name.toLowerCase())
    names.set(n.id, name)
  }
  const start = storyStarts(scene)[0]
  const data = { ifid: crypto.randomUUID().toUpperCase(), format: 'Harlowe', 'format-version': '3.3.9', start: start ? names.get(start.id) : undefined }
  const head = `:: StoryTitle\n${title.trim() || 'Untitled story'}\n\n:: StoryData\n${JSON.stringify(data, null, 2)}\n`
  const passages = order.map((n) => {
    const links = choicesOf(scene, n.id).map(({ arrow, to }) => {
      const target = names.get(to.id)!
      const text = arrow.label?.trim().replace(/[[\]]|->/g, '')
      return text && text !== target ? `[[${text}->${target}]]` : `[[${target}]]`
    })
    const tags = n.role === 'end' ? ' [ending]' : ''
    return `:: ${names.get(n.id)}${tags} {"position":"${Math.round(n.x)},${Math.round(n.y)}"}\n${[n.body.trim(), links.join('\n')].filter(Boolean).join('\n\n')}\n`
  })
  return [head, ...passages].join('\n')
}
