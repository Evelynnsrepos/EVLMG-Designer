import { Circle, Eraser, Hand, MousePointer2, MoveUpRight, Pencil, Slash, Square, StickyNote, Type } from 'lucide-react'
import { Waypoints } from 'lucide-react'
import { jumpTo } from '@/shared/entityList/navigation'
import { pickJumpTarget, targetLabel } from '@/shared/jumps/Jumps'
import type { JumpNode } from './types'
import { newId, type Id } from '@/core/model'
import { rectFromPoints, rectsIntersect, simplifyPoints, snapAngle } from './geometry'
import { addNodes, deleteNodes, selectableNodes, translateNodes } from './scene'
import { NOTE_COLORS } from './nodeTypes'
import type { CanvasApi, CanvasTool, EllipseNode, LineNode, NodeBase, NoteNode, Point, RectNode, TextNode, ToolPointerEvent } from './types'
import { useSettings } from '@/core/state'
import { worldToLocal } from './transform'
import { HOLD_MS, keys, outline, perfect, recognize, resize, type Shape } from '../sketch/quickshape'

/** Labels kept as constants so they can be translated later. */
export const TOOL_LABELS = {
  select: 'Select',
  hand: 'Pan',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  pen: 'Pen',
  text: 'Text',
  note: 'Sticky note',
  eraser: 'Eraser (drag over drawn lines to remove them)',
}

/** Pointer travel (screen px) before a press counts as a drag. */
export const DRAG_THRESHOLD = 4

const movedEnough = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y) >= DRAG_THRESHOLD

function isAbsolute(api: CanvasApi<NodeBase>) {
  return (n: NodeBase) => !!api.nodeTypes[n.kind]?.absolute
}

/**
 * Select tool (V): click to select, Shift/Ctrl-click to toggle, drag to move,
 * drag on empty canvas for a selection box, double-click to edit.
 */
export const selectTool: CanvasTool<any> = {
  id: 'select',
  label: TOOL_LABELS.select,
  icon: MousePointer2,
  shortcut: 'V',
  pointerDown(e, api) {
    if (e.button !== 0) return
    if (e.targetId) return startMove(e, api, e.targetId)
    return startMarquee(e, api)
  },
}

/** Moves the clicked node (and the rest of the selection). Reusable by custom tools. */
export function startMove(e: ToolPointerEvent, api: CanvasApi<any>, targetId: Id) {
  if (e.clickCount === 2) {
    api.select([targetId])
    api.activateNode(targetId)
    return
  }
  const additive = e.shift || e.mod
  const wasSelected = api.selection.includes(targetId)
  let ids: Id[]
  if (additive) {
    ids = wasSelected ? api.selection.filter((id) => id !== targetId) : [...api.selection, targetId]
    api.select(ids)
    if (wasSelected) return
  } else {
    ids = wasSelected ? api.selection : [targetId]
    if (!wasSelected) api.select(ids)
  }
  const abs = isAbsolute(api)
  const start = e.screen
  const startWorld = e.world
  let dragging = false
  return {
    move(m: ToolPointerEvent) {
      if (!dragging && !movedEnough(start, m.screen)) return
      dragging = true
      const dx = m.world.x - startWorld.x
      const dy = m.world.y - startWorld.y
      api.preview((s) => translateNodes(s, ids, dx, dy, abs))
    },
    up() {
      if (dragging) api.commitPreview()
      // Plain click inside a multi-selection narrows it to the clicked node.
      else if (wasSelected && !additive && ids.length > 1) api.select([targetId])
    },
    cancel() {
      api.preview(null)
    },
  }
}

/** Selection box from an empty-canvas drag. Reusable by custom tools. */
export function startMarquee(e: ToolPointerEvent, api: CanvasApi<any>) {
  const additive = e.shift || e.mod
  const startWorld = e.world
  const start = e.screen
  let dragging = false
  return {
    move(m: ToolPointerEvent) {
      if (!dragging && !movedEnough(start, m.screen)) return
      dragging = true
      api.setMarquee(rectFromPoints(startWorld, m.world))
    },
    up(m: ToolPointerEvent) {
      api.setMarquee(null)
      if (!dragging) {
        if (!additive) api.select([])
        return
      }
      const box = rectFromPoints(startWorld, m.world)
      const hits = selectableNodes(api.scene)
        .filter((n) => {
          const b = api.getWorldBounds(n.id)
          return b ? rectsIntersect(box, b) : false
        })
        .map((n) => n.id)
      api.select(hits, additive ? 'add' : 'replace')
    },
    cancel() {
      api.setMarquee(null)
    },
  }
}

/** Hand tool (H): drag to pan. Middle mouse and Space+drag pan with any tool. */
export const handTool: CanvasTool<any> = {
  id: 'hand',
  label: TOOL_LABELS.hand,
  icon: Hand,
  shortcut: 'H',
  cursor: 'grab',
  // Panning is handled by the engine for this tool id.
}

// ---- drawing tools ----

interface ToolOptions<T> {
  shortcut?: string
  /** Style for new nodes, read each time a node is created (e.g. from a color picker). */
  defaults?: () => Partial<T>
}

type BoxNode = RectNode | EllipseNode | NoteNode

function boxTool<T extends BoxNode>(
  kind: T['kind'],
  meta: { id: string; label: string; icon: CanvasTool['icon']; shortcut: string },
  defaultSize: { width: number; height: number },
  extra: () => Partial<T>,
  options: ToolOptions<T> = {},
): CanvasTool<any> {
  const make = (api: CanvasApi<any>, r: { x: number; y: number; width: number; height: number }) =>
    ({ id: newId(), kind, layerId: api.activeLayerId, ...extra(), ...options.defaults?.(), ...r }) as unknown as T

  return {
    ...meta,
    shortcut: options.shortcut ?? meta.shortcut,
    cursor: 'crosshair',
    pointerDown(e, api) {
      if (e.button !== 0) return
      const start = e.world
      const startScreen = e.screen
      let dragging = false
      const box = (p: Point, square: boolean) => {
        let end = p
        if (square) {
          const size = Math.max(Math.abs(p.x - start.x), Math.abs(p.y - start.y))
          end = { x: start.x + Math.sign(p.x - start.x || 1) * size, y: start.y + Math.sign(p.y - start.y || 1) * size }
        }
        return rectFromPoints(start, end)
      }
      return {
        move(m) {
          if (!dragging && !movedEnough(startScreen, m.screen)) return
          dragging = true
          api.setDraft([make(api, box(m.world, m.shift))])
        },
        up(m) {
          api.setDraft(null)
          const r = dragging ? box(m.world, m.shift) : { x: start.x - defaultSize.width / 2, y: start.y - defaultSize.height / 2, ...defaultSize }
          const node = make(api, r)
          api.update((s) => addNodes(s, [node]))
          api.select([node.id])
          if (kind === 'note') api.editText(node.id)
        },
        cancel() {
          api.setDraft(null)
        },
      }
    },
  }
}

export const rectTool = (options?: ToolOptions<RectNode>) =>
  boxTool<RectNode>('rect', { id: 'rect', label: TOOL_LABELS.rect, icon: Square, shortcut: 'R' }, { width: 160, height: 100 }, () => ({}), options)

export const ellipseTool = (options?: ToolOptions<EllipseNode>) =>
  boxTool<EllipseNode>('ellipse', { id: 'ellipse', label: TOOL_LABELS.ellipse, icon: Circle, shortcut: 'O' }, { width: 120, height: 120 }, () => ({}), options)

export const noteTool = (options?: ToolOptions<NoteNode>) =>
  boxTool<NoteNode>('note', { id: 'note', label: TOOL_LABELS.note, icon: StickyNote, shortcut: 'N' }, { width: 180, height: 180 }, () => ({ text: '', fillColor: NOTE_COLORS[0] }), options)

function lineLikeTool(arrow: boolean, options: ToolOptions<LineNode> = {}): CanvasTool<any> {
  return {
    id: arrow ? 'arrow' : 'line',
    label: arrow ? TOOL_LABELS.arrow : TOOL_LABELS.line,
    icon: arrow ? MoveUpRight : Slash,
    shortcut: options.shortcut ?? (arrow ? 'A' : 'L'),
    cursor: 'crosshair',
    pointerDown(e, api) {
      if (e.button !== 0) return
      const start = e.world
      const make = (p: Point): LineNode => ({
        id: newId(),
        kind: 'line',
        layerId: api.activeLayerId,
        x: start.x,
        y: start.y,
        arrow,
        ...options.defaults?.(),
        points: [0, 0, p.x - start.x, p.y - start.y],
      })
      let last: Point | null = null
      return {
        move(m) {
          if (!last && !movedEnough(e.screen, m.screen)) return
          last = m.shift ? snapAngle(start, m.world) : m.world
          api.setDraft([make(last)])
        },
        up() {
          api.setDraft(null)
          if (!last) return
          const node = make(last)
          api.update((s) => addNodes(s, [node]))
          api.select([node.id])
        },
        cancel() {
          api.setDraft(null)
        },
      }
    },
  }
}

export const lineTool = (options?: ToolOptions<LineNode>) => lineLikeTool(false, options)
export const arrowTool = (options?: ToolOptions<LineNode>) => lineLikeTool(true, options)

/** Freehand pen (P). */
export const penTool = (options: ToolOptions<LineNode> = {}): CanvasTool<any> => ({
  id: 'pen',
  label: TOOL_LABELS.pen,
  icon: Pencil,
  shortcut: options.shortcut ?? 'P',
  cursor: 'crosshair',
  pointerDown(e, api) {
    if (e.button !== 0) return
    const origin = e.world
    const points = [0, 0]
    const { penSize, penSmoothing, penOpacity } = useSettings.getState()
    // Stabilizer: each drawn point only moves part of the way to the pointer, which irons out shaky hands.
    const follow = 1 - Math.min(0.9, penSmoothing * 0.9)
    let sx = 0
    let sy = 0
    let raw = { x: 0, y: 0 }
    const make = (pts: number[]): LineNode => ({
      id: newId(),
      kind: 'line',
      layerId: api.activeLayerId,
      x: origin.x,
      y: origin.y,
      smooth: true,
      ...options.defaults?.(),
      strokeWidth: penSize,
      ...(penOpacity < 1 ? { opacity: penOpacity } : {}),
      points: pts,
    })
    // QuickShape: rest at the end of the stroke to snap it to a clean shape; keep holding to resize, Shift for perfect.
    let rest = { x: 0, y: 0 }
    let timer: ReturnType<typeof setTimeout> | undefined
    let snapped: { shape: Shape; at: { x: number; y: number } } | null = null
    let shaped: number[] | null = null
    const drawShape = (to: { x: number; y: number }) => {
      if (!snapped) return
      let shape = resize(snapped.shape, snapped.at, to)
      if (keys.shift) shape = perfect(shape)
      shaped = outline(shape, 3, { x: 0, y: 0 }).flatMap((q) => [q.x, q.y])
      api.setDraft([{ ...make(shaped), smooth: false }])
    }
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const pts: { x: number; y: number }[] = []
        for (let i = 0; i < points.length; i += 2) pts.push({ x: points[i], y: points[i + 1] })
        const shape = recognize(pts)
        if (!shape) return
        snapped = { shape, at: rest }
        drawShape(rest)
      }, HOLD_MS)
    }
    arm()
    return {
      move(m) {
        raw = { x: m.world.x - origin.x, y: m.world.y - origin.y }
        if (snapped) return drawShape(raw)
        sx += (raw.x - sx) * follow
        sy += (raw.y - sy) * follow
        points.push(sx, sy)
        api.setDraft([make(points)])
        if (Math.hypot(raw.x - rest.x, raw.y - rest.y) * api.viewport.scale > 4) {
          rest = raw
          arm()
        }
      },
      up() {
        clearTimeout(timer)
        api.setDraft(null)
        if (shaped) {
          const node = { ...make(shaped), smooth: false }
          api.update((s) => addNodes(s, [node]))
          return
        }
        if (points.length < 4) points.push(0.5, 0.5) // a dot
        else points.push(raw.x, raw.y) // the stroke still ends where the pointer was let go
        const node = make(simplifyPoints(points, 1.5 / api.viewport.scale))
        api.update((s) => addNodes(s, [node]))
      },
      cancel() {
        clearTimeout(timer)
        api.setDraft(null)
      },
    }
  },
})

/** Text (T): click to type; click existing text to edit it. */
export const textTool = (options: ToolOptions<TextNode> = {}): CanvasTool<any> => ({
  id: 'text',
  label: TOOL_LABELS.text,
  icon: Type,
  shortcut: options.shortcut ?? 'T',
  cursor: 'text',
  pointerDown(e, api) {
    if (e.button !== 0) return
    const target = e.targetId ? api.scene.nodes.find((n) => n.id === e.targetId) : undefined
    if (target && api.nodeTypes[target.kind]?.textEdit) {
      api.select([target.id])
      api.editText(target.id)
      return
    }
    const fontSize = 20
    const node: TextNode = {
      id: newId(),
      kind: 'text',
      layerId: api.activeLayerId,
      x: e.world.x,
      y: e.world.y - (fontSize * 1.25) / 2,
      text: '',
      fontSize,
      width: 240,
      ...options.defaults?.(),
    }
    api.editText(node.id, node)
  },
})

/**
 * Jump point (J, v0.17): click the board to place a link to any tool, document or entry (a window asks
 * where it goes); click a jump point with this tool, or double-click it with any tool, to go there.
 */
export const jumpTool: CanvasTool<any> = {
  id: 'jump',
  label: 'Jump point: click to link this spot to any tool, document or entry',
  icon: Waypoints,
  shortcut: 'J',
  cursor: 'copy',
  pointerDown(e, api) {
    if (e.button !== 0) return
    const hit = e.targetId ? api.scene.nodes.find((n) => n.id === e.targetId) : undefined
    if (hit?.kind === 'jump') return void jumpTo((hit as JumpNode).target)
    const at = e.world
    void pickJumpTarget().then((target) => {
      if (!target) return
      const node: JumpNode = { id: newId(), kind: 'jump', layerId: api.activeLayerId, x: at.x, y: at.y - 17, target, label: targetLabel(target) }
      api.update((s) => ({ ...s, nodes: [...s.nodes, node] }))
      api.select([node.id])
      api.setTool('select')
    })
  },
}

/** Every built-in tool, in toolbar order. Components pick the ones they need. */
export function defaultTools(): CanvasTool<any>[] {
  return [selectTool, handTool, rectTool(), ellipseTool(), lineTool(), arrowTool(), penTool(), textTool(), noteTool()]
}

/** Distance from p to the segment a-b. */
function segmentDistance(p: Point, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const l = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l))
  return Math.hypot(ax + t * dx - p.x, ay + t * dy - p.y)
}

/**
 * Eraser (E, v0.14): drag over drawn lines (pen strokes, lines, arrows) to remove them; one undo step per drag.
 * ponytail: removes whole strokes, not parts of them; split strokes at the eraser if partial erasing is wanted.
 */
export const eraserTool = (options: { shortcut?: string } = {}): CanvasTool<any> => ({
  id: 'eraser',
  label: TOOL_LABELS.eraser,
  icon: Eraser,
  shortcut: options.shortcut ?? 'E',
  cursor: 'cell',
  pointerDown(e, api) {
    if (e.button !== 0) return
    const gone = new Set<Id>()
    const eraseAt = (p: Point) => {
      const reach = 8 / api.viewport.scale
      let changed = false
      for (const n of api.scene.nodes as LineNode[]) {
        if (n.kind !== 'line' || n.locked || gone.has(n.id)) continue
        const local = worldToLocal(p, n)
        const r = reach / Math.max(0.01, Math.min(Math.abs(n.scaleX ?? 1), Math.abs(n.scaleY ?? 1)))
        const pts = n.points
        for (let i = 0; i + 3 < pts.length || (i === 0 && pts.length === 2); i += 2) {
          const d = pts.length === 2 ? Math.hypot(pts[0] - local.x, pts[1] - local.y) : segmentDistance(local, pts[i], pts[i + 1], pts[i + 2], pts[i + 3])
          if (d <= r + (n.strokeWidth ?? 2) / 2) {
            gone.add(n.id)
            changed = true
            break
          }
        }
      }
      if (changed) api.preview((s) => deleteNodes(s, gone))
    }
    eraseAt(e.world)
    return {
      move(m) {
        eraseAt(m.world)
      },
      up() {
        if (gone.size) api.commitPreview()
      },
      cancel() {
        api.preview(null)
      },
    }
  },
})
