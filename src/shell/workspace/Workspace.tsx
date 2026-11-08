import { useRef, useState } from 'react'
import type { LayoutNode } from '@/core/model'
import { useAppStore, useProjectStore } from '@/core/state'
import { DRAG_MIME, openComponent, type DragPayload } from '../editor/actions'
import { Columns2, Rows2 } from 'lucide-react'
import { getManifest } from '@/core/registry'
import { PanelFrame } from './PanelFrame'
import { useLayoutDrag } from './layoutDrag'
import { ToolDragLabel, useToolDrag } from './toolDrag'
import { dropPanel, findPanel, flipSplit, panelRects, setRatio, type NodePath } from './layoutTree'
import './workspace.css'

/** The tiling editor area (spec 7). Renders the layout tree from project meta. */
export function Workspace() {
  const layout = useProjectStore((s) => s.meta?.layout ?? null)
  const layoutMode = useAppStore((s) => s.layoutMode)
  const [emptyDrop, setEmptyDrop] = useState(false)
  const fingerOverEmpty = useToolDrag((s) => s.empty)

  if (!layout) {
    return (
      <div
        className={`workspace workspace-empty${emptyDrop || fingerOverEmpty ? ' drop-target' : ''}`}
        data-tool-drop="empty"
        data-tour="workspace"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_MIME)) {
            e.preventDefault()
            setEmptyDrop(true)
          }
        }}
        onDragLeave={() => setEmptyDrop(false)}
        onDrop={(e) => {
          setEmptyDrop(false)
          const raw = e.dataTransfer.getData(DRAG_MIME)
          if (!raw) return
          const p = JSON.parse(raw) as DragPayload
          openComponent(p.type, p.documentId)
        }}
      >
        <div>Click a tool in the sidebar, or drag it here.</div>
        <ToolDragLabel />
      </div>
    )
  }

  return (
    <div className={`workspace${layoutMode ? ' layout-mode' : ''}`} data-tour="workspace">
      <Node node={layout} path={[]} />
      {layoutMode && <DragPreview layout={layout} />}
      <ToolDragLabel />
    </div>
  )
}

function Node({ node, path }: { node: LayoutNode; path: NodePath }) {
  if (node.kind === 'panel') return <PanelFrame panel={node.panel} />
  return (
    <div className={`split split-${node.direction}`}>
      <div className="split-child" style={{ flexBasis: `${node.ratio * 100}%` }}>
        <Node node={node.first} path={[...path, 0]} />
      </div>
      <Divider direction={node.direction} path={path} />
      <div className="split-child" style={{ flexBasis: `${(1 - node.ratio) * 100}%` }}>
        <Node node={node.second} path={[...path, 1]} />
      </div>
    </div>
  )
}

/** While dragging in Layout Mode: where the panel will end up, and its name next to the pointer. */
function DragPreview({ layout }: { layout: LayoutNode }) {
  const { from, over, zone, x, y } = useLayoutDrag()
  if (!from) return null
  const panel = findPanel(layout, from)
  const name = (panel && getManifest(panel.type)?.name) ?? ''
  const rect = over && zone ? panelRects(dropPanel(layout, from, over, zone)).find((r) => r.panel.id === from)?.rect : undefined
  return (
    <>
      {rect && (
        <div
          className="layout-preview"
          style={{
            left: `calc(4px + ${rect.x} * (100% - 8px))`,
            top: `calc(4px + ${rect.y} * (100% - 8px))`,
            width: `calc(${rect.w} * (100% - 8px))`,
            height: `calc(${rect.h} * (100% - 8px))`,
          }}
        >
          {zone === 'center' ? `Swap` : `Move here`}
        </div>
      )}
      <div className="layout-drag-label" style={{ left: x + 14, top: y + 14 }}>
        {name}
      </div>
    </>
  )
}

/** Drag to resize a split (ED-9). */
function Divider({ direction, path }: { direction: 'row' | 'column'; path: NodePath }) {
  const ref = useRef<HTMLDivElement>(null)
  const layoutMode = useAppStore((s) => s.layoutMode)
  const flip = () => {
    const { meta, setLayout } = useProjectStore.getState()
    if (meta?.layout) setLayout(flipSplit(meta.layout, path))
  }
  return (
    <div
      ref={ref}
      className={`divider divider-${direction}`}
      onPointerDown={(e) => {
        const container = ref.current?.parentElement
        if (!container || e.target !== e.currentTarget) return
        e.preventDefault()
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        const box = container.getBoundingClientRect()
        const onMove = (ev: PointerEvent) => {
          const ratio = direction === 'row' ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height
          const { meta, setLayout } = useProjectStore.getState()
          if (meta?.layout) setLayout(setRatio(meta.layout, path, ratio))
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      }}
    >
      {layoutMode && (
        <button className="layout-flip" title={direction === 'row' ? 'Stack these on top of each other' : 'Put these side by side'} onClick={flip}>
          {direction === 'row' ? <Rows2 size={20} /> : <Columns2 size={20} />}
        </button>
      )}
    </div>
  )
}
