import { create } from 'zustand'

/**
 * Shaky hand help: a wobbly pen (old tablets, unsteady hands) still clicks and drags right in menus and panels.
 * - A press that wiggles a little stays a click, even when the tip ends on the next button.
 * - Rows that can be dragged (layers, brushes, brush sets) only start dragging after a clear move.
 * Works on every HTML5 drag in the app: native drags are swapped for the same drag events after `slop` pixels.
 * Canvases, text fields and sliders are left alone. Touch has its own handling (mobile touch.ts).
 * Strong also makes the buttons in the Draw panels bigger (data-steady on the root).
 */
export type Steady = 'off' | 'normal' | 'strong'
export const STEADY_SLOP: Record<Steady, number> = { off: 0, normal: 10, strong: 22 }

const KEY = 'egd-steady'

function initial(): Steady {
  try {
    const s = localStorage.getItem(KEY)
    if (s === 'off' || s === 'normal' || s === 'strong') return s
  } catch {
    // ignore
  }
  return 'normal'
}

const useSteadyStore = create<{ steady: Steady }>()(() => ({ steady: initial() }))
export const useSteady = () => useSteadyStore((s) => s.steady)

function applySteady() {
  const s = useSteadyStore.getState().steady
  if (s === 'strong') document.documentElement.dataset.steady = s
  else delete document.documentElement.dataset.steady
}

export function setSteady(steady: Steady) {
  useSteadyStore.setState({ steady })
  try {
    localStorage.setItem(KEY, steady)
  } catch {
    // ignore
  }
  applySteady()
}

/** Things a wobbly click should still reach when the tip slides onto the next element. */
const CLICKABLE = 'button, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"], label, summary, [draggable="true"]'
const CONTROL = 'button, input, select, textarea, [contenteditable="true"]'
const LEAVE_ALONE = 'canvas, input, textarea, select, [contenteditable="true"], .cm-editor'

interface Press {
  x: number
  y: number
  target: Element
  /** Row that would start a native drag; switched off while pressed and dragged by hand instead. */
  source: HTMLElement | null
  dragging: boolean
  data?: DataTransfer
  over?: Element | null
  accepted?: boolean
}

let press: Press | null = null
let lastPointer = 'mouse'

const fire = (type: string, el: Element, p: Press, x: number, y: number) => {
  const e = new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: p.data })
  el.dispatchEvent(e)
  return e
}

/** The click that comes after a hand-made drag or a re-aimed click must not reach anything. */
function swallowNextClick() {
  const stop = (e: Event) => {
    e.stopPropagation()
    e.preventDefault()
  }
  window.addEventListener('click', stop, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', stop, true), 400)
}

function end() {
  if (press?.source) press.source.draggable = true
  press = null
}

function onMouseDown(e: MouseEvent) {
  end()
  const slop = STEADY_SLOP[useSteadyStore.getState().steady]
  const t = e.target as Element | null
  if (!slop || e.button !== 0 || lastPointer === 'touch' || !t?.closest || t.closest(LEAVE_ALONE)) return
  // Runs after React's pointerdown handlers (dragFromRowOnly), so draggable is already right for this press.
  let source = t.closest<HTMLElement>('[draggable="true"]')
  // Same rule as dragFromRowOnly: a button inside a row works the button.
  if (source && source.contains(t.closest(CONTROL))) source = null
  if (source) source.draggable = false
  press = { x: e.clientX, y: e.clientY, target: t, source, dragging: false }
}

function onMove(e: PointerEvent) {
  const p = press
  if (!p || !p.source) return
  if (!p.dragging) {
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= STEADY_SLOP[useSteadyStore.getState().steady]) return
    p.data = new DataTransfer()
    p.dragging = true
    if (fire('dragstart', p.source, p, p.x, p.y).defaultPrevented) return end()
    getSelection()?.removeAllRanges()
  }
  const over = document.elementFromPoint(e.clientX, e.clientY)
  if (over !== p.over) {
    if (p.over) fire('dragleave', p.over, p, e.clientX, e.clientY)
    if (over) fire('dragenter', over, p, e.clientX, e.clientY)
    p.over = over
  }
  p.accepted = !!over && fire('dragover', over, p, e.clientX, e.clientY).defaultPrevented
}

function onUp(e: PointerEvent) {
  const p = press
  if (!p) return
  if (p.dragging && p.source) {
    const dropped = !!(p.accepted && p.over)
    if (dropped) fire('drop', p.over!, p, e.clientX, e.clientY)
    p.data!.dropEffect = dropped ? 'move' : 'none'
    fire('dragend', p.source, p, e.clientX, e.clientY)
    swallowNextClick()
  } else if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= STEADY_SLOP[useSteadyStore.getState().steady]) {
    // The tip slid onto another element: the browser would click their common parent. Click what was pressed.
    const aim = p.target.closest(CLICKABLE) ?? p.source
    const now = document.elementFromPoint(e.clientX, e.clientY)
    if (aim && now && !aim.contains(now)) {
      swallowNextClick()
      setTimeout(() => aim.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, detail: 1 })))
    }
  }
  end()
}

export function installSteadyPen() {
  applySteady()
  window.addEventListener('pointerdown', (e) => (lastPointer = e.pointerType), true)
  window.addEventListener('mousedown', onMouseDown, true)
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', end, true)
  window.addEventListener('blur', end)
}
