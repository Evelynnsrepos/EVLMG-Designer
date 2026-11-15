import { Path, Text } from 'react-konva'
import { BUILTIN_NODE_TYPES, type NodeType } from '@/shared/canvas'
import { gradientGeometry, nodeD, shadowOf, textFont, type PaintNode, type PathNode, type ShapeNode, type VTextNode } from './model'
import { mapPaths } from './paths'

/** Shapes and point paths draw the same way: one Konva Path from the same data as the SVG file. */
function renderPaint(n: PaintNode) {
  const fill = n.fillColor ?? 'transparent'
  const gradient = !!n.fill2Color && fill !== 'transparent'
  const g = gradientGeometry(n, n.width, n.height)
  const sh = shadowOf(n)
  const sw = n.strokeWidth ?? 0
  return (
    <Path
      data={nodeD(n)}
      fillRule={n.kind === 'vpath' && n.evenOdd ? 'evenodd' : 'nonzero'}
      fill={gradient ? undefined : fill}
      fillPriority={gradient ? (n.gradRadial ? 'radial-gradient' : 'linear-gradient') : 'color'}
      fillLinearGradientStartPoint={g.start}
      fillLinearGradientEndPoint={g.end}
      fillLinearGradientColorStops={gradient && !n.gradRadial ? [0, fill, 1, n.fill2Color!] : undefined}
      fillRadialGradientStartPoint={g.centre}
      fillRadialGradientEndPoint={g.centre}
      fillRadialGradientStartRadius={0}
      fillRadialGradientEndRadius={g.radius}
      fillRadialGradientColorStops={gradient && n.gradRadial ? [0, fill, 1, n.fill2Color!] : undefined}
      stroke={sw ? n.strokeColor : undefined}
      strokeWidth={sw}
      dash={n.strokeDash && sw ? [sw * 2, sw * 1.5] : undefined}
      lineJoin={n.strokeSharp ? 'miter' : 'round'}
      lineCap={n.strokeSharp ? 'butt' : 'round'}
      opacity={n.opacity ?? 1}
      shadowEnabled={!!n.shadow}
      shadowColor={sh.color}
      shadowOpacity={sh.opacity}
      shadowOffsetX={sh.dx}
      shadowOffsetY={sh.dy}
      shadowBlur={sh.blur}
      // Outline-only shapes and open lines can still be grabbed in the middle.
      hitFunc={
        fill !== 'transparent'
          ? undefined
          : (ctx, shape) => {
              ctx.beginPath()
              ctx.rect(0, 0, n.width, n.height)
              ctx.closePath()
              ctx.fillStrokeShape(shape)
            }
      }
    />
  )
}

const shapeType: NodeType<ShapeNode> = {
  label: 'Shape',
  render: renderPaint,
  bounds: (n) => ({ x: 0, y: 0, width: n.width, height: n.height }),
  resize: (n, sx, sy) => ({ ...n, width: Math.max(2, n.width * sx), height: Math.max(2, n.height * sy) }),
}

const pathType: NodeType<PathNode> = {
  label: 'Path',
  render: renderPaint,
  bounds: (n) => ({ x: 0, y: 0, width: n.width, height: n.height }),
  // Resizing moves the points, so outlines keep their width.
  resize: (n, sx, sy) => ({ ...n, paths: mapPaths(n.paths, ([x, y]) => [x * sx, y * sy]), width: Math.max(1, n.width * sx), height: Math.max(1, n.height * sy) }),
}

const builtinText = BUILTIN_NODE_TYPES.text as NodeType<VTextNode>

/** The shared text item with the Vector tool's font, bold, italic and alignment. */
const textType: NodeType<VTextNode> = {
  ...builtinText,
  render: (n, ctx) => (
    <Text
      text={n.text}
      width={n.autoWidth ? undefined : n.width}
      fontSize={n.fontSize}
      fontFamily={textFont(n)}
      fontStyle={[n.italic && 'italic', n.bold && 'bold'].filter(Boolean).join(' ') || 'normal'}
      align={n.align ?? 'left'}
      lineHeight={1.25}
      fill={n.textColor ?? ctx.theme.text}
      wrap={n.autoWidth ? 'none' : 'word'}
    />
  ),
  textEdit: builtinText.textEdit && { ...builtinText.textEdit, font: (n) => ({ family: textFont(n), bold: n.bold, italic: n.italic, align: n.align }) },
}

export const VECTOR_NODE_TYPES = { ...BUILTIN_NODE_TYPES, vshape: shapeType, vpath: pathType, text: textType }
