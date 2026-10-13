/**
 * v0.18: a tool can run at its own size (CSS zoom on the panel, for pen and tablet users).
 * Pointer positions come in screen pixels; divide them by the zoom inside a tool.
 */
export const zoomOf = (el: Element | null | undefined): number => (el as { currentCSSZoom?: number } | null | undefined)?.currentCSSZoom ?? 1

/** A pointer position in an element's own (unzoomed) pixels, from its top-left corner. */
export function pointIn(el: Element, ev: { clientX: number; clientY: number }) {
  const r = el.getBoundingClientRect()
  const z = zoomOf(el)
  return { x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z }
}
