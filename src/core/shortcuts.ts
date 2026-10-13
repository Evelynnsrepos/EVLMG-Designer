import { useSettings } from './state/settingsStore'

/**
 * v0.15: the app's keyboard shortcuts, with the keys users changed in Settings on top.
 * Keys are written like "ctrl+shift+z" (see comboOf). Draw has its own list (shared/sketch/actions.ts).
 */
export const SHORTCUT_GROUPS = [
  {
    name: 'Everywhere',
    items: [
      { id: 'app.search', label: 'Search and commands', keys: ['ctrl+k'] },
      { id: 'app.hotwheel', label: 'Hotwheel (hold, or tap to keep it open)', keys: ['q'] },
      { id: 'app.help', label: 'User guide', keys: ['f1'] },
      { id: 'app.layout', label: 'Layout Mode on / off', keys: ['esc'] },
      { id: 'app.back', label: 'Back to the last entry', keys: ['alt+left'] },
      { id: 'app.forward', label: 'Forward again', keys: ['alt+right'] },
      { id: 'app.undo', label: 'Undo', keys: ['ctrl+z'] },
      { id: 'app.redo', label: 'Redo', keys: ['ctrl+y', 'ctrl+shift+z'] },
    ],
  },
  {
    name: 'Boards (Moodboard, Brainstorm, Map, Story, Timeline…)',
    items: [
      { id: 'board.select', label: 'Select', keys: ['v'] },
      { id: 'board.hand', label: 'Pan', keys: ['h'] },
      { id: 'board.pen', label: 'Pen', keys: ['p'] },
      { id: 'board.eraser', label: 'Eraser', keys: ['e'] },
      { id: 'board.rect', label: 'Rectangle', keys: ['r'] },
      { id: 'board.ellipse', label: 'Ellipse', keys: ['o'] },
      { id: 'board.line', label: 'Line', keys: ['l'] },
      { id: 'board.arrow', label: 'Arrow', keys: ['a'] },
      { id: 'board.note', label: 'Sticky note', keys: ['n'] },
      { id: 'board.text', label: 'Text', keys: ['t'] },
      { id: 'board.jump', label: 'Jump point', keys: ['j'] },
    ],
  },
  {
    name: 'Level Layout',
    items: [
      { id: 'level.paint', label: 'Paint', keys: ['b'] },
      { id: 'level.select', label: 'Select and move', keys: ['m'] },
      { id: 'level.fill', label: 'Fill', keys: ['g'] },
      { id: 'level.erase', label: 'Erase', keys: ['e'] },
      { id: 'level.note', label: 'Note', keys: ['n'] },
      { id: 'level.block', label: 'Blocked', keys: ['x'] },
    ],
  },
  {
    name: 'Pixel Art',
    items: [
      { id: 'pixel.pencil', label: 'Pencil', keys: ['b'] },
      { id: 'pixel.eraser', label: 'Eraser', keys: ['e'] },
      { id: 'pixel.line', label: 'Line', keys: ['l'] },
      { id: 'pixel.curve', label: 'Curve', keys: ['c'] },
      { id: 'pixel.lassofill', label: 'Lasso fill', keys: ['f'] },
      { id: 'pixel.gradient', label: 'Dithered gradient', keys: ['d'] },
      { id: 'pixel.spray', label: 'Spray', keys: ['a'] },
      { id: 'pixel.text', label: 'Text', keys: ['t'] },
      { id: 'pixel.rect', label: 'Rectangle', keys: ['u'] },
      { id: 'pixel.ellipse', label: 'Ellipse', keys: ['o'] },
      { id: 'pixel.fill', label: 'Fill', keys: ['g'] },
      { id: 'pixel.picker', label: 'Eyedropper', keys: ['i'] },
      { id: 'pixel.shade', label: 'Shade brush', keys: ['s'] },
      { id: 'pixel.select', label: 'Select a rectangle', keys: ['m'] },
      { id: 'pixel.lasso', label: 'Lasso', keys: ['k'] },
      { id: 'pixel.wand', label: 'Magic wand', keys: ['w'] },
      { id: 'pixel.move', label: 'Move', keys: ['v'] },
      { id: 'pixel.swap', label: 'Swap the two colours', keys: ['x'] },
      { id: 'pixel.bigger', label: 'Bigger pencil', keys: [']'] },
      { id: 'pixel.smaller', label: 'Smaller pencil', keys: ['['] },
      { id: 'pixel.prev', label: 'Previous frame', keys: [','] },
      { id: 'pixel.next', label: 'Next frame', keys: ['.'] },
      { id: 'pixel.play', label: 'Play / stop', keys: ['enter'] },
      { id: 'pixel.mode', label: 'Tiles / map (tilesets)', keys: ['tab'] },
    ],
  },
] as const

export type ShortcutId = (typeof SHORTCUT_GROUPS)[number]['items'][number]['id']

const DEFAULTS: Record<string, readonly string[]> = Object.fromEntries(SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.keys])))

export const defaultKeys = (id: string): readonly string[] => DEFAULTS[id] ?? []

/** The keys for an action: the user's own when they changed it, else the default. */
export const keysOf = (id: string, custom: Record<string, string[]> = useSettings.getState().shortcuts): readonly string[] => custom[id] ?? defaultKeys(id)

const NAMES: Record<string, string> = { ' ': 'space', escape: 'esc', arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down' }

/** "ctrl+shift+z" for a key event; null for a bare modifier key. Cmd counts as Ctrl. */
export function comboOf(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  const k = e.key.toLowerCase()
  if (['control', 'meta', 'alt', 'shift', 'altgraph', 'os'].includes(k)) return null
  const mods = [e.ctrlKey || e.metaKey ? 'ctrl' : '', e.altKey ? 'alt' : '', e.shiftKey ? 'shift' : ''].filter(Boolean)
  return [...mods, NAMES[k] ?? k].join('+')
}

/** True when the key event is one of the action's keys. */
export function isShortcut(e: Parameters<typeof comboOf>[0] & { target?: EventTarget | null }, id: string): boolean {
  // While Settings records a new key, that key does nothing else.
  if ((e.target as Element | null)?.closest?.('[data-key-capture]')) return false
  const combo = comboOf(e)
  return !!combo && keysOf(id).includes(combo)
}

/** A board tool's key: the user's own for the common tools, else the tool's built-in letter. */
export function boardShortcut(toolId: string, builtIn: string | undefined): string | undefined {
  const own = useSettings.getState().shortcuts[`board.${toolId}`]
  return own ? own[0] : builtIn?.toLowerCase()
}

/** Readable key name, e.g. "Ctrl+Shift+Z". */
export function formatCombo(combo: string): string {
  return combo
    .split('+')
    .map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join('+')
}
