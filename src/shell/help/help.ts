import { create } from 'zustand'

/** Help state: the user guide dialog and the step-by-step tours. */

export type TourId = 'launcher' | 'editor' | 'pixel'

export interface TourStep {
  /** `data-tour` value of the element to highlight; no target = centered card. */
  target?: string
  title: string
  text: string
}

export const TOURS: Record<TourId, TourStep[]> = {
  launcher: [
    { title: 'Welcome to EDG', text: 'Eve.Lopment Games Designer: one program for designing your whole game. This short tour shows you around. You can skip it any time and replay it from Help.' },
    { target: 'new-project', title: 'Start a project', text: 'Each game is a project. Create one here and pick the tools you want in it.' },
    { target: 'open-folder', title: 'Open a project folder', text: 'Projects are normal folders. Open one you copied from another computer or a backup.' },
    { target: 'theme-toggle', title: 'Light or dark', text: 'Switch between the dark and light theme.' },
    { target: 'help', title: 'Help is always here', text: 'Report a problem or open the user guide here. F1 opens the guide directly; it explains every tool, and you can replay this tour from it.' },
  ],
  editor: [
    { title: 'Your project', text: 'This is the editor. Here is a quick look at how it works.' },
    { target: 'sidebar-list', title: 'Your tools', text: 'Click a tool to show it, Shift-click to open it next to the others. Tools with several documents list them underneath; click New to add one, right-click to rename.' },
    { target: 'workspace', title: 'Side by side', text: 'Shift-click a tool, or drag it from the sidebar onto an open panel, to split the screen.' },
    { target: 'workspace', title: 'Esc: arrange and close', text: 'Press Esc any time for Layout Mode: drag tools to new places, use the arrows to swap them, or the big X to close one. Press Esc again to go back to work.' },
    { target: 'add-component', title: 'More tools', text: 'Add any tool to this project whenever you need it. Right-click a tool to close it again.' },
    { target: 'workspace', title: 'Jump points', text: 'The crossing-arrows button in every tool\'s header adds jump points: one click from here to any tool, document or entry, and it lists what points back here. On boards, the jump tool (J) places them right on the board.' },
    { target: 'project-look', title: 'Make it yours', text: 'Give this project its own accent color, background and wallpaper.' },
    { target: 'help', title: 'Need help?', text: 'Report a problem here, or press F1 for the user guide. Everything saves automatically, so just start creating.' },
  ],
  pixel: [
    { title: 'Pixel Art in a minute', text: 'Every stroke lands on whole pixels, in exactly the colour you picked. Here is where everything is.' },
    { target: 'px-tools', title: 'Tools', text: 'Pencil (B), eraser (E), line (L), shapes, fill (G), eyedropper (I) and more. Hover a tool to see what it does. Clean lines keeps 1 px lines tidy.' },
    { target: 'px-palette', title: 'Colours', text: 'Click a swatch for the main colour, right-click for the second. Double-click a swatch to change it, and every pixel in that colour changes too. Ramp adds shades of a colour.' },
    { target: 'px-canvas', title: 'Draw', text: 'Left button paints the main colour, right button the second. Ctrl+wheel zooms. Alt-click picks a colour from the picture.' },
    { target: 'px-layers', title: 'Layers', text: 'Put outlines, colours and shading on their own layers. A reference layer is for tracing and never exported.' },
    { target: 'px-timeline', title: 'Animate', text: 'Add or copy frames, give each a duration, and turn on Onion skin to see the frames around. Tags name a run of frames like walk or attack. Enter plays.' },
    { target: 'px-files', title: 'Use it in your game', text: 'Export PNG, GIF, a sprite sheet or Godot SpriteFrames. Tilesets go straight to Level Layout. F1 has the full guide.' },
  ],
}

const seenKey = (tour: TourId) => `egd-tour-${tour}-done`

export function tourSeen(tour: TourId): boolean {
  try {
    return localStorage.getItem(seenKey(tour)) === '1'
  } catch {
    return true // no storage: never nag
  }
}

function markTourSeen(tour: TourId) {
  try {
    localStorage.setItem(seenKey(tour), '1')
  } catch {
    // ignore
  }
}

interface HelpState {
  /** Guide topic key (BASICS key or component type), or null when the guide is closed. */
  guide: string | null
  tour: TourId | null
  step: number
  /** The small Help window (report an issue, repository, guide). */
  report: boolean
  openReport(): void
  closeReport(): void
  openGuide(topic?: string): void
  closeGuide(): void
  startTour(tour: TourId): void
  setStep(step: number): void
  endTour(): void
}

export const useHelp = create<HelpState>()((set, get) => ({
  guide: null,
  tour: null,
  step: 0,
  report: false,
  openReport: () => set({ report: true }),
  closeReport: () => set({ report: false }),
  openGuide: (topic = 'basics') => set({ guide: topic, report: false }),
  closeGuide: () => set({ guide: null }),
  startTour: (tour) => set({ tour, step: 0, guide: null }),
  setStep: (step) => set({ step }),
  endTour: () => {
    const { tour } = get()
    if (tour) markTourSeen(tour)
    set({ tour: null, step: 0 })
  },
}))

/** Starts a tour the first time its screen shows. */
export function maybeStartTour(tour: TourId) {
  if (!tourSeen(tour) && !useHelp.getState().tour) useHelp.getState().startTour(tour)
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Where the tour card goes: right of the target, else below, else above; always inside the viewport. */
export function placeCard(target: Box | null, card: { width: number; height: number }, view: { width: number; height: number }, gap = 12) {
  const clamp = (v: number, max: number) => Math.max(gap, Math.min(v, max - gap))
  if (!target) return { left: (view.width - card.width) / 2, top: (view.height - card.height) / 2 }
  const right = target.left + target.width + gap
  if (right + card.width + gap <= view.width) {
    return { left: right, top: clamp(target.top, view.height - card.height) }
  }
  const below = target.top + target.height + gap
  const top = below + card.height + gap <= view.height ? below : target.top - card.height - gap
  return { left: clamp(target.left, view.width - card.width), top: clamp(top, view.height - card.height) }
}
