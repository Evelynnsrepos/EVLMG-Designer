import { useEffect, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { usePanelContext } from '@/core/state'

/**
 * v0.18 Hotwheel: the round menu (hold Q). Tools hand it their actions with `useHotwheel`;
 * tools that don't get their shortcuts and toolbar buttons instead (shell/hotwheel).
 */
export interface HotAction {
  id: string
  label: string
  /** A lucide icon, or the markup of the tool's own button icon. */
  icon?: LucideIcon | string
  run?(alt: boolean): void
  /** Two halves in one slice, e.g. Undo | Redo or smaller | bigger. */
  halves?: [HotHalf, HotHalf]
  /** Shown as switched on. */
  on?: boolean
}

/** One half of a two-part slice; the glass look shows its icon instead of the words when it has one. */
export interface HotHalf {
  label: string
  icon?: LucideIcon | string
  run(): void
}

export interface HotwheelSource {
  actions(): HotAction[]
  /** The tool orders its own ring (Draw: its QuickMenu profiles), so the shortcuts window doesn't. */
  ownOrder?: boolean
  /** The inner ring's Smaller | Bigger slice changes this instead of the tool's interface size (Draw: brush size). */
  size?: { label: string; smaller(): void; bigger(): void }
  /** Curved sliders shown around the open wheel (Draw: brush size and opacity). Read when the wheel opens. */
  sliders?(): HotSlider[]
}

/** A value the wheel shows as a curved slider; dragging it calls `set` live. */
export interface HotSlider {
  id: string
  label: string
  min: number
  max: number
  /** Spread the values on a log scale (sizes). */
  log?: boolean
  get(): number
  set(value: number): void
  /** The value as text, e.g. "12 px" or "85%". */
  format(value: number): string
}

/** Panel id -> what its tool offers. Read when the wheel opens, so the actions are always current. */
export const hotwheelSources = new Map<string, HotwheelSource>()

/** Give the Hotwheel this tool's actions (its outer ring). */
export function useHotwheel(actions: () => HotAction[], ownOrder = false, size?: HotwheelSource['size'], sliders?: () => HotSlider[]) {
  const panel = usePanelContext()
  const ref = useRef(actions)
  const sizeRef = useRef(size)
  const slidersRef = useRef(sliders)
  useEffect(() => {
    ref.current = actions
    sizeRef.current = size
    slidersRef.current = sliders
  })
  useEffect(() => {
    if (!panel) return
    hotwheelSources.set(panel.id, {
      actions: () => ref.current(),
      ownOrder,
      get size() {
        return sizeRef.current
      },
      sliders: () => slidersRef.current?.() ?? [],
    })
    return () => void hotwheelSources.delete(panel.id)
  }, [panel, ownOrder])
}

/** Program-wide actions from plugins: they can be put on the inner ring (Settings, Hotwheel). Returns a remover. */
export const extraHotActions: HotAction[] = []
export function addHotwheelAction(action: HotAction) {
  extraHotActions.push(action)
  return () => void extraHotActions.splice(extraHotActions.indexOf(action), 1)
}

type Opener = (at?: { x: number; y: number }, hold?: { key?: string; button?: number }) => void
let opener: Opener = () => {}
/** Open the wheel (at the pointer unless given). The shell sets the real opener. */
export const openHotwheel: Opener = (at, hold) => opener(at, hold)
export const setHotwheelOpener = (fn: Opener) => void (opener = fn)
