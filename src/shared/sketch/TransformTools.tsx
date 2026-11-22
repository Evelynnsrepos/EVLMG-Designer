import { Check, FlipHorizontal2, FlipVertical2, Magnet, Maximize, RotateCw, Undo2, X } from 'lucide-react'
import type { Interpolation } from './meshRender'
import { mapPoint } from './transform'
import type { Transformer, XfMode } from './transformer'
import './layers.css'

const UI = {
  modes: { free: 'Freeform', uniform: 'Uniform', distort: 'Distort', warp: 'Warp', turn: '3D turn', mold: 'Mold' } as Record<XfMode, string>,
  modeHints: {
    free: 'Stretch freely; Shift keeps the shape',
    uniform: 'Scale keeping the shape',
    distort: 'Move each corner on its own',
    warp: 'Bend the picture with a mesh',
    turn: 'Turn it like a flat card in 3D: drag outside it to orbit, inside to move, or use the sliders',
    mold: 'Drag the points of the triangle mesh; nearby points follow',
  } as Record<XfMode, string>,
  turnX: 'Tilt',
  turnXHelp: 'Tilt forward or back (around the across axis, X)',
  turnY: 'Turn',
  turnYHelp: 'Turn left or right (around the up axis, Y)',
  turnZ: 'Spin',
  turnZHelp: 'Spin flat (around the view axis, Z)',
  depth: 'Perspective',
  depthHelp: 'How much nearer parts grow: none is flat, full is a close camera',
  turnNote: 'Turned past 90° you see the back, mirrored. It stays a flat card: no thickness, no hidden sides.',
  grid: 'Points',
  gridHelp: 'How many cells the mesh has per side (changing it starts the mesh over the current shape)',
  reach: 'Reach',
  reachHelp: 'How far away other points still follow the one you drag',
  pull: 'Follow',
  pullHelp: 'How strongly the other points follow: 0 only the dragged point moves',
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
      {xf.mode === 'turn' && (
        <span className="sketch-xf-extra" title={UI.turnNote}>
          <Slider label={UI.turnX} help={UI.turnXHelp} min={-180} max={180} value={xf.turn.x} unit="°" xf={xf} onChange={(x) => xf.setTurn({ x })} />
          <Slider label={UI.turnY} help={UI.turnYHelp} min={-180} max={180} value={xf.turn.y} unit="°" xf={xf} onChange={(y) => xf.setTurn({ y })} />
          <Slider label={UI.turnZ} help={UI.turnZHelp} min={-180} max={180} value={xf.turn.z} unit="°" xf={xf} onChange={(z) => xf.setTurn({ z })} />
          <Slider label={UI.depth} help={UI.depthHelp} min={0} max={100} value={Math.round(xf.turn.depth * 100)} unit="%" xf={xf} onChange={(d) => xf.setTurn({ depth: d / 100 })} />
        </span>
      )}
      {xf.mode === 'mold' && (
        <span className="sketch-xf-extra">
          <Slider label={UI.grid} help={UI.gridHelp} min={2} max={20} value={xf.moldGrid} xf={xf} onChange={(n) => xf.setMoldGrid(n)} noMark />
          <Slider label={UI.reach} help={UI.reachHelp} min={0} max={1000} value={xf.moldReach} unit="px" xf={xf} onChange={(moldReach) => xf.patch({ moldReach })} noMark />
          <Slider label={UI.pull} help={UI.pullHelp} min={0} max={100} value={Math.round(xf.moldPull * 100)} unit="%" xf={xf} onChange={(p) => xf.patch({ moldPull: p / 100 })} noMark />
        </span>
      )}
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

/** A labelled slider of the transform bar; starting to drag it makes one undo step (unless `noMark`). */
function Slider(p: { label: string; help: string; min: number; max: number; value: number; unit?: string; xf: Transformer; noMark?: boolean; onChange(v: number): void }) {
  return (
    <label className="sketch-selbar-slider" title={p.help}>
      {p.label}
      <input
        type="range"
        min={p.min}
        max={p.max}
        value={p.value}
        aria-label={p.label}
        onPointerDown={() => !p.noMark && p.xf.mark()}
        onKeyDown={() => !p.noMark && p.xf.mark()}
        onChange={(e) => p.onChange(Number(e.target.value))}
      />
      <span className="sketch-xf-num">
        {Math.round(p.value)}
        {p.unit}
      </span>
    </label>
  )
}

/** Box, mesh, handles and snap guides, drawn in the editor's canvas-space SVG group. */
export function TransformOverlay({ xf, scale, width, height }: { xf: Transformer; scale: number; width: number; height: number }) {
  const s = xf.state
  if (!xf.active || !s) return null
  const line = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ')
  const curves: string[] = []
  const steps = s.warp || s.mold ? 24 : 1
  const lines = xf.mode === 'warp' ? [0, 1 / 3, 2 / 3, 1] : [0, 1]
  const m = xf.mode === 'mold' ? s.mold : null
  if (m) {
    // The triangles themselves: rows, columns and each cell's diagonal.
    const n = m.n
    const at = (i: number, j: number) => m.pts[j * (n + 1) + i]
    for (let k = 0; k <= n; k++) {
      curves.push(line(Array.from({ length: n + 1 }, (_, i) => at(i, k))))
      curves.push(line(Array.from({ length: n + 1 }, (_, j) => at(k, j))))
    }
    for (let d = 1; d < 2 * n; d++) curves.push(line(Array.from({ length: n + 1 }, (_, i) => [i, d - i]).filter(([i, j]) => j >= 0 && j <= n && i <= n).map(([i, j]) => at(i, j))))
  } else
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
      {xf.handles().map((p, i) =>
        xf.mode === 'mold' ? (
          <circle key={i} cx={p.x} cy={p.y} r={r * 0.6} className="sketch-xf-handle" />
        ) : (
          <rect key={i} x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={xf.mode === 'warp' ? r : 1 / scale} className="sketch-xf-handle" />
        ),
      )}
    </g>
  )
}
