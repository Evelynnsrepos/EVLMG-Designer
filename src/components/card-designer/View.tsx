import { Ban, ChevronLeft, ChevronRight, Circle, CopyPlus, FlipHorizontal, ImageUp, Layers as LayersIcon, Link2, Lock, Magnet, Minus, Plus, Shapes, Sparkles, Square, SquareUser, Type, Unlink2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { assetBlobUrl, assetUrl, dragHasFiles, importAssetsFromDataTransfer, pickAndImportAssets, useAssetUrls, type ImportedAsset } from '@/core/assets'
import { pointIn } from '@/shared/zoom'
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
  useCanvasState,
  type CanvasApi,
  type CanvasTool,
  type Layer,
  type Scene,
} from '@/shared/canvas'
import { confirmDialog } from '@/shared/dialogs'
import { useHotwheel } from '@/shared/hotwheel'
import { LayersPanel } from '@/shared/moodboard/LayersPanel'
import type { MoodNode } from '@/shared/moodboard/model'
import '@/shared/moodboard/moodboard.css'
import { ColoursSection } from './colours'
import { CardList, CardPicker, FieldsSection, LinkedSheet } from './deck'
import {
  CARD_SIZES,
  composeScene,
  legacyPerCardLayers,
  onEveryCard,
  repairFieldLinks,
  setLayerOnEveryCard,
  setOnEveryCard,
  snapToGuides,
  fitTo,
  withTokenFields,
  sameTextEverywhere,
  toggleSameText,
  createCardDoc,
  DEFAULT_FONT,
  MM,
  resizeDesign,
  setOverride,
  slotColors,
  splitScene,
  type Card,
  type CardDoc,
  type CardImageNode,
  type CardNode,
  type CardTextNode,
} from './model'
import { cardNodeTypes } from './nodeTypes'
import { CardPanel, ExportPanel, StylePanel } from './panels'
import { loadSceneFonts, preloadImages, renderCard } from './render'
import { addCard, allNodes, ownIcons, sideScene, TEXT, type Side } from './ui'
import '@/components/sketch/sketch-tool.css'
import './card-designer.css'

/**
 * Card Designer (0.22, layout 0.23.3): colours, fields and the card list on the left, the card in the
 * middle, style, size, export and layers on the right. One design for the deck; each card fills in its
 * values and may change colours and per-card layers for itself.
 */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<CardDoc>('card-designer', documentId!, createCardDoc)
  const root = useProjectStore((s) => s.root)
  const title = useProjectStore((s) => s.meta?.documents.find((x) => x.id === documentId)?.title) ?? 'Cards'
  const canvas = useCanvasState()
  const apiRef = useRef<CanvasApi<CardNode> | null>(null)
  const [side, setSide] = useState<Side>('front')
  const [showLayers, setShowLayers] = useState(true)
  const [imageMenu, setImageMenu] = useState<{ x: number; y: number; id: Id } | null>(null)
  const [previewId, setPreviewId] = useState<Id | null>(null)
  const [sheetCards, setSheetCards] = useState<Card[] | null>(null)
  const [fontsReady, setFontsReady] = useState(0)
  const d = doc.data

  const cards = useMemo(() => (d?.sheet ? (sheetCards ?? []) : (d?.cards ?? [])), [d?.sheet, d?.cards, sheetCards])
  const preview = cards.find((c) => c.id === previewId) ?? cards[0] ?? null
  const cardId = preview?.id ?? null
  const scene = useMemo(() => (d ? composeScene(d, side, cardId) : null), [d, side, cardId])

  const imagePaths = useMemo(() => (d ? picturePaths(d, cards) : []), [d, cards])
  const resolve = useAssetUrls(imagePaths)

  const types = useMemo(
    () => (d ? cardNodeTypes({ colors: slotColors(d, preview?.variantId, cardId ?? undefined), fields: d.fields, values: preview?.values ?? null, icons: ownIcons(d) }) : {}),
    // fontsReady: new renderers redraw the text once a font has loaded.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [d, preview, fontsReady],
  )

  // Fonts load on first use; draw again once they are there.
  const fontKey = d ? allNodes(d).map((n) => (n.kind === 'card-text' ? n.fontFamily : '')).join() : ''
  useEffect(() => {
    if (!d) return
    void loadSceneFonts([{ layers: [], nodes: allNodes(d) }]).then(() => setFontsReady((n) => n + 1))
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only when the fonts used change
  }, [fontKey])

  const { cardThumbs, layerThumbs } = useThumbs(d, cards, cardId, side, root, fontsReady)

  const tools = useMemo<CanvasTool<CardNode>[]>(() => {
    const ink = () => ({ strokeColor: '#1c1d22', strokeWidth: 6 })
    // Only Select and Text sit in the bar; shapes live behind the Shapes button, panning is Space+drag (H still works).
    const hide = <T extends CanvasTool<CardNode>>(t: T) => ({ ...t, hidden: true })
    return [selectTool, cardTextTool, hide(handTool), hide(rectTool({ defaults: ink })), hide(ellipseTool({ defaults: ink })), hide(lineTool({ defaults: ink }))] as CanvasTool<CardNode>[]
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

  // Decks from 0.23.3: per-card layers become a copy per card (see setLayerOnEveryCard).
  const legacy = d && cards.length ? legacyPerCardLayers(d) : []
  useEffect(() => {
    if (legacy.length) doc.update((x) => legacy.reduce((y, l) => setLayerOnEveryCard(y, l, false, cards.map((c) => c.id)), x), { undoable: false })
  }, [legacy.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  // Decks from before 0.24.5: give cards back the {Field} boxes they lost (see repairFieldLinks).
  const repair = !!d && !d.fieldLinks && !legacy.length && cards.length > 0
  useEffect(() => {
    if (repair) doc.update((x) => repairFieldLinks(x, cards.map((c) => c.id)), { undoable: false })
  }, [repair]) // eslint-disable-line react-hooks/exhaustive-deps

  const flipSide = () => (setSide((s) => (s === 'front' ? 'back' : 'front')), canvas.setSelection([]), canvas.setActiveLayerId(null))
  useHotwheel(() => {
    if (!d || !scene || d.started === false) return []
    const l = sideScene(d, side).layers.find((x) => x.id === resolveActiveLayer(scene, canvas.activeLayerId))
    return [
      { id: 'cards-step', label: 'Card', halves: [{ label: 'Previous', run: () => step(-1) }, { label: 'Next', run: () => step(1) }] },
      { id: 'cards-side', label: side === 'front' ? 'Show back' : 'Show front', icon: FlipHorizontal, run: flipSide },
      { id: 'cards-add', label: 'New card', icon: CopyPlus, run: () => !d.sheet && setPreviewId(addCard(d, doc.update, cardId)) },
      { id: 'cards-text', label: 'Text', icon: Type, run: () => apiRef.current?.setTool('card-text') },
      { id: 'cards-shapes', label: 'Rectangle', icon: Square, run: () => apiRef.current?.setTool('rect') },
      { id: 'cards-foil', label: 'Foil', icon: Sparkles, on: !!selectedFoil(), run: () => toggleSelectedFoil() },
      { id: 'cards-lock', label: l?.locked ? 'Unlock layer' : 'Lock layer', icon: Lock, on: !!l?.locked, run: () => l && doc.update((x) => ({ ...x, [side]: { ...sideScene(x, side), layers: sideScene(x, side).layers.map((y) => (y.id === l.id ? { ...y, locked: !y.locked } : y)) } })) },
    ]
  })

  if (!d || !scene) return null
  if (d.started === false) return <SizePicker onStart={(w, h, bleed) => doc.update((x) => ({ ...resizeDesign(x, w, h), bleedMm: bleed, started: true }), { undoable: false })} />

  const update = (recipe: (x: CardDoc) => CardDoc, options?: { undoable?: boolean }) => doc.update((x) => withTokenFields(recipe(x)), options)
  const onScene = (recipe: (s: Scene<CardNode>) => Scene<CardNode>, options?: { undoable?: boolean }) =>
    update((x) => {
      const before = composeScene(x, side, cardId)
      const next = recipe(before)
      return splitScene(x, side, cardId, x.snap ? snapToGuides(x, before, next) : next)
    }, options)

  const activeLayerId = resolveActiveLayer(scene, canvas.activeLayerId)
  const selected = scene.nodes.filter((n) => canvas.selection.includes(n.id))
  function selectedFoil() {
    return selected.length > 0 && selected.every((n) => n.foil)
  }
  function toggleSelectedFoil() {
    const on = !selectedFoil()
    if (selected.length) onScene((s) => ({ ...s, nodes: s.nodes.map((n) => (canvas.selection.includes(n.id) ? { ...n, foil: on || undefined } : n)) }))
  }
  const perCard = new Set(d.perCardLayers ?? [])
  const offHere = new Set((cardId && d.overrides?.[cardId]?.hidden) || [])

  const addPictureField = (layerId = activeLayerId, fresh = false) => {
    const f = fresh ? undefined : d.fields.find((x) => x.kind === 'image')
    const fieldId = f?.id ?? newId()
    const node: CardImageNode = { id: newId(), kind: 'card-image', layerId, x: 60, y: 120, width: d.widthMm * MM - 120, height: 300, fieldId }
    update((x) => {
      const y = f ? x : { ...x, fields: [...x.fields, { id: fieldId, name: fresh ? `Picture ${x.fields.length + 1}` : 'Art', kind: 'image' as const }] }
      const s = composeScene(y, side, cardId)
      return splitScene(y, side, cardId, { ...s, nodes: [...s.nodes, node] })
    })
    canvas.setSelection([node.id])
  }
  const placeImages = async (picked: ImportedAsset[], layerId: Id, at = { x: 40, y: 40 }) => {
    if (!picked.length || !root) return
    // Keep each picture's own shape, at most the card's size.
    const sizes = await Promise.all(picked.map(async (a) => imageSize(await assetUrl(root, a.path))))
    const nodes: CardNode[] = picked.map((a, i) => {
      const { w, h } = sizes[i] ?? { w: 1, h: 1 }
      const k = Math.min((d.widthMm * MM) / w, (d.heightMm * MM) / h, 1)
      return { id: newId(), kind: 'image', layerId, x: at.x + i * 20, y: at.y + i * 20, width: w * k, height: h * k, src: a.path, name: a.name }
    })
    onScene((s) => ({ ...s, nodes: [...s.nodes, ...nodes] }))
    canvas.setSelection(nodes.map((n) => n.id))
  }
  const addFixedImage = async (layerId = activeLayerId) => {
    if (root) await placeImages(await pickAndImportAssets(root, 'image'), layerId)
  }
  // Right-click an image (on the card or in the layers) to swap its picture, keeping its place and size.
  const isImage = (n?: CardNode) => n?.kind === 'image' || n?.kind === 'card-image'
  const replaceImage = async (id: Id) => {
    setImageMenu(null)
    const n = scene.nodes.find((x) => x.id === id)
    if (!root || !n) return
    const [a] = await pickAndImportAssets(root, 'image')
    if (!a) return
    if (n.kind === 'card-image') {
      // A picture field: the shown card gets the new picture.
      if (cardId) update((x) => ({ ...x, cards: x.cards.map((c) => (c.id === cardId ? { ...c, values: { ...c.values, [n.fieldId]: a.path } } : c)) }))
    } else onScene((s) => ({ ...s, nodes: s.nodes.map((m) => (m.id === id ? ({ ...m, src: a.path, name: a.name } as CardNode) : m)) }))
  }
  const fitImage = (id: Id, area: 'bleed' | 'card' | 'safe') => {
    setImageMenu(null)
    onScene((s) => ({ ...s, nodes: s.nodes.map((n) => (n.id === id ? fitTo(d, n, area) : n)) }))
  }
  const onCanvasMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const api = apiRef.current
    if (!api || !(e.target instanceof HTMLCanvasElement)) return
    const w = api.screenToWorld(pointIn(e.currentTarget, e))
    const hidden = new Set(scene.layers.filter((l) => l.hidden).map((l) => l.id))
    const hit = [...scene.nodes].reverse().find((n) => {
      const b = !hidden.has(n.layerId) && !n.hidden && isImage(n) ? api.getWorldBounds(n.id) : null
      return b && w.x >= b.x && w.x <= b.x + b.width && w.y >= b.y && w.y <= b.y + b.height
    })
    if (hit) setImageMenu({ x: e.clientX, y: e.clientY, id: hit.id })
  }

  // Image files dropped on the card go on the active layer where they were dropped.
  const onDropImages = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!root || !dragHasFiles(e.dataTransfer)) return
    e.preventDefault()
    const at = apiRef.current?.screenToWorld(pointIn(e.currentTarget, e))
    await placeImages(await importAssetsFromDataTransfer(root, e.dataTransfer, 'image'), activeLayerId, at)
  }

  const cardIds = cards.map((c) => c.id)
  const togglePerCard = async (l: Layer) => {
    if (perCard.has(l.id)) return update((x) => setLayerOnEveryCard(x, l.id, true, cardIds))
    const count = scene.nodes.filter((n) => n.layerId === l.id && onEveryCard(d, side, n.id)).length
    if (count && !(await confirmDialog({ title: `Take “${l.name}” off every card?`, message: `Every card gets its own copy of the ${count} item(s) on this layer, to change for itself. Nothing on it is on every card any more. You can undo this with Ctrl+Z.`, confirmLabel: 'Each card its own' }))) return
    update((x) => setLayerOnEveryCard(x, l.id, false, cardIds))
  }
  /** The + under each layer: a text box, a field with its text box, a picture field, an image or a shape on that layer. */
  const addToLayer = (what: AddKind, layerId: Id) => {
    canvas.setActiveLayerId(layerId)
    if (what === 'image') return void addFixedImage(layerId)
    if (what === 'picture') return addPictureField(layerId)
    if (what === 'rect' || what === 'ellipse' || what === 'line') return apiRef.current?.setTool(what)
    const field = what === 'text' ? null : { id: newId(), kind: what === 'number' ? ('number' as const) : ('text' as const), name: `${what === 'number' ? 'Stat' : 'Field'} ${d.fields.length + 1}` }
    const node: CardTextNode = { id: newId(), kind: 'card-text', layerId, x: (d.widthMm * MM - 300) / 2, y: (d.heightMm * MM - 60) / 2, width: 300, height: 60, text: field ? `{${field.name}}` : 'Text', fontSize: 32, fontFamily: DEFAULT_FONT, textColor: '#1c1d22' }
    update((x) => {
      const y = field ? { ...x, fields: [...x.fields, field] } : x
      const s = composeScene(y, side, cardId)
      return splitScene(y, side, cardId, { ...s, nodes: [...s.nodes, node] })
    })
    canvas.setSelection([node.id])
  }
  const toggleItemEveryCard = (n: CardNode) => {
    if (!cardId) return
    const every = onEveryCard(d, side, n.id)
    update((x) => setOnEveryCard(x, side, cardId, [n.id], !every))
  }
  const sameText = (n: CardNode) => sameTextEverywhere(d, side, n)
  const toggleOwnText = (n: CardNode) => update((x) => toggleSameText(x, side, cardId, n.id))
  const toggleOff = (l: Layer) =>
    cardId && update((x) => setOverride(x, cardId, (o) => ({ ...o, hidden: (o.hidden ?? []).includes(l.id) ? o.hidden!.filter((h) => h !== l.id) : [...(o.hidden ?? []), l.id] })))
  const layerFoil = (l: Layer) => scene.nodes.some((n) => n.layerId === l.id) && scene.nodes.every((n) => n.layerId !== l.id || n.foil)
  const toggleFoil = (l: Layer) => {
    if (l.locked) return
    const on = !layerFoil(l)
    onScene((s) => ({ ...s, nodes: s.nodes.map((n) => (n.layerId === l.id && !n.locked ? { ...n, foil: on || undefined } : n)) }))
  }
  const layerButton = (label: string, on: boolean, icon: ReactNode, onClick: () => void, disabled = false) => (
    <button
      className={'moodboard-icon-btn' + (on ? ' is-on' : '')}
      title={label}
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {icon}
    </button>
  )

  const toolbarExtra = (
    <>
      <ShapesButton toolId={canvas.toolId} onTool={(id) => apiRef.current?.setTool(id)} />
      <button
        className={'canvas-toolbar-btn' + (d.snap ? ' is-active' : '')}
        title={d.snap ? 'Snapping on: moved and resized items snap to the bleed, cut and safe lines and the centre. Click to turn it off.' : 'Snap to the card’s guide lines'}
        aria-label="Snap to guide lines"
        aria-pressed={!!d.snap}
        onClick={() => update((x) => ({ ...x, snap: !x.snap || undefined }))}
      >
        <Magnet size={17} strokeWidth={1.8} />
      </button>
      <button className="canvas-toolbar-btn" title={TEXT.addImage} aria-label={TEXT.addImage} onClick={() => void addFixedImage()}>
        <ImageUp size={17} strokeWidth={1.8} />
      </button>
      <button className="canvas-toolbar-btn" title={TEXT.addPicture} aria-label={TEXT.addPicture} onClick={() => addPictureField()}>
        <SquareUser size={17} strokeWidth={1.8} />
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
      <aside className="cd-left" aria-label="Deck">
        <details className="cd-section">
          <summary>Colours</summary>
          <ColoursSection d={d} card={preview} update={update} onScene={onScene} activeLayerId={activeLayerId} side={side} />
        </details>
        <details className="cd-section" open>
          <summary>Fields</summary>
          <FieldsSection d={d} card={preview} update={update} onAdd={(k) => (k === 'image' ? addPictureField(activeLayerId, true) : addToLayer(k === 'number' ? 'number' : 'field', activeLayerId))} />
        </details>
        <section className="cd-section cd-section-cards">
          <h3>Cards</h3>
          <CardList d={d} cards={cards} currentId={cardId} onPick={setPreviewId} update={update} previews={cardThumbs} />
        </section>
      </aside>
      <div className="cd-canvas" onDragOver={(e) => dragHasFiles(e.dataTransfer) && e.preventDefault()} onDrop={(e) => void onDropImages(e)} onContextMenu={onCanvasMenu}>
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
            <CardPicker d={d} cards={cards} current={preview} onPick={setPreviewId} />
            <button className="btn btn-ghost" title="Next card (Page Down)" aria-label="Next card" disabled={cards.length < 2} onClick={() => step(1)}>
              <ChevronRight size={16} />
            </button>
            <button className="btn" disabled={!!d.sheet} title={d.sheet ? 'Cards come from the linked Spreadsheet: add a row there' : 'Add a card and open it'} onClick={() => setPreviewId(addCard(d, update, cardId))}>
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
      <aside className="cd-right">
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
            layerPreview={(l) => (layerThumbs.get(l.id) ? <img className="cd-layer-thumb" src={layerThumbs.get(l.id)} alt="" /> : <span className="cd-layer-thumb" />)}
            onItemContextMenu={(m, e) => {
              if (!isImage(m as unknown as CardNode)) return
              e.preventDefault()
              setImageMenu({ x: e.clientX, y: e.clientY, id: m.id })
            }}
            layerFooter={(l) => (l.locked ? null : <AddMenu onAdd={(k) => addToLayer(k, l.id)} />)}
            layerClass={(l) => (perCard.has(l.id) ? '' : ' cd-every-card')}
            itemClass={(n) => (onEveryCard(d, side, n.id) ? ' cd-every-card' : '')}
            itemActions={(m) => {
              const n = m as unknown as CardNode
              const every = onEveryCard(d, side, n.id)
              return (
                <>
                  {n.kind === 'card-text'
                    ? layerButton(
                        sameText(n) ? 'Its text goes with it: every card that has this box shows the same text. Click to give each card its own text.' : 'Own text: on other cards this box starts empty. Click to show the same text on every card.',
                        false,
                        <Type size={14} className={sameText(n) ? 'cd-every-icon' : ''} />,
                        () => toggleOwnText(n),
                        !every && !cardId,
                      )
                    : null}
                  {layerButton(
                    every ? 'On every card. Click to keep it on this card only.' : perCard.has(n.layerId) ? 'Only on this card. Click to put it on every card (its layer goes on every card too).' : 'Only on this card. Click to put it on every card.',
                    false,
                    every ? <Link2 size={14} className="cd-every-icon" /> : <Unlink2 size={14} />,
                    () => toggleItemEveryCard(n),
                    !cardId,
                  )}
                </>
              )
            }}
            layerActions={(l) => (
              <>
                {layerButton(
                  perCard.has(l.id) ? 'Not on every card: only each card’s own items. Click to put this layer on every card.' : 'On every card. Click to give each card its own copy of this layer instead.',
                  !perCard.has(l.id),
                  perCard.has(l.id) ? <Unlink2 size={14} /> : <Link2 size={14} />,
                  () => void togglePerCard(l),
                  !cardId,
                )}
                {layerButton(offHere.has(l.id) ? 'Off on this card. Click to show it again.' : 'Turn this layer off on this card only', offHere.has(l.id), <Ban size={14} />, () => toggleOff(l), !cardId)}
                {layerButton(layerFoil(l) ? 'Foil layer: everything here is foil. Click to turn foil off.' : 'Make everything on this layer foil', layerFoil(l), <Sparkles size={14} />, () => toggleFoil(l), !!l.locked)}
              </>
            )}
          />
        ) : null}
        {showLayers ? null : (
          <button className="btn btn-ghost cd-show-layers" onClick={() => setShowLayers(true)}>
            <LayersIcon size={14} /> Show layers
          </button>
        )}
        <div className="cd-right-bottom">
          <details className="cd-section" open>
            <summary>Style</summary>
            <StylePanel d={d} selected={selected} onScene={onScene} />
          </details>
          <details className="cd-section">
            <summary>Card size</summary>
            <CardPanel d={d} update={update} />
          </details>
          <details className="cd-section">
            <summary>Export</summary>
            <ExportPanel d={d} title={title} cards={cards} root={root} />
          </details>
        </div>
      </aside>
      {imageMenu ? (
        <>
          <div className="menu-backdrop" onClick={() => setImageMenu(null)} onContextMenu={(e) => (e.preventDefault(), setImageMenu(null))} />
          <div className="cd-add-menu cd-context-menu" role="menu" style={{ left: imageMenu.x, top: imageMenu.y }}>
            <button role="menuitem" className="cd-add-item" onClick={() => void replaceImage(imageMenu.id)}>
              {scene.nodes.find((n) => n.id === imageMenu.id)?.kind === 'card-image' ? 'Replace this card’s picture…' : 'Replace image…'}
            </button>
            {(['bleed', 'card', 'safe'] as const).map((a) => (
              <button key={a} role="menuitem" className="cd-add-item" onClick={() => fitImage(imageMenu.id, a)}>
                {FIT_LABEL[a]}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

export const FIT_LABEL = { bleed: 'Fill the whole card (to the bleed line)', card: 'Fit to the cut line', safe: 'Fit inside the safe line' }

/** A picture's natural size in pixels (null if it can't load). */
function imageSize(url: string | null): Promise<{ w: number; h: number } | null> {
  if (!url) return Promise.resolve(null)
  return new Promise((done) => {
    const img = new Image()
    img.onload = () => done(img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null)
    img.onerror = () => done(null)
    img.src = url
  })
}

type AddKind = 'text' | 'field' | 'number' | 'picture' | 'image' | 'rect' | 'ellipse' | 'line'
const ADD_ITEMS: { kind: AddKind; label: string }[] = [
  { kind: 'text', label: 'Text box' },
  { kind: 'field', label: 'Text field (a new field + its box)' },
  { kind: 'number', label: 'Number field (a new stat + its box)' },
  { kind: 'picture', label: 'Picture field (each card’s picture)' },
  { kind: 'image', label: 'Image (the same on every card)' },
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'line', label: 'Line' },
]

/** The + under a layer's items: opens a short list of what to add to that layer. */
function AddMenu({ onAdd }: { onAdd(kind: AddKind): void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="cd-add">
      <button className="cd-add-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Plus size={13} /> Add
      </button>
      {open ? (
        <div className="cd-add-menu" role="menu">
          {ADD_ITEMS.map((i) => (
            <button key={i.kind} role="menuitem" className="cd-add-item" onClick={() => (setOpen(false), onAdd(i.kind))}>
              {i.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const SHAPES = [
  { id: 'rect', label: 'Rectangle (R)', icon: Square },
  { id: 'ellipse', label: 'Ellipse (O)', icon: Circle },
  { id: 'line', label: 'Line (L)', icon: Minus },
]

/** Rectangle, ellipse and line behind one toolbar button. */
function ShapesButton({ toolId, onTool }: { toolId: string; onTool(id: string): void }) {
  const [open, setOpen] = useState(false)
  const current = SHAPES.find((s) => s.id === toolId)
  const Icon = current?.icon ?? Shapes
  return (
    <span className="cd-shapes">
      <button className={'canvas-toolbar-btn' + (current ? ' is-active' : '')} title="Shapes: rectangle, ellipse, line" aria-label="Shapes" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon size={17} strokeWidth={1.8} />
      </button>
      {open ? (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="cd-shapes-menu" role="menu">
            {SHAPES.map((s) => (
              <button key={s.id} role="menuitem" className={'canvas-toolbar-btn' + (s.id === toolId ? ' is-active' : '')} title={s.label} aria-label={s.label} onClick={() => (onTool(s.id), setOpen(false))}>
                <s.icon size={17} strokeWidth={1.8} />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </span>
  )
}

/** Every picture a deck shows: card pictures, fixed images (also cards' own ones) and own icons. */
function picturePaths(d: CardDoc, cards: Card[]): string[] {
  const fieldIds = new Set(d.fields.filter((f) => f.kind === 'image').map((f) => f.id))
  const fromCards = cards.flatMap((c) => Object.entries(c.values).filter(([k]) => fieldIds.has(k)).map(([, v]) => v))
  return [...fromCards, ...allNodes(d).flatMap((n) => (n.kind === 'image' ? [n.src] : [])), ...(d.icons ?? []).map((i) => i.src)]
}

/** Thumbnail resolution: a poker card comes out about 50 px wide. */
const THUMB_DPI = 20
// shortcut: thumbnails for the first 200 cards only; render lazily on scroll if decks get bigger.
const THUMB_MAX = 200

/** Small pictures of every card (front) and of each layer of the shown side, redrawn a moment after changes. */
function useThumbs(d: CardDoc | null | undefined, cards: Card[], cardId: Id | null, side: Side, root: string | null, fontsReady: number) {
  const [cardThumbs, setCardThumbs] = useState(new Map<Id, string>())
  const [layerThumbs, setLayerThumbs] = useState(new Map<Id, string>())
  useEffect(() => {
    if (!d || d.started === false) return
    let stop = false
    const t = setTimeout(async () => {
      const resolve = await preloadImages(picturePaths(d, cards), (p) => (root ? assetBlobUrl(root, p) : Promise.resolve(null)))
      if (stop) return
      const draw = (c: Card | undefined, scene: Scene<CardNode>) =>
        renderCard(d, scene, cardNodeTypes({ colors: slotColors(d, c?.variantId, c?.id), fields: d.fields, values: c?.values ?? null, print: true, icons: ownIcons(d) }), resolve, THUMB_DPI, false).toDataURL()
      setCardThumbs(new Map(cards.slice(0, THUMB_MAX).map((c) => [c.id, draw(c, composeScene(d, 'front', c.id))])))
      const shown = cards.find((c) => c.id === cardId)
      const s = composeScene(d, side, cardId)
      setLayerThumbs(new Map(s.layers.map((l) => [l.id, draw(shown, { ...s, layers: s.layers.map((x) => ({ ...x, hidden: x.id !== l.id })) })])))
    }, 600)
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [d, cards, cardId, side, root, fontsReady])
  return { cardThumbs, layerThumbs }
}

/** A new deck starts here: pick the card size, like the canvas size in Draw. */
function SizePicker({ onStart }: { onStart(w: number, h: number, bleed: number): void }) {
  const [w, setW] = useState(63)
  const [h, setH] = useState(88)
  const [bleed, setBleed] = useState(3)
  const num = (v: number) => Math.max(10, Math.min(400, Number(v) || 10))
  return (
    <div className="sketch-start cd-start">
      <h2>New card deck</h2>
      <p className="muted">Pick the card size. You can change it later under Card size; the design scales along.</p>
      <div className="sketch-start-presets">
        {CARD_SIZES.map((s) => (
          <button key={s.id} className={'btn' + (s.w === w && s.h === h ? ' btn-primary' : '')} onClick={() => (setW(s.w), setH(s.h))}>
            {s.name}
          </button>
        ))}
      </div>
      <div className="sketch-start-size">
        <label>
          Width (mm)
          <input className="input" type="number" min={10} max={400} value={w} onChange={(e) => setW(Number(e.target.value))} />
        </label>
        ×
        <label>
          Height (mm)
          <input className="input" type="number" min={10} max={400} value={h} onChange={(e) => setH(Number(e.target.value))} />
        </label>
        <label>
          Bleed (mm)
          <input className="input" type="number" min={0} max={10} step={0.5} value={bleed} onChange={(e) => setBleed(Number(e.target.value))} />
        </label>
      </div>
      <button className="btn btn-primary" onClick={() => onStart(num(w), num(h), Math.max(0, Math.min(10, Number(bleed) || 0)))}>
        Start designing
      </button>
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
