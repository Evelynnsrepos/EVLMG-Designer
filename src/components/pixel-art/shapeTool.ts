import { useRef, useState } from 'react'
import { encode } from '@/shared/pixel/codec'
import { celKey, resolveKey, type PixelDoc } from '@/shared/pixel/model'
import { drawShapes, fillInBetweens, hitShape, newShape, type Ease, type ShapeCel, type VPoint, type VShape } from '@/shared/pixel/shapes'

type Pt = [number, number]
type Update = (fn: (x: PixelDoc) => PixelDoc, options?: { undoable?: boolean }) => void

/** The doc with `list` as the shapes of cel `key`, and the cel's pixels drawn from them. */
export function withShapes(x: PixelDoc, key: string, list: VShape[], isKey = true): PixelDoc {
  const cels = { ...x.cels }
  const url = list.length ? encode(drawShapes(list, x.width, x.height)) : null
  if (url) cels[key] = url
  else delete cels[key]
  return { ...x, cels, shapes: { ...x.shapes, [key]: { key: isKey, list } } }
}

/** Frames of a shape layer, in order, with their shapes (for in-betweens). */
const layerCels = (x: PixelDoc, layerId: string): (ShapeCel | undefined)[] => x.frames.map((f) => x.shapes?.[resolveKey(x.cels, celKey(layerId, f.id))])

/** Every frame between keys of this layer gets the tweened shapes, in one undo step. */
export function withInBetweens(x: PixelDoc, layerId: string, ease: Ease): PixelDoc {
  let out = x
  for (const [i, c] of fillInBetweens(layerCels(x, layerId), ease)) {
    const key = resolveKey(x.cels, celKey(layerId, x.frames[i].id))
    // Linked frames show another frame's pixels; leave those alone.
    if (key !== celKey(layerId, x.frames[i].id)) continue
    out = withShapes(out, key, c.list, false)
  }
  return out
}

export interface ShapeToolHost {
  d: PixelDoc
  update: Update
  /** The cel being edited ("layerId:frameId"), already resolved through links. */
  celKey: string
  /** Main and second colour. */
  colors: [string, string]
  size: number
  /** How many pixels the pointer may miss a point by (about 6 screen px). */
  reach: number
}

/**
 * The Shape tool on a shape layer. Click to add points (click the first point to close, Enter to finish
 * an open line, Esc to cancel); drag a point to move it, drag inside a shape to move the whole shape;
 * double-click an edge to add a point; Delete removes the selected point (or the shape).
 * Drags are one undo step each: transient while moving, then one undoable change on release.
 */
export function useShapeTool(h: ShapeToolHost) {
  const list = h.d.shapes?.[h.celKey]?.list ?? []
  const [sel, setSel] = useState<{ id: string; point: number | null } | null>(null)
  const [pen, setPen] = useState<VPoint[] | null>(null)
  const drag = useRef<{ start: PixelDoc; id: string; point: number | null; from: VPoint; orig: VShape; moved: boolean } | null>(null)
  const lastClick = useRef(0)

  const selected = sel ? list.find((s) => s.id === sel.id) : undefined
  const write = (next: VShape[], undoable = true) => h.update((x) => withShapes(x, h.celKey, next), { undoable })
  const change = (id: string, patch: Partial<VShape>) => write(list.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const add = (s: VShape) => {
    write([...list, s])
    setSel({ id: s.id, point: null })
  }

  const finishPen = (closed: boolean) => {
    if (pen && pen.length >= 2) add(newShape(pen, closed && pen.length >= 3, { strokeColor: h.colors[0], width: h.size }))
    setPen(null)
  }

  const down = (p: Pt) => {
    const q = { x: p[0], y: p[1] }
    const now = Date.now()
    const double = now - lastClick.current < 350
    lastClick.current = now
    if (pen) {
      if (pen.length >= 3 && Math.hypot(q.x - pen[0].x, q.y - pen[0].y) <= h.reach) return finishPen(true)
      return setPen([...pen, q])
    }
    const hit = hitShape(list, q, h.reach)
    if (!hit) {
      setSel(null)
      return setPen([q])
    }
    const s = list[hit.shape]
    if ('edge' in hit) {
      if (!double) return setSel({ id: s.id, point: null })
      // Double-click on an edge: a new point there, ready to drag.
      const points = [...s.points.slice(0, hit.edge + 1), q, ...s.points.slice(hit.edge + 1)]
      write(list.map((x) => (x.id === s.id ? { ...x, points } : x)))
      setSel({ id: s.id, point: hit.edge + 1 })
      return
    }
    const point = 'point' in hit ? hit.point : null
    setSel({ id: s.id, point })
    drag.current = { start: h.d, id: s.id, point, from: q, orig: s, moved: false }
  }

  const move = (p: Pt) => {
    const g = drag.current
    if (!g) return
    const [dx, dy] = [p[0] - g.from.x, p[1] - g.from.y]
    if (!dx && !dy && !g.moved) return
    g.moved = true
    const points = g.point === null ? g.orig.points.map((q) => ({ x: q.x + dx, y: q.y + dy })) : g.orig.points.map((q, i) => (i === g.point ? { x: p[0], y: p[1] } : q))
    write(list.map((s) => (s.id === g.id ? { ...s, points } : s)), false)
  }

  const up = () => {
    const g = drag.current
    drag.current = null
    if (!g?.moved) return
    // Back to how it was, then the result as one undoable change.
    const end = h.d.shapes?.[h.celKey]?.list ?? []
    h.update(() => g.start, { undoable: false })
    h.update((x) => withShapes(x, h.celKey, end))
  }

  /** Keys while the Shape tool is active; true = handled. */
  const key = (e: KeyboardEvent): boolean => {
    if (pen && e.key === 'Escape') return (setPen(null), true)
    if (pen && e.key === 'Enter') return (finishPen(false), true)
    if (selected && (e.key === 'Delete' || e.key === 'Backspace')) {
      if (sel?.point != null && selected.points.length > 2) {
        change(selected.id, { points: selected.points.filter((_, i) => i !== sel.point), closed: selected.closed && selected.points.length > 3 })
        setSel({ id: selected.id, point: null })
      } else {
        write(list.filter((s) => s.id !== selected.id))
        setSel(null)
      }
      return true
    }
    if (selected && e.key === 'Escape') return (setSel(null), true)
    return false
  }

  /** The bucket on a shape layer: the shape under the pointer gets the colour as its fill (null = no fill). */
  const fillAt = (p: Pt, color: string | null): boolean => {
    const hit = hitShape(list, { x: p[0], y: p[1] }, 0.5)
    if (!hit || !list[hit.shape].closed) return false
    change(list[hit.shape].id, { fillColor: color ?? undefined })
    setSel({ id: list[hit.shape].id, point: null })
    return true
  }

  /** Points, the selected shape's outline and the line being drawn, on the overlay (`s` = screen px per pixel). */
  const overlay = (g: CanvasRenderingContext2D, s: number) => {
    const at = (q: VPoint) => [(q.x + 0.5) * s, (q.y + 0.5) * s] as const
    const dot = (q: VPoint, on: boolean) => {
      const [x, y] = at(q)
      g.fillStyle = on ? '#4dabf7' : '#fff'
      g.strokeStyle = '#000'
      g.lineWidth = 1
      g.fillRect(x - 3.5, y - 3.5, 7, 7)
      g.strokeRect(x - 3.5, y - 3.5, 7, 7)
    }
    for (const sh of list) {
      g.beginPath()
      sh.points.forEach((q, i) => (i ? g.lineTo(...at(q)) : g.moveTo(...at(q))))
      if (sh.closed) g.closePath()
      g.strokeStyle = sh.id === sel?.id ? 'rgba(77,171,247,0.9)' : 'rgba(255,255,255,0.45)'
      g.setLineDash(sh.id === sel?.id ? [] : [3, 3])
      g.stroke()
      g.setLineDash([])
      sh.points.forEach((q, i) => dot(q, sh.id === sel?.id && sel.point === i))
    }
    if (pen) {
      g.beginPath()
      pen.forEach((q, i) => (i ? g.lineTo(...at(q)) : g.moveTo(...at(q))))
      g.strokeStyle = '#4dabf7'
      g.stroke()
      pen.forEach((q) => dot(q, false))
    }
  }

  return { list, selected, sel, setSel, pen, add, change, write, down, move, up, key, fillAt, overlay, cancel: () => setPen(null) }
}
