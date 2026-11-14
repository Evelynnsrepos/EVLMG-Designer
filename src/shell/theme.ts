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

const useThemeStore = create<{ theme: Theme; glass: Glass }>()(() => ({ theme: initial(), glass: initialGlass() }))

export function applyTheme() {
  const { theme, glass } = useThemeStore.getState()
  const root = document.documentElement
  root.dataset.theme = theme
  if (glass === 'off') delete root.dataset.glass
  else root.dataset.glass = glass
}

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
