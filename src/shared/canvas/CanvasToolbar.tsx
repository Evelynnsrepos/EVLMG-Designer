import { boardShortcut, formatCombo } from '@/core/shortcuts'
import { Redo2, Scan, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSettings } from '@/core/state'
import { keyHint } from '@/shared/hotkeyHints'
import type { CanvasTool } from './types'

export const TOOLBAR_LABELS = {
  undo: 'Undo (Ctrl+Z)',
  redo: 'Redo (Ctrl+Y)',
  zoomIn: 'Zoom in (+)',
  zoomOut: 'Zoom out (-)',
  zoomReset: 'Reset zoom to 100% (0)',
  fit: 'Fit to content (Shift+1)',
  toolbar: 'Canvas tools',
  penSize: 'Size',
  smoothing: 'Smoothing',
  opacity: 'Opacity',
}

export interface CanvasToolbarProps {
  tools: CanvasTool<any>[]
  toolId: string
  onTool(id: string): void
  onUndo?(): void
  onRedo?(): void
  canUndo?: boolean
  canRedo?: boolean
  scale: number
  onZoomIn(): void
  onZoomOut(): void
  onZoomReset(): void
  onFit(): void
  /** Component-specific controls (color picker, options), shown after the tools. */
  children?: ReactNode
}

/** The slim bottom toolbar shared by all canvas components (spec 10.3). */
export function CanvasToolbar(p: CanvasToolbarProps) {
  return (
    <div className="canvas-toolbar" role="toolbar" aria-label={TOOLBAR_LABELS.toolbar} onPointerDown={(e) => e.stopPropagation()}>
      {p.tools.filter((t) => !t.hidden).map((t) => {
        const Icon = t.icon
        const key = boardShortcut(t.id, t.shortcut)
        const title = key ? `${t.label} (${formatCombo(key)})` : t.label
        return (
          <button
            key={t.id}
            className={'canvas-toolbar-btn' + (t.id === p.toolId ? ' is-active' : '')}
            title={title}
            aria-label={title}
            aria-pressed={t.id === p.toolId}
            {...keyHint(key)}
            onClick={() => p.onTool(t.id)}
          >
            {Icon ? <Icon size={17} strokeWidth={1.8} /> : <span className="canvas-toolbar-text">{t.label}</span>}
          </button>
        )
      })}
      {p.toolId === 'pen' && (
        <>
          <span className="canvas-toolbar-sep" />
          <PenOptions />
        </>
      )}
      {p.children ? (
        <>
          <span className="canvas-toolbar-sep" />
          {p.children}
        </>
      ) : null}
      {p.onUndo || p.onRedo ? (
        <>
          <span className="canvas-toolbar-sep" />
          <button className="canvas-toolbar-btn" title={TOOLBAR_LABELS.undo} aria-label={TOOLBAR_LABELS.undo} disabled={p.canUndo === false} onClick={p.onUndo} {...keyHint('ctrl+z')}>
            <Undo2 size={17} strokeWidth={1.8} />
          </button>
          <button className="canvas-toolbar-btn" title={TOOLBAR_LABELS.redo} aria-label={TOOLBAR_LABELS.redo} disabled={p.canRedo === false} onClick={p.onRedo} {...keyHint('ctrl+y')}>
            <Redo2 size={17} strokeWidth={1.8} />
          </button>
        </>
      ) : null}
      <span className="canvas-toolbar-sep" />
      <button className="canvas-toolbar-btn" title={TOOLBAR_LABELS.zoomOut} aria-label={TOOLBAR_LABELS.zoomOut} onClick={p.onZoomOut} {...keyHint('-')}>
        <ZoomOut size={17} strokeWidth={1.8} />
      </button>
      <button className="canvas-toolbar-zoom" title={TOOLBAR_LABELS.zoomReset} aria-label={TOOLBAR_LABELS.zoomReset} onClick={p.onZoomReset}>
        {Math.round(p.scale * 100)}%
      </button>
      <button className="canvas-toolbar-btn" title={TOOLBAR_LABELS.zoomIn} aria-label={TOOLBAR_LABELS.zoomIn} onClick={p.onZoomIn} {...keyHint('+')}>
        <ZoomIn size={17} strokeWidth={1.8} />
      </button>
      <button className="canvas-toolbar-btn" title={TOOLBAR_LABELS.fit} aria-label={TOOLBAR_LABELS.fit} onClick={p.onFit} {...keyHint('shift+1')}>
        <Scan size={17} strokeWidth={1.8} />
      </button>
    </div>
  )
}

/** Pen size and smoothing sliders, shown while the pen is the active tool (v0.4). Kept for every canvas. */
function PenOptions() {
  const size = useSettings((s) => s.penSize)
  const smoothing = useSettings((s) => s.penSmoothing)
  const opacity = useSettings((s) => s.penOpacity)
  const update = useSettings((s) => s.update)
  return (
    <>
      <label className="canvas-toolbar-slider" title={`${TOOLBAR_LABELS.penSize}: ${size}px`}>
        <span>{TOOLBAR_LABELS.penSize}</span>
        <input type="range" min={1} max={40} step={1} value={size} onChange={(e) => update({ penSize: Number(e.target.value) })} />
        <span className="canvas-toolbar-value">{size}</span>
      </label>
      <label className="canvas-toolbar-slider" title={`${TOOLBAR_LABELS.opacity}: ${Math.round(opacity * 100)}%`}>
        <span>{TOOLBAR_LABELS.opacity}</span>
        <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => update({ penOpacity: Number(e.target.value) })} />
        <span className="canvas-toolbar-value">{Math.round(opacity * 100)}%</span>
      </label>
      <label className="canvas-toolbar-slider" title={`${TOOLBAR_LABELS.smoothing}: ${Math.round(smoothing * 100)}%`}>
        <span>{TOOLBAR_LABELS.smoothing}</span>
        <input type="range" min={0} max={1} step={0.05} value={smoothing} onChange={(e) => update({ penSmoothing: Number(e.target.value) })} />
      </label>
    </>
  )
}
