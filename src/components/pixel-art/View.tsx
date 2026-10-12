import { Brush, Circle, Download, Eraser, FlipHorizontal2, FlipVertical2, Grid3x3, Lasso, Layers, Map as MapIcon, Move, PaintBucket, Pipette, RotateCcw, RotateCw, Slash, Square, SquareDashed, SunMoon, Upload, WandSparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { importAssetFromBlob, resolveAssetPath } from '@/core/assets'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { getFs } from '@/core/fs'
import { newId } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { isShortcut } from '@/core/shortcuts'
import { loadDocumentNow, updateDocument, useDocument, useIntentHandler, useProjectStore, isTextField, useUndoRedoKeys, type UseDocumentResult } from '@/core/state'
import { NumberInput, PresetHeader } from '@/shared/calculators'
import { confirmDialog } from '@/shared/dialogs'
import { pickFiles } from '@/shared/sketch/files/io'
import { encodeGif } from '@/shared/sketch/files/gif'
import { createLibrary, drawTile, FLIP_H, FLIP_V, LIBRARY_ID, tilePixel, tileRect, TRANSPOSE, turnFlags, type TileLibrary } from '@/shared/tileset'
import { IMAGE_TARGETS, openComponent, sendImageTo } from '@/shell/editor/actions'
import { readAse } from './ase'
import { celImg, decode, encode, pngBytes, toCanvas, useDecoded } from '@/shared/pixel/codec'
import { godotSpriteFrames, sheetCell, sheetColumns, sheetJson } from './exports'
import {
  blank,
  brushOffsets,
  celKey,
  cleanPath,
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
  rgbaToHex,
  setPx,
  shadeStep,
  sliceSheet,
  startDoc,
  tagFrames,
  tileColumns,
  tileRows,
  type Img,
  type PixelDoc,
} from '@/shared/pixel/model'
import { ColorsPanel, LayersPanel, PalettePanel, Preview, Timeline } from './Panels'
import { grayHex, grayscale, nearest, paletteOf, reduce, swapColors } from '@/shared/pixel/color'
import { bounds, combine, cut, flipImg, imgMask, lassoMask, maskImg, outline, paste, placeMask, rectMask, rotate90, wandMask, wrapShift, type Combine, type Mask } from './selection'
import './pixel-art.css'

type Tool = 'pencil' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill' | 'picker' | 'shade' | 'select' | 'lasso' | 'wand' | 'move' | 'tile' | 'tileErase' | 'tileFill'
type Pt = [number, number]

/** Pixel Art (v0.16): sprites, animations, tilesets and tilemaps. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<PixelDoc>('pixel-art', documentId!, createPixelDoc)
  const title = useProjectStore((s) => s.meta?.documents.find((x) => x.id === documentId)?.title ?? 'Pixel art')
  const root = useProjectStore((s) => s.root)

  // From Level Layout: "Edit in Pixel Art" opens a library tileset as a new tileset file.
  useIntentHandler('pixel-art', (intent) => {
    if (intent.action !== 'edit-tileset' || typeof intent.id !== 'string' || !root) return
    void editTileset(root, intent.id)
  })

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
    const [f] = await pickFiles('Open pixel art', ['ase', 'aseprite', 'png', 'gif'])
    if (!f) return
    try {
      if (/\.(ase|aseprite)$/i.test(f.name)) return onStart(fromAse(readAse(f.bytes)))
      const img = await decode(f.bytes)
      const layer = newPixelLayer('Layer 1')
      const frame = newFrame()
      const url = encode(img)
      const patch: Partial<PixelDoc> = { ...startDoc(kind, img.width, img.height, tile), layers: [layer], frames: [frame], cels: url ? { [celKey(layer.id, frame.id)]: url } : {} }
      onStart(patch)
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
        <Upload size={14} /> Open a file (.ase, .aseprite, PNG)
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
  { id: 'line', icon: Slash, label: 'Line (Shift keeps clean angles)', key: 'pixel.line' },
  { id: 'rect', icon: Square, label: 'Rectangle', key: 'pixel.rect' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'pixel.ellipse' },
  { id: 'fill', icon: PaintBucket, label: 'Fill', key: 'pixel.fill' },
  { id: 'picker', icon: Pipette, label: 'Eyedropper (or Alt-click)', key: 'pixel.picker' },
  { id: 'shade', icon: SunMoon, label: 'Shade brush: left click one palette step lighter, right click darker', key: 'pixel.shade' },
  { id: 'select', icon: SquareDashed, label: 'Select a rectangle (Shift adds, Ctrl takes away)', key: 'pixel.select' },
  { id: 'lasso', icon: Lasso, label: 'Lasso: select by drawing around (Shift adds, Ctrl takes away)', key: 'pixel.lasso' },
  { id: 'wand', icon: WandSparkles, label: 'Magic wand: select one exact colour (Shift adds, Ctrl takes away)', key: 'pixel.wand' },
  { id: 'move', icon: Move, label: 'Move the selection, or the whole layer (arrow keys move 1 px)', key: 'pixel.move' },
]

/** Copied pixels, shared by every Pixel Art file. */
let clipboard: { piece: Img; mask: Mask; x: number; y: number } | null = null
const MAP_TOOLS: { id: Tool; icon: typeof Brush; label: string }[] = [
  { id: 'tile', icon: Layers, label: 'Place tiles (drag over the tile picture to pick several)' },
  { id: 'tileErase', icon: Eraser, label: 'Remove tiles' },
  { id: 'tileFill', icon: PaintBucket, label: 'Fill with tiles' },
  { id: 'pencil', icon: Brush, label: 'Draw pixels: changes the tile everywhere it is used' },
  { id: 'picker', icon: Pipette, label: 'Pick a tile from the map' },
]

type Live = { key: string; base: Img; img: Img; start: Pt; path: Pt[]; button: number; float?: { piece: Img; mask: Mask; x: number; y: number; rest: Img }; at?: Pt }

function Editor({ doc, documentId, title, active }: { doc: UseDocumentResult<PixelDoc> & { data: PixelDoc }; documentId: string; title: string; active: boolean }) {
  const d = doc.data
  useUndoRedoKeys(doc, active)
  const root = useProjectStore((s) => s.root)
  const lib = useDocument<TileLibrary>('level-layout', LIBRARY_ID, createLibrary)
  const update = (fn: (x: PixelDoc) => PixelDoc) => doc.update(fn)

  const [tool, setTool] = useState<Tool>('pencil')
  const [colors, setColors] = useState<[string, string]>([d.palette[1] ?? '#ffffff', d.palette[0] ?? '#000000'])
  const [size, setSize] = useState(1)
  const [round, setRound] = useState(false)
  const [clean, setClean] = useState(true)
  const [filled, setFilled] = useState(false)
  const [contiguous, setContiguous] = useState(true)
  const [dither, setDither] = useState(16)
  const [sym, setSym] = useState({ x: false, y: false })
  const [seamless, setSeamless] = useState(false)
  const [onion, setOnion] = useState(false)
  const [preview, setPreview] = useState(false)
  // A palette variant shown instead of the palette (preview only).
  const [variant, setVariant] = useState<string | null>(null)
  const [showGrid, setShowGrid] = useState(true)
  const [zoom, setZoom] = useState(() => Math.max(1, Math.min(32, Math.floor(480 / Math.max(d.width, d.height)))))
  const [layerId, setLayerId] = useState(d.layers[d.layers.length - 1].id)
  const [frame, setFrame] = useState(0)
  const [mapMode, setMapMode] = useState(false)
  const [mapLayerId, setMapLayerId] = useState(d.map?.layers[0]?.id ?? '')
  const [stamp, setStamp] = useState({ col: 0, row: 0, w: 1, h: 1 })
  // Mirrors and turn for placed tiles (FLIP_H, FLIP_V, TRANSPOSE bits).
  const [tileFlags, setTileFlags] = useState(0)
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
  const [note, setNote] = useState<string | null>(null)
  // The selection (not saved with the file) and the one being drawn.
  const [mask, setMask] = useState<Mask | null>(null)
  const selecting = useRef<{ start: Pt; path: Pt[]; how: Combine; preview: Mask | null } | null>(null)
  const [, tick] = useState(0)
  const live = useRef<Live | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const hover = useRef<Pt | null>(null)

  const urls = useMemo(() => Object.values(d.cels), [d.cels])
  useDecoded(urls)
  const fi = Math.min(frame, d.frames.length - 1)
  const layer = d.layers.find((l) => l.id === layerId) ?? d.layers[d.layers.length - 1]
  const ts = d.tileSize ?? 16
  const cols = tileColumns(d)
  const inMap = d.kind === 'tileset' && mapMode && !!d.map
  const mapLayer = d.map?.layers.find((l) => l.id === mapLayerId) ?? d.map?.layers[0]

  const imgOf = (layerId: string, frameId: string) => {
    const key = celKey(layerId, frameId)
    return live.current?.key === key ? live.current.img : celImg(d.cels[key], d.width, d.height)
  }
  const frameImg = (i: number) => composite(d.layers.map((l) => ({ visible: l.visible, opacity: l.opacity, img: imgOf(l.id, d.frames[i].id) })), d.width, d.height)

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
      if (onion && d.frames.length > 1) {
        g.globalAlpha = 0.28
        if (fi > 0) g.drawImage(toCanvas(frameImg(fi - 1)), at[0], at[1])
        g.globalAlpha = 0.16
        if (fi < d.frames.length - 1) g.drawImage(toCanvas(frameImg(fi + 1)), at[0], at[1])
        g.globalAlpha = 1
      }
      const v = d.variants?.find((x) => x.id === variant)
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
    drawOverlay()
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
    const dpr = window.devicePixelRatio || 1
    o.width = Math.round(c.width * zoom * dpr)
    o.height = Math.round(c.height * zoom * dpr)
    const g = o.getContext('2d')!
    const s = zoom * dpr
    g.clearRect(0, 0, o.width, o.height)
    g.lineWidth = 1
    if (showGrid && zoom >= 8 && !inMap) {
      g.strokeStyle = 'rgba(127,127,127,0.25)'
      lines(g, 1)
    }
    if (showGrid && d.kind === 'tileset') {
      g.strokeStyle = 'rgba(77,171,247,0.6)'
      lines(g, ts)
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

  // Map and tiles have their own tools.
  useEffect(() => {
    setTool(inMap ? 'tile' : 'pencil')
  }, [inMap])

  // ---- Playback ----
  useEffect(() => {
    if (!playing) return
    const tag = d.tags.find((t) => t.id === playTag) ?? null
    const order = tagFrames(tag, d.frames.length)
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
    if (hit) return act(() => setTool(hit.id))
    if (isShortcut(e, 'pixel.swap')) return act(() => setColors([colors[1], colors[0]]))
    if (isShortcut(e, 'pixel.bigger')) return act(() => setSize((s) => Math.min(32, s + 1)))
    if (isShortcut(e, 'pixel.smaller')) return act(() => setSize((s) => Math.max(1, s - 1)))
    if (isShortcut(e, 'pixel.prev')) return act(() => setFrame((f) => (f - 1 + d.frames.length) % d.frames.length))
    if (isShortcut(e, 'pixel.next')) return act(() => setFrame((f) => (f + 1) % d.frames.length))
    if (isShortcut(e, 'pixel.play') && d.kind === 'sprite') return act(() => setPlaying((p) => !p))
    if (isShortcut(e, 'pixel.mode') && d.kind === 'tileset') return act(() => setMapMode((m) => !m))
    if (inMap) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'a') return act(() => setMask(all()))
    if (mod && k === 'd') return act(() => setMask(null))
    if (mod && k === 'c') return act(() => copySel(false))
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
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
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
  const pos = (e: React.PointerEvent): Pt => {
    const r = canvas.current!.getBoundingClientRect()
    const x = Math.floor(((e.clientX - r.left) / r.width) * canvas.current!.width)
    const y = Math.floor(((e.clientY - r.top) / r.height) * canvas.current!.height)
    if (inMap) return tool === 'pencil' ? [x, y] : [Math.floor(x / ts), Math.floor(y / ts)]
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
    const img = cloneImg(l.base)
    const color = hexToRgba(paintHex(l.button === 2 ? colors[1] : colors[0]))
    let pts: Pt[] = []
    if (tool === 'pencil' || tool === 'eraser' || tool === 'shade') pts = clean && size === 1 ? cleanPath(l.path) : l.path
    else if (tool === 'line') pts = line(l.start[0], l.start[1], end[0], end[1])
    else if (tool === 'rect') pts = rectPoints(l.start[0], l.start[1], end[0], end[1], filled)
    else if (tool === 'ellipse') pts = ellipsePoints(l.start[0], l.start[1], end[0], end[1], filled)
    const brush = brushOffsets(size, round)
    pts = pts.flatMap(([x, y]) => brush.map(([bx, by]): Pt => [x + bx, y + by]))
    if (!inMap) pts = mirror(pts, d.width, d.height, sym)
    const seen = new Set<number>()
    for (const p0 of pts) {
      const p = inMap ? mapToSet(p0) : wrap(p0)
      if (!p || p[0] < 0 || p[1] < 0 || p[0] >= d.width || p[1] >= d.height) continue
      const k = p[1] * d.width + p[0]
      if (seen.has(k) || (mask && !inMap && !mask[k])) continue
      seen.add(k)
      if (tool !== 'eraser' && tool !== 'shade' && !ditherOn(p[0], p[1], dither)) continue
      if (tool === 'eraser') setPx(img, p[0], p[1], [0, 0, 0, 0])
      else if (tool === 'shade') {
        const [r, g, b, a] = getPx(l.base, p[0], p[1])
        const next = a ? shadeStep(d.palette, rgbaToHex(r, g, b), l.button === 2 ? -1 : 1) : null
        if (next) setPx(img, p[0], p[1], hexToRgba(next))
      } else setPx(img, p[0], p[1], color)
    }
    l.img = img
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
    if (e.button === 1) return
    const p = pos(e)
    if (tool === 'picker' || (e.altKey && !inMap)) return pick(p, e.button)
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
    if (tool === 'select' || tool === 'lasso' || tool === 'wand') {
      const how: Combine = e.shiftKey ? 'add' : e.ctrlKey || e.metaKey ? 'subtract' : 'replace'
      const q = wrap(p)
      if (tool === 'wand') {
        if (q[0] < 0 || q[1] < 0 || q[0] >= d.width || q[1] >= d.height) return
        return setMask(combine(mask, wandMask(celImg(d.cels[celKey(layer.id, d.frames[fi].id)], d.width, d.height), q[0], q[1], contiguous), how))
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      selecting.current = { start: q, path: [q], how, preview: null }
      return
    }
    if (layer.locked || !layer.visible) return setNote(layer.locked ? 'This layer is locked.' : 'This layer is hidden.')
    const frameId = inMap ? d.frames[0].id : d.frames[fi].id
    const key = celKey(layer.id, frameId)
    const base = cloneImg(celImg(d.cels[key], d.width, d.height))
    if (tool === 'fill') {
      const q = wrap(p)
      if (q[0] < 0 || q[1] < 0 || q[0] >= d.width || q[1] >= d.height) return
      const img = cloneImg(base)
      const c = hexToRgba(paintHex(e.button === 2 ? colors[1] : colors[0]))
      for (const [x, y] of floodPoints(base, q[0], q[1], contiguous)) if (ditherOn(x, y, dither) && (!mask || mask[y * d.width + x])) setPx(img, x, y, c)
      return commit(key, img)
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (tool === 'move') {
      // Lift the selected pixels (or the whole layer) off, to drop them where the pointer lets go.
      const rest = cloneImg(base)
      const c = cut(rest, mask ?? rectMask(d.width, d.height, 0, 0, d.width - 1, d.height - 1))
      if (!c) return
      live.current = { key, base, img: base, start: p, path: [p], button: e.button, float: { ...c, rest }, at: p }
      return
    }
    live.current = { key, base, img: base, start: p, path: [p], button: e.button }
    render(live.current, p)
    draw()
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
        let [sx, sy] = [x, y]
        if (tileFlags & FLIP_V) sy = H - 1 - sy
        if (tileFlags & FLIP_H) sx = W - 1 - sx
        if (tileFlags & TRANSPOSE) [sx, sy] = [sy, sx]
        next[`${cx},${cy}`] = ((stamp.row + sy) * cols + stamp.col + sx) | (tileFlags << 16)
      }
    return next
  }

  const onMove = (e: React.PointerEvent) => {
    const p = pos(e)
    hover.current = p
    if (draft.current) {
      setMapDraft(placeTiles(draft.current, p, (e.buttons & 2) === 2))
      return
    }
    const sel = selecting.current
    if (sel) {
      const q = wrap(p)
      sel.path.push(q)
      sel.preview = combine(mask, tool === 'lasso' ? lassoMask(d.width, d.height, sel.path) : rectMask(d.width, d.height, sel.start[0], sel.start[1], q[0], q[1]), sel.how)
      return drawOverlay()
    }
    const l = live.current
    if (!l) return drawOverlay()
    if (l.float) {
      l.at = p
      dropFloat(l, p[0] - l.start[0], p[1] - l.start[1])
      return draw()
    }
    if (tool === 'pencil' || tool === 'eraser' || tool === 'shade') {
      const last = l.path[l.path.length - 1]
      if (last[0] === p[0] && last[1] === p[1]) return
      l.path.push(...line(last[0], last[1], p[0], p[1]).slice(1))
    }
    render(l, !e.shiftKey ? p : tool === 'line' ? constrain(l.start, p) : tool === 'rect' || tool === 'ellipse' ? square(l.start, p) : p)
    draw()
  }
  const onUp = () => {
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
    if (l.float && mask && l.at) setMask(placeMask(d.width, d.height, l.float.mask, l.float.piece.width, l.float.x + l.at[0] - l.start[0], l.float.y + l.at[1] - l.start[1]))
    commit(l.key, l.img)
  }

  const commit = (key: string, img: Img) => {
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
        const img = cloneImg(celImg(url, x.width, x.height))
        if (!replaceColor(img, from, to)) continue
        const next = encode(img)
        if (next) cels[k] = next
      }
      return { ...x, cels, palette: x.palette.map((c) => (c === from ? to : c)) }
    })

  const curKey = () => celKey(layer.id, d.frames[inMap ? 0 : fi].id)
  const all = () => rectMask(d.width, d.height, 0, 0, d.width - 1, d.height - 1)
  /** Change the selected pixels (or the whole layer) with `fn`, kept centred where they were. */
  const transform = (fn: (img: Img) => Img) => {
    if (layer.locked) return setNote('This layer is locked.')
    const key = curKey()
    const img = cloneImg(celImg(d.cels[key], d.width, d.height))
    const c = cut(img, mask ?? all())
    if (!c) return
    const piece = fn(c.piece)
    const pm = imgMask(fn(maskImg(c.mask, c.piece.width, c.piece.height)))
    const x = c.x + Math.floor((c.piece.width - piece.width) / 2)
    const y = c.y + Math.floor((c.piece.height - piece.height) / 2)
    paste(img, piece, x, y, pm)
    commit(key, img)
    if (mask) setMask(placeMask(d.width, d.height, pm, piece.width, x, y))
  }
  const outlineSel = () => commit(curKey(), outline(celImg(d.cels[curKey()], d.width, d.height), hexToRgba(paintHex(colors[0])), mask))
  /** In palette-only mode every painted colour snaps to the palette; in gray mode it turns gray. */
  const paintHex = (hex: string) => (d.colorMode === 'indexed' ? nearest(d.palette, hex) : d.colorMode === 'gray' ? grayHex(hex) : hex)
  /** Every cel changed by `fn` (one undo step). */
  const mapCels = (fn: (img: Img) => Img, patch: Partial<PixelDoc> = {}) =>
    update((x) => {
      const cels: Record<string, string> = {}
      for (const [k, url] of Object.entries(x.cels)) {
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
  const sheet = () => {
    const columns = sheetColumns(d.frames.length)
    const img = blank(columns * d.width, Math.ceil(d.frames.length / columns) * d.height)
    d.frames.forEach((_, i) => {
      const f = frameImg(i)
      const c = sheetCell(i, columns, d.width, d.height)
      for (let y = 0; y < d.height; y++) img.data.set(f.data.subarray(y * d.width * 4, (y + 1) * d.width * 4), ((c.y + y) * img.width + c.x) * 4)
    })
    return img
  }
  const exportGif = async () => {
    const order = tagFrames(d.tags.find((t) => t.id === playTag) ?? null, d.frames.length)
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
    const json = JSON.stringify(sheetJson(d, `${base}.png`), null, 2)
    if (await writeTo('Choose a folder for the sprite sheet', [], [[`${base}.png`, await pngBytes(sheet())], [`${base}.json`, new TextEncoder().encode(json)]])) setNote(`Saved ${base}.png and ${base}.json.`)
  }
  const exportGodot = async () => {
    const tres = godotSpriteFrames(d, `res://egd/sprites/${base}.png`)
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
    if (await confirmDialog({ title: 'Use this palette?', message: `${colors.length} colours replace the current palette. Your pixels stay as they are.`, confirmLabel: 'Use it' })) update((x) => ({ ...x, palette: colors }))
  }

  const tools = inMap ? MAP_TOOLS : TOOLS
  const css = (n: number) => n * zoom
  const cw = inMap && d.map ? d.map.width * ts : d.width * (seamless ? 3 : 1)
  const ch = inMap && d.map ? d.map.height * ts : d.height * (seamless ? 3 : 1)

  return (
    <div className="px">
      <div className="px-head">
        <PresetHeader documentId={documentId} kind={d.kind === 'tileset' ? 'Tileset' : 'Sprite'} undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
      </div>
      <div className="px-toolbar">
        {tools.map((t) => (
          <button key={t.id} className={`icon-btn${tool === t.id ? ' on' : ''}`} title={t.label} aria-label={t.label} onClick={() => setTool(t.id)}>
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
            {tool === 'fill' && (
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
            {d.kind === 'sprite' && (
              <label className="px-row" title="Preview window: the animation loops next to the palette while you draw">
                <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Preview
              </label>
            )}
          </>
        )}
        <button className={`icon-btn${showGrid ? ' on' : ''}`} title="Grid" onClick={() => setShowGrid(!showGrid)}>
          <Grid3x3 size={15} />
        </button>
        <label className="px-row" title="Zoom (whole steps keep pixels square)">
          Zoom <input type="range" min={1} max={48} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> {zoom}×
        </label>
        {d.kind === 'tileset' && (
          <button className={`btn${inMap ? ' btn-primary' : ''}`} title="Switch between drawing the tiles and painting a map with them (Tab)" onClick={() => setMapMode(!mapMode)}>
            <MapIcon size={14} /> {inMap ? 'Map' : 'Tiles'}
          </button>
        )}
        <span className="px-menu">
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
                  <button onClick={() => void exportSheet()}>Sprite sheet + JSON</button>
                  <button onClick={() => void exportGodot()}>Godot SpriteFrames</button>
                </>
              ) : (
                <>
                  <button onClick={() => savePng(frameImg(0), `${base}_tiles.png`)}>Tileset PNG</button>
                  <button onClick={() => savePng(mapImg(), `${base}_map.png`)}>Map PNG</button>
                  <button onClick={() => void pushTileset(true).then((id) => id && setNote('This tileset is in Level Layout now and stays up to date.'))}>Use in Level Layout</button>
                  <button onClick={() => void sendMap()}>Send the map to Level Layout</button>
                </>
              )}
              <button onClick={() => void importImage()}>Add a picture as a layer</button>
              {IMAGE_TARGETS.map((t) => (
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
        <aside className="px-side">
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
            />
          )}
          {preview && d.kind === 'sprite' && !inMap && (
            <Preview d={d} frameImg={frameImg} playTag={playTag} />
          )}
        </aside>
        <div className="px-stage">
          <div className="px-canvas" style={{ width: css(cw), height: css(ch) }}>
            <canvas
              ref={canvas}
              style={{ width: css(cw), height: css(ch) }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={() => ((hover.current = null), drawOverlay())}
              onContextMenu={(e) => e.preventDefault()}
              onWheel={(e) => e.ctrlKey && (e.preventDefault(), setZoom((z) => Math.max(1, Math.min(48, z + (e.deltaY < 0 ? 1 : -1)))))}
            />
            <canvas ref={overlay} className="px-overlay" style={{ width: css(cw), height: css(ch) }} />
          </div>
        </div>
        <aside className="px-side right">
          {inMap && d.map ? (
            <MapPanel d={d} mapLayerId={mapLayer?.id ?? ''} setMapLayerId={setMapLayerId} update={update} />
          ) : (
            <>
              <LayersPanel d={d} layerId={layer.id} setLayerId={setLayerId} update={update} />
              <div className="px-panel">
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
                  <button className="btn btn-ghost" title="A one-pixel line in the main colour around the drawing" onClick={outlineSel}>
                    Outline
                  </button>
                  <button className="btn btn-ghost" title="Shift by half with wrap-around, to check that a tile repeats without seams" onClick={() => commit(curKey(), wrapShift(celImg(d.cels[curKey()], d.width, d.height), Math.floor(d.width / 2), Math.floor(d.height / 2)))}>
                    Wrap shift
                  </button>
                </div>
                {mask && <SelectionInfo mask={mask} width={d.width} />}
              </div>
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
