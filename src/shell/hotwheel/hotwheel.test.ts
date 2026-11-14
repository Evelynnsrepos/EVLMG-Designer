import { describe, expect, it } from 'vitest'
import { hitTest } from './Hotwheel'

describe('Hotwheel hit test', () => {
  it('picks by direction and distance, with halves', () => {
    expect(hitTest(0, -10, 1, 6, 8)).toBeNull() // the centre cancels
    expect(hitTest(0, -60, 1, 6, 8)).toEqual({ ring: 'in', i: 0, half: 1 }) // straight up: slice 0, right half
    expect(hitTest(60, 0, 1, 6, 8)?.i).toBe(2) // right = slice 2 of 6 (90° / 60°, rounded)
    expect(hitTest(0, 400, 1, 6, 8)).toMatchObject({ ring: 'out', i: 4 }) // far down: outer ring, slice 4 of 8
    expect(hitTest(0, 400, 1, 6, 0)).toMatchObject({ ring: 'in', i: 3 }) // no outer ring: the inner one
    expect(hitTest(0, -50, 2, 6, 8)).toBeNull() // twice the size: 50 px is still the centre
  })
})

describe('Hotwheel bubbles and sliders', () => {
  it('makes fewer actions into bigger drops that never touch', async () => {
    const { bubbleLayout } = await import('./Hotwheel')
    const few = bubbleLayout(3, 46, 102)
    const many = bubbleLayout(10, 46, 102)
    expect(few.radius).toBeGreaterThan(many.radius)
    expect(few.radius).toBeLessThanOrEqual((102 - 46) / 2)
    // Neighbours along the ring stay apart: chord between centres > two radii.
    expect(2 * many.mid * Math.sin(many.step / 2)).toBeGreaterThan(2 * many.radius)
  })
  it('finds the slider arcs: size on the left, opacity on the right, low at the bottom', async () => {
    const { sliderHit } = await import('./Hotwheel')
    expect(sliderHit(-200, 0, 1, 200, 2)?.i).toBe(0)
    expect(sliderHit(200, 0, 1, 200, 2)?.i).toBe(1)
    expect(sliderHit(0, -200, 1, 200, 2)).toBeNull() // top: no slider
    expect(sliderHit(-100, 0, 1, 200, 2)).toBeNull() // inside the ring: not the slider
    const low = sliderHit(-150, 130, 1, 200, 2)!
    const high = sliderHit(-150, -130, 1, 200, 2)!
    expect(low.t).toBeLessThan(high.t)
  })
})
