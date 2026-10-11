import { Check, FlipHorizontal2, FlipVertical2, Magnet, Maximize, RotateCw, Undo2, X } from 'lucide-react'
import type { Interpolation } from './meshRender'
import { mapPoint } from './transform'
import type { Transformer, XfMode } from './transformer'
import './layers.css'

const UI = {
  modes: { free: 'Freeform', uniform: 'Uniform', distort: 'Distort', warp: 'Warp' } as Record<XfMode, string>,
  modeHints: {
    free: 'Stretch freely; Shift keeps the shape',
    uniform: 'Scale keeping the shape',
    distort: 'Move each corner on its own',
    warp: 'Bend the picture with a mesh',
  } as Record<XfMode, string>,
  flipX: 'Flip horizontally',
  flipY: 'Flip vertically',
  rotate: 'Rotate 45°',
  fit: 'Fit to the canvas',
  reset: 'Reset',
  snapping: 'Snapping: edges and centre stick to the canvas',
  distance: 'Distance',
  magnetics: 'Magnetics: moves keep to 45°, turns to 15° (or hold Shift)',
  interp: { nearest: 'Nearest (crisp pixels)', bilinear: 'Bilinear (smooth)', bicubic: 'Bicubic (sharp and smooth)' } as Record<Interpolation, string>,
  done: 'Done (Enter)',
  doneShort: 'Done',
  cancel: 'Cancel (Esc)',
  hint: 'Drag inside to move, handles to scale, the round handle to turn.',
}

/** The bar shown while transforming. */
export function TransformBar({ xf, onDone, onCancel }: { xf: Transformer; onDone(): void; onCancel(): void }) {
  if (!xf.active) return null
  return (
    <div className="sketch-selbar sketch-xfbar" title={UI.hint} onPointerDown={(e) => e.stopPropagation()}>
      {(Object.keys(UI.modes) as XfMode[]).map((m) => (
        <button key={m} className={`btn btn-ghost sketch-small${xf.mode === m ? ' is-active' : ''}`} title={UI.modeHints[m]} onClick={() => xf.patch({ mode: m })}>
          {UI.modes[m]}
        </button>
      ))}
      <span className="sketch-sep" />
      <button className="icon-btn sketch-tool" title={UI.flipX} aria-label={UI.flipX} onClick={() => xf.flip('x')}>
        <FlipVertical2 size={15} />
      </button>
      <button className="icon-btn sketch-tool" title={UI.flipY} aria-label={UI.flipY} onClick={() => xf.flip('y')}>
        <FlipHorizontal2 size={15} />
      </button>
      <button className="icon-btn sketch-tool" title={UI.rotate} aria-label={UI.rotate} onClick={() => xf.rotate45()}>
        <RotateCw size={15} />
      </button>
      <button className="icon-btn sketch-tool" title={UI.fit} aria-label={UI.fit} onClick={() => xf.fit()}>
        <Maximize size={15} />
      </button>
      <button className="icon-btn sketch-tool" title={UI.reset} aria-label={UI.reset} onClick={() => xf.resetShape()}>
        <Undo2 size={15} />
      </button>
      <span className="sketch-sep" />
      <label className="sketch-selbar-slider" title={UI.snapping}>
        <input type="checkbox" checked={xf.snapping} onChange={(e) => xf.patch({ snapping: e.target.checked })} />
        {UI.distance}
        <input type="range" min={2} max={40} value={xf.snapDistance} disabled={!xf.snapping} onChange={(e) => xf.patch({ snapDistance: Number(e.target.value) })} />
      </label>
      <button className={`icon-btn sketch-tool${xf.magnetics ? ' is-active' : ''}`} title={UI.magnetics} aria-label={UI.magnetics} aria-pressed={xf.magnetics} onClick={() => xf.patch({ magnetics: !xf.magnetics })}>
        <Magnet size={15} />
      </button>
      <select className="input sketch-xf-interp" value={xf.interp} onChange={(e) => xf.patch({ interp: e.target.value as Interpolation })}>
        {(Object.keys(UI.interp) as Interpolation[]).map((k) => (
          <option key={k} value={k}>
            {UI.interp[k]}
          </option>
        ))}
      </select>
      <button className="btn btn-ghost sketch-small" title={UI.cancel} onClick={onCancel}>
        <X size={13} />
      </button>
      <button className="btn btn-primary sketch-small" title={UI.done} onClick={onDone}>
        <Check size={13} /> {UI.doneShort}
      </button>
    </div>
  )
}

/** Box, mesh, handles and snap guides, drawn in the editor's canvas-space SVG group. */
export function TransformOverlay({ xf, scale, width, height }: { xf: Transformer; scale: number; width: number; height: number }) {
  const s = xf.state
  if (!xf.active || !s) return null
  const line = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ')
  const curves: string[] = []
  const steps = s.warp ? 24 : 1
  const lines = xf.mode === 'warp' ? [0, 1 / 3, 2 / 3, 1] : [0, 1]
  for (const t of lines) {
    curves.push(line(Array.from({ length: steps + 1 }, (_, i) => mapPoint(s, i / steps, t))))
    curves.push(line(Array.from({ length: steps + 1 }, (_, i) => mapPoint(s, t, i / steps))))
  }
  const r = 5 / scale
  const rot = xf.rotateHandle(scale)
  const top = mapPoint(s, 0.5, 0)
  return (
    <g className="sketch-xf">
      {xf.guides.gx.map((x) => <line key={`x${x}`} x1={x} y1={0} x2={x} y2={height} className="sketch-xf-guide" />)}
      {xf.guides.gy.map((y) => <line key={`y${y}`} x1={0} y1={y} x2={width} y2={y} className="sketch-xf-guide" />)}
      {curves.map((c, i) => <polyline key={i} points={c} className="sketch-xf-line" />)}
      {rot && <line x1={top.x} y1={top.y} x2={rot.x} y2={rot.y} className="sketch-xf-line" />}
      {rot && <circle cx={rot.x} cy={rot.y} r={r * 1.2} className="sketch-xf-rot" />}
      {xf.handles().map((p, i) => (
        <rect key={i} x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={xf.mode === 'warp' ? r : 1 / scale} className="sketch-xf-handle" />
      ))}
    </g>
  )
}
