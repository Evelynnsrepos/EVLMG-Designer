/**
 * Sketch actions (Sketch Pro): everything a shortcut key, a pen button or a
 * QuickMenu slot can do. The editor supplies what each action does; this
 * module only names them and matches keys.
 */

import { comboOf, formatCombo } from '@/core/shortcuts'

export { comboOf, formatCombo }

export const ACTIONS = [
  { id: 'tool.brush', label: 'Brush', keys: ['b'] },
  { id: 'tool.eraser', label: 'Eraser', keys: ['e'] },
  { id: 'tool.smudge', label: 'Smudge', keys: ['s'] },
  { id: 'tool.lasso', label: 'Lasso selection', keys: ['l'] },
  { id: 'tool.rect', label: 'Rectangle selection', keys: ['m'] },
  { id: 'tool.move', label: 'Move', keys: ['v'] },
  { id: 'tool.eyedropper', label: 'Eyedropper', keys: ['i'] },
  { id: 'tool.hand', label: 'Pan', keys: ['h'] },
  { id: 'tool.text', label: 'Text', keys: ['t'] },
  { id: 'swapEraser', label: 'Switch brush / eraser', keys: ['x'] },
  { id: 'undo', label: 'Undo', keys: ['ctrl+z'] },
  { id: 'redo', label: 'Redo', keys: ['ctrl+y', 'ctrl+shift+z'] },
  { id: 'sizeUp', label: 'Bigger brush', keys: [']'] },
  { id: 'sizeDown', label: 'Smaller brush', keys: ['['] },
  { id: 'deselect', label: 'Deselect', keys: ['ctrl+d'] },
  { id: 'clear', label: 'Clear selection or layer', keys: ['delete', 'backspace'] },
  { id: 'fill', label: 'Fill with color', keys: ['shift+f'] },
  { id: 'newLayer', label: 'New layer', keys: ['ctrl+shift+n'] },
  { id: 'flipLayerX', label: 'Flip layer horizontally', keys: ['ctrl+shift+h'] },
  { id: 'flipLayerY', label: 'Flip layer vertically', keys: ['ctrl+shift+v'] },
  { id: 'fit', label: 'Fit to view', keys: ['0'] },
  { id: 'rotateLeft', label: 'Turn view left', keys: [','] },
  { id: 'rotateRight', label: 'Turn view right', keys: ['.'] },
  { id: 'flipView', label: 'Mirror view', keys: ['shift+h'] },
  // v0.18: the Hotwheel replaces the QuickMenu; Q opens it everywhere (app shortcut), so Draw has no key of its own.
  { id: 'quickMenu', label: 'Hotwheel', keys: [] },
  { id: 'nextMenu', label: 'Next Hotwheel profile', keys: [] },
  { id: 'pair.size', label: 'Brush size (smaller | bigger)', keys: [] },
  { id: 'pair.turn', label: 'Turn view (left | right)', keys: [] },
  { id: 'pair.undo', label: 'Undo | Redo', keys: [] },
  { id: 'shortcuts', label: 'Keyboard shortcuts', keys: ['shift+?', 'ctrl+/'] },
  { id: 'guides', label: 'Show / hide drawing guide', keys: ['g'] },
  { id: 'assist', label: 'Drawing Assist on / off', keys: ['shift+g'] },
  { id: 'export', label: 'Export as PNG', keys: ['ctrl+e'] },
  { id: 'inputSettings', label: 'Pen and keys settings', keys: ['ctrl+,'] },
  // Canvas, time-lapse and files (feat/sketch-files)
  { id: 'canvasSettings', label: 'Canvas: crop, resize and info', keys: ['ctrl+alt+c'] },
  { id: 'flipCanvasX', label: 'Flip canvas horizontally', keys: [] },
  { id: 'flipCanvasY', label: 'Flip canvas vertically', keys: [] },
  { id: 'importFile', label: 'Import a file', keys: ['ctrl+i'] },
  { id: 'timelapse', label: 'Time-lapse replay', keys: ['ctrl+alt+t'] },
  { id: 'companion', label: 'Reference Companion', keys: [] },
  { id: 'adjustments', label: 'Adjustments menu', keys: ['ctrl+u'] },
  { id: 'liquify', label: 'Liquify', keys: ['shift+l'] },
  { id: 'clone', label: 'Clone', keys: ['c'] },
] as const satisfies readonly { id: string; label: string; keys: readonly string[] }[]

export type ActionId = (typeof ACTIONS)[number]['id']

export const actionLabel = (id: ActionId) => ACTIONS.find((a) => a.id === id)?.label ?? id

/** Tool actions; on a pen button they mean "use this tool while the button is held". */
export const toolOf = (id: ActionId) => (id.startsWith('tool.') ? id.slice(5) : null)

/** User changes on top of the defaults: action -> its keys ([] = no key). */
export type ShortcutMap = Partial<Record<ActionId, string[]>>

export function keysFor(id: ActionId, custom: ShortcutMap): readonly string[] {
  return custom[id] ?? ACTIONS.find((a) => a.id === id)?.keys ?? []
}

/** The action a key event runs, if any. */
export function matchShortcut(e: Parameters<typeof comboOf>[0], custom: ShortcutMap): ActionId | null {
  const combo = comboOf(e)
  if (!combo) return null
  return ACTIONS.find((a) => keysFor(a.id, custom).includes(combo))?.id ?? null
}

/** Other actions already using `combo`, to warn before assigning it twice. */
export function conflicts(combo: string, except: ActionId, custom: ShortcutMap): ActionId[] {
  return ACTIONS.filter((a) => a.id !== except && keysFor(a.id, custom).includes(combo)).map((a) => a.id)
}

// ---- QuickMenu ---------------------------------------------------------------

export const QUICK_SLOTS = 10

/** Slots that hold two actions, one per half (Hotwheel). */
export const PAIRS: Partial<Record<ActionId, [ActionId, ActionId]>> = { 'pair.size': ['sizeDown', 'sizeUp'], 'pair.turn': ['rotateLeft', 'rotateRight'], 'pair.undo': ['undo', 'redo'] }

export interface QuickMenuProfile {
  id: string
  name: string
  /** Exactly QUICK_SLOTS entries, clockwise from the top; null = empty slot. */
  slots: (ActionId | null)[]
}

export const DEFAULT_QUICK_MENU: QuickMenuProfile = {
  id: 'default',
  name: 'Basic',
  slots: ['pair.size', 'pair.undo', 'pair.turn', 'tool.brush', 'tool.eraser', 'tool.smudge', 'tool.lasso', 'tool.move', 'tool.eyedropper', 'newLayer'],
}
/** The six-slot QuickMenu default before v0.18; a profile still on it gets the new default. */
const OLD_DEFAULT = ['undo', 'redo', 'swapEraser', 'newLayer', 'flipView', 'fit']

/** Clean up a saved profile: right number of slots, unknown actions removed. */
export function normalizeProfile(p: Partial<QuickMenuProfile> & { id: string }): QuickMenuProfile {
  const valid = new Set<string>(ACTIONS.map((a) => a.id))
  if (p.id === DEFAULT_QUICK_MENU.id && OLD_DEFAULT.every((id, i) => p.slots?.[i] === id) && !p.slots?.slice(6).some(Boolean)) p = { ...p, slots: DEFAULT_QUICK_MENU.slots }
  const slots = Array.from({ length: QUICK_SLOTS }, (_, i) => {
    const s = p.slots?.[i]
    return s && valid.has(s) ? s : null
  })
  return { id: p.id, name: p.name || 'Menu', slots }
}
