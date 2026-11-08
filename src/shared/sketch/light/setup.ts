/**
 * The light preview's setup (Draw): grey objects on a floor and up to four lamps around them.
 * Pure data and maths; the 3D drawing lives in LightPreview.tsx. The setup is remembered per
 * device (not in the drawing), so project files don't change.
 */

export type Shape = 'ball' | 'cube' | 'cylinder' | 'cone' | 'ring' | 'head' | 'figure' | 'model'
export type LightView = 'clay' | 'three' | 'two'

export interface Lamp {
  id: string
  on: boolean
  /** Sun: parallel light, sharp same-size shadows. Bulb: light from a point, shadows spread. */
  kind: 'sun' | 'bulb'
  /** 0..3 */
  strength: number
  color: string
  /** Degrees around the object, 0 = in front, 90 = to the right. */
  azimuth: number
  /** Degrees above the floor (negative = from below). */
  elevation: number
  /** Distance from the middle of the scene, 1..8. */
  distance: number
}

export interface Thing {
  id: string
  shape: Shape
  x: number
  z: number
  /** 0.2..3, 1 = about one unit tall. */
  size: number
  /** Degrees around the up axis. */
  turn: number
  /** For shape 'model': the key of a model loaded this session, and its file name. */
  model?: string
  name?: string
  /** For shape 'figure': joint angles in degrees (see figures.ts). */
  pose?: Record<string, number>
}

export interface LightSetup {
  lamps: Lamp[]
  things: Thing[]
  /** How bright the shadows are (light bouncing around the room), 0..1. */
  room: number
  /** 0 = hard shadow edges, 1 = very soft. */
  softness: number
  view: LightView
  /** Colour of every object. */
  color: string
  /** 0 = matte, 1 = shiny. */
  shine: number
  /** Colour of the light bouncing up from the ground. */
  bounce: string
  /** Show the view in grey to judge values. */
  grey: boolean
  /** Dark contact shadows where objects touch the floor or each other. */
  contact: boolean
}

export const MAX_LAMPS = 4
export const MAX_THINGS = 8
/** Things stay on this part of the floor. */
export const FLOOR = 4
/** The point lamps circle around. */
export const AIM = { x: 0, y: 0.5, z: 0 }

let n = 0
export const uid = () => `lamp-${Date.now().toString(36)}-${n++}`

export function defaultSetup(): LightSetup {
  return {
    lamps: [
      { id: 'key', on: true, kind: 'sun', strength: 1.8, color: '#fff1dc', azimuth: -45, elevation: 45, distance: 3 },
      // A cool light from behind gives the coloured rim painters like.
      { id: 'rim', on: true, kind: 'sun', strength: 0.9, color: '#6fe3cf', azimuth: 135, elevation: 35, distance: 3 },
    ],
    things: [
      { id: 'ball', shape: 'ball', x: 0, z: 0, size: 1.2, turn: 0 },
      { id: 'small', shape: 'ball', x: 0.85, z: 0.55, size: 0.5, turn: 0 },
    ],
    room: 0.15,
    softness: 0.35,
    view: 'clay',
    color: '#e2785a',
    shine: 0.35,
    bounce: '#2f5f5a',
    grey: false,
    contact: true,
  }
}

const rad = Math.PI / 180

/** Where a lamp sits in the scene. */
export function lampPosition(l: Pick<Lamp, 'azimuth' | 'elevation' | 'distance'>): [number, number, number] {
  const a = l.azimuth * rad
  const e = l.elevation * rad
  return [AIM.x + l.distance * Math.cos(e) * Math.sin(a), AIM.y + l.distance * Math.sin(e), AIM.z + l.distance * Math.cos(e) * Math.cos(a)]
}

/** The lamp angles for a point in the scene (inverse of lampPosition). */
export function anglesAt(x: number, y: number, z: number): { azimuth: number; elevation: number } {
  const dx = x - AIM.x
  const dy = y - AIM.y
  const dz = z - AIM.z
  const flat = Math.hypot(dx, dz)
  return { azimuth: Math.atan2(dx, dz) / rad, elevation: clamp(Math.atan2(dy, flat) / rad, -85, 85) }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback)
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback)
const SHAPES: Shape[] = ['ball', 'cube', 'cylinder', 'cone', 'ring', 'head', 'figure', 'model']

/** Joint angles from storage: numbers only, within -180..180. */
export function cleanPose(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = clamp(v, -180, 180)
  return out
}

/** A setup read back from storage, made safe: bad values fixed, models that aren't loaded any more dropped. */
export function restoreSetup(raw: unknown, loadedModels: ReadonlySet<string>): LightSetup {
  const d = defaultSetup()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<Record<keyof LightSetup, unknown>>
  const lamps = Array.isArray(r.lamps)
    ? r.lamps
        .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
        .slice(0, MAX_LAMPS)
        .map((l, i) => ({
          id: typeof l.id === 'string' ? l.id : `lamp-${i}`,
          on: l.on !== false,
          kind: l.kind === 'bulb' ? ('bulb' as const) : ('sun' as const),
          strength: num(l.strength, 0, 3, 1),
          color: hex(l.color, '#ffffff'),
          azimuth: num(l.azimuth, -360, 360, 0),
          elevation: num(l.elevation, -85, 85, 45),
          distance: num(l.distance, 1, 8, 4),
        }))
    : d.lamps
  const things = Array.isArray(r.things)
    ? r.things
        .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && SHAPES.includes(t.shape as Shape))
        .filter((t) => t.shape !== 'model' || (typeof t.model === 'string' && loadedModels.has(t.model)))
        .slice(0, MAX_THINGS)
        .map((t, i) => ({
          id: typeof t.id === 'string' ? t.id : `thing-${i}`,
          shape: t.shape as Shape,
          x: num(t.x, -FLOOR, FLOOR, 0),
          z: num(t.z, -FLOOR, FLOOR, 0),
          size: num(t.size, 0.2, 3, 1),
          turn: num(t.turn, -360, 360, 0),
          ...(t.shape === 'model' ? { model: t.model as string, name: typeof t.name === 'string' ? t.name : 'Model' } : {}),
          ...(t.shape === 'figure' && t.pose && typeof t.pose === 'object' ? { pose: cleanPose(t.pose as Record<string, unknown>) } : {}),
        }))
    : d.things
  return {
    lamps,
    things,
    room: num(r.room, 0, 1, d.room),
    softness: num(r.softness, 0, 1, d.softness),
    view: r.view === 'three' || r.view === 'two' ? r.view : 'clay',
    color: hex(r.color, d.color),
    shine: num(r.shine, 0, 1, d.shine),
    bounce: hex(r.bounce, d.bounce),
    grey: r.grey === true,
    contact: r.contact !== false,
  }
}

/**
 * The shading steps for the tone views, as a strip the toon material reads with
 * (lamp facing − 1..1) mapped to 0..1. Ten steps of 0.2 each so the shadow line sits
 * exactly where a surface turns away from the lamp.
 */
export function toneSteps(view: LightView): number[] {
  // Facing away = shadow side (0); just turned towards = half tone; facing it = lit.
  if (view === 'two') return [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
  return [0, 0, 0, 0, 0, 0.45, 0.45, 1, 1, 1]
}

export type LightPresetId = 'sunny' | 'cloudy' | 'studio' | 'rim' | 'below' | 'window'

type PresetLamp = Omit<Lamp, 'id' | 'on'>
const PRESETS: Record<LightPresetId, { lamps: PresetLamp[]; room: number; softness: number; bounce: string }> = {
  // Warm sun high up, a weak blue sky fill from the other side.
  sunny: {
    lamps: [
      { kind: 'sun', strength: 2.4, color: '#fff0d6', azimuth: -40, elevation: 55, distance: 3 },
      { kind: 'sun', strength: 0.35, color: '#9cc4ff', azimuth: 140, elevation: 60, distance: 3 },
    ],
    room: 0.25,
    softness: 0.1,
    bounce: '#6b5a3c',
  },
  // One very soft light from above, bright shadows.
  cloudy: { lamps: [{ kind: 'sun', strength: 0.9, color: '#eef2f6', azimuth: -20, elevation: 80, distance: 3 }], room: 0.6, softness: 1, bounce: '#55585c' },
  // Three-point light: key, fill and rim.
  studio: {
    lamps: [
      { kind: 'sun', strength: 1.8, color: '#fff6ea', azimuth: -45, elevation: 35, distance: 3 },
      { kind: 'sun', strength: 0.5, color: '#dfe8ff', azimuth: 50, elevation: 15, distance: 3 },
      { kind: 'sun', strength: 1.2, color: '#ffffff', azimuth: 160, elevation: 40, distance: 3 },
    ],
    room: 0.12,
    softness: 0.4,
    bounce: '#3a3a3f',
  },
  // Strong light from behind for a bright outline, a faint front fill.
  rim: {
    lamps: [
      { kind: 'sun', strength: 2.4, color: '#ffe2b8', azimuth: 170, elevation: 25, distance: 3 },
      { kind: 'sun', strength: 0.3, color: '#a9c6ff', azimuth: -30, elevation: 10, distance: 3 },
    ],
    room: 0.08,
    softness: 0.3,
    bounce: '#2a2a33',
  },
  // A bulb low in front, pointing up: the campfire or horror look.
  below: { lamps: [{ kind: 'bulb', strength: 2.2, color: '#ff9a4d', azimuth: 10, elevation: -35, distance: 2 }], room: 0.04, softness: 0.25, bounce: '#3a1f12' },
  // Soft cool light from one side, the other side falls into shadow.
  window: { lamps: [{ kind: 'sun', strength: 2, color: '#e6efff', azimuth: -90, elevation: 20, distance: 3 }], room: 0.15, softness: 0.75, bounce: '#4a4038' },
}

export const PRESET_IDS = Object.keys(PRESETS) as LightPresetId[]

/** The setup with a preset's lamps and room light; objects, colour and view stay. */
export function applyPreset(s: LightSetup, id: LightPresetId): LightSetup {
  const p = PRESETS[id]
  return { ...s, lamps: p.lamps.map((l) => ({ ...l, id: uid(), on: true })), room: p.room, softness: p.softness, bounce: p.bounce }
}
