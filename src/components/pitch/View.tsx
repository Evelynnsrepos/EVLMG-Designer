import { ArrowDown, ArrowUp, ImagePlus, Play, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { pickAndImportAssets, useAssetUrl } from '@/core/assets'
import { newId, type Entity, type EntityType, type Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { PresetHeader } from '@/shared/calculators'
import { ENTITY_LABELS } from '@/shared/categories'
import '@/shared/listDetail/listDetail.css'
import './pitch.css'

/** Pitch / presentation mode (v0.10): slides built from the project, shown full screen. */

type Layout = 'title' | 'text' | 'image' | 'pillars' | 'entities'

interface Slide {
  id: Id
  layout: Layout
  title: string
  text: string
  image: string | null
  entityType: EntityType
  entityIds: Id[]
}

interface PitchDoc {
  slides: Slide[]
}

interface VisionLite {
  pitch?: string
  vision?: string
  fantasy?: string
  usps?: string[]
  pillars?: { id: Id; title: string; why: string; color: string }[]
}

const LAYOUTS: { id: Layout; label: string }[] = [
  { id: 'title', label: 'Title' },
  { id: 'text', label: 'Text' },
  { id: 'image', label: 'Picture and text' },
  { id: 'pillars', label: 'Design pillars' },
  { id: 'entities', label: 'Items, characters…' },
]

const newSlide = (layout: Layout = 'text', patch: Partial<Slide> = {}): Slide => ({ id: newId(), layout, title: '', text: '', image: null, entityType: 'character', entityIds: [], ...patch })
const createPitchDoc = (): PitchDoc => ({ slides: [] })

export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<PitchDoc>('pitch', documentId!, createPitchDoc)
  useUndoRedoKeys(doc, active)
  const project = useProjectStore((s) => s.meta)
  const root = useProjectStore((s) => s.root)
  const entities = useProjectStore((s) => s.entities)
  const vision = useDocument<VisionLite>('vision', 'vision', () => ({})).data ?? {}
  const [sel, setSel] = useState(0)
  const [presenting, setPresenting] = useState<number | null>(null)
  if (!doc.data) return null
  const slides = doc.data.slides
  const set = (fn: (s: Slide[]) => Slide[]) => doc.update((d) => ({ ...d, slides: fn(d.slides) }))
  const s = slides[Math.min(sel, slides.length - 1)]
  const edit = (patch: Partial<Slide>) => s && set((list) => list.map((x) => (x.id === s.id ? { ...x, ...patch } : x)))

  const fromProject = () => {
    const chars = (entities.character as Entity[]).filter((e) => e.image).slice(0, 6)
    const items = (entities.item as Entity[]).slice(0, 6)
    const deck: Slide[] = [
      newSlide('title', { title: project?.name ?? 'My game', text: vision.pitch || project?.description || '' }),
      ...(vision.vision || vision.fantasy ? [newSlide('text', { title: 'The vision', text: [vision.vision, vision.fantasy && `You are: ${vision.fantasy}`].filter(Boolean).join('\n\n') })] : []),
      ...(vision.usps?.some((u) => u.trim()) ? [newSlide('text', { title: 'What makes it special', text: vision.usps.filter((u) => u.trim()).map((u) => `• ${u}`).join('\n') })] : []),
      ...(vision.pillars?.some((p) => p.title) ? [newSlide('pillars', { title: 'Design pillars' })] : []),
      ...(chars.length ? [newSlide('entities', { title: 'Characters', entityType: 'character', entityIds: chars.map((c) => c.id) })] : []),
      ...(items.length ? [newSlide('entities', { title: 'Items', entityType: 'item', entityIds: items.map((c) => c.id) })] : []),
      newSlide('title', { title: 'Thank you', text: '' }),
    ]
    set((list) => [...list, ...deck])
  }

  /** Put slide `i` at position `j` (v0.13: drag in the list, or the arrows). */
  const moveTo = (i: number, j: number) => {
    if (i === j || j < 0 || j >= slides.length) return
    set((list) => {
      const next = [...list]
      next.splice(j, 0, ...next.splice(i, 1))
      return next
    })
    setSel(j)
  }
  const move = (i: number, by: number) => moveTo(i, i + by)
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  return (
    <div className="pi">
      <div className="pi-head">
        <PresetHeader documentId={documentId!} kind="Pitch deck" undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
      </div>
      <div className="ld-toolbar">
        <button className="btn btn-primary" disabled={!slides.length} onClick={() => setPresenting(sel)}>
          <Play size={14} /> Present
        </button>
        <button className="btn" onClick={() => (set((list) => [...list, newSlide()]), setSel(slides.length))}>
          <Plus size={14} /> Slide
        </button>
        <button className="btn btn-ghost" onClick={fromProject} title="Title, vision, selling points, pillars, characters and items from your project">
          <Sparkles size={14} /> Build from project
        </button>
      </div>
      <div className="pi-body">
        <div className="pi-list">
          {slides.length === 0 && <p className="muted">No slides yet. Build from project fills a deck from your vision, pillars, characters and items.</p>}
          {slides.map((x, i) => (
            <button
              key={x.id}
              className={`pi-thumb${i === sel ? ' on' : ''}${dragFrom !== null && dragFrom !== i ? ' drop' : ''}`}
              title="Drag to reorder"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                setDragFrom(i)
              }}
              onDragOver={(e) => dragFrom !== null && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (dragFrom !== null) moveTo(dragFrom, i)
                setDragFrom(null)
              }}
              onDragEnd={() => setDragFrom(null)}
              onClick={() => setSel(i)}
            >
              <span>{i + 1}</span>
              {x.title || LAYOUTS.find((l) => l.id === x.layout)?.label}
            </button>
          ))}
        </div>
        <div className="pi-stage">{s && <SlideView slide={s} vision={vision} entities={entities} />}</div>
        {s && (
          <aside className="pi-side">
            <label className="ld-field">
              <span>Layout</span>
              <select className="input" value={s.layout} onChange={(e) => edit({ layout: e.target.value as Layout })}>
                {LAYOUTS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ld-field">
              <span>Title</span>
              <input className="input" value={s.title} onChange={(e) => edit({ title: e.target.value })} />
            </label>
            {(s.layout === 'title' || s.layout === 'text' || s.layout === 'image') && (
              <label className="ld-field">
                <span>Text</span>
                <textarea className="input" rows={6} value={s.text} onChange={(e) => edit({ text: e.target.value })} />
              </label>
            )}
            {(s.layout === 'image' || s.layout === 'title') && root && (
              <button
                className="btn"
                onClick={async () => {
                  const [a] = await pickAndImportAssets(root, 'image', 'Picture for the slide')
                  if (a) edit({ image: a.path })
                }}
              >
                <ImagePlus size={14} /> {s.image ? 'Change picture' : 'Add picture'}
              </button>
            )}
            {s.layout === 'entities' && (
              <>
                <label className="ld-field">
                  <span>Show</span>
                  <select className="input" value={s.entityType} onChange={(e) => edit({ entityType: e.target.value as EntityType, entityIds: [] })}>
                    {(['character', 'item', 'town', 'enemy'] as const).map((t) => (
                      <option key={t} value={t}>
                        {ENTITY_LABELS[t].many}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="pi-picks">
                  {(entities[s.entityType] as Entity[]).map((e) => (
                    <label key={e.id} className="ld-inline">
                      <input type="checkbox" checked={s.entityIds.includes(e.id)} onChange={(ev) => edit({ entityIds: ev.target.checked ? [...s.entityIds, e.id] : s.entityIds.filter((x) => x !== e.id) })} />
                      {e.name || 'Untitled'}
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className="ld-inline">
              <button className="icon-btn" title="Move up" aria-label="Move up" onClick={() => move(sel, -1)}>
                <ArrowUp size={14} />
              </button>
              <button className="icon-btn" title="Move down" aria-label="Move down" onClick={() => move(sel, 1)}>
                <ArrowDown size={14} />
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  set((list) => list.filter((x) => x.id !== s.id))
                  setSel(Math.max(0, sel - 1))
                }}
              >
                <Trash2 size={14} /> Delete slide
              </button>
            </div>
          </aside>
        )}
      </div>
      {presenting !== null && slides.length > 0 && <Presenter slides={slides} start={presenting} vision={vision} entities={entities} onClose={() => setPresenting(null)} />}
    </div>
  )
}

function SlideImage({ path }: { path: string | null }) {
  const url = useAssetUrl(path)
  return url ? <img className="pi-img" src={url} alt="" /> : null
}

function EntityCard({ e }: { e: Entity }) {
  const url = useAssetUrl(e.image)
  return (
    <div className="pi-entity">
      {url ? <img src={url} alt="" /> : <div className="pi-noimg" />}
      <strong>{e.name}</strong>
      <span>{e.description.slice(0, 90)}</span>
    </div>
  )
}

function SlideView({ slide, vision, entities }: { slide: Slide; vision: VisionLite; entities: Record<EntityType, Entity[]> }) {
  return (
    <div className={`pi-slide pi-l-${slide.layout}`}>
      {slide.layout === 'title' && (
        <>
          <SlideImage path={slide.image} />
          <h1>{slide.title}</h1>
          {slide.text && <p>{slide.text}</p>}
        </>
      )}
      {slide.layout === 'text' && (
        <>
          <h2>{slide.title}</h2>
          <p>{slide.text}</p>
        </>
      )}
      {slide.layout === 'image' && (
        <div className="pi-split">
          <SlideImage path={slide.image} />
          <div>
            <h2>{slide.title}</h2>
            <p>{slide.text}</p>
          </div>
        </div>
      )}
      {slide.layout === 'pillars' && (
        <>
          <h2>{slide.title || 'Design pillars'}</h2>
          <div className="pi-pillars">
            {(vision.pillars ?? [])
              .filter((p) => p.title)
              .map((p) => (
                <div key={p.id} style={{ borderTopColor: p.color }}>
                  <strong>{p.title}</strong>
                  <span>{p.why}</span>
                </div>
              ))}
          </div>
        </>
      )}
      {slide.layout === 'entities' && (
        <>
          <h2>{slide.title}</h2>
          <div className="pi-entities">
            {slide.entityIds.map((id) => {
              const e = (entities[slide.entityType] ?? []).find((x) => x.id === id)
              return e ? <EntityCard key={id} e={e} /> : null
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Presenter({ slides, start, vision, entities, onClose }: { slides: Slide[]; start: number; vision: VisionLite; entities: Record<EntityType, Entity[]>; onClose(): void }) {
  const [i, setI] = useState(start)
  useEffect(() => {
    const el = document.documentElement
    void el.requestFullscreen?.().catch(() => undefined)
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') onClose()
      else if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) setI((x) => Math.min(slides.length - 1, x + 1))
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) setI((x) => Math.max(0, x - 1))
    }
    const onFs = () => !document.fullscreenElement && onClose()
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('fullscreenchange', onFs)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
  }, [onClose, slides.length])
  return (
    <div className="pi-present" onClick={() => setI((x) => Math.min(slides.length - 1, x + 1))}>
      <SlideView slide={slides[i]} vision={vision} entities={entities} />
      <div className="pi-count">
        {i + 1} / {slides.length}
      </div>
    </div>
  )
}
