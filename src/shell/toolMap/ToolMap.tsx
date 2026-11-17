import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType } from '@/core/model'
import { buildReferenceIndex, type ReferenceIndex } from '@/core/references'
import { getManifest } from '@/core/registry'
import { formatCombo, isShortcut, keysOf } from '@/core/shortcuts'
import { allEntities, flushAll, isTextField, useProjectStore, useSettings } from '@/core/state'
import { jumpTo } from '@/shared/entityList/navigation'
import { IMAGE_TARGETS } from '../editor/actions'
import { shownTool } from '../editor/optionalTools'
import { leaves } from '../workspace/layoutTree'
import { bendEdges, edgePath, groupTools, layoutMap, mapEdges, neighbourIn, type MapEdge } from './graph'
import { closeToolMap, openToolMap, useToolMap } from './open'
import './toolmap.css'

/**
 * The Tool map: Tab (when not typing) shows every tool of the project as a bubble, grouped like the
 * sidebar, with lines for the links between them. Click a bubble to go there; Tab or Esc closes it.
 */
export function ToolMapHost() {
  const open = useToolMap((s) => s.open)
  useEffect(() => {
    // Bubble phase and after the tools: whoever uses Tab itself (a spreadsheet cell, a text field) keeps it.
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !isShortcut(e, 'app.map')) return
      if (useToolMap.getState().open) {
        e.preventDefault()
        return closeToolMap()
      }
      const el = e.target as HTMLElement | null
      if (e.defaultPrevented || isTextField(el) || el?.tagName === 'SELECT') return
      // Inside dialogs, menus and the search, Tab keeps walking through the buttons.
      if (document.querySelector('.modal-backdrop, .palette-backdrop') || el?.closest?.('.menu, [role="dialog"], [role="menu"]')) return
      e.preventDefault()
      openToolMap()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Another project, or back to the start screen: never leave the map (and the missing active panel) behind.
  useEffect(() => closeToolMap, [])
  return open ? <ToolMap /> : null
}

const ROUTES_KEY = 'egd.toolmap.routes'
const NODE_W = 124
const BUBBLE = 64

function ToolMap() {
  const meta = useProjectStore((s) => s.meta)
  const root = useProjectStore((s) => s.root)
  const entities = useProjectStore((s) => s.entities)
  const askProject = useSettings((s) => s.askProject)
  const herePanel = useToolMap((s) => s.panel)
  const [index, setIndex] = useState<ReferenceIndex>()
  const [hot, setHot] = useState<ComponentType | null>(null)
  const [routes, setRoutes] = useState(() => {
    try {
      return localStorage.getItem(ROUTES_KEY) !== '0'
    } catch {
      return true
    }
  })
  const buttons = useRef(new Map<ComponentType, HTMLButtonElement>())
  const cameFrom = useRef(document.activeElement as HTMLElement | null)

  const panels = useMemo(() => leaves(meta?.layout ?? null), [meta?.layout])
  const here = panels.find((p) => p.id === herePanel) ?? null
  const shown = useMemo(() => (meta?.enabledComponents ?? []).filter((t) => getManifest(t) && shownTool(t, askProject)), [meta?.enabledComponents, askProject])
  const layout = useMemo(() => layoutMap(groupTools(meta ?? {}, shown)), [meta, shown])
  const edges = useMemo(
    () => (meta ? mapEdges(shown, meta, allEntities(entities), IMAGE_TARGETS.map((t) => t.type), index) : []).filter((e) => routes || e.kind === 'link'),
    [shown, meta, entities, index, routes],
  )

  const bends = useMemo(() => bendEdges(layout.nodes, edges), [layout, edges])

  // The mentions need every file read once; the bubbles and the other lines do not wait for that.
  useEffect(() => {
    let gone = false
    if (root)
      void flushAll(root)
        .then(() => buildReferenceIndex(root))
        .then((i) => !gone && setIndex(i))
        .catch(() => {}) // the map works without the mention lines
    return () => void (gone = true)
  }, [root])

  // ---- View: pan and zoom ----
  const [view, setView] = useState(() => {
    const { x, y, w, h } = layout.bounds
    const fit = Math.min(window.innerWidth / (w + 60), (window.innerHeight - 150) / (h + 60))
    const k = Math.min(1, Math.max(0.55, fit))
    // Everything fits: show it all. Too big: start at "You are here".
    const c = (fit < 0.55 && here && layout.nodes.get(here.type)) || { x: x + w / 2, y: y + h / 2 }
    return { x: window.innerWidth / 2 - c.x * k, y: window.innerHeight / 2 - c.y * k + 8, k }
  })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const zoom = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      const k = Math.min(2, Math.max(0.3, v.k * factor))
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k }
    })
  const bringIntoView = (t: ComponentType) =>
    setView((v) => {
      const p = layout.nodes.get(t)
      if (!p) return v
      const sx = v.x + p.x * v.k
      const sy = v.y + p.y * v.k
      const inside = sx > 70 && sx < window.innerWidth - 70 && sy > 90 && sy < window.innerHeight - 130
      return inside ? v : { ...v, x: window.innerWidth / 2 - p.x * v.k, y: window.innerHeight / 2 - p.y * v.k }
    })

  const focusTool = (t: ComponentType | null | undefined) => {
    if (!t) return
    bringIntoView(t)
    buttons.current.get(t)?.focus({ preventScroll: true })
  }
  useEffect(() => {
    focusTool(here && layout.nodes.has(here.type) ? here.type : shown[0])
    const from = cameFrom.current
    return () => from?.focus?.({ preventScroll: true })
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only when the map opens
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault() // keep Esc from toggling Layout Mode (ED-7)
      closeToolMap()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!meta) return null

  const go = (type: ComponentType, beside: boolean) => {
    cameFrom.current = null
    closeToolMap() // the old panel is active again, so the jump knows where Back leads
    if (here?.type === type && !beside) return
    jumpTo({ kind: 'document', type, documentId: null }, !beside)
  }

  const nameOf = (t: ComponentType) => getManifest(t)?.name ?? t
  const other = (e: MapEdge, t: ComponentType) => (e.a === t ? e.b : e.a)
  const edgesOf = (t: ComponentType) => edges.filter((e) => e.a === t || e.b === t)
  // Pointing at a linked tool fades the rest; a tool without links leaves the map as it is.
  const near = hot ? new Set(edgesOf(hot).map((e) => other(e, hot))) : null
  const fading = !!near?.size
  const told = hot ?? here?.type ?? null
  const toldLinks = told ? edgesOf(told) : []
  const list = (kind: MapEdge['kind'], withWhy: boolean) =>
    toldLinks
      .filter((e) => e.kind === kind)
      .map((e) => (withWhy ? `${nameOf(other(e, told!))} (${e.why})` : nameOf(other(e, told!))))
      .join(', ')
  const key = keysOf('app.map')[0]

  return (
    <div
      className="toolmap"
      role="dialog"
      aria-modal="true"
      aria-label="Tool map"
      onWheel={(e) => zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY)}
      onPointerDown={(e) => {
        if ((e.target as Element).closest('button, label')) return
        drag.current = { x: e.clientX - view.x, y: e.clientY - view.y }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => drag.current && setView((v) => ({ ...v, x: e.clientX - drag.current!.x, y: e.clientY - drag.current!.y }))}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e) => {
        const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key]
        const at = [...buttons.current].find(([, b]) => b === document.activeElement)?.[0]
        if (dir) {
          e.preventDefault()
          const to = at ? neighbourIn(layout.nodes, at, dir[0], dir[1]) : shown[0]
          focusTool(to)
          if (to) setHot(to) // show its links, like pointing at it
        } else if (e.key === 'Home') {
          e.preventDefault()
          focusTool(here?.type)
        } else if (e.key === 'Enter' && e.shiftKey && at) {
          e.preventDefault()
          go(at, true)
        }
      }}
    >
      <div className="tm-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="tm-lines" style={{ left: layout.bounds.x, top: layout.bounds.y }} width={layout.bounds.w} height={layout.bounds.h} viewBox={`${layout.bounds.x} ${layout.bounds.y} ${layout.bounds.w} ${layout.bounds.h}`} aria-hidden="true">
          {layout.groups.map((g) => (
            <g key={g.id}>
              <circle className="tm-group" cx={g.x} cy={g.y} r={g.r - 8} />
              {g.name && (
                <text className="tm-group-name" x={g.x} y={g.y - g.r + 18} textAnchor="middle">
                  {g.name}
                </text>
              )}
            </g>
          ))}
          {edges.map((e, i) => {
            const a = layout.nodes.get(e.a)!
            const b = layout.nodes.get(e.b)!
            const lit = hot && (e.a === hot || e.b === hot)
            // Bowed, each to the side where it crosses the fewest lines and bubbles.
            const bow = edgePath(a, b, bends[i])
            return (
              <path key={`${e.kind}:${e.a}:${e.b}`} className={`tm-edge ${e.kind}${lit ? ' on' : fading ? ' dim' : ''}`} d={bow} strokeWidth={e.kind === 'link' ? 1.6 + Math.min(e.count, 8) * 0.4 : 1.2}>
                <title>{`${nameOf(e.a)} and ${nameOf(e.b)}: ${e.why}`}</title>
              </path>
            )
          })}
        </svg>
        {shown.map((t) => {
          const m = getManifest(t)!
          const p = layout.nodes.get(t)!
          const docs = m.multiDocument ? meta.documents.filter((d) => d.type === t).length : 0
          const isHere = here?.type === t
          const isOpen = !isHere && panels.some((x) => x.type === t)
          const mine = edgesOf(t)
          const names = (kind: MapEdge['kind']) => mine.filter((e) => e.kind === kind).map((e) => nameOf(other(e, t))).join(', ')
          const label = [m.name, docs > 1 && `${docs} documents`, isHere && 'you are here', isOpen && 'open', names('link') && `linked with ${names('link')}`, names('route') && `works with ${names('route')}`].filter(Boolean).join(', ')
          const color = meta.toolColors?.[t]
          return (
            <button
              key={t}
              ref={(el) => void (el ? buttons.current.set(t, el) : buttons.current.delete(t))}
              className={`tm-node${isHere ? ' here' : ''}${fading && hot !== t && !near!.has(t) ? ' dim' : ''}`}
              style={{ left: p.x - NODE_W / 2, top: p.y - BUBBLE / 2, width: NODE_W, ...(color ? { ['--tool-color' as string]: color } : {}) }}
              aria-label={label}
              aria-current={isHere ? 'location' : undefined}
              title={`${m.description}\nClick to go there, Shift+click to open it next to the others.`}
              onClick={(e) => go(t, e.shiftKey)}
              onMouseEnter={() => setHot(t)}
              onMouseLeave={() => setHot(null)}
              onBlur={() => setHot(null)}
            >
              <span className="tm-bubble">
                <m.icon size={26} />
                {isOpen && <span className="tm-open" />}
                {docs > 1 && <span className="tm-count">{docs}</span>}
              </span>
              <span className="tm-name">{m.name}</span>
              {isHere && <span className="tm-here">You are here</span>}
            </button>
          )
        })}
      </div>

      <div className="tm-bar tm-top">
        <strong>Tool map</strong>
        <span className="tm-legend">
          <i className="tm-key link" /> your links
        </span>
        <label className="tm-legend" title="Dotted lines: where the app can send things, even if you never did">
          <input
            type="checkbox"
            checked={routes}
            onChange={(e) => {
              setRoutes(e.target.checked)
              try {
                localStorage.setItem(ROUTES_KEY, e.target.checked ? '1' : '0')
              } catch {
                // only a convenience
              }
            }}
          />
          <i className="tm-key route" /> works together
        </label>
        <button className="icon-btn" title={`Close (${key ? `${formatCombo(key)} or ` : ''}Esc)`} aria-label="Close the tool map" onClick={closeToolMap}>
          <X size={16} />
        </button>
      </div>

      <div className="tm-bar tm-bottom">
        <div className="tm-told" aria-live="polite">
          {told ? (
            <>
              <strong>{nameOf(told)}</strong>
              {list('link', true) && <span>Linked with {list('link', true)}</span>}
              {list('route', false) && <span>Works with {list('route', false)}</span>}
              {!toldLinks.length && <span>No links yet. Jump points and [[links]] you make show up here as lines.</span>}
            </>
          ) : (
            <span>Point at a tool to see what it is linked with.</span>
          )}
        </div>
        <div className="tm-hint">Click to go there · Shift+click opens it next to the others · Arrow keys move · Drag and scroll to look around · {key ? `${formatCombo(key)} or ` : ''}Esc closes</div>
      </div>
    </div>
  )
}
