import { Path } from 'react-konva'
import { BUILTIN_NODE_TYPES, type NodeType } from '@/shared/canvas'
import { shadowOffset, type ShapeNode } from './model'
import { shapePath } from './shapes'

const shapeType: NodeType<ShapeNode> = {
  label: 'Shape',
  render: (n) => {
    const fill = n.fillColor ?? 'transparent'
    const gradient = !!n.fill2Color && fill !== 'transparent'
    const o = shadowOffset(n)
    return (
      <Path
        data={shapePath(n)}
        fill={gradient ? undefined : fill}
        fillPriority={gradient ? 'linear-gradient' : 'color'}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: n.height }}
        fillLinearGradientColorStops={gradient ? [0, fill, 1, n.fill2Color!] : undefined}
        stroke={n.strokeWidth ? n.strokeColor : undefined}
        strokeWidth={n.strokeWidth ?? 0}
        lineJoin="round"
        lineCap="round"
        opacity={n.opacity ?? 1}
        shadowEnabled={!!n.shadow}
        shadowColor="#000000"
        shadowOpacity={0.35}
        shadowOffsetY={o}
        shadowBlur={o}
        // Outline-only shapes can still be grabbed in the middle.
        hitFunc={fill !== 'transparent' ? undefined : (ctx, shape) => {
          ctx.beginPath()
          ctx.rect(0, 0, n.width, n.height)
          ctx.closePath()
          ctx.fillStrokeShape(shape)
        }}
      />
    )
  },
  bounds: (n) => ({ x: 0, y: 0, width: n.width, height: n.height }),
  resize: (n, sx, sy) => ({ ...n, width: Math.max(2, n.width * sx), height: Math.max(2, n.height * sy) }),
}

export const VECTOR_NODE_TYPES = { ...BUILTIN_NODE_TYPES, vshape: shapeType }
