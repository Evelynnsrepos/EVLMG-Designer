import { useId } from 'react'
import type { BrushSettings } from './brushes'
import { guideHandles, guideLines, moveHandle, type DrawingGuide, type Pt } from './guides'
import { moveNode, outline as shapeOutline, shapeNodes, type Shape } from './quickshape'

/**
 * Pieces of the SVG overlay over the canvas (Sketch Pro). All of them are
 * drawn inside the view transform, in canvas pixels, so they turn and mirror
 * with the view.
 */

type ToDoc = (e: { clientX: number; clientY: number }) => Pt

/** Drag a point with the pointer; `onMove` gets canvas coordinates. */
function dragPoint(toDoc: ToDoc, onMove: (p: Pt) => void, onEnd?: () => void) {
  return (e: React.PointerEvent<SVGElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => onMove(toDoc(ev))
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      onEnd?.()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
}

/** The drawing guide's lines, and its handles while it is being edited. */
export function GuideOverlay({ guide, width, height, scale, editing, toDoc, onChange }: { guide: DrawingGuide; width: number; height: number; scale: number; editing: boolean; toDoc: ToDoc; onChange(g: DrawingGuide): void }) {
  const clip = useId()
  const lines = guideLines(guide, width, height)
  return (
    <g className="guide-overlay" style={{ color: guide.color }}>
      <clipPath id={clip}>
        <rect x={0} y={0} width={width} height={height} />
      </clipPath>
      <g clipPath={guide.kind === 'perspective' || guide.kind === 'symmetry' ? undefined : `url(#${clip})`} opacity={guide.opacity}>
        {lines.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className={l.strong ? 'guide-line is-strong' : 'guide-line'} />
        ))}
      </g>
      {editing &&
        guideHandles(guide).map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={9 / scale} className="guide-handle" onPointerDown={dragPoint(toDoc, (q) => onChange(moveHandle(guide, i, q)))} />
        ))}
    </g>
  )
}

/** Brush outline under a hovering pen or the mouse: size, roundness and angle of the tip. */
export function BrushCursor({ at, brush, scale, erase, onLight }: { at: Pt; brush: Pick<BrushSettings, 'size' | 'roundness' | 'rotation' | 'shape'>; scale: number; erase: boolean; onLight?: boolean }) {
  const r = Math.max(1.5 / scale, brush.size / 2)
  const ry = Math.max(1.5 / scale, r * brush.roundness)
  const angle = typeof brush.rotation === 'number' ? brush.rotation : 0
  const cross = 4 / scale
  return (
    <g transform={`translate(${at.x} ${at.y}) rotate(${angle})`} className={`brush-cursor${erase ? ' is-eraser' : ''}${onLight ? ' is-on-light' : ''}`}>
      {brush.shape === 'square' ? <rect x={-r} y={-ry} width={r * 2} height={ry * 2} /> : <ellipse rx={r} ry={ry} />}
      {brush.size * scale < 8 && (
        <>
          <line x1={-cross * 2} x2={-cross} y1={0} y2={0} />
          <line x1={cross} x2={cross * 2} y1={0} y2={0} />
          <line y1={-cross * 2} y2={-cross} x1={0} x2={0} />
          <line y1={cross} y2={cross * 2} x1={0} x2={0} />
        </>
      )}
    </g>
  )
}

/** Edit Shape: the snapped shape's nodes, draggable. */
export function ShapeNodes({ shape, scale, toDoc, onChange }: { shape: Shape; scale: number; toDoc: ToDoc; onChange(s: Shape): void }) {
  const pts = shapeOutline(shape, 4 / scale)
  return (
    <g className="shape-nodes">
      <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} className="shape-outline" />
      {shapeNodes(shape).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={8 / scale} className="guide-handle" onPointerDown={dragPoint(toDoc, (q) => onChange(moveNode(shape, i, q)))} />
      ))}
    </g>
  )
}
