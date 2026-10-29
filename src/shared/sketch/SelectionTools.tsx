import { Circle, ClipboardPaste, Contrast, Eye, Feather, Lasso, PaintBucket, Save, SquareDashed, Trash2, WandSparkles, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { resolveAssetPath } from '@/core/assets'
import { getFs } from '@/core/fs'
import type { Id } from '@/core/model'
import type { SketchEngine } from './engine'
import type { SketchDoc } from './model'
import type { SelShape, Selector } from './selector'
import './layers.css'
import { viewMatrix, type View } from './view'

const UI = {
  freehand: 'Freehand: drag to draw, click to place corners',
  rect: 'Rectangle (Shift: square)',
  ellipse: 'Ellipse (Shift: circle)',
  wand: 'Automatic: click an area, drag sideways to take more or less',
  add: 'Add',
  addHint: 'Add to the selection (or hold Shift)',
  subtract: 'Remove',
  subtractHint: 'Remove from the selection (or hold Alt)',
  invert: 'Invert',
  feather: 'Feather',
  featherApply: 'Soften the edge',
  copyPaste: 'Copy & paste into a new layer',
  fill: 'Fill with the colour',
  clear: 'Clear',
  showMask: 'Show the selection as a mask',
  save: 'Save selection',
  load: 'Saved selections',
  deselect: 'Deselect (Ctrl+D)',
  deselectShort: 'Deselect',
  threshold: 'Threshold',
  corners: 'Rounded corners',
  remove: 'Remove',
  usesReference: 'Uses the reference layer',
}

/** The selection outline and drafts, drawn inside the editor's canvas-space SVG group. */
export function SelectionOutline({ sel }: { sel: Selector }) {
  const d = sel.draft
  return (
    <>
      {sel.edges && (
        <g transform={`translate(${sel.offset.x} ${sel.offset.y})`}>
          <path d={sel.edges} className="sketch-sel-edge-under" />
          <path d={sel.edges} className="sketch-sel-edge" />
        </g>
      )}
      {d?.kind === 'freehand' && (
        <>
          <polyline points={d.pts.map((q) => `${q.x},${q.y}`).join(' ')} className="sketch-selection" />
          {sel.polygon?.[0] && <circle cx={sel.polygon[0].x} cy={sel.polygon[0].y} r={5} className="sketch-poly-start" />}
        </>
      )}
      {d?.kind === 'rect' && (
        <rect x={Math.min(d.pts[0].x, d.pts[1].x)} y={Math.min(d.pts[0].y, d.pts[1].y)} width={Math.abs(d.pts[1].x - d.pts[0].x)} height={Math.abs(d.pts[1].y - d.pts[0].y)} rx={sel.cornerRadius} className="sketch-selection" />
      )}
      {d?.kind === 'ellipse' && (
        <ellipse cx={(d.pts[0].x + d.pts[1].x) / 2} cy={(d.pts[0].y + d.pts[1].y) / 2} rx={Math.abs(d.pts[1].x - d.pts[0].x) / 2} ry={Math.abs(d.pts[1].y - d.pts[0].y) / 2} className="sketch-selection" />
      )}
      {d?.kind === 'wand' && d.edges && (
        <>
          <path d={d.edges} className="sketch-sel-edge-under" />
          <path d={d.edges} className="sketch-sel-edge" />
        </>
      )}
    </>
  )
}

/** Dims everything outside the selection ("mask visibility"); a screen-space layer over the canvas. */
export function SelectionMaskView({ sel, engine, view }: { sel: Selector; engine: SketchEngine; view: View }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const mask = engine.selectionMask
  const on = sel.showMask && !!mask
  useEffect(() => {
    const c = ref.current
    if (!c || !on || !mask) return
    const s = Math.min(1, 1024 / Math.max(mask.width, mask.height))
    c.width = Math.max(1, Math.round(mask.width * s))
    c.height = Math.max(1, Math.round(mask.height * s))
    const ctx = c.getContext('2d')!
    ctx.fillStyle = 'rgba(20, 24, 40, 0.55)'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.drawImage(mask, 0, 0, c.width, c.height)
  }, [on, mask, sel.version])
  if (!on || !mask) return null
  return (
    <canvas
      ref={ref}
      className="sketch-sel-mask"
      style={{ left: 0, top: 0, width: mask.width, height: mask.height, transformOrigin: '0 0', transform: `matrix(${viewMatrix(view).join(',')}) translate(${sel.offset.x}px, ${sel.offset.y}px)` }}
    />
  )
}

export interface SelectionBarProps {
  sel: Selector
  /** A selection tool is in use (the bar shows its shapes and modes). */
  tool: boolean
  doc: SketchDoc
  root: string | null
  update(fn: (d: SketchDoc) => SketchDoc): void
  usesReference: boolean
  onFill(): void
  onClear(): void
  onCopyPaste(): void
}

/** The bar under the top bar while selecting, or while something is selected. */
export function SelectionBar(p: SelectionBarProps) {
  const { sel } = p
  const [loadOpen, setLoadOpen] = useState(false)
  if (!p.tool && !sel.active) return null
  const shapes: [SelShape, LucideIcon, string][] = [
    ['wand', WandSparkles, UI.wand],
    ['freehand', Lasso, UI.freehand],
    ['rect', SquareDashed, UI.rect],
    ['ellipse', Circle, UI.ellipse],
  ]
  const saved = p.doc.selections ?? []
  return (
    <div className="sketch-selbar" onPointerDown={(e) => e.stopPropagation()}>
      {p.tool && (
        <>
          {shapes.map(([id, Icon, label]) => (
            <button key={id} className={`icon-btn sketch-tool${sel.shape === id ? ' is-active' : ''}`} title={label} aria-label={label} aria-pressed={sel.shape === id} onClick={() => sel.patch({ shape: id })}>
              <Icon size={15} />
            </button>
          ))}
          <span className="sketch-sep" />
          <button className={`btn btn-ghost sketch-small${sel.mode === 'add' ? ' is-active' : ''}`} title={UI.addHint} onClick={() => sel.patch({ mode: sel.mode === 'add' ? 'replace' : 'add' })}>
            + {UI.add}
          </button>
          <button className={`btn btn-ghost sketch-small${sel.mode === 'subtract' ? ' is-active' : ''}`} title={UI.subtractHint} onClick={() => sel.patch({ mode: sel.mode === 'subtract' ? 'replace' : 'subtract' })}>
            − {UI.subtract}
          </button>
          {sel.shape === 'rect' && (
            <label className="sketch-selbar-slider">
              {UI.corners}
              <input type="range" min={0} max={500} value={sel.cornerRadius} onChange={(e) => sel.patch({ cornerRadius: Number(e.target.value) })} />
              <span>{sel.cornerRadius}px</span>
            </label>
          )}
          {sel.shape === 'wand' && (
            <label className="sketch-selbar-slider" title={p.usesReference ? UI.usesReference : undefined}>
              {UI.threshold}
              <input type="range" min={0} max={1} step={0.01} value={sel.threshold} onChange={(e) => sel.patch({ threshold: Number(e.target.value) })} />
              <span>{Math.round(sel.threshold * 100)}%</span>
              {p.usesReference && <span className="sketch-badge">R</span>}
            </label>
          )}
          <span className="sketch-sep" />
        </>
      )}
      <button className="btn btn-ghost sketch-small" title={UI.invert} onClick={() => sel.invert()}>
        <Contrast size={13} /> {UI.invert}
      </button>
      <label className="sketch-selbar-slider" title={UI.featherApply}>
        <button className="btn btn-ghost sketch-small" disabled={!sel.active} onClick={() => sel.feather()}>
          <Feather size={13} /> {UI.feather}
        </button>
        <input type="range" min={1} max={100} value={sel.featherRadius} onChange={(e) => sel.patch({ featherRadius: Number(e.target.value) })} />
        <span>{sel.featherRadius}px</span>
      </label>
      <button className="btn btn-ghost sketch-small" title={UI.copyPaste} disabled={!sel.active} onClick={p.onCopyPaste}>
        <ClipboardPaste size={13} />
      </button>
      <button className="btn btn-ghost sketch-small" title={UI.fill} disabled={!sel.active} onClick={p.onFill}>
        <PaintBucket size={13} />
      </button>
      <button className="btn btn-ghost sketch-small" title={UI.clear} disabled={!sel.active} onClick={p.onClear}>
        <Trash2 size={13} />
      </button>
      <button className={`btn btn-ghost sketch-small${sel.showMask ? ' is-active' : ''}`} title={UI.showMask} onClick={() => sel.patch({ showMask: !sel.showMask })}>
        <Eye size={13} />
      </button>
      <span className="sketch-selbar-saved">
        <button className="btn btn-ghost sketch-small" title={UI.save} disabled={!sel.active || !p.root} onClick={() => p.root && void sel.save(p.root, p.doc, p.update)}>
          <Save size={13} />
        </button>
        {saved.length > 0 && (
          <button className="btn btn-ghost sketch-small" title={UI.load} onClick={() => setLoadOpen(!loadOpen)}>
            {UI.load} ({saved.length})
          </button>
        )}
        {loadOpen && (
          <>
            <div className="menu-backdrop" onClick={() => setLoadOpen(false)} />
            <div className="menu" style={{ top: '100%', left: 0 }}>
              {saved.map((s) => (
                <div key={s.id} className="sketch-saved-row">
                  <button onClick={() => {
                    setLoadOpen(false)
                    if (p.root) void sel.load(p.root, s.image)
                  }}>{s.name}</button>
                  <button className="icon-btn" title={UI.remove} onClick={() => removeSaved(p, s.id, s.image)}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </span>
      {sel.active && (
        <button className="btn btn-ghost sketch-small" title={UI.deselect} onClick={() => sel.clear()}>
          <X size={13} /> {UI.deselectShort}
        </button>
      )}
    </div>
  )
}

function removeSaved(p: SelectionBarProps, id: Id, image: string) {
  p.update((d) => ({ ...d, selections: (d.selections ?? []).filter((s) => s.id !== id) }))
  if (p.root) void resolveAssetPath(p.root, image).then((abs) => getFs().remove(abs).catch(() => {}))
}
