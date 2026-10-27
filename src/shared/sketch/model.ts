import { newId, type AssetPath, type Id } from '@/core/model'

/**
 * Raster sketch documents (v0.5), shared by the Sketch tool and Design Language.
 * Pixels live in the project's assets as one PNG per layer (`assets/images/<uuid>.png`);
 * the JSON only holds the layer stack, so documents stay small and sync well.
 */

import type { BlendMode } from './blend'
import type { DrawingGuide } from './guides'
import type { AnimationSettings, PageSettings } from './assist'
import type { AdjustValues } from './adjust/filters'
import type { SketchText } from './text'

export { BLEND_MODES, type BlendMode } from './blend'

export interface SketchLayer {
  id: Id
  name: string
  visible: boolean
  /** 0..1 */
  opacity: number
  blend: BlendMode
  /** Paint only where the layer already has pixels. */
  alphaLock: boolean
  /** Show only inside the pixels of the layer below (clipping mask). */
  clip: boolean
  /** PNG with the layer's pixels; null = empty. */
  image: AssetPath | null
  // Sketch Pro layer features; all optional so older drawings open unchanged.
  /** 'group' holds other layers (they point to it with `parent`); 'mask' hides the layer below where it is dark. */
  kind?: 'group' | 'mask' | 'adjust'
  /** The group this layer is in; null/missing = top level. */
  parent?: Id | null
  /** Group folded shut in the layer list. */
  collapsed?: boolean
  /** No painting or editing. */
  locked?: boolean
  /** Fills, ColorDrop and the magic wand look at this layer's lines. */
  reference?: boolean
  /** Shown while drawing, left out of exports. */
  private?: boolean
  /** Text layer: the text is drawn into the layer again whenever this changes (Sketch Pro). */
  text?: SketchText
  /** Adjustment layer (v0.13): changes the colours of everything below it, without changing those layers. */
  adjust?: LayerAdjust
}

/** The colour adjustments a layer can be: hue/saturation/brightness, colour balance, curves or a gradient map. */
export interface LayerAdjust {
  id: 'hsb' | 'balance' | 'curves' | 'gradient'
  values: AdjustValues
}

/** An image floating over the canvas to draw from; not part of the picture. */
export interface SketchReference {
  id: Id
  image: AssetPath
  /** Screen position and width of the floating window, in px. */
  x: number
  y: number
  width: number
}

export interface SketchDoc {
  width: number
  height: number
  /** null = transparent. */
  backgroundColor: string | null
  /** Bottom to top. */
  layers: SketchLayer[]
  references: SketchReference[]
  /** The picture without background as a transparent PNG, for placing it elsewhere (Moodboard stickers). */
  sticker?: AssetPath | null
  /** Colour space of the canvas; missing = sRGB. Display P3 only where the webview supports it. */
  colorSpace?: 'srgb' | 'display-p3'
  /** Saved selections, each a PNG mask in the project's assets. */
  selections?: { id: Id; name: string; image: AssetPath }[]
  /** Drawing guide and the layers with Drawing Assist (Sketch Pro); missing = no guide. */
  guide?: DrawingGuide
  /** 0.24: a card canvas: bleed, safe margin and corner radius in canvas pixels, shown as guide lines. */
  cardGuides?: { bleed: number; safe: number; corner: number; visible?: boolean }
  // Sketch Pro canvas, time-lapse and files (feat/sketch-files); all optional.
  /** Strokes and drawing time, shown in Canvas info; missing = nothing counted yet. */
  stats?: { strokes: number; timeMs: number }
  /** Time-lapse: small frames in the project's assets, one every few strokes. Missing = recording on, nothing yet. */
  timelapse?: { enabled?: boolean; frames: AssetPath[] }
  /** Reference Companion: a floating window with the whole canvas or an image; missing = closed. */
  companion?: { mode: 'canvas' | 'image'; image?: AssetPath | null; x: number; y: number; width: number }
  /** Font files imported into this drawing, for text layers (Sketch Pro). */
  fonts?: { id: Id; family: string; file: AssetPath }[]
  /** Animation Assist: every top-level layer or group is a frame (Sketch Pro). */
  animation?: AnimationSettings
  /** Page Assist: every top-level layer or group is a page (Sketch Pro). */
  pages?: PageSettings
}

export const newLayer = (name: string): SketchLayer => ({
  id: newId(),
  name,
  visible: true,
  opacity: 1,
  blend: 'source-over',
  alphaLock: false,
  clip: false,
  image: null,
})

export const createSketchDoc = (width = 1920, height = 1080): SketchDoc => ({
  width,
  height,
  backgroundColor: '#ffffff',
  layers: [newLayer('Layer 1')],
  references: [],
})

export const CANVAS_PRESETS = [
  { label: 'Full HD 1920 × 1080', width: 1920, height: 1080 },
  { label: '4K 3840 × 2160', width: 3840, height: 2160 },
  { label: 'Large square 4096 × 4096', width: 4096, height: 4096 },
  { label: 'Poster 8192 × 8192', width: 8192, height: 8192 },
  { label: 'Square 2048 × 2048', width: 2048, height: 2048 },
  { label: 'Portrait A4 2480 × 3508', width: 2480, height: 3508 },
  { label: 'Icon 512 × 512', width: 512, height: 512 },
  { label: 'Sprite 256 × 256', width: 256, height: 256 },
] as const

export function nextLayerName(doc: SketchDoc): string {
  let n = doc.layers.length + 1
  while (doc.layers.some((l) => l.name === `Layer ${n}`)) n++
  return `Layer ${n}`
}

export function updateLayer(doc: SketchDoc, id: Id, patch: Partial<SketchLayer>): SketchDoc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }
}

/** Move a layer one step up (+1) or down (-1) in the stack. */
export function moveLayer(doc: SketchDoc, id: Id, dir: 1 | -1): SketchDoc {
  const i = doc.layers.findIndex((l) => l.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= doc.layers.length) return doc
  const layers = [...doc.layers]
  ;[layers[i], layers[j]] = [layers[j], layers[i]]
  return { ...doc, layers }
}

export interface InputPoint {
  x: number
  y: number
  /** 0..1; mice count as full pressure. */
  pressure: number
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Stabilizer: moves `prev` part of the way toward `next`. */
export function stabilize(prev: InputPoint, next: InputPoint, smoothing: number): InputPoint {
  const follow = 1 - Math.min(0.92, smoothing * 0.92)
  return { x: lerp(prev.x, next.x, follow), y: lerp(prev.y, next.y, follow), pressure: lerp(prev.pressure, next.pressure, follow) }
}

/** Mirror copies of a point for symmetry guides through the canvas center. */
export function mirrored<T extends { x: number; y: number }>(p: T, width: number, height: number, mode: SymmetryMode): T[] {
  const out = [p]
  if (mode === 'vertical' || mode === 'quad') out.push({ ...p, x: width - p.x })
  if (mode === 'horizontal' || mode === 'quad') out.push({ ...p, y: height - p.y })
  if (mode === 'quad') out.push({ ...p, x: width - p.x, y: height - p.y })
  return out
}

export type SymmetryMode = 'off' | 'vertical' | 'horizontal' | 'quad'
