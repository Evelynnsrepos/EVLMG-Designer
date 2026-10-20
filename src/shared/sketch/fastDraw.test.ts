import { describe, expect, it } from 'vitest'
import { clipRect } from './engine'
import { prefersCanvas2d } from './gl'

describe('fast drawing on Linux (0.20)', () => {
  it('blends in Canvas 2D first only in WebKitGTK', () => {
    expect(prefersCanvas2d('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15')).toBe(true)
    // Windows (WebView2), Mac (WKWebView), Chromium on Linux and Android keep the GPU.
    expect(prefersCanvas2d('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0')).toBe(false)
    expect(prefersCanvas2d('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)')).toBe(false)
    expect(prefersCanvas2d('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36')).toBe(false)
    expect(prefersCanvas2d('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36')).toBe(false)
  })

  it('redraws only whole pixels inside the canvas', () => {
    expect(clipRect({ x: -5.5, y: 10.2, w: 20, h: 5 }, 100, 100)).toEqual({ x: 0, y: 10, w: 15, h: 6 })
    expect(clipRect({ x: 90, y: 90, w: 50, h: 50 }, 100, 100)).toEqual({ x: 90, y: 90, w: 10, h: 10 })
    expect(clipRect({ x: 120, y: 0, w: 5, h: 5 }, 100, 100)).toBeNull()
  })
})
