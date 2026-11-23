import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType } from '@/core/model'
import { buildReferenceIndex, type ReferenceIndex, type ReferenceSource } from '@/core/references'
import type { Id } from '@/core/model'
import { localized, useLang } from '@/shared/i18n'
import { getManifest } from '@/core/registry'
import { formatCombo, isShortcut, keysOf } from '@/core/shortcuts'
import { allEntities, flushAll, isTextField, useProjectStore, useSettings } from '@/core/state'
import { jumpTo } from '@/shared/entityList/navigation'
import { IMAGE_TARGETS } from '../editor/actions'
import { shownTool } from '../editor/optionalTools'
import { leaves } from '../workspace/layoutTree'
import { bendEdges, DEFAULT_BEND, edgePath, groupTools, layoutMap, mapEdges, neighbourIn, nodeKey, toolNodes, type MapEdge, type MapNode, type Point } from './graph'
import { closeToolMap, openToolMap, quietFocus, useToolMap } from './open'
import './toolmap.css'

const UI_EN = {
  title: 'Tool map',
  close: 'Close the tool map',
  closeTip: (k: string) => `Close (${k}Esc)`,
  yourLinks: 'your links',
  together: 'works together',
  togetherTip: 'Dotted lines: where the app can send things, even if you never did; shown for the bubble you point at',
  filter: 'Find a bubble…',
  filterTip: 'Type to find a bubble by name; Enter goes to the first one',
  noMatch: 'Nothing on the map has that name.',
  empty: 'No tools yet. Add one with Add tool in the sidebar.',
  starred: 'Starred',
  rest: 'Other tools',
  untitled: 'Untitled',
  here: 'You are here',
  hereA11y: 'you are here',
  openA11y: 'open',
  linkedA11y: (s: string) => `linked with ${s}`,
  worksA11y: (s: string) => `works with ${s}`,
  linkedWith: (s: string) => `Linked with ${s}`,
  noLinks: 'No links yet. Jump points and [[links]] you make show up here as lines.',
  pointAt: 'Point at a bubble to see what it is linked with.',
  tapAt: 'Tap a bubble to see what it is linked with, tap it again to go there.',
  bubbleTip: 'Click to go there, Shift+click to open it next to the others.',
  edgeTip: (a: string, b: string, why: string) => `${a} and ${b}: ${why}`,
  hint: (k: string) => `Every drawing, document and tool is a bubble · Click to go there · Shift+click opens it next to the others · Arrows move · Type to find · Drag and scroll to look around · ${k}Esc closes`,
  touchHint: 'Tap once to see the links, twice to go there · Pinch to zoom, drag to look around',
  or: (k: string) => `${k} or `,
  why: (why: string) => why,
}

/** German (review: Evelynn). Terms: docs/GERMAN-TERMS.md. */
const WHY_DE: Record<string, string> = { 'Send to': 'Senden an', Tilesets: 'Kachelsets', Frames: 'Bilder', Slides: 'Folien', Script: 'Drehbuch', Pictures: 'Bilder', Tasks: 'Aufgaben', Articles: 'Artikel' }
const COUNT_DE: Record<string, [string, string]> = { 'jump point': ['Sprungpunkt', 'Sprungpunkte'], connection: ['Verbindung', 'Verbindungen'], mention: ['Erwähnung', 'Erwähnungen'] }
const UI_DE: Partial<typeof UI_EN> = {
  title: 'Werkzeugkarte',
  close: 'Werkzeugkarte schließen',
  closeTip: (k) => `Schließen (${k}Esc)`,
  yourLinks: 'deine Verknüpfungen',
  together: 'arbeiten zusammen',
  togetherTip: 'Gepunktete Linien: wohin die App Dinge senden kann, auch wenn du es noch nie getan hast; nur für die Blase, auf die du zeigst',
  filter: 'Blase finden…',
  filterTip: 'Tippe, um eine Blase am Namen zu finden; Enter geht zur ersten',
  noMatch: 'Nichts auf der Karte hat diesen Namen.',
  empty: 'Noch keine Werkzeuge. Füge eins mit Werkzeug hinzufügen in der Seitenleiste hinzu.',
  starred: 'Mit Stern',
  rest: 'Weitere Werkzeuge',
  untitled: 'Ohne Titel',
  here: 'Du bist hier',
  hereA11y: 'du bist hier',
  openA11y: 'offen',
  linkedA11y: (s) => `verknüpft mit ${s}`,
  worksA11y: (s) => `arbeitet mit ${s}`,
  linkedWith: (s) => `Verknüpft mit ${s}`,
  noLinks: 'Noch keine Verknüpfungen. Sprungpunkte und [[Links]], die du machst, erscheinen hier als Linien.',
  pointAt: 'Zeig auf eine Blase, um zu sehen, womit sie verknüpft ist.',
  tapAt: 'Tippe auf eine Blase, um ihre Verknüpfungen zu sehen, tippe nochmal, um hinzugehen.',
  bubbleTip: 'Klicken, um hinzugehen, Umschalt+Klick öffnet es neben den anderen.',
  edgeTip: (a, b, why) => `${a} und ${b}: ${why}`,
  hint: (k) => `Jede Zeichnung, jedes Dokument und jedes Werkzeug ist eine Blase · Klicken, um hinzugehen · Umschalt+Klick öffnet es neben den anderen · Pfeiltasten bewegen · Tippen zum Finden · Ziehen und Scrollen zum Umsehen · ${k}Esc schließt`,
  touchHint: 'Einmal tippen zeigt die Verknüpfungen, zweimal geht hin · Mit zwei Fingern zoomen, ziehen zum Umsehen',
  or: (k) => `${k} oder `,
  why: (why) =>
    why
      .split(', ')
      .map((w) => WHY_DE[w] ?? w.replace(/^(\d+) (jump point|connection|mention)s?$/, (_, n: string, one: string) => `${n} ${COUNT_DE[one][n === '1' ? 0 : 1]}`))
      .join(', '),
}
const UI = localized(UI_EN, UI_DE)

/** Pointers that are not the mouse: their first tap on a bubble shows its links instead of going there. */
const isTouchLike = (t: string | null) => t === 'touch' || t === 'pen'

/**
 * The Tool map: Tab (when not typing) shows every tool of the project, and every document of a tool
 * (each drawing, each Writer document), as a bubble, grouped like the sidebar, with lines for the links
 * between them. Click a bubble to go there; Tab or Esc closes it.
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
      // Someone walking through the buttons with the keyboard keeps Tab for that (a mouse click on a button does not count).
      if (el && el !== quietFocus.el && el.matches?.(':focus-visible') && el.matches('button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"]')) return
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
/** How near (in map pixels) the cursor has to be for a bubble to lean toward it. */
const REACH = 260
const BUBBLE = 64

function ToolMap() {
  useLang() // texts follow a language switch
  const meta = useProjectStore((s) => s.meta)
  const root = useProjectStore((s) => s.root)
  const entities = useProjectStore((s) => s.entities)
  const askProject = useSettings((s) => s.askProject)
  const herePanel = useToolMap((s) => s.panel)
  const paths = useRef<(SVGPathElement | null)[]>([])
  const [index, setIndex] = useState<{ refs: ReferenceIndex; owned: Map<Id, ReferenceSource> }>()
  const [query, setQuery] = useState('')
  const filterBox = useRef<HTMLInputElement>(null)
  /** What the last pointer was, so a tap can show links first; null for the keyboard. */
  const pointer = useRef<string | null>(null)
  const touches = useRef(new Map<number, Point>())
  const pinch = useRef<number | null>(null)
  /** The bubble a first tap showed; tapping it again goes there. */
  const tapped = useRef<string | null>(null)
  const [hot, setHot] = useState<string | null>(null)
  const [routes, setRoutes] = useState(() => {
    try {
      return localStorage.getItem(ROUTES_KEY) !== '0'
    } catch {
      return true
    }
  })
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const cameFrom = useRef(document.activeElement as HTMLElement | null)

  const panels = useMemo(() => leaves(meta?.layout ?? null), [meta?.layout])
  const here = panels.find((p) => p.id === herePanel) ?? null
  const hereKey = here ? nodeKey(here.type, here.documentId) : null
  const shown = useMemo(() => (meta?.enabledComponents ?? []).filter((t) => getManifest(t) && shownTool(t, askProject)), [meta?.enabledComponents, askProject])
  const { nodes, byKey, layout } = useMemo(() => {
    const docs = meta?.documents ?? []
    const perTool = new Map(shown.map((t) => [t, toolNodes(t, !!getManifest(t)?.multiDocument, docs, UI.untitled)]))
    const groups = groupTools(meta ?? {}, shown).map((g) => ({ ...g, tools: g.tools.flatMap((t) => perTool.get(t as ComponentType)!.map((n) => n.key)) }))
    const nodes = [...perTool.values()].flat()
    return { nodes, byKey: new Map(nodes.map((n) => [n.key, n])), layout: layoutMap(groups) }
  }, [meta, shown])
  const told = hot ?? hereKey
  const links = useMemo(() => (meta ? mapEdges(nodes, meta, allEntities(entities), [], index?.refs, index?.owned, null) : []), [nodes, meta, entities, index])
  const linkBends = useMemo(() => bendEdges(layout.nodes, links), [layout, links])
  // Dotted lines only for the bubble pointed at (else where you are): for every pair they could be thousands.
  const routeEdges = useMemo(
    () => (meta && routes && told ? mapEdges(nodes, meta, [], IMAGE_TARGETS.map((t) => t.type), undefined, undefined, told).filter((e) => e.kind === 'route') : []),
    [nodes, meta, routes, told],
  )
  const edges = useMemo(() => [...links, ...routeEdges], [links, routeEdges])
  const bends = useMemo(() => [...linkBends, ...routeEdges.map(() => DEFAULT_BEND)], [linkBends, routeEdges])
  paths.current.length = edges.length

  // The mentions need every file read once; the bubbles and the other lines do not wait for that.
  useEffect(() => {
    let gone = false
    if (root) {
      const owned = new Map<Id, ReferenceSource>()
      void flushAll(root)
        .then(() => buildReferenceIndex(root, owned))
        .then((refs) => !gone && setIndex({ refs, owned }))
        .catch(() => {}) // the map works without the mention lines
    }
    return () => void (gone = true)
  }, [root])

  // ---- View: pan and zoom ----
  const [view, setView] = useState(() => {
    const { x, y, w, h } = layout.bounds
    const fit = Math.min(window.innerWidth / (w + 60), (window.innerHeight - 150) / (h + 60))
    const k = Math.min(1, Math.max(0.55, fit))
    // Everything fits: show it all. Too big: start at "You are here".
    const c = (fit < 0.55 && hereKey && layout.nodes.get(hereKey)) || { x: x + w / 2, y: y + h / 2 }
    return { x: window.innerWidth / 2 - c.x * k, y: window.innerHeight / 2 - c.y * k + 8, k }
  })
  const drag = useRef<{ x: number; y: number } | null>(null)

  // ---- Alive: the bubbles float a little and lean toward the cursor; their lines follow ----
  /** The cursor in map coordinates; null while it is outside the map. */
  const cursor = useRef<Point | null>(null)
  const viewNow = useRef(view)
  viewNow.current = view
  const offsets = useRef(new Map<string, { x: number; y: number; vx: number; vy: number }>())
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Written straight to the elements, once per frame: React state would redraw the whole map 60 times a second.
    const at = offsets.current // kept across redraws, so a new line or the dotted-lines switch never makes them jump
    for (const n of nodes) if (!at.has(n.key)) at.set(n.key, { x: 0, y: 0, vx: 0, vy: 0 })
    let frame = requestAnimationFrame(function tick(now) {
      nodes.forEach((n, i) => {
        const p = layout.nodes.get(n.key)
        const s = at.get(n.key)
        if (!p || !s) return
        // Where it wants to be: a slow drift of its own, plus a pull toward a near cursor.
        let tx = Math.sin(now / 1700 + i * 1.7) * 3.5
        let ty = Math.cos(now / 2100 + i * 2.3) * 3.5
        const c = cursor.current
        const dist = c ? Math.hypot(c.x - p.x, c.y - p.y) : Infinity
        if (c && dist < REACH) {
          const pull = 0.22 * (1 - dist / REACH) ** 2
          tx += (c.x - p.x) * pull
          ty += (c.y - p.y) * pull
        }
        // A soft spring gets it there, so it overshoots and wiggles a little.
        s.vx = (s.vx + (tx - s.x) * 0.07) * 0.84
        s.vy = (s.vy + (ty - s.y) * 0.07) * 0.84
        s.x += s.vx
        s.y += s.vy
        const el = buttons.current.get(n.key)
        if (el) el.style.transform = `translate(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px)`
      })
      const pos = (k: string) => {
        const p = layout.nodes.get(k)!
        const s = at.get(k)
        return s ? { x: p.x + s.x, y: p.y + s.y } : p
      }
      edges.forEach((e, i) => paths.current[i]?.setAttribute('d', edgePath(pos(e.a), pos(e.b), bends[i])))
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [nodes, layout, edges, bends])
  const zoom = (factor: number, cx: number, cy: number) =>
    setView((v) => {
      const k = Math.min(2, Math.max(0.3, v.k * factor))
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k }
    })
  const bringIntoView = (key: string) =>
    setView((v) => {
      const p = layout.nodes.get(key)
      if (!p) return v
      const sx = v.x + p.x * v.k
      const sy = v.y + p.y * v.k
      const inside = sx > 70 && sx < window.innerWidth - 70 && sy > 90 && sy < window.innerHeight - 130
      return inside ? v : { ...v, x: window.innerWidth / 2 - p.x * v.k, y: window.innerHeight / 2 - p.y * v.k }
    })

  const focusNode = (key: string | null | undefined) => {
    if (!key) return
    bringIntoView(key)
    buttons.current.get(key)?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (!nodes.length) filterBox.current?.focus({ preventScroll: true })
    focusNode(hereKey && layout.nodes.has(hereKey) ? hereKey : nodes[0]?.key)
    const from = cameFrom.current
    return () => {
      // Focus put back by the map is not someone walking through buttons: the next Tab opens the map again.
      quietFocus.el = from
      from?.focus?.({ preventScroll: true })
    }
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

  const go = (n: MapNode, beside: boolean) => {
    if (isTouchLike(pointer.current) && tapped.current !== n.key) {
      // First tap: show its links (a tap also fakes a mouse hover, so `hot` cannot tell).
      tapped.current = n.key
      return setHot(n.key)
    }
    cameFrom.current = null
    closeToolMap() // the old panel is active again, so the jump knows where Back leads
    if (n.key === hereKey && !beside) return
    jumpTo({ kind: 'document', type: n.type, documentId: n.documentId }, !beside)
  }

  /** "Forest concept (Draw)" for a document, "Wiki" for a tool. */
  const nameOf = (key: string) => {
    const n = byKey.get(key)
    const tool = getManifest(n?.type ?? (key as ComponentType))?.name ?? key
    return n?.title ? `${n.title} (${tool})` : tool
  }
  const q = query.trim().toLowerCase()
  const matches = q ? new Set(nodes.filter((n) => nameOf(n.key).toLowerCase().includes(q)).map((n) => n.key)) : null
  const other = (e: MapEdge, k: string) => (e.a === k ? e.b : e.a)
  const edgesOf = (k: string) => edges.filter((e) => e.a === k || e.b === k)
  // Pointing at a linked bubble fades the rest; a bubble without links leaves the map as it is.
  const near = hot ? new Set(edgesOf(hot).map((e) => other(e, hot))) : null
  const fading = !!near?.size
  const toldLinks = told ? edgesOf(told) : []
  const list = (kind: MapEdge['kind'], withWhy: boolean) =>
    toldLinks
      .filter((e) => e.kind === kind)
      .map((e) => (withWhy ? `${nameOf(other(e, told!))} (${UI.why(e.why)})` : nameOf(other(e, told!))))
      .join(', ')
  const key = keysOf('app.map')[0]
  const orKey = key ? UI.or(formatCombo(key)) : ''
  const touchy = isTouchLike(pointer.current) || matchMedia('(hover: none)').matches

  return (
    <div
      className="toolmap"
      role="dialog"
      aria-modal="true"
      aria-label="Tool map"
      onWheel={(e) => zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY)}
      onPointerDown={(e) => {
        pointer.current = e.pointerType
        if (e.pointerType !== 'mouse') touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (touches.current.size === 2) {
          // Two fingers: pinch to zoom instead of dragging.
          const [p, q] = [...touches.current.values()]
          pinch.current = Math.hypot(p.x - q.x, p.y - q.y)
          drag.current = null
          return
        }
        if ((e.target as Element).closest('button, label, input')) return
        drag.current = { x: e.clientX - view.x, y: e.clientY - view.y }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const v = viewNow.current
        cursor.current = e.pointerType === 'mouse' ? { x: (e.clientX - v.x) / v.k, y: (e.clientY - v.y) / v.k } : null
        if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pinch.current && touches.current.size === 2) {
          const [p, q] = [...touches.current.values()]
          const d = Math.hypot(p.x - q.x, p.y - q.y)
          if (d > 0) zoom(d / pinch.current, (p.x + q.x) / 2, (p.y + q.y) / 2)
          pinch.current = d
          return
        }
        if (drag.current) setView({ ...v, x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })
      }}
      onPointerLeave={() => (cursor.current = null)}
      onPointerUp={(e) => {
        touches.current.delete(e.pointerId)
        if (touches.current.size < 2) pinch.current = null
        drag.current = null
      }}
      onPointerCancel={(e) => {
        touches.current.delete(e.pointerId)
        pinch.current = null
        drag.current = null
      }}
      onKeyDown={(e) => {
        pointer.current = null
        if (e.target === filterBox.current) return // the find box keeps its own keys
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
          filterBox.current?.focus() // type to find: the letter lands in the box
          return
        }
        const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key]
        const at = [...buttons.current].find(([, b]) => b === document.activeElement)?.[0]
        if (dir) {
          e.preventDefault()
          const to = at ? neighbourIn(layout.nodes, at, dir[0], dir[1]) : nodes[0]?.key
          focusNode(to)
          if (to) setHot(to) // show its links, like pointing at it
        } else if (e.key === 'Home') {
          e.preventDefault()
          focusNode(hereKey)
        } else if (e.key === 'Enter' && e.shiftKey && at) {
          e.preventDefault()
          go(byKey.get(at)!, true)
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
                  {g.id === 'starred' ? UI.starred : g.id === 'rest' ? UI.rest : g.name}
                </text>
              )}
            </g>
          ))}
          {edges.map((e, i) => {
            const a = layout.nodes.get(e.a)!
            const b = layout.nodes.get(e.b)!
            const lit = told && (e.a === told || e.b === told) // the bubble pointed at, else where you are
            return (
              <path key={`${e.kind}:${e.a}:${e.b}`} ref={(el) => void (paths.current[i] = el)} className={`tm-edge ${e.kind}${lit ? ' on' : fading ? ' dim' : ''}`} d={edgePath(a, b, bends[i])} strokeWidth={e.kind === 'link' ? 1.6 + Math.min(e.count, 8) * 0.4 : 1.2}>
                <title>{UI.edgeTip(nameOf(e.a), nameOf(e.b), UI.why(e.why))}</title>
              </path>
            )
          })}
        </svg>
        {nodes.map((n) => {
          const m = getManifest(n.type)!
          const p = layout.nodes.get(n.key)!
          const isHere = n.key === hereKey
          const isOpen = !isHere && panels.some((x) => nodeKey(x.type, x.documentId) === n.key)
          const mine = edgesOf(n.key)
          const names = (kind: MapEdge['kind']) => mine.filter((e) => e.kind === kind).map((e) => nameOf(other(e, n.key))).join(', ')
          const label = [nameOf(n.key), isHere && UI.hereA11y, isOpen && UI.openA11y, names('link') && UI.linkedA11y(names('link')), names('route') && UI.worksA11y(names('route'))].filter(Boolean).join(', ')
          const dim = matches ? !matches.has(n.key) : fading && hot !== n.key && !near!.has(n.key)
          const color = meta.toolColors?.[n.type]
          return (
            <button
              key={n.key}
              ref={(el) => void (el ? buttons.current.set(n.key, el) : buttons.current.delete(n.key))}
              className={`tm-node${isHere ? ' here' : ''}${n.title ? ' doc' : ''}${dim ? ' dim' : ''}`}
              style={{ left: p.x - NODE_W / 2, top: p.y - BUBBLE / 2, width: NODE_W, ...(color ? { ['--tool-color' as string]: color } : {}) }}
              aria-label={label}
              aria-current={isHere ? 'location' : undefined}
              title={`${n.title ? `${m.name}: ${n.title}` : m.description}\n${UI.bubbleTip}`}
              onClick={(e) => {
                if (e.detail === 0) pointer.current = null // Enter or Space: go at once
                go(n, e.shiftKey)
              }}
              onMouseEnter={() => setHot(n.key)}
              onMouseLeave={() => !isTouchLike(pointer.current) && setHot((h) => (h === n.key ? null : h))} // a lifted finger "leaves" too: the tapped links stay
              onBlur={() => setHot((h) => (h === n.key ? null : h))}
            >
              <span className="tm-bubble">
                <m.icon size={26} />
                {isOpen && <span className="tm-open" />}
              </span>
              <span className="tm-name">{n.title ?? m.name}</span>
              {n.title && <span className="tm-tool">{m.name}</span>}
              {isHere && <span className="tm-here">{UI.here}</span>}
            </button>
          )
        })}
      </div>

      <div className="tm-bar tm-top">
        <strong>{UI.title}</strong>
        <input
          ref={filterBox}
          className="tm-find"
          type="search"
          value={query}
          placeholder={UI.filter}
          title={UI.filterTip}
          aria-label={UI.filter}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const first = nodes.find((n) => matches?.has(n.key))
            if (e.key === 'Enter' && first) {
              e.preventDefault()
              pointer.current = null
              go(first, e.shiftKey)
            } else if (e.key === 'ArrowDown' && first) {
              e.preventDefault()
              focusNode(first.key)
              setHot(first.key)
            }
          }}
        />
        <span className="tm-legend">
          <i className="tm-key link" /> {UI.yourLinks}
        </span>
        <label className="tm-legend" title={UI.togetherTip}>
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
          <i className="tm-key route" /> {UI.together}
        </label>
        <button className="icon-btn" title={UI.closeTip(orKey)} aria-label={UI.close} onClick={closeToolMap}>
          <X size={16} />
        </button>
      </div>

      <div className="tm-bar tm-bottom">
        <div className="tm-told" aria-live="polite">
          {!nodes.length ? (
            <span>{UI.empty}</span>
          ) : matches && !matches.size ? (
            <span>{UI.noMatch}</span>
          ) : told ? (
            <>
              <strong>{nameOf(told)}</strong>
              {list('link', true) && <span>{UI.linkedWith(list('link', true))}</span>}
              {!list('link', true) && <span>{UI.noLinks}</span>}
            </>
          ) : (
            <span>{touchy ? UI.tapAt : UI.pointAt}</span>
          )}
        </div>
        <div className="tm-hint">{touchy ? UI.touchHint : UI.hint(orKey)}</div>
      </div>
    </div>
  )
}
