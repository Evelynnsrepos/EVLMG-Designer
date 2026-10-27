import { Bold, ChevronLeft, ChevronRight, Copy, Image as ImageIcon, Italic, PanelRight, Plus, Trash, Type } from 'lucide-react'
import { zipSync } from 'fflate'
import { useEffect, useMemo, useRef, useState } from 'react'
import { assetUrl, pickAndImportAssets, useAssetUrls } from '@/core/assets'
import { saveBinaryFile, saveTextFile, safeFileName } from '@/core/export'
import { newId, type Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore } from '@/core/state'
import {
  CanvasEditor,
  ellipseTool,
  handTool,
  lineTool,
  rectTool,
  resolveActiveLayer,
  selectTool,
  updateNodes,
  useCanvasState,
  type CanvasApi,
  type CanvasTool,
  type Scene,
} from '@/shared/canvas'
import { confirmDialog, promptDialog } from '@/shared/dialogs'
import { cssFamily, systemFonts } from '@/shared/fontList'
import { LayersPanel } from '@/shared/moodboard/LayersPanel'
import type { MoodNode } from '@/shared/moodboard/model'
import '@/shared/moodboard/moodboard.css'
import { canvasBytes, drawSheets, PAGE_SIZES, sheetLayout, sheetsToPdf } from '@/shared/print'
import {
  CARD_SIZES,
  cardsFromSheet,
  createCardDoc,
  deckJson,
  DEFAULT_FONT,
  expandCopies,
  MM,
  renameFieldInScene,
  slotColors,
  type Card,
  type CardDoc,
  type CardImageNode,
  type CardNode,
  type CardTextNode,
  type Field,
  type SheetLike,
  type SlotKeys,
} from './model'
import { BUILTIN_ICONS } from './icons'
import { cardNodeTypes } from './nodeTypes'
import { evaluatedSheet } from './sheetValues'
import { loadSceneFonts, preloadImages, renderCard } from './render'
import './card-designer.css'

const TEXT = {
  front: 'Front',
  back: 'Back',
  tabs: { deck: 'Deck', style: 'Style', colors: 'Colours', card: 'Card', export: 'Export' },
  layers: 'Layers panel',
  addText: 'Text (T): click on the card to type. {Name} shows the card’s value for the field Name.',
  addPicture: 'Add a picture field: shows each card’s picture',
  addImage: 'Add a fixed image (the same on every card)',
  fixed: 'Fixed colour',
  noSelection: 'Select something on the card to style it. Only the active layer can be selected; Alt+click picks an item on another layer.',
  sheetHint: 'Row 1 holds the field names. Columns named Copies and Variant set those.',
  exportHint: 'Print at "actual size" (100 %), not "fit to page". For double-sided printing, flip on the long edge.',
}

type Tab = keyof typeof TEXT.tabs
type Side = 'front' | 'back'

const card = (d: CardDoc, side: Side) => (side === 'front' ? d.front : d.back)

/** Card Designer (0.22): layered card templates, colour slots, a deck and print/JSON export. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<CardDoc>('card-designer', documentId!, createCardDoc)
  const root = useProjectStore((s) => s.root)
  const title = useProjectStore((s) => s.meta?.documents.find((x) => x.id === documentId)?.title) ?? 'Cards'
  const canvas = useCanvasState()
  const apiRef = useRef<CanvasApi<CardNode> | null>(null)
  const [side, setSide] = useState<Side>('front')
  const [tab, setTab] = useState<Tab>('deck')
  const [showLayers, setShowLayers] = useState(true)
  const [previewId, setPreviewId] = useState<Id | null>(null)
  const [sheetCards, setSheetCards] = useState<Card[] | null>(null)
  const [fontsReady, setFontsReady] = useState(0)
  const d = doc.data

  const cards = useMemo(() => (d?.sheet ? (sheetCards ?? []) : (d?.cards ?? [])), [d?.sheet, d?.cards, sheetCards])
  const preview = cards.find((c) => c.id === previewId) ?? cards[0] ?? null
  const scene = d ? card(d, side) : null

  const imagePaths = useMemo(() => {
    if (!d) return []
    const fieldIds = new Set(d.fields.filter((f) => f.kind === 'image').map((f) => f.id))
    const fromCards = cards.flatMap((c) => Object.entries(c.values).filter(([k]) => fieldIds.has(k)).map(([, v]) => v))
    const fixed = [...d.front.nodes, ...d.back.nodes].flatMap((n) => (n.kind === 'image' ? [n.src] : [])).concat((d.icons ?? []).map((i) => i.src))
    return [...fromCards, ...fixed]
  }, [d, cards])
  const resolve = useAssetUrls(imagePaths)

  const types = useMemo(
    () => (d ? cardNodeTypes({ colors: slotColors(d, preview?.variantId), fields: d.fields, values: preview?.values ?? null, icons: ownIcons(d) }) : {}),
    // fontsReady: new renderers redraw the text once a font has loaded.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [d, preview, fontsReady],
  )

  // Fonts load on first use; draw again once they are there.
  const fontKey = d ? [...d.front.nodes, ...d.back.nodes].map((n) => (n.kind === 'card-text' ? n.fontFamily : '')).join() : ''
  useEffect(() => {
    if (!d) return
    void loadSceneFonts([d.front, d.back]).then(() => setFontsReady((n) => n + 1))
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only when the fonts used change
  }, [fontKey])

  const tools = useMemo<CanvasTool<CardNode>[]>(() => {
    const ink = () => ({ strokeColor: '#1c1d22', strokeWidth: 6 })
    return [selectTool, handTool, rectTool({ defaults: ink }), ellipseTool({ defaults: ink }), lineTool({ defaults: ink }), cardTextTool] as CanvasTool<CardNode>[]
  }, [])

  const index = preview ? cards.indexOf(preview) : -1
  const step = (dir: number) => cards.length && setPreviewId(cards[(index + dir + cards.length) % cards.length].id)
  // Page Up / Page Down switch cards while the deck is open.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown') return
      e.preventDefault()
      step(e.key === 'PageDown' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!d || !scene) return null

  const update = (recipe: (x: CardDoc) => CardDoc, options?: { undoable?: boolean }) => doc.update(recipe, options)
  const onScene = (recipe: (s: Scene<CardNode>) => Scene<CardNode>, options?: { undoable?: boolean }) =>
    update((x) => ({ ...x, [side]: recipe(card(x, side)) }), options)

  const activeLayerId = resolveActiveLayer(scene, canvas.activeLayerId)
  const selected = scene.nodes.filter((n) => canvas.selection.includes(n.id))

  const addPictureField = () => {
    const f = d.fields.find((x) => x.kind === 'image')
    const fieldId = f?.id ?? newId()
    const node: CardImageNode = { id: newId(), kind: 'card-image', layerId: activeLayerId, x: 60, y: 120, width: d.widthMm * MM - 120, height: 300, fieldId }
    update((x) => ({ ...x, fields: f ? x.fields : [...x.fields, { id: fieldId, name: 'Art', kind: 'image' }], [side]: { ...card(x, side), nodes: [...card(x, side).nodes, node] } }))
    canvas.setSelection([node.id])
  }
  const addFixedImage = async () => {
    if (!root) return
    const layerId = activeLayerId
    const picked = await pickAndImportAssets(root, 'image')
    if (!picked.length) return
    const nodes: CardNode[] = picked.map((a, i) => ({ id: newId(), kind: 'image', layerId, x: 40 + i * 20, y: 40 + i * 20, width: 200, height: 200, src: a.path, name: a.name }))
    onScene((s) => ({ ...s, nodes: [...s.nodes, ...nodes] }))
    canvas.setSelection(nodes.map((n) => n.id))
  }

  const toolbarExtra = (
    <>
      <button className="canvas-toolbar-btn" title={TEXT.addPicture} aria-label={TEXT.addPicture} onClick={addPictureField}>
        <ImageIcon size={17} strokeWidth={1.8} />
      </button>
      <button className="canvas-toolbar-btn" title={TEXT.addImage} aria-label={TEXT.addImage} onClick={() => void addFixedImage()}>
        <Plus size={17} strokeWidth={1.8} />
      </button>
      <button className={'canvas-toolbar-btn' + (showLayers ? ' is-active' : '')} title={TEXT.layers} aria-label={TEXT.layers} aria-pressed={showLayers} onClick={() => setShowLayers((v) => !v)}>
        <PanelRight size={17} strokeWidth={1.8} />
      </button>
    </>
  )

  const b = d.bleedMm * MM
  const guides = () => (
    <>
      <div className="cd-guide cd-bleed" style={{ left: -b, top: -b, width: d.widthMm * MM + 2 * b, height: d.heightMm * MM + 2 * b }} />
      <div className="cd-guide cd-trim" style={{ left: 0, top: 0, width: d.widthMm * MM, height: d.heightMm * MM, borderRadius: d.cornerMm * MM }} />
      <div className="cd-guide cd-safe" style={{ left: 30, top: 30, width: d.widthMm * MM - 60, height: d.heightMm * MM - 60 }} />
    </>
  )

  return (
    <div className="cd-root">
      {d.sheet ? <LinkedSheet link={d.sheet} fields={d.fields} variants={d.variants} onCards={setSheetCards} /> : null}
      <div className="cd-canvas">
        <div className="cd-sides" role="tablist">
          {(['front', 'back'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={side === s} className={'btn btn-ghost' + (side === s ? ' is-on' : '')} onClick={() => (setSide(s), canvas.setSelection([]), canvas.setActiveLayerId(null))}>
              {s === 'front' ? TEXT.front : TEXT.back}
            </button>
          ))}
          <span className="cd-previewing">
            <button className="btn btn-ghost" title="Previous card (Page Up)" aria-label="Previous card" disabled={cards.length < 2} onClick={() => step(-1)}>
              <ChevronLeft size={16} />
            </button>
            <select className="input" value={preview?.id ?? ''} aria-label="Card shown" title="The card shown on the canvas" onChange={(e) => setPreviewId(e.target.value)}>
              {cards.map((c, i) => (
                <option key={c.id} value={c.id}>
                  {i + 1}. {cardLabel(d, c)}
                </option>
              ))}
            </select>
            <button className="btn btn-ghost" title="Next card (Page Down)" aria-label="Next card" disabled={cards.length < 2} onClick={() => step(1)}>
              <ChevronRight size={16} />
            </button>
            <button className="btn" disabled={!!d.sheet} title={d.sheet ? 'Cards come from the linked Spreadsheet: add a row there' : 'Add a new card to the deck (same design, its own values)'} onClick={() => setPreviewId(addCard(d, update))}>
              <Plus size={14} /> Card
            </button>
          </span>
        </div>
        <CanvasEditor<CardNode>
          key={side}
          scene={scene}
          onChange={onScene}
          onUndo={doc.undo}
          onRedo={doc.redo}
          canUndo={doc.canUndo}
          canRedo={doc.canRedo}
          active={active}
          tools={tools}
          nodeTypes={types}
          canvas={canvas}
          apiRef={apiRef}
          resolveImageSrc={resolve}
          toolbarExtra={toolbarExtra}
          html={guides}
          grid={false}
          layerScoped
          ariaLabel="Card"
        />
      </div>
      <aside className="cd-side">
        <div className="cd-tabs" role="tablist">
          {(Object.keys(TEXT.tabs) as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={'cd-tab' + (tab === t ? ' is-on' : '')} onClick={() => setTab(t)}>
              {TEXT.tabs[t]}
            </button>
          ))}
        </div>
        <div className="cd-tab-body">
          {tab === 'deck' && <DeckPanel d={d} cards={cards} previewId={preview?.id ?? null} onPreview={setPreviewId} update={update} />}
          {tab === 'style' && <StylePanel d={d} selected={selected} onScene={onScene} />}
          {tab === 'colors' && <ColorsPanel d={d} update={update} onScene={onScene} activeLayerId={activeLayerId} side={side} />}
          {tab === 'card' && <CardPanel d={d} update={update} />}
          {tab === 'export' && <ExportPanel d={d} title={title} cards={cards} root={root} />}
        </div>
      </aside>
      {showLayers ? (
        <LayersPanel
          doc={{ scene: scene as unknown as Scene<MoodNode> }}
          onChange={(r) => onScene(r as unknown as (s: Scene<CardNode>) => Scene<CardNode>)}
          selection={canvas.selection}
          onSelect={(ids, mode) => {
            // Picking an item in the panel makes its layer the active one (only that layer can be edited).
            const n = scene.nodes.find((x) => x.id === ids[0])
            if (n && n.layerId !== activeLayerId) {
              canvas.setActiveLayerId(n.layerId)
              canvas.setSelection(ids)
            } else canvas.setSelection(mode === 'toggle' ? [...canvas.selection.filter((x) => !ids.includes(x)), ...ids.filter((x) => !canvas.selection.includes(x))] : ids)
          }}
          activeLayerId={activeLayerId}
          onActiveLayer={(id) => (canvas.setActiveLayerId(id), canvas.setSelection([]))}
          onClose={() => setShowLayers(false)}
        />
      ) : null}
    </div>
  )
}

/** Text tool (T): click to type a new text box; click a text box to edit it. */
const cardTextTool: CanvasTool<CardNode> = {
  id: 'card-text',
  label: 'Text',
  icon: Type,
  shortcut: 'T',
  cursor: 'text',
  pointerDown(e, api) {
    if (e.button !== 0) return
    const hit = e.targetId ? api.scene.nodes.find((n) => n.id === e.targetId) : undefined
    if (hit?.kind === 'card-text') {
      api.select([hit.id])
      api.editText(hit.id)
      return
    }
    const node: CardTextNode = { id: newId(), kind: 'card-text', layerId: api.activeLayerId, x: e.world.x, y: e.world.y, width: 300, height: 60, text: '', fontSize: 32, fontFamily: DEFAULT_FONT, textColor: '#1c1d22' }
    api.editText(node.id, node)
  },
}

/** Own icons by name for `:name:` in text. */
const ownIcons = (d: CardDoc) => new Map((d.icons ?? []).map((i) => [i.name, i.src]))

function cardLabel(d: CardDoc, c: Card): string {
  const first = d.fields.find((f) => f.kind === 'text')
  return (first && c.values[first.id]) || 'Card'
}

/** Adds an empty card named "Card N" and returns its id. */
function addCard(d: CardDoc, update: Update): Id {
  const id = newId()
  const name = d.fields.find((f) => f.kind === 'text')
  update((x) => ({ ...x, cards: [...x.cards, { id, copies: 1, values: name ? { [name.id]: `Card ${x.cards.length + 1}` } : {} }] }))
  return id
}

/** Reads a linked Spreadsheet sheet and hands its rows up as cards. Mounted only while a sheet is linked. */
function LinkedSheet({ link, fields, variants, onCards }: { link: NonNullable<CardDoc['sheet']>; fields: Field[]; variants: CardDoc['variants']; onCards(c: Card[] | null): void }) {
  const wb = useDocument<{ sheets: SheetLike[] }>('spreadsheet', link.documentId, () => ({ sheets: [] })).data
  const sheet = wb?.sheets.find((s) => s.id === link.sheetId) ?? wb?.sheets[0]
  const cards = useMemo(() => (sheet && wb ? cardsFromSheet(evaluatedSheet(wb.sheets, sheet), fields, variants) : null), [wb, sheet, fields, variants])
  useEffect(() => {
    onCards(cards)
    return () => onCards(null)
  }, [cards, onCards])
  return null
}

type Update = (recipe: (x: CardDoc) => CardDoc, options?: { undoable?: boolean }) => void
type OnScene = (recipe: (s: Scene<CardNode>) => Scene<CardNode>) => void

function DeckPanel({ d, cards, previewId, onPreview, update }: { d: CardDoc; cards: Card[]; previewId: Id | null; onPreview(id: Id): void; update: Update }) {
  const spreadsheets = (useProjectStore((s) => s.meta?.documents) ?? []).filter((x) => x.type === 'spreadsheet')
  const linked = !!d.sheet
  const setCard = (id: Id, patch: Partial<Card>) => update((x) => ({ ...x, cards: x.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  const setValue = (c: Card, fieldId: Id, v: string) => setCard(c.id, { values: { ...c.values, [fieldId]: v } })
  const root = useProjectStore((s) => s.root)
  const pickImage = async (c: Card, f: Field) => {
    if (!root) return
    const [a] = await pickAndImportAssets(root, 'image')
    if (a) setValue(c, f.id, a.path)
  }
  const renameField = (f: Field, name: string) =>
    update((x) => ({
      ...x,
      fields: x.fields.map((y) => (y.id === f.id ? { ...y, name } : y)),
      front: renameFieldInScene(x.front, f.name, name),
      back: renameFieldInScene(x.back, f.name, name),
    }))
  const total = expandCopies(cards).length
  const addIcon = async () => {
    if (!root) return
    const [a] = await pickAndImportAssets(root, 'image')
    if (!a) return
    const name = (await promptDialog('Icon name (type it as :name: in text)', a.name.replace(/\.[^.]+$/, '')))?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
    if (name) update((x) => ({ ...x, icons: [...(x.icons ?? []).filter((i) => i.name !== name), { id: newId(), name, src: a.path }] }))
  }

  return (
    <div className="cd-panel">
      <h4>Fields</h4>
      {d.fields.map((f) => (
        <div key={f.id} className="cd-row">
          <input className="input" value={f.name} aria-label="Field name" onChange={(e) => renameField(f, e.target.value)} />
          <select className="input cd-kind" value={f.kind} aria-label="Field type" onChange={(e) => update((x) => ({ ...x, fields: x.fields.map((y) => (y.id === f.id ? { ...y, kind: e.target.value as Field['kind'] } : y)) }))}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="image">Picture</option>
          </select>
          <button className="btn btn-ghost" title="Delete field" aria-label="Delete field" onClick={() => update((x) => ({ ...x, fields: x.fields.filter((y) => y.id !== f.id) }))}>
            <Trash size={14} />
          </button>
        </div>
      ))}
      <div className="cd-row">
        <button className="btn" onClick={() => update((x) => ({ ...x, fields: [...x.fields, { id: newId(), name: `Field ${x.fields.length + 1}`, kind: 'text' }] }))}>
          + Text field
        </button>
        <button className="btn" onClick={() => update((x) => ({ ...x, fields: [...x.fields, { id: newId(), name: `Stat ${x.fields.length + 1}`, kind: 'number' }] }))}>
          + Number field
        </button>
        <button className="btn" onClick={() => update((x) => ({ ...x, fields: [...x.fields, { id: newId(), name: `Picture ${x.fields.length + 1}`, kind: 'image' }] }))}>
          + Picture field
        </button>
      </div>

      <div className="cd-row">
        <h4>Cards ({total} to print)</h4>
        {linked ? null : (
          <button className="btn" onClick={() => onPreview(addCard(d, update))}>
            + Card
          </button>
        )}
      </div>
      <p className="cd-muted">Every card uses the design on the left; each row fills in its own values. Click a row to see that card.</p>
      <label className="cd-row">
        From Spreadsheet
        <select
          className="input"
          value={d.sheet?.documentId ?? ''}
          onChange={(e) => update((x) => ({ ...x, sheet: e.target.value ? { documentId: e.target.value, sheetId: '' } : undefined }))}
        >
          <option value="">No, edit cards here</option>
          {spreadsheets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      {linked ? <p className="cd-muted">{TEXT.sheetHint}</p> : null}
      <div className="cd-table-wrap">
        <table className="cd-table">
          <thead>
            <tr>
              {d.fields.map((f) => (
                <th key={f.id}>{f.name}</th>
              ))}
              <th>Copies</th>
              {d.variants.length ? <th>Variant</th> : null}
              {linked ? null : <th />}
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id} className={c.id === previewId ? 'is-on' : ''} onFocus={() => onPreview(c.id)} onClick={() => onPreview(c.id)}>
                {d.fields.map((f) => (
                  <td key={f.id}>
                    {f.kind === 'image' ? (
                      <button className="btn btn-ghost" disabled={linked} title={c.values[f.id] || 'Pick a picture'} onClick={() => void pickImage(c, f)}>
                        {c.values[f.id] ? '🖼' : '+'}
                      </button>
                    ) : (
                      <input
                        className={'input' + (f.kind === 'number' ? ' cd-num' : '')}
                        type={f.kind === 'number' && !linked ? 'number' : 'text'}
                        readOnly={linked}
                        value={c.values[f.id] ?? ''}
                        aria-label={f.name}
                        onChange={(e) => setValue(c, f.id, e.target.value)}
                      />
                    )}
                  </td>
                ))}
                <td>
                  <input className="input cd-num" type="number" min={0} readOnly={linked} value={c.copies} aria-label="Copies" onChange={(e) => setCard(c.id, { copies: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                </td>
                {d.variants.length ? (
                  <td>
                    <select className="input" disabled={linked} value={c.variantId ?? ''} aria-label="Variant" onChange={(e) => setCard(c.id, { variantId: e.target.value || undefined })}>
                      <option value="">Base</option>
                      {d.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </td>
                ) : null}
                {linked ? null : (
                  <td className="cd-nowrap">
                    <button className="btn btn-ghost" title="Duplicate card" aria-label="Duplicate card" onClick={() => update((x) => ({ ...x, cards: x.cards.flatMap((y) => (y.id === c.id ? [y, { ...y, id: newId() }] : [y])) }))}>
                      <Copy size={14} />
                    </button>
                    <button className="btn btn-ghost" title="Delete card" aria-label="Delete card" onClick={() => update((x) => ({ ...x, cards: x.cards.filter((y) => y.id !== c.id) }))}>
                      <Trash size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4>Icons</h4>
      <p className="cd-muted">Type :name: in any text to show an icon in the text colour. Click a name to copy it.</p>
      <div className="cd-icons">
        {Object.keys(BUILTIN_ICONS).map((name) => (
          <button key={name} className="cd-icon-chip" title={`Copy :${name}:`} onClick={() => void navigator.clipboard?.writeText(`:${name}:`)}>
            :{name}:
          </button>
        ))}
        {(d.icons ?? []).map((i) => (
          <span key={i.id} className="cd-icon-chip">
            :{i.name}:
            <button className="btn btn-ghost" title="Delete icon" aria-label={`Delete icon ${i.name}`} onClick={() => update((x) => ({ ...x, icons: (x.icons ?? []).filter((y) => y.id !== i.id) }))}>
              <Trash size={12} />
            </button>
          </span>
        ))}
      </div>
      <button className="btn" onClick={() => void addIcon()}>
        + Own icon (picture)
      </button>
    </div>
  )
}

/** Colour of a node for the Style panel's pickers. */
const colorOf = (n: CardNode, key: 'fillColor' | 'strokeColor' | 'textColor') => ((n as unknown as Record<string, string | undefined>)[key] ?? '#000000').slice(0, 7)
const slotKey = { fillColor: 'fillSlotId', strokeColor: 'strokeSlotId', textColor: 'textSlotId' } as const

function StylePanel({ d, selected, onScene }: { d: CardDoc; selected: CardNode[]; onScene: OnScene }) {
  if (!selected.length) return <p className="cd-muted cd-panel">{TEXT.noSelection}</p>
  const ids = selected.map((n) => n.id)
  const patch = (fn: (n: CardNode) => CardNode) => onScene((s) => updateNodes(s, ids, fn))
  const texts = selected.filter((n): n is CardTextNode => n.kind === 'card-text')
  const shapes: CardNode[] = selected.filter((n) => n.kind === 'rect' || n.kind === 'ellipse' || n.kind === 'line')
  const pictures = selected.filter((n): n is CardImageNode => n.kind === 'card-image')
  const t = texts[0]

  const colorRow = (label: string, key: 'fillColor' | 'strokeColor' | 'textColor', nodes: CardNode[]) => {
    const first = nodes[0] as CardNode & SlotKeys & { textSlotId?: Id }
    const slot = first[slotKey[key]]
    return (
      <div className="cd-row">
        <span className="cd-label">{label}</span>
        <select
          className="input"
          value={slot ?? ''}
          aria-label={`${label} colour slot`}
          onChange={(e) => {
            const id = e.target.value || undefined
            const color = d.slots.find((s) => s.id === id)?.color
            patch((n) => (nodes.includes(n) ? { ...n, [slotKey[key]]: id, ...(color ? { [key]: color } : {}) } : n))
          }}
        >
          <option value="">{TEXT.fixed}</option>
          {d.slots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {slot ? null : (
          <input type="color" aria-label={`${label} colour`} value={colorOf(first, key)} onChange={(e) => patch((n) => (nodes.includes(n) ? { ...n, [key]: e.target.value } : n))} />
        )}
      </div>
    )
  }

  const foil = selected.every((n) => n.foil)
  return (
    <div className="cd-panel">
      <label className="cd-row" title="Printed in shiny foil. Shows a shine here; export the foil mask for the print shop.">
        <input type="checkbox" checked={foil} onChange={() => patch((n) => ({ ...n, foil: !foil || undefined }))} />
        Foil
      </label>
      {t ? (
        <>
          <h4>Text</h4>
          <select className="input" value={t.fontFamily} aria-label="Font" style={{ fontFamily: cssFamily(t.fontFamily) }} onChange={(e) => patch((n) => (n.kind === 'card-text' ? { ...n, fontFamily: e.target.value } : n))}>
            {[...new Set([t.fontFamily, ...systemFonts()])].map((f) => (
              <option key={f} value={f} style={{ fontFamily: cssFamily(f) }}>
                {f}
              </option>
            ))}
          </select>
          <div className="cd-row">
            <input className="input cd-num" type="number" min={4} aria-label="Font size" value={Math.round(t.fontSize)} onChange={(e) => patch((n) => (n.kind === 'card-text' ? { ...n, fontSize: Math.max(4, Number(e.target.value) || 4) } : n))} />
            <button className={'btn btn-ghost' + (t.bold ? ' is-on' : '')} aria-pressed={!!t.bold} title="Bold" onClick={() => patch((n) => (n.kind === 'card-text' ? { ...n, bold: !t.bold || undefined } : n))}>
              <Bold size={14} />
            </button>
            <button className={'btn btn-ghost' + (t.italic ? ' is-on' : '')} aria-pressed={!!t.italic} title="Italic" onClick={() => patch((n) => (n.kind === 'card-text' ? { ...n, italic: !t.italic || undefined } : n))}>
              <Italic size={14} />
            </button>
            <select className="input" value={t.align ?? 'left'} aria-label="Align" onChange={(e) => patch((n) => (n.kind === 'card-text' ? { ...n, align: e.target.value as CardTextNode['align'] } : n))}>
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </div>
          {colorRow('Text', 'textColor', texts)}
          <p className="cd-muted">Long text shrinks to fit its box. Drag the box handles to change its size. Type :sword:, :heart:, :mana: and other icon names (listed in the Deck tab) to put icons in the text.</p>
        </>
      ) : null}
      {shapes.length ? (
        <>
          <h4>Shape</h4>
          {shapes.some((n) => n.kind !== 'line') ? colorRow('Fill', 'fillColor', shapes.filter((n) => n.kind !== 'line')) : null}
          {colorRow('Outline', 'strokeColor', shapes)}
          <label className="cd-row">
            <span className="cd-label">Outline width</span>
            <input className="input cd-num" type="number" min={0} value={(shapes[0] as { strokeWidth?: number }).strokeWidth ?? 2} onChange={(e) => patch((n) => (shapes.includes(n) ? { ...n, strokeWidth: Math.max(0, Number(e.target.value) || 0) } : n))} />
          </label>
        </>
      ) : null}
      {pictures.length ? (
        <>
          <h4>Picture field</h4>
          <select className="input" value={pictures[0].fieldId} aria-label="Picture field" onChange={(e) => patch((n) => (n.kind === 'card-image' ? { ...n, fieldId: e.target.value } : n))}>
            {d.fields
              .filter((f) => f.kind === 'image')
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </>
      ) : null}
    </div>
  )
}

function ColorsPanel({ d, update, onScene, activeLayerId, side }: { d: CardDoc; update: Update; onScene: OnScene; activeLayerId: Id | undefined; side: Side }) {
  const [layerSlot, setLayerSlot] = useState<Id | ''>('')
  const [layerColor, setLayerColor] = useState('#000000')
  const layer = card(d, side).layers.find((l) => l.id === activeLayerId)
  const setSlot = (id: Id, patch: Partial<CardDoc['slots'][number]>) => {
    update((x) => {
      const slots = x.slots.map((s) => (s.id === id ? { ...s, ...patch } : s))
      if (!patch.color) return { ...x, slots }
      // Keep the stored colours in step, so the template looks right everywhere it is shown.
      const recolor = (s: Scene<CardNode>) => ({ ...s, nodes: s.nodes.map((n) => applySlotColor(n, id, patch.color!)) })
      return { ...x, slots, front: recolor(x.front), back: recolor(x.back) }
    })
  }
  const recolorLayer = () => {
    if (!layer || layer.locked) return
    const color = layerSlot ? d.slots.find((s) => s.id === layerSlot)!.color : layerColor
    const slot = layerSlot || undefined
    onScene((s) => ({
      ...s,
      nodes: s.nodes.map((n) => {
        if (n.layerId !== layer.id || n.locked) return n
        if (n.kind === 'card-text') return { ...n, textColor: color, textSlotId: slot }
        if (n.kind === 'line') return { ...n, strokeColor: color, strokeSlotId: slot }
        if (n.kind === 'rect' || n.kind === 'ellipse') return n.fillColor || n.fillSlotId ? { ...n, fillColor: color, fillSlotId: slot } : { ...n, strokeColor: color, strokeSlotId: slot }
        return n
      }),
    }))
  }

  const foilLayer = !!layer && card(d, side).nodes.some((n) => n.layerId === layer.id) && card(d, side).nodes.every((n) => n.layerId !== layer.id || n.foil)
  const setLayerFoil = () => {
    if (!layer || layer.locked) return
    onScene((s) => ({ ...s, nodes: s.nodes.map((n) => (n.layerId === layer.id && !n.locked ? { ...n, foil: !foilLayer || undefined } : n)) }))
  }

  return (
    <div className="cd-panel">
      <h4>Card colours</h4>
      <p className="cd-muted">The background of each side, set here even when its layer is locked.</p>
      {(['front', 'back'] as const).map((sd) => (
        <SideColor key={sd} d={d} side={sd} update={update} />
      ))}

      <h4>Colour slots</h4>
      <p className="cd-muted">Change a slot and everything using it changes on every card.</p>
      {d.slots.map((s) => (
        <div key={s.id} className="cd-row">
          <input type="color" aria-label={`${s.name} colour`} value={s.color} onChange={(e) => setSlot(s.id, { color: e.target.value })} />
          <input className="input" aria-label="Slot name" value={s.name} onChange={(e) => setSlot(s.id, { name: e.target.value })} />
          <button
            className="btn btn-ghost"
            title="Delete slot"
            aria-label="Delete slot"
            onClick={() => update((x) => ({ ...x, slots: x.slots.filter((y) => y.id !== s.id), front: dropSlot(x.front, s.id), back: dropSlot(x.back, s.id) }))}
          >
            <Trash size={14} />
          </button>
        </div>
      ))}
      <button className="btn" onClick={() => update((x) => ({ ...x, slots: [...x.slots, { id: newId(), name: `Colour ${x.slots.length + 1}`, color: '#888888' }] }))}>
        + Slot
      </button>

      <h4>Recolour layer “{layer?.name ?? ''}”</h4>
      <div className="cd-row">
        <select className="input" value={layerSlot} aria-label="Colour for the layer" onChange={(e) => setLayerSlot(e.target.value)}>
          <option value="">{TEXT.fixed}</option>
          {d.slots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {layerSlot ? null : <input type="color" aria-label="Colour" value={layerColor} onChange={(e) => setLayerColor(e.target.value)} />}
        <button className="btn" disabled={!layer || layer.locked} title={layer?.locked ? 'This layer is locked' : undefined} onClick={recolorLayer}>
          Apply
        </button>
      </div>

      <label className="cd-row" title={layer?.locked ? 'This layer is locked' : 'Everything on this layer is printed in shiny foil'}>
        <input type="checkbox" disabled={!layer || layer.locked} checked={foilLayer} onChange={setLayerFoil} />
        Foil layer (everything on “{layer?.name ?? ''}” is foil)
      </label>

      <h4>Variants</h4>
      <p className="cd-muted">Other colours for some slots, e.g. one per faction or rarity. Pick a card’s variant in the deck.</p>
      {d.variants.map((v) => (
        <div key={v.id} className="cd-variant">
          <div className="cd-row">
            <input className="input" aria-label="Variant name" value={v.name} onChange={(e) => update((x) => ({ ...x, variants: x.variants.map((y) => (y.id === v.id ? { ...y, name: e.target.value } : y)) }))} />
            <button className="btn btn-ghost" title="Delete variant" aria-label="Delete variant" onClick={() => update((x) => ({ ...x, variants: x.variants.filter((y) => y.id !== v.id), cards: x.cards.map((c) => (c.variantId === v.id ? { ...c, variantId: undefined } : c)) }))}>
              <Trash size={14} />
            </button>
          </div>
          {d.slots.map((s) => {
            const own = v.colors.find((c) => c.slotId === s.id)
            const set = (color: string | null) =>
              update((x) => ({
                ...x,
                variants: x.variants.map((y) => (y.id === v.id ? { ...y, colors: [...y.colors.filter((c) => c.slotId !== s.id), ...(color ? [{ slotId: s.id, color }] : [])] } : y)),
              }))
            return (
              <label key={s.id} className="cd-row cd-indent">
                <input type="checkbox" checked={!!own} onChange={(e) => set(e.target.checked ? s.color : null)} />
                <span className="cd-label">{s.name}</span>
                {own ? <input type="color" aria-label={`${s.name} in ${v.name}`} value={own.color} onChange={(e) => set(e.target.value)} /> : null}
              </label>
            )
          })}
        </div>
      ))}
      <button className="btn" onClick={() => update((x) => ({ ...x, variants: [...x.variants, { id: newId(), name: `Variant ${x.variants.length + 1}`, colors: [] }] }))}>
        + Variant
      </button>
    </div>
  )
}

/** The side's background: the shape named Background, else the first filled rectangle on the bottom layer. */
function backgroundOf(s: Scene<CardNode>) {
  return s.nodes.find((n) => n.name === 'Background' && n.kind === 'rect') ?? s.nodes.find((n) => n.layerId === s.layers[0]?.id && n.kind === 'rect' && n.fillColor)
}

function SideColor({ d, side, update }: { d: CardDoc; side: Side; update: Update }) {
  const bg = backgroundOf(card(d, side)) as (CardNode & SlotKeys) | undefined
  const set = (patch: { fillColor?: string; fillSlotId?: Id }) =>
    update((x) => {
      const s = card(x, side)
      const cur = backgroundOf(s)
      const b = x.bleedMm * MM
      const nodes = cur
        ? s.nodes.map((n) => (n === cur ? { ...n, ...patch } : n))
        : [{ id: newId(), kind: 'rect', layerId: s.layers[0].id, x: -b, y: -b, width: x.widthMm * MM + 2 * b, height: x.heightMm * MM + 2 * b, strokeWidth: 0, name: 'Background', ...patch } as CardNode, ...s.nodes]
      return { ...x, [side]: { ...s, nodes } }
    })
  const label = side === 'front' ? 'Front' : 'Back'
  return (
    <div className="cd-row">
      <span className="cd-label">{label}</span>
      <select
        className="input"
        value={bg?.fillSlotId ?? ''}
        aria-label={`${label} background colour slot`}
        onChange={(e) => {
          const slot = d.slots.find((x) => x.id === e.target.value)
          set({ fillSlotId: slot?.id, ...(slot ? { fillColor: slot.color } : {}) })
        }}
      >
        <option value="">{TEXT.fixed}</option>
        {d.slots.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      {bg?.fillSlotId ? null : <input type="color" aria-label={`${label} background colour`} value={bg ? colorOf(bg, 'fillColor') : '#ffffff'} onChange={(e) => set({ fillColor: e.target.value, fillSlotId: undefined })} />}
    </div>
  )
}

function applySlotColor(n: CardNode, slotId: Id, color: string): CardNode {
  const c = n as CardNode & SlotKeys & { textSlotId?: Id }
  if (c.fillSlotId !== slotId && c.strokeSlotId !== slotId && c.textSlotId !== slotId) return n
  return {
    ...n,
    ...(c.fillSlotId === slotId ? { fillColor: color } : {}),
    ...(c.strokeSlotId === slotId ? { strokeColor: color } : {}),
    ...(c.textSlotId === slotId ? { textColor: color } : {}),
  }
}

/** A deleted slot leaves its last colour behind as a fixed colour. */
function dropSlot(s: Scene<CardNode>, slotId: Id): Scene<CardNode> {
  return {
    ...s,
    nodes: s.nodes.map((n) => {
      const c = n as CardNode & SlotKeys & { textSlotId?: Id }
      if (c.fillSlotId !== slotId && c.strokeSlotId !== slotId && c.textSlotId !== slotId) return n
      return { ...n, fillSlotId: c.fillSlotId === slotId ? undefined : c.fillSlotId, strokeSlotId: c.strokeSlotId === slotId ? undefined : c.strokeSlotId, textSlotId: c.textSlotId === slotId ? undefined : c.textSlotId }
    }),
  }
}

function CardPanel({ d, update }: { d: CardDoc; update: Update }) {
  const preset = CARD_SIZES.find((s) => s.w === d.widthMm && s.h === d.heightMm)?.id ?? ''
  const num = (label: string, value: number, set: (v: number) => void, min = 0) => (
    <label className="cd-row">
      <span className="cd-label">{label}</span>
      <input className="input cd-num" type="number" min={min} step={0.5} value={value} onChange={(e) => set(Math.max(min, Number(e.target.value) || 0))} />
      mm
    </label>
  )
  return (
    <div className="cd-panel">
      <h4>Card size</h4>
      <select
        className="input"
        value={preset}
        aria-label="Card size"
        onChange={(e) => {
          const s = CARD_SIZES.find((x) => x.id === e.target.value)
          if (s) update((x) => ({ ...x, widthMm: s.w, heightMm: s.h }))
        }}
      >
        <option value="">Custom</option>
        {CARD_SIZES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {num('Width', d.widthMm, (v) => update((x) => ({ ...x, widthMm: v })), 10)}
      {num('Height', d.heightMm, (v) => update((x) => ({ ...x, heightMm: v })), 10)}
      {num('Bleed', d.bleedMm, (v) => update((x) => ({ ...x, bleedMm: v })))}
      {num('Corner', d.cornerMm, (v) => update((x) => ({ ...x, cornerMm: v })))}
      <p className="cd-muted">
        The solid line is where the card is cut. Art should reach the red dashed bleed line, so no white edge shows if the cut is a little off. Keep text inside the blue safe line.
      </p>
    </div>
  )
}

/** Foil masks go to print shops black on white. */
function onWhite(src: HTMLCanvasElement) {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(src, 0, 0)
  return c
}

function ExportPanel({ d, title, cards, root }: { d: CardDoc; title: string; cards: Card[]; root: string | null }) {
  const [paper, setPaper] = useState('a4')
  const [dpi, setDpi] = useState(300)
  const [backs, setBacks] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = safeFileName(title)

  /** Draw every card (each card once, by id), fronts and backs. */
  const renderAll = async (withBleed: boolean, res: number, mask = false) => {
    await loadSceneFonts([d.front, d.back])
    const imageFields = d.fields.filter((f) => f.kind === 'image').map((f) => f.id)
    const paths = [
      ...cards.flatMap((c) => imageFields.map((f) => c.values[f] ?? '')),
      ...[...d.front.nodes, ...d.back.nodes].flatMap((n) => (n.kind === 'image' ? [n.src] : [])),
      ...(d.icons ?? []).map((i) => i.src),
    ]
    const resolve = await preloadImages(paths, (p) => (root ? assetUrl(root, p) : Promise.resolve(null)))
    const fronts = new Map<Id, HTMLCanvasElement>()
    const backsMap = new Map<Id, HTMLCanvasElement>()
    for (const c of cards) {
      const types = cardNodeTypes({ colors: slotColors(d, c.variantId), fields: d.fields, values: c.values, print: true, icons: ownIcons(d), mask })
      fronts.set(c.id, renderCard(d, d.front, types, resolve, res, withBleed))
      backsMap.set(c.id, renderCard(d, d.back, types, resolve, res, withBleed))
    }
    return { fronts, backs: backsMap }
  }

  const run = (label: string, job: () => Promise<unknown>) => async () => {
    setBusy(label)
    setError(null)
    try {
      await job()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const hasFoil = [...d.front.nodes, ...d.back.nodes].some((n) => n.foil)

  const sheets = async (mask = false) => {
    const page = PAGE_SIZES.find((p) => p.id === paper)!
    const layout = sheetLayout(page, { w: d.widthMm, h: d.heightMm }, d.bleedMm)
    if (!layout.slots.length) throw new Error('The card is bigger than the paper.')
    const r = await renderAll(true, dpi, mask)
    const deck = expandCopies(cards)
    return { layout, pages: drawSheets(layout, deck.map((c) => r.fronts.get(c.id)!), dpi, d.bleedMm, backs ? deck.map((c) => r.backs.get(c.id)!) : undefined) }
  }

  const pdf = run('Print sheets (PDF)', async () => {
    const { layout, pages } = await sheets()
    await saveBinaryFile({ title: 'Export print sheets', defaultName: `${name} print.pdf`, bytes: await sheetsToPdf(layout, pages), filter: { name: 'PDF', extensions: ['pdf'] } })
  })
  const foilPdf = run('Foil mask sheets', async () => {
    const { layout, pages } = await sheets(true)
    await saveBinaryFile({ title: 'Export foil mask sheets', defaultName: `${name} foil mask.pdf`, bytes: await sheetsToPdf(layout, pages), filter: { name: 'PDF', extensions: ['pdf'] } })
  })
  const png = run('Print sheets (PNG)', async () => {
    const { pages } = await sheets()
    if (pages.length === 1) return saveBinaryFile({ title: 'Export print sheet', defaultName: `${name} print.png`, bytes: await canvasBytes(pages[0]), filter: { name: 'PNG', extensions: ['png'] } })
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < pages.length; i++) files[`page ${String(i + 1).padStart(2, '0')}.png`] = await canvasBytes(pages[i])
    await saveBinaryFile({ title: 'Export print sheets', defaultName: `${name} print pages.zip`, bytes: zipSync(files, { level: 0 }), filter: { name: 'Zip', extensions: ['zip'] } })
  })
  const deckImage = run('Deck image', async () => {
    const r = await renderAll(false, Math.min(dpi, 200))
    const deck = expandCopies(cards).map((c) => r.fronts.get(c.id)!)
    if (!deck.length) throw new Error('The deck has no cards.')
    // One picture of the whole deck, 10 cards per row (the grid tabletop simulators read).
    const cols = Math.min(10, deck.length)
    const rows = Math.ceil(deck.length / cols)
    const out = document.createElement('canvas')
    out.width = cols * deck[0].width
    out.height = rows * deck[0].height
    const g = out.getContext('2d')!
    deck.forEach((c, i) => g.drawImage(c, (i % cols) * c.width, Math.floor(i / cols) * c.height))
    await saveBinaryFile({ title: 'Export deck image', defaultName: `${name} deck.png`, bytes: await canvasBytes(out), filter: { name: 'PNG', extensions: ['png'] } })
  })
  const zip = run('Card images + JSON', async () => {
    const r = await renderAll(false, dpi)
    const files: Record<string, Uint8Array> = {}
    const images = new Map<Id, string>()
    const used = new Set<string>()
    for (const c of cards) {
      let base = safeFileName(cardLabel(d, c), 'card')
      for (let n = 2; used.has(base); n++) base = `${safeFileName(cardLabel(d, c), 'card')} ${n}`
      used.add(base)
      images.set(c.id, `cards/${base}.png`)
      files[`cards/${base}.png`] = await canvasBytes(r.fronts.get(c.id)!)
      files[`cards/${base} back.png`] = await canvasBytes(r.backs.get(c.id)!)
    }
    if (hasFoil) {
      const m = await renderAll(false, dpi, true)
      for (const c of cards) {
        const base = images.get(c.id)!.replace(/\.png$/, '')
        files[`${base} foil.png`] = await canvasBytes(onWhite(m.fronts.get(c.id)!))
        files[`${base} back foil.png`] = await canvasBytes(onWhite(m.backs.get(c.id)!))
      }
    }
    files['deck.json'] = new TextEncoder().encode(JSON.stringify(deckJson(title, d, cards, images), null, 2))
    await saveBinaryFile({ title: 'Export cards', defaultName: `${name} cards.zip`, bytes: zipSync(files, { level: 0 }), filter: { name: 'Zip', extensions: ['zip'] } })
  })
  const json = run('Deck JSON', () => saveTextFile({ title: 'Export deck', defaultName: `${name}.json`, text: JSON.stringify(deckJson(title, d, cards), null, 2), filter: { name: 'JSON', extensions: ['json'] } }))

  const confirmBig = async (job: () => Promise<void>) => {
    if (dpi < 600 || (await confirmDialog({ title: 'Export at 600 DPI?', message: 'Very sharp, but slow and big files. 300 DPI is what most printers need.', confirmLabel: 'Export' }))) await job()
  }

  return (
    <div className="cd-panel">
      <h4>Print</h4>
      <label className="cd-row">
        <span className="cd-label">Paper</span>
        <select className="input" value={paper} onChange={(e) => setPaper(e.target.value)}>
          {PAGE_SIZES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="cd-row">
        <span className="cd-label">Resolution</span>
        <select className="input" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
          <option value={150}>150 DPI (draft)</option>
          <option value={300}>300 DPI (print)</option>
          <option value={600}>600 DPI</option>
        </select>
      </label>
      <label className="cd-row">
        <input type="checkbox" checked={backs} onChange={(e) => setBacks(e.target.checked)} />
        Backs on every other page (double-sided)
      </label>
      <p className="cd-muted">{TEXT.exportHint}</p>
      <button className="btn btn-primary" disabled={!!busy} onClick={() => void confirmBig(pdf)}>
        Print sheets (PDF)
      </button>
      <button className="btn" disabled={!!busy} onClick={() => void confirmBig(png)}>
        Print sheets (PNG)
      </button>
      {hasFoil ? (
        <>
          <button className="btn" disabled={!!busy} onClick={() => void confirmBig(foilPdf)}>
            Foil mask sheets (PDF)
          </button>
          <p className="cd-muted">Black where the foil goes, laid out like the print sheets. Print shops use it as the foil layer.</p>
        </>
      ) : null}
      <h4>Images and data</h4>
      <button className="btn" disabled={!!busy} onClick={() => void deckImage()}>
        Deck image (all cards in one PNG)
      </button>
      <button className="btn" disabled={!!busy} onClick={() => void confirmBig(zip)}>
        Card images + JSON (ZIP)
      </button>
      <button className="btn" disabled={!!busy} onClick={() => void json()}>
        Deck JSON
      </button>
      {busy ? <p className="cd-muted" role="status">Exporting {busy}…</p> : null}
      {error ? (
        <p className="cd-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
