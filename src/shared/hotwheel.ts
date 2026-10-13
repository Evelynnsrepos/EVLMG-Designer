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
  halves?: [{ label: string; run(): void }, { label: string; run(): void }]
  /** Shown as switched on. */
  on?: boolean
}

export interface HotwheelSource {
  actions(): HotAction[]
  /** The tool orders its own ring (Draw: its QuickMenu profiles), so the shortcuts window doesn't. */
  ownOrder?: boolean
}

/** Panel id -> what its tool offers. Read when the wheel opens, so the actions are always current. */
export const hotwheelSources = new Map<string, HotwheelSource>()

/** Give the Hotwheel this tool's actions (its outer ring). */
export function useHotwheel(actions: () => HotAction[], ownOrder = false) {
  const panel = usePanelContext()
  const ref = useRef(actions)
  useEffect(() => {
    ref.current = actions
  })
  useEffect(() => {
    if (!panel) return
    hotwheelSources.set(panel.id, { actions: () => ref.current(), ownOrder })
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
