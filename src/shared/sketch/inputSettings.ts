import { create } from 'zustand'
import { getFs } from '@/core/fs'
import { readVersioned, writeVersioned } from '@/core/project'
import { DEFAULT_QUICK_MENU, normalizeProfile, type ActionId, type QuickMenuProfile, type ShortcutMap } from './actions'
import { LINEAR, MAX_CURVE_POINTS, type CurvePoint } from './pen'

/**
 * Pen and key settings for drawing (Sketch Pro). They belong to this
 * computer (its tablet and keyboard), like the app settings, so they are
 * saved in the app data folder and are the same in every project.
 */
export interface InputSettings {
  /** App-wide pressure curve, applied to every pen. */
  pressureCurve: CurvePoint[]
  /** 0..1, averages the last points on top of each brush's StreamLine. */
  stabilization: number
  /** 0..1, removes shaky jitter. */
  motionFilter: number
  /**
   * 0..1, shaky hands: how much the pen may wobble while you hold still at the end of a
   * stroke and it still counts as holding (QuickShape snaps, then turns perfect).
   */
  steadyHold: number
  /** Changed shortcut keys; anything missing uses the default. */
  shortcuts: ShortcutMap
  /** What the pen's side buttons do. Tools are used while the button is held. */
  penButtons: { barrel: ActionId | 'none'; middle: ActionId | 'none' }
  quickMenus: QuickMenuProfile[]
  quickMenuId: string
  /** Two-finger pinch/turn and finger taps for undo/redo on touch screens. */
  touchGestures: boolean
  /** One finger draws; when off one finger pans. */
  fingerDraws: boolean
  /**
   * Values that replace every brush's own smoothing, stabilization and tether
   * while ticked (null = use the brush's own). Set in the side panel.
   */
  overrides: { streamline: number | null; stabilization: number | null; tether: number | null }
  /** Your own canvas sizes for new drawings. */
  canvasPresets: { name: string; width: number; height: number }[]
}

export const defaultInputSettings = (): InputSettings => ({
  pressureCurve: LINEAR,
  stabilization: 0,
  motionFilter: 0,
  steadyHold: 0.2,
  shortcuts: {},
  penButtons: { barrel: 'tool.hand', middle: 'quickMenu' },
  quickMenus: [DEFAULT_QUICK_MENU],
  quickMenuId: DEFAULT_QUICK_MENU.id,
  touchGestures: true,
  fingerDraws: true,
  overrides: { streamline: null, stabilization: null, tether: null },
  canvasPresets: [],
})

/** Fill in missing fields and fix broken ones, so older or hand-edited files keep working. */
export function normalizeInputSettings(saved: Partial<InputSettings>): InputSettings {
  const d = defaultInputSettings()
  const s = { ...d, ...saved }
  const curve = Array.isArray(s.pressureCurve) ? s.pressureCurve.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) : []
  const quickMenus = Array.isArray(s.quickMenus) && s.quickMenus.length ? s.quickMenus.map(normalizeProfile) : d.quickMenus
  return {
    ...s,
    steadyHold: typeof s.steadyHold === 'number' && Number.isFinite(s.steadyHold) ? Math.min(1, Math.max(0, s.steadyHold)) : d.steadyHold,
    pressureCurve: curve.length >= 2 && curve.length <= MAX_CURVE_POINTS ? curve : LINEAR,
    penButtons: { ...d.penButtons, ...s.penButtons },
    overrides: { ...d.overrides, ...s.overrides },
    canvasPresets: Array.isArray(s.canvasPresets) ? s.canvasPresets.filter((c) => c && typeof c.name === 'string' && c.width > 0 && c.height > 0) : [],
    quickMenus,
    quickMenuId: quickMenus.some((q) => q.id === s.quickMenuId) ? s.quickMenuId : quickMenus[0].id,
  }
}

async function settingsPath() {
  const fs = getFs()
  return fs.join(await fs.appDataDir(), 'sketch-input.json')
}

interface InputState extends InputSettings {
  loaded: boolean
  load(): Promise<void>
  update(patch: Partial<InputSettings>): void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export const useInputSettings = create<InputState>()((set, get) => ({
  ...defaultInputSettings(),
  loaded: false,
  async load() {
    if (get().loaded) return
    const saved = await readVersioned<Partial<InputSettings>>(await settingsPath(), () => ({})).catch(() => ({}))
    set({ ...normalizeInputSettings(saved), loaded: true })
  },
  update(patch) {
    set(patch)
    // Curves and sliders call this many times a second; write once they settle.
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const { loaded: _l, load: _a, update: _u, ...data } = get()
      void settingsPath().then((p) => writeVersioned(p, data))
    }, 400)
  },
}))

/** How far (screen px) the pen may wobble and still count as holding still: 4 px steady, up to 40 px shaky. */
export const holdTolerance = (steadyHold = useInputSettings.getState().steadyHold) => 4 + steadyHold * 36

/** One click for shaky hands or a jittery tablet: more smoothing, jitter filter, and a forgiving hold. */
export const SHAKY_HANDS: Pick<InputSettings, 'stabilization' | 'motionFilter' | 'steadyHold'> = { stabilization: 0.45, motionFilter: 0.65, steadyHold: 0.7 }
