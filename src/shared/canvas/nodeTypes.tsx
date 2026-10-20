import Konva from 'konva'
import { useEffect, useState } from 'react'
import { Arrow, Circle, Ellipse, Group, Image as KonvaImage, Line, Rect, Text } from 'react-konva'
import { expandRect, pointsBounds, rectCenter, rectEdgePoint } from './geometry'
import type {
  CommentPinNode,
  ConnectorNode,
  EllipseNode,
  ImageNode,
  JumpNode,
  LineNode,
  NodeType,
  NodeTypes,
  NoteNode,
  RectNode,
  RenderContext,
  TextNode,
} from './types'

/** Default colors for user content (allowed to be fixed per AGENTS.md UI rules). */
export const NOTE_COLORS = ['#ffe27a', '#ffb38a', '#ff9ec7', '#b9a6ff', '#8fd3ff', '#9ef0b0']
const NOTE_TEXT = '#1c1d22'
export const TEXT_LINE_HEIGHT = 1.25
const NOTE_PADDING = 12

// ---- text measuring ----

const measureCache = new Map<string, number>()
let measurer: Konva.Text | null = null

/** Height of wrapped text in world units (cached). */
export function measureTextHeight(text: string, fontSize: number, width: number, fontFamily: string): number {
  const key = `${fontSize}|${width}|${fontFamily}|${text}`
  const hit = measureCache.get(key)
  if (hit !== undefined) return hit
  measurer ??= new Konva.Text({ lineHeight: TEXT_LINE_HEIGHT, wrap: 'word' })
  measurer.setAttrs({ text: text || ' ', fontSize, width, fontFamily })
  const h = measurer.height()
  if (measureCache.size > 2000) measureCache.clear()
  measureCache.set(key, h)
  return h
}

/** Width of the longest line of unwrapped text in world units. */
export function measureTextWidth(text: string, fontSize: number, fontFamily: string): number {
  measurer ??= new Konva.Text({ lineHeight: TEXT_LINE_HEIGHT, wrap: 'word' })
  measurer.setAttrs({ text: text || ' ', fontSize, width: undefined, wrap: 'none', fontFamily })
  const w = measurer.width()
  measurer.setAttrs({ wrap: 'word' })
  return w
}

/** Wrap width of a text node: auto-width text never wraps (its stored width follows the text). */
const wrapWidth = (n: TextNode) => (n.autoWidth ? 100000 : n.width)

// ---- images ----

type Loaded = { status: 'loading' | 'ok' | 'error'; img?: HTMLImageElement }
const imageCache = new Map<string, Loaded & { waiters: Set<() => void> }>()

/** Load an image once per URL and share it between nodes. */
export function useLoadedImage(url: string | null | undefined): Loaded {
  const [, force] = useState(0)
  useEffect(() => {
    if (!url) return
    let entry = imageCache.get(url)
    if (!entry) {
      const img = new window.Image()
      const created: Loaded & { waiters: Set<() => void> } = { status: 'loading', img, waiters: new Set() }
      entry = created
      imageCache.set(url, created)
      img.onload = () => {
        created.status = 'ok'
        created.waiters.forEach((w) => w())
      }
      img.onerror = () => {
        created.status = 'error'
        created.waiters.forEach((w) => w())
      }
      img.src = url
    }
    const wake = () => force((n) => n + 1)
    entry.waiters.add(wake)
    return () => void entry.waiters.delete(wake)
  }, [url])
  if (!url) return { status: 'error' }
  const entry = imageCache.get(url)
  return entry ? { status: entry.status, img: entry.img } : { status: 'loading' }
}

let checkerboard: HTMLCanvasElement | null = null
/** The pink/black missing-texture pattern (spec 10.6) as a Konva fill pattern. */
export function placeholderPattern(): HTMLCanvasElement {
  if (checkerboard) return checkerboard
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, 16, 16)
  g.fillStyle = '#ff00dc'
  g.fillRect(0, 0, 8, 8)
  g.fillRect(8, 8, 8, 8)
  checkerboard = c
  return c
}

/** Image or checkerboard placeholder, sized to width x height. Usable inside custom node renderers. */
export function CanvasImage({ src, width, height, ctx }: { src: string | null | undefined; width: number; height: number; ctx: RenderContext }) {
  const loaded = useLoadedImage(src ? ctx.resolveImageSrc(src) : null)
  if (loaded.status === 'ok' && loaded.img) return <KonvaImage image={loaded.img} width={width} height={height} />
  return <Rect width={width} height={height} fillPatternImage={placeholderPattern() as unknown as HTMLImageElement} opacity={loaded.status === 'loading' ? 0.4 : 1} />
}

// ---- built-in kinds ----

const boxBounds = (n: { width: number; height: number }) => ({ x: 0, y: 0, width: n.width, height: n.height })
const resizeBox = <N extends { width: number; height: number }>(n: N, sx: number, sy: number): N => ({
  ...n,
  width: Math.max(4, n.width * sx),
  height: Math.max(4, n.height * sy),
})

const rectType: NodeType<RectNode> = {
  label: 'Rectangle',
  render: (n, ctx) => (
    <Rect
      width={n.width}
      height={n.height}
      fill={n.fillColor}
      stroke={n.strokeColor ?? ctx.theme.text}
      strokeWidth={n.strokeWidth ?? 2}
      cornerRadius={n.cornerRadius}
      hitStrokeWidth={12}
      fillEnabled
    />
  ),
  bounds: boxBounds,
  resize: resizeBox,
}

const ellipseType: NodeType<EllipseNode> = {
  label: 'Ellipse',
  render: (n, ctx) => (
    <Ellipse
      x={n.width / 2}
      y={n.height / 2}
      radiusX={n.width / 2}
      radiusY={n.height / 2}
      fill={n.fillColor}
      stroke={n.strokeColor ?? ctx.theme.text}
      strokeWidth={n.strokeWidth ?? 2}
      hitStrokeWidth={12}
    />
  ),
  bounds: boxBounds,
  resize: resizeBox,
}

const lineType: NodeType<LineNode> = {
  label: 'Line',
  render: (n, ctx) => {
    const common = {
      points: n.points,
      stroke: n.strokeColor ?? ctx.theme.text,
      strokeWidth: n.strokeWidth ?? 2,
      lineCap: 'round' as const,
      lineJoin: 'round' as const,
      hitStrokeWidth: Math.max(14, (n.strokeWidth ?? 2) + 10),
    }
    return n.arrow ? (
      <Arrow {...common} fill={common.stroke} pointerLength={10 + common.strokeWidth} pointerWidth={10 + common.strokeWidth} />
    ) : (
      <Line {...common} tension={n.smooth ? 0.4 : 0} opacity={n.opacity ?? 1} />
    )
  },
  bounds: (n) => expandRect(pointsBounds(n.points), (n.strokeWidth ?? 2) / 2 + (n.arrow ? 8 : 0)),
}

const textType: NodeType<TextNode> = {
  label: 'Text',
  render: (n, ctx) => (
    <Text
      text={n.text}
      width={n.autoWidth ? undefined : n.width}
      fontSize={n.fontSize}
      fontFamily={ctx.theme.font}
      lineHeight={TEXT_LINE_HEIGHT}
      fill={n.textColor ?? ctx.theme.text}
      wrap={n.autoWidth ? 'none' : 'word'}
    />
  ),
  bounds: (n, ctx) => ({ x: 0, y: 0, width: n.width, height: measureTextHeight(n.text, n.fontSize, wrapWidth(n), ctx.theme.font) }),
  // Only the width changes on resize; the font stays the same size. A resized box wraps at its new width.
  resize: (n, sx) => ({ ...n, width: Math.max(20, n.width * sx), autoWidth: undefined }),
  textEdit: {
    get: (n) => n.text,
    // Auto-width text gets a box as wide as its longest line, so grabbing and the outline match the words.
    set: (n, text, theme) => ({ ...n, text, ...(n.autoWidth && theme ? { width: Math.ceil(measureTextWidth(text, n.fontSize, theme.font)) + 2 } : {}) }),
    autoWidth: (n) => !!n.autoWidth,
    fontSize: (n) => n.fontSize,
    color: (n, theme) => n.textColor ?? theme.text,
    deleteIfEmpty: true,
  },
}

const noteType: NodeType<NoteNode> = {
  label: 'Sticky note',
  render: (n, ctx) => (
    <Group>
      <Rect
        width={n.width}
        height={n.height}
        fill={n.fillColor ?? NOTE_COLORS[0]}
        cornerRadius={4}
        shadowColor="#000"
        shadowOpacity={0.25}
        shadowBlur={8}
        shadowOffsetY={2}
      />
      <Text
        x={NOTE_PADDING}
        y={NOTE_PADDING}
        width={n.width - NOTE_PADDING * 2}
        height={n.height - NOTE_PADDING * 2}
        text={n.text}
        fontSize={16}
        fontFamily={ctx.theme.font}
        lineHeight={TEXT_LINE_HEIGHT}
        fill={NOTE_TEXT}
        wrap="word"
        ellipsis
      />
    </Group>
  ),
  bounds: boxBounds,
  resize: resizeBox,
  textEdit: {
    get: (n) => n.text,
    set: (n, text) => ({ ...n, text }),
    fontSize: () => 16,
    padding: NOTE_PADDING,
    color: () => NOTE_TEXT,
  },
}

const imageType: NodeType<ImageNode> = {
  label: 'Image',
  render: (n, ctx) => <CanvasImage src={n.src} width={n.width} height={n.height} ctx={ctx} />,
  bounds: boxBounds,
  keepRatio: true,
  resize: resizeBox,
}

/** Start and end points of a connector, clipped to the edges of the nodes it joins. */
export function connectorPoints(n: ConnectorNode, ctx: RenderContext): number[] | null {
  const a = ctx.getWorldBounds(n.fromId)
  const b = ctx.getWorldBounds(n.toId)
  if (!a || !b) return null
  const start = rectEdgePoint(expandRect(a, 4), rectCenter(b))
  const end = rectEdgePoint(expandRect(b, 4), rectCenter(a))
  return [start.x, start.y, end.x, end.y]
}

const connectorType: NodeType<ConnectorNode> = {
  label: 'Connection',
  absolute: true,
  memo: false,
  render: (n, ctx) => {
    const points = connectorPoints(n, ctx)
    if (!points) return null
    const stroke = n.strokeColor ?? ctx.theme.textMuted
    const strokeWidth = n.strokeWidth ?? 2
    const mid = { x: (points[0] + points[2]) / 2, y: (points[1] + points[3]) / 2 }
    return (
      <>
        <Arrow
          points={points}
          stroke={stroke}
          fill={stroke}
          strokeWidth={strokeWidth}
          pointerLength={n.arrow === false ? 0 : 10}
          pointerWidth={n.arrow === false ? 0 : 10}
          dash={n.dashed ? [8, 6] : undefined}
          hitStrokeWidth={14}
          lineCap="round"
        />
        {n.label ? <Text x={mid.x + 6} y={mid.y - 18} text={n.label} fontSize={13} fontFamily={ctx.theme.font} fill={ctx.theme.textMuted} /> : null}
      </>
    )
  },
  bounds: (n, ctx) => {
    const p = connectorPoints(n, ctx)
    return p ? expandRect(pointsBounds(p), 6) : { x: 0, y: 0, width: 0, height: 0 }
  },
}

const PIN_R = 13
const commentPinType: NodeType<CommentPinNode> = {
  label: 'Comment',
  render: () => (
    <Group>
      <Line points={[-6, 8, 0, PIN_R + 8, 6, 8]} closed fill="#f08c00" />
      <Circle radius={PIN_R} fill="#f08c00" stroke="#fff" strokeWidth={2} />
      <Text text="…" x={-PIN_R} y={-PIN_R - 3} width={PIN_R * 2} height={PIN_R * 2} align="center" verticalAlign="middle" fontSize={18} fontStyle="bold" fill="#fff" />
    </Group>
  ),
  bounds: () => ({ x: -PIN_R, y: -PIN_R, width: PIN_R * 2, height: PIN_R * 2 + 8 }),
  transformable: false,
}

const JUMP_H = 34
const jumpWidth = (n: JumpNode) => Math.min(320, 46 + n.label.length * 7.5)
/** v0.17: a jump point: a rounded chip with an arrow and where it goes. */
const jumpType: NodeType<JumpNode> = {
  label: 'Jump point',
  render: (n, ctx) => (
    <Group>
      <Rect width={jumpWidth(n)} height={JUMP_H} cornerRadius={JUMP_H / 2} fill="#5b3fd1" shadowColor="#000" shadowOpacity={0.25} shadowBlur={6} shadowOffsetY={2} />
      <Text x={14} y={9} width={jumpWidth(n) - 24} height={JUMP_H - 12} text={`➜ ${n.label}`} fontSize={14} fontFamily={ctx.theme.font} fill="#ffffff" wrap="none" ellipsis />
    </Group>
  ),
  bounds: (n) => ({ x: 0, y: 0, width: jumpWidth(n), height: JUMP_H }),
  transformable: false,
}

export const BUILTIN_NODE_TYPES: NodeTypes = {
  jump: jumpType,
  'comment-pin': commentPinType,
  rect: rectType,
  ellipse: ellipseType,
  line: lineType,
  text: textType,
  note: noteType,
  image: imageType,
  connector: connectorType,
}

/** Used for kinds without a registered type, so unknown data still shows up. */
export const UNKNOWN_NODE_TYPE: NodeType = {
  label: 'Unknown',
  render: () => <Rect width={40} height={40} fillPatternImage={placeholderPattern() as unknown as HTMLImageElement} />,
  bounds: () => ({ x: 0, y: 0, width: 40, height: 40 }),
  transformable: false,
}
