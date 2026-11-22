import type { BodyKind } from './model'

/**
 * Art styles for the Cosmos Creator. Pictures live in public/cosmos/<style>/ (all CC0,
 * see public/cosmos/CREDITS.md) and are stored grey, so tinting with a body's colour gives
 * that colour at full strength.
 */
export const ART_STYLES = ['painted', 'pixel', 'flat', 'custom'] as const
export type ArtStyle = (typeof ART_STYLES)[number]

export const STYLE_LABEL: Record<ArtStyle, string> = {
  painted: 'Painted',
  pixel: 'Pixel art',
  flat: 'Flat',
  custom: 'Your own set',
}

/** One picture of a body, sized relative to the body's radius. */
export interface Layer {
  /** Picture path under public/, or a fill colour for a plain disc ('#000' = black hole centre). */
  src: string
  /** Size as a multiple of the radius (default 1 = the picture spans the body's circle). */
  s?: number
  rot?: number
  /** Offset as a multiple of the radius. */
  x?: number
  y?: number
  op?: number
  /** Drawn without the tint (white glows, black centres). */
  plain?: boolean
  /** Squash to the tilted orbit plane (flat things like galaxies). */
  flat?: boolean
}

const pick = <T,>(list: readonly T[], v: number) => list[v % list.length]

/** A stable number per body so siblings of the same kind don't all look the same. */
export function variantOf(id: string, look?: number): number {
  if (look !== undefined) return look
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

const P = (n: string) => `cosmos/painted/${n}.png`
const X = (n: string) => `cosmos/pixel/${n}.png`
const F = (n: string) => `cosmos/flat/${n}.png`

const PAINTED_PLANETS = [0, 1, 2, 3, 5, 6, 7, 8, 9].map((i) => P(`planet${i}`))
const PAINTED_ROCKY = [4, 5, 6].map((i) => P(`planet${i}`))

/** A ring of small rocks on the tilted plane. */
const belt = (rock: (i: number) => string, size: number): Layer[] =>
  Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2
    return { src: rock(i), s: size * (0.8 + ((i * 7) % 3) * 0.2), x: Math.cos(a), y: Math.sin(a) * 0.5, rot: i * 40 }
  })

function painted(kind: BodyKind, v: number): Layer[] {
  switch (kind) {
    case 'planet':
      return [{ src: pick(PAINTED_PLANETS, v) }]
    case 'dwarf-planet':
    case 'moon':
      return [{ src: pick(PAINTED_ROCKY, v) }]
    case 'star':
    case 'solar-system':
      return [
        { src: P('circle5'), s: 2.6, op: 0.9 },
        { src: P('star6'), s: 3, op: 0.9 },
        { src: P('sphere'), s: 1 },
        { src: P('circle5'), s: 1, plain: true, op: 0.6 },
      ]
    case 'galaxy':
      return [
        { src: P('circle5'), s: 2.2, op: 0.5, flat: true },
        { src: P('twirl1'), s: 2.4, rot: 0, flat: true },
        { src: P('twirl2'), s: 2.4, rot: 120, flat: true },
        { src: P('twirl3'), s: 2.4, rot: 240, flat: true },
        { src: P('circle5'), s: 0.9, plain: true, op: 0.9, flat: true },
      ]
    case 'nebula':
      return [
        { src: P('smoke5'), s: 2.4, op: 0.8 },
        { src: P('smoke1'), s: 2, rot: 90 + (v % 4) * 40, op: 0.9 },
        { src: P('smoke4'), s: 1.4, rot: (v % 6) * 60 },
      ]
    case 'universe':
      return [
        { src: P('smoke5'), s: 2.6, op: 0.6 },
        { src: P('twirl1'), s: 1.8, rot: 30, flat: true },
        { src: P('twirl3'), s: 1.8, rot: 210, flat: true },
        { src: P('star1'), s: 1.4, x: -0.6, y: -0.3, plain: true },
        { src: P('star1'), s: 1.1, x: 0.7, y: 0.2, plain: true },
        { src: P('circle5'), s: 1, plain: true, op: 0.8 },
      ]
    case 'cluster':
      return [
        { src: P('circle5'), s: 2.2, op: 0.5 },
        ...[
          [0, 0, 1.6],
          [-0.5, -0.35, 1.1],
          [0.55, -0.2, 1.2],
          [-0.3, 0.5, 1],
          [0.4, 0.45, 0.9],
        ].map(([x, y, s]) => ({ src: P('star1'), s, x, y })),
      ]
    case 'black-hole':
      return [
        { src: P('circle5'), s: 2.4, op: 0.7 },
        { src: P('twirl2'), s: 2.2, rot: 40, flat: true },
        { src: '#000', s: 1, plain: true },
        { src: P('circle2'), s: 1.35 },
      ]
    case 'asteroid-belt':
      return belt((i) => pick(PAINTED_ROCKY, v + i), 0.32)
    case 'comet':
      return [
        { src: P('trace5'), s: 4, x: 1.3, y: -1.3, rot: 45, op: 0.9 },
        { src: P('circle5'), s: 2, op: 0.8 },
        { src: P('sphere'), s: 0.9 },
      ]
    case 'station':
      return [{ src: P('station'), s: 1.6 }]
    default:
      return [{ src: P('sphere') }]
  }
}

function pixel(kind: BodyKind, v: number): Layer[] {
  switch (kind) {
    case 'planet':
      return [pick([{ src: X('planet-1'), s: 1.25 }, { src: X('planet-2'), s: 1.05 }], v)]
    case 'dwarf-planet':
      return [{ src: X('meteor-1'), s: 1.1 }]
    case 'moon':
      return [pick([{ src: X('moon'), s: 1.1 }, { src: X('planet-2'), s: 1 }], v)]
    case 'star':
    case 'solar-system':
      return [{ src: pick([X('star-1'), X('star-2')], v), s: 1.6 }]
    case 'galaxy':
    case 'black-hole':
      return [{ src: X('black-hole'), s: 2.4 }]
    case 'nebula':
      return [{ src: X('nebula'), s: 2.4, rot: (v % 4) * 90 }]
    case 'universe':
    case 'cluster':
      return [
        { src: X('stars'), s: 2.6 },
        { src: X('star-2'), s: 0.7, x: -0.4, y: -0.2 },
        { src: X('star-1'), s: 0.5, x: 0.5, y: 0.3 },
      ]
    case 'asteroid-belt':
      return belt((i) => pick([X('meteor-1'), X('meteor-2'), X('meteor-3')], v + i), 0.4)
    case 'comet':
      return [{ src: X('meteor-2'), s: 1.4 }]
    case 'station':
      return [{ src: X('station'), s: 1.6 }]
    default:
      return [{ src: X('planet-2') }]
  }
}

/** Flat: plain discs (drawn by the view) plus Simple Space icons for the odd shapes. */
function flat(kind: BodyKind, v: number): Layer[] | null {
  switch (kind) {
    case 'star':
    case 'solar-system':
      return [{ src: F('star-large'), s: 1.8 }]
    case 'cluster':
      return [
        { src: F('star-large'), s: 1.3 },
        { src: F('star-medium'), s: 0.9, x: -0.7, y: -0.3 },
        { src: F('star-small'), s: 0.7, x: 0.7, y: 0.4 },
      ]
    case 'asteroid-belt':
      return belt((i) => pick([F('meteor-detailedLarge'), F('meteor-large'), F('meteor-squareDetailedLarge')], v + i), 0.35)
    case 'comet':
      return [{ src: F('meteor-detailedLarge'), s: 1.3 }]
    case 'station':
      return [{ src: pick([F('station-A'), F('station-B'), F('station-C'), F('satellite-A')], v), s: 1.6 }]
    default:
      return null
  }
}

/** The layers for a body, or null for the plain vector disc. `custom` = the user's picture for this kind, if any. */
export function artFor(style: ArtStyle, kind: BodyKind, v: number, custom?: string): Layer[] | null {
  if (style === 'custom') return custom ? [{ src: custom, s: 1.2 }] : painted(kind, v)
  if (style === 'pixel') return pixel(kind, v)
  if (style === 'flat') return flat(kind, v)
  return painted(kind, v)
}

/** How many looks "Next look" cycles through for a kind. */
export function lookCount(style: ArtStyle, kind: BodyKind): number {
  if (style === 'pixel') return kind === 'planet' || kind === 'moon' || kind === 'star' || kind === 'solar-system' ? 2 : 1
  if (style === 'flat') return kind === 'station' ? 4 : 1
  if (style === 'painted' || style === 'custom')
    return kind === 'planet' ? PAINTED_PLANETS.length : kind === 'moon' || kind === 'dwarf-planet' ? PAINTED_ROCKY.length : kind === 'nebula' ? 4 : 1
  return 1
}
