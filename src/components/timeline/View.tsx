import { MoveHorizontal, PanelRight, Shrink } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { pickAndImportAssets, useAssetUrls } from '@/core/assets'
import type { Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore } from '@/core/state'
import {
  CanvasEditor,
  deleteNodes,
  handTool,
  measureTextHeight,
  selectTool,
  updateNode,
  useCanvasState,
  useCanvasTheme,
  type CanvasTool,
  type SceneRecipe,
} from '@/shared/canvas'
import { combineRefProviders, useEntityRefProvider } from '@/shared/richtext'
import { useArticleRefProvider } from '@/shared/wiki'
import { Details } from './Details'
import { formatYear, useCalendar } from '@/shared/calendar'
import { syncCalendar, setLineLength, stretchTimeline, createDefaultTimeline, events, layoutCards, mainLine, normalizeTimeline, yearAxis, type TimelineItem } from './model'
import { makeTimelineTypes } from './timelineTypes'
import { branchTool, eventTool, timelineSelectTool, type TimelineToolHost } from './tools'
import './timeline.css'

const UI = {
  canvas: 'Timeline canvas',
  start: 'Start year',
  end: 'End year',
  years: 'Years',
  details: 'Details panel',
  optional: 'optional',
}

/** Whole-year field (TL-1, TL-8): empty means "not set"; negative years allowed. */
function YearInput({ label, value, onChange }: { label: string; value: number | null; onChange(v: number | null): void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      className="input timeline-year"
      inputMode="numeric"
      aria-label={label}
      title={label}
      placeholder={UI.optional}
      value={draft ?? (value === null ? '' : String(value))}
      onFocus={() => setDraft(value === null ? '' : String(value))}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        const s = e.target.value.trim()
        setDraft(e.target.value)
        if (s === '') onChange(null)
        else if (/^-?\d+$/.test(s)) onChange(Number.parseInt(s, 10))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault() // Esc must not toggle Layout Mode here (ED-7)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument('timeline', documentId!, createDefaultTimeline)
  const root = useProjectStore((s) => s.root)
  const entityRefs = useEntityRefProvider()
  const articleRefs = useArticleRefProvider()
  const refs = useMemo(() => combineRefProviders(articleRefs, entityRefs), [articleRefs, entityRefs])
  const canvas = useCanvasState({ toolId: 'event' })
  const { font } = useCanvasTheme()
  const [showDetails, setShowDetails] = useState(true)
  const [createdId, setCreatedId] = useState<Id | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const data = doc.data
  const scene = data?.scene
  const main = scene ? mainLine(scene) : undefined
  const axis = data && main ? yearAxis(data, main.length) : null
  const years = axis ? { start: axis.start, end: axis.end } : null
  const cards = useMemo(
    () => (scene ? layoutCards(scene, (t, size, w) => measureTextHeight(t, size, w, font), !!axis) : new Map()),
    [scene, font, axis],
  )
  const calendar = useCalendar().data
  const updateDoc = doc.update
  const followsCalendar = !!calendar?.linkedTimelines?.includes(documentId!)
  // A linked timeline follows the calendar live: entries become events on the main line.
  useEffect(() => {
    if (!followsCalendar || !calendar || !scene) return
    const next = syncCalendar(scene, calendar)
    if (next !== scene) updateDoc((d) => ({ ...d, scene: normalizeTimeline(syncCalendar(d.scene, calendar)) }), { undoable: false })
  }, [followsCalendar, calendar, scene, updateDoc])
  const formatYearFn = useMemo(() => (calendar?.useOnTimeline && calendar.eras.length ? (y: number) => formatYear(calendar, y) : undefined), [calendar])
  const nodeTypes = useMemo(
    () => makeTimelineTypes({ years, mainId: main?.id, cards, formatYear: formatYearFn }),
    // years is rebuilt each render; its numbers are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [years?.start, years?.end, main?.id, cards, formatYearFn],
  )
  const resolveImageSrc = useAssetUrls(scene ? events(scene).map((e) => e.src) : [])

  // Tools are created once and read the current axis and card layout through a ref.
  const live = useRef({ axis, cards })
  useLayoutEffect(() => {
    live.current = { axis, cards }
  })
  const tools = useMemo<CanvasTool<TimelineItem>[]>(() => {
    const host: TimelineToolHost = {
      axis: () => live.current.axis,
      cards: () => live.current.cards,
      created: (id) => {
        setCreatedId(id)
        setShowDetails(true)
      },
    }
    return [eventTool(host), branchTool(host), timelineSelectTool(host, selectTool), handTool]
  }, [])

  if (!data || !scene) return null

  // Every saved change passes through normalizeTimeline so deletes, undo and duplicates stay consistent.
  const onChange = (recipe: SceneRecipe<TimelineItem>, options?: { undoable?: boolean }) =>
    doc.update((d) => ({ ...d, scene: normalizeTimeline(recipe(d.scene)) }), options)
  const setYears = (patch: { startYear?: number | null; endYear?: number | null }) => doc.update((d) => ({ ...d, ...patch }))

  const selected = canvas.selection.length === 1 ? scene.nodes.find((n) => n.id === canvas.selection[0]) : undefined

  const pickImage = async (id: Id) => {
    if (!root) return
    const [asset] = await pickAndImportAssets(root, 'image')
    if (asset) onChange((s) => updateNode(s, id, (n) => ({ ...n, src: asset.path })))
  }

  return (
    <div className="timeline-root" ref={rootRef}>
      <div className="timeline-canvas">
        <CanvasEditor<TimelineItem>
          scene={scene}
          onChange={onChange}
          onUndo={doc.undo}
          onRedo={doc.redo}
          canUndo={doc.canUndo}
          canRedo={doc.canRedo}
          active={active}
          tools={tools}
          nodeTypes={nodeTypes}
          canvas={canvas}
          resolveImageSrc={resolveImageSrc}
          ariaLabel={UI.canvas}
          // The main line always stays; deleting a branch takes its events and sub-branches along (normalizeTimeline).
          onDeleteNodes={(ids, api) => api.update((s) => deleteNodes(s, ids.filter((id) => id !== main?.id)))}
          toolbarExtra={
            <>
              <span className="timeline-years-label">{UI.years}</span>
              <YearInput label={UI.start} value={data.startYear} onChange={(v) => setYears({ startYear: v })} />
              <span className="timeline-years-dash">–</span>
              <YearInput label={UI.end} value={data.endYear} onChange={(v) => setYears({ endYear: v })} />
              <button
                className="canvas-toolbar-btn"
                title="Make the timeline longer (or drag the round handle at its end)"
                aria-label="Make the timeline longer"
                onClick={() => main && onChange((s) => stretchTimeline(s, main.length * 1.5))}
              >
                <MoveHorizontal size={17} strokeWidth={1.8} />
              </button>
              <button
                className="canvas-toolbar-btn"
                title="Make the timeline shorter"
                aria-label="Make the timeline shorter"
                onClick={() => main && onChange((s) => setLineLength(s, main.id, main.length / 1.5))}
              >
                <Shrink size={17} strokeWidth={1.8} />
              </button>
              <button
                className={'canvas-toolbar-btn' + (showDetails ? ' is-active' : '')}
                title={UI.details}
                aria-label={UI.details}
                aria-pressed={showDetails}
                onClick={() => setShowDetails((v) => !v)}
              >
                <PanelRight size={17} strokeWidth={1.8} />
              </button>
            </>
          }
        />
      </div>
      {selected && showDetails && canvas.toolId !== 'hand' && (
        <Details
          key={selected.id}
          item={selected}
          axis={axis}
          refs={refs}
          autoFocus={createdId === selected.id}
          onPatch={(patch, options) => onChange((s) => updateNode(s, selected.id, (n) => ({ ...n, ...patch }) as TimelineItem), options)}
          onPickImage={() => void pickImage(selected.id)}
          onDelete={() => {
            onChange((s) => deleteNodes(s, [selected.id]))
            canvas.setSelection([])
          }}
          onClose={() => setShowDetails(false)}
          onEscape={() => rootRef.current?.querySelector<HTMLElement>('.canvas-root')?.focus()}
        />
      )}
    </div>
  )
}
