import { create } from 'zustand'
import { getFs } from '../fs'
import { readVersioned, writeVersioned } from '../project'

/** Spell check languages that ship with the app (src-tauri/dictionaries). */
export const SPELL_LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'de', name: 'German' },
] as const

/** App-wide settings for this computer (not part of any project), in the app data folder. */
export interface AppSettings {
  spellCheck: boolean
  spellLanguages: string[]
  /** "Add to dictionary" words, e.g. made-up names. Compared case-insensitively. */
  personalWords: string[]
  /** Use the downloaded AI helper for suggestions when it is installed. */
  aiHelper: boolean
  /** Which downloaded AI model checks grammar: see AI_MODELS in shared/spell/ai.ts. */
  aiModel: 'small' | 'better' | 'best'
  /** Show the optional Ask your project tool (v0.10); off until turned on in Settings. */
  askProject: boolean
  /** Pen tool on every canvas: line width in pixels and stabilizer strength 0..1. */
  penSize: number
  penSmoothing: number
  /** 0.1..1 */
  penOpacity: number
  /** v0.15: draw small pictures (pixel art tiles) with hard square pixels instead of smoothing them. */
  sharpPixels: boolean
  /** v0.15: changed shortcut keys by action id (see core/shortcuts.ts); anything missing uses the default. */
  shortcuts: Record<string, string[]>
  /** v0.18: size of each tool in percent (by tool type), e.g. bigger for a graphics tablet; missing = 100. */
  toolScale: Record<string, number>
  /** v0.18: the Hotwheel (hold Q). */
  hotwheel: HotwheelSettings
  /** 0.19: new Writer documents start with the Markdown Syntax switch on. */
  writerMarkdownSyntax: boolean
  /** v0.20: Hotkey hint mode, every button with a key shows it in its corner. */
  hotkeyHints: boolean
  /** v0.20: the user's own project presets for the new project wizard. */
  projectPresets: ProjectPreset[]
  /** v0.20: Git sync options for other Git hosts (GitLab, Gitea, ...). */
  git: GitSettings
}

/** A project preset the user made (v0.20): which tools a new project starts with, plus first tasks. */
export interface ProjectPreset {
  id: string
  name: string
  description: string
  components: string[]
  tasks: string[]
}

export interface GitSettings {
  /** Branch a new repository starts on. */
  branch: string
  /** Commit message for sync commits; {date} becomes the date and time. */
  commitMessage: string
  /** Extra "key=value" Git settings for every Git command, e.g. http.sslVerify=false for a home server. */
  config: string[]
  /** Opt-in, with a danger warning: also sync to public repositories. Off = private repositories only. */
  allowPublic: boolean
}

export const gitDefaults = (): GitSettings => ({ branch: 'main', commitMessage: 'EGD sync {date}', config: [], allowPublic: false })

export interface HotwheelSettings {
  /** The 6 inner slices (program actions), clockwise from the top; '' = empty. */
  inner: string[]
  /** Outer ring per tool type: up to 10 action ids. Missing = the tool's defaults. */
  outer: Record<string, string[]>
  size: 'S' | 'M' | 'L'
  /** Open with the pen's side button (it arrives as a right-click). */
  penButton: boolean
  /** Open by holding the right mouse button; a short right-click stays a right-click. */
  rightHold: boolean
  /** Open with the middle mouse button (it also pans in canvas tools). */
  middle: boolean
}

export const DEFAULT_INNER = ['close', 'scale', 'jump', 'layout', 'undo', 'search']
const hotwheelDefaults = (): HotwheelSettings => ({ inner: DEFAULT_INNER, outer: {}, size: 'M', penButton: false, rightHold: false, middle: false })

const defaults = (): AppSettings => ({ spellCheck: true, spellLanguages: ['en', 'de'], personalWords: [], aiHelper: true, aiModel: 'small', askProject: false, penSize: 3, penSmoothing: 0.5, penOpacity: 1, sharpPixels: true, shortcuts: {}, toolScale: {}, hotwheel: hotwheelDefaults(), writerMarkdownSyntax: false, hotkeyHints: false, projectPresets: [], git: gitDefaults() })

async function settingsPath() {
  const fs = getFs()
  return fs.join(await fs.appDataDir(), 'settings.json')
}

interface SettingsState extends AppSettings {
  loaded: boolean
  load(): Promise<void>
  update(patch: Partial<AppSettings>): void
  addWord(word: string): void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export const useSettings = create<SettingsState>()((set, get) => ({
  ...defaults(),
  loaded: false,
  async load() {
    if (get().loaded) return
    const saved = await readVersioned<Partial<AppSettings>>(await settingsPath(), defaults).catch(defaults)
    set({ ...defaults(), ...saved, hotwheel: { ...hotwheelDefaults(), ...saved.hotwheel }, git: { ...gitDefaults(), ...saved.git }, loaded: true })
  },
  update(patch) {
    set(patch)
    // Sliders call this many times a second; write once they settle.
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const { spellCheck, spellLanguages, personalWords, aiHelper, aiModel, askProject, penSize, penSmoothing, penOpacity, sharpPixels, shortcuts, toolScale, hotwheel, writerMarkdownSyntax, hotkeyHints, projectPresets, git } = get()
      void settingsPath().then((p) => writeVersioned(p, { spellCheck, spellLanguages, personalWords, aiHelper, aiModel, askProject, penSize, penSmoothing, penOpacity, sharpPixels, shortcuts, toolScale, hotwheel, writerMarkdownSyntax, hotkeyHints, projectPresets, git }))
    }, 400)
  },
  addWord(word) {
    const words = get().personalWords
    if (!words.some((w) => w.toLowerCase() === word.toLowerCase())) get().update({ personalWords: [...words, word].sort() })
  },
}))
