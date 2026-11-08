import { create } from 'zustand'
import { getManifest } from '@/core/registry'
import { openComponent, type DragPayload } from '../editor/actions'
import { sideFromPoint, type DropSide } from './layoutTree'

/**
 * Dragging a tool from the sidebar onto the workspace with a finger or pen. Touch screens don't start the browser's
 * own drag and drop (which the mouse uses), so this follows the pointer instead: slide sideways out of the sidebar,
 * and let go on a tool to open next to it, or on the empty workspace.
 */
export const useToolDrag = create<{ payload: DragPayload | null; over: string | null; side: DropSide | null; empty: boolean; x: number; y: number }>(
  () => ({ payload: null, over: null, side: null, empty: false, x: 0, y: 0 }),
)

/** Moving this far sideways (more than up or down) starts a drag; mostly up or down stays a scroll. */
export const DRAG_START_PX = 12

export function hitTest(x: number, y: number): { over: string | null; side: DropSide | null; empty: boolean } {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!(el instanceof HTMLElement)) continue
    if (el.dataset.panelId) {
      const box = el.getBoundingClientRect()
      return { over: el.dataset.panelId, side: sideFromPoint((x - box.left) / box.width, (y - box.top) / box.height), empty: false }
    }
    if (el.dataset.toolDrop === 'empty') return { over: null, side: null, empty: true }
  }
  return { over: null, side: null, empty: false }
}

/** onPointerDown for a sidebar tool or document. Mouse keeps using the browser's drag and drop. */
export function startToolDrag(e: React.PointerEvent<HTMLElement>, payload: DragPayload) {
  if (e.pointerType === 'mouse' || !e.isPrimary) return
  const startX = e.clientX
  const startY = e.clientY
  let dragging = false

  const onMove = (ev: PointerEvent) => {
    if (!dragging) {
      const dx = Math.abs(ev.clientX - startX)
      const dy = Math.abs(ev.clientY - startY)
      if (dy > DRAG_START_PX && dy >= dx) return stop()
      if (dx < DRAG_START_PX) return
      dragging = true
    }
    useToolDrag.setState({ payload, ...hitTest(ev.clientX, ev.clientY), x: ev.clientX, y: ev.clientY })
  }
  const onUp = () => {
    const { over, side, empty } = useToolDrag.getState()
    stop()
    if (!dragging) return
    // The lift would also "click" the sidebar row and replace the open tools.
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400)
    if (over && side) openComponent(payload.type, payload.documentId, { targetId: over, side })
    else if (empty) openComponent(payload.type, payload.documentId)
  }
  const stop = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', stop)
    useToolDrag.setState({ payload: null, over: null, side: null, empty: false })
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', stop)
}

function swallow(e: Event) {
  e.preventDefault()
  e.stopPropagation()
}

/** The tool's name under the finger while dragging. */
export function ToolDragLabel() {
  const { payload, x, y } = useToolDrag()
  if (!payload) return null
  return (
    <div className="layout-drag-label" style={{ left: x + 14, top: y - 40 }}>
      {getManifest(payload.type)?.name ?? payload.type}
    </div>
  )
}
