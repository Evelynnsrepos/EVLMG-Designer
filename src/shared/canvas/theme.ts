import { useEffect, useState } from 'react'
import { usePanelContext, useProjectStore } from '@/core/state'
import { cssFamily } from '@/shared/fontList'
import type { CanvasTheme } from './types'

/** Konva needs concrete colors, so read the CSS theme tokens and follow theme switches. */
export function readCanvasTheme(): CanvasTheme {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    bg: v('--bg', '#15161a'),
    bgElevated: v('--bg-elevated', '#1d1f24'),
    bgSunken: v('--bg-sunken', '#101114'),
    border: v('--border', '#2c2f37'),
    text: v('--text', '#e6e7eb'),
    textMuted: v('--text-muted', '#9a9ea9'),
    accent: v('--accent', '#d46cf0'),
    danger: v('--danger', '#ef5d6c'),
    focus: v('--focus', '#8fb4ff'),
    font: v('--font', 'system-ui, sans-serif'),
  }
}

/** The canvas theme, with the font chosen for this tool (v0.12) when there is one. */
export function useCanvasTheme(): CanvasTheme {
  const type = usePanelContext()?.type
  const font = useProjectStore((s) => (type ? s.meta?.fonts?.[type] : undefined))
  const theme = useDocumentTheme()
  return font ? { ...theme, font: `${cssFamily(font)}, ${theme.font}` } : theme
}

function useDocumentTheme(): CanvasTheme {
  const [theme, setTheme] = useState(readCanvasTheme)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readCanvasTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

let accentCache: string | null = null

/** The accent colour right now (project look or app theme), for code that draws on a canvas. Cached, so it is cheap
 *  to call every frame; refreshed when the theme or a project look changes. Falls back to the default purple. */
export function accentNow(): string {
  if (accentCache) return accentCache
  if (typeof document === 'undefined') return '#d46cf0'
  const root = document.documentElement
  if (!(accentNow as { watching?: boolean }).watching) {
    ;(accentNow as { watching?: boolean }).watching = true
    new MutationObserver(() => (accentCache = null)).observe(root, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
  }
  accentCache = getComputedStyle(root).getPropertyValue('--accent').trim() || '#d46cf0'
  return accentCache
}

/** The accent with an alpha (0–1), as a CSS colour a canvas understands. */
export function accentAlpha(alpha: number): string {
  const hex = accentNow().match(/^#([0-9a-f]{6})$/i)?.[1]
  if (!hex) return accentNow()
  const n = parseInt(hex, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
