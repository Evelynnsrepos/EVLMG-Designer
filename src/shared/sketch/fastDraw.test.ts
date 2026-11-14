import { describe, expect, it } from 'vitest'
import { clipRect } from './engine'

describe('fast drawing (0.20)', () => {
  it('redraws only whole pixels inside the canvas', () => {
    expect(clipRect({ x: -5.5, y: 10.2, w: 20, h: 5 }, 100, 100)).toEqual({ x: 0, y: 10, w: 15, h: 6 })
    expect(clipRect({ x: 90, y: 90, w: 50, h: 50 }, 100, 100)).toEqual({ x: 90, y: 90, w: 10, h: 10 })
    expect(clipRect({ x: 120, y: 0, w: 5, h: 5 }, 100, 100)).toBeNull()
  })
})
