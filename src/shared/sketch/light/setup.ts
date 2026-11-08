/**
 * The light preview's setup (Draw): grey objects on a floor and up to four lamps around them.
 * Pure data and maths; the 3D drawing lives in LightPreview.tsx. The setup is remembered per
 * device (not in the drawing), so project files don't change.
 */

export type Shape = 'ball' | 'cube' | 'cylinder' | 'cone' | 'ring' | 'model'
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
}

export interface LightSetup {
  lamps: Lamp[]
  things: Thing[]
  /** How bright the shadows are (light bouncing around the room), 0..1. */
  room: number
  /** 0 = hard shadow edges, 1 = very soft. */
  softness: number
  view: LightView
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
    lamps: [{ id: 'key', on: true, kind: 'sun', strength: 1.6, color: '#fff4e0', azimuth: -40, elevation: 45, distance: 3 }],
    things: [
      { id: 'ball', shape: 'ball', x: 0, z: 0, size: 1, turn: 0 },
      { id: 'cube', shape: 'cube', x: 1.1, z: -0.5, size: 0.7, turn: 30 },
    ],
    room: 0.15,
    softness: 0.3,
    view: 'clay',
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
const SHAPES: Shape[] = ['ball', 'cube', 'cylinder', 'cone', 'ring', 'model']

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
          color: typeof l.color === 'string' && /^#[0-9a-f]{6}$/i.test(l.color) ? l.color : '#ffffff',
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
        }))
    : d.things
  return {
    lamps,
    things,
    room: num(r.room, 0, 1, d.room),
    softness: num(r.softness, 0, 1, d.softness),
    view: r.view === 'three' || r.view === 'two' ? r.view : 'clay',
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
