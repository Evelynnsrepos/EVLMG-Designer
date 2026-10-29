import { ArrowLeftRight, BookOpen, Keyboard, LayoutPanelLeft, Scaling, Search, Settings, Undo2, Waypoints, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import type { ComponentType, Panel } from '@/core/model'
import { getManifest } from '@/core/registry'
import { formatCombo, isShortcut, keysOf, SHORTCUT_GROUPS } from '@/core/shortcuts'
import { isTextField, useAppStore, useProjectStore, useSettings } from '@/core/state'
import { extraHotActions, hotwheelSources, setHotwheelOpener, type HotAction } from '@/shared/hotwheel'
import { addJumpHere } from '@/shared/jumps/Jumps'
import { closePanel } from '../editor/actions'
import { useHelp } from '../help/help'
import { openSettings } from '../settings/open'
import { leaves } from '../workspace/layoutTree'
import { BOARD_TOOLS, setScale } from '../workspace/ToolHelp'
import './hotwheel.css'

// ---- Where the actions come from ---------------------------------------------------

/** Send a shortcut to a tool as if it was typed there (the tools listen on the window). */
export function pressKeys(panel: Element | null, combo: string) {
  const parts = combo.split('+')
  const k = parts.at(-1)!
  const NAMES: Record<string, string> = { esc: 'Escape', enter: 'Enter', tab: 'Tab', space: ' ', left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', delete: 'Delete', backspace: 'Backspace' }
  const key = NAMES[k] ?? k
  const target = (panel?.contains(document.activeElement) ? document.activeElement : panel) ?? window
  for (const type of ['keydown', 'keyup'])
    target.dispatchEvent(new KeyboardEvent(type, { key, ctrlKey: parts.includes('ctrl'), shiftKey: parts.includes('shift'), altKey: parts.includes('alt'), bubbles: true, cancelable: true }))
}

const panelEl = (id: string) => document.querySelector(`[data-panel-id="${id}"]`)
const clean = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, '').trim()

/** ponytail: a tool without its own list offers the buttons it shows (with an icon and a name); good enough until a tool registers its own. */
function buttonActions(el: Element | null): HotAction[] {
  const seen = new Set<string>()
  const out: HotAction[] = []
  for (const b of el?.querySelectorAll<HTMLButtonElement>('.panel-body button') ?? []) {
    const label = clean(b.getAttribute('aria-label') || b.title || b.textContent || '').slice(0, 40)
    const svg = b.querySelector('svg')
    // Long names are hints, not names; a bare Remove or Delete says too little to sit on a wheel.
    if (!label || label.length > 32 || /^(remove|delete)/i.test(label) || !svg || b.disabled || !b.offsetParent || seen.has(label)) continue
    seen.add(label)
    out.push({ id: `btn:${label}`, label, icon: svg.outerHTML, on: b.classList.contains('active') || b.getAttribute('aria-pressed') === 'true', run: () => b.click() })
  }
  return out
}

const GROUP_OF: Partial<Record<ComponentType, string>> = { 'level-layout': 'Level Layout', 'pixel-art': 'Pixel Art' }

/** Shortcut pairs that share one slice (left half, right half). */
const KEY_PAIRS: Record<string, [string, string, string]> = { 'pixel.size': ['pixel.smaller', 'pixel.bigger', 'Pencil size'], 'pixel.frame': ['pixel.prev', 'pixel.next', 'Frame'] }

/** Default outer rings from the Hotwheel plan; other tools get their first ten. */
const DEFAULT_RING: Record<string, string[]> = {
  boards: ['board.note', 'btn:Add image or audio', 'board.pen', 'board.eraser', 'board.arrow', 'board.select', 'btn:Any colour', 'board.jump'],
  'level-layout': ['level.paint', 'level.erase', 'level.fill', 'level.select', 'level.block', 'level.note', 'btn:New layer'],
  'pixel-art': ['pixel.pencil', 'pixel.eraser', 'pixel.fill', 'pixel.select', 'pixel.move', 'pixel.picker', 'pixel.size', 'pixel.frame', 'pixel.shade', 'pixel.play'],
  writer: ['btn:Bold', 'btn:Italic', 'btn:Heading 1', 'btn:Link an article, entry, tool or document', 'btn:Bulleted list', 'btn:Insert image', 'btn:Undo', 'btn:Export'],
}
const ringKey = (type: ComponentType) => (BOARD_TOOLS.has(type) ? 'boards' : type)

/** Everything this tool can put on its ring. */
export function toolActions(panel: Panel): { actions: HotAction[]; ownOrder: boolean } {
  const src = hotwheelSources.get(panel.id)
  if (src) return { actions: src.actions(), ownOrder: !!src.ownOrder }
  const el = panelEl(panel.id)
  const buttons = buttonActions(el)
  const name = BOARD_TOOLS.has(panel.type) ? 'Boards' : GROUP_OF[panel.type]
  const group = name ? SHORTCUT_GROUPS.find((g) => g.name.startsWith(name)) : undefined
  const keyed: HotAction[] = (group?.items ?? []).map((i) => {
    const b = buttons.find((x) => x.label.toLowerCase().startsWith(i.label.toLowerCase()))
    return { id: i.id, label: i.label, icon: b?.icon, on: b?.on, run: () => pressKeys(el, keysOf(i.id)[0]) }
  })
  for (const [id, [a, b, label]] of Object.entries(KEY_PAIRS))
    if (keyed.some((k) => k.id === a)) keyed.push({ id, label, halves: [{ label: keyed.find((k) => k.id === a)!.label, run: () => pressKeys(el, keysOf(a)[0]) }, { label: keyed.find((k) => k.id === b)!.label, run: () => pressKeys(el, keysOf(b)[0]) }] })
  return { actions: [...keyed, ...buttons.filter((b) => !keyed.some((k) => k.icon && k.icon === b.icon))], ownOrder: false }
}

/** The outer ring: the user's choice for this tool, else the first ten. */
export function outerRing(panel: Panel, outer = useSettings.getState().hotwheel.outer): HotAction[] {
  const { actions, ownOrder } = toolActions(panel)
  if (ownOrder) return actions.slice(0, 10)
  const pick = (ids: string[]) => ids.map((id) => actions.find((a) => a.id === id)).filter((a): a is HotAction => !!a)
  const mine = outer[panel.type]
  if (mine) return pick(mine)
  const preset = pick(DEFAULT_RING[ringKey(panel.type)] ?? [])
  return preset.length ? preset : actions.slice(0, 10)
}

/** The inner ring's choices: program actions that work in every tool. */
export function innerActions(panel: Panel | null): HotAction[] {
  const el = panel && panelEl(panel.id)
  const type = panel?.type
  const tool = type ? (getManifest(type)?.name ?? type) : 'this tool'
  const scale = (d: number) => type && setScale(type, (useSettings.getState().toolScale[type] ?? 100) + d)
  const size = panel ? hotwheelSources.get(panel.id)?.size : undefined
  return [
    { id: 'close', label: `Close ${tool}`, icon: X, run: () => panel && void closePanel(panel.id) },
    size
      ? { id: 'scale', label: size.label, icon: Scaling, halves: [{ label: 'Smaller', run: () => size.smaller() }, { label: 'Bigger', run: () => size.bigger() }] }
      : { id: 'scale', label: 'Size', icon: Scaling, halves: [{ label: 'Smaller', run: () => scale(-10) }, { label: 'Bigger', run: () => scale(10) }] },
    { id: 'jump', label: 'Add a jump point', icon: Waypoints, run: () => panel && void addJumpHere(panel.type, panel.documentId) },
    { id: 'layout', label: 'Layout Mode (Esc)', icon: LayoutPanelLeft, run: () => useAppStore.getState().setLayoutMode(!useAppStore.getState().layoutMode) },
    { id: 'undo', label: 'Undo / Redo', icon: Undo2, halves: [{ label: 'Undo', run: () => pressKeys(el, keysOf('app.undo')[0]) }, { label: 'Redo', run: () => pressKeys(el, keysOf('app.redo')[0]) }] },
    { id: 'search', label: 'Search everything', icon: Search, run: () => pressKeys(null, keysOf('app.search')[0]) },
    { id: 'history', label: 'Back / Forward', icon: ArrowLeftRight, halves: [{ label: 'Back', run: () => pressKeys(null, keysOf('app.back')[0]) }, { label: 'Forward', run: () => pressKeys(null, keysOf('app.forward')[0]) }] },
    { id: 'keys', label: 'Shortcuts for this tool', icon: Keyboard, run: () => el?.querySelector<HTMLButtonElement>('.panel-header [aria-label="Shortcuts"]')?.click() },
    { id: 'help', label: 'This tool in the guide', icon: BookOpen, run: () => useHelp.getState().openGuide(type) },
    { id: 'settings', label: 'Settings', icon: Settings, run: () => openSettings() },
    ...extraHotActions,
  ]
}

// ---- The wheel ---------------------------------------------------------------------

interface Open {
  x: number
  y: number
  panel: Panel | null
  inner: (HotAction | null)[]
  outer: HotAction[]
  /** Held key or mouse button: letting go runs the slice under the pointer. */
  hold?: { key?: string; button?: number }
  at: number
  /** Playing its closing animation; it takes no more input. */
  closing?: boolean
}
const useWheel = create<{ open: Open | null }>()(() => ({ open: null }))

/** Play the closing animation, then take the wheel away (unless it was opened again meanwhile). */
function closeWheel(open: Open) {
  useWheel.setState({ open: { ...open, closing: true } })
  setTimeout(() => useWheel.getState().open?.at === open.at && useWheel.setState({ open: null }), 130)
}
const isOpen = () => !!useWheel.getState().open && !useWheel.getState().open!.closing

const SIZES = { S: 0.8, M: 1, L: 1.25 }
const HOLE = 40
const MID = 104
const OUT = 166
/** Space between slices; the round corners come from a thick stroke in the slice's own colour (hotwheel.css). */
const INSET = 7

type Hit = { ring: 'in' | 'out'; i: number; half: 0 | 1 } | null

/** Which slice a point is on. Like a marking menu, the direction counts more than hitting it exactly. */
export function hitTest(dx: number, dy: number, scale: number, inner: number, outer: number): Hit {
  const d = Math.hypot(dx, dy) / scale
  if (d < HOLE) return null
  const ring = d < MID || !outer ? 'in' : 'out'
  const n = ring === 'in' ? inner : outer
  if (!n) return null
  // 0 = straight up, clockwise.
  const a = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2)
  const step = (Math.PI * 2) / n
  const shifted = (a + step / 2) % (Math.PI * 2)
  const i = Math.floor(shifted / step)
  return { ring, i, half: shifted - i * step < step / 2 ? 0 : 1 }
}

const polar = (r: number, a: number) => [Math.sin(a) * r, -Math.cos(a) * r]
function slicePath(r0: number, r1: number, a0: number, a1: number) {
  const [x0, y0] = polar(r1, a0)
  const [x1, y1] = polar(r1, a1)
  const [x2, y2] = polar(r0, a1)
  const [x3, y3] = polar(r0, a0)
  const big = a1 - a0 > Math.PI ? 1 : 0
  return `M${x0} ${y0}A${r1} ${r1} 0 ${big} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${big} 0 ${x3} ${y3}Z`
}

function run(a: HotAction | null | undefined, half: 0 | 1, alt: boolean) {
  if (!a) return
  if (a.halves) a.halves[half].run()
  else a.run?.(alt)
}

function Icon({ icon, size }: { icon: HotAction['icon']; size: number }) {
  if (!icon) return null
  if (typeof icon === 'string') return <span className="hotwheel-svg" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: icon }} />
  const I = icon
  return <I size={size} />
}

function Ring({ items, r0, r1, hit, ring }: { items: (HotAction | null)[]; r0: number; r1: number; hit: Hit; ring: 'in' | 'out' }) {
  const n = items.length
  const step = (Math.PI * 2) / n
  return (
    <>
      {items.map((a, i) => {
        const gap = INSET / r0
        const a0 = i * step - step / 2 + gap
        const a1 = i * step + step / 2 - gap
        const am = (a0 + a1) / 2
        const lit = hit?.ring === ring && hit.i === i
        const mid = (r0 + r1) / 2
        const label = (text: string, at: number, key?: number, icon?: HotAction['icon']) => {
          const [lx, ly] = polar(mid, at)
          // As wide as the slice (or half) is, so neighbours never overlap.
          const w = Math.min(64, mid * (a1 - a0) * (key === undefined ? 1 : 0.5) + 10)
          return (
            <foreignObject key={key} x={lx - w / 2} y={ly - 24} width={w} height={48}>
              <div className={key === undefined ? 'hotwheel-label' : 'hotwheel-label half'}>
                <Icon icon={icon} size={ring === 'in' ? 18 : 16} />
                <span>{text}</span>
              </div>
            </foreignObject>
          )
        }
        return (
          <g key={i} className={`hotwheel-slice${lit ? ' lit' : ''}${a?.on ? ' on' : ''}${a ? '' : ' empty'}`}>
            {a?.halves ? (
              <>
                <path d={slicePath(r0 + INSET, r1 - INSET, a0, am - gap / 2)} className={lit && hit.half === 0 ? 'half lit' : 'half'} />
                <path d={slicePath(r0 + INSET, r1 - INSET, am + gap / 2, a1)} className={lit && hit.half === 1 ? 'half lit' : 'half'} />
                {label(a.halves[0].label, (a0 + am) / 2, 0)}
                {label(a.halves[1].label, (am + a1) / 2, 1)}
              </>
            ) : (
              <path d={slicePath(r0 + INSET, r1 - INSET, a0, a1)} />
            )}
            {a && !a.halves && label(a.label, i * step, undefined, a.icon)}
          </g>
        )
      })}
    </>
  )
}

function Wheel({ open }: { open: Open }) {
  const size = useSettings((s) => s.hotwheel.size)
  const toolScale = useSettings((s) => (open.panel ? (s.toolScale[open.panel.type] ?? 100) : 100))
  const scale = SIZES[size] * (toolScale / 100)
  const [hit, setHit] = useState<Hit>(null)
  const hitRef = useRef<Hit>(null)
  const [held, setHeld] = useState(!!open.hold)
  const heldRef = useRef(held)
  useEffect(() => {
    heldRef.current = held
  })
  // Keep it on screen.
  const r = OUT * scale + 6
  const cx = Math.min(window.innerWidth - r, Math.max(r, open.x))
  const cy = Math.min(window.innerHeight - r, Math.max(r, open.y))

  useEffect(() => {
    if (open.closing) return
    const close = () => closeWheel(open)
    const pick = (alt: boolean, keep = false) => {
      const h = hitRef.current
      if (!h) return false
      if (!keep) close()
      run(h.ring === 'in' ? open.inner[h.i] : open.outer[h.i], h.half, alt)
      return true
    }
    const letGo = (shift: boolean) => {
      setHeld(false)
      // A quick tap leaves it open to click; holding and letting go runs the slice (or cancels on the centre).
      if (!pick(shift) && performance.now() - open.at > 350) close()
      else if (!hitRef.current) useWheel.setState({ open: { ...open, hold: undefined } })
    }
    const move = (e: PointerEvent) => {
      const h = hitTest(e.clientX - cx, e.clientY - cy, scale, open.inner.length, open.outer.length)
      hitRef.current = h
      setHit(h)
    }
    const down = (e: PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (heldRef.current) return
      move(e)
      if (Math.hypot(e.clientX - cx, e.clientY - cy) > r + 40 || !hitRef.current) return close()
      // Shift-click keeps the wheel open for another action.
      pick(e.shiftKey, e.shiftKey)
    }
    const up = (e: PointerEvent) => {
      if (heldRef.current && open.hold?.button === e.button) {
        e.preventDefault()
        e.stopPropagation()
        letGo(e.shiftKey)
      }
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && e.type === 'keydown') {
        e.preventDefault()
        e.stopImmediatePropagation()
        return close()
      }
      if (heldRef.current && open.hold?.key && e.type === 'keyup' && e.key.toLowerCase() === open.hold.key) letGo(e.shiftKey)
      else if (e.type === 'keydown' && e.key.toLowerCase() === open.hold?.key) e.stopImmediatePropagation()
    }
    const noMenu = (e: Event) => e.preventDefault()
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key, true)
    window.addEventListener('contextmenu', noMenu, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', key, true)
      window.removeEventListener('contextmenu', noMenu, true)
    }
  }, [open, cx, cy, scale, r])

  const current = hit && (hit.ring === 'in' ? open.inner[hit.i] : open.outer[hit.i])
  const name = current ? (current.halves ? current.halves[hit.half].label : current.label) : open.panel ? (getManifest(open.panel.type)?.name ?? '') : ''
  const w = OUT * 2 + 12
  return (
    <div className={`hotwheel${open.closing ? ' closing' : ''}`} style={{ left: cx, top: cy, '--s': scale } as React.CSSProperties} role="menu" aria-label="Hotwheel">
      <svg width={w} height={w} viewBox={`${-w / 2} ${-w / 2} ${w} ${w}`}>
        <Ring items={open.inner} r0={HOLE + 2} r1={MID - 2} hit={hit} ring="in" />
        {open.outer.length > 0 && <Ring items={open.outer} r0={MID + 2} r1={OUT} hit={hit} ring="out" />}
        <circle r={HOLE} className="hotwheel-hole" />
      </svg>
      <div className="hotwheel-name">{name || 'Hotwheel'}</div>
    </div>
  )
}

// ---- Opening it ----------------------------------------------------------------------

function activePanel(): Panel | null {
  const id = useAppStore.getState().activePanelId
  const all = leaves(useProjectStore.getState().meta?.layout ?? null)
  return all.find((p) => p.id === id) ?? all[0] ?? null
}

const pointer = { x: 400, y: 300 }

function openAt(at?: { x: number; y: number }, hold?: Open['hold']) {
  if (isOpen() || !useProjectStore.getState().meta) return
  const panel = activePanel()
  const all = innerActions(panel)
  const inner = useSettings.getState().hotwheel.inner.map((id) => all.find((a) => a.id === id) ?? null)
  const p = at ?? pointer
  useWheel.setState({ open: { x: p.x, y: p.y, panel, inner, outer: panel ? outerRing(panel) : [], hold, at: performance.now() } })
}

/** Mount once in the editor: the wheel, and Q / pen button / right-hold / middle button to open it. */
export function HotwheelHost() {
  const open = useWheel((s) => s.open)
  useEffect(() => {
    setHotwheelOpener(openAt)
    let timer: ReturnType<typeof setTimeout> | undefined
    let opened = false
    const move = (e: PointerEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
    }
    const key = (e: KeyboardEvent) => {
      if (e.repeat || isOpen() || isTextField(e.target) || !isShortcut(e, 'app.hotwheel')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      openAt(undefined, { key: e.key.toLowerCase() })
    }
    const down = (e: PointerEvent) => {
      if (isOpen() || !(e.target as Element).closest?.('.panel-body')) return
      const s = useSettings.getState().hotwheel
      const at = { x: e.clientX, y: e.clientY }
      const now = (e.pointerType === 'pen' && e.button === 2 && s.penButton) || (e.button === 1 && s.middle && e.pointerType !== 'pen')
      if (now) {
        e.preventDefault()
        e.stopPropagation()
        opened = true
        return openAt(at, { button: e.button })
      }
      if (e.button === 2 && s.rightHold && e.pointerType === 'mouse') {
        opened = false
        timer = setTimeout(() => ((opened = true), openAt(at, { button: 2 })), 250)
      }
    }
    const up = () => clearTimeout(timer)
    const menu = (e: Event) => {
      if (!opened) return
      opened = false
      e.preventDefault()
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('contextmenu', menu, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('contextmenu', menu, true)
    }
  }, [])
  return open ? <Wheel key={open.at} open={open} /> : null
}

/** The open key for labels, e.g. "Q". */
export const hotwheelKey = () => formatCombo(keysOf('app.hotwheel')[0] ?? 'q')
