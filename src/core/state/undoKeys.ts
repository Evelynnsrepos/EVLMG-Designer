import { useEffect, useRef } from 'react'
import { isShortcut } from '../shortcuts'

export type UndoRedoAction = 'undo' | 'redo'

interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  target: EventTarget | null
  defaultPrevented: boolean
}

/** Text fields keep their own native undo, so app-level undo skips them. */
export function isTextField(target: EventTarget | null): boolean {
  const el = target as (Partial<HTMLElement> & { tagName?: string; type?: string }) | null
  if (!el || typeof el.tagName !== 'string') return false
  if (el.isContentEditable) return true
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName !== 'INPUT') return false
  return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(el.type ?? 'text')
}

/** Ctrl+Z = undo; Ctrl+Y or Ctrl+Shift+Z = redo (Cmd on macOS), or the user's own keys. Null for other keys or inside text fields. */
export function undoRedoAction(e: KeyLike): UndoRedoAction | null {
  if (e.defaultPrevented || isTextField(e.target)) return null
  // v0.15: the keys can be changed in Settings.
  if (isShortcut(e, 'app.undo')) return 'undo'
  if (isShortcut(e, 'app.redo')) return 'redo'
  return null
}

/**
 * Bind Ctrl+Z / Ctrl+Y to a component's undo/redo while its panel is active
 * (spec 3.5). Pass the object returned by `useDocument`, or your own.
 *
 *   const doc = useDocument(...)
 *   useUndoRedoKeys(doc, active)
 */
export function useUndoRedoKeys(target: { undo(): void; redo(): void }, active: boolean) {
  const ref = useRef(target)
  useEffect(() => {
    ref.current = target
  })
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const action = undoRedoAction(e)
      if (!action) return
      e.preventDefault()
      ref.current[action]()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}
