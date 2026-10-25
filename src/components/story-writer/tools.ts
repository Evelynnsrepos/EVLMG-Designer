import { Link2, Plus, Scissors } from 'lucide-react'
import type { Id } from '@/core/model'
import { getNode, rectCenter, rectContainsPoint, selectableNodes, startMove, type CanvasApi, type CanvasTool, type LineNode, type ToolPointerEvent } from '@/shared/canvas'
import { connectNodes, createNodeAfter, isConnector, isStoryNode, severConnector, type StoryItem } from './model'

export const TOOL_UI = {
  create: 'Create',
  sever: 'Sever',
  connect: 'Connect',
}

/** View state the tools read and change; kept by the View so it can draw highlights. */
export interface StoryToolHost {
  getLastId(): Id | null
  setLastId(id: Id | null): void
  getPendingId(): Id | null
  setPendingId(id: Id | null): void
  setSeverHoverId(id: Id | null): void
  /** A new branch was created: offer colors for it (SW-3). */
  offerColors(nodeId: Id): void
  /** Close the color offer; true if one was open. */
  closeColorOffer(): boolean
  /** 0.21: open the node's title and story text for typing. */
  editNode(id: Id): void
}

type Api = CanvasApi<StoryItem>

/**
 * The story node under the pointer. Falls back to the nodes' bounds when the
 * canvas hit test misses (e.g. the first click right after inline typing).
 */
export function storyNodeAt(e: ToolPointerEvent, api: Api) {
  const hit = e.targetId ? getNode(api.scene, e.targetId) : undefined
  if (isStoryNode(hit)) return hit
  if (hit) return undefined // an arrow or other node is on top
  return selectableNodes(api.scene)
    .filter(isStoryNode)
    .reverse()
    .find((n) => {
      const b = api.getWorldBounds(n.id)
      return b ? rectContainsPoint(b, e.world) : false
    })
}

/**
 * Create (C), SW-4/SW-5: click empty space for a node connected to the last
 * node; click an existing node to make it the last node (a choice point).
 */
export function createTool(host: StoryToolHost): CanvasTool<StoryItem> {
  return {
    id: 'create',
    label: TOOL_UI.create,
    icon: Plus,
    shortcut: 'C',
    cursor: 'crosshair',
    pointerDown(e, api: Api) {
      if (e.button !== 0) return
      const target = storyNodeAt(e, api)
      if (target) {
        host.setLastId(target.id)
        return startMove(e, api, target.id)
      }
      host.closeColorOffer()
      let created: ReturnType<typeof createNodeAfter> | null = null
      api.update((s) => {
        created = createNodeAfter(s, host.getLastId(), api.activeLayerId, e.world)
        return created.scene
      })
      const result = created as ReturnType<typeof createNodeAfter> | null
      if (!result) return
      host.setLastId(result.node.id)
      api.select([result.node.id])
      if (result.isBranch) host.offerColors(result.node.id)
      // Optional typing right away (SW-4); clicking elsewhere finishes it.
      host.editNode(result.node.id)
    },
    keyDown(e) {
      if (e.key !== 'Escape') return false
      if (host.closeColorOffer()) return true
      if (host.getLastId()) {
        host.setLastId(null) // start a new, unconnected story line
        return true
      }
      return false
    },
  }
}

/** Sever (S), SW-6: click an arrow to unlink two nodes. */
export function severTool(host: StoryToolHost): CanvasTool<StoryItem> {
  return {
    id: 'sever',
    label: TOOL_UI.sever,
    icon: Scissors,
    shortcut: 'S',
    cursor: 'pointer',
    pointerDown(e, api: Api) {
      if (e.button !== 0) return
      const target = e.targetId ? getNode(api.scene, e.targetId) : undefined
      if (isConnector(target)) {
        api.update((s) => severConnector(s, target.id))
        host.setSeverHoverId(null)
      }
    },
    hover(e, api: Api) {
      const target = e?.targetId ? getNode(api.scene, e.targetId) : undefined
      host.setSeverHoverId(isConnector(target) ? target.id : null)
    },
    deactivate() {
      host.setSeverHoverId(null)
    },
  }
}

/** Dashed preview line from a node's center to the pointer. */
function previewLine(api: Api, fromId: Id, to: { x: number; y: number }): LineNode | null {
  const b = api.getWorldBounds(fromId)
  if (!b) return null
  const c = rectCenter(b)
  return { id: 'connect-preview', kind: 'line', layerId: api.activeLayerId, x: c.x, y: c.y, points: [0, 0, to.x - c.x, to.y - c.y], arrow: true }
}

/**
 * Connect (L), SW-7: click one node then another (or drag from one to the
 * other) to link them with an arrow.
 */
export function connectTool(host: StoryToolHost): CanvasTool<StoryItem> {
  const finish = (api: Api, toId: Id) => {
    const from = host.getPendingId()
    host.setPendingId(null)
    api.setDraft(null)
    if (from && from !== toId) api.update((s) => connectNodes(s, from, toId))
  }
  const setDraft = (api: Api, line: LineNode | null) => api.setDraft(line ? [line as unknown as StoryItem] : null)

  return {
    id: 'connect',
    label: TOOL_UI.connect,
    icon: Link2,
    shortcut: 'L',
    cursor: 'crosshair',
    pointerDown(e, api: Api) {
      if (e.button !== 0) return
      const target = storyNodeAt(e, api)
      if (!target) {
        host.setPendingId(null)
        api.setDraft(null)
        return
      }
      const pending = host.getPendingId()
      if (pending && pending !== target.id) {
        finish(api, target.id)
        return
      }
      host.setPendingId(target.id)
      let dragged = false
      return {
        move(m) {
          dragged = true
          setDraft(api, previewLine(api, target.id, m.world))
        },
        up(u) {
          if (!dragged) return // click: wait for the second node
          const end = storyNodeAt(u, api)
          if (end && end.id !== target.id) finish(api, end.id)
          else {
            host.setPendingId(null)
            api.setDraft(null)
          }
        },
        cancel() {
          host.setPendingId(null)
          api.setDraft(null)
        },
      }
    },
    hover(e, api: Api) {
      const pending = host.getPendingId()
      if (!pending) return
      setDraft(api, e ? previewLine(api, pending, e.world) : null)
    },
    keyDown(e, api: Api) {
      if (e.key !== 'Escape' || !host.getPendingId()) return false
      host.setPendingId(null)
      api.setDraft(null)
      return true
    },
    deactivate(api: Api) {
      host.setPendingId(null)
      api.setDraft(null)
    },
  }
}
