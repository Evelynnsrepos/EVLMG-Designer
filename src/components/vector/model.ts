import { newId } from '@/core/model'
import { createScene, renderOrder, type NodeBase, type Scene, type TextNode } from '@/shared/canvas'
import { SHAPE_DEFAULTS, shapePath, type ShapeGeometry, type ShapeKind } from './shapes'

/** A live shape: kind + sliders + look. Resizing changes width/height, so outlines stay sharp. */
export interface ShapeNode extends NodeBase, ShapeGeometry {
  kind: 'vshape'
  fillColor?: string
  /** Bottom colour of a top-to-bottom gradient; none = one colour. */
  fill2Color?: string
  strokeColor?: string
  strokeWidth?: number
  opacity?: number
  shadow?: boolean
}

export type VectorNode = ShapeNode | TextNode

export interface VectorDoc {
  /** What the user picked on the start screen; null until then. */
  presetId: string | null
  /** The drawing area at (0, 0). Exports show exactly this box. */
  artboard: { width: number; height: number; bgColor?: string }
  scene: Scene<VectorNode>
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
export const LOOKS: { id: string; label: string; hint: string; apply(n: ShapeNode, art: { width: number; height: number }): Partial<ShapeNode> }[] = [
  { id: 'flat', label: 'Flat', hint: 'One colour, no outline', apply: () => ({ strokeWidth: 0, fill2Color: undefined, shadow: false }) },
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
    apply: (n, art) => ({ fillColor: shade(n.fillColor ?? '#4dabf7', 0.25), fill2Color: shade(n.fillColor ?? '#4dabf7', -0.25), strokeColor: shade(n.fillColor ?? '#4dabf7', -0.5), strokeWidth: Math.max(1, Math.round(Math.min(art.width, art.height) * 0.012)), shadow: false }),
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

// ---------- start screen ----------

export interface Preset {
  id: string
  label: string
  hint: string
  width: number
  height: number
  /** A small example to change, so nobody starts on an empty page. */
  example(layerId: string): VectorNode[]
}

const text = (layerId: string, str: string, x: number, y: number, fontSize: number, textColor: string): TextNode => ({ id: newId(), kind: 'text', layerId, x, y, text: str, fontSize, width: str.length * fontSize * 0.62, textColor, autoWidth: true })
const game = (fill: string, w = 4): Partial<ShapeNode> => ({ fillColor: fill, fill2Color: shade(fill, -0.35), strokeColor: OUTLINE_DARK, strokeWidth: w, shadow: true })

export const PRESETS: Preset[] = [
  {
    id: 'inventory',
    label: 'Inventory icon',
    hint: 'Items for bags, shops and loot',
    width: 128,
    height: 128,
    example: (l) => [
      { ...makeShape(l, 'ellipse', 26, 44, 76, 72, game('#e03170')), name: 'Bottle' },
      { ...makeShape(l, 'rect', 50, 22, 28, 30, game('#a5d8ff')), corner: 10, name: 'Neck' },
      { ...makeShape(l, 'rect', 46, 10, 36, 16, game('#b5835a')), corner: 30, name: 'Cork' },
      { ...makeShape(l, 'ellipse', 44, 60, 16, 22, { fillColor: '#ffffff', opacity: 0.6 }), name: 'Shine' },
    ],
  },
  {
    id: 'skill',
    label: 'Skill icon',
    hint: 'Abilities, spells and talents',
    width: 128,
    height: 128,
    example: (l) => [
      { ...makeShape(l, 'rect', 4, 4, 120, 120, game('#5f3dc4', 4)), corner: 24, shadow: false, name: 'Background' },
      { ...makeShape(l, 'star', 22, 20, 84, 84, game('#ffd43b')), sides: 4, inner: 30, corner: 30, name: 'Spark' },
    ],
  },
  {
    id: 'app',
    label: 'App / game icon',
    hint: 'The icon people click to start your game',
    width: 512,
    height: 512,
    example: (l) => [
      { ...makeShape(l, 'rect', 16, 16, 480, 480, { fillColor: '#2f9e44', fill2Color: '#1b5e2a' }), corner: 44, name: 'Background' },
      { ...makeShape(l, 'shield', 116, 96, 280, 320, game('#e9ecef', 14)), name: 'Shield' },
      { ...makeShape(l, 'star', 186, 170, 140, 140, game('#fab005', 10)), name: 'Star' },
    ],
  },
  {
    id: 'logo',
    label: 'Logo',
    hint: 'Your studio or game name with a mark',
    width: 1024,
    height: 512,
    example: (l) => [
      { ...makeShape(l, 'gear', 60, 106, 300, 300, game('#4dabf7', 14)), name: 'Mark' },
      text(l, 'My Game', 400, 190, 120, '#339af0'),
    ],
  },
  {
    id: 'button',
    label: 'Button',
    hint: 'Menu buttons like Play and Options',
    width: 256,
    height: 80,
    example: (l) => [
      { ...makeShape(l, 'rect', 6, 6, 244, 64, game('#37b24d', 4)), corner: 40, name: 'Button' },
      text(l, 'PLAY', 92, 22, 30, '#ffffff'),
    ],
  },
  {
    id: 'bar',
    label: 'Health bar',
    hint: 'Health, mana or progress',
    width: 400,
    height: 64,
    example: (l) => [
      { ...makeShape(l, 'rect', 44, 14, 348, 36, { fillColor: '#343a40', strokeColor: OUTLINE_DARK, strokeWidth: 4 }), corner: 100, name: 'Bar back' },
      { ...makeShape(l, 'rect', 48, 18, 240, 28, { fillColor: '#ff6b6b', fill2Color: '#c92a2a' }), corner: 100, name: 'Bar fill' },
      { ...makeShape(l, 'heart', 4, 6, 52, 50, game('#fa5252', 4)), name: 'Heart' },
    ],
  },
  {
    id: 'panel',
    label: 'Panel / window',
    hint: 'Menus, dialogue boxes and pop-ups',
    width: 400,
    height: 300,
    example: (l) => [
      { ...makeShape(l, 'rect', 8, 8, 384, 284, { fillColor: '#f1e3c6', fill2Color: '#d9c39a', strokeColor: '#5c3d1e', strokeWidth: 8, shadow: true }), corner: 12, name: 'Panel' },
      { ...makeShape(l, 'rect', 8, 8, 384, 56, { fillColor: '#8b5a2b', strokeColor: '#5c3d1e', strokeWidth: 8 }), corner: 30, name: 'Title bar' },
      text(l, 'Inventory', 32, 20, 28, '#ffffff'),
    ],
  },
  {
    id: 'badge',
    label: 'Badge / medal',
    hint: 'Achievements, ranks and rewards',
    width: 256,
    height: 256,
    example: (l) => [
      { ...makeShape(l, 'star', 8, 8, 240, 240, game('#fab005', 8)), sides: 12, inner: 82, corner: 40, name: 'Edge' },
      { ...makeShape(l, 'ellipse', 58, 58, 140, 140, game('#e8590c', 6)), shadow: false, name: 'Centre' },
      { ...makeShape(l, 'star', 88, 86, 80, 80, { fillColor: '#fff3bf' }), name: 'Star' },
    ],
  },
  { id: 'empty', label: 'Empty', hint: 'Choose the size yourself', width: 512, height: 512, example: () => [] },
]

export function startFrom(p: Preset, d: VectorDoc, withExample = true): VectorDoc {
  const layerId = d.scene.layers[0].id
  return { ...d, presetId: p.id, artboard: { width: p.width, height: p.height }, scene: { ...d.scene, nodes: withExample ? p.example(layerId) : [] } }
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
        const lines = nd.text.split('\n')
        const tspans = lines.map((line, i) => `<tspan x="0" y="${num(nd.fontSize * (0.92 + i * 1.2))}">${esc(line)}</tspan>`).join('')
        body.push(`<text transform="${tr}" font-family="${esc(TEXT_FONT)}" font-size="${num(nd.fontSize)}" fill="${esc(nd.textColor ?? '#000000')}">${tspans}</text>`)
        continue
      }
      const attrs = [`d="${shapePath(nd)}"`, `transform="${tr}"`]
      const fill = nd.fillColor ?? 'none'
      if (nd.fill2Color && fill !== 'transparent') {
        const id = `g${defs.length}`
        defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${esc(fill)}"/><stop offset="1" stop-color="${esc(nd.fill2Color)}"/></linearGradient>`)
        attrs.push(`fill="url(#${id})"`)
      } else attrs.push(`fill="${fill === 'transparent' ? 'none' : esc(fill)}"`)
      if (nd.strokeWidth && nd.strokeColor) attrs.push(`stroke="${esc(nd.strokeColor)}" stroke-width="${num(nd.strokeWidth)}" stroke-linejoin="round" stroke-linecap="round"`)
      if (nd.opacity !== undefined && nd.opacity < 1) attrs.push(`opacity="${num(nd.opacity)}"`)
      if (nd.shadow) {
        const id = `s${defs.length}`
        const o = shadowOffset(nd)
        defs.push(`<filter id="${id}" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="${num(o)}" stdDeviation="${num(o / 2)}" flood-color="#000000" flood-opacity="0.35"/></filter>`)
        attrs.push(`filter="url(#${id})"`)
      }
      body.push(`<path ${attrs.join(' ')}/>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="0 0 ${num(w)} ${num(h)}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body.join('')}</svg>`
}
