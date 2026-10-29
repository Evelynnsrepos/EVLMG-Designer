import { describe, expect, it, vi } from 'vitest'
import { onScreen } from './FloatingPanel'

describe('onScreen', () => {
  it('pulls a panel saved off-screen back into the window, also when the tool is zoomed', () => {
    vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 })
    expect(onScreen({ x: 5000, y: -50 }, 300)).toEqual({ x: 700, y: 0 })
    expect(onScreen({ x: 700, y: 900 }, 300, 1.25)).toEqual({ x: 500, y: 600 })
    expect(onScreen({ x: 100, y: 100 }, 300)).toEqual({ x: 100, y: 100 })
    vi.unstubAllGlobals()
  })
})
