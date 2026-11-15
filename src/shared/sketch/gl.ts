/** Turn off to test the Canvas 2D paths: the Draw engine (gpuPaint.ts) and the Adjustments preview. */
export const glAllowed = { value: true }

/** '#rrggbb' to straight RGBA 0..1. */
export function parseHex(color: string): [number, number, number, number] {
  const h = color.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const n = parseInt(full, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1]
}
