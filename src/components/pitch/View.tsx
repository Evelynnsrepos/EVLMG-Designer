import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, BringToFront, Copy, Eye, EyeOff, FileDown, ImagePlus, Lock, MonitorPlay, Play, Plus, SendToBack, Shapes, Sparkles, Trash2, Type, Unlock } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assetUrl, importAssetsFromDataTransfer, pickAndImportAssets } from '@/core/assets'
import { newId, type Entity, type EntityType } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useIntentHandler, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { safeFileName, saveBinaryFile } from '@/core/export'
import { PresetHeader } from '@/shared/calculators'
import { ENTITY_LABELS } from '@/shared/categories'
import { BUNDLED_FONTS } from '@/shared/fontList'
import '@/shared/listDetail/listDetail.css'
import { H, THEMES, buildsOf, exportSlide, newObj, newSlide, shownSlides, themeOf, unlockLayout, widthOf, type Build, type ExpandContext, type Layout, type Obj, type PitchDoc, type ShapeKind, type Slide, type Transition } from './model'
import { deckToOdp } from './odp'
import { deckToPptx } from './pptx'
import { Presenter, type ShowSlide } from './Presenter'
import { deckToPdf, deckToPngZip, resolveDeck } from './render'
import { SlideBox } from './SlideBox'
import { Stage } from './Stage'
import { expandSlide } from './model'
import './pitch.css'

/**
 * Pitch Deck (v0.10, overhauled 0.35): free slides with text, pictures and shapes on top of the
 * ready layouts, themes, notes, transitions, builds, presenter view, and exports to .pptx, .odp,
 * PDF and slide pictures.
 * Intents: `add-slides` ({ slides: { title, text, image }[] }) adds picture-and-text slides at the end (the Storyboard's export).
 */

interface VisionLite {
  pitch?: string
  vision?: string
  fantasy?: string
  usps?: string[]
  pillars?: { id: string; title: string; why: string; color: string }[]
}

const LAYOUTS: { id: Layout; label: string }[] = [
  { id: 'blank', label: 'Blank (free)' },
  { id: 'title', label: 'Title' },
  { id: 'text', label: 'Text' },
  { id: 'image', label: 'Picture and text' },
  { id: 'pillars', label: 'Design pillars' },
  { id: 'entities', label: 'Items, characters…' },
]
const SHAPES: { id: ShapeKind; label: string }[] = [
  { id: 'rect', label: 'Box' },
  { id: 'round', label: 'Rounded box' },
  { id: 'ellipse', label: 'Circle' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'line', label: 'Line' },
  { id: 'arrow', label: 'Arrow' },
]
const TRANSITIONS: { id: Transition; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'push', label: 'Push' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'morph', label: 'Morph (magic move)' },
]
const BUILDS: { id: Build; label: string }[] = [
  { id: 'none', label: 'Always there' },
  { id: 'appear', label: 'Appear on click' },
  { id: 'fade', label: 'Fade in on click' },
  { id: 'fly', label: 'Fly in on click' },
]
const EXPORTS = [
  { id: 'pptx', label: 'PowerPoint, Keynote, Google Slides (.pptx)' },
  { id: 'odp', label: 'LibreOffice, OpenDocument (.odp)' },
  { id: 'pdf', label: 'PDF' },
  { id: 'png', label: 'Slide pictures (.zip of PNG)' },
] as const

const createPitchDoc = (): PitchDoc => ({ slides: [] })
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

async function imageSize(root: string, path: string): Promise<{ w: number; h: number } | null> {
  const url = await assetUrl(root, path)
  if (!url) return null
  const img = new Image()
  img.src = url
  return img.decode().then(
    () => ({ w: img.naturalWidth, h: img.naturalHeight }),
    () => null,
  )
}

export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<PitchDoc>('pitch', documentId!, createPitchDoc)
  useUndoRedoKeys(doc, active)
  const project = useProjectStore((s) => s.meta)
  const root = useProjectStore((s) => s.root)
  const entities = useProjectStore((s) => s.entities)
  const vision = useDocument<VisionLite>('vision', 'vision', () => ({})).data ?? {}
  const [sel, setSel] = useState(0)
  const [objSel, setObjSel] = useState<string[]>([])
  const [presenting, setPresenting] = useState<{ start: number; notes: boolean } | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const clip = useRef<Obj[]>([])
  useIntentHandler(
    'pitch',
    (intent) => {
      if (intent.action !== 'add-slides' || !Array.isArray(intent.slides)) return
      const added = (intent.slides as Record<string, unknown>[]).map((x) =>
        newSlide('image', { title: typeof x.title === 'string' ? x.title : '', text: typeof x.text === 'string' ? x.text : '', image: typeof x.image === 'string' ? x.image : null }),
      )
      if (added.length) doc.update((d) => ({ ...d, slides: [...d.slides, ...added] }))
    },
    !!doc.data,
  )

  const data = doc.data
  const theme = themeOf(data ?? {})
  const W = widthOf(data ?? {})
  const ctx: ExpandContext = useMemo(() => ({ width: W, theme, pillars: vision.pillars ?? [], entities: entities as Partial<Record<EntityType, Entity[]>> }), [W, theme, vision.pillars, entities])
  const slides = data?.slides ?? []
  const s: Slide | undefined = slides[Math.min(sel, slides.length - 1)]
  const set = useCallback((fn: (s: Slide[]) => Slide[]) => doc.update((d) => ({ ...d, slides: fn(d.slides) })), [doc])
  const edit = useCallback((patch: Partial<Slide>) => s && set((list) => list.map((x) => (x.id === s.id ? { ...x, ...patch } : x))), [s, set])
  const setObjs = useCallback((fn: (objs: Obj[]) => Obj[]) => s && set((list) => list.map((x) => (x.id === s.id ? { ...x, objects: fn(x.objects ?? []) } : x))), [s, set])
  const patchObjs = useCallback((changed: Obj[]) => setObjs((objs) => objs.map((o) => changed.find((c) => c.id === o.id) ?? o)), [setObjs])
  const own = s?.objects ?? []
  // A pick only counts on the slide it was made on.
  const picked = own.filter((o) => objSel.includes(o.id))

  const addObj = (o: Obj) => {
    setObjs((objs) => [...objs, o])
    setObjSel([o.id])
  }
  const addPicture = async (path: string, at?: { x: number; y: number }) => {
    const size = root ? await imageSize(root, path) : null
    const k = size ? Math.min(900 / size.w, 700 / size.h, 1) : 1
    const w = Math.round(size ? size.w * k : 600)
    const h = Math.round(size ? size.h * k : 400)
    addObj(newObj('image', { image: path, w, h, x: Math.round((at?.x ?? W / 2) - w / 2), y: Math.round((at?.y ?? H / 2) - h / 2) }))
  }
  const removePicked = () => {
    setObjs((objs) => objs.filter((o) => !objSel.includes(o.id)))
    setObjSel([])
  }
  /** `paste` keeps the morph link, so a thing pasted onto another slide glides there with Morph. */
  const duplicatePicked = (list = picked, offset = 30, paste = false) => {
    const copies = list.map((o) => ({ ...o, id: newId(), x: o.x + offset, y: o.y + offset, ...(paste ? { mid: o.mid ?? o.id } : { mid: undefined }) }))
    setObjs((objs) => [...objs, ...copies])
    setObjSel(copies.map((o) => o.id))
  }
  const order = (front: boolean) =>
    setObjs((objs) => {
      const mine = objs.filter((o) => objSel.includes(o.id))
      const rest = objs.filter((o) => !objSel.includes(o.id))
      return front ? [...rest, ...mine] : [...mine, ...rest]
    })

  // Keyboard on the slide: delete, nudge, duplicate, copy / paste, select all.
  useEffect(() => {
    if (!active || presenting) return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !s) return
      const mod = e.ctrlKey || e.metaKey
      if ((e.key === 'Delete' || e.key === 'Backspace') && picked.length) removePicked()
      else if (e.key.startsWith('Arrow') && picked.length) {
        const st = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0
        const dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0
        patchObjs(picked.filter((o) => !o.locked).map((o) => ({ ...o, x: o.x + dx, y: o.y + dy })))
      } else if (mod && e.key === 'd' && picked.length) duplicatePicked()
      else if (mod && (e.key === 'c' || e.key === 'x') && picked.length) {
        clip.current = picked
        if (e.key === 'x') removePicked()
      } else if (mod && e.key === 'v' && clip.current.length) duplicatePicked(clip.current, own.some((o) => clip.current.some((c) => c.id === o.id)) ? 20 : 0, true)
      else if (mod && e.key === 'a') setObjSel(own.map((o) => o.id))
      else if (e.key === 'Escape' && objSel.length) setObjSel([])
      else return
      e.preventDefault()
    }
    // Capture phase: runs before the shell's Esc (Layout Mode), so Esc first drops the pick.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!data) return null

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

  const moveTo = (i: number, j: number) => {
    if (i === j || j < 0 || j >= slides.length) return
    set((list) => {
      const next = [...list]
      next.splice(j, 0, ...next.splice(i, 1))
      return next
    })
    setSel(j)
  }
  const duplicateSlide = () => {
    if (!s) return
    const copy: Slide = { ...s, id: newId(), objects: (s.objects ?? []).map((o) => ({ ...o, id: newId(), mid: o.mid ?? o.id })) }
    set((list) => {
      const next = [...list]
      next.splice(sel + 1, 0, copy)
      return next
    })
    setSel(sel + 1)
  }

  const doExport = async (kind: (typeof EXPORTS)[number]['id']) => {
    const shown = kind === 'pptx' || kind === 'odp' ? slides : shownSlides(data)
    if (!root || !shown.length) return
    setBusy(true)
    try {
      const deck = await resolveDeck(root, { width: W, theme, title: project?.name ?? 'Pitch', slides: shown.map((x) => exportSlide(x, ctx)) })
      const bytes = kind === 'pptx' ? deckToPptx(deck) : kind === 'odp' ? deckToOdp(deck) : kind === 'pdf' ? await deckToPdf(deck) : await deckToPngZip(deck)
      const ext = kind === 'png' ? 'zip' : kind
      await saveBinaryFile({ title: 'Save pitch deck', defaultName: `${safeFileName(project?.name ?? 'pitch')}-pitch${kind === 'png' ? '-slides' : ''}.${ext}`, bytes, filter: { name: ext.toUpperCase(), extensions: [ext] } })
    } finally {
      setBusy(false)
    }
  }

  const show: ShowSlide[] = shownSlides(data).map((x) => ({ slide: x, objs: expandSlide(x, ctx), bg: x.bg || theme.bg }))
  const startShow = (notes: boolean) => {
    const at = s && !s.hidden ? show.findIndex((x) => x.slide.id === s.id) : 0
    if (show.length) setPresenting({ start: Math.max(0, at), notes })
  }
  const one = picked.length === 1 ? picked[0] : undefined
  const patchOne = (p: Partial<Obj>) => one && patchObjs([{ ...one, ...p }])
  const objs = s ? expandSlide(s, ctx) : []
  const builds = buildsOf(objs)

  return (
    <div className="pi">
      <div className="pi-head">
        <PresetHeader documentId={documentId!} kind="Pitch deck" undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
      </div>
      <div className="ld-toolbar pi-toolbar">
        <button className="btn btn-primary" disabled={!show.length} onClick={() => startShow(false)} title="Present full screen from this slide">
          <Play size={14} /> Present
        </button>
        <button className="btn" disabled={!show.length} onClick={() => startShow(true)} title="Present with your notes, the next slide and a timer (P switches)">
          <MonitorPlay size={14} /> Presenter view
        </button>
        <span className="pi-sep" />
        <button className="btn" onClick={() => (set((list) => [...list.slice(0, sel + 1), newSlide('blank'), ...list.slice(sel + 1)]), setSel(slides.length ? sel + 1 : 0))}>
          <Plus size={14} /> Slide
        </button>
        <button className="btn" disabled={!s} onClick={() => addObj(newObj('text', { color: theme.ink, font: undefined }))} title="Add a text box">
          <Type size={14} /> Text
        </button>
        <button
          className="btn"
          disabled={!s || !root}
          onClick={async () => {
            const [a] = await pickAndImportAssets(root!, 'image', 'Picture for the slide')
            if (a) await addPicture(a.path)
          }}
        >
          <ImagePlus size={14} /> Picture
        </button>
        <label className="pi-menu" title="Add a shape">
          <Shapes size={14} />
          <select
            className="input"
            value=""
            disabled={!s}
            onChange={(e) => {
              const shape = e.target.value as ShapeKind
              const line = shape === 'line' || shape === 'arrow'
              addObj(newObj('shape', { shape, fill: line ? undefined : theme.accent, stroke: line ? theme.ink : undefined, h: line ? 0 : 300, align: 'center', color: theme.bg }))
            }}
          >
            <option value="">Shape…</option>
            {SHAPES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-ghost" onClick={fromProject} title="Title, vision, selling points, pillars, characters and items from your project">
          <Sparkles size={14} /> Build from project
        </button>
        <span className="pi-sep" />
        <label className="pi-menu" title="Colours and font for the whole deck">
          Theme
          <select className="input" value={theme.id} onChange={(e) => doc.update((d) => ({ ...d, theme: e.target.value }))}>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="pi-menu" title="Slide size">
          <select className="input" value={data.ratio ?? '16:9'} onChange={(e) => doc.update((d) => ({ ...d, ratio: e.target.value as PitchDoc['ratio'] }))}>
            <option value="16:9">16:9 wide</option>
            <option value="4:3">4:3</option>
          </select>
        </label>
        <label className="pi-menu" title="Save the deck as a file for other slideshow apps, a PDF or pictures">
          <FileDown size={14} />
          <select className="input" value="" disabled={!slides.length || !root || busy} onChange={(e) => void doExport(e.target.value as (typeof EXPORTS)[number]['id'])}>
            <option value="">{busy ? 'Exporting…' : 'Export…'}</option>
            {EXPORTS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="pi-body">
        <div className="pi-list">
          {slides.length === 0 && <p className="muted">No slides yet. Add a slide, or Build from project fills a deck from your vision, pillars, characters and items.</p>}
          {slides.map((x, i) => (
            <button
              key={x.id}
              className={`pi-thumb${i === sel ? ' on' : ''}${x.hidden ? ' off' : ''}${dragFrom !== null && dragFrom !== i ? ' drop' : ''}`}
              title={x.hidden ? 'Hidden: skipped when presenting. Drag to reorder' : 'Drag to reorder'}
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
              <span className="pi-num">
                {i + 1}
                {x.hidden && <EyeOff size={11} />}
              </span>
              <SlideBox objs={expandSlide(x, ctx)} bg={x.bg || theme.bg} bgImage={x.bgImage} width={W} theme={theme} scale={140 / W} />
            </button>
          ))}
        </div>
        {s ? (
          <Stage
            objs={objs}
            bg={s.bg || theme.bg}
            bgImage={s.bgImage}
            width={W}
            theme={theme}
            sel={picked.map((o) => o.id)}
            setSel={setObjSel}
            onChange={patchObjs}
            onDropFiles={async (dt, x, y) => {
              if (!root) return
              for (const a of await importAssetsFromDataTransfer(root, dt, 'image')) await addPicture(a.path, { x, y })
            }}
          />
        ) : (
          <div className="pi-stage" />
        )}
        {s && (
          <aside className="pi-side">
            {one ? (
              <ObjectPanel o={one} builds={builds} onPatch={patchOne} root={root} />
            ) : picked.length > 1 ? (
              <MultiPanel objs={picked} width={W} onPatch={patchObjs} />
            ) : (
              <SlidePanel s={s} ctx={ctx} root={root} edit={edit} entities={entities as Record<EntityType, Entity[]>} onUnlock={() => set((list) => list.map((x) => (x.id === s.id ? unlockLayout(x, ctx) : x)))} />
            )}
            {picked.length > 0 && (
              <div className="ld-inline pi-row">
                <button className="icon-btn" title="Bring to front" aria-label="Bring to front" onClick={() => order(true)}>
                  <BringToFront size={14} />
                </button>
                <button className="icon-btn" title="Send to back" aria-label="Send to back" onClick={() => order(false)}>
                  <SendToBack size={14} />
                </button>
                <button className="icon-btn" title="Duplicate (Ctrl+D)" aria-label="Duplicate" onClick={() => duplicatePicked()}>
                  <Copy size={14} />
                </button>
                <button className="icon-btn" title={picked.every((o) => o.locked) ? 'Unlock' : 'Lock in place'} aria-label="Lock" onClick={() => patchObjs(picked.map((o) => ({ ...o, locked: !picked.every((p) => p.locked) })))}>
                  {picked.every((o) => o.locked) ? <Unlock size={14} /> : <Lock size={14} />}
                </button>
                <button className="btn btn-danger" onClick={removePicked}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            )}
            {!picked.length && (
              <div className="ld-inline pi-row">
                <button className="icon-btn" title="Move slide up" aria-label="Move slide up" onClick={() => moveTo(sel, sel - 1)}>
                  <ArrowUp size={14} />
                </button>
                <button className="icon-btn" title="Move slide down" aria-label="Move slide down" onClick={() => moveTo(sel, sel + 1)}>
                  <ArrowDown size={14} />
                </button>
                <button className="icon-btn" title="Duplicate slide" aria-label="Duplicate slide" onClick={duplicateSlide}>
                  <Copy size={14} />
                </button>
                <button className="icon-btn" title={s.hidden ? 'Show this slide when presenting' : 'Hide: skip this slide when presenting'} aria-label="Hide slide" onClick={() => edit({ hidden: !s.hidden })}>
                  {s.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
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
            )}
          </aside>
        )}
      </div>
      {presenting && show.length > 0 && <Presenter show={show} start={presenting.start} width={W} theme={theme} presenterView={presenting.notes} onClose={() => setPresenting(null)} />}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="ld-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function Num({ label, value, onChange, min }: { label: string; value: number; onChange(v: number): void; min?: number }) {
  return (
    <label className="pi-num-field">
      <span>{label}</span>
      <input className="input" type="number" value={Math.round(value)} min={min} onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
    </label>
  )
}

function Colour({ label, value, onChange, none }: { label: string; value: string | undefined; onChange(v: string | undefined): void; none?: boolean }) {
  const off = !value || value === 'none'
  return (
    <label className="pi-colour">
      <span>{label}</span>
      <input type="color" value={off ? '#000000' : value} onChange={(e) => onChange(e.target.value)} disabled={off && none} />
      {none && (
        <input type="checkbox" title="Use this colour" checked={!off} onChange={(e) => onChange(e.target.checked ? '#888888' : 'none')} />
      )}
    </label>
  )
}

function SlidePanel({ s, ctx, root, edit, entities, onUnlock }: { s: Slide; ctx: ExpandContext; root: string | null; edit(p: Partial<Slide>): void; entities: Record<EntityType, Entity[]>; onUnlock(): void }) {
  return (
    <>
      <strong className="pi-side-title">Slide</strong>
      <Field label="Layout">
        <select className="input" value={s.layout} onChange={(e) => edit({ layout: e.target.value as Layout })}>
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </Field>
      {s.layout !== 'blank' && (
        <>
          <Field label="Title">
            <input className="input" value={s.title} onChange={(e) => edit({ title: e.target.value })} />
          </Field>
          {(s.layout === 'title' || s.layout === 'text' || s.layout === 'image') && (
            <Field label="Text">
              <textarea className="input" rows={5} value={s.text} onChange={(e) => edit({ text: e.target.value })} />
            </Field>
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
              <Field label="Show">
                <select className="input" value={s.entityType} onChange={(e) => edit({ entityType: e.target.value as EntityType, entityIds: [] })}>
                  {(['character', 'item', 'town', 'enemy'] as const).map((t) => (
                    <option key={t} value={t}>
                      {ENTITY_LABELS[t].many}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="pi-picks">
                {(entities[s.entityType] ?? []).map((e) => (
                  <label key={e.id} className="ld-inline">
                    <input type="checkbox" checked={s.entityIds.includes(e.id)} onChange={(ev) => edit({ entityIds: ev.target.checked ? [...s.entityIds, e.id] : s.entityIds.filter((x) => x !== e.id) })} />
                    {e.name || 'Untitled'}
                  </label>
                ))}
              </div>
            </>
          )}
          <button className="btn" onClick={onUnlock} title="Turn the layout into normal text boxes and pictures you can move, resize and style. Pillars and characters stop updating from the project.">
            <Unlock size={14} /> Unlock layout to edit freely
          </button>
        </>
      )}
      <div className="pi-row">
        <Colour label="Background" value={s.bg || ctx.theme.bg} onChange={(v) => edit({ bg: v })} />
        {s.bg && (
          <button className="btn btn-ghost" onClick={() => edit({ bg: undefined })}>
            Theme colour
          </button>
        )}
      </div>
      {root && (
        <div className="pi-row">
          <button
            className="btn"
            onClick={async () => {
              const [a] = await pickAndImportAssets(root, 'image', 'Background picture')
              if (a) edit({ bgImage: a.path })
            }}
          >
            <ImagePlus size={14} /> {s.bgImage ? 'Change background picture' : 'Background picture'}
          </button>
          {s.bgImage && (
            <button className="icon-btn" title="Remove background picture" aria-label="Remove background picture" onClick={() => edit({ bgImage: null })}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}
      <Field label="Transition into this slide">
        <select className="input" value={s.transition ?? 'none'} onChange={(e) => edit({ transition: e.target.value as Transition })}>
          {TRANSITIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Speaker notes (only you see them, in presenter view)">
        <textarea className="input" rows={5} value={s.notes ?? ''} onChange={(e) => edit({ notes: e.target.value })} />
      </Field>
      <p className="muted pi-tip">Tip: click something on the slide to style it. Double-click a text to type in it. Drop pictures onto the slide.</p>
    </>
  )
}

function ObjectPanel({ o, builds, onPatch, root }: { o: Obj; builds: Obj[]; onPatch(p: Partial<Obj>): void; root: string | null }) {
  const hasText = o.kind === 'text' || o.kind === 'shape'
  const line = o.shape === 'line' || o.shape === 'arrow'
  const n = builds.findIndex((b) => b.id === o.id)
  return (
    <>
      <strong className="pi-side-title">{o.kind === 'text' ? 'Text box' : o.kind === 'image' ? 'Picture' : 'Shape'}</strong>
      {o.kind === 'shape' && (
        <Field label="Shape">
          <select className="input" value={o.shape ?? 'rect'} onChange={(e) => onPatch({ shape: e.target.value as ShapeKind })}>
            {SHAPES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {hasText && !line && (
        <>
          <Field label="Text">
            <textarea className="input" rows={4} value={o.text ?? ''} onChange={(e) => onPatch({ text: e.target.value })} />
          </Field>
          <div className="pi-row">
            <select className="input" title="Font" value={o.font ?? ''} onChange={(e) => onPatch({ font: e.target.value || undefined })}>
              <option value="">Theme font</option>
              {BUNDLED_FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <Num label="Size" value={o.size ?? 40} min={4} onChange={(v) => onPatch({ size: Math.max(4, v) })} />
          </div>
          <div className="pi-row pi-styles">
            <button className={`icon-btn${o.bold ? ' on' : ''}`} title="Bold" aria-label="Bold" aria-pressed={!!o.bold} onClick={() => onPatch({ bold: !o.bold })}>
              <b>B</b>
            </button>
            <button className={`icon-btn${o.italic ? ' on' : ''}`} title="Italic" aria-label="Italic" aria-pressed={!!o.italic} onClick={() => onPatch({ italic: !o.italic })}>
              <i>I</i>
            </button>
            <button className={`icon-btn${o.underline ? ' on' : ''}`} title="Underline" aria-label="Underline" aria-pressed={!!o.underline} onClick={() => onPatch({ underline: !o.underline })}>
              <u>U</u>
            </button>
            <button className={`icon-btn${o.caps ? ' on' : ''}`} title="Small caps (Kapitälchen)" aria-label="Small caps" aria-pressed={!!o.caps} onClick={() => onPatch({ caps: !o.caps })}>
              <span style={{ fontVariantCaps: 'small-caps' }}>Ab</span>
            </button>
            <button className={`icon-btn${o.bullets ? ' on' : ''}`} title="Bullet list (one line = one point)" aria-label="Bullets" aria-pressed={!!o.bullets} onClick={() => onPatch({ bullets: !o.bullets })}>
              •
            </button>
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} className={`icon-btn${(o.align ?? 'left') === a ? ' on' : ''}`} title={`Align ${a}`} aria-label={`Align ${a}`} onClick={() => onPatch({ align: a })}>
                {a === 'left' ? <AlignLeft size={14} /> : a === 'center' ? <AlignCenter size={14} /> : <AlignRight size={14} />}
              </button>
            ))}
          </div>
          <div className="pi-row">
            <Colour label="Text colour" value={o.color} onChange={(v) => onPatch({ color: v })} />
            <label className="pi-num-field">
              <span>Line spacing</span>
              <select className="input" value={o.lineHeight ?? 1.2} onChange={(e) => onPatch({ lineHeight: Number(e.target.value) })}>
                {[1, 1.2, 1.35, 1.5, 2].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
      {o.kind === 'image' && (
        <>
          {root && (
            <button
              className="btn"
              onClick={async () => {
                const [a] = await pickAndImportAssets(root, 'image', 'Picture for the slide')
                if (a) onPatch({ image: a.path })
              }}
            >
              <ImagePlus size={14} /> Change picture
            </button>
          )}
          <Field label="Fit">
            <select className="input" value={o.fit ?? 'contain'} onChange={(e) => onPatch({ fit: e.target.value as Obj['fit'] })}>
              <option value="contain">Whole picture</option>
              <option value="cover">Fill the box (crop)</option>
            </select>
          </Field>
        </>
      )}
      {o.kind !== 'image' && (
        <div className="pi-row">
          {!line && <Colour label="Fill" value={o.fill} none onChange={(v) => onPatch({ fill: v })} />}
          <Colour label="Outline" value={o.stroke} none={!line} onChange={(v) => onPatch({ stroke: v })} />
          <Num label="Width" value={o.strokeW ?? (o.kind === 'shape' ? 4 : 0)} min={0} onChange={(v) => onPatch({ strokeW: Math.max(0, v) })} />
        </div>
      )}
      <div className="pi-row pi-xywh">
        <Num label="X" value={o.x} onChange={(v) => onPatch({ x: v })} />
        <Num label="Y" value={o.y} onChange={(v) => onPatch({ y: v })} />
        <Num label="W" value={o.w} onChange={(v) => onPatch({ w: v })} />
        <Num label="H" value={o.h} onChange={(v) => onPatch({ h: v })} />
        <Num label="Turn°" value={o.rot ?? 0} onChange={(v) => onPatch({ rot: ((v % 360) + 360) % 360 })} />
      </div>
      <Field label={n >= 0 ? `Comes in when presenting (step ${n + 1})` : 'Comes in when presenting'}>
        <select className="input" value={o.build ?? 'none'} onChange={(e) => onPatch({ build: e.target.value as Build })}>
          {BUILDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </Field>
    </>
  )
}

/** Several objects picked: line them up. */
function MultiPanel({ objs, width, onPatch }: { objs: Obj[]; width: number; onPatch(changed: Obj[]): void }) {
  const minX = Math.min(...objs.map((o) => o.x))
  const maxX = Math.max(...objs.map((o) => o.x + o.w))
  const minY = Math.min(...objs.map((o) => o.y))
  const maxY = Math.max(...objs.map((o) => o.y + o.h))
  const move = (fn: (o: Obj) => Partial<Obj>) => onPatch(objs.filter((o) => !o.locked).map((o) => ({ ...o, ...fn(o) })))
  return (
    <>
      <strong className="pi-side-title">{objs.length} things picked</strong>
      <span className="muted">Line them up</span>
      <div className="pi-row pi-styles">
        <button className="btn" onClick={() => move(() => ({ x: minX }))}>Left</button>
        <button className="btn" onClick={() => move((o) => ({ x: Math.round((minX + maxX) / 2 - o.w / 2) }))}>Centre</button>
        <button className="btn" onClick={() => move((o) => ({ x: maxX - o.w }))}>Right</button>
      </div>
      <div className="pi-row pi-styles">
        <button className="btn" onClick={() => move(() => ({ y: minY }))}>Top</button>
        <button className="btn" onClick={() => move((o) => ({ y: Math.round((minY + maxY) / 2 - o.h / 2) }))}>Middle</button>
        <button className="btn" onClick={() => move((o) => ({ y: maxY - o.h }))}>Bottom</button>
      </div>
      <div className="pi-row pi-styles">
        <button className="btn" onClick={() => move((o) => ({ x: Math.round(width / 2 - o.w / 2) }))}>Centre on slide</button>
        <button
          className="btn"
          disabled={objs.length < 3}
          title="Same space between them, left to right"
          onClick={() => {
            const sorted = [...objs].sort((a, b) => a.x - b.x)
            const gap = (maxX - minX - sorted.reduce((t, o) => t + o.w, 0)) / (sorted.length - 1)
            let x = minX
            onPatch(sorted.map((o) => {
              const next = { ...o, x: Math.round(x) }
              x += o.w + gap
              return next
            }))
          }}
        >
          Spread evenly
        </button>
      </div>
    </>
  )
}
