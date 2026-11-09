import { create } from 'zustand'
import { getFs } from '@/core/fs'
import { newId } from '@/core/model'
import { readVersioned, writeVersioned } from '@/core/project'
import { useProjectStore } from '@/core/state'
import type { Palette, Swatch } from './color'

/**
 * Colour palettes, colour history and the second colour (Sketch Pro). Like the brush
 * library they belong to this computer, not a project; saved in the app data folder.
 * v0.28: while a project is open, its own palette (meta.palette) comes first as "This project".
 */

export const PROJECT_PALETTE_ID = 'project'
const own = (ps: Palette[]) => ps.filter((p) => p.id !== PROJECT_PALETTE_ID)
function withProject(ps: Palette[]): Palette[] {
  const meta = useProjectStore.getState().meta
  return meta ? [{ id: PROJECT_PALETTE_ID, name: 'This project (shared)', colors: meta.palette ?? [] }, ...own(ps)] : own(ps)
}

const MAX_HISTORY = 10

const starter = (): Palette[] => [
  {
    id: 'basic',
    name: 'Basic',
    colors: ['#111111', '#ffffff', '#e5484d', '#f08c2e', '#f5d90a', '#30a46c', '#3e8ef7', '#8e6cf0', '#d6409f', '#8d6e63'].map((hex) => ({ hex })),
  },
  {
    id: 'skin',
    name: 'Skin tones',
    colors: ['#ffe0c7', '#f6c7a5', '#e8a97f', '#c98a5d', '#a86b43', '#7d4b2e', '#5a3420', '#3b2116'].map((hex) => ({ hex })),
  },
]

interface Saved {
  palettes: Palette[]
  defaultId: string
  history: string[]
  secondary: string
  view: 'compact' | 'cards'
}

interface PaletteState extends Saved {
  loaded: boolean
  load(): Promise<void>
  /** Remember a colour that was used (newest first). */
  used(hex: string): void
  setSecondary(hex: string): void
  add(name: string, colors: Swatch[]): string
  update(id: string, patch: Partial<Omit<Palette, 'id'>>): void
  remove(id: string): void
  setDefault(id: string): void
  setView(view: Saved['view']): void
}

async function palettesPath() {
  const fs = getFs()
  return fs.join(await fs.appDataDir(), 'palettes.json')
}

export const usePalettes = create<PaletteState>()((set, get) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const { palettes, defaultId, history, secondary, view } = get()
      void palettesPath().then((p) => writeVersioned(p, { palettes: own(palettes), defaultId, history, secondary, view }))
    }, 400)
  }
  const change = (fn: (s: PaletteState) => Partial<PaletteState>) => {
    set(fn)
    save()
  }
  return {
    palettes: starter(),
    defaultId: 'basic',
    history: [],
    secondary: '#ffffff',
    view: 'compact',
    loaded: false,
    async load() {
      if (get().loaded) return
      const saved = await readVersioned<Partial<Saved> | null>(await palettesPath(), () => null).catch(() => null)
      if (saved) set({ ...saved, palettes: saved.palettes?.length ? saved.palettes : starter() })
      set((s) => ({ palettes: withProject(s.palettes) }))
      set({ loaded: true })
    },
    used(hex) {
      if (get().history[0] === hex) return
      change((s) => ({ history: [hex, ...s.history.filter((h) => h !== hex)].slice(0, MAX_HISTORY) }))
    },
    setSecondary(secondary) {
      change(() => ({ secondary }))
    },
    add(name, colors) {
      const id = newId()
      change((s) => ({ palettes: [...s.palettes, { id, name, colors }] }))
      return id
    },
    update(id, patch) {
      if (id === PROJECT_PALETTE_ID) return void (patch.colors && useProjectStore.getState().updateMeta({ palette: patch.colors }))
      change((s) => ({ palettes: s.palettes.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
    },
    remove(id) {
      if (id === PROJECT_PALETTE_ID) return useProjectStore.getState().updateMeta({ palette: [] })
      change((s) => ({ palettes: s.palettes.filter((p) => p.id !== id), defaultId: s.defaultId === id ? (s.palettes.find((p) => p.id !== id)?.id ?? '') : s.defaultId }))
    },
    setDefault(defaultId) {
      change(() => ({ defaultId }))
    },
    setView(view) {
      change(() => ({ view }))
    },
  }
})

// The project palette follows the open project, and changes from other devices.
useProjectStore.subscribe((s, prev) => {
  if (s.meta?.palette !== prev.meta?.palette || !s.meta !== !prev.meta) usePalettes.setState((p) => ({ palettes: withProject(p.palettes) }))
})
