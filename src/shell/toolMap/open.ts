import { create } from 'zustand'
import type { Id } from '@/core/model'
import { useAppStore } from '@/core/state'

/**
 * Whether the Tool map (Tab) is open. While it is, no panel is active, so the tools behind it
 * ignore the keyboard; `panel` is the one that was active ("You are here") and gets focus back.
 */
export const useToolMap = create<{ open: boolean; panel: Id | null }>()(() => ({ open: false, panel: null }))

export function openToolMap() {
  if (useToolMap.getState().open) return
  const app = useAppStore.getState()
  useToolMap.setState({ open: true, panel: app.activePanelId })
  app.setActivePanel(null)
}

export function closeToolMap() {
  const { open, panel } = useToolMap.getState()
  if (!open) return
  const app = useAppStore.getState()
  if (app.activePanelId === null) app.setActivePanel(panel)
  useToolMap.setState({ open: false, panel: null })
}

export const toggleToolMap = () => (useToolMap.getState().open ? closeToolMap() : openToolMap())
