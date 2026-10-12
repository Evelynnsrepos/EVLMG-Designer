import { ArrowDown, ArrowUp, Ban, Brush, Download, Eraser, Eye, EyeOff, PaintBucket, Plus, SquareDashed, StickyNote, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useSettings, isTextField, useUndoRedoKeys } from '@/core/state'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { pickAndImportAssets, resolveAssetPath } from '@/core/assets'
import { getFs } from '@/core/fs'
import { newId } from '@/core/model'
import { formatCombo, isShortcut, keysOf } from '@/core/shortcuts'
import { NumberInput, PresetHeader } from '@/shared/calculators'
import { confirmDialog } from '@/shared/dialogs'
import { drawTile } from '@/shared/tileset'
import { loadAssetImage, useTilesetImages } from './images'
import { ImportDialog, type ImportValues } from './ImportDialog'
import {
  bucket,
  clearRegion,
  geometry,
  inRect,
  moveRegion,
  type CellRect,
  cellKey,
  counts,
  createLevelDoc,
  createLibrary,
  godotScene,
  grid,
  isBlocked,
  LIBRARY_ID,
  MARKERS,
  migrateLevel,
  newLayer,
  newNote,
  parseArt,
  stampCells,
  stampTileAt,
  tileColor,
  tileRect,
  TILES,
  usedTilesets,
  type ArtLayer,
  type LevelDoc,
  type Stamp,
  type TileId,
  type TileLibrary,
  type Tileset,
} from './model'
import { TilesetDock } from './TilesetDock'
import './level-layout.css'

type Tool = 'paint' | 'erase' | 'select' | 'fill' | 'note' | 'block'
const CELL = 22
/** Canvases bigger than this fail in some browsers; the level is drawn smaller and scaled up instead. */
const MAX_CANVAS = 12000

type Draft = { tiles: Record<string, TileId>; layers: ArtLayer[]; blocked: Record<string, true>; unblock?: boolean }

/** Level / dungeon layout editor (v0.10). */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<LevelDoc>('level-layout', documentId!, createLevelDoc)
  // v0.15: the tilesets are shared by every level in the project.
  const lib = useDocument<TileLibrary>('level-layout', LIBRARY_ID, createLibrary)
  useUndoRedoKeys(doc, active)
  const title = useProjectStore((s) => s.meta?.documents.find((x) => x.id === documentId)?.title ?? 'Level')
  const root = useProjectStore((s) => s.root)
  const sharp = useSettings((s) => s.sharpPixels)
  const [tool, setTool] = useState<Tool>('paint')
  const [tile, setTile] = useState<TileId>('wall')
  // A picture tile, or a block of them (v0.15 stamp); null = paint plan tiles.
  const [stamp, setStamp] = useState<Stamp | null>(null)
  const [layerId, setLayerId] = useState<string | null>(null)
  const [exported, setExported] = useState<string | null>(null)
  // Zoom as a power of two: -3.3 … 3 is 10 % … 800 %.
  const [zoomLog, setZoomLog] = useState(0)
  const zoom = 2 ** zoomLog
  // v0.16: brush size for paint, erase and blocked; the select-and-move rectangle and how far it is being dragged.
  const [size, setSize] = useState(1)
  const [sel, setSel] = useState<CellRect | null>(null)
  const [moving, setMoving] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const [picking, setPicking] = useState(false)
  const [drag, setDrag] = useState<(Draft & { x: number; y: number }) | null>(null)
  // v0.14: where nothing can walk, shown as a red overlay.
  const [showBlocked, setShowBlocked] = useState(true)
  // v0.15: paint on blocked cells anyway (blocking is only for Godot), and the hint when a cell was skipped.
  const [override, setOverride] = useState(false)
  const [blockHint, setBlockHint] = useState(false)
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // The pictures being added (several at once make one tileset each), or the one tileset being replaced or regridded.
  const [importing, setImporting] = useState<{ image: string; more?: { path: string; name: string }[]; title: string; set?: Tileset; initial: Partial<ImportValues> & { name: string } } | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [noteId, setNoteId] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const selRef = useRef<CellRect | null>(null)
  selRef.current = sel
  const d = doc.data
  const sets = useMemo(() => lib.data?.tilesets ?? [], [lib.data?.tilesets])
  const images = useTilesetImages(sets)

  const updateLib = lib.update
  const updateDoc = doc.update
  // Levels from before v0.15 had their own tilesets and one picture layer: move them over once.
  useEffect(() => {
    if (!d || !lib.data) return
    const m = migrateLevel(d, lib.data)
    if (!m) return
    updateLib(() => m.library, { undoable: false })
    updateDoc(() => m.level, { undoable: false })
  }, [d, lib.data, updateLib, updateDoc])

  const layers = useMemo(() => d?.layers ?? [], [d?.layers])
  const layer = layers.find((l) => l.id === layerId) ?? layers[0]
  const shown = useMemo(() => (drag && d ? { ...d, tiles: drag.tiles, layers: drag.layers, blocked: drag.blocked } : moving && sel && d ? { ...d, ...moveRegion(d, sel, moving.dx, moving.dy) } : d), [drag, d, moving, sel])

  // One level cell in device pixels. Sharp pixel art: a whole number of screen pixels per tile pixel.
  const dpr = window.devicePixelRatio || 1
  const base = usedTilesets(d ?? createLevelDoc(), sets)[0]?.tileSize ?? sets[0]?.tileSize ?? 16
  let cellPx = Math.max(2, Math.round(CELL * zoom * dpr))
  // Zoomed out below one screen pixel per tile pixel, snapping stops.
  if (sharp && cellPx >= base) cellPx = base * Math.round(cellPx / base)
  if (d) cellPx = Math.max(4, Math.min(cellPx, Math.floor(MAX_CANVAS / Math.max(d.width, d.height))))

  useEffect(() => {
    const c = canvas.current
    if (!c || !shown) return
    const ctx = c.getContext('2d')!
    const s = cellPx
    const geo = geometry(shown.iso, shown.width, shown.height, s)
    const ch = geo.cellH
    c.width = Math.ceil(geo.width)
    c.height = Math.ceil(geo.height)
    ctx.fillStyle = '#1b1b20'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.imageSmoothingEnabled = !sharp
    ctx.imageSmoothingQuality = 'high'
    /** The cell's outline as the current path: a square, or a diamond. */
    const shape = (x: number, y: number, inset = 0) => {
      const [bx, by] = geo.box(x, y)
      ctx.beginPath()
      if (!shown.iso) return ctx.rect(bx + inset, by + inset, s - inset * 2, s - inset * 2)
      ctx.moveTo(bx + s / 2, by + inset)
      ctx.lineTo(bx + s - inset * 2, by + ch / 2)
      ctx.lineTo(bx + s / 2, by + ch - inset)
      ctx.lineTo(bx + inset * 2, by + ch / 2)
      ctx.closePath()
    }
    const centre = (x: number, y: number): [number, number] => {
      const [bx, by] = geo.box(x, y)
      return [bx + s / 2, by + ch / 2]
    }
    // Isometric levels draw back to front, so taller tiles overlap the ones behind them.
    const order = (entries: [string, string][]) => (shown.iso ? entries.map((e) => [e, e[0].split(',').map(Number)] as const).sort((a, b) => a[1][0] + a[1][1] - (b[1][0] + b[1][1])).map((e) => e[0]) : entries)
    const byId = new Map(sets.map((t) => [t.id, t]))
    const painted = new Set<string>()
    for (const l of shown.layers ?? []) {
      if (l.hidden) continue
      for (const [k, v] of order(Object.entries(l.art))) {
        const [x, y] = k.split(',').map(Number)
        const a = parseArt(v)
        const t = byId.get(a.set)
        const img = images[a.set]
        if (!t || !img) continue
        const r = tileRect(t, a.col, a.row)
        const [bx, by] = geo.box(x, y)
        // The tile keeps its own shape: as wide as the cell, standing on the cell's bottom edge.
        const dh = (s * r.h) / r.size
        drawTile(ctx, img, r.x, r.y, r.size, bx, by + ch - dh, s, a.flags, r.h, dh)
        painted.add(k)
      }
    }
    for (const [k, t] of Object.entries(shown.tiles)) {
      const [x, y] = k.split(',').map(Number)
      const mark = MARKERS[t]
      // A symbol (start, enemy…) sits on its picture tile, or on floor when there is none.
      if (!mark || !painted.has(k)) {
        ctx.fillStyle = mark ? tileColor('floor') : tileColor(t)
        shape(x, y)
        ctx.fill()
      }
      if (mark) {
        const [cx, cy] = centre(x, y)
        ctx.fillStyle = tileColor(t)
        ctx.beginPath()
        ctx.arc(cx, cy, ch * 0.38, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.font = `bold ${Math.round(ch * 0.5)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(mark, cx, cy + 1)
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    if (shown.iso) {
      for (let y = 0; y < shown.height; y++)
        for (let x = 0; x < shown.width; x++) {
          shape(x, y)
          ctx.stroke()
        }
    } else {
      ctx.beginPath()
      for (let x = 0; x <= shown.width; x++) {
        ctx.moveTo(x * s + 0.5, 0)
        ctx.lineTo(x * s + 0.5, c.height)
      }
      for (let y = 0; y <= shown.height; y++) {
        ctx.moveTo(0, y * s + 0.5)
        ctx.lineTo(c.width, y * s + 0.5)
      }
      ctx.stroke()
    }
    if (showBlocked || blockHint) {
      // While the hint shows, the blocked cells light up so it is clear where painting stops.
      ctx.fillStyle = blockHint ? 'rgba(224, 49, 49, 0.6)' : 'rgba(224, 49, 49, 0.35)'
      ctx.strokeStyle = 'rgba(224, 49, 49, 0.9)'
      ctx.lineWidth = Math.max(1.5, s / 14)
      const pad = ch / 5
      for (let y = 0; y < shown.height; y++)
        for (let x = 0; x < shown.width; x++) {
          if (!isBlocked(shown, sets, x, y)) continue
          shape(x, y)
          ctx.fill()
          const [cx, cy] = centre(x, y)
          ctx.beginPath()
          ctx.moveTo(cx - ch / 2 + pad, cy - ch / 2 + pad)
          ctx.lineTo(cx + ch / 2 - pad, cy + ch / 2 - pad)
          ctx.moveTo(cx + ch / 2 - pad, cy - ch / 2 + pad)
          ctx.lineTo(cx - ch / 2 + pad, cy + ch / 2 - pad)
          ctx.stroke()
        }
    }
    shown.notes.forEach((n, i) => {
      const [cx, cy] = centre(n.x, n.y)
      ctx.fillStyle = '#ffe27a'
      ctx.fillRect(cx - ch / 2 + 2, cy - ch / 2 + 2, ch - 4, ch - 4)
      ctx.fillStyle = '#1c1d22'
      ctx.font = `bold ${Math.round(ch * 0.5)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), cx, cy + 1)
    })
    // The select-and-move rectangle.
    const r = moving && sel ? { x0: sel.x0 + moving.dx, y0: sel.y0 + moving.dy, x1: sel.x1 + moving.dx, y1: sel.y1 + moving.dy } : sel
    if (r) {
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = '#4dabf7'
      for (let y = Math.min(r.y0, r.y1); y <= Math.max(r.y0, r.y1); y++)
        for (let x = Math.min(r.x0, r.x1); x <= Math.max(r.x0, r.x1); x++) {
          shape(x, y)
          ctx.fillStyle = 'rgba(77, 171, 247, 0.12)'
          ctx.fill()
        }
      const [ax, ay] = geo.box(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1))
      if (!shown.iso) ctx.strokeRect(ax, ay, (Math.abs(r.x1 - r.x0) + 1) * s, (Math.abs(r.y1 - r.y0) + 1) * s)
      ctx.setLineDash([])
    }
  }, [shown, sets, images, showBlocked, blockHint, cellPx, sharp, sel, moving])

  // v0.15: tool shortcuts, changeable in Settings.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTextField(e.target) || (e.target as HTMLElement | null)?.tagName === 'SELECT') return
      if (e.key === 'Escape' && selRef.current) {
        e.preventDefault()
        return setSel(null)
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current) {
        e.preventDefault()
        const r = selRef.current
        return doc.update((x) => ({ ...x, ...clearRegion(x, r) }))
      }
      const hit = (['paint', 'select', 'fill', 'erase', 'note', 'block'] as const).find((id) => isShortcut(e, `level.${id}`))
      if (!hit) return
      e.preventDefault()
      setTool(hit)
    }
    // Capture, so Esc with a selection lets go of it before Layout Mode sees the key.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- doc.update is stable
  }, [active])

  if (!d) return null
  const cellAt = (e: React.MouseEvent) => {
    const c = canvas.current!
    const r = c.getBoundingClientRect()
    return geometry(d.iso, d.width, d.height, cellPx).at(((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height)
  }
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x < d.width && p.y < d.height
  const apply = (draft: Draft) => doc.update((x) => ({ ...x, tiles: draft.tiles, layers: draft.layers, blocked: draft.blocked }))
  /** Painting skips blocked cells unless "Paint over blocked" is on; say so once per stroke. */
  const guarded = (x: number, y: number) => !override && isBlocked(d, sets, x, y)
  const hintBlocked = () => {
    setBlockHint(true)
    clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setBlockHint(false), 2600)
  }
  const withLayer = (draft: Draft, fn: (art: Record<string, string>) => Record<string, string>): ArtLayer[] => draft.layers.map((l) => (l.id === layer?.id ? { ...l, art: fn(l.art) } : l))

  /** The brush: one cell painted at every cell of a size × size square around p (stamps paint once). */
  const paintAt = (cur: Draft, p: { x: number; y: number }): Draft => {
    if (size === 1 || (stamp && tool === 'paint')) return paintCell(cur, p)
    const lo = Math.floor((size - 1) / 2)
    let next = cur
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (inside({ x: p.x - lo + x, y: p.y - lo + y })) next = { ...next, ...paintCell(next, { x: p.x - lo + x, y: p.y - lo + y }) }
    return next
  }
  /** One cell painted (or erased: the picture tile of this layer first, then the plan tile). */
  const paintCell = (cur: Draft, p: { x: number; y: number }): Draft => {
    const k = cellKey(p.x, p.y)
    if (tool === 'block') {
      const blocked = { ...cur.blocked }
      // Starting on a blocked cell unblocks for the whole drag, otherwise it blocks.
      if (cur.unblock) delete blocked[k]
      else blocked[k] = true
      return { ...cur, blocked }
    }
    if (tool === 'erase') {
      if (cur.layers.find((l) => l.id === layer?.id)?.art[k])
        return {
          ...cur,
          layers: withLayer(cur, (art) => {
            const next = { ...art }
            delete next[k]
            return next
          }),
        }
      const tiles = { ...cur.tiles }
      delete tiles[k]
      return { ...cur, tiles }
    }
    if (stamp) {
      const all = stampCells(stamp, p.x, p.y, d)
      const cells = all.filter(([key]) => {
        const [x, y] = key.split(',').map(Number)
        return !guarded(x, y)
      })
      if (cells.length < all.length) hintBlocked()
      return { ...cur, layers: withLayer(cur, (art) => ({ ...art, ...Object.fromEntries(cells) })) }
    }
    if (guarded(p.x, p.y)) return hintBlocked(), cur
    return { ...cur, tiles: { ...cur.tiles, [k]: tile } }
  }

  const onDown = (e: React.MouseEvent) => {
    const p = cellAt(e)
    if (!inside(p)) return
    const start: Draft = { tiles: d.tiles, layers, blocked: d.blocked ?? {} }
    if (tool === 'fill') {
      const erase = e.button === 2
      if (guarded(p.x, p.y) && !erase) return hintBlocked()
      const skip = erase ? undefined : (x: number, y: number) => guarded(x, y)
      if (stamp) {
        const fill = stamp.w * stamp.h > 1 ? (x: number, y: number) => stampTileAt(stamp, p.x, p.y, x, y) : stampTileAt(stamp, 0, 0, 0, 0)
        return apply({ ...start, layers: withLayer(start, (art) => bucket({ ...d, tiles: art }, p.x, p.y, erase ? null : fill, skip)) })
      }
      return apply({ ...start, tiles: bucket(d, p.x, p.y, erase ? null : tile, skip) })
    }
    if (tool === 'note') {
      const hit = d.notes.find((n) => n.x === p.x && n.y === p.y)
      if (hit) return setNoteId(hit.id)
      const n = newNote(p.x, p.y)
      doc.update((x) => ({ ...x, notes: [...x.notes, n] }))
      return setNoteId(n.id)
    }
    if (tool === 'select') {
      // Drag inside the selection to move what is in it; anywhere else starts a new selection.
      if (sel && inRect(sel, p.x, p.y)) return setMoving({ x: p.x, y: p.y, dx: 0, dy: 0 })
      setSel({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
      return setPicking(true)
    }
    const first = { ...start, unblock: tool === 'block' && (!!d.blocked?.[cellKey(p.x, p.y)] || e.button === 2) }
    last.current = p
    setDrag({ x: p.x, y: p.y, ...paintAt(first, p) })
  }
  const onMove = (e: React.MouseEvent) => {
    const p = cellAt(e)
    setHover(inside(p) ? p : null)
    if (picking && sel) return setSel({ ...sel, x1: Math.max(0, Math.min(d.width - 1, p.x)), y1: Math.max(0, Math.min(d.height - 1, p.y)) })
    if (moving) return setMoving({ ...moving, dx: p.x - moving.x, dy: p.y - moving.y })
    if (!drag || !inside(p)) return
    // Every cell between the last one and this one, so a fast drag leaves no gaps (v0.14).
    const from = last.current ?? p
    const n = Math.max(Math.abs(p.x - from.x), Math.abs(p.y - from.y))
    let next = drag
    for (let i = 1; i <= n; i++) next = { ...next, ...paintAt(next, { x: Math.round(from.x + ((p.x - from.x) * i) / n), y: Math.round(from.y + ((p.y - from.y) * i) / n) }) }
    last.current = p
    if (n) setDrag(next)
  }
  const onUp = () => {
    if (drag) apply(drag)
    setDrag(null)
    setPicking(false)
    if (moving && sel && (moving.dx || moving.dy)) {
      const m = moving
      doc.update((x) => ({ ...x, ...moveRegion(x, sel, m.dx, m.dy) }))
      setSel({ x0: sel.x0 + m.dx, y0: sel.y0 + m.dy, x1: sel.x1 + m.dx, y1: sel.y1 + m.dy })
    }
    setMoving(null)
  }

  // ---- Tilesets (shared library) ----
  const changeSet = (id: string, patch: Partial<Tileset>) => lib.update((x) => ({ ...x, tilesets: x.tilesets.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  /** Pick a picture (a drawing from Draw works too) and open the import window for it. */
  const pickPicture = async (set?: Tileset) => {
    if (!root) return
    const assets = await pickAndImportAssets(root, 'image', set ? `New picture for ${set.name}` : 'Tileset images')
    const [asset] = assets
    if (!asset) return
    const initial = set ? { name: set.name, tileSize: set.tileSize, tileHeight: set.tileHeight, margin: set.margin ?? 0, spacing: set.spacing ?? 0, blackTransparent: !!set.blackTransparent } : { name: asset.name.replace(/\.[^.]+$/, '') }
    setImporting({ image: asset.path, more: set ? undefined : assets.slice(1), set, title: set ? `Replace ${set.name}` : assets.length > 1 ? `Add ${assets.length} tilesets` : 'Add a tileset', initial })
  }
  const editGrid = (set: Tileset) => {
    setImporting({ image: set.image, set, title: `Grid of ${set.name}`, initial: { name: set.name, tileSize: set.tileSize, tileHeight: set.tileHeight, margin: set.margin ?? 0, spacing: set.spacing ?? 0, blackTransparent: !!set.blackTransparent } })
  }
  const finishImport = async (v: ImportValues & { width: number; height: number }) => {
    if (!importing || !root) return
    const job = importing
    setImporting(null)
    /** One tileset's fields from these settings and its picture's size. */
    const fields = (image: string, name: string, width: number, height: number) => {
      const tw = v.whole ? width : v.tileSize
      const th = v.whole ? height : v.tileHeight
      const g = grid({ width, height, tileSize: tw, tileHeight: th, margin: v.margin, spacing: v.spacing })
      return { name, image, tileSize: tw, tileHeight: th !== tw ? th : undefined, margin: v.margin || undefined, spacing: v.spacing || undefined, blackTransparent: v.blackTransparent || undefined, width, height, columns: g.columns, rows: g.rows }
    }
    if (job.set) return changeSet(job.set.id, fields(job.image, v.name, v.width, v.height))
    const added: Tileset[] = [{ id: newId(), added: Date.now(), ...fields(job.image, job.more?.length ? job.initial.name : v.name, v.width, v.height) }]
    for (const m of job.more ?? []) {
      const img = await loadAssetImage(root, m.path)
      if (img) added.push({ id: newId(), added: Date.now(), ...fields(m.path, m.name.replace(/\.[^.]+$/, ''), img.naturalWidth, img.naturalHeight) })
    }
    lib.update((x) => ({ ...x, tilesets: [...x.tilesets, ...added] }))
    setStamp({ set: added[0].id, col: 0, row: 0, w: 1, h: 1 })
  }
  const removeSet = async (t: Tileset) => {
    if (!(await confirmDialog({ title: `Remove ${t.name}?`, message: 'Every level in this project loses the tiles painted with it.', confirmLabel: 'Remove', danger: true }))) return
    lib.update((x) => ({ ...x, tilesets: x.tilesets.filter((s) => s.id !== t.id) }))
    if (stamp?.set === t.id) setStamp(null)
  }

  // ---- Layers ----
  const setLayers = (fn: (l: ArtLayer[]) => ArtLayer[]) => doc.update((x) => ({ ...x, layers: fn(x.layers ?? []) }))
  const addLayer = () => {
    const l = newLayer(`Layer ${layers.length + 1}`)
    setLayers((ls) => [...ls, l])
    setLayerId(l.id)
  }
  const moveLayer = (id: string, by: number) =>
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === id)
      const j = i + by
      if (j < 0 || j >= ls.length) return ls
      const next = [...ls]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const removeLayer = async (l: ArtLayer) => {
    if (Object.keys(l.art).length && !(await confirmDialog({ title: `Delete ${l.name}?`, message: 'The tiles painted on this layer go too.', confirmLabel: 'Delete', danger: true }))) return
    setLayers((ls) => ls.filter((x) => x.id !== l.id))
  }

  /** v0.13: the level as a Godot 4 TileMap scene, with its tileset pictures, into the game project. */
  const exportGodot = async () => {
    const fs = getFs()
    const folder = await fs.pickFolder('Choose your Godot project folder')
    if (!folder || !root) return
    const base = safeFileName(title).replace(/\s+/g, '_').toLowerCase() || 'level'
    const dir = await fs.join(folder, 'egd', 'levels')
    await fs.mkdir(dir)
    const used = usedTilesets(d, sets)
    for (const [i, t] of used.entries()) {
      const img = images[t.id]
      // A picture with black made see-through is saved as it is shown.
      const bytes =
        t.blackTransparent && img instanceof HTMLCanvasElement
          ? new Uint8Array(await (await new Promise<Blob | null>((res) => img.toBlob(res, 'image/png')))!.arrayBuffer())
          : await fs.readBinary(await resolveAssetPath(root, t.image))
      await fs.writeBinaryAtomic(await fs.join(dir, `${base}_tiles_${i}.png`), bytes)
    }
    const scene = godotScene(d, used, title, (i) => `res://egd/levels/${base}_tiles_${i}.png`)
    await fs.writeBinaryAtomic(await fs.join(dir, `${base}.tscn`), new TextEncoder().encode(scene))
    setExported(`Saved egd/levels/${base}.tscn in your Godot project.`)
  }
  const exportPng = async () => {
    const blob = await new Promise<Blob | null>((res) => canvas.current!.toBlob(res, 'image/png'))
    if (blob) await saveBinaryFile({ title: 'Export level as PNG', defaultName: `${safeFileName(title)}.png`, bytes: new Uint8Array(await blob.arrayBuffer()), filter: { name: 'PNG image', extensions: ['png'] } })
  }

  const note = d.notes.find((n) => n.id === noteId)
  const tally = counts(d)
  const key = (id: Tool) => {
    const k = keysOf(`level.${id}`)[0]
    return k ? ` (${formatCombo(k)})` : ''
  }
  const tools: { id: Tool; icon: typeof Brush; label: string }[] = [
    { id: 'paint', icon: Brush, label: 'Paint' },
    { id: 'select', icon: SquareDashed, label: 'Select and move: drag a rectangle, then drag inside it to move everything in it (Delete empties it, Esc lets go)' },
    { id: 'fill', icon: PaintBucket, label: 'Fill (right-click empties)' },
    { id: 'erase', icon: Eraser, label: 'Erase' },
    { id: 'note', icon: StickyNote, label: 'Note' },
    { id: 'block', icon: Ban, label: 'Blocked: mark where nothing can walk (click a blocked cell or right-click to clear)' },
  ]
  const css = cellPx / dpr

  return (
    <div className="lv">
      <div className="lv-head">
        <PresetHeader documentId={documentId!} kind="Level" undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
      </div>
      <div className="lv-toolbar">
        {tools.map((t) => (
          <button key={t.id} className={`icon-btn${tool === t.id ? ' on' : ''}`} title={t.label + key(t.id)} aria-label={t.label} onClick={() => setTool(t.id)}>
            <t.icon size={16} />
          </button>
        ))}
        <span className="lv-sep" />
        <label className="ld-inline">
          Size
          <NumberInput value={d.width} min={4} max={200} onChange={(v) => doc.update((x) => ({ ...x, width: Math.max(4, Math.min(200, Math.round(v))) }))} />×
          <NumberInput value={d.height} min={4} max={200} onChange={(v) => doc.update((x) => ({ ...x, height: Math.max(4, Math.min(200, Math.round(v))) }))} />
        </label>
        {(tool === 'paint' || tool === 'erase' || tool === 'block') && (
          <label className="ld-inline" title="Brush size in cells">
            Brush
            <input type="range" min={1} max={9} step={1} value={size} onChange={(e) => setSize(Number(e.target.value))} /> {size}
          </label>
        )}
        <label className="ld-inline lv-zoom">
          Zoom
          <input type="range" min={-3.3} max={3} step={0.05} value={zoomLog} onChange={(e) => setZoomLog(Number(e.target.value))} /> {Math.round(zoom * 100)}%
        </label>
        <label className="ld-inline" title="Isometric level: diamond cells twice as wide as high, for 32 × 16 tiles">
          <input type="checkbox" checked={!!d.iso} onChange={(e) => doc.update((x) => ({ ...x, iso: e.target.checked || undefined }))} /> Isometric
        </label>
        <button className="btn btn-ghost lv-btn" onClick={() => void exportPng()}>
          <Download size={14} /> PNG
        </button>
        <button className="btn btn-ghost lv-btn" disabled={!usedTilesets(d, sets).length} title={sets.length ? 'Export the picture tiles as a Godot 4 TileMap scene' : 'Add a tileset and paint with it first'} onClick={() => void exportGodot()}>
          <Download size={14} /> Godot scene
        </button>
        {exported && <span className="muted">{exported}</span>}
        <label className="ld-inline" title="Show where nothing can walk">
          <input type="checkbox" checked={showBlocked} onChange={(e) => setShowBlocked(e.target.checked)} /> Blocked
        </label>
        <label className="ld-inline" title="Blocked cells only tell Godot where players cannot walk. Tick this to paint over them anyway.">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Paint over blocked
        </label>
        <span className="lv-hover">{hover ? `${hover.x}, ${hover.y}` : ''}</span>
      </div>
      {blockHint && (
        <div className="lv-hint" role="status">
          That cell is blocked (red), so it was left alone. Blocking only tells Godot where players cannot walk: tick <strong>Paint over blocked</strong> to paint there anyway, or use Erase.
        </div>
      )}
      <div className="lv-body">
        <div className="lv-palette">
          {TILES.map((t) => (
            <button key={t.id} className={`lv-tile${!stamp && tile === t.id ? ' on' : ''}`} onClick={() => (setTile(t.id), setStamp(null), tool === 'erase' || tool === 'note' ? setTool('paint') : null)}>
              <span style={{ background: t.color }}>{MARKERS[t.id]}</span>
              {t.label}
              {tally[t.id] ? <em>{tally[t.id]}</em> : null}
            </button>
          ))}
        </div>
        <div className="lv-canvas">
          <canvas
            ref={canvas}
            className={sharp ? 'sharp' : ''}
            style={{ width: geometry(d.iso, d.width, d.height, css).width, height: geometry(d.iso, d.width, d.height, css).height }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={() => (onUp(), setHover(null))}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
        <aside className="lv-notes">
          <div className="lv-layers">
            <strong>
              Layers
              <button className="icon-btn" title="New layer on top" aria-label="New layer" onClick={addLayer}>
                <Plus size={14} />
              </button>
            </strong>
            {[...layers].reverse().map((l) => (
              <div key={l.id} className={`lv-layer${l.id === layer?.id ? ' on' : ''}`} onClick={() => setLayerId(l.id)}>
                <button className="icon-btn" title={l.hidden ? 'Show' : 'Hide'} onClick={(e) => (e.stopPropagation(), setLayers((ls) => ls.map((x) => (x.id === l.id ? { ...x, hidden: !x.hidden || undefined } : x))))}>
                  {l.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <input className="lv-layer-name" value={l.name} aria-label="Layer name" onChange={(e) => setLayers((ls) => ls.map((x) => (x.id === l.id ? { ...x, name: e.target.value } : x)))} />
                <button className="icon-btn" title="Move up" onClick={(e) => (e.stopPropagation(), moveLayer(l.id, 1))}>
                  <ArrowUp size={12} />
                </button>
                <button className="icon-btn" title="Move down" onClick={(e) => (e.stopPropagation(), moveLayer(l.id, -1))}>
                  <ArrowDown size={12} />
                </button>
                <button className="icon-btn" title="Delete layer" disabled={layers.length < 2} onClick={(e) => (e.stopPropagation(), void removeLayer(l))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <p className="muted lv-layers-hint">Picture tiles go on the picked layer. Put fences, fountains and other see-through things on a layer above the ground.</p>
          </div>
          <strong>Notes</strong>
          {d.notes.length === 0 && <p className="muted">Use the Note tool to pin numbered notes on the map: a puzzle, a secret, an ambush.</p>}
          {d.notes.map((n, i) => (
            <div key={n.id} className={`lv-note${n.id === noteId ? ' on' : ''}`} onClick={() => setNoteId(n.id)}>
              <span className="lv-num">{i + 1}</span>
              {n.id === noteId ? (
                <textarea
                  className="input"
                  autoFocus
                  rows={3}
                  value={n.text}
                  onChange={(e) => doc.update((x) => ({ ...x, notes: x.notes.map((o) => (o.id === n.id ? { ...o, text: e.target.value } : o)) }))}
                />
              ) : (
                <span className="lv-text">{n.text || 'Empty note'}</span>
              )}
              <button className="icon-btn" aria-label="Delete note" onClick={() => doc.update((x) => ({ ...x, notes: x.notes.filter((o) => o.id !== n.id) }))}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {note && <span className="muted">Note at {note.x}, {note.y}</span>}
        </aside>
      </div>
      <TilesetDock
        sets={sets}
        images={images}
        stamp={stamp}
        onStamp={(s) => (setStamp(s), tool === 'erase' || tool === 'note' || tool === 'select' || tool === 'block' ? setTool('paint') : null)}
        change={changeSet}
        onAdd={() => void pickPicture()}
        onReplace={(t) => void pickPicture(t)}
        onGrid={editGrid}
        onRemove={(t) => void removeSet(t)}
      />
      {importing && <ImportDialog image={importing.image} title={importing.title} initial={importing.initial} count={1 + (importing.more?.length ?? 0)} onDone={(v) => void finishImport(v)} onClose={() => setImporting(null)} />}
    </div>
  )
}
