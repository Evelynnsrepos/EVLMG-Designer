/**
 * The Vector tool's own canvas tools. Each drag is shown as a preview and saved as ONE undo step when it ends.
 */
import { Brush, Combine, MousePointer2, PenTool, Spline } from 'lucide-react'
import { newId } from '@/core/model'
import { addNodes, deleteNodes, startMarquee, startMove, translateNodes, type CanvasApi, type CanvasTool, type Id, type Rect, type Scene, type ToolPointerEvent } from '@/shared/canvas'
import { combine, fitCurve, regions, type Piece } from './geom'
import { geomOf, isPaint, type Look, type PaintNode, type PathNode, type VectorNode } from './model'
import { applyMatrix, dragPart, insertAnchor, invertMatrix, nearestSegment, nodeMatrix, normalize, pathD, removeAnchor, toggleSmooth, type Anchor, type SubPath, type XY } from './paths'

type Api = CanvasApi<VectorNode>

/** Screen pixels within which a point, handle, outline or snap line counts as "under the pointer". */
const GRAB_PX = 8
const SNAP_PX = 6

// ---------- helpers ----------

/** A new point path from points in drawing space (x/y take the box corner). */
export function pathNode(layerId: Id, paths: SubPath[], look: Partial<PathNode>): PathNode {
  const nm = normalize(paths)
  return { id: newId(), kind: 'vpath', layerId, x: nm.dx, y: nm.dy, width: nm.width, height: nm.height, ...look, paths: nm.paths }
}

/** Only the paint fields, to copy a look from one item to a new one. */
export function lookOf(n: Look): Look {
  const { fillColor, fill2Color, gradAngle, gradRadial, strokeColor, strokeWidth, strokeDash, strokeSharp, opacity, shadow, glow, shadowColor, shadowSize } = n
  return Object.fromEntries(Object.entries({ fillColor, fill2Color, gradAngle, gradRadial, strokeColor, strokeWidth, strokeDash, strokeSharp, opacity, shadow, glow, shadowColor, shadowSize }).filter(([, v]) => v !== undefined))
}

/** After editing points: keep them inside (0, 0)–(w, h) and move the node so nothing jumps on screen. */
export function withPaths(n: PathNode, paths: SubPath[]): PathNode {
  const nm = normalize(paths)
  const [x, y] = applyMatrix(nodeMatrix(n), [nm.dx, nm.dy])
  return { ...n, x, y, paths: nm.paths, width: nm.width, height: nm.height }
}

/** Selected items plus everything in their groups. */
export function expandGroups(scene: Scene<VectorNode>, ids: Id[]): Id[] {
  const groups = new Set(scene.nodes.filter((n) => ids.includes(n.id) && n.groupId).map((n) => n.groupId))
  if (!groups.size) return ids
  return [...new Set([...ids, ...scene.nodes.filter((n) => n.groupId && groups.has(n.groupId)).map((n) => n.id)])]
}

/** Combines the selected shapes (back to front) into new paths. `keepFrom` stores the originals for "Take apart". */
export function combineNodes(scene: Scene<VectorNode>, ids: Id[], mode: Parameters<typeof combine>[0]): { scene: Scene<VectorNode>; ids: Id[] } {
  const stack = scene.nodes.filter((n): n is PaintNode => ids.includes(n.id) && isPaint(n))
  if (stack.length < 2) throw new Error('Select at least two shapes first.')
  const pieces = combine(mode, stack.map(geomOf)).filter((p) => p.paths.length)
  const layerId = stack[stack.length - 1].layerId
  const keep = mode !== 'divide'
  const made = pieces.map((p) => pathNode(layerId, p.paths, { ...lookOf(stack[p.sources[0]] ?? stack[0]), name: 'Combined shape', evenOdd: false, ...(keep ? { from: stack } : {}) }))
  // The result takes the place of the back-most shape, so things in between keep their order.
  const at = scene.nodes.findIndex((n) => n.id === stack[0].id)
  const rest = deleteNodes(scene, stack.map((n) => n.id))
  const nodes = [...rest.nodes]
  nodes.splice(Math.min(at, nodes.length), 0, ...made)
  return { scene: { ...rest, nodes }, ids: made.map((n) => n.id) }
}

// ---------- select: groups, snapping, double-click to edit points ----------

export interface SnapOptions {
  on: boolean
  /** Snap the box corner to this grid (1 = whole pixels); 0 = no grid. */
  grid: number
  artboard: Rect
}

export interface Guide {
  x?: number
  y?: number
}

/** Snapped move: the selection's edges and centre stick to the drawing's, to other items' and to the grid. */
export function snapDelta(box: Rect, others: Rect[], dx: number, dy: number, o: SnapOptions, tol: number): { dx: number; dy: number; guides: Guide[] } {
  if (!o.on && !o.grid) return { dx, dy, guides: [] }
  const guides: Guide[] = []
  const axis = (start: number, size: number, d: number, targets: number[], horizontal: boolean) => {
    const mine = [start + d, start + d + size / 2, start + d + size]
    let best: { off: number; at: number } | null = null
    if (o.on)
      for (const t of targets)
        for (const m of mine) {
          const off = t - m
          if (Math.abs(off) <= tol && (!best || Math.abs(off) < Math.abs(best.off))) best = { off, at: t }
        }
    if (best) {
      guides.push(horizontal ? { x: best.at } : { y: best.at })
      return d + best.off
    }
    return o.grid ? Math.round((start + d) / o.grid) * o.grid - start : d
  }
  const xs = [o.artboard.x, o.artboard.x + o.artboard.width / 2, o.artboard.x + o.artboard.width, ...others.flatMap((r) => [r.x, r.x + r.width / 2, r.x + r.width])]
  const ys = [o.artboard.y, o.artboard.y + o.artboard.height / 2, o.artboard.y + o.artboard.height, ...others.flatMap((r) => [r.y, r.y + r.height / 2, r.y + r.height])]
  return { dx: axis(box.x, box.width, dx, xs, true), dy: axis(box.y, box.height, dy, ys, false), guides }
}

const unionRect = (rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map((r) => r.x))
  const y0 = Math.min(...rs.map((r) => r.y))
  return { x: x0, y: y0, width: Math.max(...rs.map((r) => r.x + r.width)) - x0, height: Math.max(...rs.map((r) => r.y + r.height)) - y0 }
}

export function vectorSelectTool(o: { snap(): SnapOptions; onGuides(g: Guide[]): void; onEditPoints(id: Id): void }): CanvasTool<VectorNode> {
  return {
    id: 'select',
    label: 'Select',
    icon: MousePointer2,
    shortcut: 'V',
    pointerDown(e, api) {
      if (e.button !== 0) return
      // Selecting through this wrapper always takes the whole group along.
      const grouped: Api = Object.create(api, { select: { value: (ids: Id[], mode?: 'replace' | 'add' | 'toggle') => api.select(expandGroups(api.scene, ids), mode) } })
      if (!e.targetId) return startMarquee(e, grouped)
      const target = api.scene.nodes.find((n) => n.id === e.targetId)
      if (e.clickCount === 2 && isPaint(target)) return void o.onEditPoints(target.id)
      if (!e.shift && !e.mod && !api.selection.includes(e.targetId)) api.select(expandGroups(api.scene, [e.targetId]))
      const moving = expandGroups(api.scene, api.selection.includes(e.targetId) ? api.selection : [e.targetId])
      const boxes = moving.map((id) => api.getWorldBounds(id)).filter((b): b is Rect => !!b)
      const others = api.scene.nodes.filter((n) => !moving.includes(n.id) && !n.hidden).map((n) => api.getWorldBounds(n.id)).filter((b): b is Rect => !!b)
      const box = boxes.length ? unionRect(boxes) : null
      const first = api.scene.nodes.find((n) => n.id === moving[0])
      // Moves go through `preview`; read how far the recipe moved things and snap that distance instead.
      const snapping: Api = Object.create(grouped, {
        preview: {
          value: (recipe: ((s: Scene<VectorNode>) => Scene<VectorNode>) | null) => {
            if (!recipe || !box || !first) return api.preview(recipe)
            const moved = recipe(api.scene).nodes.find((n) => n.id === first.id)
            if (!moved) return api.preview(recipe)
            const s = snapDelta(box, others, moved.x - first.x, moved.y - first.y, o.snap(), SNAP_PX / api.viewport.scale)
            o.onGuides(s.guides)
            api.preview((sc) => translateNodes(sc, moving, s.dx, s.dy))
          },
        },
      })
      const g = startMove(e, snapping, e.targetId)
      const end = () => o.onGuides([])
      return g && { move: g.move, up: () => (g.up(), end()), cancel: () => (g.cancel(), end()) }
    },
  }
}

// ---------- pen ----------

export function penTool(o: { look(): Look; layer(): Id; done(id: Id): void }): CanvasTool<VectorNode> {
  let anchors: Anchor[] = []
  let hoverAt: XY | null = null
  const draft = (api: Api, closed = false) => {
    const pts = hoverAt && !closed ? [...anchors, { p: hoverAt }] : anchors
    api.setDraft(pts.length > 1 ? [{ ...pathNode(o.layer(), [{ anchors: pts, closed }], { strokeColor: '#4dabf7', strokeWidth: 1.5 / api.viewport.scale, fillColor: 'transparent' }), x: 0, y: 0, paths: [{ anchors: pts, closed }] }] : null)
  }
  const finish = (api: Api, closed: boolean) => {
    const pts = anchors
    anchors = []
    hoverAt = null
    api.setDraft(null)
    if (pts.length < 2) return
    const look = o.look()
    const fillable = closed && pts.length > 2
    const line = !fillable ? { fillColor: 'transparent', strokeColor: look.strokeWidth ? look.strokeColor : (look.fillColor ?? '#1d1a2b'), strokeWidth: look.strokeWidth || 4 } : {}
    const n = pathNode(o.layer(), [{ anchors: pts, closed: fillable }], { ...look, ...line, name: fillable ? 'Shape' : 'Line' })
    api.update((s) => addNodes(s, [n]))
    o.done(n.id)
  }
  return {
    id: 'pen',
    label: 'Pen (P): click for corners, drag for curves, click the first point to close. Enter or double-click ends a line.',
    icon: PenTool,
    shortcut: 'P',
    cursor: 'crosshair',
    pointerDown(e, api) {
      if (e.button !== 0) return
      const at: XY = [e.world.x, e.world.y]
      const tol = GRAB_PX / api.viewport.scale
      if (anchors.length > 2 && Math.hypot(at[0] - anchors[0].p[0], at[1] - anchors[0].p[1]) < tol) return void finish(api, true)
      if (e.clickCount === 2 && anchors.length > 1) return void finish(api, false)
      anchors = [...anchors, { p: at }]
      draft(api)
      return {
        move(m) {
          const h: XY = [m.world.x, m.world.y]
          if (Math.hypot(h[0] - at[0], h[1] - at[1]) < tol / 2) return
          // Dragging pulls out a smooth curve: the next curve follows the drag, the last one mirrors it.
          anchors[anchors.length - 1] = { p: at, out: h, in: [2 * at[0] - h[0], 2 * at[1] - h[1]], kind: 'Smooth' }
          hoverAt = null
          draft(api)
        },
      }
    },
    hover(e, api) {
      if (!anchors.length) return
      hoverAt = e ? [e.world.x, e.world.y] : null
      draft(api)
    },
    keyDown(e, api) {
      if (!anchors.length) return false
      if (e.key === 'Enter') return finish(api, false), true
      if (e.key === 'Escape') return finish(api, false), e.preventDefault(), true
      if (e.key === 'Backspace' || e.key === 'Delete') return (anchors = anchors.slice(0, -1)), draft(api), true
      return false
    },
    deactivate(api) {
      finish(api, false)
    },
  }
}

// ---------- pencil ----------

export function pencilTool(o: { look(): Look; layer(): Id; smooth(): number; done(id: Id): void }): CanvasTool<VectorNode> {
  return {
    id: 'pencil',
    label: 'Pencil (N): draw freely, it turns into smooth curves',
    icon: Brush,
    shortcut: 'N',
    cursor: 'crosshair',
    pointerDown(e, api) {
      if (e.button !== 0) return
      const pts: XY[] = [[e.world.x, e.world.y]]
      const show = () => api.setDraft([{ ...pathNode(o.layer(), [{ anchors: pts.map((p) => ({ p })), closed: false }], { strokeColor: '#4dabf7', strokeWidth: 2 / api.viewport.scale, fillColor: 'transparent' }), x: 0, y: 0, paths: [{ anchors: pts.map((p) => ({ p })), closed: false }] }])
      return {
        move(m) {
          pts.push([m.world.x, m.world.y])
          show()
        },
        up() {
          api.setDraft(null)
          if (pts.length < 3) return
          const tol = GRAB_PX / api.viewport.scale
          const closed = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < tol * 2
          let fit: Piece | undefined
          try {
            fit = fitCurve(pts, closed, (o.smooth() / 100) * 6 / api.viewport.scale + 0.2)
          } catch {
            fit = { paths: [{ anchors: pts.map((p) => ({ p })), closed }], sources: [0] }
          }
          if (!fit?.paths.length) return
          const look = o.look()
          const line = !closed ? { fillColor: 'transparent', strokeColor: look.strokeWidth ? look.strokeColor : (look.fillColor ?? '#1d1a2b'), strokeWidth: look.strokeWidth || 4 } : {}
          const n = pathNode(o.layer(), fit.paths, { ...look, ...line, name: closed ? 'Drawn shape' : 'Drawn line' })
          api.update((s) => addNodes(s, [n]))
          o.done(n.id)
        },
        cancel: () => api.setDraft(null),
      }
    },
  }
}

// ---------- edit points ----------

export interface PointPick {
  sp: number
  i: number
}

/** What is under the pointer on the path being edited, in its own space. */
export function pickPart(n: PathNode, world: XY, tolWorld: number, picked: PointPick | null) {
  const inv = invertMatrix(nodeMatrix(n))
  const q = applyMatrix(inv, world)
  const tol = tolWorld / Math.max(0.01, Math.min(Math.abs(n.scaleX ?? 1), Math.abs(n.scaleY ?? 1)))
  const near = (p?: XY) => !!p && Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol
  // The picked point's handles first: they sit on top.
  if (picked) {
    const a = n.paths[picked.sp]?.anchors[picked.i]
    if (a && near(a.out)) return { kind: 'out' as const, ...picked, q }
    if (a && near(a.in)) return { kind: 'in' as const, ...picked, q }
  }
  for (let sp = 0; sp < n.paths.length; sp++) for (let i = 0; i < n.paths[sp].anchors.length; i++) if (near(n.paths[sp].anchors[i].p)) return { kind: 'p' as const, sp, i, q }
  const seg = nearestSegment(n.paths, q)
  if (seg && seg.dist <= tol) return { kind: 'segment' as const, sp: seg.sp, i: seg.i, t: seg.t, q }
  return null
}

export function pointsTool(o: {
  editing(): PathNode | null
  picked(): PointPick | null
  setPicked(p: PointPick | null): void
  /** Clicked another shape: edit that one instead (live shapes become points first). */
  switchTo(id: Id | null): void
}): CanvasTool<VectorNode> {
  const removePicked = (api: Api) => {
    const n = o.editing()
    const p = o.picked()
    if (!n || !p) return false
    const paths = removeAnchor(n.paths, p.sp, p.i)
    o.setPicked(null)
    api.update((s) => (paths.length ? { ...s, nodes: s.nodes.map((x) => (x.id === n.id ? withPaths(n, paths) : x)) } : deleteNodes(s, [n.id])))
    if (!paths.length) o.switchTo(null)
    return true
  }
  return {
    id: 'points',
    label: 'Edit points (A): drag points and handles, click the outline to add a point, double-click a point for corner/smooth, Delete removes it',
    icon: Spline,
    shortcut: 'A',
    pointerDown(e, api) {
      if (e.button !== 0) return
      const n = o.editing()
      const hit = n ? pickPart(n, [e.world.x, e.world.y], GRAB_PX / api.viewport.scale, o.picked()) : null
      if (!n || !hit) {
        o.setPicked(null)
        o.switchTo(e.targetId)
        return
      }
      const inv = invertMatrix(nodeMatrix(n))
      let base = n.paths
      let part: 'p' | 'in' | 'out' = hit.kind === 'segment' ? 'p' : hit.kind
      let pick: PointPick = { sp: hit.sp, i: hit.i }
      if (hit.kind === 'segment') {
        base = insertAnchor(n.paths, hit.sp, hit.i, hit.t)
        pick = { sp: hit.sp, i: hit.i + 1 }
        part = 'p'
      } else if (e.clickCount === 2 && hit.kind === 'p') {
        o.setPicked(pick)
        api.update((s) => ({ ...s, nodes: s.nodes.map((x) => (x.id === n.id ? withPaths(n, toggleSmooth(n.paths, pick.sp, pick.i)) : x)) }))
        return
      }
      o.setPicked(pick)
      const show = (paths: SubPath[]) => api.preview((s) => ({ ...s, nodes: s.nodes.map((x) => (x.id === n.id ? withPaths(n, paths) : x)) }))
      if (hit.kind === 'segment') show(base)
      let moved = hit.kind === 'segment'
      const start = hit.q
      return {
        move(m) {
          const q = applyMatrix(inv, [m.world.x, m.world.y])
          if (!moved && Math.hypot(q[0] - start[0], q[1] - start[1]) * api.viewport.scale < 3) return
          moved = true
          show(dragPart(base, pick.sp, pick.i, part, q, m.alt))
        },
        up() {
          if (moved) api.commitPreview()
          else api.preview(null)
        },
        cancel: () => api.preview(null),
      }
    },
    keyDown(e, api) {
      if (e.key === 'Delete' || e.key === 'Backspace') return removePicked(api)
      if (e.key === 'Escape') {
        e.preventDefault()
        o.switchTo(null)
        return true
      }
      return false
    },
  }
}

// ---------- shape builder ----------

let probe: CanvasRenderingContext2D | null = null
/** Is the point inside a piece? Uses the browser's own path test. */
function inside(paths: SubPath[], [x, y]: XY) {
  probe ??= document.createElement('canvas').getContext('2d')
  return !!probe?.isPointInPath(new Path2D(pathD(paths)), x, y)
}

export function shapeBuilderTool(o: { shapes(api: Api): PaintNode[]; onError(msg: string): void }): CanvasTool<VectorNode> {
  let cache: { key: string; stack: PaintNode[]; pieces: Piece[] } | null = null
  const piecesFor = (api: Api) => {
    const stack = o.shapes(api)
    const key = stack.map((n) => JSON.stringify(n)).join('|')
    if (cache?.key !== key) {
      try {
        cache = { key, stack, pieces: stack.length ? regions(stack.map(geomOf)) : [] }
      } catch (err) {
        o.onError((err as Error).message)
        cache = { key, stack, pieces: [] }
      }
    }
    return cache
  }
  const at = (c: ReturnType<typeof piecesFor>, w: XY) => {
    // Front-most first, so a small piece on top wins.
    for (let i = c.pieces.length - 1; i >= 0; i--) if (inside(c.pieces[i].paths, w)) return i
    return -1
  }
  const mark = (api: Api, c: ReturnType<typeof piecesFor>, hits: number[], remove: boolean) =>
    api.setDraft(hits.length ? hits.map((i) => ({ ...pathNode(api.activeLayerId, c.pieces[i].paths, { fillColor: remove ? '#fa5252' : '#4dabf7', opacity: 0.55, strokeColor: '#ffffff', strokeWidth: 1.5 / api.viewport.scale, strokeDash: true }), x: 0, y: 0, paths: c.pieces[i].paths })) : null)
  return {
    id: 'builder',
    label: 'Shape builder (M): drag across pieces to join them, hold Alt to remove them',
    icon: Combine,
    shortcut: 'M',
    cursor: 'crosshair',
    hover(e, api) {
      if (!e) return api.setDraft(null)
      const c = piecesFor(api)
      const i = at(c, [e.world.x, e.world.y])
      mark(api, c, i < 0 ? [] : [i], e.alt)
    },
    pointerDown(e, api) {
      if (e.button !== 0) return
      const c = piecesFor(api)
      const hits = new Set<number>()
      const add = (m: ToolPointerEvent) => {
        const i = at(c, [m.world.x, m.world.y])
        if (i >= 0) hits.add(i)
        mark(api, c, [...hits], m.alt)
      }
      add(e)
      return {
        move: add,
        up(m) {
          api.setDraft(null)
          if (!hits.size || !c.stack.length) return
          const layerId = c.stack[c.stack.length - 1].layerId
          const lookFor = (p: Piece) => lookOf(c.stack[p.sources[p.sources.length - 1]] ?? c.stack[0])
          const kept = c.pieces.flatMap((p, i) => (hits.has(i) ? [] : [pathNode(layerId, p.paths, { ...lookFor(p), name: 'Piece' })]))
          const made: PathNode[] = []
          if (!m.alt) {
            const picked = [...hits].map((i) => c.pieces[i])
            try {
              const joined = picked.length > 1 ? combine('unite', picked.map((p) => ({ d: pathD(p.paths) })))[0] : picked[0]
              if (joined) made.push(pathNode(layerId, joined.paths, { ...lookFor(picked[0]), name: 'Joined piece' }))
            } catch (err) {
              return o.onError((err as Error).message)
            }
          }
          const at0 = api.scene.nodes.findIndex((n) => n.id === c.stack[0].id)
          api.update((s) => {
            const rest = deleteNodes(s, c.stack.map((n) => n.id))
            const nodes = [...rest.nodes]
            nodes.splice(Math.min(at0, nodes.length), 0, ...kept, ...made)
            return { ...rest, nodes }
          })
          api.select(made.map((n) => n.id))
          cache = null
        },
        cancel: () => api.setDraft(null),
      }
    },
    deactivate(api) {
      api.setDraft(null)
      cache = null
    },
  }
}
