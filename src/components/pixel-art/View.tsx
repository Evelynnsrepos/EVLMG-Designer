import { Blend, Brush, PenTool, CircleDashed, Pentagon, Hand, History as HistoryIcon, ImagePlus, Undo2, Redo2, Maximize, Type, Sparkles, Circle, Dices, Download, LassoSelect, Spline, SprayCan, Stamp, Eraser, FlipHorizontal2, FlipVertical2, Grid3x3, Lasso, Layers, Map as MapIcon, Move, PaintBucket, Pipette, RotateCcw, RotateCw, Slash, Square, SquareDashed, SunMoon, Upload, WandSparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { importAssetFromBlob, resolveAssetPath } from '@/core/assets'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { getFs } from '@/core/fs'
import { newId } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { isShortcut, keysOf } from '@/core/shortcuts'
import { keyHint } from '@/shared/hotkeyHints'
import { loadDocumentNow, postIntent, updateDocument, useDocument, useIntentHandler, useProjectStore, isTextField, useUndoRedoKeys, type UseDocumentResult } from '@/core/state'
import { NumberInput } from '@/shared/calculators'
import { confirmDialog, promptDialog } from '@/shared/dialogs'
import { cssFamily, GENERIC_FONTS, systemFonts } from '@/shared/fontList'
import { maybeStartTour } from '@/shell/help/help'
import { pickFiles } from '@/shared/sketch/files/io'
import { encodeGif } from '@/shared/sketch/files/gif'
import { createLibrary, drawTile, FLIP_H, FLIP_V, LIBRARY_ID, tilePixel, tileRect, TRANSPOSE, turnFlags, type TileLibrary } from '@/shared/tileset'
import { IMAGE_TARGETS, openComponent, sendImageTo } from '@/shell/editor/actions'
import { readAse } from './ase'
import { celImg, decode, decodeFrames, encode, pngBytes, toCanvas, useDecoded } from '@/shared/pixel/codec'
import { DEFAULT_SHEET, godotSpriteFrames, sheetJson, sheetLayout, type SheetOptions } from './exports'
import {
  blank,
  brushOffsets,
  celKey,
  cleanPath,
  shapePixels,
  cloneImg,
  composite,
  createPixelDoc,
  ditherOn,
  ellipsePoints,
  floodPoints,
  getPx,
  hexToRgba,
  line,
  mirror,
  newFrame,
  newPixelLayer,
  paletteToGpl,
  parsePalette,
  rectPoints,
  replaceColor,
  resolveKey,
  isLink,
  rgbaToHex,
  setPx,
  shadeStep,
  sliceSheet,
  startDoc,
  tagFrames,
  celAlpha,
  tileColumns,
  tilePixels,
  sameImg,
  emptyImg,
  tilesFromMap,
  extrude,
  tileRows,
  type Img,
  type PixelDoc,
  type RGBA,
} from '@/shared/pixel/model'
import { ColorsPanel, LayersPanel, PalettePanel, Preview, Timeline } from './Panels'
import { grayHex, grayscale, nearest, paletteOf, reduce, swapColors } from '@/shared/pixel/color'
import { borderMask, ellipseMask, growMask, invertMask, maskToText, textToMask, bounds, combine, cut, flipImg, imgMask, lassoMask, maskImg, outline, paste, placeMask, rectMask, rotate90, rotateAny, scaleImg, wandMask, wrapShift, type Combine, type Mask } from './selection'
import { gentle, HOLD_MS, keys as shapeKeys, PERFECT_MS, perfect, recognize, resize, type Shape } from '@/shared/sketch/quickshape'
import { holdTolerance, useInputSettings } from '@/shared/sketch/inputSettings'
import { MotionFilter } from '@/shared/sketch/pen'
import { ShapePanel } from './ShapePanel'
import { useShapeTool, withShapes } from './shapeTool'
import { boxPoints, fromQuickShape, fromStroke, hitShape, newShape, type VShape } from '@/shared/pixel/shapes'
import { contentBounds, crop, everyTile, flipSprite, resizeCanvas, turnSprite, usedColors } from './docOps'
import { usePalettes } from '@/shared/sketch/palettes'
import { ReferencePicker } from '@/shared/sketch/ReferencePicker'
import { ReferenceWindow } from '@/shared/sketch/ReferenceWindow'
import { HistoryList } from './HistoryList'
import { TilePlayer } from './TilePlayer'
import { PopOut } from './PopOut'
import { PaletteSwitch } from './PaletteSwitch'
import { adjustImg, despeckle, dropShadow, NO_ADJUST, type Adjust } from './adjust'
import './pixel-art.css'

type Tool = 'pencil' | 'eraser' | 'shape' | 'ellipseSelect' | 'polySelect' | 'hand' | 'line' | 'curve' | 'rect' | 'ellipse' | 'fill' | 'lassofill' | 'gradient' | 'spray' | 'text' | 'picker' | 'shade' | 'select' | 'lasso' | 'wand' | 'move' | 'tile' | 'tileErase' | 'tileFill' | 'tileRandom' | 'auto'
type Pt = [number, number]

/** Pixel Art (v0.16): sprites, animations, tilesets and tilemaps. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<PixelDoc>('pixel-art', documentId!, createPixelDoc)
  const title = useProjectStore((s) => s.meta?.documents.find((x) => x.id === documentId)?.title ?? 'Pixel art')
  const root = useProjectStore((s) => s.root)

  // From Level Layout: "Edit in Pixel Art" opens a library tileset as a new tileset file.
  useIntentHandler('pixel-art', (intent) => {
    if (!root) return
    if (intent.action === 'edit-tileset' && typeof intent.id === 'string') void editTileset(root, intent.id)
    // A picture from Draw (or elsewhere) becomes a tracing layer, scaled down to fit the canvas.
    if (intent.action === 'add-image' && typeof intent.path === 'string') void addReference(root, intent.path, typeof intent.name === 'string' ? intent.name : 'Reference')
  })
  const addReference = async (root: string, path: string, name: string) => {
    const src = await decode(await getFs().readBinary(await resolveAssetPath(root, path))).catch(() => null)
    if (!src) return
    const base = doc.data?.started ? doc.data : ({ ...createPixelDoc(), ...startDoc('sprite', 64, 64) } as PixelDoc)
    const k = Math.min(base.width / src.width, base.height / src.height)
    const c = document.createElement('canvas')
    c.width = base.width
    c.height = base.height
    const g = c.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(toCanvas(src), (base.width - src.width * k) / 2, (base.height - src.height * k) / 2, src.width * k, src.height * k)
    const data = g.getImageData(0, 0, c.width, c.height)
    const layer = { ...newPixelLayer(name), reference: true, opacity: 0.6 }
    const url = encode({ width: data.width, height: data.height, data: data.data })
    doc.update(() => ({ ...base, layers: [layer, ...base.layers], cels: url ? { ...base.cels, [celKey(layer.id, base.frames[0].id)]: url } : base.cels }))
  }

  if (!doc.data) return null
  if (!doc.data.started) return <Start onStart={(patch) => doc.update((x) => ({ ...x, ...patch }))} />
  return <Editor doc={doc as UseDocumentResult<PixelDoc> & { data: PixelDoc }} documentId={documentId!} title={title} active={active} />
}

async function editTileset(root: string, id: string) {
  const lib = await loadDocumentNow<TileLibrary>(root, 'level-layout', LIBRARY_ID, createLibrary)
  const t = lib.tilesets.find((x) => x.id === id)
  if (!t) return
  const src = await decode(await getFs().readBinary(await resolveAssetPath(root, t.image)))
  // Margins and spacing are packed away: Pixel Art keeps tiles side by side.
  const img = blank(t.columns * t.tileSize, t.rows * t.tileSize)
  for (let r = 0; r < t.rows; r++)
    for (let c = 0; c < t.columns; c++) {
      const s = tileRect(t, c, r)
      for (let y = 0; y < t.tileSize; y++)
        for (let x = 0; x < t.tileSize; x++) if (s.x + x < src.width && s.y + y < src.height) setPx(img, c * t.tileSize + x, r * t.tileSize + y, getPx(src, s.x + x, s.y + y))
    }
  const base = { ...createPixelDoc(), ...startDoc('tileset', img.width, img.height, t.tileSize), libraryId: t.id } as PixelDoc
  const url = encode(img)
  if (url) base.cels = { [celKey(base.layers[0].id, base.frames[0].id)]: url }
  const ref = useProjectStore.getState().addDocument('pixel-art', t.name)
  await loadDocumentNow(root, 'pixel-art', ref.id, () => base)
  updateDocument<PixelDoc>(root, 'pixel-art', ref.id, (d) => d)
  openComponent('pixel-art', ref.id)
}

// ---- Start screen ----------------------------------------------------------------

const SPRITE_SIZES = [16, 24, 32, 48, 64, 128]

function Start({ onStart }: { onStart(patch: Partial<PixelDoc>): void }) {
  const [kind, setKind] = useState<PixelDoc['kind']>('sprite')
  const [w, setW] = useState(32)
  const [h, setH] = useState(32)
  const [tile, setTile] = useState(16)
  const [across, setAcross] = useState(8)
  const [down, setDown] = useState(8)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ img: Img; cw: number; ch: number } | null>(null)
  const clamp = (v: number) => Math.max(1, Math.min(1024, Math.round(v) || 1))

  const openSheet = async () => {
    const [f] = await pickFiles('Open a sprite sheet', ['png', 'gif'])
    if (!f) return
    const img = await decode(f.bytes).catch(() => null)
    if (!img) return setError('This file could not be read.')
    // A first guess: one row of square frames.
    setSheet({ img, cw: Math.min(img.width, img.height), ch: img.height })
  }
  const openMap = async () => {
    const [f] = await pickFiles('Open a map picture', ['png', 'gif'])
    if (!f) return
    const img = await decode(f.bytes).catch(() => null)
    if (!img) return setError('This file could not be read.')
    const r = tilesFromMap(img, tile)
    if (!r.count) return setError('No tiles found: the picture is empty or smaller than one tile.')
    const layer = newPixelLayer('Tiles')
    const frame = newFrame()
    const url = encode(r.sheet)
    onStart({
      ...startDoc('tileset', r.sheet.width, r.sheet.height, tile),
      layers: [layer],
      frames: [frame],
      cels: url ? { [celKey(layer.id, frame.id)]: url } : {},
      map: { width: r.width, height: r.height, layers: [{ id: newId(), name: 'Map', visible: true, cells: r.cells }] },
    })
  }
  const fromSheet = () => {
    if (!sheet) return
    const frames = sliceSheet(sheet.img, sheet.cw, sheet.ch)
    const layer = newPixelLayer('Layer 1')
    const fs = frames.map(() => newFrame())
    const cels: Record<string, string> = {}
    frames.forEach((img, i) => {
      const url = encode(img)
      if (url) cels[celKey(layer.id, fs[i].id)] = url
    })
    onStart({ ...startDoc('sprite', sheet.cw, sheet.ch), layers: [layer], frames: fs.length ? fs : [newFrame()], cels })
  }

  const openFile = async () => {
    const files = await pickFiles('Open pixel art (pick several pictures to make them frames)', ['ase', 'aseprite', 'png', 'gif'])
    const [f] = files
    if (!f) return
    try {
      if (/\.(ase|aseprite)$/i.test(f.name)) return onStart(fromAse(readAse(f.bytes)))
      // Several pictures: frames in name order (frame_1, frame_2, … frame_10).
      const pics = files.length > 1 ? [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) : null
      const anim = pics ? { frames: await Promise.all(pics.map((p) => decode(p.bytes))), durations: pics.map(() => 100) } : await decodeFrames(f.bytes, /\.gif$/i.test(f.name) ? 'image/gif' : 'image/png')
      const w = Math.max(...anim.frames.map((i) => i.width))
      const h = Math.max(...anim.frames.map((i) => i.height))
      const layer = newPixelLayer('Layer 1')
      const frames = anim.frames.map((_, i) => newFrame(anim.durations[i]))
      const cels: Record<string, string> = {}
      anim.frames.forEach((img, i) => {
        const full = blank(w, h)
        for (let y = 0; y < img.height; y++) full.data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), y * w * 4)
        const url = encode(full)
        if (url) cels[celKey(layer.id, frames[i].id)] = url
      })
      onStart({ ...startDoc(frames.length > 1 ? 'sprite' : kind, w, h, tile), layers: [layer], frames, cels })
    } catch {
      setError('This file could not be read.')
    }
  }

  return (
    <div className="px-start">
      <h2>New pixel art</h2>
      <p className="muted">Sprites and animations, or a tileset to paint maps with. Every pixel lands exactly where you put it.</p>
      <div className="px-start-presets">
        <button className={`btn${kind === 'sprite' ? ' btn-primary' : ''}`} onClick={() => setKind('sprite')}>
          Sprite
        </button>
        <button className={`btn${kind === 'tileset' ? ' btn-primary' : ''}`} onClick={() => setKind('tileset')}>
          Tileset and map
        </button>
      </div>
      {kind === 'sprite' ? (
        <>
          <div className="px-start-presets">
            {SPRITE_SIZES.map((s) => (
              <button key={s} className={`btn${w === s && h === s ? ' btn-primary' : ''}`} onClick={() => (setW(s), setH(s))}>
                {s} × {s}
              </button>
            ))}
          </div>
          <label className="ld-inline">
            <NumberInput value={w} min={1} max={1024} onChange={(v) => setW(clamp(v))} /> ×
            <NumberInput value={h} min={1} max={1024} onChange={(v) => setH(clamp(v))} /> pixels
          </label>
        </>
      ) : (
        <>
          <div className="px-start-presets">
            {[8, 16, 32].map((s) => (
              <button key={s} className={`btn${tile === s ? ' btn-primary' : ''}`} onClick={() => setTile(s)}>
                {s} px tiles
              </button>
            ))}
          </div>
          <label className="ld-inline">
            <NumberInput value={across} min={1} max={64} onChange={(v) => setAcross(clamp(v))} /> ×
            <NumberInput value={down} min={1} max={64} onChange={(v) => setDown(clamp(v))} /> tiles ({across * tile} × {down * tile} px)
          </label>
        </>
      )}
      <button className="btn btn-primary" onClick={() => onStart(kind === 'sprite' ? startDoc('sprite', w, h) : startDoc('tileset', across * tile, down * tile, tile))}>
        Start
      </button>
      <button className="btn" onClick={() => void openFile()}>
        <Upload size={14} /> Open a file (.ase, .aseprite, PNG, GIF, or several pictures as frames)
      </button>
      <button className="btn" title="A finished map picture: cut into tiles (identical ones kept once) and rebuilt as a tileset with its map" onClick={() => void openMap()}>
        <Upload size={14} /> Open a map picture (rebuild its tiles at {tile} px)
      </button>
      <button className="btn" onClick={() => void openSheet()}>
        <Upload size={14} /> Open a sprite sheet (cut into frames)
      </button>
      {sheet && (
        <div className="px-sheet">
          <label className="ld-inline" title="Size of one frame in the sheet">
            Frame <NumberInput value={sheet.cw} min={1} max={sheet.img.width} onChange={(v) => setSheet({ ...sheet, cw: clamp(v) })} /> ×
            <NumberInput value={sheet.ch} min={1} max={sheet.img.height} onChange={(v) => setSheet({ ...sheet, ch: clamp(v) })} /> px
          </label>
          <span className="muted">
            {sliceSheet(sheet.img, sheet.cw, sheet.ch).length} frames from a {sheet.img.width} × {sheet.img.height} px sheet
          </span>
          <button className="btn btn-primary" onClick={fromSheet}>
            Make the frames
          </button>
        </div>
      )}
      {error && <p className="settings-error">{error}</p>}
    </div>
  )
}

/** A Pixel Art document from an imported .ase file. */
function fromAse(f: ReturnType<typeof readAse>): Partial<PixelDoc> {
  const layers = f.layers.map((l) => ({ ...newPixelLayer(l.name), visible: l.visible, opacity: l.opacity }))
  const frames = f.frames.map((fr) => newFrame(fr.duration))
  const cels: Record<string, string> = {}
  const urls = new Map<Img, string | null>()
  f.frames.forEach((fr, fi) =>
    fr.cels.forEach((img, li) => {
      if (!img || !layers[li]) return
      if (!urls.has(img)) urls.set(img, encode(img))
      const url = urls.get(img)
      if (url) cels[celKey(layers[li].id, frames[fi].id)] = url
    }),
  )
  const colors = ['#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#c2255c']
  return {
    started: true,
    kind: 'sprite',
    width: f.width,
    height: f.height,
    layers: layers.length ? layers : [newPixelLayer('Layer 1')],
    frames: frames.length ? frames : [newFrame()],
    cels,
    tags: f.tags.map((t, i) => ({ id: newId(), name: t.name, from: t.from, to: t.to, loop: t.loop, color: colors[i % colors.length] })),
    ...(f.palette.length ? { palette: [...new Set(f.palette)] } : {}),
  }
}

// ---- Editor -------------------------------------------------------------------------

const TOOLS: { id: Tool; icon: typeof Brush; label: string; key: string }[] = [
  { id: 'pencil', icon: Brush, label: 'Pencil', key: 'pixel.pencil' },
  { id: 'eraser', icon: Eraser, label: 'Eraser', key: 'pixel.eraser' },
  { id: 'shape', icon: PenTool, label: 'Shape: on a shape layer, click points for a live shape; drag points or the shape to change it, double-click an edge to add a point', key: 'pixel.shape' },
  { id: 'line', icon: Slash, label: 'Line (Shift keeps clean angles)', key: 'pixel.line' },
  { id: 'curve', icon: Spline, label: 'Curve: drag a line, then drag again to bend it', key: 'pixel.curve' },
  { id: 'rect', icon: Square, label: 'Rectangle (Ctrl or Shift: a perfect square, also when dragging its corners later)', key: 'pixel.rect' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse (Ctrl or Shift: a perfect circle, also when dragging its points later)', key: 'pixel.ellipse' },
  { id: 'fill', icon: PaintBucket, label: 'Fill', key: 'pixel.fill' },
  { id: 'lassofill', icon: LassoSelect, label: 'Lasso fill: draw around an area to fill it', key: 'pixel.lassofill' },
  { id: 'gradient', icon: Blend, label: 'Dithered gradient from the main to the second colour (drag its direction)', key: 'pixel.gradient' },
  { id: 'spray', icon: SprayCan, label: 'Spray (size sets how wide)', key: 'pixel.spray' },
  { id: 'text', icon: Type, label: 'Text: click where it starts; any font, drawn with hard pixels', key: 'pixel.text' },
  { id: 'picker', icon: Pipette, label: 'Eyedropper (or Alt-click)', key: 'pixel.picker' },
  { id: 'shade', icon: SunMoon, label: 'Shade brush: left click one palette step lighter, right click darker', key: 'pixel.shade' },
  { id: 'select', icon: SquareDashed, label: 'Select a rectangle (Shift adds, Alt takes away, hold Ctrl for a perfect square)', key: 'pixel.select' },
  { id: 'lasso', icon: Lasso, label: 'Lasso: select by drawing around (Shift adds, Alt takes away)', key: 'pixel.lasso' },
  { id: 'ellipseSelect', icon: CircleDashed, label: 'Select an ellipse (Shift adds, Alt takes away, hold Ctrl for a perfect circle)', key: 'pixel.ellipseSelect' },
  { id: 'polySelect', icon: Pentagon, label: 'Polygon lasso: click the corners, click the first one (or double-click) to finish (Shift adds, Alt takes away)', key: 'pixel.polySelect' },
  { id: 'wand', icon: WandSparkles, label: 'Magic wand: select a colour, with Tolerance for similar ones (Shift adds, Alt takes away)', key: 'pixel.wand' },
  { id: 'move', icon: Move, label: 'Move the selection, or the whole layer (arrow keys move 1 px). Drag a corner to scale (Shift keeps the shape), drag outside the box to rotate (Shift: 15° steps)', key: 'pixel.move' },
  { id: 'hand', icon: Hand, label: 'Hand: drag to look around (or hold Space, or drag with the middle button)', key: 'pixel.hand' },
]

/** A curve from `a` to `b` bent towards `c`, as a smooth live shape through its ends and the middle of the bend. */
function liveCurve(a: Pt, c: Pt, b: Pt, strokeColor: string, width: number): VShape | null {
  if (a[0] === b[0] && a[1] === b[1] && a[0] === c[0] && a[1] === c[1]) return null
  const mid = { x: Math.round((a[0] + 2 * c[0] + b[0]) / 4), y: Math.round((a[1] + 2 * c[1] + b[1]) / 4) }
  return newShape([{ x: a[0], y: a[1] }, mid, { x: b[0], y: b[1] }], false, { strokeColor, width, smooth: true })
}

/** Line, Rectangle or Ellipse from `a` to `b` as a live shape (null when it would be a dot). */
function liveBox(tool: 'rect' | 'ellipse' | 'line', a: Pt, b: Pt, strokeColor: string, width: number, fillColor?: string): VShape | null {
  if (a[0] === b[0] && a[1] === b[1]) return null
  if (tool === 'line') return newShape([{ x: a[0], y: a[1] }, { x: b[0], y: b[1] }], false, { strokeColor, width })
  const [x0, x1, y0, y1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])]
  const look = { strokeColor, width, ...(fillColor ? { fillColor } : {}) }
  // An ellipse is eight points on a smooth curve, like a snapped circle: round, yet every bit can be pulled.
  return newShape(boxPoints(tool, x0, y0, x1, y1), true, { ...look, box: tool, ...(tool === 'ellipse' ? { smooth: true } : {}) })
}

/** A see-through checkerboard pattern (cached per context). */
const checkers = new WeakMap<CanvasRenderingContext2D, CanvasPattern>()
function checker(g: CanvasRenderingContext2D): CanvasPattern {
  let p = checkers.get(g)
  if (!p) {
    const t = document.createElement('canvas')
    t.width = t.height = 16
    const c = t.getContext('2d')!
    c.fillStyle = 'rgba(127,127,127,0.25)'
    c.fillRect(0, 0, 16, 16)
    c.fillStyle = 'rgba(127,127,127,0.08)'
    c.fillRect(8, 0, 8, 8)
    c.fillRect(0, 8, 8, 8)
    p = g.createPattern(t, 'repeat')!
    checkers.set(g, p)
  }
  return p
}

/** Where the old picture sits when the canvas size changes. */
const ANCHORS: Record<string, { label: string; x: number; y: number }> = {
  tl: { label: 'Top left', x: 0, y: 0 },
  tm: { label: 'Top', x: 0.5, y: 0 },
  tr: { label: 'Top right', x: 1, y: 0 },
  ml: { label: 'Left', x: 0, y: 0.5 },
  mm: { label: 'Middle', x: 0.5, y: 0.5 },
  mr: { label: 'Right', x: 1, y: 0.5 },
  bl: { label: 'Bottom left', x: 0, y: 1 },
  bm: { label: 'Bottom', x: 0.5, y: 1 },
  br: { label: 'Bottom right', x: 1, y: 1 },
}

/** Copied pixels, shared by every Pixel Art file. */
let clipboard: { piece: Img; mask: Mask; x: number; y: number } | null = null
const MAP_TOOLS: { id: Tool; icon: typeof Brush; label: string }[] = [
  { id: 'tile', icon: Layers, label: 'Place tiles (drag over the tile picture to pick several)' },
  { id: 'tileErase', icon: Eraser, label: 'Remove tiles' },
  { id: 'tileFill', icon: PaintBucket, label: 'Fill with tiles' },
  { id: 'tileRandom', icon: Dices, label: 'Random tiles: each cell gets one of the picked tiles (pick several, e.g. grass variants)' },
  { id: 'pencil', icon: Brush, label: 'Draw pixels: changes the tile everywhere it is used' },
  { id: 'auto', icon: Sparkles, label: 'Draw new tiles: draw freely; changed cells become new tiles (identical ones are reused)' },
  { id: 'picker', icon: Pipette, label: 'Pick a tile from the map' },
]

type Live = { key: string; base: Img; img: Img; start: Pt; path: Pt[]; button: number; press?: number[]; ctrl?: Pt; from?: string; float?: { piece: Img; mask: Mask; x: number; y: number; rest: Img }; at?: Pt; snap?: { shape: Shape; at: Pt; perfect?: boolean; drawn?: Shape }; end?: Pt; xform?: { kind: 'scale' | 'rotate'; fixed: Pt; box: { x: number; y: number; w: number; h: number }; mask?: Mask; placed?: Mask } }

function Editor({ doc, title, active }: { doc: UseDocumentResult<PixelDoc> & { data: PixelDoc }; documentId: string; title: string; active: boolean }) {
  const d = doc.data
  useUndoRedoKeys(doc, active)
  useEffect(() => maybeStartTour('pixel'), [])
  const root = useProjectStore((s) => s.root)
  const lib = useDocument<TileLibrary>('level-layout', LIBRARY_ID, createLibrary)
  // A selection change right after a pixel change (same click) joins that undo step.
  const justChanged = useRef(false)
  const update = (fn: (x: PixelDoc) => PixelDoc, options?: { undoable?: boolean }) => {
    doc.update(fn, options)
    justChanged.current = true
    queueMicrotask(() => (justChanged.current = false))
  }

  const [tool, setTool] = useState<Tool>('pencil')
  // The main colour is this file's; the second colour is shared with Draw's colour panel, so both tools agree.
  const [main, setMain] = useState(d.palette[1] ?? '#ffffff')
  const second = usePalettes((p) => p.secondary)
  const colors: [string, string] = [main, second]
  const setColors = ([a, b]: [string, string]) => {
    setMain(a)
    if (b !== usePalettes.getState().secondary) usePalettes.getState().setSecondary(b)
  }
  const [size, setSize] = useState(1)
  const [round, setRound] = useState(false)
  // v0.16: how strokes put colour down, pen pressure, and a brush made from a selection.
  const [ink, setInk] = useState<'normal' | 'lockAlpha' | 'replace' | 'colorOnly'>('normal')
  const [pressure, setPressure] = useState(false)
  // Text tool: the font and its size in pixels.
  const [font, setFont] = useState('sans-serif')
  const [fontPx, setFontPx] = useState(8)
  const [brushImg, setBrushImg] = useState<{ piece: Img; mask: Mask; tint: boolean } | null>(null)
  // A curve waits for its second drag after the first one.
  const curve = useRef<{ key: string; base: Img; a: Pt; b: Pt } | null>(null)
  const [clean, setClean] = useState(true)
  const [filled, setFilled] = useState(false)
  const [contiguous, setContiguous] = useState(true)
  // v0.29: how different a colour may be and still count for the bucket and the magic wand (0 = exact).
  const [tolerance, setTolerance] = useState(0)
  /** What fill and the magic wand look at: this layer, every layer, or the reference layers (like Draw's). */
  const [sample, setSample] = useState<'layer' | 'all' | 'reference'>('layer')
  const lookAt = (own: Img) => (sample === 'all' ? frameImg(fi) : sample === 'reference' ? (refImg(fi) ?? own) : own)
  const [pickingRef, setPickingRef] = useState(false)
  const [outlineOpts, setOutlineOpts] = useState({ inside: false, corners: false })
  const [historyOpen, setHistoryOpen] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const panning = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const spaceDown = useRef(false)
  /** A point or shape on a shape layer is being dragged (Shape tool, or Line/Rectangle/Ellipse grabbing one). */
  const editing = useRef(false)
  const poly = useRef<{ pts: Pt[]; how: Combine; last: number } | null>(null)
  const [dither, setDither] = useState(16)
  const [sym, setSym] = useState({ x: false, y: false })
  const [seamless, setSeamless] = useState(false)
  const [onion, setOnion] = useState(false)
  // Onion skin: how many frames before and after, and red/blue tint for telling them apart.
  const [onionCount, setOnionCount] = useState(1)
  const [onionTint, setOnionTint] = useState(true)
  const [preview, setPreview] = useState(false)
  // Transforms change every frame of the layer, not only this one.
  const [allFrames, setAllFrames] = useState(false)
  const [angle, setAngle] = useState(15)
  const [scalePct, setScalePct] = useState(200)
  // A palette variant shown instead of the palette (preview only).
  const [variant, setVariant] = useState<string | null>(null)
  const [showGrid, setShowGrid] = useState(true)
  const [zoom, setZoom] = useState(() => Math.max(1, Math.min(32, Math.floor(480 / Math.max(d.width, d.height)))))
  // Wide or tall pixels: the picture is stretched on screen only.
  const ax = (d.pixelAspect ?? 1) > 1 ? (d.pixelAspect ?? 1) : 1
  const ay = (d.pixelAspect ?? 1) < 1 ? 1 / (d.pixelAspect ?? 1) : 1
  const [layerId, setLayerId] = useState(d.layers[d.layers.length - 1].id)
  const [frame, setFrame] = useState(0)
  const [mapMode, setMapMode] = useState(false)
  const [mapLayerId, setMapLayerId] = useState(d.map?.layers[0]?.id ?? '')
  const [stamp, setStamp] = useState({ col: 0, row: 0, w: 1, h: 1 })
  // Mirrors and turn for placed tiles (FLIP_H, FLIP_V, TRANSPOSE bits).
  const [tileFlags, setTileFlags] = useState(0)
  // The tile last drawn on in the tiles view, shown repeated 3 × 3 to see its seams.
  const [focusTile, setFocusTile] = useState<number | null>(null)
  const [mapDraft, setDraftState] = useState<Record<string, number> | null>(null)
  // Kept in a ref too: a quick click lets go before the state has re-rendered.
  const draft = useRef<Record<string, number> | null>(null)
  const setMapDraft = (v: Record<string, number> | null) => {
    draft.current = v
    setDraftState(v)
  }
  const [playing, setPlaying] = useState(false)
  const [playTag, setPlayTag] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [scale, setScale] = useState(1)
  const [sheetOpts, setSheetOpts] = useState<SheetOptions>(DEFAULT_SHEET)
  const [note, setNote] = useState<string | null>(null)
  // The selection (not saved with the file) and the one being drawn.
  // v0.29: the selection lives in the document, so selecting, deselecting and moving it are undo steps.
  const mask = useMemo(() => (d.selection ? textToMask(d.selection, d.width * d.height) : null), [d.selection, d.width, d.height])
  const setMask = (m: Mask | null) => {
    const text = m && m.some((v) => v) ? maskToText(m) : undefined
    if (text === d.selection) return
    doc.update((x) => ({ ...x, selection: text }), { undoable: !justChanged.current })
  }
  const selecting = useRef<{ start: Pt; path: Pt[]; how: Combine; preview: Mask | null } | null>(null)
  const [, tick] = useState(0)
  const live = useRef<Live | null>(null)
  // The app-wide pen settings (motion filtering, holding still) also apply here.
  useEffect(() => void useInputSettings.getState().load(), [])
  /** QuickShape: where the pointer last rested (screen px) and the snap timer. */
  const hold = useRef<{ timer?: ReturnType<typeof setTimeout>; rest: { x: number; y: number }; filter?: MotionFilter }>({ rest: { x: 0, y: 0 } })
  // The picture at 1:1 (off screen); `screen` shows it zoomed, `overlay` draws guides on top. Both fill the stage,
  // so pixels stay sharp at any zoom, zooming costs nothing, and the area around the picture takes the pointer too.
  const canvas = useRef<HTMLCanvasElement | null>(null)
  if (!canvas.current) canvas.current = document.createElement('canvas')
  const screen = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  /** Where the picture's top-left corner sits in the stage (CSS px); null = centre it on the next draw. */
  const view = useRef<{ x: number; y: number } | null>(null)
  const hover = useRef<Pt | null>(null)

  const urls = useMemo(() => Object.values(d.cels), [d.cels])
  const decodedCount = useDecoded(urls)
  const fi = Math.min(frame, d.frames.length - 1)
  const layer = d.layers.find((l) => l.id === layerId) ?? d.layers[d.layers.length - 1]
  const ts = d.tileSize ?? 16
  // v0.29: live shapes on shape layers.
  const shapeKey = resolveKey(d.cels, celKey(layer.id, d.frames[fi].id))
  const shapes = useShapeTool({ d, update: doc.update, celKey: shapeKey, colors, size, reach: Math.max(0.75, 6 / zoom) })
  // Picking a line layer (or a shape layer with one shape) shows that shape's points right away.
  useEffect(() => {
    if (layer.vector && shapes.list.length === 1) shapes.setSel({ id: shapes.list[0].id, point: null })
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only when another layer is picked
  }, [layer.id])
  const cols = tileColumns(d)
  const inMap = d.kind === 'tileset' && mapMode && !!d.map
  const mapLayer = d.map?.layers.find((l) => l.id === mapLayerId) ?? d.map?.layers[0]

  const imgOf = (layerId: string, frameId: string) => {
    const key = celKey(layerId, frameId)
    const real = resolveKey(d.cels, key)
    if (live.current?.key === real) return live.current.img
    if (curve.current?.key === real) return curvePreview(curve.current)
    return celImg(d.cels[real], d.width, d.height)
  }
  /** The frame as it is exported: reference layers left out. */
  // Flattened frames are kept until the file changes (thumbnails and onion skin would redo them on every redraw).
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- a new cache whenever pixels, layers or frames change
  const frameCache = useMemo(() => new Map<number, Img>(), [d.cels, d.layers, d.frames, d.celOpacity, d.width, d.height, decodedCount])
  const frameImg = (i: number) => {
    // The frame being drawn on right now is always fresh.
    const busy = live.current?.key ?? curve.current?.key
    const drawing = !!busy && d.layers.some((l) => resolveKey(d.cels, celKey(l.id, d.frames[i].id)) === busy)
    const hit = !drawing && frameCache.get(i)
    if (hit) return hit
    const img = composite(d.layers.filter((l) => !l.reference).map((l) => ({ visible: l.visible, opacity: celAlpha(d, l, d.frames[i].id), blend: l.blend, img: imgOf(l.id, d.frames[i].id) })), d.width, d.height)
    if (!drawing) frameCache.set(i, img)
    return img
  }
  /** Reference layers of a frame, drawn faintly under the picture while you draw. */
  const refImg = (i: number) => (d.layers.some((l) => l.reference && l.visible) ? composite(d.layers.filter((l) => l.reference).map((l) => ({ visible: l.visible, opacity: l.opacity, img: imgOf(l.id, d.frames[i].id) })), d.width, d.height) : null)

  // ---- Drawing on screen ----
  const draw = () => {
    const c = canvas.current
    if (!c) return
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    if (inMap && d.map) {
      c.width = d.map.width * ts
      c.height = d.map.height * ts
      g.clearRect(0, 0, c.width, c.height)
      const set = toCanvas(frameImg(0))
      for (const ml of d.map.layers) {
        if (!ml.visible) continue
        if (ml.id === mapLayer?.id && live.current?.key === 'map') {
          g.drawImage(toCanvas(live.current.img), 0, 0)
          continue
        }
        const cells = ml.id === mapLayer?.id && mapDraft ? mapDraft : ml.cells
        for (const [k, n] of Object.entries(cells)) {
          const [x, y] = k.split(',').map(Number)
          const t = tileOf(n)
          drawTile(g, set, (t.n % cols) * ts, Math.floor(t.n / cols) * ts, ts, x * ts, y * ts, ts, t.flags)
        }
      }
    } else {
      const reps = seamless ? 3 : 1
      c.width = d.width * reps
      c.height = d.height * reps
      g.clearRect(0, 0, c.width, c.height)
      const at = seamless ? [d.width, d.height] : [0, 0]
      if (onion && d.frames.length > 1)
        for (let k = onionCount; k >= 1; k--)
          for (const dir of [-1, 1]) {
            const j = fi + dir * k
            if (j < 0 || j >= d.frames.length) continue
            g.globalAlpha = (dir < 0 ? 0.32 : 0.2) / k
            g.drawImage(onionTint ? tinted(frameImg(j), dir < 0 ? '#e03131' : '#1c7ed6') : toCanvas(frameImg(j)), at[0], at[1])
            g.globalAlpha = 1
          }
      const v = d.variants?.find((x) => x.id === variant)
      const ref = refImg(fi)
      if (ref) {
        g.globalAlpha = 0.45
        g.drawImage(toCanvas(ref), at[0], at[1])
        g.globalAlpha = 1
      }
      const img = toCanvas(v ? swapColors(frameImg(fi), d.palette, v.colors) : frameImg(fi))
      if (seamless)
        for (let y = 0; y < 3; y++)
          for (let x = 0; x < 3; x++) {
            g.globalAlpha = x === 1 && y === 1 ? 1 : 0.5
            g.drawImage(img, x * d.width, y * d.height)
          }
      else g.drawImage(img, 0, 0)
      g.globalAlpha = 1
    }
    present()
    drawOverlay()
  }
  /** The stage's size in device pixels, and the picture's size and place on it. */
  const layout = () => {
    const st = stage.current
    const c = canvas.current!
    const dpr = window.devicePixelRatio || 1
    const W = st?.clientWidth ?? 0
    const H = st?.clientHeight ?? 0
    const w = c.width * zoom * ax
    const h = c.height * zoom * ay
    if (!view.current) view.current = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) }
    return { dpr, W, H, w, h, x: view.current.x, y: view.current.y }
  }
  /** Show the 1:1 picture zoomed on the stage, nearest-neighbour so every pixel stays a sharp square. */
  const present = () => {
    const sc = screen.current
    if (!sc) return
    const f = layout()
    const [bw, bh] = [Math.round(f.W * f.dpr), Math.round(f.H * f.dpr)]
    if (sc.width !== bw || sc.height !== bh) [sc.width, sc.height] = [bw, bh]
    const g = sc.getContext('2d')!
    g.clearRect(0, 0, bw, bh)
    const [x, y, w, h] = [Math.round(f.x * f.dpr), Math.round(f.y * f.dpr), Math.round(f.w * f.dpr), Math.round(f.h * f.dpr)]
    g.fillStyle = checker(g)
    g.save()
    g.translate(x, y)
    g.fillRect(0, 0, w, h)
    g.restore()
    g.imageSmoothingEnabled = false
    g.drawImage(canvas.current!, x, y, w, h)
    g.strokeStyle = 'rgba(127,127,127,0.5)'
    g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1)
  }
  /** Work on tile `n`: highlight it, zoom so it is big, and centre it. */
  const focusOn = (n: number) => {
    setFocusTile(n)
    const f = layout()
    const z = Math.max(zoom, Math.min(64, Math.floor((Math.min(f.W, f.H) * 0.6) / ts)))
    const [tx, ty] = [((n % cols) + 0.5) * ts, (Math.floor(n / cols) + 0.5) * ts]
    view.current = { x: Math.round(f.W / 2 - tx * z * ax), y: Math.round(f.H / 2 - ty * z * ay) }
    if (z !== zoom) setZoom(z)
    else draw()
  }
  /** Zoom to `z`, keeping the picture point under (cx, cy) (stage CSS px; default: the middle) in place. */
  const zoomAt = (z: number, cx?: number, cy?: number) => {
    const f = layout()
    const next = Math.max(1, Math.min(64, Math.round(z)))
    if (next === zoom) return
    const [px, py] = [cx ?? f.W / 2, cy ?? f.H / 2]
    view.current = { x: Math.round(px - ((px - f.x) * next) / zoom), y: Math.round(py - ((py - f.y) * next) / zoom) }
    setZoom(next)
  }
  /** Grid lines every `step` art pixels on the overlay. */
  const lines = (g: CanvasRenderingContext2D, step: number) => {
    const c = canvas.current!
    const s = zoom * (window.devicePixelRatio || 1)
    g.beginPath()
    for (let x = 0; x <= c.width; x += step) {
      g.moveTo(Math.round(x * s) + 0.5, 0)
      g.lineTo(Math.round(x * s) + 0.5, c.height * s)
    }
    for (let y = 0; y <= c.height; y += step) {
      g.moveTo(0, Math.round(y * s) + 0.5)
      g.lineTo(c.width * s, Math.round(y * s) + 0.5)
    }
    g.stroke()
  }
  const drawOverlay = () => {
    const o = overlay.current
    const c = canvas.current
    if (!o || !c) return
    const f = layout()
    const dpr = f.dpr
    const [bw, bh] = [Math.round(f.W * dpr), Math.round(f.H * dpr)]
    if (o.width !== bw || o.height !== bh) [o.width, o.height] = [bw, bh]
    const g = o.getContext('2d')!
    const s = zoom * dpr
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, o.width, o.height)
    // Guides are drawn in picture space: moved to where the picture sits (and stretched for wide/tall pixels).
    g.setTransform(ax, 0, 0, ay, Math.round(f.x * dpr), Math.round(f.y * dpr))
    g.lineWidth = 1
    if (showGrid && zoom >= 8 && !inMap) {
      g.strokeStyle = 'rgba(127,127,127,0.25)'
      lines(g, 1)
    }
    if (showGrid && d.kind === 'tileset') {
      g.strokeStyle = 'rgba(77,171,247,0.6)'
      lines(g, ts)
      const S = ts * s
      if (!inMap && d.map) {
        // Tile numbers, and unused tiles shaded so they are easy to spot.
        const used = new Set(d.map.layers.flatMap((ml) => Object.values(ml.cells).map((v) => tileOf(v).n)))
        for (let n = 0; n < cols * tileRows(d); n++) {
          const [x, y] = [(n % cols) * S, Math.floor(n / cols) * S]
          if (!used.has(n)) {
            g.fillStyle = 'rgba(0,0,0,0.22)'
            g.fillRect(x, y, S, S)
          }
          if (S >= 28) {
            g.fillStyle = 'rgba(255,255,255,0.75)'
            g.font = `${Math.max(9, Math.min(13, S / 5))}px sans-serif`
            g.fillText(String(n), x + 3, y + Math.max(10, Math.min(14, S / 4)))
          }
        }
      }
      if (inMap && mapLayer && (tool === 'tile' || tool === 'tileFill')) {
        // Every place the picked tile is used.
        g.strokeStyle = 'rgba(255, 213, 79, 0.9)'
        const n = stamp.row * cols + stamp.col
        for (const [k, v] of Object.entries(mapLayer.cells)) {
          if (tileOf(v).n !== n) continue
          const [x, y] = k.split(',').map(Number)
          g.strokeRect(x * S + 1.5, y * S + 1.5, S - 3, S - 3)
        }
      }
    }
    const shown = selecting.current?.preview ?? mask
    if (shown && !inMap) {
      // The selection's edge, dashed so it shows on light and dark pixels.
      const off = seamless ? [d.width, d.height] : [0, 0]
      g.beginPath()
      for (let y = 0; y < d.height; y++)
        for (let x = 0; x < d.width; x++) {
          if (!shown[y * d.width + x]) continue
          const X = (x + off[0]) * s
          const Y = (y + off[1]) * s
          const out = (dx: number, dy: number) => x + dx < 0 || y + dy < 0 || x + dx >= d.width || y + dy >= d.height || !shown[(y + dy) * d.width + x + dx]
          if (out(0, -1)) edge(g, X, Y, X + s, Y)
          if (out(0, 1)) edge(g, X, Y + s, X + s, Y + s)
          if (out(-1, 0)) edge(g, X, Y, X, Y + s)
          if (out(1, 0)) edge(g, X + s, Y, X + s, Y + s)
        }
      g.lineWidth = 1.5
      g.strokeStyle = '#000'
      g.setLineDash([])
      g.stroke()
      g.strokeStyle = '#fff'
      g.setLineDash([4, 4])
      g.stroke()
      g.setLineDash([])
      g.lineWidth = 1
    }
    if (layer.vector && !inMap && !seamless && ['shape', 'fill', 'line', 'curve', 'rect', 'ellipse', 'pencil'].includes(tool)) shapes.overlay(g, s)
    const off = seamless && !inMap ? [d.width, d.height] : [0, 0]
    if (poly.current) {
      // The polygon lasso so far, with a line to the pointer.
      const pts = [...poly.current.pts, ...(hover.current ? [hover.current] : [])]
      g.beginPath()
      pts.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, (x + off[0] + 0.5) * s, (y + off[1] + 0.5) * s))
      g.strokeStyle = '#4dabf7'
      g.lineWidth = 1.5
      g.stroke()
      g.lineWidth = 1
    }
    if (tool === 'move' && !inMap && !live.current) {
      // Transform handles around what Move would lift.
      const b = mask ? bounds(mask, d.width) : bounds(imgMask(celImg(d.cels[curKey()], d.width, d.height)), d.width)
      if (b) {
        g.strokeStyle = 'rgba(77,171,247,0.9)'
        g.strokeRect((b.x + off[0]) * s + 0.5, (b.y + off[1]) * s + 0.5, b.w * s, b.h * s)
        g.fillStyle = '#fff'
        for (const [cx, cy] of [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]) {
          g.fillRect((cx + off[0]) * s - 3.5, (cy + off[1]) * s - 3.5, 7, 7)
          g.strokeRect((cx + off[0]) * s - 3.5, (cy + off[1]) * s - 3.5, 7, 7)
        }
      }
    }
    if (d.kind === 'tileset' && !inMap && focusTile !== null) {
      // The tile being worked on.
      const S = ts * s
      g.lineWidth = 2
      g.strokeStyle = '#000'
      g.strokeRect((focusTile % cols) * S + 1, Math.floor(focusTile / cols) * S + 1, S - 2, S - 2)
      g.strokeStyle = 'rgba(255, 213, 79, 0.95)'
      g.setLineDash([6, 4])
      g.strokeRect((focusTile % cols) * S + 1, Math.floor(focusTile / cols) * S + 1, S - 2, S - 2)
      g.setLineDash([])
      g.lineWidth = 1
    }
    if (seamless && !inMap) {
      g.strokeStyle = 'rgba(255,255,255,0.6)'
      g.strokeRect(d.width * s + 0.5, d.height * s + 0.5, d.width * s, d.height * s)
    }
    const hp = hover.current
    if (hp) {
      g.strokeStyle = 'rgba(255,255,255,0.9)'
      if (inMap && tool !== 'pencil' && tool !== 'picker') g.strokeRect(hp[0] * ts * s + 0.5, hp[1] * ts * s + 0.5, (tool === 'tile' ? stamp.w : 1) * ts * s, (tool === 'tile' ? stamp.h : 1) * ts * s)
      else {
        const n = tool === 'pencil' || tool === 'eraser' || tool === 'shade' ? size : 1
        const lo = Math.floor((n - 1) / 2)
        const at = seamless && !inMap ? [hp[0] + d.width - lo, hp[1] + d.height - lo] : [hp[0] - lo, hp[1] - lo]
        g.strokeRect(at[0] * s + 0.5, at[1] * s + 0.5, n * s, n * s)
      }
    }
  }
  useEffect(draw)
  // A new picture size (map, seamless, canvas size) starts centred again.
  const shownW = inMap && d.map ? d.map.width * ts : d.width * (seamless ? 3 : 1)
  const shownH = inMap && d.map ? d.map.height * ts : d.height * (seamless ? 3 : 1)
  useEffect(() => void (view.current = null), [shownW, shownH])
  // Stage resized: show again. Wheel: Ctrl zooms at the pointer, otherwise it moves the picture (Shift: sideways).
  const wheel = useRef<(e: WheelEvent) => void>(() => {})
  wheel.current = (e) => {
    e.preventDefault()
    const r = stage.current!.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) {
      const step = zoom < 6 ? 1 : Math.ceil(zoom * 0.15)
      return zoomAt(zoom + (e.deltaY < 0 ? step : -step), e.clientX - r.left, e.clientY - r.top)
    }
    const f = layout()
    const k = e.deltaMode === 1 ? 16 : 1
    const [dx, dy] = e.shiftKey && !e.deltaX ? [e.deltaY, 0] : [e.deltaX, e.deltaY]
    view.current = { x: f.x - dx * k, y: f.y - dy * k }
    present()
    drawOverlay()
  }
  useEffect(() => {
    const st = stage.current
    if (!st) return
    const onWheel = (e: WheelEvent) => wheel.current(e)
    st.addEventListener('wheel', onWheel, { passive: false })
    const ro = new ResizeObserver(() => (present(), drawOverlay()))
    ro.observe(st)
    return () => (st.removeEventListener('wheel', onWheel), ro.disconnect())
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- handlers read the latest state through refs
  }, [])

  // Map and tiles have their own tools.
  useEffect(() => {
    setTool(inMap ? 'tile' : 'pencil')
  }, [inMap])

  // ---- Playback ----
  useEffect(() => {
    if (!playing) return
    const tag = d.tags.find((t) => t.id === playTag) ?? null
    const order = tagFrames(tag, d.frames.length, d.tags)
    let i = Math.max(0, order.indexOf(fi))
    let timer: ReturnType<typeof setTimeout>
    const step = () => {
      i = (i + 1) % order.length
      setFrame(order[i])
      timer = setTimeout(step, d.frames[order[i]].duration)
    }
    timer = setTimeout(step, d.frames[fi].duration)
    return () => clearTimeout(timer)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- restart only when play state or the tag changes
  }, [playing, playTag])

  // ---- Keys ----
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = (e) => {
    if (e.defaultPrevented || isTextField(e.target) || (e.target as HTMLElement | null)?.tagName === 'SELECT') return
    const hit = TOOLS.find((x) => isShortcut(e, x.key))
    const act = (fn: () => void) => (e.preventDefault(), fn())
    if (tool === 'shape' && layer.vector && !inMap && !(e.ctrlKey || e.metaKey) && shapes.key(e)) return e.preventDefault()
    if (poly.current && e.key === 'Enter') return act(finishPoly)
    if (poly.current && e.key === 'Escape') return act(() => ((poly.current = null), drawOverlay()))
    if (e.key === ' ' && !e.repeat) return act(() => (spaceDown.current = true))
    if (hit) return act(() => setTool(hit.id))
    if (isShortcut(e, 'pixel.swap')) return act(() => setColors([colors[1], colors[0]]))
    if (isShortcut(e, 'pixel.bigger')) return act(() => setSize((s) => Math.min(32, s + 1)))
    if (isShortcut(e, 'pixel.smaller')) return act(() => setSize((s) => Math.max(1, s - 1)))
    if (isShortcut(e, 'pixel.prev')) return act(() => setFrame((f) => (f - 1 + d.frames.length) % d.frames.length))
    if (isShortcut(e, 'pixel.next')) return act(() => setFrame((f) => (f + 1) % d.frames.length))
    if (isShortcut(e, 'pixel.play') && d.kind === 'sprite') return act(() => setPlaying((p) => !p))
    if (isShortcut(e, 'pixel.mode') && d.kind === 'tileset') return act(() => setMapMode((m) => !m))
    // Ctrl+arrows: the next tile (tileset) or the next frame (sprite).
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols } as Record<string, number>)[e.key]
    if (step && (e.ctrlKey || e.metaKey) && !inMap) {
      if (d.kind === 'tileset') return act(() => focusOn(Math.max(0, Math.min(cols * tileRows(d) - 1, (focusTile ?? 0) + step))))
      if (Math.abs(step) === 1) return act(() => setFrame((f) => (f + step + d.frames.length) % d.frames.length))
    }
    if (inMap) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'a') return act(() => setMask(all()))
    if (mod && k === 'd') return act(() => setMask(null))
    if (mod && k === 'c') return act(() => copySel(false))
    // Pixel edits would be overwritten by the next shape change on a shape layer.
    if (layer.vector && ((mod && (k === 'x' || k === 'v')) || ((e.key === 'Delete' || e.key === 'Backspace') && mask))) return act(() => setNote('This is a shape layer: change it with the Shape tool, or Turn into pixels first.'))
    if (mod && k === 'x') return act(() => copySel(true))
    if (mod && k === 'v') return act(pasteSel)
    if (e.key === 'Escape' && mask) return act(() => setMask(null))
    if ((e.key === 'Delete' || e.key === 'Backspace') && mask) return act(clearSel)
    const arrow = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key]
    if (arrow && tool === 'move' && !mod) return act(() => nudge(arrow[0] * (e.shiftKey ? ts : 1), arrow[1] * (e.shiftKey ? ts : 1)))
  }
  useEffect(() => {
    if (!active) return
    const on = (e: KeyboardEvent) => keys.current(e)
    // Capture, so Esc with a selection lets go of it before Layout Mode sees the key.
    const off = (e: KeyboardEvent) => e.key === ' ' && (spaceDown.current = false)
    window.addEventListener('keydown', on, true)
    window.addEventListener('keyup', off, true)
    return () => {
      window.removeEventListener('keydown', on, true)
      window.removeEventListener('keyup', off, true)
    }
  }, [active])

  // ---- Keep the Level Layout tileset up to date (tilesets linked to the library) ----
  const pushTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pushTileset = async (create: boolean) => {
    if (!root || !lib.data) return null
    const blob = new Blob([await pngBytes(frameImg(0))], { type: 'image/png' })
    const asset = await importAssetFromBlob(root, blob, 'image', `${safeFileName(title)}.png`)
    if (!asset) return null
    const id = d.libraryId && lib.data.tilesets.some((t) => t.id === d.libraryId) ? d.libraryId : create ? newId() : null
    if (!id) return null
    const fields = { name: title, image: asset.path, tileSize: ts, width: d.width, height: d.height, columns: cols, rows: tileRows(d), margin: undefined, spacing: undefined }
    lib.update((x) => (x.tilesets.some((t) => t.id === id) ? { ...x, tilesets: x.tilesets.map((t) => (t.id === id ? { ...t, ...fields } : t)) } : { ...x, tilesets: [...x.tilesets, { id, added: Date.now(), ...fields }] }), { undoable: false })
    if (d.libraryId !== id) update((x) => ({ ...x, libraryId: id }))
    return id
  }
  useEffect(() => {
    if (!d.libraryId) return
    clearTimeout(pushTimer.current)
    pushTimer.current = setTimeout(() => void pushTileset(false), 1500)
    return () => clearTimeout(pushTimer.current)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only the tileset's pixels matter
  }, [d.cels, d.layers, d.libraryId])

  const sendMap = async () => {
    if (!root || !d.map) return
    const id = await pushTileset(true)
    if (!id) return
    const levelId = useProjectStore.getState().addDocument('level-layout', `${title} map`).id
    // Level Layout's format: art layers of "x,y" → "tilesetId:column:row".
    const level = {
      width: d.map.width,
      height: d.map.height,
      tiles: {},
      notes: [],
      layers: d.map.layers.map((ml) => ({ id: newId(), name: ml.name, ...(ml.visible ? {} : { hidden: true }), art: Object.fromEntries(Object.entries(ml.cells).map(([k, v]) => [k, `${id}:${tileOf(v).n % cols}:${Math.floor(tileOf(v).n / cols)}${tileOf(v).flags ? `:${tileOf(v).flags}` : ''}`])) })),
    }
    await loadDocumentNow(root, 'level-layout', levelId, () => level)
    updateDocument(root, 'level-layout', levelId, (x) => x)
    openComponent('level-layout', levelId)
  }

  // ---- Pointer ----
  const pos = (e: { clientX: number; clientY: number }): Pt => {
    const r = stage.current!.getBoundingClientRect()
    const f = layout()
    const x = Math.floor((e.clientX - r.left - f.x) / (zoom * ax))
    const y = Math.floor((e.clientY - r.top - f.y) / (zoom * ay))
    if (inMap) return tool === 'pencil' || tool === 'auto' ? [x, y] : [Math.floor(x / ts), Math.floor(y / ts)]
    return seamless ? [x - d.width, y - d.height] : [x, y]
  }
  const wrap = (p: Pt): Pt => (seamless ? [((p[0] % d.width) + d.width) % d.width, ((p[1] % d.height) + d.height) % d.height] : p)

  /** Map pixel → tileset pixel under it (Draw pixels on the map edits the tile everywhere). */
  const mapToSet = (p: Pt): Pt | null => {
    const cell = `${Math.floor(p[0] / ts)},${Math.floor(p[1] / ts)}`
    const v = mapLayer?.cells[cell]
    if (v === undefined) return null
    const { n, flags } = tileOf(v)
    const [sx, sy] = tilePixel(flags, ((p[0] % ts) + ts) % ts, ((p[1] % ts) + ts) % ts, ts)
    return [(n % cols) * ts + sx, Math.floor(n / cols) * ts + sy]
  }

  /** Paint the whole stroke again from the layer's pixels before it started. */
  const render = (l: Live, end: Pt) => {
    l.end = end
    const img = cloneImg(l.base)
    const main = hexToRgba(paintHex(l.button === 2 ? colors[1] : colors[0]))
    const other = hexToRgba(paintHex(l.button === 2 ? colors[0] : colors[1]))
    /** The ink decides whether, and how, a pixel takes the colour. */
    const put = (x: number, y: number, c: RGBA) => {
      if (ink === 'normal') return setPx(img, x, y, c)
      const b = getPx(l.base, x, y)
      if (ink === 'lockAlpha' && !b[3]) return
      if (ink === 'replace' && (!b[3] || rgbaToHex(b[0], b[1], b[2]) !== l.from)) return
      if (ink === 'colorOnly') return b[3] ? setPx(img, x, y, [c[0], c[1], c[2], b[3]]) : undefined
      setPx(img, x, y, c)
    }
    const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < d.width && y < d.height && (!mask || inMap || !!mask[y * d.width + x])
    if (tool === 'gradient') {
      // Main colour at the start, second colour at the end, mixed by an even dither pattern in between.
      const [dx, dy] = [end[0] - l.start[0], end[1] - l.start[1]]
      const len = dx * dx + dy * dy || 1
      for (let y = 0; y < d.height; y++)
        for (let x = 0; x < d.width; x++) {
          if (!ok(x, y)) continue
          const t = Math.max(0, Math.min(1, ((x - l.start[0]) * dx + (y - l.start[1]) * dy) / len))
          put(x, y, ditherOn(x, y, Math.round(t * 16)) ? other : main)
        }
      l.img = img
      return
    }
    let pts: Pt[] = []
    const freehand = tool === 'pencil' || tool === 'eraser' || tool === 'shade'
    if (freehand) pts = !l.snap && clean && size === 1 && !pressure && !brushImg ? cleanPath(l.path) : l.path
    else if (tool === 'spray') pts = l.path
    else if (tool === 'line') pts = line(l.start[0], l.start[1], end[0], end[1])
    else if (tool === 'curve') pts = cleanPath(bezier(l.start, l.ctrl ?? l.start, end))
    else if (tool === 'rect') pts = rectPoints(l.start[0], l.start[1], end[0], end[1], filled)
    else if (tool === 'ellipse') pts = ellipsePoints(l.start[0], l.start[1], end[0], end[1], filled)
    else if (tool === 'lassofill') {
      const m = lassoMask(d.width, d.height, l.path.map(wrap))
      for (let i = 0; i < m.length; i++) if (m[i]) pts.push([i % d.width, Math.floor(i / d.width)])
    }
    // A brush made from a selection stamps its pixels at every point of the stroke.
    if (brushImg && tool === 'pencil') {
      const { piece, tint } = brushImg
      const [ox, oy] = [Math.floor(piece.width / 2), Math.floor(piece.height / 2)]
      for (const [x0, y0] of pts)
        for (let y = 0; y < piece.height; y++)
          for (let x = 0; x < piece.width; x++) {
            if (!brushImg.mask[y * piece.width + x]) continue
            const p = wrap([x0 + x - ox, y0 + y - oy])
            if (ok(p[0], p[1])) put(p[0], p[1], tint ? main : getPx(piece, x, y))
          }
      l.img = img
      return
    }
    if (tool !== 'spray' && tool !== 'lassofill') {
      if (freehand && pressure && l.press) {
        // Pen pressure sets the size of each point, up to the size slider.
        pts = l.path.flatMap(([x, y], i) => brushOffsets(Math.max(1, Math.round(size * (l.press![i] ?? 1))), round).map(([bx, by]): Pt => [x + bx, y + by]))
      } else {
        const brush = brushOffsets(size, round)
        pts = pts.flatMap(([x, y]) => brush.map(([bx, by]): Pt => [x + bx, y + by]))
      }
    }
    if (!inMap) pts = mirror(pts, d.width, d.height, sym)
    const seen = new Set<number>()
    for (const p0 of pts) {
      const p = inMap ? mapToSet(p0) : wrap(p0)
      if (!p || !ok(p[0], p[1])) continue
      const k = p[1] * d.width + p[0]
      if (seen.has(k)) continue
      seen.add(k)
      if (tool !== 'eraser' && tool !== 'shade' && !ditherOn(p[0], p[1], dither)) continue
      if (tool === 'eraser') setPx(img, p[0], p[1], [0, 0, 0, 0])
      else if (tool === 'shade') {
        const [r, g, b, a] = getPx(l.base, p[0], p[1])
        const next = a ? shadeStep(d.palette, rgbaToHex(r, g, b), l.button === 2 ? -1 : 1) : null
        if (next) setPx(img, p[0], p[1], hexToRgba(next))
      } else put(p[0], p[1], main)
    }
    l.img = img
  }

  /** The waiting curve, drawn as its straight line. */
  const curvePreview = (c: NonNullable<typeof curve.current>) => {
    const l: Live = { key: c.key, base: c.base, img: c.base, start: c.a, path: [c.b], button: 0, ctrl: c.a }
    render(l, c.b)
    return l.img
  }

  /** Spray: a few random pixels around p, inside a circle as wide as the size. */
  const spray = (l: Live, p: Pt) => {
    const r = size + 1
    for (let i = 0; i < Math.max(2, size); i++) {
      const a = Math.random() * Math.PI * 2
      const dist = Math.sqrt(Math.random()) * r
      l.path.push([Math.round(p[0] + Math.cos(a) * dist), Math.round(p[1] + Math.sin(a) * dist)])
    }
  }

  /** The current map layer as one picture (for drawing new tiles freely). */
  const mapRaster = (cells: Record<string, number>) => {
    const set = frameImg(0)
    const img = blank(d.map!.width * ts, d.map!.height * ts)
    for (const [k, v] of Object.entries(cells)) {
      const [mx, my] = k.split(',').map(Number)
      const { n, flags } = tileOf(v)
      for (let y = 0; y < ts; y++)
        for (let x = 0; x < ts; x++) {
          const [sx, sy] = tilePixel(flags, x, y, ts)
          setPx(img, mx * ts + x, my * ts + y, getPx(set, (n % cols) * ts + sx, Math.floor(n / cols) * ts + sy))
        }
    }
    return img
  }
  /** Draw new tiles: the stroke on the layer picture (pencil, or eraser with the right button). */
  const renderAuto = (l: Live) => {
    const img = cloneImg(l.base)
    const c: RGBA = l.button === 2 ? [0, 0, 0, 0] : hexToRgba(paintHex(colors[0]))
    const brush = brushOffsets(size, round)
    for (const [x, y] of clean && size === 1 ? cleanPath(l.path) : l.path) for (const [bx, by] of brush) if (ditherOn(x + bx, y + by, dither) || l.button === 2) setPx(img, x + bx, y + by, c)
    l.img = img
  }
  /** Cells the stroke changed become tiles: an identical tile is reused, a new one goes into a free slot (the tileset grows when full). */
  const commitAuto = (l: Live) => {
    if (!d.map || !mapLayer) return
    const set = cloneImg(frameImg(0))
    let rows = tileRows(d)
    const used = new Set(d.map.layers.flatMap((ml) => Object.values(ml.cells).map((v) => tileOf(v).n)))
    const cells = { ...mapLayer.cells }
    // The pixels written to the current layer of the tileset (frame 1).
    const key = resolveKey(d.cels, celKey(layer.id, d.frames[0].id))
    let layerImg = cloneImg(celImg(d.cels[key], d.width, d.height))
    let height = d.height
    for (let my = 0; my < d.map.height; my++)
      for (let mx = 0; mx < d.map.width; mx++) {
        const before = tilePixels(l.base, my * d.map.width + mx, d.map.width, ts)
        const after = tilePixels(l.img, my * d.map.width + mx, d.map.width, ts)
        if (sameImg(before, after)) continue
        if (emptyImg(after)) {
          delete cells[`${mx},${my}`]
          continue
        }
        let n = -1
        for (let i = 0; i < cols * rows && n < 0; i++) if (sameImg(tilePixels(set, i, cols, ts), after)) n = i
        if (n < 0) {
          for (let i = 0; i < cols * rows && n < 0; i++) if (!used.has(i) && emptyImg(tilePixels(set, i, cols, ts))) n = i
          if (n < 0) {
            // No free slot: one more row of tiles.
            n = cols * rows
            rows++
            height += ts
            const grown = blank(d.width, height)
            grown.data.set(layerImg.data)
            layerImg = grown
            const s2 = blank(d.width, height)
            s2.data.set(set.data)
            set.data = s2.data
            set.height = height
          }
          for (let y = 0; y < ts; y++)
            for (let x = 0; x < ts; x++) {
              const c = getPx(after, x, y)
              setPx(layerImg, (n % cols) * ts + x, Math.floor(n / cols) * ts + y, c)
              setPx(set, (n % cols) * ts + x, Math.floor(n / cols) * ts + y, c)
            }
          used.add(n)
        }
        cells[`${mx},${my}`] = n
      }
    const grow = height !== d.height
    update((x) => {
      const cels = { ...x.cels }
      // A taller tileset: every other cel gets the new empty row too.
      if (grow)
        for (const [k, url] of Object.entries(x.cels)) {
          if (isLink(url) || k === key) continue
          const g2 = blank(x.width, height)
          g2.data.set(celImg(url, x.width, x.height).data)
          const e = encode(g2)
          if (e) cels[k] = e
        }
      const url = encode(layerImg)
      if (url) cels[key] = url
      return { ...x, height, cels, map: x.map && { ...x.map, layers: x.map.layers.map((ml) => (ml.id === mapLayer.id ? { ...ml, cells } : ml)) } }
    })
  }

  /** Text at p in the main colour: drawn at the font's pixel size and cut to hard pixels (no soft edges). */
  const addText = async (p: Pt) => {
    const text = (await promptDialog('Text', ''))?.trim()
    if (!text) return
    const key = curKey()
    const img = cloneImg(celImg(d.cels[key], d.width, d.height))
    const t = textImg(text, font, fontPx)
    const c = hexToRgba(paintHex(colors[0]))
    for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) if (t.data[(y * t.width + x) * 4 + 3] >= 128 && (!mask || mask[(p[1] + y) * d.width + p[0] + x])) setPx(img, p[0] + x, p[1] + y, c)
    commit(key, img)
  }

  const pick = (p: Pt, button: number) => {
    if (inMap) {
      const v = mapLayer?.cells[`${p[0]},${p[1]}`]
      if (v !== undefined) {
        const { n, flags } = tileOf(v)
        setStamp({ col: n % cols, row: Math.floor(n / cols), w: 1, h: 1 })
        setTileFlags(flags)
      }
      return setTool('tile')
    }
    const q = wrap(p)
    const [r, g, b, a] = getPx(frameImg(fi), q[0], q[1])
    if (!a) return
    const hex = rgbaToHex(r, g, b)
    setColors(button === 2 ? [colors[0], hex] : [hex, colors[1]])
  }

  const onDown = (e: React.PointerEvent) => {
    if (e.button === 1 || tool === 'hand' || spaceDown.current) {
      // Look around: the picture moves with the pointer.
      const f = layout()
      e.currentTarget.setPointerCapture(e.pointerId)
      panning.current = { x: e.clientX, y: e.clientY, vx: f.x, vy: f.y }
      return
    }
    const p = pos(e)
    if (tool === 'picker' || (e.altKey && !inMap)) return pick(p, e.button)
    if (inMap && tool === 'auto') {
      if (!mapLayer || !d.map) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const base = mapRaster(mapLayer.cells)
      live.current = { key: 'map', base, img: base, start: p, path: [p], button: e.button }
      renderAuto(live.current)
      return draw()
    }
    if (inMap && tool !== 'pencil') {
      if (!mapLayer || !d.map) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const cells = { ...mapLayer.cells }
      if (tool === 'tileFill') {
        const from = cells[`${p[0]},${p[1]}`]
        const n = (stamp.row * cols + stamp.col) | (tileFlags << 16)
        const stack: Pt[] = [p]
        const seen = new Set<string>()
        while (stack.length) {
          const [x, y] = stack.pop()!
          const k = `${x},${y}`
          if (seen.has(k) || x < 0 || y < 0 || x >= d.map.width || y >= d.map.height || cells[k] !== from) continue
          seen.add(k)
          cells[k] = n
          stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
        }
        return commitMap(cells)
      }
      setMapDraft(placeTiles(cells, p, e.button === 2))
      return
    }
    if (tool === 'polySelect' && !inMap) {
      const q = wrap(p)
      const pl = poly.current
      const now = Date.now()
      if (!pl) {
        poly.current = { pts: [q], how: e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace', last: now }
        return drawOverlay()
      }
      const closes = pl.pts.length >= 3 && (Math.abs(q[0] - pl.pts[0][0]) <= 1 && Math.abs(q[1] - pl.pts[0][1]) <= 1 || now - pl.last < 350)
      if (closes) return finishPoly()
      pl.pts.push(q)
      pl.last = now
      return drawOverlay()
    }
    if (tool === 'select' || tool === 'lasso' || tool === 'wand' || tool === 'ellipseSelect') {
      const how: Combine = e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace'
      const q = wrap(p)
      if (tool === 'wand') {
        if (q[0] < 0 || q[1] < 0 || q[0] >= d.width || q[1] >= d.height) return
        return setMask(combine(mask, wandMask(lookAt(celImg(d.cels[curKey()], d.width, d.height)), q[0], q[1], contiguous, tolerance), how))
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      selecting.current = { start: q, path: [q], how, preview: null }
      return
    }
    if (layer.locked || !layer.visible) return setNote(layer.locked ? 'This layer is locked.' : 'This layer is hidden.')
    if (tool === 'shape' && !layer.vector) return setNote('The Shape tool works on a shape layer: add one with the shapes button in Layers.')
    if (layer.vector && !inMap) {
      // Shape tool, or a drawing tool grabbing a point or edge of a shape already there: edit it.
      // Drawing tools grab only a point, so a new shape can start inside an old one.
      const hit = (tool === 'line' || (tool === 'curve' && !curve.current) || tool === 'rect' || tool === 'ellipse') && hitShape(shapes.list, { x: wrap(p)[0], y: wrap(p)[1] }, Math.max(0.75, 6 / zoom))
      const grab = hit && 'point' in hit
      if (tool === 'shape' || grab) {
        e.currentTarget.setPointerCapture(e.pointerId)
        editing.current = true
        return shapes.down(wrap(p))
      }
      if (tool === 'fill') {
        if (!shapes.fillAt(wrap(p), e.button === 2 ? null : paintHex(colors[0]))) setNote('Click inside a closed shape to fill it (right-click takes the fill away).')
        return
      }
      if (tool !== 'pencil' && tool !== 'rect' && tool !== 'ellipse' && tool !== 'line' && tool !== 'curve') return setNote('This is a shape layer: use the Shape tool, the bucket, Line, Curve, Rectangle, Ellipse or the pencil (a rough stroke becomes a shape). Turn into pixels makes it a normal layer.')
    }
    if (tool === 'text') return void addText(wrap(p))
    if (d.kind === 'tileset' && !inMap && p[0] >= 0 && p[1] >= 0 && p[0] < d.width && p[1] < d.height) setFocusTile(Math.floor(p[1] / ts) * cols + Math.floor(p[0] / ts))
    const frameId = inMap ? d.frames[0].id : d.frames[fi].id
    const key = resolveKey(d.cels, celKey(layer.id, frameId))
    const base = cloneImg(celImg(d.cels[key], d.width, d.height))
    if (tool === 'fill') {
      const q = wrap(p)
      if (q[0] < 0 || q[1] < 0 || q[0] >= d.width || q[1] >= d.height) return
      const img = cloneImg(base)
      const c = hexToRgba(paintHex(e.button === 2 ? colors[1] : colors[0]))
      for (const [x, y] of floodPoints(lookAt(base), q[0], q[1], contiguous, tolerance)) if (ditherOn(x, y, dither) && (!mask || mask[y * d.width + x])) setPx(img, x, y, c)
      return commit(key, img)
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (tool === 'move') {
      // Lift the selected pixels (or the whole layer) off, to drop them where the pointer lets go.
      const rest = cloneImg(base)
      const c = cut(rest, mask ?? rectMask(d.width, d.height, 0, 0, d.width - 1, d.height - 1))
      if (!c) return
      live.current = { key, base, img: base, start: p, path: [p], button: e.button, float: { ...c, rest }, at: p }
      // Transform handles: a corner scales, outside the box turns.
      const box = { x: c.x, y: c.y, w: c.piece.width, h: c.piece.height }
      const reach = Math.max(1, 6 / zoom)
      const corners: Pt[] = [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]]
      const ci = corners.findIndex(([cx, cy]) => Math.abs(p[0] + 0.5 - cx) <= reach && Math.abs(p[1] + 0.5 - cy) <= reach)
      const outside = p[0] < box.x - reach || p[1] < box.y - reach || p[0] >= box.x + box.w + reach || p[1] >= box.y + box.h + reach
      if (ci >= 0) live.current.xform = { kind: 'scale', fixed: corners[(ci + 2) % 4], box, mask: mask ?? undefined }
      else if (outside) live.current.xform = { kind: 'rotate', fixed: [box.x + box.w / 2, box.y + box.h / 2], box, mask: mask ?? undefined }
      return
    }
    const q = wrap(p)
    const under = q[0] >= 0 && q[1] >= 0 && q[0] < d.width && q[1] < d.height ? getPx(base, q[0], q[1]) : null
    const from = under ? rgbaToHex(under[0], under[1], under[2]) : undefined
    const c = curve.current
    // The second drag of a curve bends the line drawn by the first.
    live.current = c && tool === 'curve' ? { key: c.key, base: c.base, img: c.base, start: c.a, path: [c.b], button: e.button, ctrl: p } : { key, base, img: base, start: p, path: [p], button: e.button, from, press: [penPressure(e)] }
    clearTimeout(hold.current.timer)
    hold.current.rest = { x: e.clientX, y: e.clientY }
    // Shaky hands: Motion filtering from Pen and keys also steadies the pencil.
    hold.current.filter = new MotionFilter(useInputSettings.getState().motionFilter)
    hold.current.filter.filter(e.clientX, e.clientY, e.timeStamp)
    if (tool === 'spray') spray(live.current, p)
    render(live.current, c && tool === 'curve' ? c.b : p)
    draw()
  }

  /** Transform handles: the lifted pixels scaled from the opposite corner, or turned around the middle. */
  const transformFloat = (l: Live, p: Pt, shift: boolean) => {
    const f = l.float!
    const t = l.xform!
    let piece: Img
    let pm: Mask
    let x: number
    let y: number
    const fm = maskImg(f.mask, f.piece.width, f.piece.height)
    if (t.kind === 'scale') {
      const [fx, fy] = t.fixed
      let w = Math.max(1, Math.abs(p[0] + 0.5 - fx))
      let h = Math.max(1, Math.abs(p[1] + 0.5 - fy))
      if (shift) {
        const k = Math.max(w / t.box.w, h / t.box.h)
        ;[w, h] = [t.box.w * k, t.box.h * k]
      }
      ;[w, h] = [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))]
      piece = scaleImg(f.piece, w, h)
      pm = imgMask(scaleImg(fm, w, h))
      x = p[0] + 0.5 < fx ? fx - w : fx
      y = p[1] + 0.5 < fy ? fy - h : fy
    } else {
      const [cx, cy] = t.fixed
      let deg = ((Math.atan2(p[1] + 0.5 - cy, p[0] + 0.5 - cx) - Math.atan2(l.start[1] + 0.5 - cy, l.start[0] + 0.5 - cx)) * 180) / Math.PI
      deg = shift ? Math.round(deg / 15) * 15 : Math.round(deg)
      piece = rotateAny(f.piece, deg)
      pm = imgMask(rotateAny(fm, deg))
      x = Math.round(cx - piece.width / 2)
      y = Math.round(cy - piece.height / 2)
    }
    const img = cloneImg(f.rest)
    paste(img, piece, x, y, pm)
    l.img = img
    t.placed = placeMask(d.width, d.height, pm, piece.width, x, y)
  }

  /** Polygon lasso: the clicked corners become the selection. */
  const finishPoly = () => {
    const pl = poly.current
    poly.current = null
    if (pl && pl.pts.length >= 3) setMask(combine(mask, lassoMask(d.width, d.height, pl.pts), pl.how))
    drawOverlay()
  }

  /** Zoom so the whole picture fits the stage. */
  const zoomToFit = () => {
    const st = stage.current
    if (!st) return
    const W = inMap && d.map ? d.map.width * ts : d.width
    const H = inMap && d.map ? d.map.height * ts : d.height
    const z = Math.max(1, Math.min(64, Math.floor(Math.min((st.clientWidth - 48) / (W * ax), (st.clientHeight - 48) / (H * ay)))))
    const [w, h] = [canvas.current!.width * z * ax, canvas.current!.height * z * ay]
    view.current = { x: Math.round((st.clientWidth - w) / 2), y: Math.round((st.clientHeight - h) / 2) }
    if (z !== zoom) setZoom(z)
    else draw()
  }

  /** Where the lifted pixels would land, moved by dx,dy. */
  const dropFloat = (l: Live, dx: number, dy: number) => {
    const f = l.float!
    const img = cloneImg(f.rest)
    paste(img, f.piece, f.x + dx, f.y + dy, f.mask)
    l.img = img
  }

  const placeTiles = (cells: Record<string, number>, p: Pt, erase: boolean) => {
    if (!d.map) return cells
    const next = { ...cells }
    const w = tool === 'tile' ? stamp.w : 1
    const h = tool === 'tile' ? stamp.h : 1
    // A turned stamp swaps its width and height; each placed tile carries the same mirrors and turn.
    const [W, H] = tileFlags & TRANSPOSE ? [h, w] : [w, h]
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const cx = p[0] + x
        const cy = p[1] + y
        if (cx < 0 || cy < 0 || cx >= d.map.width || cy >= d.map.height) continue
        if (tool === 'tileErase' || erase) {
          delete next[`${cx},${cy}`]
          continue
        }
        if (tool === 'tileRandom') {
          next[`${cx},${cy}`] = ((stamp.row + Math.floor(Math.random() * stamp.h)) * cols + stamp.col + Math.floor(Math.random() * stamp.w)) | (tileFlags << 16)
          continue
        }
        let [sx, sy] = [x, y]
        if (tileFlags & FLIP_V) sy = H - 1 - sy
        if (tileFlags & FLIP_H) sx = W - 1 - sx
        if (tileFlags & TRANSPOSE) [sx, sy] = [sy, sx]
        next[`${cx},${cy}`] = ((stamp.row + sy) * cols + stamp.col + sx) | (tileFlags << 16)
      }
    return next
  }

  const onMove = (e: React.PointerEvent) => {
    const pan = panning.current
    if (pan) {
      view.current = { x: pan.vx + e.clientX - pan.x, y: pan.vy + e.clientY - pan.y }
      present()
      return drawOverlay()
    }
    let p = pos(e)
    hover.current = p
    if (poly.current) return drawOverlay()
    if (editing.current && layer.vector && !inMap) {
      shapes.move(wrap(p), e.ctrlKey || e.metaKey)
      return drawOverlay()
    }
    if (draft.current) {
      setMapDraft(placeTiles(draft.current, p, (e.buttons & 2) === 2))
      return
    }
    const sel = selecting.current
    if (sel) {
      const q0 = wrap(p)
      // Ctrl while dragging: a perfect square or circle.
      const q = (e.ctrlKey || e.metaKey) && (tool === 'select' || tool === 'ellipseSelect') ? square(sel.start, q0) : q0
      sel.path.push(q)
      sel.preview = combine(mask, tool === 'lasso' ? lassoMask(d.width, d.height, sel.path) : tool === 'ellipseSelect' ? ellipseMask(d.width, d.height, sel.start[0], sel.start[1], q[0], q[1]) : rectMask(d.width, d.height, sel.start[0], sel.start[1], q[0], q[1]), sel.how)
      return drawOverlay()
    }
    const l = live.current
    if (!l) return drawOverlay()
    if (l.float && l.xform) {
      transformFloat(l, p, e.shiftKey)
      return draw()
    }
    if (l.float) {
      l.at = p
      dropFloat(l, p[0] - l.start[0], p[1] - l.start[1])
      return draw()
    }
    if (l.key === 'map') {
      const last = l.path[l.path.length - 1]
      if (last[0] !== p[0] || last[1] !== p[1]) l.path.push(...line(last[0], last[1], p[0], p[1]).slice(1))
      renderAuto(l)
      return draw()
    }
    if (l.snap) {
      // Snapped: the shape follows the pointer instead of the stroke growing; wobbling near the snap keeps it still.
      const tol = holdTolerance()
      const px = zoom * ax
      reshape(l, Math.hypot(p[0] - l.snap.at[0], p[1] - l.snap.at[1]) * px <= tol ? l.snap.at : p)
      if (Math.hypot(e.clientX - hold.current.rest.x, e.clientY - hold.current.rest.y) > tol) {
        hold.current.rest = { x: e.clientX, y: e.clientY }
        armPerfect(l)
      }
      return draw()
    }
    if (tool === 'pencil' || tool === 'eraser' || tool === 'shade' || tool === 'lassofill') {
      const f = hold.current.filter
      if (f && f.amount > 0 && !inMap) {
        const q = f.filter(e.clientX, e.clientY, e.timeStamp)
        p = pos({ clientX: q.x, clientY: q.y })
      }
      const last = l.path[l.path.length - 1]
      if (last[0] === p[0] && last[1] === p[1]) return
      const added = line(last[0], last[1], p[0], p[1]).slice(1)
      l.path.push(...added)
      l.press?.push(...added.map(() => penPressure(e)))
      if (tool !== 'lassofill' && Math.hypot(e.clientX - hold.current.rest.x, e.clientY - hold.current.rest.y) > holdTolerance()) {
        hold.current.rest = { x: e.clientX, y: e.clientY }
        armSnap(l)
      }
    }
    if (tool === 'spray') spray(l, p)
    if (tool === 'curve' && l.ctrl) {
      l.ctrl = p
      render(l, l.path[0])
      return draw()
    }
    render(l, !(e.shiftKey || ((e.ctrlKey || e.metaKey) && (tool === 'rect' || tool === 'ellipse'))) ? p : tool === 'line' || tool === 'curve' ? constrain(l.start, p) : tool === 'rect' || tool === 'ellipse' ? square(l.start, p) : p)
    draw()
  }
  // QuickShape for the pencil, eraser and shade brush: rest at the end of a stroke and it snaps to a clean
  // line, arc, box or ellipse in whole pixels; keep holding and it turns perfect. One undo step, like any stroke.
  const reshape = (l: Live, to: Pt) => {
    if (!l.snap) return
    let shape = resize(l.snap.shape, { x: l.snap.at[0], y: l.snap.at[1] }, { x: to[0], y: to[1] })
    shape = shapeKeys.shift || l.snap.perfect ? perfect(shape) : gentle(shape)
    l.snap.drawn = shape
    l.path = shapePixels(shape)
    l.press = undefined
    render(l, to)
  }
  const armSnap = (l: Live) => {
    clearTimeout(hold.current.timer)
    hold.current.timer = setTimeout(() => {
      if (live.current !== l || l.snap) return
      const px = zoom * ax
      const shape = recognize(l.path.map(([x, y]) => ({ x, y })), holdTolerance() / px)
      if (!shape) return
      const at = l.path[l.path.length - 1]
      l.snap = { shape, at }
      reshape(l, at)
      draw()
      armPerfect(l)
    }, HOLD_MS)
  }
  const armPerfect = (l: Live) => {
    clearTimeout(hold.current.timer)
    if (l.snap?.perfect) return
    hold.current.timer = setTimeout(() => {
      if (live.current !== l || !l.snap) return
      l.snap.perfect = true
      reshape(l, hover.current ?? l.snap.at)
      draw()
    }, PERFECT_MS)
  }

  const onUp = () => {
    clearTimeout(hold.current.timer)
    if (panning.current) return void (panning.current = null)
    if (editing.current) {
      editing.current = false
      return shapes.up()
    }
    if (draft.current) {
      commitMap(draft.current)
      setMapDraft(null)
    }
    const sel = selecting.current
    if (sel) {
      selecting.current = null
      // A click without dragging clears the selection.
      setMask(sel.path.length < 2 && sel.how === 'replace' ? null : sel.preview)
      return
    }
    const l = live.current
    if (!l) return
    live.current = null
    if (l.key === 'map') return commitAuto(l)
    if (tool === 'curve' && !l.ctrl) {
      // Keep the line on screen and wait for the drag that bends it.
      curve.current = { key: l.key, base: l.base, a: l.start, b: hover.current ?? l.start }
      return
    }
    curve.current = null
    if (l.xform) {
      commit(l.key, l.img)
      if (l.xform.mask && l.xform.placed) setMask(l.xform.placed)
      return
    }
    const movedMask = l.float && mask && l.at ? placeMask(d.width, d.height, l.float.mask, l.float.piece.width, l.float.x + l.at[0] - l.start[0], l.float.y + l.at[1] - l.start[1]) : null
    // A curve keeps three points: both ends and the middle of the bend, so dragging the middle bends it again.
    const curved = tool === 'curve' && l.ctrl ? liveCurve(l.start, l.ctrl, l.path[0], paintHex(l.button === 2 ? colors[1] : colors[0]), size) : null
    const boxTool = tool === 'line' || tool === 'rect' || tool === 'ellipse' ? tool : null
    if ((boxTool || curved) && !inMap && (!layer.vector || layer.sub)) {
      // Lines, curves, rectangles and ellipses become their own small layer above the layer they were drawn on: click it later to drag their points.
      const made = curved ?? liveBox(boxTool!, l.start, l.end ?? l.start, paintHex(l.button === 2 ? colors[1] : colors[0]), size, boxTool !== 'line' && filled ? paintHex(l.button === 2 ? colors[0] : colors[1]) : undefined)
      if (!made) return draw()
      const parent = layer.sub ?? layer.id
      const name = curved ? 'Curve' : boxTool === 'rect' ? 'Rectangle' : boxTool === 'ellipse' ? 'Ellipse' : 'Line'
      const sub = { ...newPixelLayer(`${name} ${d.layers.filter((x) => x.sub).length + 1}`), vector: true, sub: parent }
      update((x) => {
        const i = x.layers.findIndex((y) => y.id === layer.id)
        const withLayer = { ...x, layers: [...x.layers.slice(0, i + 1), sub, ...x.layers.slice(i + 1)] }
        return withShapes(withLayer, celKey(sub.id, x.frames[fi].id), [made])
      })
      setLayerId(sub.id)
      return
    }
    if (layer.vector && curved) return void shapes.add(curved)
    if (layer.vector && (tool === 'rect' || tool === 'ellipse' || tool === 'line')) {
      // On a shape layer these tools make a live shape: Filled gives it the second colour inside.
      const end = l.end ?? l.start
      const made = liveBox(tool, l.start, end, paintHex(l.button === 2 ? colors[1] : colors[0]), size, tool !== 'line' && filled ? paintHex(l.button === 2 ? colors[0] : colors[1]) : undefined)
      if (made) shapes.add(made)
      else draw()
      return
    }
    if (layer.vector && tool === 'pencil') {
      // On a shape layer the stroke becomes a live shape: the snapped one, or the stroke's corners.
      const made = l.snap?.drawn ? fromQuickShape(l.snap.drawn) : fromStroke(l.path.map(([x, y]) => ({ x, y })))
      if (made) shapes.add({ ...made, strokeColor: paintHex(l.button === 2 ? colors[1] : colors[0]), width: size })
      else draw()
      return
    }
    commit(l.key, l.img)
    if (movedMask) setMask(movedMask)
  }

  const commit = (key: string, img: Img) => {
    // A layer shown on all tiles: what was drawn on this tile goes onto every tile.
    if (d.kind === 'tileset' && !inMap && layer.allTiles && focusTile !== null && key === curKey()) img = everyTile(img, focusTile, ts)
    const url = encode(img)
    update((x) => {
      const cels = { ...x.cels }
      if (url) cels[key] = url
      else delete cels[key]
      return { ...x, cels }
    })
    tick((n) => n + 1)
  }
  const commitMap = (cells: Record<string, number>) => update((x) => (x.map ? { ...x, map: { ...x.map, layers: x.map.layers.map((l) => (l.id === mapLayer?.id ? { ...l, cells } : l)) } } : x))

  /** Change one colour in every cel (palette entry edited). */
  const recolor = (from: string, to: string) =>
    update((x) => {
      const cels = { ...x.cels }
      for (const [k, url] of Object.entries(x.cels)) {
        if (isLink(url)) continue
        const img = cloneImg(celImg(url, x.width, x.height))
        if (!replaceColor(img, from, to)) continue
        const next = encode(img)
        if (next) cels[k] = next
      }
      // Live shapes change colour with their pixels, so the next edit keeps the new colour.
      const swap = (c?: string) => (c?.toLowerCase() === from.toLowerCase() ? to : c)
      const shapes = x.shapes && Object.fromEntries(Object.entries(x.shapes).map(([k, c]) => [k, { ...c, list: c.list.map((sh) => ({ ...sh, fillColor: swap(sh.fillColor), strokeColor: swap(sh.strokeColor) })) }]))
      return { ...x, cels, ...(shapes ? { shapes } : {}), palette: x.palette.map((c) => (c === from ? to : c)) }
    })

  const curKey = () => resolveKey(d.cels, celKey(layer.id, d.frames[inMap ? 0 : fi].id))
  const all = () => rectMask(d.width, d.height, 0, 0, d.width - 1, d.height - 1)
  /** Change the selected pixels (or the whole layer) with `fn`, kept centred where they were. */
  const transform = (fn: (img: Img) => Img) => {
    if (layer.locked) return setNote('This layer is locked.')
    // This frame, or every frame of the layer (each linked cel once).
    const keys = allFrames ? [...new Set(d.frames.map((f) => resolveKey(d.cels, celKey(layer.id, f.id))))] : [curKey()]
    const out: Record<string, string | null> = {}
    let newMask: Mask | null = null
    for (const key of keys) {
      const img = cloneImg(celImg(d.cels[key], d.width, d.height))
      const c = cut(img, mask ?? all())
      if (!c) continue
      const piece = fn(c.piece)
      const pm = imgMask(fn(maskImg(c.mask, c.piece.width, c.piece.height)))
      const x = c.x + Math.floor((c.piece.width - piece.width) / 2)
      const y = c.y + Math.floor((c.piece.height - piece.height) / 2)
      paste(img, piece, x, y, pm)
      out[key] = encode(img)
      if (key === curKey()) newMask = placeMask(d.width, d.height, pm, piece.width, x, y)
    }
    update((x) => {
      const cels = { ...x.cels }
      for (const [k, v] of Object.entries(out)) {
        if (v) cels[k] = v
        else delete cels[k]
      }
      return { ...x, cels }
    })
    if (mask && newMask) setMask(newMask)
  }
  /** Every pixel of this frame (or every frame of the layer) through `fn`, inside the selection; one undo step. */
  const editPixels = (fn: (img: Img, m: Mask | null) => Img) => {
    if (layer.locked) return setNote('This layer is locked.')
    const keys = allFrames ? [...new Set(d.frames.map((f) => resolveKey(d.cels, celKey(layer.id, f.id))))] : [curKey()]
    const out: Record<string, string | null> = {}
    for (const key of keys) {
      if (!d.cels[key]) continue
      const next = encode(fn(celImg(d.cels[key], d.width, d.height), mask))
      if (next !== d.cels[key]) out[key] = next
    }
    if (!Object.keys(out).length) return setNote('Nothing changed.')
    update((x) => {
      const cels = { ...x.cels }
      for (const [k, v] of Object.entries(out)) {
        if (v) cels[k] = v
        else delete cels[k]
      }
      return { ...x, cels }
    })
  }
  const [adj, setAdj] = useState<Adjust>(NO_ADJUST)
  const [shadow, setShadow] = useState<[number, number]>([1, 1])
  const outlineSel = () => commit(curKey(), outline(celImg(d.cels[curKey()], d.width, d.height), hexToRgba(paintHex(colors[0])), mask, outlineOpts))
  /** Whole-sprite changes (every layer and frame); the selection goes, since it no longer fits. */
  const spriteOp = (fn: (x: PixelDoc) => PixelDoc) => update((x) => ({ ...fn(x), selection: undefined }))
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number; anchor: string } | null>(null)
  /** In palette-only mode every painted colour snaps to the palette; in gray mode it turns gray. */
  const paintHex = (hex: string) => (d.colorMode === 'indexed' ? nearest(d.palette, hex) : d.colorMode === 'gray' ? grayHex(hex) : hex)
  /** Every cel changed by `fn` (one undo step). */
  const mapCels = (fn: (img: Img) => Img, patch: Partial<PixelDoc> = {}) =>
    update((x) => {
      const cels: Record<string, string> = {}
      for (const [k, url] of Object.entries(x.cels)) {
        if (isLink(url)) {
          cels[k] = url
          continue
        }
        const next = encode(fn(celImg(url, x.width, x.height)))
        if (next) cels[k] = next
      }
      return { ...x, ...patch, cels }
    })
  const setMode = async (mode: PixelDoc['colorMode']) => {
    if (mode === 'indexed' && !(await confirmDialog({ title: 'Palette only?', message: 'Every pixel moves to its closest palette colour, and new colours snap to the palette. Undo brings the old colours back.', confirmLabel: 'Use the palette' }))) return
    if (mode === 'gray' && !(await confirmDialog({ title: 'Grays only?', message: 'Every pixel and palette colour turns gray. Undo brings the colours back.', confirmLabel: 'Make it gray' }))) return
    if (mode === 'indexed') mapCels((img) => reduce(img, d.palette), { colorMode: mode })
    else if (mode === 'gray') mapCels(grayscale, { colorMode: mode, palette: [...new Set(d.palette.map(grayHex))] })
    else update((x) => ({ ...x, colorMode: undefined }))
  }
  const clearSel = () => {
    if (!mask) return
    const img = cloneImg(celImg(d.cels[curKey()], d.width, d.height))
    cut(img, mask)
    commit(curKey(), img)
  }
  const copySel = (andCut: boolean) => {
    const img = cloneImg(celImg(d.cels[curKey()], d.width, d.height))
    const c = cut(img, mask ?? all())
    if (!c) return
    clipboard = c
    if (andCut) commit(curKey(), img)
  }
  const pasteSel = () => {
    if (!clipboard) return
    const img = cloneImg(celImg(d.cels[curKey()], d.width, d.height))
    // Same place when it fits, else the top left corner; Move is picked to drag it.
    const x = clipboard.x + clipboard.piece.width <= d.width ? clipboard.x : 0
    const y = clipboard.y + clipboard.piece.height <= d.height ? clipboard.y : 0
    paste(img, clipboard.piece, x, y, clipboard.mask)
    commit(curKey(), img)
    setMask(placeMask(d.width, d.height, clipboard.mask, clipboard.piece.width, x, y))
    setTool('move')
  }
  const nudge = (dx: number, dy: number) => {
    const rest = cloneImg(celImg(d.cels[curKey()], d.width, d.height))
    const c = cut(rest, mask ?? all())
    if (!c) return
    paste(rest, c.piece, c.x + dx, c.y + dy, c.mask)
    commit(curKey(), rest)
    if (mask) setMask(placeMask(d.width, d.height, c.mask, c.piece.width, c.x + dx, c.y + dy))
  }

  // ---- Files ----
  const base = safeFileName(title).replace(/\s+/g, '_').toLowerCase() || 'pixel_art'
  const savePng = (img: Img, name: string) =>
    void pngBytes(img, scale).then((bytes) => saveBinaryFile({ title: 'Export PNG', defaultName: name, bytes, filter: { name: 'PNG image', extensions: ['png'] } }))
  const sheet = (o: SheetOptions = sheetOpts) => {
    const l = sheetLayout(d, o)
    const img = blank(l.width, l.height)
    d.frames.forEach((_, i) => {
      const f = frameImg(i)
      const c = l.at[i]
      for (let y = 0; y < d.height; y++) img.data.set(f.data.subarray(y * d.width * 4, (y + 1) * d.width * 4), ((c.y + y) * img.width + c.x) * 4)
    })
    return img
  }
  const exportGif = async () => {
    const order = tagFrames(d.tags.find((t) => t.id === playTag) ?? null, d.frames.length, d.tags)
    const frames = order.map((i) => {
      const c = toCanvas(frameImg(i), scale)
      return { pixels: c.getContext('2d')!.getImageData(0, 0, c.width, c.height), delay: d.frames[i].duration }
    })
    await saveBinaryFile({ title: 'Export GIF', defaultName: `${base}.gif`, bytes: encodeGif(frames), filter: { name: 'GIF animation', extensions: ['gif'] } })
  }
  const writeTo = async (folderTitle: string, sub: string[], files: [string, Uint8Array][]) => {
    const fs = getFs()
    const folder = await fs.pickFolder(folderTitle)
    if (!folder) return null
    const dir = await fs.join(folder, ...sub)
    await fs.mkdir(dir)
    for (const [name, bytes] of files) await fs.writeBinaryAtomic(await fs.join(dir, name), bytes)
    return dir
  }
  const exportSheet = async () => {
    const json = JSON.stringify(sheetJson(d, `${base}.png`, sheetOpts), null, 2)
    if (await writeTo('Choose a folder for the sprite sheet', [], [[`${base}.png`, await pngBytes(sheet())], [`${base}.json`, new TextEncoder().encode(json)]])) setNote(`Saved ${base}.png and ${base}.json.`)
  }
  /** GameMaker reads a one-row strip named name_stripN.png as N frames. */
  const exportStrip = async () => {
    const name = `${base}_strip${d.frames.length}.png`
    if (await writeTo('Choose a folder for the GameMaker strip', [], [[name, await pngBytes(sheet({ layout: 'row', padding: 0 }))]])) setNote(`Saved ${name}: import it as a sprite in GameMaker and it splits into ${d.frames.length} frames.`)
  }
  const exportGodot = async () => {
    const tres = godotSpriteFrames(d, `res://egd/sprites/${base}.png`, sheetOpts)
    if (await writeTo('Choose your Godot project folder', ['egd', 'sprites'], [[`${base}.png`, await pngBytes(sheet())], [`${base}.tres`, new TextEncoder().encode(tres)]])) setNote(`Saved egd/sprites/${base}.tres in your Godot project: use it in an AnimatedSprite2D.`)
  }
  const mapImg = () => {
    if (!d.map) return blank(1, 1)
    const set = frameImg(0)
    const img = blank(d.map.width * ts, d.map.height * ts)
    for (const ml of d.map.layers) {
      if (!ml.visible) continue
      for (const [k, v] of Object.entries(ml.cells)) {
        const [mx, my] = k.split(',').map(Number)
        const { n, flags } = tileOf(v)
        for (let y = 0; y < ts; y++)
          for (let x = 0; x < ts; x++) {
            const [sx, sy] = tilePixel(flags, x, y, ts)
            const c = getPx(set, (n % cols) * ts + sx, Math.floor(n / cols) * ts + sy)
            if (c[3]) setPx(img, mx * ts + x, my * ts + y, c)
          }
      }
    }
    return img
  }
  /** The map as tile numbers: CSV (the picked map layer, -1 = empty) or JSON (every layer, with mirror and turn bits). */
  const exportMapData = async (kind: 'csv' | 'json') => {
    if (!d.map) return
    const grid = (cells: Record<string, number>) => Array.from({ length: d.map!.height }, (_, y) => Array.from({ length: d.map!.width }, (_, x) => cells[`${x},${y}`] ?? -1))
    const text =
      kind === 'csv'
        ? grid(mapLayer?.cells ?? {})
            .map((r) => r.map((v) => (v < 0 ? -1 : tileOf(v).n)).join(','))
            .join('\n') + '\n'
        : JSON.stringify({ width: d.map.width, height: d.map.height, tileSize: ts, tilesetColumns: cols, layers: d.map.layers.map((ml) => ({ name: ml.name, visible: ml.visible, tiles: grid(ml.cells).flat().map((v) => (v < 0 ? -1 : tileOf(v).n)), flags: grid(ml.cells).flat().map((v) => (v < 0 ? 0 : tileOf(v).flags)) })) }, null, 2)
    await saveBinaryFile({ title: `Export the map as ${kind.toUpperCase()}`, defaultName: `${base}_map.${kind}`, bytes: new TextEncoder().encode(text), filter: { name: kind.toUpperCase(), extensions: [kind] } })
  }
  const toStoryboard = async () => {
    if (!root) return
    const order = tagFrames(d.tags.find((t) => t.id === playTag) ?? null, d.frames.length, d.tags)
    const frames: { path: string; name: string; seconds: number }[] = []
    for (const i of order) {
      const asset = await importAssetFromBlob(root, new Blob([(await pngBytes(frameImg(i), Math.max(scale, 4))) as Uint8Array<ArrayBuffer>], { type: 'image/png' }), 'image', `${base}_${i + 1}.png`)
      if (asset) frames.push({ path: asset.path, name: `${title} ${i + 1}`, seconds: d.frames[i].duration / 1000 })
    }
    postIntent('storyboard', { action: 'add-frames', frames })
    openComponent('storyboard')
  }
  const importImage = async () => {
    const [f] = await pickFiles('Add a picture as a new layer', ['png', 'gif'])
    if (!f) return
    const src = await decode(f.bytes)
    const img = blank(d.width, d.height)
    for (let y = 0; y < Math.min(d.height, src.height); y++) for (let x = 0; x < Math.min(d.width, src.width); x++) setPx(img, x, y, getPx(src, x, y))
    const l = newPixelLayer(f.name.replace(/\.[^.]+$/, ''))
    const url = encode(img)
    update((x) => ({ ...x, layers: [...x.layers, l], cels: url ? { ...x.cels, [celKey(l.id, x.frames[fi].id)]: url } : x.cels }))
    setLayerId(l.id)
  }
  const importPalette = async () => {
    const [f] = await pickFiles('Open a palette', ['gpl', 'pal', 'hex', 'txt'])
    if (!f) return
    const colors = parsePalette(new TextDecoder().decode(f.bytes))
    if (!colors.length) return setNote('No colours found in that file.')
    openPalette(f.name.replace(/\.[^.]+$/, ''), colors)
  }
  /** Another palette over a drawing: ask whether to keep the drawn colours or swap them for new ones. */
  const [switching, setSwitching] = useState<{ name: string; colors: string[]; used: string[] } | null>(null)
  const openPalette = (name: string, colors: string[]) => {
    const used = usedColors(d).filter((c) => !colors.includes(c))
    if (!used.length) return update((x) => ({ ...x, palette: colors }))
    setSwitching({ name, colors, used })
  }
  /** Swap colours everywhere (pixels of every layer and frame, live shapes) in one undo step. */
  const swapAll = (map: Record<string, string>, palette: string[]) =>
    update((x) => {
      const from = Object.keys(map)
      const to = from.map((c) => map[c])
      const cels: Record<string, string> = {}
      for (const [k, url] of Object.entries(x.cels)) cels[k] = isLink(url) ? url : (encode(swapColors(celImg(url, x.width, x.height), from, to)) ?? url)
      const swap = (c?: string) => (c && map[c.toLowerCase()]) || c
      const shapes = x.shapes && Object.fromEntries(Object.entries(x.shapes).map(([k, c]) => [k, { ...c, list: c.list.map((sh) => ({ ...sh, fillColor: swap(sh.fillColor), strokeColor: swap(sh.strokeColor) })) }]))
      return { ...x, cels, ...(shapes ? { shapes } : {}), palette }
    })

  const tools = inMap ? MAP_TOOLS : TOOLS

  return (
    <div className="px">
      {pickingRef && (
        <ReferencePicker
          onPick={(image) => {
            setPickingRef(false)
            if (image) update((x) => ({ ...x, references: [...(x.references ?? []), { id: newId(), image, x: 24, y: 24 + (x.references?.length ?? 0) * 24, width: 220 }] }))
          }}
        />
      )}
      {switching && (
        <PaletteSwitch
          name={switching.name}
          used={switching.used}
          next={switching.colors}
          preview={frameImg(fi)}
          onClose={() => setSwitching(null)}
          onAdd={() => (update((x) => ({ ...x, palette: [...switching.colors, ...switching.used] })), setSwitching(null))}
          onReplace={(map) => (swapAll(map, switching.colors), setSwitching(null))}
        />
      )}
      <div className="px-toolbar" data-tour="px-tools">
        {/* No title banner here (the tab and the sidebar name the file): undo, redo and the history list sit first. */}
        <button className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!doc.canUndo} onClick={doc.undo}>
          <Undo2 size={16} />
        </button>
        <button className="icon-btn" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!doc.canRedo} onClick={doc.redo}>
          <Redo2 size={16} />
        </button>
        {doc.history && (
          <button className={`icon-btn${historyOpen ? ' on' : ''}`} title="Undo history: jump back several steps at once" aria-label="Undo history" onClick={() => setHistoryOpen(!historyOpen)}>
            <HistoryIcon size={16} />
          </button>
        )}
        <button className="icon-btn" title="Add a reference image (floats over the canvas, not part of the picture)" aria-label="Add a reference image" onClick={() => setPickingRef(true)}>
          <ImagePlus size={16} />
        </button>
        <span className="px-sep" />
        {tools.map((t) => (
          <button key={t.id} className={`icon-btn${tool === t.id ? ' on' : ''}`} title={t.label} aria-label={t.label} {...keyHint('key' in t && typeof t.key === 'string' ? keysOf(t.key)[0] : undefined)} onClick={() => setTool(t.id)}>
            <t.icon size={16} />
          </button>
        ))}
        {inMap && (
          <>
            <button className={`icon-btn${tileFlags & FLIP_H ? ' on' : ''}`} title="Place tiles mirrored left to right" onClick={() => setTileFlags(turnFlags(tileFlags, 'h'))}>
              <FlipHorizontal2 size={15} />
            </button>
            <button className={`icon-btn${tileFlags & FLIP_V ? ' on' : ''}`} title="Place tiles mirrored upside down" onClick={() => setTileFlags(turnFlags(tileFlags, 'v'))}>
              <FlipVertical2 size={15} />
            </button>
            <button className={`icon-btn${tileFlags & TRANSPOSE ? ' on' : ''}`} title="Turn placed tiles a quarter clockwise" onClick={() => setTileFlags(turnFlags(tileFlags, 'cw'))}>
              <RotateCw size={15} />
            </button>
            {tileFlags !== 0 && (
              <button className="btn btn-ghost" title="Place tiles as drawn" onClick={() => setTileFlags(0)}>
                Reset
              </button>
            )}
          </>
        )}
        <span className="px-sep" />
        {!inMap && (
          <>
            <label className="px-row" title="Pencil size">
              Size <input type="range" min={1} max={16} value={size} onChange={(e) => setSize(Number(e.target.value))} /> {size}
            </label>
            {brushImg && (
              <span className="px-row px-chip" title="The pencil stamps the brush made from a selection">
                Custom brush
                <label className="px-row" title="Stamp it in the main colour instead of its own colours">
                  <input type="checkbox" checked={brushImg.tint} onChange={(e) => setBrushImg({ ...brushImg, tint: e.target.checked })} /> one colour
                </label>
                <button className="icon-btn" title="Back to the normal pencil" onClick={() => setBrushImg(null)}>
                  ×
                </button>
              </span>
            )}
            {tool === 'text' && (
              <label className="px-row" title="Font and size in pixels; any font works, CJK included">
                <select className="input" value={font} onChange={(e) => setFont(e.target.value)}>
                  {[...GENERIC_FONTS, ...systemFonts()].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <input className="input px-ms" type="number" min={4} max={128} value={fontPx} onChange={(e) => setFontPx(Math.max(4, Math.min(128, Number(e.target.value) || 8)))} /> px
              </label>
            )}
            <label className="px-row" title="Pen pressure sets the pencil size, up to the size slider">
              <input type="checkbox" checked={pressure} onChange={(e) => setPressure(e.target.checked)} /> Pressure
            </label>
            <label className="px-row" title="Ink: how the colour goes down. Lock alpha paints only on pixels that are already there; Replace only on the colour you started on; Colour only keeps each pixel's see-through amount.">
              Ink
              <select className="input" value={ink} onChange={(e) => setInk(e.target.value as typeof ink)}>
                <option value="normal">Normal</option>
                <option value="lockAlpha">Lock alpha</option>
                <option value="replace">Replace colour</option>
                <option value="colorOnly">Colour only</option>
              </select>
            </label>
            <label className="px-row" title="Round pencil">
              <input type="checkbox" checked={round} onChange={(e) => setRound(e.target.checked)} /> Round
            </label>
            <label className="px-row" title="Clean lines: no doubled corner pixels in 1 px lines">
              <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} /> Clean lines
            </label>
            {(tool === 'rect' || tool === 'ellipse') && (
              <label className="px-row">
                <input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} /> Filled
              </label>
            )}
            {(tool === 'fill' || tool === 'wand') && (
              <>
              <label className="px-row" title="Tolerance: how different a colour may be and still count (0 = exactly the same colour)">
                Tolerance <input type="range" min={0} max={128} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} /> {tolerance}
              </label>
                <select className="input" value={sample} title="What the fill and the magic wand look at" onChange={(e) => setSample(e.target.value as typeof sample)}>
                  <option value="layer">This layer</option>
                  <option value="all">All layers</option>
                  <option value="reference">Reference layer</option>
                </select>
              </>
            )}
            {(tool === 'fill' || tool === 'wand') && (
              <label className="px-row" title="Off: every pixel of that colour, also unconnected ones">
                <input type="checkbox" checked={contiguous} onChange={(e) => setContiguous(e.target.checked)} /> Connected only
              </label>
            )}
            <label className="px-row" title="Dithering: paint only part of the pixels in a checker pattern (16 = all)">
              Dither <input type="range" min={0} max={16} value={dither} onChange={(e) => setDither(Number(e.target.value))} />
            </label>
            <button className={`icon-btn${sym.x ? ' on' : ''}`} title="Mirror left and right" onClick={() => setSym({ ...sym, x: !sym.x })}>
              <FlipHorizontal2 size={15} />
            </button>
            <button className={`icon-btn${sym.y ? ' on' : ''}`} title="Mirror top and bottom" onClick={() => setSym({ ...sym, y: !sym.y })}>
              <FlipVertical2 size={15} />
            </button>
            <label className="px-row" title="Seamless preview: the picture repeats around itself and drawing wraps over the edges">
              <input type="checkbox" checked={seamless} onChange={(e) => setSeamless(e.target.checked)} /> Seamless
            </label>
            {d.kind === 'sprite' && (
              <label className="px-row" title="Onion skin: see the frames before and after">
                <input type="checkbox" checked={onion} onChange={(e) => setOnion(e.target.checked)} /> Onion skin
              </label>
            )}
            {d.kind === 'sprite' && onion && (
              <label className="px-row" title="How many frames before and after; tinted: earlier frames red, later ones blue">
                <select className="input" value={onionCount} onChange={(e) => setOnionCount(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <input type="checkbox" checked={onionTint} onChange={(e) => setOnionTint(e.target.checked)} /> tint
              </label>
            )}
            {(d.kind === 'sprite' || !inMap) && (
              <label className="px-row" title={d.kind === 'tileset' ? 'Play the tiles as an animation: one frame per tile, in order' : 'Preview window: the animation loops next to the palette while you draw'}>
                <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Preview
              </label>
            )}
          </>
        )}
        <button className={`icon-btn${showGrid ? ' on' : ''}`} title="Grid" onClick={() => setShowGrid(!showGrid)}>
          <Grid3x3 size={15} />
        </button>
        <label className="px-row" title="Pixel shape: wide or tall pixels like some old consoles (on screen only)">
          Pixels
          <select className="input" value={d.pixelAspect ?? 1} onChange={(e) => update((x) => ({ ...x, pixelAspect: Number(e.target.value) === 1 ? undefined : Number(e.target.value) }))}>
            <option value={1}>Square</option>
            <option value={2}>Wide 2:1</option>
            <option value={0.5}>Tall 1:2</option>
          </select>
        </label>
        <label className="px-row" title="Zoom (whole steps keep pixels square)">
          Zoom <input type="range" min={1} max={64} value={zoom} onChange={(e) => zoomAt(Number(e.target.value))} /> {zoom}×
          <button className="icon-btn" title="Zoom to fit" aria-label="Zoom to fit" onClick={zoomToFit}>
            <Maximize size={14} />
          </button>
        </label>
        {d.kind === 'tileset' && (
          <button className={`btn${inMap ? ' btn-primary' : ''}`} title="Switch between drawing the tiles and painting a map with them (Tab)" onClick={() => setMapMode(!mapMode)}>
            <MapIcon size={14} /> {inMap ? 'Map' : 'Tiles'}
          </button>
        )}
        <span className="px-menu" data-tour="px-files">
          <button className="btn btn-ghost" onClick={() => setMenu(!menu)}>
            <Download size={14} /> Files
          </button>
          {menu && (
            <div className="px-menu-list" onClick={() => setMenu(false)}>
              <label className="px-row" onClick={(e) => e.stopPropagation()}>
                Scale
                <select className="input" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
                  {[1, 2, 3, 4, 6, 8, 10].map((s) => (
                    <option key={s} value={s}>
                      {s}×
                    </option>
                  ))}
                </select>
              </label>
              {d.kind === 'sprite' ? (
                <>
                  <button onClick={() => savePng(frameImg(fi), `${base}.png`)}>PNG of this frame</button>
                  <button onClick={() => void exportGif()}>GIF animation{playTag ? ' (the picked tag)' : ''}</button>
                  <label className="px-row" onClick={(e) => e.stopPropagation()} title="How frames sit on the sprite sheet (also for Godot)">
                    Sheet
                    <select className="input" value={sheetOpts.layout} onChange={(e) => setSheetOpts({ ...sheetOpts, layout: e.target.value as SheetOptions['layout'] })}>
                      <option value="grid">Grid</option>
                      <option value="row">One row</option>
                      <option value="tags">A row per tag</option>
                    </select>
                    gap
                    <input className="input px-ms" type="number" min={0} max={16} value={sheetOpts.padding} onChange={(e) => setSheetOpts({ ...sheetOpts, padding: Math.max(0, Math.min(16, Number(e.target.value) || 0)) })} /> px
                  </label>
                  <button onClick={() => void exportSheet()}>Sprite sheet + JSON</button>
                  <button onClick={() => void exportGodot()}>Godot SpriteFrames</button>
                  <button title="One row of frames named name_stripN.png, which GameMaker splits by itself" onClick={() => void exportStrip()}>
                    GameMaker strip
                  </button>
                  <button title="Every frame (or the picked tag) as Storyboard frames, with their timing" onClick={() => void toStoryboard()}>
                    Send the animation to Storyboard
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => savePng(frameImg(0), `${base}_tiles.png`)}>Tileset PNG</button>
                  <button onClick={() => savePng(mapImg(), `${base}_map.png`)}>Map PNG</button>
                  <button title="Each tile with a copy of its edge pixels around it, against seams in game engines (there: margin 1, spacing 2)" onClick={() => savePng(extrude(frameImg(0), ts), `${base}_tiles_extruded.png`)}>
                    Tileset PNG, edges extruded
                  </button>
                  <button onClick={() => void exportMapData('csv')}>Map as CSV</button>
                  <button onClick={() => void exportMapData('json')}>Map as JSON</button>
                  <button onClick={() => void pushTileset(true).then((id) => id && setNote('This tileset is in Level Layout now and stays up to date.'))}>Use in Level Layout</button>
                  <button onClick={() => void sendMap()}>Send the map to Level Layout</button>
                </>
              )}
              <button onClick={() => void importImage()}>Add a picture as a layer</button>
              <button title="The palette as colour swatches on the Design Language board" onClick={() => void pngBytes(paletteStrip(d.palette), 1).then((b) => sendImageTo('design-language', new Blob([b as Uint8Array<ArrayBuffer>], { type: 'image/png' }), `${title} palette`))}>
                Send the palette to Design Language
              </button>
              {IMAGE_TARGETS.filter((t) => t.type !== 'pixel-art').map((t) => (
                <button key={t.type} onClick={() => void pngBytes(inMap ? mapImg() : frameImg(fi), scale).then((b) => sendImageTo(t.type, new Blob([b as Uint8Array<ArrayBuffer>], { type: 'image/png' }), title))}>
                  Send {inMap ? 'the map' : 'this frame'} to {t.label}
                </button>
              ))}
            </div>
          )}
        </span>
        {d.libraryId && <span className="muted px-linked">In Level Layout</span>}
      </div>
      {note && (
        <div className="px-note" role="status" onClick={() => setNote(null)}>
          {note}
        </div>
      )}
      <div className="px-body">
        <aside className="px-side" data-tour="px-palette">
          {historyOpen && doc.history && <HistoryList past={doc.history.past} future={doc.history.future} current={d} undo={doc.undo} redo={doc.redo} />}
          {inMap && d.map ? (
            <TilePicker set={frameImg(0)} ts={ts} stamp={stamp} onStamp={(s) => (setStamp(s), tool !== 'tile' && tool !== 'tileFill' ? setTool('tile') : null)} />
          ) : (
            <PalettePanel
              d={d}
              colors={colors}
              setColors={setColors}
              recolor={recolor}
              update={update}
              onImport={() => void importPalette()}
              onExport={() => void saveBinaryFile({ title: 'Save palette', defaultName: `${base}.gpl`, bytes: new TextEncoder().encode(paletteToGpl(title, d.palette)), filter: { name: 'GIMP palette', extensions: ['gpl'] } })}
            />
          )}
          {!inMap && (
            <ColorsPanel
              d={d}
              update={update}
              setMode={(m) => void setMode(m)}
              fromPicture={() => update((x) => ({ ...x, palette: paletteOf(frameImg(fi)) }))}
              reduceAll={(dither) => mapCels((img) => reduce(img, d.palette, dither))}
              variant={variant}
              setVariant={setVariant}
              openPalette={openPalette}
              main={colors[0]}
            />
          )}
          {d.kind === 'tileset' && !inMap && focusTile !== null && <TileRepeat tile={tilePixels(frameImg(0), focusTile, cols, ts)} n={focusTile} />}
          {preview && d.kind === 'sprite' && !inMap && (
            <Preview d={d} frameImg={frameImg} playTag={playTag} />
          )}
          {preview && d.kind === 'tileset' && !inMap && <TilePlayer set={frameImg(0)} cols={cols} count={cols * tileRows(d)} ts={ts} />}
        </aside>
        <div className="px-stage" data-tour="px-canvas" ref={stage} style={tool === 'hand' ? { cursor: 'grab' } : undefined}>
            <canvas
              ref={screen}
              className="px-screen"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={() => ((hover.current = null), drawOverlay())}
              onContextMenu={(e) => e.preventDefault()}
            />
            <canvas ref={overlay} className="px-overlay" />
            {(d.references ?? []).map((r) => (
              <ReferenceWindow
                key={r.id}
                image={r.image}
                x={r.x}
                y={r.y}
                width={r.width}
                onChange={(patch) => update((x) => ({ ...x, references: (x.references ?? []).map((y) => (y.id === r.id ? { ...y, ...patch } : y)) }))}
                onClose={() => update((x) => ({ ...x, references: (x.references ?? []).filter((y) => y.id !== r.id) }))}
              />
            ))}
        </div>
        <aside className="px-side right" data-tour="px-layers">
          {inMap && d.map ? (
            <MapPanel d={d} mapLayerId={mapLayer?.id ?? ''} setMapLayerId={setMapLayerId} update={update} />
          ) : (
            <>
              <PopOut id="layers" title="Layers">
              <LayersPanel
                d={d}
                allTiles={
                  d.kind === 'tileset'
                    ? async (id, on) => {
                        const k0 = resolveKey(d.cels, celKey(id, d.frames[0].id))
                        const img = d.cels[k0] ? celImg(d.cels[k0], d.width, d.height) : null
                        if (on && img && !sameImg(everyTile(img, focusTile ?? 0, ts), img) && !(await confirmDialog({ title: 'Show this layer on all tiles?', message: `Tile ${focusTile ?? 0} of this layer is copied onto every other tile, replacing what is there. Undo brings it back.`, confirmLabel: 'Copy to all tiles' }))) return
                        update((x) => {
                          const layers = x.layers.map((l) => (l.id === id ? { ...l, allTiles: on || undefined } : l))
                          // Turning it on copies the tile being worked on (the top-left one if none) onto every tile.
                          const k = resolveKey(x.cels, celKey(id, x.frames[0].id))
                          const url = on && x.cels[k] ? encode(everyTile(celImg(x.cels[k], x.width, x.height), focusTile ?? 0, ts)) : undefined
                          return { ...x, layers, ...(url ? { cels: { ...x.cels, [k]: url } } : {}) }
                        })
                      }
                    : undefined
                }
                layerImg={(id) => imgOf(id, d.frames[inMap ? 0 : fi].id)}
                layerId={layer.id} frameId={d.frames[fi]?.id ?? ''} setLayerId={setLayerId} update={update} />
              </PopOut>
              {layer.vector && <ShapePanel d={d} layerId={layer.id} frameKey={shapeKey} tool={shapes} update={update} main={paintHex(colors[0])} />}
              {!layer.vector && <div className="px-panel">
                <strong>{mask ? 'Selection' : 'Whole layer'}</strong>
                <div className="px-row px-wrap">
                  <button className="icon-btn" title="Flip left to right" onClick={() => transform((i) => flipImg(i, 'x'))}>
                    <FlipHorizontal2 size={14} />
                  </button>
                  <button className="icon-btn" title="Flip upside down" onClick={() => transform((i) => flipImg(i, 'y'))}>
                    <FlipVertical2 size={14} />
                  </button>
                  <button className="icon-btn" title="Turn a quarter clockwise" onClick={() => transform((i) => rotate90(i, true))}>
                    <RotateCw size={14} />
                  </button>
                  <button className="icon-btn" title="Turn a quarter anticlockwise" onClick={() => transform((i) => rotate90(i, false))}>
                    <RotateCcw size={14} />
                  </button>
                  <label className="px-row" title="Pixel rotate by any angle, without blur or new colours">
                    <input className="input px-ms" type="number" min={-359} max={359} value={angle} onChange={(e) => setAngle(Number(e.target.value) || 0)} />°
                    <button className="btn btn-ghost" onClick={() => transform((i) => rotateAny(i, angle))}>
                      Rotate
                    </button>
                  </label>
                  <label className="px-row" title="Scale with hard pixels">
                    <input className="input px-ms" type="number" min={10} max={1000} value={scalePct} onChange={(e) => setScalePct(Number(e.target.value) || 100)} />%
                    <button className="btn btn-ghost" onClick={() => transform((i) => scaleImg(i, Math.round((i.width * scalePct) / 100), Math.round((i.height * scalePct) / 100)))}>
                      Scale
                    </button>
                  </label>
                  {d.kind === 'sprite' && d.frames.length > 1 && (
                    <label className="px-row" title="Flip, turn, rotate and scale every frame of this layer at once">
                      <input type="checkbox" checked={allFrames} onChange={(e) => setAllFrames(e.target.checked)} /> All frames
                    </label>
                  )}
                  <button className="btn btn-ghost" title="A one-pixel line in the main colour around the drawing" onClick={outlineSel}>
                    Outline
                  </button>
                  <label className="px-row" title="Outline on the drawing's own edge pixels instead of around it">
                    <input type="checkbox" checked={outlineOpts.inside} onChange={(e) => setOutlineOpts({ ...outlineOpts, inside: e.target.checked })} /> inside
                  </label>
                  <label className="px-row" title="Also fill the diagonal corners (rounder, thicker)">
                    <input type="checkbox" checked={outlineOpts.corners} onChange={(e) => setOutlineOpts({ ...outlineOpts, corners: e.target.checked })} /> corners
                  </label>
                  <button className="btn btn-ghost" title="Shift by half with wrap-around, to check that a tile repeats without seams" onClick={() => commit(curKey(), wrapShift(celImg(d.cels[curKey()], d.width, d.height), Math.floor(d.width / 2), Math.floor(d.height / 2)))}>
                    Wrap shift
                  </button>
                </div>
                {mask && (
                  <button
                    className="btn btn-ghost"
                    title="Paint with these pixels: the pencil stamps them along the stroke"
                    onClick={() => {
                      const c = cut(cloneImg(celImg(d.cels[curKey()], d.width, d.height)), mask, true)
                      if (c) setBrushImg({ piece: c.piece, mask: c.mask, tint: false })
                      setTool('pencil')
                    }}
                  >
                    <Stamp size={13} /> Use as brush
                  </button>
                )}
                {mask && <SelectionInfo mask={mask} width={d.width} />}
                <details className="px-adjust">
                  <summary>Adjust colours</summary>
                  {(
                    [
                      ['hue', 'Hue', -180, 180],
                      ['saturation', 'Saturation', -100, 100],
                      ['lightness', 'Lightness', -100, 100],
                      ['brightness', 'Brightness', -100, 100],
                      ['contrast', 'Contrast', -100, 100],
                    ] as const
                  ).map(([k, label, min, max]) => (
                    <label key={k} className="px-row px-mix" title={label}>
                      <span className="px-adjust-name">{label}</span>
                      <input type="range" min={min} max={max} value={adj[k]} onChange={(e) => setAdj({ ...adj, [k]: Number(e.target.value) })} /> {adj[k]}
                    </label>
                  ))}
                  <div className="px-row px-wrap">
                    <label className="px-row">
                      <input type="checkbox" checked={adj.invert} onChange={(e) => setAdj({ ...adj, invert: e.target.checked })} /> Invert
                    </label>
                    <button className="btn" title={mask ? 'Change the selected pixels' : 'Change the whole layer'} onClick={() => editPixels((img, m) => adjustImg(img, adj, m))}>
                      Apply
                    </button>
                    <button className="btn btn-ghost" onClick={() => setAdj(NO_ADJUST)}>
                      Reset
                    </button>
                  </div>
                </details>
                <details className="px-adjust">
                  <summary>Effects</summary>
                  <div className="px-row px-wrap">
                    <button className="btn btn-ghost" title="A copy of the drawing in the second colour, behind it and moved by the offset" onClick={() => editPixels((img, m) => dropShadow(img, shadow[0], shadow[1], hexToRgba(paintHex(colors[1])), m))}>
                      Drop shadow
                    </button>
                    <input className="input px-ms" type="number" min={-16} max={16} value={shadow[0]} aria-label="Shadow right" title="Right (minus: left)" onChange={(e) => setShadow([Number(e.target.value) || 0, shadow[1]])} />
                    <input className="input px-ms" type="number" min={-16} max={16} value={shadow[1]} aria-label="Shadow down" title="Down (minus: up)" onChange={(e) => setShadow([shadow[0], Number(e.target.value) || 0])} />
                  </div>
                  <button className="btn btn-ghost" title="Clear lone pixels that touch no other pixel" onClick={() => editPixels(despeckle)}>
                    Remove stray pixels
                  </button>
                </details>
                <div className="px-row px-wrap" title="Change the selection itself">
                  <button className="btn btn-ghost" onClick={() => setMask(all())}>
                    All
                  </button>
                  {mask && (
                    <>
                      <button className="btn btn-ghost" title="Grow the selection by 1 pixel" onClick={() => setMask(growMask(mask, d.width, d.height, 1))}>
                        Grow
                      </button>
                      <button className="btn btn-ghost" title="Shrink the selection by 1 pixel" onClick={() => setMask(growMask(mask, d.width, d.height, -1))}>
                        Shrink
                      </button>
                      <button className="btn btn-ghost" title="Keep only the edge of the selection" onClick={() => setMask(borderMask(mask, d.width, d.height))}>
                        Border
                      </button>
                      <button className="btn btn-ghost" title="Select everything that was not selected" onClick={() => setMask(invertMask(mask))}>
                        Invert
                      </button>
                      <button className="btn btn-ghost" title="Deselect (Ctrl+D)" onClick={() => setMask(null)}>
                        None
                      </button>
                    </>
                  )}
                </div>
              </div>}
              {d.kind === 'sprite' && (
                <div className="px-panel">
                  <strong>Whole sprite</strong>
                  <div className="px-row px-wrap">
                    <button className="icon-btn" title="Flip every layer and frame left to right" onClick={() => spriteOp((x) => flipSprite(x, 'x'))}>
                      <FlipHorizontal2 size={14} />
                    </button>
                    <button className="icon-btn" title="Flip every layer and frame upside down" onClick={() => spriteOp((x) => flipSprite(x, 'y'))}>
                      <FlipVertical2 size={14} />
                    </button>
                    <button className="icon-btn" title="Turn every layer and frame a quarter clockwise" onClick={() => spriteOp((x) => turnSprite(x, true))}>
                      <RotateCw size={14} />
                    </button>
                    <button className="icon-btn" title="Turn every layer and frame a quarter anticlockwise" onClick={() => spriteOp((x) => turnSprite(x, false))}>
                      <RotateCcw size={14} />
                    </button>
                    <button className="btn btn-ghost" title="Cut off the empty edges around every layer and frame" onClick={() => {
                      const b = contentBounds(d)
                      if (!b) return setNote('Nothing to trim: the sprite is empty.')
                      spriteOp((x) => crop(x, b.x, b.y, b.w, b.h))
                    }}>
                      Trim
                    </button>
                    {mask && (
                      <button className="btn btn-ghost" title="Make the canvas the size of the selection" onClick={() => {
                        const b = bounds(mask, d.width)
                        if (b) spriteOp((x) => crop(x, b.x, b.y, b.w, b.h))
                      }}>
                        Crop to selection
                      </button>
                    )}
                    <button className="btn btn-ghost" title="Make the canvas bigger or smaller" onClick={() => setCanvasSize(canvasSize ? null : { w: d.width, h: d.height, anchor: 'mm' })}>
                      Canvas size…
                    </button>
                  </div>
                  {canvasSize && (
                    <div className="px-row px-wrap">
                      <input className="input px-ms" type="number" min={1} max={2048} value={canvasSize.w} aria-label="Width" onChange={(e) => setCanvasSize({ ...canvasSize, w: Math.max(1, Math.min(2048, Number(e.target.value) || 1)) })} /> ×
                      <input className="input px-ms" type="number" min={1} max={2048} value={canvasSize.h} aria-label="Height" onChange={(e) => setCanvasSize({ ...canvasSize, h: Math.max(1, Math.min(2048, Number(e.target.value) || 1)) })} />
                      <select className="input" value={canvasSize.anchor} title="Where the picture sits on the new canvas" onChange={(e) => setCanvasSize({ ...canvasSize, anchor: e.target.value })}>
                        {Object.entries(ANCHORS).map(([k, a]) => (
                          <option key={k} value={k}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                      <button className="btn" onClick={() => {
                        const a = ANCHORS[canvasSize.anchor]
                        spriteOp((x) => resizeCanvas(x, canvasSize.w, canvasSize.h, a.x, a.y))
                        setCanvasSize(null)
                      }}>
                        Apply
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
      {d.kind === 'sprite' && (
        <Timeline d={d} frame={fi} setFrame={setFrame} frameImg={frameImg} update={update} playing={playing} togglePlay={() => setPlaying(!playing)} playTag={playTag} setPlayTag={setPlayTag} />
      )}
    </div>
  )
}

/** Shift with a line: flat, 45° or two-to-one steps, the angles that look clean in pixel art. */
function constrain(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  let best = b
  let err = Infinity
  for (const [rx, ry] of [[1, 0], [2, 1], [1, 1], [1, 2], [0, 1]]) {
    const k = Math.round((Math.abs(dx) * rx + Math.abs(dy) * ry) / (rx * rx + ry * ry))
    const p: Pt = [a[0] + Math.sign(dx) * rx * k, a[1] + Math.sign(dy) * ry * k]
    const e = (p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2
    if (e < err) {
      err = e
      best = p
    }
  }
  return best
}

/** Shift with a rectangle or ellipse: a square or circle. */
function square(a: Pt, b: Pt): Pt {
  const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
  return [a[0] + Math.sign(b[0] - a[0] || 1) * n, a[1] + Math.sign(b[1] - a[1] || 1) * n]
}

/** The tileset picture with its grid in map mode: click a tile, or drag over several for a stamp. */
function TilePicker({ set, ts, stamp, onStamp }: { set: Img; ts: number; stamp: { col: number; row: number; w: number; h: number }; onStamp(s: { col: number; row: number; w: number; h: number }): void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const zoom = Math.max(1, Math.floor(200 / set.width))
  const [from, setFrom] = useState<Pt | null>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = set.width * zoom * dpr
    c.height = set.height * zoom * dpr
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.drawImage(toCanvas(set), 0, 0, c.width, c.height)
    const s = zoom * dpr
    g.strokeStyle = 'rgba(77,171,247,0.5)'
    for (let x = 0; x <= set.width; x += ts) g.strokeRect(x * s, 0, 0, c.height)
    for (let y = 0; y <= set.height; y += ts) g.strokeRect(0, y * s, c.width, 0)
    g.lineWidth = 2
    g.strokeStyle = '#4dabf7'
    g.strokeRect(stamp.col * ts * s, stamp.row * ts * s, stamp.w * ts * s, stamp.h * ts * s)
  }, [set, zoom, ts, stamp])
  const at = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect()
    return [Math.max(0, Math.min(Math.floor(set.width / ts) - 1, Math.floor(((e.clientX - r.left) / r.width) * (set.width / ts)))), Math.max(0, Math.min(Math.floor(set.height / ts) - 1, Math.floor(((e.clientY - r.top) / r.height) * (set.height / ts))))]
  }
  const pickRange = (a: Pt, b: Pt) => onStamp({ col: Math.min(a[0], b[0]), row: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1 })
  return (
    <div className="px-panel">
      <strong>Tiles</strong>
      <p className="muted px-small">Click a tile, or drag over several to place them together. Switch to Tiles to draw them.</p>
      <canvas
        ref={ref}
        className="px-tiles"
        style={{ width: set.width * zoom, height: set.height * zoom }}
        onPointerDown={(e) => {
          const p = at(e)
          e.currentTarget.setPointerCapture(e.pointerId)
          setFrom(p)
          pickRange(p, p)
        }}
        onPointerMove={(e) => from && pickRange(from, at(e))}
        onPointerUp={() => setFrom(null)}
      />
    </div>
  )
}

/** Map size and map layers. */
function MapPanel({ d, mapLayerId, setMapLayerId, update }: { d: PixelDoc; mapLayerId: string; setMapLayerId(id: string): void; update: (fn: (d: PixelDoc) => PixelDoc) => void }) {
  const map = d.map!
  const setMap = (patch: Partial<NonNullable<PixelDoc['map']>>) => update((x) => ({ ...x, map: { ...x.map!, ...patch } }))
  return (
    <div className="px-panel">
      <strong className="px-head">
        Map layers
        <button
          className="icon-btn"
          title="New map layer"
          onClick={() => {
            const l = { id: newId(), name: `Layer ${map.layers.length + 1}`, visible: true, cells: {} }
            setMap({ layers: [...map.layers, l] })
            setMapLayerId(l.id)
          }}
        >
          +
        </button>
      </strong>
      {[...map.layers].reverse().map((l) => (
        <div key={l.id} className={`px-layer${l.id === mapLayerId ? ' on' : ''}`} onClick={() => setMapLayerId(l.id)}>
          <input type="checkbox" checked={l.visible} title="Show" onClick={(e) => e.stopPropagation()} onChange={(e) => setMap({ layers: map.layers.map((x) => (x.id === l.id ? { ...x, visible: e.target.checked } : x)) })} />
          <input className="px-name" value={l.name} aria-label="Map layer name" onChange={(e) => setMap({ layers: map.layers.map((x) => (x.id === l.id ? { ...x, name: e.target.value } : x)) })} />
          <button className="icon-btn" title="Delete map layer" disabled={map.layers.length < 2} onClick={(e) => (e.stopPropagation(), setMap({ layers: map.layers.filter((x) => x.id !== l.id) }))}>
            ×
          </button>
        </div>
      ))}
      <label className="ld-inline" title="Map size in tiles">
        Size
        <NumberInput value={map.width} min={1} max={256} onChange={(v) => setMap({ width: Math.max(1, Math.min(256, Math.round(v))) })} />×
        <NumberInput value={map.height} min={1} max={256} onChange={(v) => setMap({ height: Math.max(1, Math.min(256, Math.round(v))) })} />
      </label>
      <p className="muted px-small">Draw pixels on the map with the pencil: the tile changes everywhere it is used. Files → Send the map to Level Layout turns it into a level with Godot export.</p>
    </div>
  )
}

function SelectionInfo({ mask, width }: { mask: Mask; width: number }) {
  const b = bounds(mask, width)
  return b ? <p className="muted px-small">{`${b.w} × ${b.h} px at ${b.x}, ${b.y}. Ctrl+C copies, Ctrl+X cuts, Ctrl+V pastes, Delete clears, Esc lets go.`}</p> : null
}

function edge(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  g.moveTo(x0, y0)
  g.lineTo(x1, y1)
}

/** A map cell: the tile number and its mirror/turn bits (stored above bit 16). */
const tileOf = (v: number) => ({ n: v & 0xffff, flags: v >> 16 })

/** Pen pressure, or full for a mouse. */
const penPressure = (e: React.PointerEvent) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 1)

/** The pixels along a curve from a to b, bent towards c. */
function bezier(a: Pt, c: Pt, b: Pt): Pt[] {
  const n = Math.max(2, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(b[0] - c[0], b[1] - c[1])))
  const out: Pt[] = []
  let prev: Pt | null = null
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const p: Pt = [Math.round((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0]), Math.round((1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1])]
    if (prev) out.push(...line(prev[0], prev[1], p[0], p[1]).slice(1))
    else out.push(p)
    prev = p
  }
  return out
}

/** A tile repeated 3 × 3, so its edges show whether it tiles without seams. */
function TileRepeat({ tile, n }: { tile: Img; n: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = tile.width * 3
    c.height = tile.height * 3
    const g = c.getContext('2d')!
    const t = toCanvas(tile)
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g.drawImage(t, x * tile.width, y * tile.height)
  })
  const k = Math.max(1, Math.floor(180 / (tile.width * 3)))
  return (
    <div className="px-panel">
      <strong>Tile {n} repeated</strong>
      <canvas ref={ref} className="px-preview" style={{ width: tile.width * 3 * k, height: tile.height * 3 * k }} />
    </div>
  )
}

/** A frame in one flat colour, for a tinted onion skin. */
function tinted(img: Img, color: string): HTMLCanvasElement {
  const c = toCanvas(img)
  const g = c.getContext('2d')!
  g.globalCompositeOperation = 'source-atop'
  g.fillStyle = color
  g.fillRect(0, 0, c.width, c.height)
  return c
}

/** The palette as a strip of 32 px swatches, 8 to a row. */
function paletteStrip(palette: string[]): Img {
  const n = Math.max(1, palette.length)
  const cols = Math.min(8, n)
  const img = blank(cols * 32, Math.ceil(n / cols) * 32)
  palette.forEach((c, i) => {
    const rgba = hexToRgba(c)
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) setPx(img, (i % cols) * 32 + x, Math.floor(i / cols) * 32 + y, rgba)
  })
  return img
}

/** Text as pixels: drawn with the font at its pixel size; the caller keeps only the solid pixels. */
function textImg(text: string, family: string, px: number): Img {
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  const fontCss = `${px}px ${cssFamily(family)}`
  g.font = fontCss
  c.width = Math.max(1, Math.ceil(g.measureText(text).width))
  c.height = Math.ceil(px * 1.3)
  g.font = fontCss
  g.textBaseline = 'top'
  g.fillText(text, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height)
  return { width: d.width, height: d.height, data: d.data }
}
