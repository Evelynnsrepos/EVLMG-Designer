import { ArrowDown, ArrowUp, Ban, Brush, Download, Eraser, Eye, EyeOff, PaintBucket, Plus, Square, StickyNote, Trash2 } from 'lucide-react'
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
import { useTilesetImages } from './images'
import { ImportDialog, type ImportValues } from './ImportDialog'
import {
  bucket,
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
  room,
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

type Tool = 'paint' | 'erase' | 'room' | 'fill' | 'note' | 'block'
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
  const [zoom, setZoom] = useState(1)
  const [drag, setDrag] = useState<(Draft & { x: number; y: number }) | null>(null)
  // v0.14: where nothing can walk, shown as a red overlay.
  const [showBlocked, setShowBlocked] = useState(true)
  // v0.15: paint on blocked cells anyway (blocking is only for Godot), and the hint when a cell was skipped.
  const [override, setOverride] = useState(false)
  const [blockHint, setBlockHint] = useState(false)
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [importing, setImporting] = useState<{ image: string; title: string; set?: Tileset; initial: Partial<ImportValues> & { name: string } } | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [noteId, setNoteId] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
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
  const shown = useMemo(() => (drag && d ? { ...d, tiles: drag.tiles, layers: drag.layers, blocked: drag.blocked } : d), [drag, d])

  // One level cell in device pixels. Sharp pixel art: a whole number of screen pixels per tile pixel.
  const dpr = window.devicePixelRatio || 1
  const base = usedTilesets(d ?? createLevelDoc(), sets)[0]?.tileSize ?? sets[0]?.tileSize ?? 16
  let cellPx = Math.round(CELL * zoom * dpr)
  if (sharp) cellPx = base * Math.max(1, Math.round(cellPx / base))
  if (d) cellPx = Math.max(4, Math.min(cellPx, Math.floor(MAX_CANVAS / Math.max(d.width, d.height))))

  useEffect(() => {
    const c = canvas.current
    if (!c || !shown) return
    const ctx = c.getContext('2d')!
    const s = cellPx
    c.width = shown.width * s
    c.height = shown.height * s
    ctx.fillStyle = '#1b1b20'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.imageSmoothingEnabled = !sharp
    ctx.imageSmoothingQuality = 'high'
    const byId = new Map(sets.map((t) => [t.id, t]))
    const painted = new Set<string>()
    for (const l of shown.layers ?? []) {
      if (l.hidden) continue
      for (const [k, v] of Object.entries(l.art)) {
        const [x, y] = k.split(',').map(Number)
        const a = parseArt(v)
        const t = byId.get(a.set)
        const img = images[a.set]
        if (!t || !img) continue
        const r = tileRect(t, a.col, a.row)
        ctx.drawImage(img, r.x, r.y, r.size, r.size, x * s, y * s, s, s)
        painted.add(k)
      }
    }
    for (const [k, t] of Object.entries(shown.tiles)) {
      const [x, y] = k.split(',').map(Number)
      const mark = MARKERS[t]
      // A symbol (start, enemy…) sits on its picture tile, or on floor when there is none.
      if (!mark || !painted.has(k)) {
        ctx.fillStyle = mark ? tileColor('floor') : tileColor(t)
        ctx.fillRect(x * s, y * s, s, s)
      }
      if (mark) {
        ctx.fillStyle = tileColor(t)
        ctx.beginPath()
        ctx.arc(x * s + s / 2, y * s + s / 2, s * 0.38, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.font = `bold ${Math.round(s * 0.5)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(mark, x * s + s / 2, y * s + s / 2 + 1)
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
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
    if (showBlocked || blockHint) {
      // While the hint shows, the blocked cells light up so it is clear where painting stops.
      ctx.fillStyle = blockHint ? 'rgba(224, 49, 49, 0.6)' : 'rgba(224, 49, 49, 0.35)'
      ctx.strokeStyle = 'rgba(224, 49, 49, 0.9)'
      ctx.lineWidth = Math.max(1.5, s / 14)
      const pad = s / 5
      for (let y = 0; y < shown.height; y++)
        for (let x = 0; x < shown.width; x++) {
          if (!isBlocked(shown, sets, x, y)) continue
          ctx.fillRect(x * s, y * s, s, s)
          ctx.beginPath()
          ctx.moveTo(x * s + pad, y * s + pad)
          ctx.lineTo(x * s + s - pad, y * s + s - pad)
          ctx.moveTo(x * s + s - pad, y * s + pad)
          ctx.lineTo(x * s + pad, y * s + s - pad)
          ctx.stroke()
        }
    }
    shown.notes.forEach((n, i) => {
      ctx.fillStyle = '#ffe27a'
      ctx.fillRect(n.x * s + 2, n.y * s + 2, s - 4, s - 4)
      ctx.fillStyle = '#1c1d22'
      ctx.font = `bold ${Math.round(s * 0.5)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), n.x * s + s / 2, n.y * s + s / 2 + 1)
    })
  }, [shown, sets, images, showBlocked, blockHint, cellPx, sharp])

  // v0.15: tool shortcuts, changeable in Settings.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTextField(e.target) || (e.target as HTMLElement | null)?.tagName === 'SELECT') return
      const hit = (['paint', 'room', 'fill', 'erase', 'note', 'block'] as const).find((id) => isShortcut(e, `level.${id}`))
      if (!hit) return
      e.preventDefault()
      setTool(hit)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  if (!d) return null
  const cellAt = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: Math.floor(((e.clientX - r.left) / r.width) * d.width), y: Math.floor(((e.clientY - r.top) / r.height) * d.height) }
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

  /** One cell painted (or erased: the picture tile of this layer first, then the plan tile). */
  const paintAt = (cur: Draft, p: { x: number; y: number }): Draft => {
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
    const first = { ...start, unblock: tool === 'block' && (!!d.blocked?.[cellKey(p.x, p.y)] || e.button === 2) }
    last.current = p
    setDrag({ x: p.x, y: p.y, ...(tool === 'room' ? first : paintAt(first, p)) })
  }
  const onMove = (e: React.MouseEvent) => {
    const p = cellAt(e)
    setHover(inside(p) ? p : null)
    if (!drag || !inside(p)) return
    if (tool === 'room') return setDrag({ ...drag, tiles: room(d, drag.x, drag.y, p.x, p.y) })
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
  }

  // ---- Tilesets (shared library) ----
  const changeSet = (id: string, patch: Partial<Tileset>) => lib.update((x) => ({ ...x, tilesets: x.tilesets.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  /** Pick a picture (a drawing from Draw works too) and open the import window for it. */
  const pickPicture = async (set?: Tileset) => {
    if (!root) return
    const [asset] = await pickAndImportAssets(root, 'image', set ? `New picture for ${set.name}` : 'Tileset image')
    if (!asset) return
    const initial = set ? { name: set.name, tileSize: set.tileSize, margin: set.margin ?? 0, spacing: set.spacing ?? 0, blackTransparent: !!set.blackTransparent } : { name: asset.name.replace(/\.[^.]+$/, '') }
    setImporting({ image: asset.path, set, title: set ? `Replace ${set.name}` : 'Add a tileset', initial })
  }
  const editGrid = (set: Tileset) => {
    setImporting({ image: set.image, set, title: `Grid of ${set.name}`, initial: { name: set.name, tileSize: set.tileSize, margin: set.margin ?? 0, spacing: set.spacing ?? 0, blackTransparent: !!set.blackTransparent } })
  }
  const finishImport = (v: ImportValues & { width: number; height: number }) => {
    if (!importing) return
    const g = grid(v)
    const fields = { name: v.name, image: importing.image, tileSize: v.tileSize, margin: v.margin || undefined, spacing: v.spacing || undefined, blackTransparent: v.blackTransparent || undefined, width: v.width, height: v.height, columns: g.columns, rows: g.rows }
    if (importing.set) changeSet(importing.set.id, fields)
    else {
      const t: Tileset = { id: newId(), added: Date.now(), ...fields }
      lib.update((x) => ({ ...x, tilesets: [...x.tilesets, t] }))
      setStamp({ set: t.id, col: 0, row: 0, w: 1, h: 1 })
    }
    setImporting(null)
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
    { id: 'room', icon: Square, label: 'Room (drag)' },
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
        <label className="ld-inline">
          Zoom
          <input type="range" min={0.5} max={4} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
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
            style={{ width: d.width * css, height: d.height * css }}
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
        onStamp={(s) => (setStamp(s), tool === 'erase' || tool === 'note' || tool === 'room' || tool === 'block' ? setTool('paint') : null)}
        change={changeSet}
        onAdd={() => void pickPicture()}
        onReplace={(t) => void pickPicture(t)}
        onGrid={editGrid}
        onRemove={(t) => void removeSet(t)}
      />
      {importing && <ImportDialog image={importing.image} title={importing.title} initial={importing.initial} onDone={finishImport} onClose={() => setImporting(null)} />}
    </div>
  )
}
