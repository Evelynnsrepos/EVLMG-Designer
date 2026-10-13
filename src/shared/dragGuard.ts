/**
 * Rows that can be dragged (layers, brushes): a press on a slider, field or button inside the row
 * works that control instead of grabbing the whole row (v0.17). Use as onPointerDownCapture.
 */
export function dragFromRowOnly(e: { currentTarget: HTMLElement; target: EventTarget }) {
  e.currentTarget.draggable = !(e.target as Element).closest?.('input, select, textarea, button, [contenteditable="true"]')
}
