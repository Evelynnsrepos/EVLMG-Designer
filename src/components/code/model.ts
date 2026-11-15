import type { Id } from '@/core/model'

/**
 * A code workspace: which game folder it shows and which files are open. The code itself stays in the
 * game folder on disk (it is never copied into the project), so git stays the way code is shared.
 * Every field is optional for readers: the mobile app and older versions only need `folder` and `tabs`.
 */
export interface CodeDoc {
  /** The game folder (the one with `project.godot`) as the person who set it up picked it. Each computer can
   *  point somewhere else (remembered on that computer only), since teammates keep the game in different places. */
  folder: { path: string }
  /** Open files, paths inside the game folder with `/` between the parts. */
  tabs: { id: Id; path: string }[]
  activeId: Id | null
}

export const createCodeDoc = (): CodeDoc => ({ folder: { path: '' }, tabs: [], activeId: null })

/** Settings for this computer only (where Godot is, the typing effect), kept out of the project. */
export interface LocalCode {
  godot: string
  effect: 'off' | 'subtle' | 'full'
  sound: boolean
  /** Game folder on this computer by workspace id, when it differs from the one in the project. */
  folders: Record<string, string>
}

const KEY = 'egd-code'
const DEFAULT: LocalCode = { godot: '', effect: 'off', sound: false, folders: {} }

export function loadLocal(): LocalCode {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LocalCode>) }
  } catch {
    return DEFAULT
  }
}

export function saveLocal(patch: Partial<LocalCode>): LocalCode {
  const next = { ...loadLocal(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // private window or full storage: the choice lasts until the app closes
  }
  return next
}

/** `file:///home/me/game/main.gd`, also for Windows paths (`C:\game` → `file:///C:/game`). */
export function fileUri(path: string): string {
  const p = path.replace(/\\/g, '/')
  return 'file://' + (p.startsWith('/') ? '' : '/') + encodeURI(p).replace(/#/g, '%23')
}

/** The path inside the game folder for a file URI or `res://` path, or null when it is somewhere else. */
export function relPath(folder: string, uriOrRes: string): string | null {
  if (uriOrRes.startsWith('res://')) return uriOrRes.slice(6)
  const root = fileUri(folder).replace(/\/$/, '') + '/'
  // Windows drive letters can differ in case between us and the engine.
  return uriOrRes.toLowerCase().startsWith(root.toLowerCase()) ? decodeURIComponent(uriOrRes.slice(root.length)) : null
}

/** Places in the engine's output that point at a line of code, e.g. `at: _ready (res://player.gd:12)`. */
export function outputLinks(line: string): { path: string; line: number; from: number; to: number }[] {
  return [...line.matchAll(/res:\/\/([^:()\s"']+):(\d+)/g)].map((m) => ({ path: m[1], line: Number(m[2]), from: m.index, to: m.index + m[0].length }))
}

/** Files the editor opens as text; everything else in the tree (pictures, sounds, imports) is shown greyed. */
export const isTextFile = (name: string) => /\.(gd|gdshader|gdshaderinc|tscn|tres|godot|cfg|json|md|txt|csv|cs|ini|toml|ya?ml|xml|svg|import|gitignore|gitattributes)$/i.test(name) || /^\.git(ignore|attributes)$/.test(name)

/** Folders that only hold what the engine generates. */
export const isHiddenEntry = (name: string) => name === '.godot' || name === '.git' || name === '.import' || name.endsWith('.uid')
