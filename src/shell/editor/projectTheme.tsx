import { useEffect } from 'react'
import { pickAndImportAssets, useAssetUrl } from '@/core/assets'
import { DEFAULT_PROJECT_THEME, type ProjectTheme } from '@/core/model'
import { useProjectStore } from '@/core/state'
import { Modal } from '@/shared/ui'
import { useTheme } from '../theme'

/** Per-project colors and wallpaper (custom theming on top of spec 10.5). */

type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const rgb = (c: Rgb, alpha = 1) => `rgb(${c.map(Math.round).join(' ')} / ${alpha})`
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as Rgb
const isLight = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b > 140

/** CSS variables a project theme overrides. `base` is the app theme's own --bg / --bg-sunken. */
export function themeVars(t: ProjectTheme, base: { bg: string; sunken: string }): Record<string, string> {
  const vars: Record<string, string> = {}
  let bg = hexToRgb(base.bg)
  let sunken = hexToRgb(base.sunken)
  if (t.background) {
    bg = hexToRgb(t.background)
    const light = isLight(bg)
    const ink: Rgb = light ? [0, 0, 0] : [255, 255, 255]
    sunken = mix(bg, [0, 0, 0], light ? 0.06 : 0.25)
    vars['--bg-elevated'] = rgb(mix(bg, [255, 255, 255], light ? 0.5 : 0.06))
    vars['--bg-hover'] = rgb(mix(bg, ink, 0.1))
    vars['--border'] = rgb(mix(bg, ink, 0.16))
    vars['--text'] = light ? '#1c1d22' : '#e6e7eb'
    vars['--text-muted'] = light ? '#5f6370' : '#9a9ea9'
    vars['color-scheme'] = light ? 'light' : 'dark'
  }
  if (t.background || t.wallpaper) {
    const alpha = t.wallpaper ? t.panelOpacity / 100 : 1
    vars['--bg'] = rgb(bg, alpha)
    vars['--bg-sunken'] = rgb(sunken, alpha)
  }
  if (t.accent) {
    vars['--accent'] = t.accent
    vars['--focus'] = t.accent // focus rings follow the project's accent too
    vars['--accent-text'] = isLight(hexToRgb(t.accent)) ? '#15161a' : '#ffffff'
  }
  return vars
}

const ALL_VARS = ['--bg', '--bg-sunken', '--bg-elevated', '--bg-hover', '--border', '--text', '--text-muted', '--accent', '--accent-text', '--focus', 'color-scheme']

/** Applies the open project's theme to the document while the editor is showing. */
export function useProjectTheme() {
  const theme = useProjectStore((s) => s.meta?.theme)
  const mode = useTheme()
  useEffect(() => {
    const style = document.documentElement.style
    const clear = () => ALL_VARS.forEach((v) => style.removeProperty(v))
    clear()
    if (!theme) return
    const css = getComputedStyle(document.documentElement)
    const base = { bg: css.getPropertyValue('--bg').trim(), sunken: css.getPropertyValue('--bg-sunken').trim() }
    for (const [k, v] of Object.entries(themeVars(theme, base))) style.setProperty(k, v)
    return clear
  }, [theme, mode])
}

/** The wallpaper layer behind the editor, with blur, contrast, dim and tint. */
export function ProjectWallpaper() {
  const theme = useProjectStore((s) => s.meta?.theme)
  const url = useAssetUrl(theme?.wallpaper)
  if (!theme || !url) return null
  const shade = [
    theme.tint && `linear-gradient(rgb(${hexToRgb(theme.tint).join(' ')} / ${theme.tintStrength / 100}), transparent 0)`,
    `linear-gradient(rgb(0 0 0 / ${theme.dim / 100}), transparent 0)`,
  ].filter(Boolean)
  return (
    <div className="project-wallpaper" aria-hidden>
      <div
        className="project-wallpaper-image"
        style={{ backgroundImage: `url("${url}")`, filter: `blur(${theme.blur}px) contrast(${theme.contrast}%)`, inset: -theme.blur * 2 }}
      />
      <div className="project-wallpaper-image" style={{ background: shade.join(', ') }} />
    </div>
  )
}

export function ProjectThemeDialog({ onClose }: { onClose: () => void }) {
  const root = useProjectStore((s) => s.root)
  const theme = useProjectStore((s) => s.meta?.theme) ?? DEFAULT_PROJECT_THEME
  const set = (patch: Partial<ProjectTheme>) => useProjectStore.getState().updateMeta({ theme: { ...theme, ...patch } })

  const color = (label: string, key: 'accent' | 'background' | 'tint') => (
    <label className="theme-row">
      <span>{label}</span>
      <input type="color" value={theme[key] ?? '#d46cf0'} onChange={(e) => set({ [key]: e.target.value })} />
      <button className="btn" disabled={!theme[key]} onClick={() => set({ [key]: null })}>
        Default
      </button>
    </label>
  )
  const slider = (label: string, key: 'blur' | 'dim' | 'contrast' | 'tintStrength' | 'panelOpacity', min: number, max: number, unit: string) => (
    <label className="theme-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={theme[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
      <span className="theme-value">
        {theme[key]}
        {unit}
      </span>
    </label>
  )

  return (
    <Modal onClose={onClose}>
      <div className="theme-dialog">
        <h3>Project look</h3>
        {color('Accent', 'accent')}
        {color('Background', 'background')}

        <div className="theme-row">
          <span>Wallpaper</span>
          <button
            className="btn"
            onClick={async () => {
              if (!root) return
              const [asset] = await pickAndImportAssets(root, 'image', 'Choose a wallpaper')
              if (asset) set({ wallpaper: asset.path })
            }}
          >
            {theme.wallpaper ? 'Change…' : 'Choose…'}
          </button>
          <button className="btn" disabled={!theme.wallpaper} onClick={() => set({ wallpaper: null })}>
            Remove
          </button>
        </div>
        {theme.wallpaper && (
          <>
            {slider('Blur', 'blur', 0, 40, 'px')}
            {slider('Dim', 'dim', 0, 90, '%')}
            {slider('Contrast', 'contrast', 50, 150, '%')}
            {color('Tint', 'tint')}
            {theme.tint && slider('Tint strength', 'tintStrength', 0, 100, '%')}
            {slider('Panel opacity', 'panelOpacity', 30, 100, '%')}
          </>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={() => useProjectStore.getState().updateMeta({ theme: undefined })}>
            Reset all
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}
