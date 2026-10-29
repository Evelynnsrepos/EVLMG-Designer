import { newId, type Id } from '@/core/model'
import { CANVAS_BLENDS, type BlendMode } from './blend'
import { shiftColor } from './brushColor'
import { PathSmoother } from './brushPath'
import { applyCurve, hasRealPressure, type CurvePoint } from './pen'
import { GRAINS, grainCanvas, imageTip, seeded, SHAPES, tipImage, type BrushGrain, type BrushShape } from './brushTextures'

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

const hasGrain = (b: BrushSettings) => !!b.grainImage || b.grain !== 'none'
const isBlending = (b: BrushSettings) => b.renderMode === 'uniform-blending' || b.renderMode === 'intense-blending'

/** The opacity a finished stroke is drawn with onto the layer. */
export function strokeAlpha(b: BrushSettings): number {
  if (isBlending(b)) return 1
  return b.renderMode === 'uniform-glaze' ? b.opacity * b.flow : b.opacity
}

/** How far paint can land from the stroke's path (px), for undo areas. */
export function brushReach(b: BrushSettings): number {
  const grow = (1 + b.sizeJitter + b.scatter * Math.max(1, b.count)) * (1 + b.tiltSize * 2) * (1 + Math.max(0, b.speedSize))
  return b.size * grow * Math.max(1, b.dual ? b.dualScale * (1 + b.dual.scatter) : 1) + 4
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

/**
 * Stamps one stroke into an alpha mask. Keeps the distance travelled so taper
 * and spacing are right; `finish` replays all points once the end is known.
 * With tip animation the end taper is drawn live on a separate layer.
 */
export class StrokeStamper {
  protected points: Pt[] = []
  protected brush: BrushSettings
  protected mirror: (p: { x: number; y: number }) => { x: number; y: number }[]
  protected out: CanvasRenderingContext2D
  /** Where final stamps go: `out` itself, or a canvas of its own when the output is assembled. */
  protected main: CanvasRenderingContext2D
  private tail: CanvasRenderingContext2D | null = null
  private tailRect: Rect | null = null
  private second: StrokeStamper | null = null
  private dirty: Rect | null = null
  private cursor: Cursor = START
  private pathLength = 0
  private rngState: number
  private seed: number
  private smoother: PathSmoother<Pt>
  private lastRaw: (Pt & { time: number }) | null = null
  private dabBuf: HTMLCanvasElement | null = null
  protected strokeColor: string
  protected colored: boolean

  constructor(
    ctx: CanvasRenderingContext2D,
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
    this.colored = forceColor || hasColorDynamics(brush)
    const animate = brush.tipAnimation && (brush.taperEnd > 0 || brush.touchTaperEnd > 0)
    this.main = animate || brush.dual ? makeCanvas(ctx.canvas.width, ctx.canvas.height).getContext('2d')! : ctx
    if (animate) this.tail = makeCanvas(ctx.canvas.width, ctx.canvas.height).getContext('2d')!
    if (brush.dual) {
      const second = makeCanvas(ctx.canvas.width, ctx.canvas.height).getContext('2d')!
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
    this.push(this.smoother.push(raw))
  }

  /** Clear and draw the whole stroke again with the end taper (the stroke length is known now). */
  finish() {
    for (const q of this.smoother.flush()) this.push(q, false)
    this.second?.finish()
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
    const o = this.out
    o.save()
    o.beginPath()
    o.rect(x, y, w, h)
    o.clip()
    o.globalAlpha = 1
    o.globalCompositeOperation = 'source-over'
    o.clearRect(x, y, w, h)
    o.drawImage(this.main.canvas, x, y, w, h, x, y, w, h)
    if (this.tail) o.drawImage(this.tail.canvas, x, y, w, h, x, y, w, h)
    if (this.second) {
      o.globalCompositeOperation = DUAL_MODES.find((m) => m.id === this.brush.dualMode)!.op
      o.drawImage(this.second.out.canvas, x, y, w, h, x, y, w, h)
    }
    o.restore()
  }

  /**
   * Stamp along the points from `c`, stopping before the first stamp past
   * `limit`. Returns where it stopped, so stamping can go on from there.
   */
  private run(c: Cursor, total: number, limit: number, to: CanvasRenderingContext2D): Cursor {
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

  private stampPoint(p: Pt, angle: number, at: number, total: number, to: CanvasRenderingContext2D) {
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

  /** Mark the area a stamp covers, so only that part is assembled. */
  protected touch(x: number, y: number, size: number, to: CanvasRenderingContext2D) {
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
    if (d.color) {
      g.globalCompositeOperation = 'source-in'
      g.fillStyle = d.color
      g.fillRect(0, 0, s, s)
    }
    g.restore()
    return { image: this.dabBuf, w: s, h: s }
  }

  protected drawDab(d: Dab, to: CanvasRenderingContext2D) {
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
export function colorStroke(mask: HTMLCanvasElement, out: CanvasRenderingContext2D, color: string, brush: BrushSettings, area?: Area) {
  const W = out.canvas.width
  const H = out.canvas.height
  out.save()
  out.globalCompositeOperation = 'source-over'
  out.globalAlpha = 1
  out.clearRect(0, 0, W, H)
  out.drawImage(mask, 0, 0)
  if (!hasColorDynamics(brush)) {
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
  if (brush.alphaThreshold > 0 && r.w > 0 && r.h > 0) {
    const img = out.getImageData(r.x, r.y, r.w, r.h)
    const d = img.data
    const t = brush.alphaThreshold * 255
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= t && d[i] > 0 ? 255 : 0
    out.putImageData(img, r.x, r.y)
  }
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
  o: { erase: boolean; alphaLock: boolean; selection: Path2D | null; area?: Area },
) {
  const alpha = strokeAlpha(brush)
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
  colorStroke(mask, out.getContext('2d')!, color, b)
  compositeStroke(ctx, out, { ...b, blend: 'source-over', luminanceBlend: false }, { erase: false, alphaLock: false, selection: null })
}
