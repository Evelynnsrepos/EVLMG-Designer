import { newId } from '@/core/model'
import { createScene, renderOrder, type NodeBase, type Scene, type TextNode } from '@/shared/canvas'
import { nodeMatrix, pathD, type SubPath } from './paths'
import { SHAPE_DEFAULTS, shapePath, type ShapeGeometry, type ShapeKind } from './shapes'

/** How a shape or path is painted. Every field is optional, so older drawings keep their look. */
export interface Look {
  fillColor?: string
  /** Second colour of a gradient; none = one colour. */
  fill2Color?: string
  /** Gradient direction in degrees: 0 = top to bottom, 90 = right to left… */
  gradAngle?: number
  /** Round gradient: first colour in the middle. */
  gradRadial?: boolean
  strokeColor?: string
  strokeWidth?: number
  /** Dashed outline. */
  strokeDash?: boolean
  /** Sharp corners and flat ends on the outline (default round). */
  strokeSharp?: boolean
  opacity?: number
  shadow?: boolean
  /** Glow instead of a drop shadow (no offset, all around). */
  glow?: boolean
  shadowColor?: string
  /** Shadow or glow size, % of the normal size. */
  shadowSize?: number
}

/** Shared by every node: items with the same group move and get selected together. */
interface Grouped {
  groupId?: string
}

/** A live shape: kind + sliders + look. Resizing changes width/height, so outlines stay sharp. */
export interface ShapeNode extends NodeBase, ShapeGeometry, Look, Grouped {
  kind: 'vshape'
}

/** Points you can edit: from the pen, the pencil, "Edit points", combining shapes or an SVG file. */
export interface PathNode extends NodeBase, Look, Grouped {
  kind: 'vpath'
  /** In the node's own space, inside (0, 0)–(width, height). */
  paths: SubPath[]
  width: number
  height: number
  /** Overlapping parts make holes. */
  evenOdd?: boolean
  /** The shapes this came from by combining, so "Take apart" can bring them back. */
  from?: VectorNode[]
}

export interface VTextNode extends TextNode, Grouped {
  fontFamily?: string
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
}

export type VectorNode = ShapeNode | PathNode | VTextNode
export type PaintNode = ShapeNode | PathNode

export const isPaint = (n: VectorNode | undefined): n is PaintNode => n?.kind === 'vshape' || n?.kind === 'vpath'

/** SVG path data of a shape or path in its own space. */
export const nodeD = (n: PaintNode) => (n.kind === 'vshape' ? shapePath(n) : pathD(n.paths))

/** A shape for the shape maths, placed in the drawing. */
export const geomOf = (n: PaintNode) => ({ d: nodeD(n), m: nodeMatrix(n), evenodd: n.kind === 'vpath' && !!n.evenOdd })

/** Gradient line (or centre and radius) in the shape's own box. */
export function gradientGeometry(look: Look, w: number, h: number) {
  const a = ((look.gradAngle ?? 0) * Math.PI) / 180
  const dir = { x: -Math.sin(a), y: Math.cos(a) }
  const half = Math.abs(dir.x) * (w / 2) + Math.abs(dir.y) * (h / 2)
  const c = { x: w / 2, y: h / 2 }
  return { start: { x: c.x - dir.x * half, y: c.y - dir.y * half }, end: { x: c.x + dir.x * half, y: c.y + dir.y * half }, centre: c, radius: Math.max(w, h) / 2 }
}

/** Drop shadow / glow numbers shared by the canvas and the SVG file. */
export function shadowOf(n: Look & { width: number; height: number }) {
  const base = shadowOffset(n) * ((n.shadowSize ?? 100) / 100)
  return n.glow
    ? { dx: 0, dy: 0, blur: base * 1.6, color: n.shadowColor ?? '#ffd43b', opacity: 0.9 }
    : { dx: 0, dy: base, blur: base, color: n.shadowColor ?? '#000000', opacity: 0.35 }
}

export interface VectorDoc {
  /** What the user picked on the start screen; null until then. */
  presetId: string | null
  /** The drawing area at (0, 0). Exports show exactly this box. */
  artboard: { width: number; height: number; bgColor?: string }
  scene: Scene<VectorNode>
  /** Things stick to edges and centres while moving (default on). */
  snap?: boolean
  /** Whole-pixel positions; default on except for logos and app icons. */
  crisp?: boolean
}

export const createVectorDoc = (): VectorDoc => ({ presetId: null, artboard: { width: 512, height: 512 }, scene: createScene<VectorNode>() })

export const OUTLINE_DARK = '#1d1a2b'

export function makeShape(layerId: string, shapeId: ShapeKind, x: number, y: number, width: number, height: number, look: Partial<ShapeNode> = {}): ShapeNode {
  return { id: newId(), kind: 'vshape', layerId, shapeId, x, y, width, height, ...SHAPE_DEFAULTS[shapeId], fillColor: '#4dabf7', strokeWidth: 0, ...look }
}

/** Mixes a #rrggbb colour towards black (amount < 0) or white (amount > 0). */
export function shade(hex: string, amount: number): string {
  const v = parseInt(hex.replace('#', '').slice(0, 6).padEnd(6, '0'), 16)
  const ch = (c: number) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)
  return `#${((1 << 24) | (ch((v >> 16) & 255) << 16) | (ch((v >> 8) & 255) << 8) | ch(v & 255)).toString(16).slice(1)}`
}

/** One-click looks: they only set the look fields, so every part can still be changed afterwards. */
export const LOOKS: { id: string; label: string; hint: string; apply(n: Look, art: { width: number; height: number }): Partial<ShapeNode> }[] = [
  { id: 'flat', label: 'Flat', hint: 'One colour, no outline', apply: () => ({ strokeWidth: 0, fill2Color: undefined, shadow: false, glow: false }) },
  {
    id: 'game',
    label: 'Game icon',
    hint: 'Thick dark outline, soft shading and a shadow',
    apply: (n, art) => ({ strokeColor: OUTLINE_DARK, strokeWidth: Math.max(2, Math.round(Math.min(art.width, art.height) * 0.03)), fill2Color: shade(n.fillColor ?? '#4dabf7', -0.35), shadow: true }),
  },
  {
    id: 'glossy',
    label: 'Glossy',
    hint: 'Light top, darker bottom, thin outline',
    apply: (n, art) => ({ fillColor: shade(n.fillColor ?? '#4dabf7', 0.25), fill2Color: shade(n.fillColor ?? '#4dabf7', -0.25), strokeColor: shade(n.fillColor ?? '#4dabf7', -0.5), strokeWidth: Math.max(1, Math.round(Math.min(art.width, art.height) * 0.012)), gradAngle: 0, gradRadial: false, shadow: false }),
  },
  {
    id: 'glow',
    label: 'Glow',
    hint: 'Soft light all around, for magic and rare items',
    apply: (n) => ({ shadow: true, glow: true, shadowColor: n.fillColor && n.fillColor !== 'transparent' ? shade(n.fillColor, 0.4) : '#ffd43b', shadowSize: 150 }),
  },
  {
    id: 'outline',
    label: 'Outline only',
    hint: 'No fill, just the line',
    apply: (n, art) => ({ strokeColor: n.fillColor && n.fillColor !== 'transparent' ? n.fillColor : (n.strokeColor ?? OUTLINE_DARK), fillColor: 'transparent', fill2Color: undefined, strokeWidth: Math.max(2, Math.round(Math.min(art.width, art.height) * 0.03)), shadow: false }),
  },
]

/** Shadow size follows the shape, so it looks the same on a 128 px icon and a 1024 px logo. */
export const shadowOffset = (n: { width: number; height: number }) => Math.max(1.5, Math.min(n.width, n.height) * 0.05)

export const TEXT_FONT = "'Lexend Deca', sans-serif"

/** CSS font of a text item (Lexend Deca unless one was picked). */
export const textFont = (n: VTextNode) => (n.fontFamily ? `'${n.fontFamily.replace(/'/g, '')}', sans-serif` : TEXT_FONT)

// ---------- start screen ----------

export interface Preset {
  id: string
  label: string
  hint: string
  width: number
  height: number
}

export const PRESETS: Preset[] = [
  { id: 'inventory', label: 'Inventory icon', hint: 'Items for bags, shops and loot', width: 128, height: 128 },
  { id: 'skill', label: 'Skill icon', hint: 'Abilities, spells and talents', width: 128, height: 128 },
  { id: 'app', label: 'App / game icon', hint: 'The icon people click to start your game', width: 512, height: 512 },
  { id: 'logo', label: 'Logo', hint: 'Your studio or game name with a mark', width: 1024, height: 512 },
  { id: 'button', label: 'Button', hint: 'Menu buttons like Play and Options', width: 256, height: 80 },
  { id: 'bar', label: 'Health bar', hint: 'Health, mana or progress', width: 400, height: 64 },
  { id: 'panel', label: 'Panel / window', hint: 'Menus, dialogue boxes and pop-ups', width: 400, height: 300 },
  { id: 'badge', label: 'Badge / medal', hint: 'Achievements, ranks and rewards', width: 256, height: 256 },
  { id: 'empty', label: 'Empty', hint: 'Any size; change it under Drawing size', width: 512, height: 512 },
]

export function startFrom(p: Preset, d: VectorDoc): VectorDoc {
  return { ...d, presetId: p.id, artboard: { width: p.width, height: p.height } }
}

// ---------- SVG ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (v: number) => String(Math.round(v * 100) / 100)

function transformOf(nd: NodeBase) {
  const t = [`translate(${num(nd.x)} ${num(nd.y)})`]
  if (nd.rotation) t.push(`rotate(${num(nd.rotation)})`)
  if ((nd.scaleX ?? 1) !== 1 || (nd.scaleY ?? 1) !== 1) t.push(`scale(${num(nd.scaleX ?? 1)} ${num(nd.scaleY ?? 1)})`)
  return t.join(' ')
}

/** The artboard as a standalone SVG file. Hidden layers and items are left out. */
export function toSvg(d: Pick<VectorDoc, 'artboard' | 'scene'>): string {
  const { width: w, height: h, bgColor } = d.artboard
  const defs: string[] = []
  const body: string[] = []
  if (bgColor) body.push(`<rect width="${num(w)}" height="${num(h)}" fill="${esc(bgColor)}"/>`)
  for (const { layer, nodes } of renderOrder(d.scene)) {
    if (layer.hidden) continue
    for (const nd of nodes) {
      if (nd.hidden) continue
      const tr = transformOf(nd)
      if (nd.kind === 'text') {
        const anchor = nd.align === 'center' ? 'middle' : nd.align === 'right' ? 'end' : 'start'
        const x = nd.align === 'center' ? nd.width / 2 : nd.align === 'right' ? nd.width : 0
        const lines = nd.text.split('\n')
        const tspans = lines.map((line, i) => `<tspan x="${num(x)}" y="${num(nd.fontSize * (0.92 + i * 1.2))}">${esc(line)}</tspan>`).join('')
        const style = `${nd.bold ? ' font-weight="bold"' : ''}${nd.italic ? ' font-style="italic"' : ''}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}`
        body.push(`<text transform="${tr}" font-family="${esc(textFont(nd))}" font-size="${num(nd.fontSize)}"${style} fill="${esc(nd.textColor ?? '#000000')}">${tspans}</text>`)
        continue
      }
      const attrs = [`d="${nodeD(nd)}"`, `transform="${tr}"`]
      if (nd.kind === 'vpath' && nd.evenOdd) attrs.push('fill-rule="evenodd"')
      const fill = nd.fillColor ?? 'none'
      if (nd.fill2Color && fill !== 'transparent') {
        const id = `g${defs.length}`
        const g = gradientGeometry(nd, nd.width, nd.height)
        const stops = `<stop offset="0" stop-color="${esc(fill)}"/><stop offset="1" stop-color="${esc(nd.fill2Color)}"/>`
        defs.push(
          nd.gradRadial
            ? `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(g.centre.x)}" cy="${num(g.centre.y)}" r="${num(g.radius)}">${stops}</radialGradient>`
            : `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(g.start.x)}" y1="${num(g.start.y)}" x2="${num(g.end.x)}" y2="${num(g.end.y)}">${stops}</linearGradient>`,
        )
        attrs.push(`fill="url(#${id})"`)
      } else attrs.push(`fill="${fill === 'transparent' ? 'none' : esc(fill)}"`)
      if (nd.strokeWidth && nd.strokeColor) {
        const join = nd.strokeSharp ? 'miter' : 'round'
        attrs.push(`stroke="${esc(nd.strokeColor)}" stroke-width="${num(nd.strokeWidth)}" stroke-linejoin="${join}" stroke-linecap="${nd.strokeSharp ? 'butt' : 'round'}"`)
        if (nd.strokeDash) attrs.push(`stroke-dasharray="${num(nd.strokeWidth * 2)} ${num(nd.strokeWidth * 1.5)}"`)
      }
      if (nd.opacity !== undefined && nd.opacity < 1) attrs.push(`opacity="${num(nd.opacity)}"`)
      if (nd.shadow) {
        const id = `s${defs.length}`
        const sh = shadowOf(nd)
        defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${num(sh.dx)}" dy="${num(sh.dy)}" stdDeviation="${num(sh.blur / 2)}" flood-color="${esc(sh.color)}" flood-opacity="${sh.opacity}"/></filter>`)
        attrs.push(`filter="url(#${id})"`)
      }
      body.push(`<path ${attrs.join(' ')}/>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body.join('')}</svg>`
}
