import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X } from 'lucide-react'
import { Component, Suspense, useState, type ReactNode } from 'react'
import type { Panel } from '@/core/model'
import { getManifest } from '@/core/registry'
import { PanelContext, useAppStore, useProjectStore } from '@/core/state'
import { ReviewButton } from '@/shared/reviews'
import { PanelJumps } from '@/shared/jumps/Jumps'
import { closePanel, DRAG_MIME, movePanel, openComponent, type DragPayload } from '../editor/actions'
import { neighbor, sideFromPoint, type Direction, type DropSide } from './layoutTree'
import { startLayoutDrag, useLayoutDrag } from './layoutDrag'
import { ToolFontButton, useToolFontStyle } from './ToolFont'
import { ToolKeysButton, ToolScaleButton, useToolScale } from './ToolHelp'

/** One tile: slim "fake" window header (ED-4), the component view, drop zones and Layout Mode overlay. */
export function PanelFrame({ panel }: { panel: Panel }) {
  const manifest = getManifest(panel.type)
  const docTitle = useProjectStore((s) => s.meta?.documents.find((d) => d.id === panel.documentId)?.title)
  const layout = useProjectStore((s) => s.meta?.layout ?? null)
  const layoutMode = useAppStore((s) => s.layoutMode)
  const active = useAppStore((s) => s.activePanelId === panel.id)
  const [drop, setDrop] = useState<DropSide | null>(null)
  const dragging = useLayoutDrag((s) => s.from === panel.id)
  const fontStyle = useToolFontStyle(panel.type)
  const scale = useToolScale(panel.type)

  const View = manifest?.View
  const title = manifest ? (docTitle ? `${manifest.name} · ${docTitle}` : manifest.name) : panel.type

  return (
    <section
      className={`panel${active ? ' active' : ''}${dragging ? ' layout-dragging' : ''}`}
      data-panel-id={panel.id}
      tabIndex={-1}
      onFocusCapture={() => useAppStore.getState().setActivePanel(panel.id)}
      onMouseDownCapture={() => useAppStore.getState().setActivePanel(panel.id)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return
        e.preventDefault()
        setDrop(dropSide(e))
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null)
      }}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(DRAG_MIME)
        setDrop(null)
        if (!raw) return
        e.preventDefault()
        const p = JSON.parse(raw) as DragPayload
        openComponent(p.type, p.documentId, { targetId: panel.id, side: dropSide(e) })
      }}
    >
      <header className="panel-header">
        {manifest && <manifest.icon size={13} />}
        <span className="panel-title">{title}</span>
        {manifest && <ToolKeysButton panel={panel} />}
        {manifest && <ToolScaleButton type={panel.type} />}
        {manifest && <ToolFontButton type={panel.type} />}
        {manifest && <PanelJumps type={panel.type} documentId={panel.documentId} />}
        {manifest && panel.type !== 'reviews' && <ReviewButton target={{ kind: 'doc', type: panel.type, id: panel.documentId }} title={title} />}
        {/* v0.14: close this tool without Layout Mode. */}
        <button className="panel-close" title="Close this tool (everything is saved)" aria-label={`Close ${title}`} onClick={() => void closePanel(panel.id)}>
          <X size={12} />
        </button>
      </header>
      <div className="panel-body" style={scale === 100 ? fontStyle : { ...fontStyle, zoom: scale / 100 }}>
        <PanelErrorBoundary name={title}>
          <Suspense fallback={<div className="panel-loading">Loading…</div>}>
            <PanelContext.Provider value={panel}>
              {View ? <View panel={panel} documentId={panel.documentId} active={active} /> : <div className="panel-loading">Unknown component</div>}
            </PanelContext.Provider>
          </Suspense>
        </PanelErrorBoundary>
      </div>

      {drop && <div className={`drop-zone drop-${drop}`} />}

      {layoutMode && (
        <div className="layout-overlay" title="Drag to move this tool" onPointerDown={(e) => startLayoutDrag(e, panel.id)}>
          <button className="layout-close" title="Close" onClick={() => void closePanel(panel.id)}>
            <X size={64} strokeWidth={1.5} />
          </button>
          {(['up', 'down', 'left', 'right'] as Direction[]).map((dir) =>
            neighbor(layout, panel.id, dir) ? (
              <button key={dir} className={`layout-arrow arrow-${dir}`} title={`Move ${dir}`} onClick={() => movePanel(panel.id, dir)}>
                {dir === 'up' ? <ArrowUp /> : dir === 'down' ? <ArrowDown /> : dir === 'left' ? <ArrowLeft /> : <ArrowRight />}
              </button>
            ) : null,
          )}
          <div className="layout-name">{title}</div>
        </div>
      )}
    </section>
  )
}

/** Which half of the panel the pointer is over (ED-3). */
function dropSide(e: React.DragEvent<HTMLElement>): DropSide {
  const box = e.currentTarget.getBoundingClientRect()
  return sideFromPoint((e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height)
}

/** A crashing component must not take down the whole editor. */
class PanelErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="panel-loading">
          {this.props.name} crashed: {this.state.error.message}
        </div>
      )
    }
    return this.props.children
  }
}
