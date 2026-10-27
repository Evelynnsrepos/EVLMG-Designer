import { cloneElement, isValidElement, type ReactElement } from 'react'
import { Image as KonvaImage, Rect, Text } from 'react-konva'
import type { Id } from '@/core/model'
import { cssFamily } from '@/shared/fontList'
import { BUILTIN_NODE_TYPES, measureTextHeight, placeholderPattern, useLoadedImage, type NodeType, type NodeTypes, type RenderContext } from '@/shared/canvas'
import { applySlots, fillText, type CardImageNode, type CardNode, type CardTextNode, type Field } from './model'

/** What one card shows: its slot colours and field values (null = the template's own `{Field}` text). */
export interface CardBinding {
  colors: Map<Id, string>
  fields: Field[]
  values: Record<Id, string> | null
  /** Exporting: empty picture fields stay empty instead of showing the missing-picture pattern. */
  print?: boolean
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
    render: (n) => {
      const text = fillText(n.text, b.fields, b.values)
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
      color: (n) => n.textColor ?? '#1c1d22',
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
          const c = applySlots(n, b.colors)
          const el = t.render(c, ctx)
          return (k === 'rect' || k === 'ellipse') && isValidElement(el) ? cloneElement(el as ReactElement<{ fillEnabled?: boolean }>, { fillEnabled: !!(c as { fillColor?: string }).fillColor }) : el
        },
      },
    ]),
  )
}
