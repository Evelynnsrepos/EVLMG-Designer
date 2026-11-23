import { newId, type Id } from '@/core/model'
import { CANVAS_BLENDS, type BlendMode } from './blend'
import { shiftColor } from './brushColor'
import { CurveFill, PathSmoother } from './brushPath'
import { applyCurve, hasRealPressure, type CurvePoint } from './pen'
import { GRAINS, grainCanvas, imageMask, imageTip, seeded, shapeShade, SHAPES, tipImage, type BrushGrain, type BrushShape } from './brushTextures'
import { isArtShape } from './brushArt'
import { GpuSurface, OUTLINE_EDGE, OUTLINE_SIGMA, rgb, type DabLook } from './gpuPaint'

/**
 * Brushes (v0.5, extended for Sketch Pro), with a Brush Library and Brush Studio:
 * brushes live in sets, every brush has a stroke preview, and all settings
 * can be edited. A stroke is a row of stamps ("dabs") of the brush shape.
 * Stamps are drawn as an alpha mask and colored once per stroke, so colored
 * strokes have clean edges and overlapping stamps never get darker than the
 * stroke opacity (glaze). Colour dynamics and moving grain colour or texture
 * each stamp on its own.
 */

export { GRAINS, seeded, SHAPES, tipImage, type BrushGrain, type BrushShape, type CurvePoint }

export const RENDER_MODES = [
  { id: 'light-glaze', label: 'Light glaze', hint: 'Stamps build up gently, never past the brush opacity.' },
  { id: 'uniform-glaze', label: 'Uniform glaze', hint: 'Even color: overlapping stamps don’t build up.' },
  { id: 'intense-glaze', label: 'Intense glaze', hint: 'Stamps build up quickly, never past the brush opacity.' },
  { id: 'heavy-glaze', label: 'Heavy glaze', hint: 'Thick paint that covers almost at once.' },
  { id: 'uniform-blending', label: 'Uniform blending', hint: 'Each stamp lands on the layer, so overlaps get stronger.' },
  { id: 'intense-blending', label: 'Intense blending', hint: 'Like uniform blending, but builds up faster.' },
] as const
export type RenderMode = (typeof RENDER_MODES)[number]['id']

export const DUAL_MODES = [
  { id: 'multiply', label: 'Multiply (only where both paint)', op: 'destination-in' },
  { id: 'add', label: 'Add (both together)', op: 'source-over' },
  { id: 'subtract', label: 'Subtract (second cuts holes)', op: 'destination-out' },
  { id: 'difference', label: 'Difference (where only one paints)', op: 'xor' },
] as const
export type DualMode = (typeof DUAL_MODES)[number]['id']

export const FILTERINGS = [
  { id: 'improved', label: 'Smooth' },
  { id: 'classic', label: 'Classic' },
  { id: 'none', label: 'Pixel sharp' },
] as const
export type Filtering = (typeof FILTERINGS)[number]['id']

/** How grain mixes with the paint: 'alpha' cuts holes, the others shade the colour. */
export const GRAIN_BLENDS = [
  { id: 'alpha', label: 'Texture (holes)' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'darken', label: 'Darken' },
  { id: 'color-burn', label: 'Color burn' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'soft-light', label: 'Soft light' },
  { id: 'screen', label: 'Screen' },
  { id: 'lighten', label: 'Lighten' },
] as const
export type GrainBlend = (typeof GRAIN_BLENDS)[number]['id']

export const OUTLINE_COLORS = [
  { id: 'main', label: 'Brush colour' },
  { id: 'darker', label: 'Darker brush colour' },
  { id: 'black', label: 'Black' },
  { id: 'white', label: 'White' },
] as const
export type OutlineColor = (typeof OUTLINE_COLORS)[number]['id']

export const OUTLINE_FILLS = [
  { id: 'paint', label: 'Brush colour' },
  { id: 'none', label: 'Nothing (hollow)' },
  { id: 'clear', label: 'Clear: wipes what is under it, so outlines join up' },
  { id: 'white', label: 'White' },
] as const
export type OutlineFill = (typeof OUTLINE_FILLS)[number]['id']

/** The outline's colour for a brush colour. */
export function outlineColorOf(b: BrushSettings, color: string): string {
  const c = b.outlineColor
  return c === 'black' ? '#000000' : c === 'white' ? '#ffffff' : c === 'darker' ? shiftColor(color, 0, 0.1, -0.45) : color
}
export type WiggleStyle = 'boil' | 'wave'
export const WIGGLE_STYLES: { id: WiggleStyle; label: string }[] = [
  { id: 'boil', label: 'Boil: a new wobble every frame, like hand-drawn animation' },
  { id: 'wave', label: 'Wave: a smooth wave runs along the line' },
]
/** True for an animated brush (its strokes wiggle in a loop). */
export const isAnimatedBrush = (b: BrushSettings) => (b.wiggle ?? 0) > 0

export const hasOutline = (b: BrushSettings) => (b.outline ?? 0) > 0

export interface BrushSettings {
  // Properties
  /** Diameter in canvas pixels at full pressure. */
  size: number
  /** 0..1, the most a single stroke can cover. */
  opacity: number
  /** Limits of the size and opacity sliders in the editor. */
  minSize: number
  maxSize: number
  minOpacity: number
  maxOpacity: number
  /** Four saved sizes (px), null = empty slot. */
  sizePresets: (number | null)[]
  /** Show the brush in the library as a single stamp instead of a stroke. */
  stampPreview: boolean
  // Stroke path
  /** Distance between stamps as a fraction of their diameter. */
  spacing: number
  /** 0..1 random change of the spacing. */
  spacingJitter: number
  /** 0..1 random sideways offset, as a fraction of the size. */
  scatter: number
  /** Stamps per point, scattered around it. */
  count: number
  /** 0..1 random change of the count. */
  countJitter: number
  /** 0..1, the stroke fades out as it gets longer. */
  falloff: number
  // Stabilization
  /** 0..1, StreamLine. */
  streamline: number
  /** 0..1, averages points (steadier, slightly behind the pen). */
  stabilization: number
  /** 0..1, removes small shakes. */
  motionFilter: number
  /** 0..1, brings back part of the shakes so lines stay lively. */
  motionExpression: number
  /** 0..1, pulls the brush behind the pen on a string (shown while drawing); 0 = off. */
  tether: number
  // Taper
  /** Length in px over which the stroke grows / shrinks at its ends; 0 = off. Used for pens. */
  taperStart: number
  taperEnd: number
  /** The same for a mouse or finger (no pressure). */
  touchTaperStart: number
  touchTaperEnd: number
  /** 0..1 how much the taper changes size, opacity and pressure. */
  taperSize: number
  taperOpacity: number
  taperPressure: number
  /** 0..1, size at the very tip of a taper. */
  taperTip: number
  /** Show the end taper while drawing, not only when the pen lifts. */
  tipAnimation: boolean
  // Shape
  shape: BrushShape
  /** A custom shape image (data URL); overrides `shape`. */
  shapeImage: string | null
  shapeInvert: boolean
  /** 0..1, 1 = crisp edge (built-in shapes). */
  hardness: number
  /** 0.05..1, 1 = circle, lower = flat ellipse. */
  roundness: number
  /** 'follow' turns stamps with the stroke; a number is a fixed angle in degrees. */
  rotation: 'follow' | 'random' | number
  /** 0..1 random extra turn of each stamp. */
  rotationJitter: number
  /** 0.31: bend the shape image along the stroke as one strip, stretched over its length or repeated, instead of stamping it. */
  ribbon?: 'off' | 'stretch' | 'tile'
  /** 0.31: the shape image keeps its own light and dark: its greys shade the brush colour (darker below mid-grey, lighter above). */
  shaded?: boolean
  /** 0.31: images at the start and end of a ribbon (a bead, a band, a tip), as data URLs. */
  capStart?: string | null
  capEnd?: string | null
  /** 0.35: width (px) of a line drawn around the stroke's whole shape, following it as you paint; 0 = off. */
  outline?: number
  /** 0.35: the outline's colour: the brush colour, a darker shade of it, black or white. */
  outlineColor?: OutlineColor
  /** 0.35: inside the outline: the brush colour, nothing (hollow), clear (also wipes what was there, so outlines join up) or white. */
  outlineFill?: OutlineFill
  /** 0.35: animated brush: how far the line wiggles (0 = a still brush). Its strokes go on an Animated layer. */
  wiggle?: number
  /** 0.35: how it wiggles: a new wobble every frame (boil), or a wave that runs along the line. */
  wiggleStyle?: WiggleStyle
  /** Turn stamps with the pen's direction (azimuth). */
  azimuth: boolean
  /** Flip each stamp at random. */
  randomize: boolean
  flipX: boolean
  flipY: boolean
  /** 0..1, light pressure / tilting makes stamps flatter. */
  pressureRoundness: number
  tiltRoundness: number
  shapeFiltering: Filtering
  // Grain
  grain: BrushGrain
  /** A custom grain image (data URL); overrides `grain`. */
  grainImage: string | null
  grainInvert: boolean
  /** 0..1 */
  grainDepth: number
  /** 'moving' rolls the grain with each stamp; 'texturized' keeps it fixed to the paper. */
  grainMode: 'moving' | 'texturized'
  /** Moving grain: 1 = stays with the stamp, 0 = slides along the stroke. */
  grainMovement: number
  /** Grain size multiplier. */
  grainScale: number
  /** 0..1, grain grows with the brush size. */
  grainZoom: number
  /** Degrees. */
  grainRotation: number
  /** -1..1 */
  grainContrast: number
  grainBrightness: number
  grainBlend: GrainBlend
  grainFiltering: Filtering
  // Rendering
  renderMode: RenderMode
  /** 0..1, how much each stamp adds; low flow builds up like an airbrush. */
  flow: number
  /** 0..1, lighter middle and darker rim, like drying watercolor. */
  wetEdges: number
  /** 0..1, darker, burnt-looking rim. */
  burntEdges: number
  /** How the stroke mixes with the layer. */
  blend: BlendMode
  /** Mix colours in light (more natural mixing of light over dark). */
  luminanceBlend: boolean
  /** 0..1, pixels below this coverage vanish and the rest are solid (crisp edges); 0 = off. */
  alphaThreshold: number
  // Wet mix (paint mixes with the colours on the layer)
  /** 0..1, more water: thinner paint. */
  dilution: number
  /** 0..1, how much paint is on the brush (1 = never runs out). */
  charge: number
  /** 0..1, how strongly paint sticks to the canvas. */
  attack: number
  /** 0..1, how much colour from the canvas is picked up and dragged. */
  pull: number
  /** 0..1, paint gets deeper where it overlaps. */
  grade: number
  /** 0..1, blurs the colours that are picked up. */
  wetBlur: number
  /** 0..1, paint thickness: strokes look raised and catch the light (3D paint); 0 = flat. */
  height: number
  /** What the Smudge tool does with this brush: drag colour along, or soften (blur) what is under it. */
  smudgeMode: 'drag' | 'blur'
  /** 0..1, random change of the water per stamp. */
  wetJitter: number
  // Colour dynamics (-1..1 shifts; jitters 0..1)
  hueJitter: number
  satJitter: number
  brightJitter: number
  strokeHueJitter: number
  strokeSatJitter: number
  strokeBrightJitter: number
  pressureHue: number
  pressureSat: number
  pressureBright: number
  tiltHue: number
  tiltSat: number
  tiltBright: number
  // Dynamics
  sizeJitter: number
  opacityJitter: number
  /** -1..1, faster strokes get bigger (+) or smaller (-). */
  speedSize: number
  speedOpacity: number
  speedCurve: CurvePoint[]
  // Pen
  /** 0..1 how much pen pressure changes size / opacity. */
  pressureSize: number
  pressureOpacity: number
  pressureCurve: CurvePoint[]
  /** 0..1 how much tilting the pen changes size (bigger) and opacity (lighter). */
  tiltSize: number
  tiltOpacity: number
  /** Degrees of tilt before tilt starts to count. */
  tiltAngle: number
  tiltCurve: CurvePoint[]
  // Dual brush
  /** A second brush painted along the same path and combined with this one. */
  dual: BrushSettings | null
  dualMode: DualMode
  /** Size of the second brush relative to this one. */
  dualScale: number
}

/** A saved version of a brush to go back to. */
export interface ResetPoint {
  id: Id
  name: string
  /** ms since 1970 */
  createdAt: number
  settings: BrushSettings
}

export interface BrushDef extends BrushSettings {
  id: Id
  name: string
  /** Built-in brushes can be reset to these settings. */
  builtIn?: boolean
  author?: string
  /** A hand-drawn signature, PNG data URL. */
  signature?: string | null
  createdAt?: number
  resetPoints?: ResetPoint[]
}

export interface BrushSet {
  id: Id
  name: string
  brushIds: Id[]
  builtIn?: boolean
  /** Icon name from SET_ICONS. */
  icon?: string
}

export interface BrushLibrary {
  sets: BrushSet[]
  brushes: BrushDef[]
  /** Most recent first, at most 8. */
  recent: Id[]
  /** Brushes pinned to the top of the library. */
  pinned?: Id[]
}

const LINEAR = () => [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
]

export const BASE_BRUSH: BrushSettings = {
  size: 12,
  opacity: 1,
  minSize: 1,
  maxSize: 500,
  minOpacity: 0.02,
  maxOpacity: 1,
  sizePresets: [null, null, null, null],
  stampPreview: false,
  spacing: 0.1,
  spacingJitter: 0,
  scatter: 0,
  count: 1,
  countJitter: 0,
  falloff: 0,
  streamline: 0.3,
  stabilization: 0,
  tether: 0,
  motionFilter: 0,
  motionExpression: 0,
  taperStart: 0,
  taperEnd: 0,
  touchTaperStart: 0,
  touchTaperEnd: 0,
  taperSize: 1,
  taperOpacity: 0,
  taperPressure: 0,
  taperTip: 0.15,
  tipAnimation: false,
  shape: 'round',
  shapeImage: null,
  shapeInvert: false,
  hardness: 0.9,
  roundness: 1,
  rotation: 'follow',
  rotationJitter: 0,
  ribbon: 'off',
  shaded: false,
  capStart: null,
  capEnd: null,
  outline: 0,
  outlineColor: 'main',
  outlineFill: 'paint',
  wiggle: 0,
  wiggleStyle: 'boil',
  azimuth: false,
  randomize: false,
  flipX: false,
  flipY: false,
  pressureRoundness: 0,
  tiltRoundness: 0,
  shapeFiltering: 'improved',
  grain: 'none',
  grainImage: null,
  grainInvert: false,
  grainDepth: 0.6,
  grainMode: 'texturized',
  grainMovement: 1,
  grainScale: 1,
  grainZoom: 0,
  grainRotation: 0,
  grainContrast: 0,
  grainBrightness: 0,
  grainBlend: 'alpha',
  grainFiltering: 'improved',
  renderMode: 'light-glaze',
  flow: 1,
  wetEdges: 0,
  burntEdges: 0,
  blend: 'source-over',
  luminanceBlend: false,
  alphaThreshold: 0,
  dilution: 0,
  charge: 1,
  attack: 1,
  pull: 0,
  grade: 0,
  wetBlur: 0,
  smudgeMode: 'drag',
  height: 0,
  wetJitter: 0,
  hueJitter: 0,
  satJitter: 0,
  brightJitter: 0,
  strokeHueJitter: 0,
  strokeSatJitter: 0,
  strokeBrightJitter: 0,
  pressureHue: 0,
  pressureSat: 0,
  pressureBright: 0,
  tiltHue: 0,
  tiltSat: 0,
  tiltBright: 0,
  sizeJitter: 0,
  opacityJitter: 0,
  speedSize: 0,
  speedOpacity: 0,
  speedCurve: LINEAR(),
  pressureSize: 0.6,
  pressureOpacity: 0,
  pressureCurve: LINEAR(),
  tiltSize: 0,
  tiltOpacity: 0,
  tiltAngle: 0,
  tiltCurve: LINEAR(),
  dual: null,
  dualMode: 'multiply',
  dualScale: 1,
}

export const SETTING_KEYS = Object.keys(BASE_BRUSH) as (keyof BrushSettings)[]

export { builtInBrush, defaultLibrary } from './brushDefaults'

export const DEFAULT_BRUSH_ID = 'hb-pencil'
export const DEFAULT_ERASER_ID = 'hard-eraser'

const oneOf = <T extends string>(list: readonly { id: T }[], v: unknown, fallback: T): T => (list.some((x) => x.id === v) ? (v as T) : fallback)

/** Fill in settings added in later versions (and fix broken values), so old libraries keep working. */
export function normalizeSettings(b: Partial<BrushSettings>): BrushSettings {
  const out = { ...BASE_BRUSH } as Record<string, unknown>
  for (const k of SETTING_KEYS) {
    const v = (b as Record<string, unknown>)[k]
    const def = BASE_BRUSH[k]
    if (v === undefined) continue
    if (typeof def === 'number' && !(typeof v === 'number' && Number.isFinite(v))) continue
    if (typeof def === 'boolean' && typeof v !== 'boolean') continue
    out[k] = v
  }
  const s = out as unknown as BrushSettings
  s.shape = oneOf(SHAPES, s.shape, 'round')
  s.grain = oneOf(GRAINS, s.grain, 'none')
  s.renderMode = oneOf(RENDER_MODES, s.renderMode, 'light-glaze')
  s.dualMode = oneOf(DUAL_MODES, s.dualMode, 'multiply')
  s.grainBlend = oneOf(GRAIN_BLENDS, s.grainBlend, 'alpha')
  s.shapeFiltering = oneOf(FILTERINGS, s.shapeFiltering, 'improved')
  s.grainFiltering = oneOf(FILTERINGS, s.grainFiltering, 'improved')
  if (!CANVAS_BLENDS.has(s.blend)) s.blend = 'source-over'
  if (s.grainMode !== 'moving') s.grainMode = 'texturized'
  if (s.smudgeMode !== 'blur') s.smudgeMode = 'drag'
  if (s.rotation !== 'follow' && s.rotation !== 'random' && !(typeof s.rotation === 'number' && Number.isFinite(s.rotation))) s.rotation = 'follow'
  const presets = Array.isArray(s.sizePresets) ? s.sizePresets : []
  s.sizePresets = [0, 1, 2, 3].map((i) => (typeof presets[i] === 'number' && presets[i]! > 0 ? presets[i] : null))
  for (const k of ['pressureCurve', 'tiltCurve', 'speedCurve'] as const) {
    const c = s[k]
    s[k] = Array.isArray(c) && c.length >= 2 && c.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) ? c.map((p) => ({ x: p.x, y: p.y })) : LINEAR()
  }
  s.shapeImage = typeof s.shapeImage === 'string' && s.shapeImage ? s.shapeImage : null
  if (s.ribbon !== 'stretch' && s.ribbon !== 'tile') s.ribbon = 'off'
  s.shaded = s.shaded === true
  s.outline = Math.max(0, Math.min(200, s.outline ?? 0))
  s.outlineColor = oneOf(OUTLINE_COLORS, s.outlineColor, 'main')
  s.outlineFill = oneOf(OUTLINE_FILLS, s.outlineFill, 'paint')
  s.wiggle = Math.max(0, Math.min(1, Number(s.wiggle) || 0))
  s.wiggleStyle = s.wiggleStyle === 'wave' ? 'wave' : 'boil'
  s.capStart = typeof s.capStart === 'string' && s.capStart ? s.capStart : null
  s.capEnd = typeof s.capEnd === 'string' && s.capEnd ? s.capEnd : null
  s.grainImage = typeof s.grainImage === 'string' && s.grainImage ? s.grainImage : null
  s.count = Math.max(1, Math.round(s.count))
  s.minSize = Math.max(0.5, s.minSize)
  s.maxSize = Math.max(s.minSize + 1, s.maxSize)
  s.maxOpacity = Math.min(1, Math.max(s.minOpacity + 0.01, s.maxOpacity))
  // A dual brush has no dual brush of its own.
  s.dual = s.dual && typeof s.dual === 'object' ? { ...normalizeSettings(s.dual), dual: null } : null
  return s
}

/** Just the settings of a brush (no name, id or about info). */
export function settingsOf(b: BrushSettings): BrushSettings {
  const out = {} as Record<string, unknown>
  for (const k of SETTING_KEYS) out[k] = b[k]
  return out as unknown as BrushSettings
}

export function normalizeBrush(b: Partial<BrushDef> & { id: Id; name: string }): BrushDef {
  const out: BrushDef = { ...normalizeSettings(b), id: b.id, name: typeof b.name === 'string' ? b.name : 'Brush' }
  if (b.builtIn) out.builtIn = true
  if (typeof b.author === 'string') out.author = b.author
  if (typeof b.signature === 'string') out.signature = b.signature
  if (typeof b.createdAt === 'number') out.createdAt = b.createdAt
  if (Array.isArray(b.resetPoints))
    out.resetPoints = b.resetPoints.filter((r) => r && typeof r.id === 'string').map((r) => ({ ...r, settings: normalizeSettings(r.settings ?? {}) }))
  return out
}

export function newBrush(name = 'New brush'): BrushDef {
  return { ...normalizeSettings({}), id: newId(), name, createdAt: Date.now() }
}

export function newSet(name: string): BrushSet {
  return { id: newId(), name, brushIds: [] }
}

/** True when the brush picks up and mixes colours already on the layer. */
export function isWet(b: BrushSettings): boolean {
  return b.dilution > 0 || b.pull > 0 || b.charge < 1 || b.grade > 0 || b.wetBlur > 0 || b.attack < 1
}

/** True when the brush's image keeps its own light and dark (needs a shape image). */
/** True when the brush's image has its own light and dark it can keep (an imported image or a built-in picture). */
export const canShade = (b: BrushSettings) => !!b.shapeImage || isArtShape(b.shape)
export const isShaded = (b: BrushSettings) => !!b.shaded && canShade(b)

/** True when the brush bends its image along the stroke instead of stamping it. */
export const isRibbon = (b: BrushSettings) => b.ribbon === 'stretch' || b.ribbon === 'tile'

/** The light and dark of a brush image (opaque grey), or null. */
export function imageShade(src: string | null | undefined): HTMLCanvasElement | null {
  return (src && imageMask(src)?.shade) || null
}

/** The light and dark of a brush's own image or built-in picture. */
const brushShade = (b: BrushSettings) => (b.shapeImage ? imageShade(b.shapeImage) : shapeShade(b.shape))

/** True when each stamp gets its own colour (colour dynamics). */
export function hasColorDynamics(b: BrushSettings): boolean {
  return !!(
    b.hueJitter ||
    b.satJitter ||
    b.brightJitter ||
    b.strokeHueJitter ||
    b.strokeSatJitter ||
    b.strokeBrightJitter ||
    b.pressureHue ||
    b.pressureSat ||
    b.pressureBright ||
    b.tiltHue ||
    b.tiltSat ||
    b.tiltBright
  )
}

export const hasGrain = (b: BrushSettings) => !!b.grainImage || b.grain !== 'none'
const isBlending = (b: BrushSettings) => b.renderMode === 'uniform-blending' || b.renderMode === 'intense-blending'

/** The opacity a finished stroke is drawn with onto the layer. */
export function strokeAlpha(b: BrushSettings): number {
  if (isBlending(b)) return 1
  return b.renderMode === 'uniform-glaze' ? b.opacity * b.flow : b.opacity
}

/** How far paint can land from the stroke's path (px), for undo areas. */
export function brushReach(b: BrushSettings): number {
  const grow = (1 + b.sizeJitter + b.scatter * Math.max(1, b.count)) * (1 + b.tiltSize * 2) * (1 + Math.max(0, b.speedSize))
  // shortcut: ribbon caps are counted as up to 3 brush sizes long; a much longer cap image could be cut off by undo.
  const caps = isRibbon(b) && (b.capStart || b.capEnd) ? 3 : 1
  return (b.outline ?? 0) * 1.2 + b.size * grow * caps * Math.max(1, b.dual ? b.dualScale * (1 + b.dual.scatter) : 1) + 4
}

// ---- Stamps -----------------------------------------------------------------

export interface StrokePoint {
  x: number
  y: number
  /** 0..1; mice count as full pressure. */
  pressure: number
  /** 0 = pen upright .. 1 = lying flat (or give `altitude`). */
  tilt?: number
  /** Radians: pi/2 = pen upright, 0 = lying flat (pen input's PenPoint). */
  altitude?: number
  /** Direction the pen leans, radians. */
  azimuth?: number
  /** ms; when missing, the time the point arrives. */
  time?: number
  /** false for a mouse or finger (touch taper is used then). */
  pen?: boolean
}

/** 0 = upright .. 1 = flat, from `tilt` or the pen's altitude. */
const tiltOf = (p: StrokePoint) => p.tilt ?? (p.altitude !== undefined ? Math.max(0, 1 - p.altitude / (Math.PI / 2)) : 0)

/** A stroke point with its speed (0..1), as stamped. */
interface Pt extends StrokePoint {
  speed: number
}

/** One stamp. */
export interface Dab {
  x: number
  y: number
  size: number
  alpha: number
  rot: number
  round: number
  sx: number
  sy: number
  /** Distance along the stroke. */
  at: number
  /** Own colour (colour dynamics), else null. */
  color: string | null
  pressure: number
}

type Rect = { x0: number; y0: number; x1: number; y1: number }
type Cursor = { i: number; t: number; dist: number; rng: number }
const START: Cursor = { i: -1, t: 0, dist: 0, rng: 0 }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function smoothing(ctx: CanvasRenderingContext2D, f: Filtering) {
  ctx.imageSmoothingEnabled = f !== 'none'
  if (f !== 'none') ctx.imageSmoothingQuality = f === 'improved' ? 'high' : 'low'
}

/** The tip of a brush (custom image or built-in), white alpha mask. */
export function brushTip(b: BrushSettings): HTMLCanvasElement {
  return (b.shapeImage && imageTip(b.shapeImage, b.shapeInvert)) || tipImage(b.shapeImage ? 'round' : b.shape, b.hardness)
}

/** What every GPU dab of this brush looks like: its tip and moving grain. */
export function dabLook(b: BrushSettings): DabLook {
  const grain = b.grainMode === 'moving' && hasGrain(b) ? grainCanvas(b) : null
  return {
    tip: brushTip(b),
    shade: isShaded(b) ? brushShade(b) : null,
    filtering: b.shapeFiltering,
    grain: grain && { image: grain, scale: b.grainScale, zoom: b.grainZoom, rotation: b.grainRotation, movement: b.grainMovement, filtering: b.grainFiltering },
  }
}

/** Where stamps go: a Canvas 2D canvas or a GPU stroke texture. */
type Surface = CanvasRenderingContext2D | GpuSurface

/**
 * Stamps one stroke into an alpha mask. Keeps the distance travelled so taper
 * and spacing are right; `finish` replays all points once the end is known.
 * With tip animation the end taper is drawn live on a separate layer.
 */
export class StrokeStamper {
  protected points: Pt[] = []
  protected brush: BrushSettings
  protected mirror: (p: { x: number; y: number }) => { x: number; y: number }[]
  protected out: Surface
  /** Where final stamps go: `out` itself, or a canvas of its own when the output is assembled. */
  protected main: Surface
  private tail: Surface | null = null
  private tailRect: Rect | null = null
  private second: StrokeStamper | null = null
  private dirty: Rect | null = null
  private cursor: Cursor = START
  private pathLength = 0
  private rngState: number
  private seed: number
  private smoother: PathSmoother<Pt>
  private curve = new CurveFill<Pt>()
  private lastRaw: (Pt & { time: number }) | null = null
  private dabBuf: HTMLCanvasElement | null = null
  protected strokeColor: string
  protected colored: boolean

  constructor(
    ctx: Surface,
    brush: BrushSettings,
    mirror: (p: { x: number; y: number }) => { x: number; y: number }[] = (p) => [p],
    seed = Math.floor(Math.random() * 1e9),
    color = '#000000',
    forceColor = false,
  ) {
    this.out = ctx
    this.brush = brush
    this.mirror = mirror
    this.seed = seed >>> 0 || 1
    this.rngState = this.seed
    this.smoother = new PathSmoother(brush.stabilization, brush.motionFilter, brush.motionExpression)
    // Stroke colour jitter: one change for the whole stroke.
    const r = seeded(this.seed ^ 0x5bd1e995)
    const j = (amount: number) => (amount ? (r() * 2 - 1) * amount : 0)
    this.strokeColor = shiftColor(color, j(brush.strokeHueJitter), j(brush.strokeSatJitter), j(brush.strokeBrightJitter))
    this.colored = forceColor || hasColorDynamics(brush) || isShaded(brush)
    const animate = brush.tipAnimation && (brush.taperEnd > 0 || brush.touchTaperEnd > 0) && !isRibbon(brush)
    const like = (role: string) => (ctx instanceof GpuSurface ? ctx.like(role) : makeCanvas(ctx.canvas.width, ctx.canvas.height).getContext('2d')!)
    if (ctx instanceof GpuSurface) ctx.look = dabLook(brush)
    this.main = animate || brush.dual ? like('stroke-main') : ctx
    if (animate) this.tail = like('stroke-tail')
    if (brush.dual) {
      const second = like('stroke-second')
      const d = { ...brush.dual, size: brush.size * brush.dualScale, dual: null, tipAnimation: false, stabilization: 0, motionFilter: 0 }
      this.second = new StrokeStamper(second, d, mirror, this.seed + 7, this.strokeColor, this.colored)
    }
  }

  /** Length of the stroke so far (px). */
  get length() {
    return this.pathLength
  }

  /** Deterministic random numbers, so a stroke redrawn with its end taper looks the same. */
  protected rand() {
    let s = this.rngState
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    this.rngState = s
    return ((s >>> 0) % 100000) / 100000
  }

  add(p: StrokePoint) {
    const time = p.time ?? performance.now()
    let speed = 0
    if (this.lastRaw) {
      // Points that arrive together (coalesced) count as 4 ms apart.
      const v = Math.hypot(p.x - this.lastRaw.x, p.y - this.lastRaw.y) / Math.max(4, time - this.lastRaw.time)
      speed = this.lastRaw.speed * 0.7 + Math.min(1, v / 4) * 0.3
    }
    const raw = { ...p, speed, time }
    this.lastRaw = raw
    for (const q of this.curve.push(this.smoother.push(raw))) this.push(q)
  }

  /** Clear and draw the whole stroke again with the end taper (the stroke length is known now). */
  finish() {
    for (const q of [...this.smoother.flush().flatMap((q) => this.curve.push(q)), ...this.curve.flush()]) this.push(q, false)
    this.second?.finish()
    if (isRibbon(this.brush)) {
      this.drawRibbon(this.pathLength, this.main)
      this.compose()
      return
    }
    if (!this.endTaper() || this.points.length < 2) {
      this.cursor = this.run(this.cursor, Infinity, Infinity, this.main)
    } else if (this.tail) {
      this.clearTail()
      this.cursor = this.run(this.cursor, this.pathLength, Infinity, this.main)
    } else {
      this.restart()
      this.cursor = this.run(START, this.pathLength, Infinity, this.main)
    }
    this.compose()
  }

  /** Add a smoothed point and stamp what is new. */
  protected push(p: Pt, live = true) {
    const prev = this.points[this.points.length - 1]
    if (prev) this.pathLength += Math.hypot(p.x - prev.x, p.y - prev.y)
    this.points.push(p)
    this.second?.push(p, live)
    if (!live) return
    if (isRibbon(this.brush)) {
      this.drawRibbon(Infinity, this.main)
      this.compose()
      return
    }
    if (this.tail && this.endTaper()) {
      // Stamps far enough from the pen are final; the rest is redrawn on the tail each time.
      this.cursor = this.run(this.cursor, Infinity, this.pathLength - this.endTaper(), this.main)
      this.clearTail()
      this.run(this.cursor, this.pathLength, Infinity, this.tail)
    } else this.cursor = this.run(this.cursor, Infinity, Infinity, this.main)
    this.compose()
  }

  private endTaper() {
    const pen = this.points[0]?.pen !== false
    return pen ? (hasRealPressure() ? 0 : this.brush.taperEnd) : this.brush.touchTaperEnd
  }

  /** Start over before a full redraw. */
  protected restart() {
    this.main.clearRect(0, 0, this.main.canvas.width, this.main.canvas.height)
    if (this.main !== this.out) this.out.clearRect(0, 0, this.out.canvas.width, this.out.canvas.height)
  }

  private clearTail() {
    const t = this.tailRect
    if (t && this.tail) {
      this.tail.clearRect(t.x0, t.y0, t.x1 - t.x0, t.y1 - t.y0)
      this.grow(t)
    }
    this.tailRect = null
  }

  private grow(r: Rect) {
    const d = (this.dirty ??= { ...r })
    d.x0 = Math.min(d.x0, r.x0)
    d.y0 = Math.min(d.y0, r.y0)
    d.x1 = Math.max(d.x1, r.x1)
    d.y1 = Math.max(d.y1, r.y1)
  }

  /** Assemble the output from the final stamps, the live tail and the dual brush. */
  private compose() {
    if (this.main === this.out) return
    const r = this.dirty
    const s = this.second?.dirty
    this.dirty = null
    if (this.second) this.second.dirty = null
    if (!r && !s) return
    const box = { ...(r ?? s!) }
    if (s) {
      box.x0 = Math.min(box.x0, s.x0)
      box.y0 = Math.min(box.y0, s.y0)
      box.x1 = Math.max(box.x1, s.x1)
      box.y1 = Math.max(box.y1, s.y1)
    }
    const x = Math.max(0, Math.floor(box.x0))
    const y = Math.max(0, Math.floor(box.y0))
    const w = Math.min(this.out.canvas.width, Math.ceil(box.x1)) - x
    const h = Math.min(this.out.canvas.height, Math.ceil(box.y1)) - y
    if (w <= 0 || h <= 0) return
    if (this.out instanceof GpuSurface) {
      const op = this.second ? DUAL_MODES.find((m) => m.id === this.brush.dualMode)!.op : 'source-over'
      this.out.assemble({ x, y, w, h }, this.main as GpuSurface, this.tail as GpuSurface | null, (this.second?.out as GpuSurface | undefined) ?? null, op)
      return
    }
    const o = this.out
    o.save()
    o.beginPath()
    o.rect(x, y, w, h)
    o.clip()
    o.globalAlpha = 1
    o.globalCompositeOperation = 'source-over'
    o.clearRect(x, y, w, h)
    o.drawImage((this.main as CanvasRenderingContext2D).canvas, x, y, w, h, x, y, w, h)
    if (this.tail) o.drawImage((this.tail as CanvasRenderingContext2D).canvas, x, y, w, h, x, y, w, h)
    if (this.second) {
      o.globalCompositeOperation = DUAL_MODES.find((m) => m.id === this.brush.dualMode)!.op
      o.drawImage((this.second.out as CanvasRenderingContext2D).canvas, x, y, w, h, x, y, w, h)
    }
    o.restore()
  }

  /**
   * Stamp along the points from `c`, stopping before the first stamp past
   * `limit`. Returns where it stopped, so stamping can go on from there.
   */
  private run(c: Cursor, total: number, limit: number, to: Surface): Cursor {
    const pts = this.points
    if (!pts.length) return c
    let { i, t, dist } = c
    this.rngState = c.rng || this.seed
    if (i < 0) {
      if (limit < 0) return c
      this.stampPoint(pts[0], 0, 0, total, to)
      t = this.stepAt(pts[0], 0, total)
      i = 0
    }
    while (i < pts.length - 1) {
      const a = pts[i]
      const b = pts[i + 1]
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      if (d > 0) {
        const angle = Math.atan2(b.y - a.y, b.x - a.x)
        // `t` is how far into this segment the next stamp goes, so spacing stays even across points.
        while (t <= d) {
          if (dist + t > limit) return { i, t, dist, rng: this.rngState }
          const k = t / d
          const p: Pt = { ...b, x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), pressure: lerp(a.pressure, b.pressure, k), speed: lerp(a.speed, b.speed, k) }
          if (a.tilt !== undefined || a.altitude !== undefined) p.tilt = lerp(tiltOf(a), tiltOf(b), k)
          this.stampPoint(p, angle, dist + t, total, to)
          t += this.stepAt(p, dist + t, total)
        }
        t -= d
        dist += d
      }
      i++
    }
    return { i, t, dist, rng: this.rngState }
  }

  /** Pressure, tilt and speed after the brush's curves (0..1). */
  private inputs(p: Pt) {
    const b = this.brush
    const tiltDeg = tiltOf(p) * 90
    return {
      pressure: applyCurve(b.pressureCurve, p.pressure),
      tilt: tiltDeg ? applyCurve(b.tiltCurve, clamp01((tiltDeg - b.tiltAngle) / Math.max(1, 90 - b.tiltAngle))) : 0,
      speed: applyCurve(b.speedCurve, p.speed),
    }
  }

  /** 1 = full size, less near a tapered end. */
  private taper(at: number, total: number) {
    const b = this.brush
    const pen = this.points[0]?.pen !== false
    const start = pen ? b.taperStart : b.touchTaperStart
    const end = this.endTaper()
    let k = 1
    if (start > 0) k = Math.min(k, at / start)
    if (end > 0 && Number.isFinite(total)) k = Math.min(k, Math.max(0, total - at) / end)
    return clamp01(k)
  }

  private sizeAt(p: Pt, at: number, total: number) {
    const b = this.brush
    const { pressure, tilt, speed } = this.inputs(p)
    const k = this.taper(at, total)
    const tip = b.taperTip + (1 - b.taperTip) * k
    let s = b.size * lerp(1, Math.max(0.02, pressure * lerp(1, k, b.taperPressure)), b.pressureSize)
    s *= lerp(1, tip, b.taperSize)
    s *= 1 + tilt * b.tiltSize * 2
    s *= Math.max(0.1, 1 + b.speedSize * speed)
    return Math.max(0.5, s)
  }

  /** Distance to the next stamp. */
  private stepAt(p: Pt, at: number, total: number) {
    const size = this.sizeAt(p, at, total)
    return Math.max(0.4, size * this.brush.spacing * (1 + (this.rand() - 0.5) * 2 * this.brush.spacingJitter))
  }

  private stampPoint(p: Pt, angle: number, at: number, total: number, to: Surface) {
    const b = this.brush
    const { pressure, tilt, speed } = this.inputs(p)
    const k = this.taper(at, total)
    const tip = b.taperTip + (1 - b.taperTip) * k
    const press = Math.max(0.02, pressure * lerp(1, k, b.taperPressure))
    const baseSize = this.sizeAt(p, at, total)
    const count = Math.max(1, Math.round(b.count * (1 - b.countJitter * this.rand())))
    for (let i = 0; i < count; i++) {
      const size = baseSize * (1 - b.sizeJitter * this.rand() * 0.8)
      let alpha = (b.renderMode === 'uniform-glaze' ? 1 : b.flow) * lerp(1, press, b.pressureOpacity) * (1 - b.opacityJitter * this.rand())
      alpha *= lerp(1, tip, b.taperOpacity) * lerp(1, 1 - tilt, b.tiltOpacity) * Math.max(0, 1 + b.speedOpacity * speed)
      if (b.falloff) alpha *= Math.max(0, 1 - (at * b.falloff) / 800)
      if (b.renderMode === 'intense-glaze' || b.renderMode === 'intense-blending') alpha = 1 - (1 - clamp01(alpha)) ** 2
      if (b.renderMode === 'heavy-glaze') alpha = 1 - (1 - clamp01(alpha)) ** 3
      if (isBlending(b)) alpha *= b.opacity
      const off = b.scatter * baseSize * (this.rand() - 0.5)
      const x = p.x - Math.sin(angle) * off + (b.count > 1 ? (this.rand() - 0.5) * baseSize * b.scatter : 0)
      const y = p.y + Math.cos(angle) * off + (b.count > 1 ? (this.rand() - 0.5) * baseSize * b.scatter : 0)
      const fixed = typeof b.rotation === 'number' ? (b.rotation * Math.PI) / 180 : 0
      let rot = b.rotation === 'follow' ? angle : b.rotation === 'random' ? this.rand() * Math.PI * 2 : fixed
      if (b.azimuth && p.azimuth !== undefined) rot = p.azimuth + fixed
      if (b.rotationJitter) rot += b.rotationJitter * (this.rand() - 0.5) * Math.PI * 2
      const round = Math.max(0.05, b.roundness * lerp(1, Math.max(0.05, press), b.pressureRoundness) * lerp(1, Math.max(0.05, 1 - tilt), b.tiltRoundness))
      let sx = b.flipX ? -1 : 1
      let sy = b.flipY ? -1 : 1
      if (b.randomize) {
        if (this.rand() < 0.5) sx = -sx
        if (this.rand() < 0.5) sy = -sy
      }
      let color: string | null = null
      if (this.colored) {
        const j = (amount: number) => (amount ? (this.rand() * 2 - 1) * amount : 0)
        const lack = 1 - pressure
        color = shiftColor(
          this.strokeColor,
          j(b.hueJitter) + b.pressureHue * lack + b.tiltHue * tilt,
          j(b.satJitter) + b.pressureSat * lack + b.tiltSat * tilt,
          j(b.brightJitter) + b.pressureBright * lack + b.tiltBright * tilt,
        )
      }
      this.drawDab({ x, y, size, alpha: clamp01(alpha), rot, round, sx, sy, at, color, pressure: press }, to)
    }
  }

  private ribbonBox: Rect | null = null

  /**
   * Ribbon mode: the shape image bent along the whole stroke as one strip, as wide as the brush (pressure and
   * taper included), redrawn as the stroke grows. 'stretch' spreads the image over the stroke, 'tile' repeats it
   * every image length without seams. Cap images go on the two ends.
   */
  private drawRibbon(total: number, to: Surface) {
    const b = this.brush
    const pts = this.points
    const old = this.ribbonBox
    if (old) {
      to.clearRect(old.x0, old.y0, old.x1 - old.x0, old.y1 - old.y0)
      this.grow(old)
    }
    this.ribbonBox = null
    if (pts.length < 2) return
    const tip = brushTip(b)
    const tileLen = Math.max(1, (b.size * tip.width) / tip.height)
    const length = Number.isFinite(total) ? total : this.pathLength
    const verts: number[] = []
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    const halves: number[] = []
    let at = 0
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      if (i) at += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)
      const a = pts[Math.max(0, i - 1)]
      const c = pts[Math.min(pts.length - 1, i + 1)]
      const dl = Math.hypot(c.x - a.x, c.y - a.y) || 1
      const nx = -(c.y - a.y) / dl
      const ny = (c.x - a.x) / dl
      const half = this.sizeAt(p, at, total) / 2
      halves.push(half)
      const k = this.taper(at, total)
      const alpha = clamp01(b.flow * lerp(1, Math.max(0.02, this.inputs(p).pressure), b.pressureOpacity) * lerp(1, b.taperTip + (1 - b.taperTip) * k, b.taperOpacity))
      const u = b.ribbon === 'tile' ? at / tileLen : at / Math.max(1, length)
      verts.push(p.x + nx * half, p.y + ny * half, u, 0, alpha, p.x - nx * half, p.y - ny * half, u, 1, alpha)
      box.x0 = Math.min(box.x0, p.x - half)
      box.y0 = Math.min(box.y0, p.y - half)
      box.x1 = Math.max(box.x1, p.x + half)
      box.y1 = Math.max(box.y1, p.y + half)
    }
    const color = this.colored ? this.strokeColor : null
    const shade = isShaded(b) ? brushShade(b) : null
    // One strip per mirror copy (symmetry); mirroring each point also records how far the stroke reaches.
    const strips: number[][] = []
    for (let i = 0; i < verts.length; i += 5)
      this.mirror({ x: verts[i], y: verts[i + 1] }).forEach((m, k) => {
        ;(strips[k] ??= []).push(m.x, m.y, verts[i + 2], verts[i + 3], verts[i + 4])
        box.x0 = Math.min(box.x0, m.x)
        box.y0 = Math.min(box.y0, m.y)
        box.x1 = Math.max(box.x1, m.x)
        box.y1 = Math.max(box.y1, m.y)
      })
    for (const strip of strips) {
      if (to instanceof GpuSurface) to.ribbon(Float32Array.from(strip), { image: tip, shade, repeat: b.ribbon === 'tile', filtering: b.shapeFiltering, color: color ? rgb(color) : null })
      else ribbon2d(to, strip, shrunk(painted(tip, shade, color), Math.max(...halves) * 2), b.ribbon === 'tile')
    }
    // Caps: centred on the ends, turned to point out of the stroke, as tall as the ribbon is wide there.
    const n = pts.length - 1
    const caps: [string | null | undefined, number, number, number][] = [
      [b.capStart, 0, 1, halves[0]],
      [b.capEnd, n, n - 1, halves[n]],
    ]
    for (const [src, i, j, half] of caps) {
      const img = src ? imageTip(src, false) : null
      if (!img) continue
      const h = Math.max(1, half * 2)
      const w = (h * img.width) / img.height
      const capShade = isShaded(b) ? imageShade(src) : null
      const ends = this.mirror(pts[i])
      this.mirror(pts[j]).forEach((q, k) => {
        const e = ends[k]
        if (!e) return
        const rot = Math.atan2(e.y - q.y, e.x - q.x)
        if (to instanceof GpuSurface) to.stamp(img, capShade, { x: e.x, y: e.y, size: h, rot, sx: w / h, sy: 1, alpha: 1, at: 0, color: color ? rgb(color) : null })
        else {
          to.save()
          to.translate(e.x, e.y)
          to.rotate(rot)
          to.drawImage(painted(img, capShade, color), -w / 2, -h / 2, w, h)
          to.restore()
        }
        const r = Math.max(w, h)
        box.x0 = Math.min(box.x0, e.x - r)
        box.y0 = Math.min(box.y0, e.y - r)
        box.x1 = Math.max(box.x1, e.x + r)
        box.y1 = Math.max(box.y1, e.y + r)
      })
    }
    this.ribbonBox = { x0: box.x0 - 2, y0: box.y0 - 2, x1: box.x1 + 2, y1: box.y1 + 2 }
    this.grow(this.ribbonBox)
    if (to instanceof GpuSurface) to.mark({ x: box.x0 - 2, y: box.y0 - 2, w: box.x1 - box.x0 + 4, h: box.y1 - box.y0 + 4 })
  }

  /** Mark the area a stamp covers, so only that part is assembled. */
  protected touch(x: number, y: number, size: number, to: Surface) {
    const r = size * 0.75 + 2
    const box = { x0: x - r, y0: y - r, x1: x + r, y1: y + r }
    this.grow(box)
    if (to === this.tail) {
      const t = (this.tailRect ??= { ...box })
      t.x0 = Math.min(t.x0, box.x0)
      t.y0 = Math.min(t.y0, box.y0)
      t.x1 = Math.max(t.x1, box.x1)
      t.y1 = Math.max(t.y1, box.y1)
    }
  }

  /** The stamp as an image: tip, moving grain and own colour baked in. */
  protected dabImage(d: Dab): { image: CanvasImageSource; w: number; h: number } {
    const b = this.brush
    const tip = brushTip(b)
    const moving = b.grainMode === 'moving' && hasGrain(b)
    if (!d.color && !moving) return { image: tip, w: tip.width, h: tip.height }
    const s = Math.max(2, Math.ceil(Math.min(d.size, 1024)))
    if (!this.dabBuf || this.dabBuf.width < s) this.dabBuf = makeCanvas(s, s)
    const g = this.dabBuf.getContext('2d')!
    g.save()
    g.globalCompositeOperation = 'copy'
    smoothing(g, b.shapeFiltering)
    g.drawImage(tip, 0, 0, s, s)
    if (d.color) {
      g.globalCompositeOperation = 'source-in'
      g.fillStyle = d.color
      g.fillRect(0, 0, s, s)
      const shade = isShaded(b) ? brushShade(b) : null
      if (shade) {
        // The image's greys shade the colour (hard light), then the tip's shape is cut out again.
        g.globalCompositeOperation = 'hard-light'
        g.drawImage(shade, 0, 0, s, s)
        g.globalCompositeOperation = 'destination-in'
        g.drawImage(tip, 0, 0, s, s)
      }
    }
    if (moving) {
      const grain = grainCanvas(b)
      if (grain) {
        const pat = g.createPattern(grain, 'repeat')!
        const scale = b.grainScale * lerp(1, d.size / 40, b.grainZoom) * (s / d.size)
        pat.setTransform(new DOMMatrix().translateSelf(-d.at * (1 - b.grainMovement) * (s / d.size), 0).rotateSelf(b.grainRotation).scaleSelf(scale, scale))
        smoothing(g, b.grainFiltering)
        g.globalCompositeOperation = 'destination-in'
        g.fillStyle = pat
        g.fillRect(0, 0, s, s)
      }
    }
    g.restore()
    return { image: this.dabBuf, w: s, h: s }
  }

  protected drawDab(d: Dab, to: Surface) {
    if (to instanceof GpuSurface) {
      const color = d.color ? rgb(d.color) : null
      for (const m of this.mirror({ x: d.x, y: d.y })) {
        to.dab({ x: m.x, y: m.y, size: d.size, rot: d.rot, sx: d.sx, sy: d.round * d.sy, alpha: d.alpha, at: d.at, color })
        this.touch(m.x, m.y, d.size, to)
      }
      return
    }
    const { image, w, h } = this.dabImage(d)
    to.globalAlpha = d.alpha
    smoothing(to, this.brush.shapeFiltering)
    for (const m of this.mirror({ x: d.x, y: d.y })) {
      to.save()
      to.translate(m.x, m.y)
      to.rotate(d.rot)
      to.scale(d.sx, d.round * d.sy)
      to.drawImage(image, 0, 0, w, h, -d.size / 2, -d.size / 2, d.size, d.size)
      to.restore()
      this.touch(m.x, m.y, d.size, to)
    }
    to.globalAlpha = 1
  }
}

/** An image (white alpha mask) in a colour, shaded by `shade`'s greys; the mask itself without a colour. */
function painted(img: HTMLCanvasElement, shade: HTMLCanvasElement | null, color: string | null): HTMLCanvasElement {
  if (!color) return img
  const c = makeCanvas(img.width, img.height)
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = color
  g.fillRect(0, 0, c.width, c.height)
  if (shade) {
    g.globalCompositeOperation = 'hard-light'
    g.drawImage(shade, 0, 0, c.width, c.height)
    g.globalCompositeOperation = 'destination-in'
    g.drawImage(img, 0, 0)
  }
  return c
}

/**
 * The image halved until it is at most about twice `h` tall: Canvas 2D has no mipmaps, so a big image drawn very
 * small sparkles and loses its shading (the GPU strip uses mipmaps).
 */
function shrunk(img: HTMLCanvasElement, h: number): HTMLCanvasElement {
  let c = img
  while (c.height > Math.max(8, h * 2) && c.width >= 8) {
    const n = makeCanvas(Math.max(1, Math.round(c.width / 2)), Math.max(1, Math.round(c.height / 2)))
    const g = n.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(c, 0, 0, n.width, n.height)
    c = n
  }
  return c
}

/**
 * Canvas 2D ribbon: each quad of the strip is two triangles, each filled with the image under the affine
 * transform that maps its image corners onto it. Slower than the GPU strip, same picture.
 */
function ribbon2d(ctx: CanvasRenderingContext2D, v: number[], img: HTMLCanvasElement, repeat: boolean) {
  const W = img.width
  const H = img.height
  const pattern = ctx.createPattern(img, repeat ? 'repeat-x' : 'no-repeat')
  if (!pattern) return
  const tri = (i: number, j: number, k: number) => {
    const [x0, y0, u0, v0, a0] = v.slice(i * 5, i * 5 + 5)
    const [x1, y1, u1, v1, a1] = v.slice(j * 5, j * 5 + 5)
    const [x2, y2, u2, v2, a2] = v.slice(k * 5, k * 5 + 5)
    // Image space (u·W, v·H) to canvas space.
    const sx0 = u0 * W, sy0 = v0 * H, sx1 = u1 * W, sy1 = v1 * H, sx2 = u2 * W, sy2 = v2 * H
    const det = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0)
    if (!det) return
    const a = ((x1 - x0) * (sy2 - sy0) - (x2 - x0) * (sy1 - sy0)) / det
    const c = ((x2 - x0) * (sx1 - sx0) - (x1 - x0) * (sx2 - sx0)) / det
    const b = ((y1 - y0) * (sy2 - sy0) - (y2 - y0) * (sy1 - sy0)) / det
    const d = ((y2 - y0) * (sx1 - sx0) - (y1 - y0) * (sx2 - sx0)) / det
    ctx.save()
    ctx.beginPath()
    // Clip a little past the triangle's edges so neighbours overlap: anti-aliased clips leave light seams otherwise.
    const cx = (x0 + x1 + x2) / 3
    const cy = (y0 + y1 + y2) / 3
    for (const [x, y] of [
      [x0, y0],
      [x1, y1],
      [x2, y2],
    ]) {
      const l = Math.hypot(x - cx, y - cy) || 1
      ctx.lineTo(x + ((x - cx) / l) * 0.75, y + ((y - cy) / l) * 0.75)
    }
    ctx.closePath()
    ctx.clip()
    ctx.globalAlpha = (a0 + a1 + a2) / 3
    ctx.transform(a, b, c, d, x0 - a * sx0 - c * sy0, y0 - b * sx0 - d * sy0)
    ctx.fillStyle = pattern
    ctx.fillRect(Math.min(sx0, sx1, sx2) - 1, -1, Math.abs(Math.max(sx0, sx1, sx2) - Math.min(sx0, sx1, sx2)) + 2, H + 2)
    ctx.restore()
  }
  for (let i = 0; i + 3 < v.length / 5; i += 2) {
    tri(i, i + 1, i + 2)
    tri(i + 1, i + 3, i + 2)
  }
}

// ---- Turning the mask into paint -------------------------------------------------

export interface Area {
  x: number
  y: number
  w: number
  h: number
}

let scratchA: HTMLCanvasElement | null = null
let scratchB: HTMLCanvasElement | null = null
const scratch = (c: HTMLCanvasElement | null, w: number, h: number) => {
  if (!c || c.width < w || c.height < h) c = makeCanvas(Math.max(w, c?.width ?? 0), Math.max(h, c?.height ?? 0))
  c.getContext('2d')!.clearRect(0, 0, w, h)
  return c
}

function clampArea(a: Area | undefined, w: number, h: number): Area {
  if (!a) return { x: 0, y: 0, w, h }
  const x = Math.max(0, Math.floor(a.x))
  const y = Math.max(0, Math.floor(a.y))
  return { x, y, w: Math.max(0, Math.min(w, Math.ceil(a.x + a.w)) - x), h: Math.max(0, Math.min(h, Math.ceil(a.y + a.h)) - y) }
}

/**
 * Turn a stroke's alpha mask into paint: color it, add grain and edges. Draws
 * into `out` (cleared first) so callers can composite it with the brush
 * opacity. `area` limits the slower effects to where the stroke is.
 */
/** Returns the stroke's outline (to go behind the layer), or null. */
export function colorStroke(mask: HTMLCanvasElement, out: CanvasRenderingContext2D, color: string, brush: BrushSettings, area?: Area): HTMLCanvasElement | null {
  const W = out.canvas.width
  const H = out.canvas.height
  out.save()
  out.globalCompositeOperation = 'source-over'
  out.globalAlpha = 1
  out.clearRect(0, 0, W, H)
  out.drawImage(mask, 0, 0)
  if (!hasColorDynamics(brush) && !isShaded(brush)) {
    out.globalCompositeOperation = 'source-in'
    out.fillStyle = color
    out.fillRect(0, 0, W, H)
  }
  if (brush.grainMode === 'texturized' && hasGrain(brush)) {
    const gray = brush.grainBlend !== 'alpha'
    const grain = grainCanvas(brush, gray ? 'gray' : 'alpha')
    if (grain) {
      const pat = out.createPattern(grain, 'repeat')!
      const scale = brush.grainScale * lerp(1, brush.size / 40, brush.grainZoom)
      pat.setTransform(new DOMMatrix().rotateSelf(brush.grainRotation).scaleSelf(scale, scale))
      smoothing(out, brush.grainFiltering)
      out.fillStyle = pat
      if (gray) {
        out.globalCompositeOperation = brush.grainBlend as GlobalCompositeOperation
        out.fillRect(0, 0, W, H)
        out.globalCompositeOperation = 'destination-in'
        out.drawImage(mask, 0, 0)
      } else {
        out.globalCompositeOperation = 'destination-in'
        out.fillRect(0, 0, W, H)
      }
    }
  }
  const r = clampArea(area, W, H)
  if ((brush.wetEdges > 0 || brush.burntEdges > 0) && r.w > 0 && r.h > 0) {
    // A blurred copy of the stroke is lower near its edges: use it to find the rim.
    const blur = Math.max(1.5, brush.size * 0.12)
    const pad = Math.ceil(blur * 2)
    const bx = Math.max(0, r.x - pad)
    const by = Math.max(0, r.y - pad)
    const bw = Math.min(W, r.x + r.w + pad) - bx
    const bh = Math.min(H, r.y + r.h + pad) - by
    scratchA = scratch(scratchA, bw, bh)
    const a = scratchA.getContext('2d')!
    a.save()
    a.filter = `blur(${blur}px)`
    a.drawImage(mask, bx, by, bw, bh, 0, 0, bw, bh)
    a.restore()
    if (brush.burntEdges > 0) {
      scratchB = scratch(scratchB, bw, bh)
      const e = scratchB.getContext('2d')!
      e.save()
      e.drawImage(mask, bx, by, bw, bh, 0, 0, bw, bh)
      e.globalCompositeOperation = 'destination-out'
      e.drawImage(scratchA, 0, 0, bw, bh, 0, 0, bw, bh)
      e.globalCompositeOperation = 'source-in'
      e.fillStyle = shiftColor(color, 0, 0.1, -0.35)
      e.fillRect(0, 0, bw, bh)
      e.restore()
      out.globalCompositeOperation = 'multiply'
      out.globalAlpha = brush.burntEdges
      out.drawImage(scratchB, 0, 0, bw, bh, bx, by, bw, bh)
      out.globalAlpha = 1
    }
    if (brush.wetEdges > 0) {
      out.globalCompositeOperation = 'destination-out'
      out.globalAlpha = brush.wetEdges * 0.6
      out.drawImage(scratchA, 0, 0, bw, bh, bx, by, bw, bh)
      out.globalAlpha = 1
    }
  }
  out.restore()
  const ring = hasOutline(brush) && r.w > 0 && r.h > 0 ? outline2d(mask, out, color, brush, r) : null
  if (brush.alphaThreshold > 0 && r.w > 0 && r.h > 0) {
    const img = out.getImageData(r.x, r.y, r.w, r.h)
    const d = img.data
    const t = brush.alphaThreshold * 255
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= t && d[i] > 0 ? 255 : 0
    out.putImageData(img, r.x, r.y)
  }
  return ring
}

let scratchO: HTMLCanvasElement | null = null
export { OUTLINE_SIGMA }

/**
 * The outline around a stroke (Canvas 2D): a blurred copy of the stroke mask is low but not zero up to about the
 * outline width away from it; that band outside the stroke is the outline. The fill inside is kept, removed or white.
 */
let ringOut: HTMLCanvasElement | null = null

/** The outline of the last colorStroke (full size, in its colour), or null without one: compositeStroke puts it behind the layer. */
function outline2d(mask: HTMLCanvasElement, out: CanvasRenderingContext2D, color: string, b: BrushSettings, r: { x: number; y: number; w: number; h: number }): HTMLCanvasElement | null {
  const W = out.canvas.width
  const H = out.canvas.height
  const sigma = b.outline! / OUTLINE_SIGMA
  const pad = Math.ceil(sigma * 3)
  const bx = Math.max(0, r.x - pad)
  const by = Math.max(0, r.y - pad)
  const bw = Math.min(W, r.x + r.w + pad) - bx
  const bh = Math.min(H, r.y + r.h + pad) - by
  if (bw <= 0 || bh <= 0) return null
  scratchO = scratch(scratchO, bw, bh)
  const a = scratchO.getContext('2d', { willReadFrequently: true })!
  a.clearRect(0, 0, bw, bh)
  a.filter = `blur(${sigma}px)`
  a.drawImage(mask, bx, by, bw, bh, 0, 0, bw, bh)
  a.filter = 'none'
  const blurred = a.getImageData(0, 0, bw, bh).data
  a.clearRect(0, 0, bw, bh)
  a.drawImage(mask, bx, by, bw, bh, 0, 0, bw, bh)
  const m = a.getImageData(0, 0, bw, bh).data
  const img = out.getImageData(bx, by, bw, bh)
  const d = img.data
  const rimg = new ImageData(bw, bh)
  const rd = rimg.data
  const [oc, fill] = [hexRgb(outlineColorOf(b, color)), b.outlineFill]
  const [e0, e1] = OUTLINE_EDGE
  for (let i = 0; i < d.length; i += 4) {
    const t = Math.min(1, Math.max(0, (blurred[i + 3] / 255 - e0) / (e1 - e0)))
    const ma = m[i + 3] / 255
    rd[i] = oc[0]
    rd[i + 1] = oc[1]
    rd[i + 2] = oc[2]
    rd[i + 3] = t * t * (3 - 2 * t) * (1 - ma) * 255
    if (fill === 'none' || fill === 'clear') d[i + 3] = 0
    else if (fill === 'white') [d[i], d[i + 1], d[i + 2], d[i + 3]] = [255, 255, 255, m[i + 3]]
  }
  ringOut = scratch(ringOut, W, H)
  const rg = ringOut.getContext('2d')!
  rg.clearRect(0, 0, W, H)
  rg.putImageData(rimg, bx, by)
  out.putImageData(img, bx, by)
  return ringOut
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6).padEnd(6, '0'), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toLinear = new Float32Array(256).map((_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})
const toSrgb = (l: number) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055))

/**
 * Put a colored stroke (from colorStroke) onto a layer with the brush's
 * opacity, blend mode, the selection and alpha lock.
 */
export function compositeStroke(
  ctx: CanvasRenderingContext2D,
  paint: HTMLCanvasElement,
  brush: BrushSettings,
  o: { erase: boolean; alphaLock: boolean; selection: Path2D | null; area?: Area; clearInside?: HTMLCanvasElement | null; ring?: HTMLCanvasElement | null },
) {
  const alpha = strokeAlpha(brush)
  if (o.clearInside && !o.erase) {
    // A 'clear' outline fill wipes the layer under the stroke, so a new outlined shape joins the ones below.
    ctx.save()
    if (o.selection) ctx.clip(o.selection)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.drawImage(o.clearInside, 0, 0)
    ctx.restore()
  }
  if (o.ring && !o.erase && !o.alphaLock) {
    // The outline goes behind what is already on the layer, so filled shapes painted one after another join up.
    ctx.save()
    if (o.selection) ctx.clip(o.selection)
    ctx.globalAlpha = alpha
    ctx.globalCompositeOperation = 'destination-over'
    ctx.drawImage(o.ring, 0, 0)
    ctx.restore()
  }
  if (brush.luminanceBlend && !o.erase) {
    const r = clampArea(o.area, ctx.canvas.width, ctx.canvas.height)
    if (r.w <= 0 || r.h <= 0) return
    const pg = paint.getContext('2d')!
    if (o.selection) {
      pg.save()
      pg.globalCompositeOperation = 'destination-in'
      pg.fill(o.selection)
      pg.restore()
    }
    // Mix in linear light: lighter colours over darker ones look like real paint.
    const dst = ctx.getImageData(r.x, r.y, r.w, r.h)
    const src = pg.getImageData(r.x, r.y, r.w, r.h).data
    const d = dst.data
    for (let i = 0; i < d.length; i += 4) {
      const sa = (src[i + 3] / 255) * alpha
      if (!sa) continue
      const da = d[i + 3] / 255
      const oa = o.alphaLock ? da : sa + da * (1 - sa)
      if (!oa) continue
      const ws = o.alphaLock ? sa : sa / oa
      const wd = 1 - ws
      for (let c = 0; c < 3; c++) d[i + c] = toSrgb(toLinear[src[i + c]] * ws + toLinear[d[i + c]] * wd)
      d[i + 3] = Math.round(oa * 255)
    }
    ctx.putImageData(dst, r.x, r.y)
    return
  }
  ctx.save()
  if (o.selection) ctx.clip(o.selection)
  ctx.globalAlpha = alpha
  ctx.globalCompositeOperation = o.erase ? 'destination-out' : o.alphaLock ? 'source-atop' : (brush.blend as GlobalCompositeOperation)
  ctx.drawImage(paint, 0, 0)
  ctx.restore()
}

/** The sample stroke for previews: an S-curve, pressure rising then falling off at the end. */
export function sampleStroke(w: number, h: number, n = 60): StrokePoint[] {
  const pts: StrokePoint[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const pressure = t < 0.75 ? 0.15 + t * 1.1 : Math.max(0.05, 1 - (t - 0.75) * 3.6)
    pts.push({ x: 10 + t * (w - 20), y: h / 2 + Math.sin(t * Math.PI * 2) * h * 0.22, pressure, time: i * 8 })
  }
  return pts
}

/** Brush settings scaled by `k` (sizes and lengths), for small previews. */
export function scaledBrush<B extends BrushSettings>(brush: B, k: number): B {
  if (k === 1) return brush
  return {
    ...brush,
    size: brush.size * k,
    outline: brush.outline ? Math.max(1, brush.outline * k) : brush.outline,
    taperStart: brush.taperStart * k,
    taperEnd: brush.taperEnd * k,
    touchTaperStart: brush.touchTaperStart * k,
    touchTaperEnd: brush.touchTaperEnd * k,
    grainScale: brush.grainScale * Math.max(0.35, k),
  }
}

/** Preview: the sample stroke (or one stamp for stamp previews), for the library and the editor. */
export function drawPreview(canvas: HTMLCanvasElement, brush: BrushSettings, color: string) {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  const mask = makeCanvas(w, h)
  const single = brush.stampPreview
  // Big brushes are shown smaller so the whole stroke fits.
  const fit = Math.min(1, (h * (single ? 0.9 : 0.55)) / brush.size)
  const b = scaledBrush({ ...brush, stabilization: 0, motionFilter: 0, tipAnimation: false }, fit)
  const s = new StrokeStamper(mask.getContext('2d')!, b, undefined, 7, color)
  if (single) s.add({ x: w / 2, y: h / 2, pressure: 1 })
  else for (const p of sampleStroke(w, h)) s.add(p)
  s.finish()
  const out = makeCanvas(w, h)
  const ring = colorStroke(mask, out.getContext('2d')!, color, b)
  compositeStroke(ctx, out, { ...b, blend: 'source-over', luminanceBlend: false }, { erase: false, alphaLock: false, selection: null, ring })
}
