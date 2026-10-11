import { useEffect, useState } from 'react'
import { useAppStore } from '@/core/state'
import { maybeStartTour } from '../help/help'
import { Workspace } from '../workspace/Workspace'
import { openInitialLayout } from './actions'
import { CommandPalette } from './CommandPalette'
import { DesignBookHost } from '../designBook/DesignBook'
import { PinThreadHost } from '@/shared/reviews'
import { HistoryRecorder } from '../history/HistoryRecorder'
import { EngineExportHost } from '../engineExport/EngineExport'
import { ProjectWallpaper, useProjectTheme } from './projectTheme'
import { Sidebar } from './Sidebar'
import { clearJumpHistory, jumpBack, jumpForward } from '@/shared/entityList/navigation'
import './editor.css'

/** Project editor: sidebar + tiling workspace (spec 6, 7). */
export function EditorScreen() {
  useProjectTheme()
  useEffect(() => {
    clearJumpHistory()
    openInitialLayout()
    maybeStartTour('editor')
  }, [])

  useEffect(() => {
    // ED-5/ED-7: Esc toggles Layout Mode unless a tool already handled it.
    // Components that use Esc must call event.preventDefault() in their own handler.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissEscHint()
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.defaultPrevented) {
        e.preventDefault()
        if (e.key === 'ArrowLeft') jumpBack()
        else jumpForward()
        return
      }
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const app = useAppStore.getState()
      app.setLayoutMode(!app.layoutMode)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="editor">
      <ProjectWallpaper />
      <Sidebar />
      <Workspace />
      <CommandPalette />
      <DesignBookHost />
      <PinThreadHost />
      <HistoryRecorder />
      <EngineExportHost />
      <EscHint />
    </div>
  )
}

const ESC_HINT = 'egd-esc-hint-done'
const escHintListeners = new Set<() => void>()
function dismissEscHint() {
  try {
    localStorage.setItem(ESC_HINT, '1')
  } catch {
    // only a hint
  }
  escHintListeners.forEach((l) => l())
}

/** v0.13: until Esc was used once, a small reminder that it rearranges and closes tools. */
function EscHint() {
  const [shown, setShown] = useState(() => {
    try {
      return localStorage.getItem(ESC_HINT) !== '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    const hide = () => setShown(false)
    escHintListeners.add(hide)
    return () => void escHintListeners.delete(hide)
  }, [])
  if (!shown) return null
  return (
    <div className="esc-hint" role="note">
      <kbd>Esc</kbd> rearranges and closes tools: drag them around, swap them with the arrows or close them with the X. Esc again to go back.
      <button className="icon-btn" aria-label="Got it" title="Got it" onClick={dismissEscHint}>
        ✕
      </button>
    </div>
  )
}
