import { useEffect } from 'react'
import { formatCombo } from '@/core/shortcuts'
import { useSettings } from '@/core/state'

/**
 * Hotkey hint mode (v0.20): with the switch on, every button that has a key shows it small in its
 * bottom-left corner. Buttons only carry the key (`{...keyHint(combo)}`); index.css draws it.
 */
export function keyHint(combo: string | undefined): { 'data-key'?: string } {
  return combo ? { 'data-key': formatCombo(combo) } : {}
}

/** Mirrors the setting onto <html data-hotkey-hints> so the CSS can show or hide every hint at once. */
export function useHotkeyHintMode() {
  const on = useSettings((s) => s.hotkeyHints)
  useEffect(() => {
    document.documentElement.toggleAttribute('data-hotkey-hints', on)
  }, [on])
}
