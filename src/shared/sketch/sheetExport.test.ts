import { describe, expect, it } from 'vitest'
import { sharedBounds } from '@/shared/pixel/sheet'

const frame = (w: number, h: number, on: [number, number][]) => ({ width: w, height: h, alpha: (x: number, y: number) => (on.some(([a, b]) => a === x && b === y) ? 255 : 0) })

describe('sprite sheet trim', () => {
  it('uses one box for every frame so the character stays put', () => {
    expect(sharedBounds([frame(10, 10, [[2, 3]]), frame(10, 10, [[7, 8]])])).toEqual({ x: 2, y: 3, w: 6, h: 6 })
    expect(sharedBounds([frame(4, 4, [])])).toBeNull()
  })
})
