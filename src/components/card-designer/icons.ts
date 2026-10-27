import {
  Axe,
  BowArrow,
  Brain,
  Coins,
  Crosshair,
  Crown,
  Dices,
  Droplet,
  Eye,
  Flame,
  Footprints,
  Gem,
  Hand,
  Heart,
  Hourglass,
  Leaf,
  Moon,
  Mountain,
  Shield,
  Skull,
  Snowflake,
  Sparkles,
  Star,
  Sun,
  Sword,
  Swords,
  Wand,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/** Built-in icons for `:name:` in card text (lucide, ISC licence, already part of the app). */
export const BUILTIN_ICONS: Record<string, LucideIcon> = {
  sword: Sword, swords: Swords, attack: Swords, shield: Shield, defense: Shield, heart: Heart, health: Heart,
  mana: Droplet, energy: Zap, coin: Coins, gold: Coins, star: Star, skull: Skull, fire: Flame, time: Hourglass,
  eye: Eye, move: Footprints, range: Crosshair, magic: Sparkles, gem: Gem, moon: Moon, sun: Sun, nature: Leaf,
  ice: Snowflake, earth: Mountain, wand: Wand, axe: Axe, bow: BowArrow, crown: Crown, dice: Dices, hand: Hand, mind: Brain,
}

const pathCache = new Map<string, string[]>()

/**
 * The icon's outlines as SVG path data on a 24 × 24 grid, so the canvas draws it as vector strokes in any
 * colour and size, with no picture to load. Read from the icon's own data (its element's `icon` prop).
 */
export function iconPaths(name: string): string[] {
  const hit = pathCache.get(name)
  if (hit) return hit
  const Icon = BUILTIN_ICONS[name] as unknown as { render?(p: object, r: null): { props?: { icon?: { node?: [string, Record<string, string>][] } } } }
  const node = Icon?.render?.({}, null)?.props?.icon?.node ?? []
  const n = (a: Record<string, string>, k: string) => Number(a[k] ?? 0)
  const out = node.map(([t, a]) => {
    if (t === 'path') return a.d ?? ''
    if (t === 'circle' || t === 'ellipse') {
      const rx = n(a, t === 'circle' ? 'r' : 'rx')
      const ry = t === 'circle' ? rx : n(a, 'ry')
      return `M${n(a, 'cx') - rx} ${n(a, 'cy')}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`
    }
    if (t === 'rect') return `M${n(a, 'x')} ${n(a, 'y')}h${n(a, 'width')}v${n(a, 'height')}h${-n(a, 'width')}Z`
    if (t === 'line') return `M${n(a, 'x1')} ${n(a, 'y1')}L${n(a, 'x2')} ${n(a, 'y2')}`
    if (t === 'polyline' || t === 'polygon') return `M${(a.points ?? '').trim().split(/[\s,]+/).reduce((s, v, i) => s + (i % 2 ? ` ${v}` : `${i ? 'L' : ''}${v}`), '')}${t === 'polygon' ? 'Z' : ''}`
    return ''
  })
  pathCache.set(name, out)
  return out
}
