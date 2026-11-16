import {
  Brush as BrushIcon,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Fingerprint,
  FlipHorizontal,
  Hand,
  Image as ImageIcon,
  ImagePlus,
  Lasso,
  Move,
  PaintBucket,
  Pipette,
  Layers2,
  Redo2,
  RotateCcw,
  RotateCw,
  Scan,
  Settings2,
  SquareDashed,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { importAssetFromBlob, pickAndImportAssets, resolveAssetPath } from '@/core/assets'
import { getFs } from '@/core/fs'
import { retireAssets } from '@/core/backups'
import { newId, type Id } from '@/core/model'
import { flush as flushSave, IDLE_SAVE_MS, scheduleSave, useProjectStore } from '@/core/state'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { SketchEngine } from './engine'
import { drawPreview } from './brushes'
import { BrushLibrary } from './BrushLibrary'
import { useBrushLibrary } from './library'
import {
  newLayer,
  nextLayerName,
  paperMode,
  withPaper,
  type InputPoint,
  type PaperMode,
  type SketchDoc,
  type SketchLayer,
  type SymmetryMode,
} from './model'
import { gentle, HOLD_MS, keys, PERFECT_MS, outline as shapeOutline, perfect, recognize, resize, type Shape } from './quickshape'
import { ReferencePicker } from './ReferencePicker'
import { ReferenceWindow } from './ReferenceWindow'
import { ShortcutSheet } from './ShortcutSheet'
import { FloatingPanel, useSpot } from './FloatingPanel'
import { growDoc, growFor, shiftDocData } from './growth'
import { SketchHistoryFile } from './historyFile'
import { boundsOf, maxLayers, type Rect } from './tiles'
import './sketch.css'
// Sketch Pro: layers, selections (feat/sketch-layers)
import { addMask, exportLayers, hasPixels, insertAbove, isGroup, lockedInTree } from './layers'
import { LayersPanel, type LayerHost } from './LayersPanel'
import { SelectionBar, SelectionMaskView, SelectionOutline } from './SelectionTools'
import { useSelector } from './selector'
import { copyPixels } from './clipboard'
import { TransformBar, TransformOverlay } from './TransformTools'
import { useTransformer } from './transformer'
import { ColorDropBar, ColorDropView, ColorPanel } from './ColorPanel'
import { useColorDrop } from './colordrop'
// Sketch Pro: pen input, view turning, guides, QuickMenu.
import { keyHint } from '@/shared/hotkeyHints'
import { actionLabel, keysFor, matchShortcut, PAIRS, toolOf, type ActionId } from './actions'
import { TouchGestures } from './gestures'
import { activeGuide, assistFor, normalizeGuide, symmetryMirror, type DrawingGuide } from './guides'
import { hexToRgb } from './color'
import { BrushCursor, GuideOverlay, ShapeNodes } from './GuideOverlay'
import { GuidePanel } from './GuidePanel'
import { InputSettingsDialog } from './InputSettingsDialog'
import { holdTolerance, useInputSettings } from './inputSettings'
import { isEraserEnd, penButton, penData, PenPipeline, type PenPoint } from './pen'
import { flipAbout, pinch, rotateAbout, toDocPoint, viewMatrix, zoomAbout, type View } from './view'
// Sketch Pro: canvas, time-lapse and files.
import { useSketchFiles } from './files/SketchFiles'
// Sketch Pro: text layers (feat/sketch-text)
import { Keyboard, Lamp, Layers as LayersIcon, LocateFixed, PanelRightClose, PictureInPicture2, Type } from 'lucide-react'
import { useImportedFonts } from './fonts'
import { TextBoxes, TextPanel } from './TextPanel'
import { useTextLayers, useTextTool } from './textLayers'
// Sketch Pro: Animation Assist and Page Assist (feat/sketch-text)
import { AssistBar, AssistButtons } from './AssistBar'
import { useAssist } from './assistView'
// Sketch Pro: Adjustments, Liquify and Clone.
import { AdjustMenu, AdjustStudio, type AdjustMode } from './adjust/AdjustStudio'
import { pointIn, zoomOf } from '@/shared/zoom'
import { openHotwheel, useHotwheel, type HotAction } from '@/shared/hotwheel'

// 3D only loads when the light preview opens.
const LightPreview = lazy(() => import('./light/LightPreview'))

const UI_PRO = {
  rotateLeft: 'Turn view left (,)',
  rotateRight: 'Turn view right (.)',
  flipView: 'Mirror view (Shift+H): only the view, the picture stays as it is',
  input: 'Pen and keys: pressure curve, smoothing, shortcuts, QuickMenu, tablet test',
  shortcuts: 'Keyboard shortcuts (Shift+?)',
  override: { streamline: 'Smoothing', stabilization: 'Stabilization', tether: 'Tether' },
  overrideHint: "Tick to use your own value for every brush. Unticked, each brush uses its own setting (shown greyed out).",
  layers: 'Layers',
  textOptions: 'Text',
  showLayers: 'Show the layers',
  lightPreview: 'Light preview: lamps around 3D objects, to see where shadows fall',
  lightPreviewTitle: 'Light preview',
  hideLayers: 'Hide the layers',
  floatLayers: 'Float the layers over the canvas',
  dockLayers: 'Put the layers back in the side panel',
  bringBack: 'Bring back lost panels',
  bringFloating: 'Layers, floating at the top right',
  bringDocked: 'Layers, in the side panel',
  editShape: 'Edit shape',
  done: 'Done',
}

/** A QuickShape that just snapped, offered for Edit Shape. */
interface ShapeOffer {
  shape: Shape
  opts: Parameters<SketchEngine['beginStroke']>[0]
  pressure: number
  start: { x: number; y: number }
  /** Where the button shows, in stage pixels. */
  at: { x: number; y: number }
  editing: boolean
}

const UI = {
  brush: 'Brush (B)',
  eraser: 'Eraser (E)',
  smudge: 'Smudge (S): drags the colors with the brush',
  lasso: 'Lasso selection (L)',
  rectSelect: 'Rectangle selection (M)',
  move: 'Move (V): drags the selection, or the whole layer',
  eyedropper: 'Eyedropper (I, or hold Alt)',
  layerPick: 'Layer picker (K, or hold Ctrl): point at paint to see its layer, click to make it active',
  hand: 'Pan (H, or hold Space)',
  undo: 'Undo (Ctrl+Z)',
  redo: 'Redo (Ctrl+Y)',
  fill: 'Fill the selection or layer with the color',
  clear: 'Clear the selection or layer (Delete)',
  flipX: 'Flip the picture horizontally (Shift: only this layer)',
  flipY: 'Flip the picture vertically (Shift: only this layer)',
  deselect: 'Deselect (Ctrl+D)',
  moveSelection: 'Move selection',
  library: 'Brush library',
  fit: 'Fit to view (0)',
  reference: 'Add a reference image (floats over the canvas, not part of the picture)',
  insertImage: 'Insert an image as a new layer',
  export: 'Export as PNG',
  size: 'Size',
  opacity: 'Opacity',
  symmetry: 'Mirror',
  symmetryModes: { off: 'Off', vertical: 'Left / right', horizontal: 'Top / bottom', quad: 'Four ways' } as Record<SymmetryMode, string>,
  layers: 'Layers',
  addLayer: 'New layer',
  layerLimit: (n: number) => `This canvas holds at most ${n} layers in memory. Merge or delete layers to add more.`,
  duplicate: 'Duplicate',
  mergeDown: 'Merge down',
  deleteLayer: 'Delete layer',
  alphaLock: 'Alpha lock: paint only on existing pixels',
  clip: 'Clipping mask: show only on the layer below',
  rename: 'Rename layer',
  background: 'Background',
  transparent: 'Transparent',
  solid: 'Solid',
  blurred: 'Blurred',
  paperColor: 'Paper colour (with Blurred: its tint)',
  color: 'Color',
  saving: 'Saving…',
}

type Tool = 'brush' | 'eraser' | 'smudge' | 'lasso' | 'rect' | 'move' | 'eyedropper' | 'layerpick' | 'hand' | 'text'

/** The app's background colour as #rrggbb (the theme's --bg), for the cursor's contrast over see-through areas. */
function appBackground(): string {
  const c = document.createElement('canvas').getContext('2d')!
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#000000'
  return c.fillStyle.startsWith('#') ? c.fillStyle : '#000000'
}

const wallpapers = new Map<string, HTMLImageElement>()

/**
 * Draw's Blurred paper as one picture the size of the view: the app background and wallpaper (projectTheme.tsx puts
 * them in CSS variables) where they sit behind the view, blurred and tinted. Made again only when those change; the
 * GPU draws it under the drawing inside the canvas outline, in the same canvas (no extra page layer to flicker).
 * Returns the key it was made for, or null while the wallpaper image is still loading.
 */
function paperPicture(c: HTMLCanvasElement, w: number, h: number, dpr: number, at: DOMRect, tint: string, loaded: () => void): string | null {
  const css = getComputedStyle(document.documentElement)
  const url = /url\("?(.*?)"?\)/.exec(css.getPropertyValue('--wallpaper-image'))?.[1]
  const blur = parseFloat(css.getPropertyValue('--wallpaper-blur')) || 0
  const bg = css.getPropertyValue('--bg').trim() || '#000000'
  let img = url ? wallpapers.get(url) : undefined
  if (url && !img) {
    img = new Image()
    img.onload = loaded
    img.src = url
    wallpapers.set(url, img)
  }
  const ready = !img || (img.complete && img.naturalWidth > 0)
  const key = `${w}x${h}@${dpr}|${at.left},${at.top}|${innerWidth}x${innerHeight}|${bg}|${url}|${blur}|${tint}|${ready}`
  c.width = Math.max(1, Math.round(w * dpr))
  c.height = Math.max(1, Math.round(h * dpr))
  const g = c.getContext('2d')!
  g.fillStyle = bg
  g.fillRect(0, 0, c.width, c.height)
  if (img && ready) {
    // The wallpaper covers the window; this view shows the part of it behind the view.
    const s = Math.max(innerWidth / img.naturalWidth, innerHeight / img.naturalHeight)
    const iw = img.naturalWidth * s
    const ih = img.naturalHeight * s
    g.filter = `blur(${(blur + 18) * dpr}px)`
    g.drawImage(img, ((innerWidth - iw) / 2 - at.left) * dpr, ((innerHeight - ih) / 2 - at.top) * dpr, iw * dpr, ih * dpr)
    g.filter = 'none'
  }
  g.globalAlpha = 0.3
  g.fillStyle = tint
  g.fillRect(0, 0, c.width, c.height)
  g.globalAlpha = 1
  return key
}

/** Tools that paint: switching between them doesn't save (switching to any other tool does). */
const PAINT_TOOLS = new Set<Tool>(['brush', 'eraser', 'smudge'])

const TOOLS: { id: Tool; icon: LucideIcon; label: string; key: string }[] = [
  { id: 'brush', icon: BrushIcon, label: UI.brush, key: 'b' },
  { id: 'eraser', icon: Eraser, label: UI.eraser, key: 'e' },
  { id: 'smudge', icon: Fingerprint, label: UI.smudge, key: 's' },
  { id: 'lasso', icon: Lasso, label: UI.lasso, key: 'l' },
  { id: 'rect', icon: SquareDashed, label: UI.rectSelect, key: 'm' },
  { id: 'move', icon: Move, label: UI.move, key: 'v' },
  { id: 'eyedropper', icon: Pipette, label: UI.eyedropper, key: 'i' },
  { id: 'layerpick', icon: Layers2, label: UI.layerPick, key: 'k' },
  { id: 'hand', icon: Hand, label: UI.hand, key: 'h' },
  { id: 'text', icon: Type, label: 'Text (T): click to add text, drag a text box to move it', key: 't' },
]

/** Icons for the Hotwheel bubbles (the glass look shows these instead of words). Actions without one keep their name. */
const ACTION_ICON: Partial<Record<ActionId, LucideIcon>> = {
  undo: Undo2,
  redo: Redo2,
  rotateLeft: RotateCcw,
  rotateRight: RotateCw,
  newLayer: LayersIcon,
  fill: PaintBucket,
  clear: Trash2,
  deselect: X,
  flipLayerX: FlipHorizontal2,
  flipLayerY: FlipVertical2,
  flipView: FlipHorizontal,
  fit: Scan,
  importFile: ImagePlus,
  inputSettings: Settings2,
  shortcuts: Keyboard,
  companion: PictureInPicture2,
}
const actionIcon = (id: ActionId) => TOOLS.find((t) => t.id === toolOf(id))?.icon ?? ACTION_ICON[id]

const SWATCHES = ['#111111', '#ffffff', '#e5484d', '#f08c2e', '#f5d90a', '#30a46c', '#3e8ef7', '#8e6cf0', '#d6409f', '#8d6e63']

export interface SketchEditorProps {
  doc: SketchDoc
  /** Structural changes (layers, references, background). Pixels are saved as PNG assets by the editor itself. */
  update(recipe: (d: SketchDoc) => SketchDoc): void
  /** Keyboard shortcuts only while true. */
  active: boolean
  /** Used for the export file name. */
  title: string
  /** Extra buttons in the top bar, e.g. "Send to…". They get the flattened picture on demand. */
  actions?: (flatten: () => Promise<Blob>) => ReactNode
  /** Colors shown as swatches; defaults to a basic set. */
  swatches?: string[]
  /** Extra sections at the top of the side panel. */
  panel?: ReactNode
  /** Imperative access for the host tool. */
  editorRef?: Ref<SketchEditorHandle>
  /** 0.31: paint and moved pixels can go past the canvas's edges (the working area grows); Draw only. */
  growable?: boolean
  /** 0.31: keep the undo history between sessions under this document id (Draw). */
  historyId?: Id
  /** Writes the host's document now; called whenever the pixels are saved, so both are saved together. */
  flushDoc?: () => Promise<void>
}

export interface SketchEditorHandle {
  /** Put an image from the project's assets on a new layer, fitted into the canvas (or stretched over all of it with `fill`). */
  insertImage(path: string, name?: string, opts?: { fill?: boolean; layer?: Partial<SketchLayer> }): Promise<void>
  setColor(color: string): void
  color: string
  /** v0.14 (Texture Paint): the engine, for watching `version` and reading the flattened picture. */
  engine: SketchEngine
  /** The flattened picture with background. */
  render(): HTMLCanvasElement
  /** Paint a stroke at canvas points from outside (e.g. a 3D view), with the current brush, colour and layer. */
  paintDown(p: InputPoint, time: number): boolean
  paintMove(p: InputPoint, time: number): void
  paintUp(): void
  /** Draw shapes onto the active layer from outside (Texture Paint's "Fill a part") as one undo step, in the current colour. False when the layer can't take paint. */
  paintShape(draw: (ctx: CanvasRenderingContext2D, color: string) => void): boolean
  /**
   * A new layer above the active one, filled with a picture (stretched over the canvas) or a colour, with an
   * optional mask (bright = shown): one undo step. Returns the new layer's and mask's ids.
   */
  insertPicture(picture: CanvasImageSource | string, name: string, opts?: { layer?: Partial<SketchLayer>; mask?: CanvasImageSource }): { layerId: Id; maskId: Id | null }
  /** Replace a layer's (or mask's) pixels with a picture stretched over the canvas, as one undo step. */
  replacePixels(layerId: Id, picture: CanvasImageSource): void
}

/** A raster editor: pressure brushes, layers with blend modes, selection, mirror and references (v0.5). */
/** Card canvas lines (0.23.3): the cut line (corners rounded) inside the bleed, and the safe area for text. */
function CardGuides({ g, width, height, scale }: { g: NonNullable<SketchDoc['cardGuides']>; width: number; height: number; scale: number }) {
  const s = g.bleed + g.safe
  return (
    <g fill="none" strokeWidth={1.5 / scale} pointerEvents="none">
      <rect x={g.bleed} y={g.bleed} width={width - 2 * g.bleed} height={height - 2 * g.bleed} rx={g.corner} stroke="#e5484d" />
      <rect x={s} y={s} width={width - 2 * s} height={height - 2 * s} stroke="var(--accent)" strokeDasharray={`${6 / scale} ${4 / scale}`} />
    </g>
  )
}

export function SketchEditor({ doc, update: save, active, title, actions, swatches = SWATCHES, panel, editorRef, growable = false, historyId, flushDoc }: SketchEditorProps) {
  const root = useProjectStore((s) => s.root)
  const engineRef = useRef<SketchEngine | null>(null)
  const colorSpace = doc.colorSpace ?? 'srgb'
  // A new engine only when the drawing's size was changed from outside (Canvas dialog, another file): when the
  // working area grows, the engine grows first and the drawing follows a moment later.
  const docSize = useRef({ w: doc.width, h: doc.height })
  // oxlint-disable-next-line react/refs -- compared during render on purpose, see above
  const resized = docSize.current.w !== doc.width || docSize.current.h !== doc.height
  // oxlint-disable-next-line react/refs
  docSize.current = { w: doc.width, h: doc.height }
  const mismatch = engineRef.current && (engineRef.current.width !== doc.width || engineRef.current.height !== doc.height)
  // oxlint-disable-next-line react/refs
  if (!engineRef.current || (mismatch && resized) || engineRef.current.colorSpace !== colorSpace) {
    // oxlint-disable-next-line react/refs -- the engine is a mutable drawing surface, created once per canvas size
    engineRef.current = new SketchEngine(doc.width, doc.height, colorSpace)
  }
  // oxlint-disable-next-line react/refs
  const engine = engineRef.current
  /** Changes to the document; a change to the layer list becomes an undo step. */
  const update = (fn: (d: SketchDoc) => SketchDoc) =>
    save((d) => {
      const next = fn(d)
      const docChanged = next.guide !== d.guide || next.backgroundColor !== d.backgroundColor || next.frosted !== d.frosted
      const doc = docChanged ? { before: { guide: d.guide, backgroundColor: d.backgroundColor, frosted: d.frosted }, after: { guide: next.guide, backgroundColor: next.backgroundColor, frosted: next.frosted } } : undefined
      if (next.layers !== d.layers || doc) engine.layersChanged(d.layers, next.layers, doc)
      return next
    })
  const docRef = useRef(doc)
  const flushDocRef = useRef(flushDoc)
  useEffect(() => {
    docRef.current = doc
    flushDocRef.current = flushDoc
  })

  const boxRef = useRef<HTMLDivElement>(null)
  const viewCanvas = useRef<HTMLCanvasElement>(null)
  /** The Blurred paper picture and what it was made for (see paperPicture). */
  const paperRef = useRef<{ canvas: HTMLCanvasElement; key: string; version: number; theme?: string } | null>(null)
  const [view, setView] = useState<View | null>(null)
  const viewRef = useRef<View | null>(null)
  useEffect(() => {
    viewRef.current = view
  })
  const [tool, setTool] = useState<Tool>('brush')
  const sel = useSelector(engine, active, tool)
  const [libraryOpen, setLibraryOpen] = useState<'brush' | 'eraser' | null>(null)
  const [libraryAt, setLibraryAt] = useState({ x: 0, y: 0 })
  const [color, setColor] = useState('#111111')
  // Start on the top layer you can paint on (not a group or a mask).
  const [activeLayerId, setActiveLayerId] = useState<Id>([...doc.layers].reverse().find((l) => !l.kind)?.id ?? doc.layers[doc.layers.length - 1]?.id ?? '')
  const [, setVersion] = useState(0)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  /** The brush outline turns dark over light parts of the picture, so it shows on a white canvas. */
  const [cursorOnLight, setCursorOnLight] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  // Layers: in the side panel, floating over the canvas, or hidden behind the Layers button.
  const [layersMode, setLayersModeState] = useState<'docked' | 'floating'>(() => {
    try {
      return localStorage.getItem('egd.sketch.layersMode') === 'floating' ? 'floating' : 'docked'
    } catch {
      return 'docked'
    }
  })
  const [layersShown, setLayersShownState] = useState(() => {
    try {
      return localStorage.getItem('egd.sketch.layersShown') !== '0'
    } catch {
      return true
    }
  })
  const setLayersMode = (m: 'docked' | 'floating') => {
    setLayersModeState(m)
    try {
      localStorage.setItem('egd.sketch.layersMode', m)
    } catch {
      // Only a convenience.
    }
  }
  const setLayersShown = (v: boolean) => {
    setLayersShownState(v)
    try {
      localStorage.setItem('egd.sketch.layersShown', v ? '1' : '0')
    } catch {
      // Only a convenience.
    }
  }
  const layersStart = () => ({ x: window.innerWidth - 640, y: 110 })
  const textStart = () => ({ x: 340, y: 110 })
  const [layersSpot, setLayersSpot] = useSpot('egd.sketch.layersSpot', layersStart)
  const [textSpot, setTextSpot] = useSpot('egd.sketch.textSpot', textStart)
  const lightStart = () => ({ x: 340, y: 110 })
  const [lightSpot, setLightSpot] = useSpot('egd.sketch.lightSpot', lightStart)
  const [lightShown, setLightShown] = useState(false)
  /** Show the layers again, wherever they went; floating panels go back to where they start. */
  const bringBack = (mode: 'docked' | 'floating') => {
    setLayersMode(mode)
    setLayersShown(true)
    setLayersSpot(layersStart())
    setTextSpot(textStart())
    setLightSpot(lightStart())
  }
  /** The stabilization string from the brush tip to the pen while drawing. */
  const [tether, setTether] = useState<{ tip: { x: number; y: number }; pen: { x: number; y: number } } | null>(null)
  const [saving, setSaving] = useState(false)
  const [pickingRef, setPickingRef] = useState(false)
  const spaceDown = useRef(false)
  const altDown = useRef(false)
  const ctrlDown = useRef(false)
  /** The layer the Layer picker points at. */
  const [pointed, setPointed] = useState<Id | null>(null)

  // Sketch Pro: pen and keys settings, drawing guide, QuickMenu, Edit Shape, touch.
  const input = useInputSettings()
  useEffect(() => {
    void useInputSettings.getState().load()
  }, [])
  const guide = normalizeGuide(doc.guide, doc.width, doc.height)
  const liveGuide = activeGuide(guide)
  const setGuide = (g: DrawingGuide) => update((d) => ({ ...d, guide: g }))
  const [editingGuide, setEditingGuide] = useState(false)
  const [inputOpen, setInputOpen] = useState(false)
  const [shapeOffer, setShapeOffer] = useState<ShapeOffer | null>(null)
  const [hoverEraser, setHoverEraser] = useState(false)
  const [touch] = useState(() => new TouchGestures())
  const pinchStart = useRef<{ epoch: number; view: View } | null>(null)
  /** Last pointer position in stage pixels (where the QuickMenu opens from a key). */
  const lastPointer = useRef<{ x: number; y: number } | null>(null)

  // Sketch Pro: Adjustments, Liquify and Clone.
  const [adjust, setAdjust] = useState<AdjustMode | null>(null)
  const [adjustMenu, setAdjustMenu] = useState(false)
  const refresh = useCallback(() => setVersion(engine.version), [engine])

  const activeLayer = doc.layers.find((l) => l.id === activeLayerId) ?? doc.layers[doc.layers.length - 1]
  const xf = useTransformer(engine, sel, { active, tool, layerId: activeLayer?.id, done: (id) => markDirty(id) })
  const lib = useBrushLibrary()
  useEffect(() => {
    void useBrushLibrary.getState().load()
  }, [])
  const brushMode = tool === 'eraser' ? 'eraser' : 'brush'
  const brush = lib.brushes.find((b) => b.id === (brushMode === 'eraser' ? lib.eraserId : lib.brushId)) ?? lib.brushes[0]
  // The sliders change the brush itself and are remembered.
  const setBrush = (patch: Partial<typeof brush>) => lib.updateBrush(brush.id, patch)

  // ---- Loading and saving layer pixels -------------------------------------

  /** Layer id -> the asset path its pixels came from or were last saved to. */
  const loaded = useRef(new Map<Id, string | null>())
  const dirty = useRef(new Set<Id>())
  /** Layers whose saved pixels are still being read; they are not saved until then, or the saved picture would be lost. */
  const loading = useRef(new Set<Id>())
  /** Schedules a pixel save; set once `flush` exists. */
  const resave = useRef(() => {})
  /** Pixel saves go through the app's auto-save, so closing the app or project writes them too. */
  const saveKey = useRef(`${root}|sketch-pixels/${newId()}`).current
  const historyFile = useMemo(() => (root && historyId ? new SketchHistoryFile(root, historyId) : null), [root, historyId, engine])
  const historyTried = useRef<SketchHistoryFile | null>(null)
  /** Once every layer is loaded: put back the undo steps from the last session (0.31). */
  const loadHistory = () => {
    if (!historyFile || historyTried.current === historyFile || loading.current.size) return
    historyTried.current = historyFile
    void historyFile.load(engine, new Set(docRef.current.layers.map((l) => l.id))).then((n) => n && setVersion(engine.version))
  }

  useEffect(() => {
    if (!root) return
    // No cancel on cleanup: a stale result is dropped by the path check below, and
    // cancelling would lose loads when effects run twice (React strict mode).
    for (const layer of doc.layers) {
      if (isGroup(layer)) continue
      if (dirty.current.has(layer.id) || loaded.current.get(layer.id) === layer.image) continue
      if (loaded.current.has(layer.id) && engine.stroking) continue
      loaded.current.set(layer.id, layer.image)
      if (!layer.image) {
        engine.setLayerImage(layer.id, null)
        setVersion(engine.version)
        continue
      }
      const path = layer.image
      loading.current.add(layer.id)
      // Read through the file system (same-origin blob) so the canvas is never tainted and can be saved again.
      void resolveAssetPath(root, path)
        .then((abs) => getFs().readBinary(abs))
        .then((bytes) => createImageBitmap(new Blob([bytes as BlobPart])))
        .then((bmp) => {
          if (loaded.current.get(layer.id) !== path) return
          // Painted on while it was loading: keep the new paint on top of the saved picture.
          if (dirty.current.has(layer.id)) engine.underlay(layer.id, bmp)
          else engine.setLayerImage(layer.id, bmp)
          setVersion(engine.version)
        })
        .catch(() => {})
        .finally(() => {
          loading.current.delete(layer.id)
          // Paint that waited for the picture can be saved now.
          if (dirty.current.has(layer.id)) resave.current()
          loadHistory()
        })
    }
    loadHistory()
    for (const id of [...loaded.current.keys()]) {
      if (!doc.layers.some((l) => l.id === id)) {
        loaded.current.delete(id)
        engine.dropLayer(id)
      }
    }
  }, [doc.layers, root, engine])

  const stickerKey = useRef(`${root}|sketch-sticker/${newId()}`).current
  /** The sticker: the whole picture without background, for Storyboard, Moodboards and pickers. */
  const saveSticker = useCallback(async () => {
    if (!root) return
    const sticker = await importAssetFromBlob(root, await engine.flattenedPng({ ...docRef.current, layers: exportLayers(docRef.current.layers) }, false), 'image', 'sticker.png')
    const prev = docRef.current.sticker
    save((d) => ({ ...d, sticker: sticker?.path ?? null }))
    // Not deleted: a backup may still show it (retired files go once no kept backup mentions them).
    if (prev && prev !== sticker?.path) void retireAssets(root, [prev])
  }, [root, engine])

  const flushNow = useCallback(async () => {
    if (!root || !dirty.current.size) return
    const ids = [...dirty.current].filter((id) => !loading.current.has(id))
    for (const id of ids) dirty.current.delete(id)
    if (!ids.length) {
      if (dirty.current.size) resave.current()
      return
    }
    setSaving(true)
    const saved = new Map<Id, string | null>()
    for (const id of ids) {
      if (!docRef.current.layers.some((l) => l.id === id)) continue
      if (engine.isEmpty(id)) saved.set(id, null)
      else {
        const asset = await importAssetFromBlob(root, await engine.layerPng(id), 'image', 'layer.png')
        if (asset) saved.set(id, asset.path)
      }
    }
    const old: string[] = []
    for (const [id, path] of saved) {
      const prev = loaded.current.get(id)
      if (prev && prev !== path) old.push(prev)
      loaded.current.set(id, path)
    }
    save((d) => ({ ...d, layers: d.layers.map((l) => (saved.has(l.id) ? { ...l, image: saved.get(l.id)! } : l)) }))
    // The sticker (the whole picture) is made less often: a while after the last stroke, and when the app closes.
    scheduleSave(stickerKey, saveSticker, IDLE_SAVE_MS)
    // Each save writes a new PNG (assets are write-once). The replaced ones are retired, not deleted, so restoring a backup brings them back.
    void retireAssets(root, old)
    void historyFile?.sync(engine)
    await flushDocRef.current?.()
    setSaving(false)
  }, [root, engine, update])
  // Sketch Pro: one save at a time, so an older save never lands after a newer one (and reloads old pixels).
  const flushQueue = useRef<Promise<void>>(Promise.resolve())
  const flush = useCallback(() => (flushQueue.current = flushQueue.current.then(flushNow, flushNow)), [flushNow])
  useEffect(() => {
    resave.current = () => scheduleSave(saveKey, flush, 500)
  }, [saveKey, flush])

  const markDirty = useCallback(
    (id: Id | null) => {
      if (!id) return
      dirty.current.add(id)
      setVersion(engine.version)
      scheduleSave(saveKey, flush, IDLE_SAVE_MS)
    },
    [engine, flush, saveKey],
  )

  /**
   * 0.31: make room past the canvas's edge before paint or moved pixels reach the working area's edge.
   * Only between strokes; the view moves along so nothing jumps, and every layer is saved again at the new size.
   */
  const growTo = (r: Rect, margin: number) => {
    if (!growable || engine.stroking) return null
    const g = growFor(engine.width, engine.height, r, margin)
    if (!g) return null
    engine.grow(g, (m) => shiftDocData(m, g))
    xf.grow(g)
    sel.refresh()
    const v = viewRef.current
    if (v) {
      const [a, b, c, d] = viewMatrix(v)
      const next = { ...v, x: v.x - (a * g.left + c * g.top), y: v.y - (b * g.left + d * g.top) }
      viewRef.current = next
      setView(next)
    }
    save((d) => growDoc(d, g))
    for (const l of doc.layers) if (hasPixels(l)) markDirty(l.id)
    return g
  }

  // ColorDrop: drag the colour onto the canvas to fill (Sketch Pro).
  const drop = useColorDrop(
    engine,
    {
      doc,
      layer: activeLayer,
      toDoc: (cx, cy) => {
        const r = viewCanvas.current?.getBoundingClientRect()
        const v = viewRef.current
        if (!r || !v || cx < r.left || cy < r.top || cx > r.right || cy > r.bottom) return null
        const q = toDocPoint(v, { x: cx - r.left, y: cy - r.top })
        return q.x < 0 || q.y < 0 || q.x >= doc.width || q.y >= doc.height ? null : q
      },
      markDirty,
    },
    tool,
  )
  /** Switching sRGB / Display P3 makes a new engine; pixels are saved first and loaded again. */
  const setColorSpace = async (cs: 'srgb' | 'display-p3') => {
    await flush()
    loaded.current.clear()
    update((d) => ({ ...d, colorSpace: cs }))
  }

  // Save on unmount (closing the panel or the app).
  useEffect(
    () => () => void flushSave(saveKey),
    [saveKey],
  )

  // Sketch Pro: Animation Assist and Page Assist (the view below draws through it).
  const adoptLayer = useCallback((id: Id) => void loaded.current.set(id, null), [])
  const assist = useAssist({ doc, update, engine, activeId: activeLayer?.id, setActive: setActiveLayerId, markDirty, adopt: adoptLayer, limit: maxLayers(doc.width, doc.height) })

  // ---- View ---------------------------------------------------------------

  const fit = useCallback(() => {
    const box = boxRef.current
    if (!box) return
    const f = doc.frame ?? { x: 0, y: 0, w: doc.width, h: doc.height }
    const scale = Math.min((box.clientWidth - 40) / f.w, (box.clientHeight - 40) / f.h, 1)
    setView({ scale, x: (box.clientWidth - f.w * scale) / 2 - f.x * scale, y: (box.clientHeight - f.h * scale) / 2 - f.y * scale })
  }, [doc.width, doc.height, doc.frame])

  useEffect(() => {
    if (!view) fit()
  }, [view, fit])

  // Sketch Pro: canvas changes, stats, time-lapse, import/export, Reference Companion.
  const files = useSketchFiles({ doc, update, engine, root, title, activeId: activeLayer?.id, setActive: setActiveLayerId, flush, fit })

  // 0.31: good moments to save (a short pause doesn't matter there): the layer list changed, or a tool other than
  // a brush was picked. Otherwise only after IDLE_SAVE_MS, on leaving the window or the tool, and on closing.
  const layerOrder = doc.layers.map((l) => l.id).join('|')
  const saveNow = useCallback(() => void flushSave(saveKey).then(() => flushDocRef.current?.()), [saveKey])
  useEffect(saveNow, [layerOrder, saveNow])
  useEffect(() => {
    if (!PAINT_TOOLS.has(tool)) saveNow()
  }, [tool, saveNow])

  // The GPU's view of the picture sits under the visible canvas (a new one after the working area grew).
  const gpuView = engine.view
  useEffect(() => {
    const box = boxRef.current
    if (!gpuView || !box) return
    // Right under the canvas that takes the pen, over the Blurred paper.
    box.insertBefore(gpuView, viewCanvas.current)
    // A lost GPU is replaced on the next draw (at most once a second): draw again then, so the picture comes back.
    const lost = () => setTimeout(() => setVersion((v) => v + 1), 1100)
    gpuView.addEventListener('webglcontextlost', lost)
    return () => (gpuView.removeEventListener('webglcontextlost', lost), gpuView.remove())
  }, [gpuView])

  // Redraw the visible canvas.
  useEffect(() => {
    const canvas = viewCanvas.current
    const box = boxRef.current
    if (!canvas || !box || !view) return
    const dpr = window.devicePixelRatio || 1
    const w = box.clientWidth
    const h = box.clientHeight
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    const ctx = canvas.getContext('2d', { colorSpace })!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.save()
    ctx.transform(...viewMatrix(view))
    // Transparent: nothing is drawn behind the picture, so the app's own background and wallpaper show through.
    ctx.imageSmoothingEnabled = view.scale < 1 || !!view.rot
    // With a graphics card the picture is drawn under this canvas, straight from the GPU (0.31).
    const frame = doc.frame ?? { x: 0, y: 0, w: doc.width, h: doc.height }
    let paper: { image: HTMLCanvasElement; version: number; frame: typeof frame } | null = null
    if (paperMode(doc) === 'blurred') {
      const p = (paperRef.current ??= { canvas: document.createElement('canvas'), key: '', version: 0 })
      const at = box.getBoundingClientRect()
      const probe = `${w}x${h}@${dpr}|${at.left},${at.top}|${innerWidth}x${innerHeight}|${doc.frosted}`
      if (!p.key.includes(probe) || p.key.endsWith('|false') || p.theme !== document.documentElement.style.cssText) {
        p.key = paperPicture(p.canvas, w, h, dpr, at, doc.frosted ?? '#ffffff', () => setVersion((v) => v + 1)) ?? ''
        p.theme = document.documentElement.style.cssText
        p.version++
      }
      paper = { image: p.canvas, version: p.version, frame }
    }
    const gpuShown = !assist.mode && engine.draw(doc, viewMatrix(view), w, h, dpr, ctx.imageSmoothingEnabled, pointed ? { id: pointed, color: getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#3e8ef7' } : null, paper)
    if (engine.view) engine.view.style.visibility = gpuShown ? '' : 'hidden'
    if (!gpuShown) {
      if (paper) {
        // Canvas 2D: the same paper, cut to the canvas outline, under the picture.
        ctx.save()
        ctx.beginPath()
        ctx.rect(frame.x, frame.y, frame.w, frame.h)
        ctx.clip()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(paper.image, 0, 0)
        ctx.restore()
      }
      assist.paint(ctx)
    }
    // Transparent pages are just a white outline over the app's wallpaper.
    const px = 1 / view.scale
    const f = doc.frame ?? { x: 0, y: 0, w: doc.width, h: doc.height }
    if (doc.frame) {
      // 0.31: paint past the canvas's edges stays, dimmed; exports are cut to the canvas. Only where there is paint:
      // the rest of the working area stays invisible.
      const used = engine.paintedBounds(doc.layers.filter((l) => l.visible && l.kind !== 'group' && l.kind !== 'adjust').map((l) => l.id))
      const u = used ? { x: Math.min(used.x, f.x), y: Math.min(used.y, f.y), r: Math.max(used.x + used.w, f.x + f.w), b: Math.max(used.y + used.h, f.y + f.h) } : null
      if (u) {
        ctx.beginPath()
        ctx.rect(u.x, u.y, u.r - u.x, u.b - u.y)
        ctx.rect(f.x, f.y, f.w, f.h)
        ctx.fillStyle = 'rgba(0,0,0,0.45)'
        ctx.fill('evenodd')
      }
    }
    ctx.strokeStyle = doc.backgroundColor ? 'rgba(128,128,128,0.6)' : '#ffffff'
    ctx.lineWidth = (doc.backgroundColor ? 1 : 1.5) * px
    ctx.strokeRect(f.x - 0.5 * px, f.y - 0.5 * px, f.w + px, f.h + px)
    ctx.restore()
  })

  const toDoc = (e: { clientX: number; clientY: number }, r = viewCanvas.current!.getBoundingClientRect()) => {
    const z = zoomOf(viewCanvas.current)
    return toDocPoint(viewRef.current!, { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z })
  }

  // ---- Pointer input ------------------------------------------------------

  const gesture = useRef<
    | {
        kind: 'paint'
        /** Motion filter, stabilization, StreamLine and Drawing Assist for this stroke. */
        pipeline: PenPipeline
        last: PenPoint
        /** Where the canvas was when the stroke began: if anything moves the layout mid-stroke, the line still doesn't jump. */
        rect: DOMRect
        opts: Parameters<SketchEngine['beginStroke']>[0]
        /** Every point so far, for QuickShape. */
        pts: InputPoint[]
        /** Where the pointer rests; the hold timer restarts when it moves. */
        rest: { x: number; y: number }
        timer?: ReturnType<typeof setTimeout>
        /** Set once the stroke snapped to a shape; further moves resize it. */
        snapped?: { shape: Shape; at: { x: number; y: number }; pressure: number; drawn?: Shape; perfect?: boolean }
      }
    | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
    | { kind: 'select'; pts: { x: number; y: number }[]; rect: boolean }
    | { kind: 'move'; from: { x: number; y: number }; to: { x: number; y: number } }
    | null
  >(null)

  const painting = tool === 'brush' || tool === 'eraser' || tool === 'smudge'
  const effectiveTool = (): Tool => (spaceDown.current ? 'hand' : altDown.current && (tool === 'brush' || tool === 'eraser') ? 'eyedropper' : ctrlDown.current && painting ? 'layerpick' : tool)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Moves from before the press belong to the hover, not to the new stroke.
    flushMove()
    if (!view || !activeLayer) return
    if (shapeOffer) {
      // Any tap on the canvas ends Edit Shape (or drops the offer).
      finishShapeEdit()
      if (shapeOffer.editing) return
    }
    if (e.pointerType === 'touch' && touchDown(e)) return
    let t: Tool = e.button === 1 && e.pointerType !== 'pen' ? 'hand' : e.pointerType === 'touch' && !input.fingerDraws ? 'hand' : effectiveTool()
    const side = penButton(e)
    if (side) {
      // Pen side buttons: tools are used while held, other actions run once.
      const act = input.penButtons[side]
      if (act === 'none') return
      const asTool = toolOf(act) as Tool | null
      if (!asTool) return runAction(act, e)
      t = asTool
    } else if (e.button !== 0 && e.button !== 1 && e.button !== 5) return
    if (isEraserEnd(e) && t !== 'hand' && t !== 'eyedropper') t = 'eraser'
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toDoc(e)
    // After a ColorDrop, clicks keep filling (or recolouring).
    if (drop.continuing && t !== 'hand' && e.button === 0) return drop.fillAt(p, drop.recolor ? color : drop.continuing)
    if (t === 'hand') {
      gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
    } else if (t === 'layerpick') {
      const id = engine.layerAt(doc.layers, p.x, p.y)
      if (id) setActiveLayerId(id)
    } else if (t === 'eyedropper') {
      const picked = engine.pickColor(doc, p.x, p.y)
      if (picked) setColor(picked)
    } else if (t === 'text') {
      textTool.down(p)
    } else if (t === 'brush' || t === 'eraser' || t === 'smudge') {
      if (!activeLayer.visible || !hasPixels(activeLayer) || activeLayer.text || lockedInTree(doc.layers, activeLayer.id)) return
      const own = lib.brushes.find((b) => b.id === (t === 'eraser' ? lib.eraserId : lib.brushId)) ?? brush
      // Smoothing, stabilization and tether are the brush's own, unless ticked in the side panel to use other values.
      const ov = input.overrides
      const strokeBrush = { ...own, streamline: ov.streamline ?? own.streamline, stabilization: ov.stabilization ?? own.stabilization, tether: ov.tether ?? own.tether }
      // The brush applies stabilization and motion filtering; the app-wide ones in Pen and keys add to them.
      // The tether reaches up to 150 screen pixels.
      const pipeline = new PenPipeline({
        streamline: strokeBrush.streamline,
        stabilization: input.stabilization,
        motionFilter: input.motionFilter,
        tether: (strokeBrush.tether * 150) / view.scale,
        constraint: assistFor(liveGuide, activeLayer.id, 8 / view.scale),
      })
      // Near the working area's edge: grow it first, so the stroke can go past the canvas.
      const at = growTo({ x: p.x - strokeBrush.size, y: p.y - strokeBrush.size, w: strokeBrush.size * 2, h: strokeBrush.size * 2 }, 128) ? toDoc(e) : p
      const pt = pipeline.push({ ...at, ...penData(e.nativeEvent, input.pressureCurve) }, e.timeStamp)[0] ?? { ...at, pressure: 1 }
      const opts = { layer: activeLayer, brush: strokeBrush, color, symmetry: 'off' as const, erase: t === 'eraser', smudge: t === 'smudge', mirror: symmetryMirror(liveGuide, activeLayer.id) }
      engine.beginStroke(opts, pt)
      gesture.current = { kind: 'paint', pipeline, last: pt, rect: e.currentTarget.getBoundingClientRect(), opts, pts: [pt], rest: pt }
      armHold()
      setVersion(engine.version)
    } else if (t === 'lasso' || t === 'rect') {
      gesture.current = { kind: 'select', pts: [p], rect: t === 'rect' }
      // The wand only looks at the active layer (or the reference layer, when one is set), never at the others.
      const ref = doc.layers.find((l) => l.reference && !isGroup(l)) ?? (activeLayer && hasPixels(activeLayer) ? activeLayer : null)
      sel.down(p, e, () => engine.pixels(doc, ref?.id ?? null))
    } else if (t === 'move') {
      if (!activeLayer.visible || !hasPixels(activeLayer) || lockedInTree(doc.layers, activeLayer.id)) return
      if (activeLayer.text) return textTool.down(p, true)
      // Transform: the first press lifts the pixels; later presses move, scale, turn or bend them.
      if (!xf.active && !xf.begin(activeLayer.id)) return
      xf.down(p, view.scale)
      gesture.current = { kind: 'move', from: p, to: p }
    }
  }

  // WebKitGTK (the Linux app) sends every pen move, many per frame, and each one re-rendered the editor.
  // Moves are handled once per frame instead (Chromium does that by itself); a stroke still gets every point.
  const pendingMove = useRef<{ e: React.PointerEvent<HTMLCanvasElement>; events: PointerEvent[]; raf: number } | null>(null)
  const flushMove = () => {
    const q = pendingMove.current
    if (!q) return
    cancelAnimationFrame(q.raf)
    pendingMove.current = null
    moveRef.current(q.e, q.events)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Pinch and pan with fingers need every finger's moves in order.
    if (e.pointerType === 'touch') return moveNow(e)
    // The coalesced list is read now, while the event is being handled.
    const got = e.nativeEvent.getCoalescedEvents?.() ?? []
    const q = (pendingMove.current ??= { e, events: [], raf: requestAnimationFrame(flushMove) })
    q.e = e
    q.events.push(...(got.length ? got : [e.nativeEvent]))
  }
  useEffect(() => () => cancelAnimationFrame(pendingMove.current?.raf ?? 0), [])

  const moveNow = (e: React.PointerEvent<HTMLCanvasElement>, queued?: PointerEvent[]) => {
    if (!view) return
    const p = toDoc(e)
    setCursor(p)
    if (!gesture.current && (tool === 'brush' || tool === 'eraser' || tool === 'smudge')) {
      // Over see-through areas (past the canvas, or a transparent canvas) the app's own background is what's behind.
      const under = engine.pickColor(doc, p.x, p.y) ?? appBackground()
      const [r, g, b] = hexToRgb(under)
      const light = 0.299 * r + 0.587 * g + 0.114 * b > 140
      if (light !== cursorOnLight) setCursorOnLight(light)
    }
    lastPointer.current = pointIn(viewCanvas.current!, e)
    if (!gesture.current) {
      const id = effectiveTool() === 'layerpick' ? engine.layerAt(doc.layers, p.x, p.y) : null
      if (id !== pointed) setPointed(id)
    }
    if (isEraserEnd(e) !== hoverEraser) setHoverEraser(!hoverEraser)
    if (e.pointerType === 'touch' && touchMove(e)) return
    if (textTool.move(p)) return
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pan') {
      const z = zoomOf(viewCanvas.current)
      setView({ ...view, x: g.vx + (e.clientX - g.sx) / z, y: g.vy + (e.clientY - g.sy) / z })
    } else if (g.kind === 'paint') {
      if (g.snapped) {
        g.snapped.at = g.snapped.at ?? p
        // Shaky hands: wobbling near where it snapped keeps the shape still.
        const near = Math.hypot(p.x - g.snapped.at.x, p.y - g.snapped.at.y) * (view?.scale ?? 1) <= holdTolerance()
        drawShape(g, near ? g.snapped.at : p)
        // Resting again while resizing also makes the shape perfect.
        if (Math.hypot(p.x - g.rest.x, p.y - g.rest.y) * (view?.scale ?? 1) > holdTolerance()) {
          g.rest = p
          armPerfect(g)
        }
        return
      }
      const events = queued ?? e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
      for (const ev of events.length ? events : [e.nativeEvent]) {
        for (const q of g.pipeline.push({ ...toDoc(ev, g.rect), ...penData(ev, input.pressureCurve) }, ev.timeStamp)) {
          engine.strokeTo(q)
          g.pts.push(q)
          g.last = q
        }
      }
      const tip = g.pipeline.tetherTip
      setTether(tip ? { tip, pen: p } : null)
      // Predicted points ahead of the pen: shown in the live stroke only, replaced on the next move, never saved.
      // Not with smoothing: the drawn line trails the pen then, and a guess drawn from the pen floats loose ahead of it.
      const b = g.opts.brush
      const smoothed = b.streamline > 0 || b.stabilization > 0 || b.motionFilter > 0 || b.tether > 0 || input.stabilization > 0 || input.motionFilter > 0
      const predicted = smoothed ? [] : (e.nativeEvent.getPredictedEvents?.() ?? [])
      engine.predict(g.pipeline.peek(predicted.map((ev) => ({ p: { ...toDoc(ev, g.rect), ...penData(ev, input.pressureCurve) }, t: ev.timeStamp }))), g.last)
      // QuickShape: the hold timer restarts whenever the pointer really moves (a shaky hold still counts as holding).
      if (Math.hypot(p.x - g.rest.x, p.y - g.rest.y) * (view?.scale ?? 1) > holdTolerance()) {
        g.rest = p
        armHold()
      }
      setVersion(engine.version)
    } else if (g.kind === 'select') {
      sel.move(p, e)
    } else if (g.kind === 'move') {
      xf.move(p, view.scale, e.shiftKey)
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    flushMove()
    if (e.pointerType === 'touch' && touchUp(e)) return
    textTool.up()
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (g.kind === 'paint') {
      setTether(null)
      clearTimeout(g.timer)
      // Let stabilization catch up with the pen (not for a snapped shape, which is redrawn whole).
      if (!g.snapped) for (const q of g.pipeline.flush()) engine.strokeTo(q)
      markDirty(engine.endStroke())
      files.stroked()
      // Room for the next stroke when this one came near the edge.
      const b = boundsOf(g.pts, g.opts.brush.size)
      if (b) growTo(b, Math.max(256, g.opts.brush.size * 2))
      if (g.snapped?.drawn && lastPointer.current) {
        setShapeOffer({ shape: g.snapped.drawn, opts: g.opts, pressure: g.snapped.pressure, start: g.pts[0], at: lastPointer.current, editing: false })
      }
    }
    else if (g.kind === 'select') {
      sel.up(viewRef.current?.scale ?? 1)
    } else if (g.kind === 'move') {
      xf.up()
      // Pixels moved near or past the edge keep their room, so they aren't cut when they are dropped.
      const b = xf.bounds
      if (b) growTo(b, 128)
    }
  }

  /** QuickShape: after resting HOLD_MS at the end of a stroke it snaps to a clean shape. */
  const armHold = () => {
    const g = gesture.current
    if (g?.kind !== 'paint') return
    clearTimeout(g.timer)
    g.timer = setTimeout(() => {
      if (gesture.current !== g || g.snapped) return
      const shape = recognize(g.pts, holdTolerance() / (viewRef.current?.scale ?? 1))
      if (!shape) return
      const pressure = g.pts.reduce((s, q) => s + q.pressure, 0) / g.pts.length
      g.snapped = { shape, at: g.rest, pressure }
      drawShape(g, g.rest)
      armPerfect(g)
    }, HOLD_MS)
  }
  /** Keep holding after the snap: the shape turns perfect (circle, square, clean angle), like Shift. */
  const armPerfect = (g: Extract<NonNullable<typeof gesture.current>, { kind: 'paint' }>) => {
    clearTimeout(g.timer)
    if (g.snapped?.perfect) return
    g.timer = setTimeout(() => {
      if (gesture.current !== g || !g.snapped) return
      g.snapped.perfect = true
      drawShape(g, g.rest)
    }, PERFECT_MS)
  }

  /** Draw the snapped shape, resized toward `to`; Shift makes it perfect. */
  const drawShape = (g: Extract<NonNullable<typeof gesture.current>, { kind: 'paint' }>, to: { x: number; y: number }) => {
    if (!g.snapped) return
    let shape = resize(g.snapped.shape, g.snapped.at, to)
    shape = keys.shift || g.snapped.perfect ? perfect(shape) : gentle(shape)
    g.snapped.drawn = shape
    engine.restroke(shapeOutline(shape, 2, g.pts[0]).map((q) => ({ ...q, pressure: g.snapped!.pressure })))
    setVersion(engine.version)
  }

  const onWheel = (e: React.WheelEvent) => {
    if (!view) return
    setView(zoomAbout(view, Math.exp(-e.deltaY * 0.0015), pointIn(viewCanvas.current!, e)))
  }

  // ---- Commands ------------------------------------------------------------

  /** Undo and redo also bring back (or take away again) layers a merge or delete changed (v0.17). */
  const applyMeta = () => {
    const m = engine.lastMeta
    if (!m) return
    const { before, after, doc: fields } = m.meta as { before: SketchLayer[]; after: SketchLayer[]; doc?: { before: Partial<SketchDoc>; after: Partial<SketchDoc> } }
    // Keep where each layer's pixels are saved now; the step only knows the paths from back then.
    const saved = new Map(doc.layers.map((l) => [l.id, l.image]))
    const layers = (m.which === 'before' ? before : after).map((l) => (saved.has(l.id) ? { ...l, image: saved.get(l.id)! } : l))
    save((d) => ({ ...d, ...fields?.[m.which], layers }))
    if (activeLayer && !layers.some((l) => l.id === activeLayer.id)) setActiveLayerId(layers.filter((l) => l.kind !== 'group').at(-1)?.id ?? layers[0].id)
  }
  const undo = () => {
    markDirty(engine.undo())
    applyMeta()
    sel.sync()
  }
  const redo = () => {
    markDirty(engine.redo())
    applyMeta()
    sel.sync()
  }

  const layerLimit = maxLayers(doc.width, doc.height)
  const layerHost: LayerHost = {
    doc,
    update,
    engine,
    activeId: activeLayer?.id,
    setActive: setActiveLayerId,
    markDirty,
    adopt: (id) => loaded.current.set(id, null),
    // v0.17: files of removed layers stay, so undo can bring the layers back.
    // ponytail: removed layers leave their PNG in assets; clean up unused assets if folders grow.
    discard: () => {},
    restructure: (layers, layerId, pushesBefore) => {
      engine.structure(layerId, { before: doc.layers, after: layers }, pushesBefore)
      save((d) => ({ ...d, layers }))
    },
    limit: layerLimit,
    pointedId: pointed,
    title,
    color,
    selectFrom: (canvas) => sel.fromCanvas(canvas),
  }
  // Sketch Pro: text layers are drawn again when their settings or fonts change.
  const fontsReady = useImportedFonts(root, doc.fonts)
  useTextLayers(layerHost, fontsReady)
  const textTool = useTextTool(layerHost)

  const insertImage = async (path: string, name = 'Image', opts: { fill?: boolean; layer?: Partial<SketchLayer> } = {}) => {
    if (!root) return
    const bytes = await getFs().readBinary(await resolveAssetPath(root, path))
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]))
    const layer = { ...newLayer(name), ...opts.layer }
    const s = opts.fill ? 1 : Math.min(1, (doc.width * 0.8) / bmp.width, (doc.height * 0.8) / bmp.height)
    const w = opts.fill ? doc.width : bmp.width * s
    const h = opts.fill ? doc.height : bmp.height * s
    loaded.current.set(layer.id, null)
    engine.setLayerImage(layer.id, null)
    engine.edit(layer.id, (ctx) => ctx.drawImage(bmp, (doc.width - w) / 2, (doc.height - h) / 2, w, h))
    const i = docRef.current.layers.findIndex((l) => l.id === activeLayer?.id)
    update((d) => ({ ...d, layers: [...d.layers.slice(0, i + 1), layer, ...d.layers.slice(i + 1)] }))
    if (opts.fill) return markDirty(layer.id)
    setActiveLayerId(layer.id)
    setTool('move')
    markDirty(layer.id)
  }

  const insertPicture = (picture: CanvasImageSource | string, name: string, opts: { layer?: Partial<SketchLayer>; mask?: CanvasImageSource } = {}) => {
    const layer = { ...newLayer(name), ...opts.layer }
    const stretch = (ctx: CanvasRenderingContext2D, img: CanvasImageSource) => ctx.drawImage(img, 0, 0, doc.width, doc.height)
    loaded.current.set(layer.id, null)
    engine.setLayerImage(layer.id, null)
    engine.edit(layer.id, (ctx) => {
      if (typeof picture !== 'string') return stretch(ctx, picture)
      ctx.fillStyle = picture
      ctx.fillRect(0, 0, doc.width, doc.height)
    })
    let layers = insertAbove(docRef.current.layers, layer, activeLayer?.id)
    let maskId: Id | null = null
    if (opts.mask) {
      const m = addMask(layers, layer.id)
      layers = m.layers
      maskId = m.mask?.id ?? null
      if (maskId) {
        loaded.current.set(maskId, null)
        // A brand-new mask: no pixel undo of its own, the layer-list change below takes it away again.
        const full = Object.assign(document.createElement('canvas'), { width: doc.width, height: doc.height })
        stretch(full.getContext('2d')!, opts.mask)
        engine.setLayerImage(maskId, full)
      }
    }
    // Joins the pixel step above, so the layer and its mask come and go with one Ctrl+Z.
    update((d) => ({ ...d, layers }))
    markDirty(layer.id)
    if (maskId) markDirty(maskId)
    return { layerId: layer.id, maskId }
  }
  const replacePixels = (layerId: Id, picture: CanvasImageSource) => {
    markDirty(
      engine.edit(layerId, (ctx) => {
        ctx.clearRect(0, 0, doc.width, doc.height)
        ctx.drawImage(picture, 0, 0, doc.width, doc.height)
      }),
    )
    setVersion(engine.version)
  }

  const insertFromFile = async () => {
    if (!root) return
    for (const a of await pickAndImportAssets(root, 'image')) await insertImage(a.path, a.name.replace(/\.[^.]+$/, ''))
  }

  // v0.14: strokes from outside the canvas (Texture Paint's 3D view), through the same brush, pipeline and undo.
  const outside = useRef<PenPipeline | null>(null)
  const paintDown = (p: InputPoint, time: number) => {
    if (!activeLayer || !activeLayer.visible || !hasPixels(activeLayer) || activeLayer.text || lockedInTree(doc.layers, activeLayer.id)) return false
    const erase = tool === 'eraser'
    const own = lib.brushes.find((b) => b.id === (erase ? lib.eraserId : lib.brushId)) ?? brush
    const ov = input.overrides
    const strokeBrush = { ...own, streamline: ov.streamline ?? own.streamline, stabilization: ov.stabilization ?? own.stabilization, tether: 0 }
    outside.current = new PenPipeline({ streamline: strokeBrush.streamline, stabilization: input.stabilization, motionFilter: input.motionFilter })
    const pt = outside.current.push(p, time)[0] ?? p
    engine.beginStroke({ layer: activeLayer, brush: strokeBrush, color, symmetry: 'off', erase, smudge: tool === 'smudge', mirror: symmetryMirror(liveGuide, activeLayer.id) }, pt)
    setVersion(engine.version)
    return true
  }
  const paintMove = (p: InputPoint, time: number) => {
    if (!outside.current) return
    for (const q of outside.current.push(p, time)) engine.strokeTo(q)
    setVersion(engine.version)
  }
  const paintUp = () => {
    if (!outside.current) return
    for (const q of outside.current.flush()) engine.strokeTo(q)
    outside.current = null
    markDirty(engine.endStroke())
    files.stroked()
  }
  const paintShape = (draw: (ctx: CanvasRenderingContext2D, color: string) => void) => {
    if (!activeLayer || !activeLayer.visible || !hasPixels(activeLayer) || activeLayer.text || lockedInTree(doc.layers, activeLayer.id)) return false
    markDirty(engine.edit(activeLayer.id, (ctx) => {
      if (activeLayer.alphaLock) ctx.globalCompositeOperation = 'source-atop'
      draw(ctx, color)
    }))
    setVersion(engine.version)
    files.stroked()
    return true
  }
  useImperativeHandle(editorRef, () => ({ insertImage, setColor, color, engine, render: () => engine.render({ ...docRef.current, layers: exportLayers(docRef.current.layers) }), paintDown, paintMove, paintUp, paintShape, insertPicture, replacePixels }))

  const exportPng = async () => {
    await saveBinaryFile({
      title: UI.export,
      defaultName: `${safeFileName(title)}.png`,
      bytes: new Uint8Array(await (await engine.flattenedPng({ ...doc, layers: exportLayers(doc.layers) })).arrayBuffer()),
      filter: { name: 'PNG image', extensions: ['png'] },
    })
  }

  // ---- Sketch Pro: actions, touch gestures, Edit Shape ------------------------

  const stageCenter = () => ({ x: (boxRef.current?.clientWidth ?? 0) / 2, y: (boxRef.current?.clientHeight ?? 0) / 2 })
  const turnView = (angle: number) => view && setView(rotateAbout(view, angle, stageCenter()))
  const resizeBrush = (k: number) => {
    const st = useBrushLibrary.getState()
    const b = st.brushes.find((x) => x.id === (tool === 'eraser' ? st.eraserId : st.brushId))
    if (b) st.updateBrush(b.id, { size: Math.max(b.minSize, Math.min(b.maxSize, Math.round(b.size * k))) })
  }
  const sketchActions: Record<ActionId, () => void> = {
    shortcuts: () => setSheetOpen(true),
    'tool.brush': () => setTool('brush'),
    'tool.eraser': () => setTool('eraser'),
    'tool.smudge': () => setTool('smudge'),
    'tool.lasso': () => setTool('lasso'),
    'tool.rect': () => setTool('rect'),
    'tool.move': () => setTool('move'),
    'tool.eyedropper': () => setTool('eyedropper'),
    'tool.layerpick': () => setTool('layerpick'),
    'tool.hand': () => setTool('hand'),
    'tool.text': () => setTool('text'),
    swapEraser: () => setTool(tool === 'eraser' ? 'brush' : 'eraser'),
    undo: () => undo(),
    redo: () => redo(),
    sizeUp: () => resizeBrush(1.2),
    sizeDown: () => resizeBrush(1 / 1.2),
    deselect: () => sel.clear(),
    clear: () => activeLayer && markDirty(engine.clear(activeLayer.id)),
    fill: () => activeLayer && markDirty(engine.fill(activeLayer.id, color, activeLayer.alphaLock)),
    newLayer: () => {
      if (doc.layers.filter((l) => !isGroup(l)).length >= layerLimit) return
      const layer = newLayer(nextLayerName(doc))
      loaded.current.set(layer.id, null)
      update((d) => ({ ...d, layers: insertAbove(d.layers, layer, activeLayer?.id) }))
      setActiveLayerId(layer.id)
    },
    flipLayerX: () => activeLayer && markDirty(engine.flip(activeLayer.id, 'x')),
    flipLayerY: () => activeLayer && markDirty(engine.flip(activeLayer.id, 'y')),
    fit: () => fit(),
    rotateLeft: () => turnView(-Math.PI / 12),
    rotateRight: () => turnView(Math.PI / 12),
    flipView: () => view && setView(flipAbout(view, stageCenter())),
    quickMenu: () => openHotwheel(),
    nextMenu: () => {
      const s = useInputSettings.getState()
      const i = s.quickMenus.findIndex((q) => q.id === s.quickMenuId)
      s.update({ quickMenuId: s.quickMenus[(i + 1) % s.quickMenus.length].id })
    },
    'pair.size': () => resizeBrush(1.2),
    'pair.turn': () => turnView(Math.PI / 12),
    'pair.undo': () => undo(),
    guides: () => setGuide({ ...guide, visible: !guide.visible }),
    assist: () =>
      activeLayer && setGuide({ ...guide, assist: guide.assist.includes(activeLayer.id) ? guide.assist.filter((x) => x !== activeLayer.id) : [...guide.assist, activeLayer.id] }),
    export: () => void exportPng(),
    inputSettings: () => setInputOpen(true),
    ...files.actions,
    adjustments: () => setAdjustMenu((o) => !o),
    liquify: () => setAdjust({ kind: 'liquify' }),
    clone: () => setAdjust({ kind: 'clone' }),
  }
  /** Run an action; from a pen button the QuickMenu opens where the pen is. */
  const runAction = (id: ActionId, at?: { clientX: number; clientY: number }) => {
    finishShapeEdit()
    if (id === 'quickMenu' && at) return openHotwheel({ x: at.clientX, y: at.clientY })
    sketchActions[id]()
  }

  const stagePoint = (e: { clientX: number; clientY: number }) => {
    return pointIn(viewCanvas.current!, e)
  }
  /** A finger touched: true when it belongs to a gesture rather than a stroke. */
  const touchDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!input.touchGestures) return false
    if (touch.down(e.pointerId, stagePoint(e), e.timeStamp)?.kind !== 'multi' && !touch.multi) return false
    // A second finger: this is a gesture, so the first finger's stroke is dropped.
    const g = gesture.current
    if (g?.kind === 'paint') {
      clearTimeout(g.timer)
      engine.cancelStroke()
    } else if (g?.kind === 'move') xf.up()
    gesture.current = null
    sel.cancelDraft()
    e.currentTarget.setPointerCapture(e.pointerId)
    setVersion(engine.version)
    return true
  }
  const touchMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!input.touchGestures) return false
    const r = touch.move(e.pointerId, stagePoint(e))
    if (r?.kind === 'pinch' && viewRef.current) {
      if (pinchStart.current?.epoch !== r.epoch) pinchStart.current = { epoch: r.epoch, view: viewRef.current }
      setView(pinch(pinchStart.current.view, r.a0, r.b0, r.a1, r.b1))
    }
    return touch.multi
  }
  const touchUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!input.touchGestures) return false
    const wasMulti = touch.multi
    const r = touch.up(e.pointerId, e.timeStamp)
    if (r?.kind === 'tap') runAction(r.fingers === 2 ? 'undo' : 'redo')
    return wasMulti
  }

  /** Edit Shape: take the snapped shape back off the layer and redraw it while its nodes are dragged. */
  const startShapeEdit = () => {
    const o = shapeOffer
    if (!o || o.editing) return
    markDirty(engine.undo())
    const pts = shapeOutline(o.shape, 2, o.start).map((q) => ({ ...q, pressure: o.pressure }))
    engine.beginStroke(o.opts, pts[0])
    engine.restroke(pts)
    setShapeOffer({ ...o, editing: true })
    setVersion(engine.version)
  }
  const changeShape = (shape: Shape) => {
    if (!shapeOffer?.editing) return
    engine.restroke(shapeOutline(shape, 2, shapeOffer.start).map((q) => ({ ...q, pressure: shapeOffer.pressure })))
    setShapeOffer({ ...shapeOffer, shape })
    setVersion(engine.version)
  }
  function finishShapeEdit() {
    if (!shapeOffer) return
    if (shapeOffer.editing) markDirty(engine.endStroke())
    setShapeOffer(null)
  }

  // ---- Keyboard -------------------------------------------------------------

  const drawShapeRef = useRef(drawShape)
  const moveRef = useRef(moveNow)
  const cursorRef = useRef<{ x: number; y: number } | null>(null)
  const actionsRef = useRef(runAction)
  useHotwheel(() => {
    const s = useInputSettings.getState()
    const profile = s.quickMenus.find((q) => q.id === s.quickMenuId) ?? s.quickMenus[0]
    const one = (id: ActionId): HotAction => {
      const pair = PAIRS[id]
      const label = actionLabel(id)
      // Short names fit a half slice: "Smaller", "Turn left".
      const short = (a: ActionId) => actionLabel(a).replace(/ brush$/, '').replace('Turn view ', 'Turn ')
      return pair
        ? { id, label, halves: [0, 1].map((h) => ({ label: short(pair[h]), icon: actionIcon(pair[h]), run: () => actionsRef.current(pair[h]) })) as HotAction['halves'] }
        : { id, label, icon: actionIcon(id), on: toolOf(id) === tool, run: () => actionsRef.current(id) }
    }
    return profile.slots.filter((id): id is ActionId => !!id).map(one)
  }, true, { label: 'Brush size', smaller: () => actionsRef.current('sizeDown'), bigger: () => actionsRef.current('sizeUp') }, () => {
    // The brush (or eraser) in use, read fresh so the wheel's sliders show and change the current one.
    const lib = useBrushLibrary.getState()
    const id = () => (tool === 'eraser' ? useBrushLibrary.getState().eraserId : useBrushLibrary.getState().brushId)
    const b = () => useBrushLibrary.getState().brushes.find((x) => x.id === id()) ?? lib.brushes[0]
    const cur = b()
    return [
      { id: 'size', label: UI.size, min: cur.minSize, max: cur.maxSize, log: true, get: () => b().size, set: (v) => lib.updateBrush(b().id, { size: Math.round(v) }), format: (v) => `${Math.round(v)} px` },
      { id: 'opacity', label: UI.opacity, min: cur.minOpacity, max: cur.maxOpacity, get: () => b().opacity, set: (v) => lib.updateBrush(b().id, { opacity: Math.round(v * 100) / 100 }), format: (v) => `${Math.round(v * 100)}%` },
    ]
  })
  useEffect(() => {
    drawShapeRef.current = drawShape
    moveRef.current = moveNow
    cursorRef.current = cursor
    actionsRef.current = runAction
  })

  useEffect(() => {
    if (!active) return
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]')) return
      const k = e.key.toLowerCase()
      if (k === 'shift' && gesture.current?.kind === 'paint' && gesture.current.snapped) {
        keys.shift = true
        drawShapeRef.current(gesture.current, cursorRef.current ?? gesture.current.snapped.at)
      }
      if (k === ' ') {
        spaceDown.current = true
        e.preventDefault()
      } else if (k === 'alt') altDown.current = true
      else if (k === 'control') {
        ctrlDown.current = true
        return
      }
      else {
        // Every other key goes through the shortcut list (Pen and keys settings).
        const id = matchShortcut(e, useInputSettings.getState().shortcuts)
        if (!id) return
        if (!e.repeat || id !== 'quickMenu') actionsRef.current(id)
      }
      e.preventDefault()
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && gesture.current?.kind === 'paint' && gesture.current.snapped) {
        keys.shift = false
        drawShapeRef.current(gesture.current, cursorRef.current ?? gesture.current.snapped.at)
      }
      if (e.key === ' ') spaceDown.current = false
      if (e.key === 'Alt') altDown.current = false
      if (e.key === 'Control') {
        ctrlDown.current = false
        setPointed(null)
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [active, tool])

  // ---- Render --------------------------------------------------------------

  const showBrushCursor = tool === 'brush' || tool === 'eraser' || tool === 'smudge' || hoverEraser
  const cursorBrush = hoverEraser ? (lib.brushes.find((b) => b.id === lib.eraserId) ?? brush) : brush

  const layersButtons = (
    <>
      <button className="icon-btn sketch-tool" title={layersMode === 'docked' ? UI_PRO.floatLayers : UI_PRO.dockLayers} onClick={() => setLayersMode(layersMode === 'docked' ? 'floating' : 'docked')}>
        {layersMode === 'docked' ? <PictureInPicture2 size={16} /> : <PanelRightClose size={16} />}
      </button>
    </>
  )

  return (
    <div className="sketch">
      <div className="sketch-topbar" onPointerDown={(e) => e.stopPropagation()}>
        {TOOLS.map((t) => (
          <ToolButton key={t.id} icon={t.icon} label={t.label} active={tool === t.id} onClick={() => setTool(t.id)} hint={`tool.${t.id}`} />
        ))}
        <span className="sketch-sep" />
        <ToolButton icon={Undo2} label={UI.undo} onClick={undo} disabled={!engine.canUndo} hint="undo" />
        <ToolButton icon={Redo2} label={UI.redo} onClick={redo} disabled={!engine.canRedo} hint="redo" />
        <span className="sketch-sep" />
        <ToolButton icon={PaintBucket} label={UI.fill} onClick={() => activeLayer && markDirty(engine.fill(activeLayer.id, color, activeLayer.alphaLock))} hint="fill" />
        <ToolButton icon={Trash2} label={UI.clear} onClick={() => activeLayer && markDirty(engine.clear(activeLayer.id))} />
        {/* v0.12: these flip the whole picture; Shift only the layer. Lucide's FlipVertical2 is the one with the vertical mirror line. */}
        <ToolButton icon={FlipVertical2} label={UI.flipX} onClick={(e) => runAction(e?.shiftKey ? 'flipLayerX' : 'flipCanvasX')} />
        <ToolButton icon={FlipHorizontal2} label={UI.flipY} onClick={(e) => runAction(e?.shiftKey ? 'flipLayerY' : 'flipCanvasY')} />
        <AdjustMenu open={adjustMenu} onOpen={setAdjustMenu} onPick={setAdjust} />
        {sel.active && (
          <>
            <button className={`btn sketch-move-sel${tool === 'move' ? ' is-active' : ''}`} title={UI.moveSelection} onClick={() => setTool('move')}>
              <Move size={14} /> {UI.moveSelection}
            </button>
            <ToolButton icon={X} label={UI.deselect} onClick={() => sel.clear()} />
          </>
        )}
        <span className="sketch-sep" />
        <ToolButton icon={Scan} label={UI.fit} onClick={fit} />
        <ToolButton icon={RotateCcw} label={UI_PRO.rotateLeft} onClick={() => runAction('rotateLeft')} />
        <ToolButton icon={RotateCw} label={UI_PRO.rotateRight} onClick={() => runAction('rotateRight')} />
        <ToolButton icon={FlipHorizontal} label={UI_PRO.flipView} active={!!view?.flip} onClick={() => runAction('flipView')} />
        <ToolButton icon={Settings2} label={UI_PRO.input} onClick={() => setInputOpen(true)} />
        <ToolButton icon={LayersIcon} label={layersShown ? UI_PRO.hideLayers : UI_PRO.showLayers} active={layersShown} onClick={() => setLayersShown(!layersShown)} />
        <BringBackMenu onPick={bringBack} />
        <ToolButton icon={Lamp} label={UI_PRO.lightPreview} active={lightShown} onClick={() => setLightShown(!lightShown)} />
        <ToolButton icon={ImageIcon} label={UI.insertImage} onClick={() => void insertFromFile()} />
        <ToolButton icon={ImagePlus} label={UI.reference} onClick={() => setPickingRef(true)} />
        {files.buttons}
        <AssistButtons assist={assist} />
        {actions?.(async () => {
          await flush()
          return engine.flattenedPng({ ...doc, layers: exportLayers(doc.layers) })
        })}
        <span className="sketch-spacer" />
        {saving && <span className="sketch-saving">{UI.saving}</span>}
      </div>

      <div className="sketch-body">
        <div
          ref={boxRef}
          className={`sketch-stage${doc.backgroundColor ? '' : ' see-through'}`}
          onWheel={onWheel}
        >
          <canvas
            key={colorSpace}
            ref={viewCanvas}
            className="sketch-canvas"
            // On the canvas only: toolbars and panels floating over the stage keep the normal pointer.
            style={{ cursor: tool === 'hand' ? 'grab' : tool === 'brush' || tool === 'eraser' || tool === 'smudge' ? 'none' : 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              flushMove()
              touch.reset()
              engine.cancelStroke()
              xf.up()
              gesture.current = null
            }}
            onPointerLeave={() => (flushMove(), setCursor(null), setPointed(null))}
            onContextMenu={(e) => e.preventDefault()}
          />
          {view && <SelectionMaskView sel={sel} engine={engine} view={view} />}
          {/* v0.12: in plain sight on the canvas, so it is easy to find and never pushes the canvas around. */}
          <button className="sketch-shortcuts" title={UI_PRO.shortcuts} onPointerDown={(e) => e.stopPropagation()} onClick={() => setSheetOpen(true)}>
            <Keyboard size={14} /> Shortcuts
          </button>
          <ColorDropView drop={drop} view={view} />
          <div className="sketch-floatbars">
            <ColorDropBar drop={drop} color={color} />
            <TransformBar xf={xf} onDone={() => markDirty(xf.commit(sel))} onCancel={() => xf.cancel()} />
            <SelectionBar
              sel={sel}
              tool={tool === 'lasso' || tool === 'rect'}
              doc={doc}
              root={root}
              update={update}
              usesReference={doc.layers.some((l) => l.reference)}
              onFill={() => activeLayer && markDirty(engine.fill(activeLayer.id, color, activeLayer.alphaLock))}
              onClear={() => activeLayer && markDirty(engine.clear(activeLayer.id))}
              onCopyPaste={() => {
                if (!activeLayer || !hasPixels(activeLayer)) return
                const piece = engine.canvas()
                piece.ctx.drawImage(engine.layerCanvas(activeLayer.id), 0, 0)
                piece.ctx.globalCompositeOperation = 'destination-in'
                if (engine.selectionMask) piece.ctx.drawImage(engine.selectionMask, 0, 0)
                copyPixels(piece.canvas)
                const layer = newLayer(nextLayerName(doc))
                loaded.current.set(layer.id, null)
                engine.setLayerImage(layer.id, piece.canvas)
                update((d) => ({ ...d, layers: insertAbove(d.layers, layer, activeLayer.id) }))
                setActiveLayerId(layer.id)
                markDirty(layer.id)
              }}
            />
          </div>
          {view && (
            <svg className="sketch-overlay">
              <g transform={`matrix(${viewMatrix(view).join(' ')})`}>
                {doc.cardGuides && doc.cardGuides.visible !== false && (
                  <g transform={`translate(${doc.frame?.x ?? 0} ${doc.frame?.y ?? 0})`}>
                    <CardGuides g={doc.cardGuides} width={doc.frame?.w ?? doc.width} height={doc.frame?.h ?? doc.height} scale={view.scale} />
                  </g>
                )}
                {liveGuide && <GuideOverlay guide={liveGuide} width={doc.width} height={doc.height} scale={view.scale} editing={editingGuide} toDoc={toDoc} onChange={setGuide} />}
                <SelectionOutline sel={sel} />
                <TextBoxes layers={doc.layers} activeId={activeLayer?.id} scale={view.scale} all={tool === 'text'} />
                <TransformOverlay xf={xf} scale={view.scale} width={doc.width} height={doc.height} />
                {shapeOffer?.editing && <ShapeNodes shape={shapeOffer.shape} scale={view.scale} toDoc={toDoc} onChange={changeShape} />}
                {tether && (
                  <g className="sketch-tether" style={{ strokeWidth: 1.5 / view.scale }}>
                    <line x1={tether.tip.x} y1={tether.tip.y} x2={tether.pen.x} y2={tether.pen.y} />
                    <circle cx={tether.tip.x} cy={tether.tip.y} r={4 / view.scale} />
                  </g>
                )}
                {showBrushCursor && cursor && <BrushCursor at={cursor} brush={cursorBrush} scale={view.scale} erase={tool === 'eraser' || hoverEraser} onLight={cursorOnLight} />}
              </g>
            </svg>
          )}
          {adjust && view && activeLayer && activeLayer.kind !== 'group' && (
            <AdjustStudio
              key={`${adjust.kind}:${adjust.kind === 'filter' ? adjust.id : ''}:${activeLayer.id}`}
              mode={adjust}
              // oxlint-disable-next-line react/refs -- the engine is a mutable drawing surface
              engine={engine}
              layerId={activeLayer.id}
              brush={brush}
              view={view}
              toDoc={toDoc}
              refresh={refresh}
              commit={markDirty}
              onClose={() => setAdjust(null)}
            />
          )}
          {shapeOffer && (
            <div className="shape-edit-bar" style={{ left: shapeOffer.at.x, top: shapeOffer.at.y }} onPointerDown={(e) => e.stopPropagation()}>
              {shapeOffer.editing ? (
                <button className="btn btn-primary sketch-small" onClick={finishShapeEdit}>
                  {UI_PRO.done}
                </button>
              ) : (
                <button className="btn sketch-small" onClick={startShapeEdit}>
                  {UI_PRO.editShape}
                </button>
              )}
            </div>
          )}
          {files.stage}
          {/* oxlint-disable-next-line react/refs -- the assist cache is only read while drawing */}
          <AssistBar assist={assist} engine={engine} title={title} />
          {doc.references.map((r) => (
            <ReferenceWindow
              key={r.id}
              image={r.image}
              x={r.x}
              y={r.y}
              width={r.width}
              onChange={(patch) => update((d) => ({ ...d, references: d.references.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) }))}
              onClose={() => update((d) => ({ ...d, references: d.references.filter((x) => x.id !== r.id) }))}
            />
          ))}
        </div>

        <aside className="sketch-panel" onPointerDown={(e) => e.stopPropagation()}>
          {/* Background colour at the top of the panel, where it is easy to find. */}
          <div className="sketch-row sketch-background">
            <span>{UI.background}</span>
            <input
              type="color"
              title={UI.paperColor}
              value={doc.backgroundColor ?? doc.frosted ?? '#ffffff'}
              onChange={(e) => update((d) => (paperMode(d) === 'blurred' ? { ...d, frosted: e.target.value } : { ...d, backgroundColor: e.target.value }))}
              disabled={paperMode(doc) === 'transparent'}
            />
            <select className="input" aria-label={UI.background} value={paperMode(doc)} onChange={(e) => update((d) => withPaper(d, e.target.value as PaperMode))}>
              <option value="solid">{UI.solid}</option>
              <option value="transparent">{UI.transparent}</option>
              <option value="blurred">{UI.blurred}</option>
            </select>
          </div>
          {panel}
          <ColorPanel color={color} setColor={setColor} swatches={swatches === SWATCHES ? [] : swatches} drop={drop} colorSpace={colorSpace} onColorSpace={(cs) => void setColorSpace(cs)} />

          <section>
            <div className="sketch-current-brush">
              <button className="sketch-brush-pick" title={UI.library} onClick={(e) => {
                  // Opens to the left of the side panel, over the canvas.
                  const r = e.currentTarget.getBoundingClientRect()
                  setLibraryAt({ x: Math.max(8, r.left - 652), y: Math.max(8, Math.min(r.top, window.innerHeight - 530)) })
                  setLibraryOpen(libraryOpen ? null : brushMode)
                }}>
                <span>{brush.name}</span>
                <BrushPreview brush={brush} color={brushMode === 'eraser' ? '#888' : color} />
              </button>
              {libraryOpen && <BrushLibrary mode={libraryOpen} color={color} at={libraryAt} onClose={() => setLibraryOpen(null)} />}
            </div>
            <Slider label={UI.size} min={brush.minSize} max={brush.maxSize} value={brush.size} log onChange={(size) => setBrush({ size })} suffix="px" />
            <Slider label={UI.opacity} min={brush.minOpacity} max={brush.maxOpacity} step={0.01} value={brush.opacity} onChange={(opacity) => setBrush({ opacity })} percent />
            {(['streamline', 'stabilization', 'tether'] as const).map((k) => (
              <OverrideSlider key={k} label={UI_PRO.override[k]} own={brush[k]} value={input.overrides[k]} onChange={(v) => useInputSettings.getState().update({ overrides: { ...input.overrides, [k]: v } })} />
            ))}
          </section>

          <GuidePanel guide={guide} layerId={activeLayer?.id} editing={editingGuide} onEditing={setEditingGuide} onChange={setGuide} />

          {layersMode === 'docked' && layersShown && <LayersPanel host={layerHost} headerExtra={layersButtons} />}
        </aside>
      </div>

      {inputOpen && <InputSettingsDialog onClose={() => setInputOpen(false)} />}
      {sheetOpen && <ShortcutSheet onClose={() => setSheetOpen(false)} />}
      {layersMode === 'floating' && layersShown && (
        <FloatingPanel title={UI_PRO.layers} at={layersSpot} onMove={setLayersSpot} onClose={() => setLayersShown(false)} width={300}>
          <LayersPanel host={layerHost} headerExtra={layersButtons} />
        </FloatingPanel>
      )}
      {activeLayer?.text && tool === 'text' && (
        <FloatingPanel title={UI_PRO.textOptions} at={textSpot} onMove={setTextSpot} onClose={() => setTool('move')} width={290}>
          <TextPanel host={layerHost} layer={activeLayer} />
        </FloatingPanel>
      )}
      {lightShown && (
        <FloatingPanel title={UI_PRO.lightPreviewTitle} at={lightSpot} onMove={setLightSpot} onClose={() => setLightShown(false)} width={330}>
          <Suspense fallback={null}>
            <LightPreview
              brushColor={color}
              onPickColor={setColor}
              onPin={
                root
                  ? (png) =>
                      void importAssetFromBlob(root, png, 'image', 'light-preview.png').then(
                        (asset) => asset && update((d) => ({ ...d, references: [...d.references, { id: newId(), image: asset.path, x: 24, y: 24 + d.references.length * 24, width: 300 }] })),
                      )
                  : undefined
              }
            />
          </Suspense>
        </FloatingPanel>
      )}
      {files.dialogs}
      {pickingRef && (
        <ReferencePicker
          onPick={(image) => {
            setPickingRef(false)
            if (image) update((d) => ({ ...d, references: [...d.references, { id: newId(), image, x: 24, y: 24 + d.references.length * 24, width: 260 }] }))
          }}
        />
      )}
    </div>
  )
}

function ToolButton(p: { icon: LucideIcon; label: string; onClick: (e?: React.MouseEvent) => void; active?: boolean; disabled?: boolean; hint?: ActionId }) {
  const keys = useInputSettings((s) => s.shortcuts)
  return (
    <button className={`icon-btn sketch-tool${p.active ? ' is-active' : ''}`} title={p.label} aria-label={p.label} aria-pressed={p.active} disabled={p.disabled} onClick={p.onClick} {...keyHint(p.hint && keysFor(p.hint, keys)[0])}>
      <p.icon size={16} />
    </button>
  )
}

/** A slider that only counts while its box is ticked; unticked it shows the brush's own value, greyed out. */
function OverrideSlider(p: { label: string; own: number; value: number | null; onChange(v: number | null): void }) {
  const on = p.value !== null
  const shown = on ? p.value! : p.own
  return (
    <label className={`sketch-slider sketch-override${on ? '' : ' is-off'}`} title={UI_PRO.overrideHint}>
      <input type="checkbox" checked={on} onChange={(e) => p.onChange(e.target.checked ? p.own : null)} />
      <span>{p.label}</span>
      <input type="range" min={0} max={1} step={0.05} value={shown} disabled={!on} style={{ '--fill': `${shown * 100}%` } as React.CSSProperties} onChange={(e) => p.onChange(Number(e.target.value))} />
      <span className="sketch-slider-value">{Math.round(shown * 100)}%</span>
    </label>
  )
}

function Slider(p: { label: string; min: number; max: number; step?: number; value: number; onChange(v: number): void; log?: boolean; percent?: boolean; suffix?: string }) {
  // Size uses a log scale so small brushes are easy to set.
  const toSlider = (v: number) => (p.log ? Math.log(v / p.min) / Math.log(p.max / p.min) : v)
  const fromSlider = (s: number) => (p.log ? Math.round(p.min * Math.pow(p.max / p.min, s)) : s)
  const shown = p.percent ? `${Math.round(p.value * 100)}%` : `${Math.round(p.value)}${p.suffix ?? ''}`
  return (
    <label className="sketch-slider">
      <span>{p.label}</span>
      <input
        type="range"
        min={p.log ? 0 : p.min}
        max={p.log ? 1 : p.max}
        step={p.log ? 0.001 : (p.step ?? 1)}
        value={toSlider(p.value)}
        style={{ '--fill': `${(((toSlider(p.value) - (p.log ? 0 : p.min)) / ((p.log ? 1 : p.max) - (p.log ? 0 : p.min)) || 0) * 100).toFixed(1)}%` } as React.CSSProperties}
        onChange={(e) => p.onChange(fromSlider(Number(e.target.value)))}
      />
      <span className="sketch-slider-value">{shown}</span>
    </label>
  )
}

function BrushPreview({ brush, color }: { brush: Parameters<typeof drawPreview>[1]; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current) drawPreview(ref.current, brush, color)
  }, [brush, color])
  return <canvas ref={ref} width={200} height={40} className="sketch-brush-preview" />
}

/** v0.24.2: a dropdown that brings the layers back when they got lost (closed, or floated out of sight). */
function BringBackMenu({ onPick }: { onPick(mode: 'docked' | 'floating'): void }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open])
  const pick = (mode: 'docked' | 'floating') => {
    setOpen(false)
    onPick(mode)
  }
  return (
    <div className="adjust-menu-wrap" ref={wrap}>
      <button className={`icon-btn sketch-tool${open ? ' is-active' : ''}`} title={UI_PRO.bringBack} aria-label={UI_PRO.bringBack} aria-expanded={open} onClick={() => setOpen(!open)}>
        <LocateFixed size={16} />
      </button>
      {open && (
        <div className="adjust-menu" role="menu">
          <h5>{UI_PRO.bringBack}</h5>
          <button role="menuitem" onClick={() => pick('floating')}>
            <PictureInPicture2 size={14} /> {UI_PRO.bringFloating}
          </button>
          <button role="menuitem" onClick={() => pick('docked')}>
            <PanelRightClose size={14} /> {UI_PRO.bringDocked}
          </button>
        </div>
      )}
    </div>
  )
}
