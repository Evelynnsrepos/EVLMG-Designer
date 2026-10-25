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
