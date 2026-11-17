import { create } from 'zustand'
import { gpuInfo } from '@/shared/gpu'

/** Light/dark theme, dark by default (spec 10.5). Remembered per machine. */
export type Theme = 'dark' | 'light'

const KEY = 'egd-theme'

function initial(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** Glass look (Liquid Glass style): see-through, blurred chrome. Remembered per machine like the theme. */
export type Glass = 'full' | 'light' | 'off'

const GLASS_KEY = 'egd-glass'

/** Without a saved choice: off when the system asks for less transparency or there is no graphics card
 *  (blur is very slow then), light (no blur) on Linux, where WebKitGTK blur is slow and can glitch, full elsewhere. */
export function defaultGlass(env: { reduceTransparency: boolean; softwareGpu: boolean; linux: boolean }): Glass {
  if (env.reduceTransparency || env.softwareGpu) return 'off'
  return env.linux ? 'light' : 'full'
}

function initialGlass(): Glass {
  try {
    const saved = localStorage.getItem(GLASS_KEY)
    if (saved === 'full' || saved === 'light' || saved === 'off') return saved
  } catch {
    // ignore
  }
  try {
    const ua = navigator.userAgent
    return defaultGlass({
      reduceTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
      softwareGpu: gpuInfo().software,
      linux: /Linux/.test(ua) && !/Android/.test(ua),
    })
  } catch {
    return 'off' // no browser around (tests)
  }
}

const CONTRAST_KEY = 'egd-contrast'
const SCALE_KEY = 'egd-ui-scale'
/** Interface size in percent (Settings > Look); canvas tools keep their own zoom on top. */
export const UI_SCALES = { min: 80, max: 150 }

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

export const clampScale = (n: number) => Math.min(UI_SCALES.max, Math.max(UI_SCALES.min, Math.round(n / 5) * 5 || 100))

const useThemeStore = create<{ theme: Theme; glass: Glass; contrast: boolean; scale: number }>()(() => ({
  theme: initial(),
  glass: initialGlass(),
  contrast: stored(CONTRAST_KEY) === '1',
  scale: clampScale(Number(stored(SCALE_KEY) ?? 100)),
}))

export function applyTheme() {
  const { theme, glass, contrast, scale } = useThemeStore.getState()
  const root = document.documentElement
  root.dataset.theme = theme
  // Strong contrast is always solid: glass lets the background show through the text.
  if (glass === 'off' || contrast) delete root.dataset.glass
  else root.dataset.glass = glass
  if (contrast) root.dataset.contrast = ''
  else delete root.dataset.contrast
  void applyScale(scale)
}

let appliedScale = 100
async function applyScale(scale: number) {
  if (scale === appliedScale) return
  appliedScale = scale
  if ('__TAURI_INTERNALS__' in window) {
    // The webview's own zoom, like Ctrl+plus in a browser: canvases stay sharp and pointer maths stay right.
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    await getCurrentWebview()
      .setZoom(scale / 100)
      .catch(() => {})
  } else document.documentElement.style.zoom = scale === 100 ? '' : String(scale / 100)
}

export function setContrast(contrast: boolean) {
  useThemeStore.setState({ contrast })
  store(CONTRAST_KEY, contrast ? '1' : '0')
  applyTheme()
}

export function setUiScale(scale: number) {
  useThemeStore.setState({ scale: clampScale(scale) })
  store(SCALE_KEY, String(clampScale(scale)))
  applyTheme()
}

export const useContrast = () => useThemeStore((s) => s.contrast)
export const useUiScale = () => useThemeStore((s) => s.scale)

export function setGlass(glass: Glass) {
  useThemeStore.setState({ glass })
  try {
    localStorage.setItem(GLASS_KEY, glass)
  } catch {
    // ignore
  }
  applyTheme()
}

export const useGlass = () => useThemeStore((s) => s.glass)

export function toggleTheme() {
  const theme: Theme = useThemeStore.getState().theme === 'dark' ? 'light' : 'dark'
  useThemeStore.setState({ theme })
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // ignore
  }
  applyTheme()
}

export const useTheme = () => useThemeStore((s) => s.theme)
