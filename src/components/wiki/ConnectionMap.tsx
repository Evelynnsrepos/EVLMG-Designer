import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import type { Id } from '@/core/model'
import { bounds, layoutGraph, type Point } from './graph'
import { zoomOf } from '@/shared/zoom'

const UI = {
  empty: 'No articles yet. Create some and link them with [[ to see the map.',
  hint: 'Drag to pan, scroll to zoom, click a dot to open the article.',
  label: 'Connection map',
}

/** Last layout, so dots stay put when an article is added or linked (there is one wiki per project). */
const lastLayout = new Map<Id, Point>()

function layoutFrom(ids: Id[], edges: [Id, Id][]) {
  const pos = layoutGraph(ids, edges, lastLayout)
  lastLayout.clear()
  for (const [id, p] of pos) lastLayout.set(id, p)
  return pos
}

interface MapNode {
  id: Id
  title: string
}

/** WK-5: articles as dots, mentions as lines (like Obsidian's graph view). */
export function ConnectionMap({ nodes, edges, selectedId, onOpen }: { nodes: MapNode[]; edges: [Id, Id][]; selectedId: Id | null; onOpen: (id: Id) => void }) {
  const positions = useMemo(
    () =>
      layoutFrom(
        nodes.map((n) => n.id),
        edges,
      ),
    [nodes, edges],
  )

  const degree = useMemo(() => {
    const d = new Map<Id, number>()
    for (const [a, b] of edges) {
      d.set(a, (d.get(a) ?? 0) + 1)
      d.set(b, (d.get(b) ?? 0) + 1)
    }
    return d
  }, [edges])

  const fit = useMemo(() => bounds(positions.values()), [positions])
  const [view, setView] = useState<{ x: number; y: number; scale: number } | null>(null)
  const [hover, setHover] = useState<Id | null>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 600, h: 400 })
  const isEmpty = nodes.length === 0
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isEmpty])

  if (isEmpty) return <div className="wiki-map-empty">{UI.empty}</div>

  const v = view ?? { x: 0, y: 0, scale: 1 }
  // Map units per screen pixel: fit everything, then apply the user's zoom. Dots and labels are sized in pixels.
  const ui = Math.max(fit.w / size.w, fit.h / size.h, 0.5) / v.scale
  const w = size.w * ui
  const h = size.h * ui
  const cx = fit.x + fit.w / 2 + v.x
  const cy = fit.y + fit.h / 2 + v.y
  const viewBox = `${cx - w / 2} ${cy - h / 2} ${w} ${h}`
  const unitsPerPx = () => ui

  const onWheel = (e: WheelEvent) => {
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setView({ ...v, scale: Math.min(8, Math.max(0.2, v.scale * factor)) })
  }
  const onPointerDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 3) return
    d.moved = true
    const k = unitsPerPx() / zoomOf(e.currentTarget as Element)
    setView({ ...v, x: v.x - dx * k, y: v.y - dy * k })
    d.x = e.clientX
    d.y = e.clientY
  }
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved) {
      const id = (e.target as Element).closest('[data-node]')?.getAttribute('data-node')
      if (id) onOpen(id)
    }
  }

  const near = (id: Id) => hover !== null && (id === hover || edges.some(([a, b]) => (a === hover && b === id) || (b === hover && a === id)))

  return (
    <div className="wiki-map">
      <svg
        ref={svg}
        className="wiki-map-svg"
        viewBox={viewBox}
        role="img"
        aria-label={UI.label}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => setView(null)}
      >
        <g className="wiki-map-edges">
          {edges.map(([a, b]) => {
            const p = positions.get(a)
            const q = positions.get(b)
            if (!p || !q) return null
            const lit = hover !== null && (a === hover || b === hover)
            return <line key={`${a}|${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={lit ? 'is-lit' : undefined} />
          })}
        </g>
        {nodes.map((n) => {
          const p = positions.get(n.id)
          if (!p) return null
          const r = (6 + Math.min(10, Math.sqrt(degree.get(n.id) ?? 0) * 3)) * ui
          const cls = ['wiki-map-node', n.id === selectedId && 'is-selected', hover && !near(n.id) && 'is-dim'].filter(Boolean).join(' ')
          return (
            <g
              key={n.id}
              data-node={n.id}
              className={cls}
              transform={`translate(${p.x} ${p.y})`}
              onPointerEnter={() => setHover(n.id)}
              onPointerLeave={() => setHover(null)}
            >
              <circle r={r} />
              <text y={r + 13 * ui} fontSize={12 * ui}>
                {n.title}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="wiki-map-hint">{UI.hint}</div>
    </div>
  )
}
