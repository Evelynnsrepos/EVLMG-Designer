import { cloneElement, isValidElement, type ReactElement } from 'react'
import { Group, Image as KonvaImage, Path, Rect, Text } from 'react-konva'
import type { Id } from '@/core/model'
import { cssFamily } from '@/shared/fontList'
import { BUILTIN_NODE_TYPES, measureTextHeight, placeholderPattern, useLoadedImage, type NodeType, type NodeTypes, type RenderContext } from '@/shared/canvas'
import { BUILTIN_ICONS, iconPaths } from './icons'
import { applySlots, fillText, ICON_TOKEN, layoutRichText, type CardImageNode, type CardNode, type CardTextNode, type Field } from './model'

/** What one card shows: its slot colours and field values (null = the template's own `{Field}` text). */
export interface CardBinding {
  colors: Map<Id, string>
  fields: Field[]
  values: Record<Id, string> | null
  /** Exporting: empty picture fields stay empty instead of showing the missing-picture pattern. */
  print?: boolean
  /** Own icons by lower-case name (picture path); built-in icons need no entry. */
  icons?: Map<string, string>
  /** Foil mask export: only foil items, in solid black. */
  mask?: boolean
}

const FOIL_STOPS = [0, '#7d8396', 0.2, '#c9a640', 0.4, '#3fa3b8', 0.6, '#a65fb8', 0.8, '#6fa85a', 1, '#7d8396']
/** Shiny gradient props for a foil fill or outline over a w×h box starting at x,y. */
const foilProps = (part: 'fill' | 'stroke', w: number, h: number, x = 0, y = 0) => ({
  [`${part}LinearGradientStartPoint`]: { x, y },
  [`${part}LinearGradientEndPoint`]: { x: x + w, y: y + h },
  [`${part}LinearGradientColorStops`]: FOIL_STOPS,
  ...(part === 'fill' ? { fillPriority: 'linear-gradient' } : {}),
})

const LINE_HEIGHT = 1.2
let measureCtx: CanvasRenderingContext2D | null = null

/** Text with `:icon:` tokens: words and icons laid out by hand, since canvas text can't hold pictures. */
function RichText({ text, n, b, ctx }: { text: string; n: CardTextNode; b: CardBinding; ctx: RenderContext }) {
  const isIcon = (name: string) => !!BUILTIN_ICONS[name] || !!b.icons?.has(name)
  measureCtx ??= document.createElement('canvas').getContext('2d')
  const layout = (size: number) => {
    measureCtx!.font = `${fontStyle(n) === 'normal' ? '' : fontStyle(n)} ${size}px ${cssFamily(n.fontFamily)}`
    return layoutRichText(text, isIcon, (w) => measureCtx!.measureText(w).width, n.width, size)
  }
  // Shrink until it fits, like plain text.
  let size = n.fontSize
  let lines = layout(size)
  for (let i = 0; i < 12 && size > 6 && lines.length * size * LINE_HEIGHT > n.height; i++) lines = layout((size *= 0.9))
  const color = n.textColor ?? '#1c1d22'
  const foil = n.foil && !b.mask
  const icon = size * 0.95
  return (
    <Group>
      {lines.flatMap((line, li) => {
        const dx = n.align === 'center' ? (n.width - line.width) / 2 : n.align === 'right' ? n.width - line.width : 0
        const y = li * size * LINE_HEIGHT
        return line.items.map((it, i) => {
          const x = dx + it.x
          const key = `${li}-${i}`
          if (it.kind === 'text') return <Text key={key} x={x} y={y} text={it.value} fontSize={size} fontFamily={cssFamily(n.fontFamily)} fontStyle={fontStyle(n)} lineHeight={LINE_HEIGHT} fill={color} {...(foil ? foilProps('fill', n.width, n.height, -x, -y) : {})} />
          const iy = y + (size * LINE_HEIGHT - icon) / 2
          const own = b.icons?.get(it.value)
          if (own) return <Group key={key} x={x} y={iy}><CoverImage src={own} width={icon} height={icon} ctx={ctx} print={b.print} /></Group>
          return (
            <Group key={key} x={x} y={iy} scaleX={icon / 24} scaleY={icon / 24}>
              {iconPaths(it.value).map((d, j) => (
                <Path key={j} data={d} stroke={color} strokeWidth={2} lineCap="round" lineJoin="round" {...(foil ? foilProps('stroke', 24, 24) : {})} />
              ))}
            </Group>
          )
        })
      })}
    </Group>
  )
}

const fontStyle = (n: CardTextNode) => [n.italic && 'italic', n.bold && 'bold'].filter(Boolean).join(' ') || 'normal'

/** Largest size up to the set one at which the text fits its box (long rules text shrinks instead of spilling). */
function fittedSize(text: string, n: CardTextNode): number {
  let size = n.fontSize
  for (let i = 0; i < 12 && size > 6 && measureTextHeight(text, size, n.width, cssFamily(n.fontFamily)) > n.height; i++) size *= 0.9
  return size
}

const box = (n: { width: number; height: number }) => ({ x: 0, y: 0, width: n.width, height: n.height })
const resizeBox = <N extends { width: number; height: number }>(n: N, sx: number, sy: number): N => ({ ...n, width: Math.max(10, n.width * sx), height: Math.max(10, n.height * sy) })

/** A picture that fills its box without stretching (cropped to the box's shape). */
function CoverImage({ src, width, height, ctx, print }: { src: string | undefined; width: number; height: number; ctx: RenderContext; print?: boolean }) {
  const url = src ? ctx.resolveImageSrc(src) : ''
  const loaded = useLoadedImage(url || null)
  const img = loaded.status === 'ok' ? loaded.img : undefined
  if (!img && print) return null
  if (!img) return <Rect width={width} height={height} fillPatternImage={placeholderPattern() as unknown as HTMLImageElement} opacity={loaded.status === 'loading' ? 0.4 : 1} />
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight)
  const cw = width / scale
  const ch = height / scale
  return <KonvaImage image={img} width={width} height={height} crop={{ x: (img.naturalWidth - cw) / 2, y: (img.naturalHeight - ch) / 2, width: cw, height: ch }} />
}

/** Every node kind of the Card Designer, drawing the given card. */
export function cardNodeTypes(b: CardBinding): NodeTypes {
  const textType: NodeType<CardTextNode> = {
    label: 'Text',
    render: (n, ctx) => {
      const text = fillText(n.text, b.fields, b.values)
      const hasIcon = [...text.matchAll(ICON_TOKEN)].some((m) => BUILTIN_ICONS[m[1].toLowerCase()] || b.icons?.has(m[1].toLowerCase()))
      if (hasIcon) return <RichText text={text} n={n} b={b} ctx={ctx} />
      return (
        <Text
          text={text}
          width={n.width}
          height={n.height}
          fontSize={fittedSize(text, n)}
          fontFamily={cssFamily(n.fontFamily)}
          fontStyle={fontStyle(n)}
          align={n.align ?? 'left'}
          lineHeight={1.2}
          wrap="word"
          fill={n.textColor ?? '#1c1d22'}
        />
      )
    },
    bounds: box,
    resize: resizeBox,
    textEdit: {
      get: (n) => n.text,
      set: (n, text) => ({ ...n, text }),
      fontSize: (n) => n.fontSize,
      color: (n) => (applySlots(n, b.colors) as CardTextNode).textColor ?? '#1c1d22',
      font: (n) => ({ family: cssFamily(n.fontFamily), bold: n.bold, italic: n.italic, align: n.align }),
    },
  }
  const imageType: NodeType<CardImageNode> = {
    label: 'Picture field',
    render: (n, ctx) => <CoverImage src={b.values?.[n.fieldId]} width={n.width} height={n.height} ctx={ctx} print={b.print} />,
    bounds: box,
    resize: resizeBox,
  }
  const kinds: NodeTypes = { ...BUILTIN_NODE_TYPES, 'card-text': textType, 'card-image': imageType }
  // Slot colours apply to every kind: wrap each renderer once. Shapes without a fill are clicked on their
  // outline only, so a frame doesn't catch clicks meant for the art inside it.
  return Object.fromEntries(
    Object.entries(kinds).map(([k, t]) => [
      k,
      {
        ...t,
        render: (n: CardNode, ctx: RenderContext) => {
          if (b.mask && !n.foil) return null
          let c = applySlots(n, b.colors)
          const hasFill = !!(c as { fillColor?: string }).fillColor
          if (b.mask) c = { ...c, ...(hasFill ? { fillColor: '#000' } : {}), strokeColor: '#000', textColor: '#000' } as unknown as CardNode
          const { width: w = 400, height: h = 400 } = c as { width?: number; height?: number }
          // Pictures: solid in the mask, a shine laid over them on screen.
          if (k === 'card-image' || k === 'image') {
            if (b.mask) return <Rect width={w} height={h} fill="#000" />
            const el = t.render(c, ctx)
            return n.foil ? <Group>{el}<Rect width={w} height={h} listening={false} opacity={0.55} globalCompositeOperation="overlay" {...foilProps('fill', w, h)} /></Group> : el
          }
          const el = t.render(c, ctx)
          if (!isValidElement(el)) return el
          const props: Record<string, unknown> = k === 'rect' || k === 'ellipse' ? { fillEnabled: hasFill } : {}
          // Single shapes (and plain text) take the shine directly; rich text does it per word.
          if (n.foil && !b.mask) {
            const [x, y] = k === 'ellipse' ? [-w / 2, -h / 2] : [0, 0]
            if (hasFill || k === 'card-text') Object.assign(props, foilProps('fill', w, h, x, y))
            if (k !== 'card-text') Object.assign(props, foilProps('stroke', w, h, x, y))
          }
          return Object.keys(props).length ? cloneElement(el as ReactElement<Record<string, unknown>>, props) : el
        },
      },
    ]),
  )
}
