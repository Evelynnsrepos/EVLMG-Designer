import { commentTool } from '@/shared/reviews'
import { CustomColor } from '@/shared/canvas/CustomColor'
import { ArrowUpToLine, Brush, Circle, ImagePlus, Lasso, PanelRight, Pentagon, Square, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assetUrl, dragHasFiles, importAssetsFromDataTransfer, pickAndImportAssets, useAssetUrls, type ImportedAsset } from '@/core/assets'
import { newId, type Id } from '@/core/model'
import type { ComponentType } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useIntentHandler, useProjectStore } from '@/core/state'
import {
  addNodes,
  arrowTool,
  CanvasEditor,
  ellipseTool,
  ensureTopLayer,
  handTool,
  lineTool,
  loadImageSize,
  penTool,
  eraserTool,
  rectTool,
  resolveActiveLayer,
  selectTool,
  textTool,
  updateNode,
  updateNodes,
  useCanvasState,
  type CanvasApi,
  type CanvasTool,
  type Point,
  type SceneRecipe,
  type UpdateOptions,
} from '@/shared/canvas'
import { DrawingDrawer } from './DrawingDrawer'
import { LayersPanel } from './LayersPanel'
import { createMoodboardDoc, isImage, type CutoutKind, type MoodImageNode, type MoodNode, type MoodboardDoc } from './model'
import { MOOD_NODE_TYPES } from './nodeTypes'
import { CUTOUT_LABELS, cutoutTool } from './tools'
import './moodboard.css'

const TEXT = {
  board: 'Moodboard',
  colors: 'Color',
  auto: 'Automatic color',
  addImage: 'Add images',
  onTop: 'Always on top: new drawings and text stay above images',
  layers: 'Layers panel',
  removeCutout: 'Remove cutout (show the whole image)',
  pickImage: 'Select an image first, then draw the cutout over it.',
  dropHere: 'Drop images to add them',
  importFailed: 'Only images can be added to a moodboard.',
  drawings: 'Add a drawing (from the Draw tool) as a sticker',
}

/** Drawing colors (user content colors). */
const INKS = [
  { label: 'Red', color: '#e5484d' },
  { label: 'Orange', color: '#f08c2e' },
  { label: 'Yellow', color: '#f5d90a' },
  { label: 'Green', color: '#30a46c' },
  { label: 'Blue', color: '#3e8ef7' },
  { label: 'Purple', color: '#8e6cf0' },
  { label: 'White', color: '#ffffff' },
  { label: 'Black', color: '#111111' },
]

const CUTOUT_KINDS: { kind: CutoutKind; icon: typeof Square }[] = [
  { kind: 'rect', icon: Square },
  { kind: 'ellipse', icon: Circle },
  { kind: 'polygon', icon: Pentagon },
  { kind: 'lasso', icon: Lasso },
]

const nameOnly = (file: string) => file.replace(/\.[^.]+$/, '')

/** Moodboard (spec 8.7): images with cutouts, drawings and text, a layers panel, always-on-top drawing. */
export function MoodboardBoard({ type, documentId, active, label }: PanelProps & { type: ComponentType; label?: string }) {
  const doc = useDocument<MoodboardDoc>(type, documentId!, createMoodboardDoc)
  const root = useProjectStore((s) => s.root)
  const canvas = useCanvasState()
  const apiRef = useRef<CanvasApi<MoodNode> | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [ink, setInk] = useState<string | null>(null)
  const [cutKind, setCutKind] = useState<CutoutKind>('lasso')
  // Opens clean like the Brainstorm board; layers and drawings are one click away.
  const [showLayers, setShowLayers] = useState(false)
  const [showDrawings, setShowDrawings] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const tools = useMemo<CanvasTool<MoodNode>[]>(() => {
    const stroke = () => (ink ? { strokeColor: ink } : {})
    return [
      selectTool,
      handTool,
      penTool({ defaults: stroke }),
      eraserTool(),
      rectTool({ defaults: stroke }),
      ellipseTool({ defaults: stroke }),
      lineTool({ defaults: stroke }),
      arrowTool({ defaults: stroke }),
      textTool({ defaults: () => (ink ? { textColor: ink } : {}) }),
      cutoutTool(() => cutKind, () => setMessage(TEXT.pickImage)),
      commentTool(type, documentId ?? null),
    ]
  }, [ink, cutKind, type, documentId])

  const scene = doc.data?.scene
  const onTop = !!doc.data?.alwaysOnTop
  const paths = useMemo(() => scene?.nodes.flatMap((n) => (n.kind === 'image' ? [n.src] : [])) ?? [], [scene])
  const resolve = useAssetUrls(paths)
  const topLayerId = scene?.layers.find((l) => l.alwaysOnTop)?.id ?? null
  // The normal layer images go to; also drawings while always-on-top is off.
  const imageLayerId = scene ? resolveActiveLayer(scene, canvas.activeLayerId) : ''
  const update = doc.update

  // A document from another shape (early Design Language test builds) starts as an empty board.
  useEffect(() => {
    if (doc.data && !doc.data.scene) update(() => createMoodboardDoc(), { undoable: false })
  }, [doc.data, update])

  // MB-6: with always-on-top on, the top layer must exist.
  useEffect(() => {
    if (onTop && scene && !topLayerId) update((d) => ({ ...d, scene: ensureTopLayer(d.scene).scene }), { undoable: false })
  }, [onTop, scene, topLayerId, update])

  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(() => setMessage(null), 4000)
    return () => window.clearTimeout(t)
  }, [message])

  const viewCenter = useCallback((): Point => {
    const api = apiRef.current
    const box = boxRef.current
    if (!api || !box) return { x: 0, y: 0 }
    return api.screenToWorld({ x: box.clientWidth / 2, y: box.clientHeight / 2 })
  }, [])

  /** MB-1, MB-7: imported images go side by side around `at`, on the normal layer (below always-on-top drawings). */
  const placeImages = useCallback(
    async (assets: ImportedAsset[], at: Point) => {
      const api = apiRef.current
      if (!api || !root) return
      const images = assets.filter((a) => a.kind === 'image')
      if (images.length === 0) return setMessage(TEXT.importFailed)
      const nodes: MoodImageNode[] = []
      let x = at.x
      for (const a of images) {
        const size = await loadImageSize(await assetUrl(root, a.path).catch(() => null))
        nodes.push({ id: newId(), kind: 'image', layerId: imageLayerId, src: a.path, name: nameOnly(a.name), x, y: at.y - size.height / 2, ...size })
        x += size.width + 24
      }
      const shift = (x - 24 - at.x) / 2
      for (const n of nodes) n.x -= shift
      api.update((s) => addNodes(s, nodes))
      api.select(nodes.map((n) => n.id))
    },
    [root, imageLayerId],
  )

  // Pictures sent from another tool (Sketch "Send to…", v0.5).
  useIntentHandler(
    type,
    (intent) => {
      if (intent.action !== 'add-image' || typeof intent.path !== 'string') return
      const asset: ImportedAsset = { path: intent.path, kind: 'image', name: String(intent.name ?? 'Image') }
      // The canvas may still be mounting right after the panel opened.
      const place = (tries: number) => (apiRef.current ? void placeImages([asset], viewCenter()) : tries > 0 && setTimeout(() => place(tries - 1), 150))
      place(20)
    },
    !!scene,
  )

  if (!doc.data || !scene) return null

  const onChange = (recipe: SceneRecipe<MoodNode>, options?: UpdateOptions) => doc.update((d) => ({ ...d, scene: recipe(d.scene) }), options)
  const selected = scene.nodes.filter((n) => canvas.selection.includes(n.id))
  const cutImage = selected.length === 1 && isImage(selected[0]) && selected[0].cutout ? selected[0] : null

  const toggleOnTop = () => doc.update((d) => (d.alwaysOnTop ? { ...d, alwaysOnTop: false } : { ...d, alwaysOnTop: true, scene: ensureTopLayer(d.scene).scene }))

  const pickInk = (c: string | null) => {
    setInk(c)
    if (canvas.selection.length === 0) return
    onChange((s) =>
      updateNodes(s, canvas.selection, (n) => {
        if (n.kind === 'text') return { ...n, textColor: c ?? undefined }
        if (n.kind === 'rect' || n.kind === 'ellipse' || n.kind === 'line' || n.kind === 'connector') return { ...n, strokeColor: c ?? undefined }
        return n
      }),
    )
  }

  const onDrop = async (e: React.DragEvent) => {
    setDropping(false)
    if (!root || !dragHasFiles(e.dataTransfer)) return
    e.preventDefault()
    const r = boxRef.current!.getBoundingClientRect()
    const at = apiRef.current?.screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top }) ?? viewCenter()
    await placeImages(await importAssetsFromDataTransfer(root, e.dataTransfer, 'image'), at)
  }

  const onPaste = async (e: React.ClipboardEvent) => {
    if (!active || !root || isTyping(e.target)) return
    if (!Array.from(e.clipboardData.items).some((i) => i.kind === 'file')) return
    e.preventDefault()
    await placeImages(await importAssetsFromDataTransfer(root, e.clipboardData, 'image'), viewCenter())
  }

  const addFromPicker = async () => {
    if (!root) return
    await placeImages(await pickAndImportAssets(root, 'image'), viewCenter())
  }

  const selectFromPanel = (ids: Id[], mode: 'replace' | 'toggle') => {
    const api = apiRef.current
    if (api) api.select(ids, mode)
    else canvas.setSelection(ids)
    boxRef.current?.querySelector<HTMLElement>('.canvas-root')?.focus({ preventScroll: true })
  }

  const toolbarExtra = (
    <>
      {canvas.toolId === 'cutout' ? (
        <div className="moodboard-cut-kinds" role="radiogroup" aria-label={CUTOUT_LABELS.tool}>
          {CUTOUT_KINDS.map(({ kind, icon: Icon }) => (
            <button
              key={kind}
              className={'canvas-toolbar-btn' + (cutKind === kind ? ' is-active' : '')}
              role="radio"
              aria-checked={cutKind === kind}
              title={CUTOUT_LABELS.kinds[kind]}
              aria-label={CUTOUT_LABELS.kinds[kind]}
              onClick={() => setCutKind(kind)}
            >
              <Icon size={15} strokeWidth={1.8} />
            </button>
          ))}
          <span className="canvas-toolbar-sep" />
        </div>
      ) : null}
      {cutImage ? (
        <>
          <button className="canvas-toolbar-btn" title={TEXT.removeCutout} aria-label={TEXT.removeCutout} onClick={() => onChange((s) => updateNode(s, cutImage.id, (n) => ({ ...n, cutout: undefined }) as MoodNode))}>
            <Undo2 size={16} strokeWidth={1.8} />
          </button>
          <span className="canvas-toolbar-sep" />
        </>
      ) : null}
      <div className="moodboard-swatches" role="radiogroup" aria-label={TEXT.colors}>
        <button className={'moodboard-swatch is-auto' + (ink === null ? ' is-active' : '')} title={TEXT.auto} aria-label={TEXT.auto} role="radio" aria-checked={ink === null} onClick={() => pickInk(null)} />
        {INKS.map((c) => (
          <button
            key={c.label}
            className={'moodboard-swatch' + (ink === c.color ? ' is-active' : '')}
            style={{ background: c.color }}
            title={c.label}
            aria-label={c.label}
            role="radio"
            aria-checked={ink === c.color}
            onClick={() => pickInk(c.color)}
          />
        ))}
        <CustomColor value={ink} onPick={pickInk} />
      </div>
      <span className="canvas-toolbar-sep" />
      <button className={'canvas-toolbar-btn' + (onTop ? ' is-active' : '')} title={TEXT.onTop} aria-label={TEXT.onTop} aria-pressed={onTop} onClick={toggleOnTop}>
        <ArrowUpToLine size={17} strokeWidth={1.8} />
      </button>
      <button className="canvas-toolbar-btn" title={TEXT.addImage} aria-label={TEXT.addImage} onClick={addFromPicker}>
        <ImagePlus size={17} strokeWidth={1.8} />
      </button>
      <button className={'canvas-toolbar-btn' + (showDrawings ? ' is-active' : '')} title={TEXT.drawings} aria-label={TEXT.drawings} aria-pressed={showDrawings} onClick={() => setShowDrawings((v) => !v)}>
        <Brush size={17} strokeWidth={1.8} />
      </button>
      <button className={'canvas-toolbar-btn' + (showLayers ? ' is-active' : '')} title={TEXT.layers} aria-label={TEXT.layers} aria-pressed={showLayers} onClick={() => setShowLayers((v) => !v)}>
        <PanelRight size={17} strokeWidth={1.8} />
      </button>
    </>
  )

  return (
    <div className="moodboard-root">
      <div
        ref={boxRef}
        className={'moodboard-canvas' + (dropping ? ' is-dropping' : '')}
        onDragOver={(e) => {
          if (!dragHasFiles(e.dataTransfer)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dropping) setDropping(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
        }}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        <CanvasEditor<MoodNode>
          scene={scene}
          onChange={onChange}
          onUndo={doc.undo}
          onRedo={doc.redo}
          canUndo={doc.canUndo}
          canRedo={doc.canRedo}
          active={active}
          tools={tools}
          nodeTypes={MOOD_NODE_TYPES}
          // Drawing tools add to the always-on-top layer while that option is on (MB-6).
          canvas={{ ...canvas, activeLayerId: onTop && topLayerId ? topLayerId : imageLayerId }}
          apiRef={apiRef}
          resolveImageSrc={resolve}
          toolbarExtra={toolbarExtra}
          ariaLabel={label ?? TEXT.board}
        />
        {dropping ? <div className="moodboard-drop">{TEXT.dropHere}</div> : null}
        {message ? (
          <div className="moodboard-message" role="status">
            {message}
          </div>
        ) : null}
      </div>
      {showDrawings ? <DrawingDrawer onPlace={(asset) => void placeImages([asset], viewCenter())} onClose={() => setShowDrawings(false)} /> : null}
      {showLayers ? (
        <LayersPanel
          doc={doc.data}
          onChange={(r) => onChange(r)}
          selection={canvas.selection}
          onSelect={selectFromPanel}
          activeLayerId={imageLayerId}
          onActiveLayer={(id) => canvas.setActiveLayerId(id)}
          onClose={() => setShowLayers(false)}
        />
      ) : null}
    </div>
  )
}

function isTyping(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
}
