import { Brush, Download, Eraser, ImagePlus, PaintBucket, Square, StickyNote, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { assetUrl, pickAndImportAssets, resolveAssetPath, useAssetUrls } from '@/core/assets'
import { getFs } from '@/core/fs'
import { newId } from '@/core/model'
import { NumberInput, PresetHeader } from '@/shared/calculators'
import { artKey, bucket, cellKey, counts, createLevelDoc, godotScene, MARKERS, newNote, parseArt, room, tileColor, TILES, type LevelDoc, type TileId, type Tileset } from './model'
import './level-layout.css'

type Tool = 'paint' | 'erase' | 'room' | 'fill' | 'note'
const CELL = 22

/** Level / dungeon layout editor (v0.10). */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<LevelDoc>('level-layout', documentId!, createLevelDoc)
  useUndoRedoKeys(doc, active)
  const title = useProjectStore((s) => s.meta?.documents.find((x) => x.id === documentId)?.title ?? 'Level')
  const [tool, setTool] = useState<Tool>('paint')
  const [tile, setTile] = useState<TileId>('wall')
  // v0.13: a picture tile from a tileset ("set:column:row"); null = paint plan tiles.
  const [art, setArt] = useState<string | null>(null)
  const root = useProjectStore((s) => s.root)
  const [exported, setExported] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [drag, setDrag] = useState<{ x: number; y: number; tiles: Record<string, TileId>; art: Record<string, string> } | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [noteId, setNoteId] = useState<string | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const d = doc.data
  const shown = useMemo(() => (drag && d ? { ...d, tiles: drag.tiles, art: drag.art } : d), [drag, d])
  const sets = useMemo(() => d?.tilesets ?? [], [d?.tilesets])
  const urlOf = useAssetUrls(sets.map((t) => t.image))
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({})
  useEffect(() => {
    for (const t of sets) {
      const url = urlOf(t.image)
      if (!url || images[url]) continue
      const img = new Image()
      img.onload = () => setImages((m) => ({ ...m, [url]: img }))
      img.src = url
    }
  }, [sets, urlOf, images])

  useEffect(() => {
    const c = canvas.current
    if (!c || !shown) return
    const ctx = c.getContext('2d')!
    const s = CELL
    c.width = shown.width * s
    c.height = shown.height * s
    ctx.fillStyle = '#1b1b20'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.imageSmoothingEnabled = false
    const artAt = shown.art ?? {}
    for (const [k, v] of Object.entries(artAt)) {
      const [x, y] = k.split(',').map(Number)
      const a = parseArt(v)
      const t = sets[a.set]
      const img = t && images[urlOf(t.image)]
      if (img) ctx.drawImage(img, a.col * t.tileSize, a.row * t.tileSize, t.tileSize, t.tileSize, x * s, y * s, s, s)
    }
    for (const [k, t] of Object.entries(shown.tiles)) {
      const [x, y] = k.split(',').map(Number)
      const mark = MARKERS[t]
      // A symbol (start, enemy…) sits on its picture tile, or on floor when there is none.
      if (!mark || !artAt[k]) {
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
    for (let x = 0; x <= shown.width; x++) {
      ctx.beginPath()
      ctx.moveTo(x * s + 0.5, 0)
      ctx.lineTo(x * s + 0.5, c.height)
      ctx.stroke()
    }
    for (let y = 0; y <= shown.height; y++) {
      ctx.beginPath()
      ctx.moveTo(0, y * s + 0.5)
      ctx.lineTo(c.width, y * s + 0.5)
      ctx.stroke()
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
  }, [shown, sets, images, urlOf])

  if (!d) return null
  const cellAt = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: Math.floor(((e.clientX - r.left) / r.width) * d.width), y: Math.floor(((e.clientY - r.top) / r.height) * d.height) }
  }
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x < d.width && p.y < d.height
  const apply = (tiles: Record<string, TileId>, artMap = d.art ?? {}) => doc.update((x) => ({ ...x, tiles, art: artMap }))
  /** One cell painted (or erased: the picture tile first, then the plan tile). */
  const paintAt = (cur: { tiles: Record<string, TileId>; art: Record<string, string> }, p: { x: number; y: number }) => {
    const k = cellKey(p.x, p.y)
    const tiles = { ...cur.tiles }
    const artMap = { ...cur.art }
    if (tool === 'erase') {
      if (artMap[k]) delete artMap[k]
      else delete tiles[k]
    } else if (art) artMap[k] = art
    else tiles[k] = tile
    return { tiles, art: artMap }
  }

  const onDown = (e: React.MouseEvent) => {
    const p = cellAt(e)
    if (!inside(p)) return
    if (tool === 'fill') {
      if (art) return apply(d.tiles, bucket({ ...d, tiles: d.art ?? {} }, p.x, p.y, e.button === 2 ? null : art))
      return apply(bucket(d, p.x, p.y, e.button === 2 ? null : tile))
    }
    if (tool === 'note') {
      const hit = d.notes.find((n) => n.x === p.x && n.y === p.y)
      if (hit) return setNoteId(hit.id)
      const n = newNote(p.x, p.y)
      doc.update((x) => ({ ...x, notes: [...x.notes, n] }))
      return setNoteId(n.id)
    }
    const start = { tiles: d.tiles, art: d.art ?? {} }
    setDrag({ x: p.x, y: p.y, ...(tool === 'room' ? start : paintAt(start, p)) })
  }
  const onMove = (e: React.MouseEvent) => {
    const p = cellAt(e)
    setHover(inside(p) ? p : null)
    if (!drag || !inside(p)) return
    if (tool === 'room') setDrag({ ...drag, tiles: room(d, drag.x, drag.y, p.x, p.y) })
    else setDrag({ ...drag, ...paintAt(drag, p) })
  }
  const onUp = () => {
    if (drag) apply(drag.tiles, drag.art)
    setDrag(null)
  }

  /** Add a tileset image (a drawing from Draw works too); it is cut into tiles of `tileSize`. */
  const addTileset = async () => {
    if (!root) return
    const [asset] = await pickAndImportAssets(root, 'image', 'Tileset image')
    if (!asset) return
    const url = await assetUrl(root, asset.path)
    const size = await new Promise<{ w: number; h: number }>((res) => {
      const img = new Image()
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => res({ w: 0, h: 0 })
      img.src = url ?? ''
    })
    const tileSize = size.w % 16 === 0 && size.h % 16 === 0 ? 16 : 32
    const t: Tileset = { id: newId(), name: asset.name.replace(/\.[^.]+$/, ''), image: asset.path, tileSize, width: size.w, height: size.h, columns: Math.max(1, Math.floor(size.w / tileSize)), rows: Math.max(1, Math.floor(size.h / tileSize)) }
    doc.update((x) => ({ ...x, tilesets: [...(x.tilesets ?? []), t] }))
  }
  const setTileSize = (i: number, tileSize: number) =>
    doc.update((x) => ({ ...x, tilesets: (x.tilesets ?? []).map((t, j) => (j === i ? { ...t, tileSize, columns: Math.max(1, Math.floor(t.width / tileSize)), rows: Math.max(1, Math.floor(t.height / tileSize)) } : t)) }))
  const removeTileset = (i: number) =>
    doc.update((x) => ({
      ...x,
      tilesets: (x.tilesets ?? []).filter((_, j) => j !== i),
      // Picture tiles of later tilesets move down one number; those of the removed one go.
      art: Object.fromEntries(
        Object.entries(x.art ?? {})
          .map(([k, v]) => [k, parseArt(v)] as const)
          .filter(([, a]) => a.set !== i)
          .map(([k, a]) => [k, artKey(a.set > i ? a.set - 1 : a.set, a.col, a.row)]),
      ),
    }))

  /** v0.13: the level as a Godot 4 TileMap scene, with its tileset pictures, into the game project. */
  const exportGodot = async () => {
    const fs = getFs()
    const folder = await fs.pickFolder('Choose your Godot project folder')
    if (!folder || !root) return
    const base = safeFileName(title).replace(/\s+/g, '_').toLowerCase() || 'level'
    const dir = await fs.join(folder, 'egd', 'levels')
    await fs.mkdir(dir)
    for (const [i, t] of sets.entries()) await fs.writeBinaryAtomic(await fs.join(dir, `${base}_tiles_${i}.png`), await fs.readBinary(await resolveAssetPath(root, t.image)))
    const scene = godotScene(d, title, (i) => `res://egd/levels/${base}_tiles_${i}.png`)
    await fs.writeBinaryAtomic(await fs.join(dir, `${base}.tscn`), new TextEncoder().encode(scene))
    setExported(`Saved egd/levels/${base}.tscn in your Godot project.`)
  }
  const exportPng = async () => {
    const blob = await new Promise<Blob | null>((res) => canvas.current!.toBlob(res, 'image/png'))
    if (blob) await saveBinaryFile({ title: 'Export level as PNG', defaultName: `${safeFileName(title)}.png`, bytes: new Uint8Array(await blob.arrayBuffer()), filter: { name: 'PNG image', extensions: ['png'] } })
  }

  const note = d.notes.find((n) => n.id === noteId)
  const tally = counts(d)
  const tools: { id: Tool; icon: typeof Brush; label: string }[] = [
    { id: 'paint', icon: Brush, label: 'Paint' },
    { id: 'room', icon: Square, label: 'Room (drag)' },
    { id: 'fill', icon: PaintBucket, label: 'Fill' },
    { id: 'erase', icon: Eraser, label: 'Erase' },
    { id: 'note', icon: StickyNote, label: 'Note' },
  ]

  return (
    <div className="lv">
      <div className="lv-head">
        <PresetHeader documentId={documentId!} kind="Level" undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
      </div>
      <div className="lv-toolbar">
        {tools.map((t) => (
          <button key={t.id} className={`icon-btn${tool === t.id ? ' on' : ''}`} title={t.label} aria-label={t.label} onClick={() => setTool(t.id)}>
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
          <input type="range" min={0.5} max={2.5} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
        <button className="btn btn-ghost lv-btn" onClick={() => void exportPng()}>
          <Download size={14} /> PNG
        </button>
        <button className="btn btn-ghost lv-btn" disabled={!sets.length} title={sets.length ? 'Export the picture tiles as a Godot 4 TileMap scene' : 'Add a tileset and paint with it first'} onClick={() => void exportGodot()}>
          <Download size={14} /> Godot scene
        </button>
        {exported && <span className="muted">{exported}</span>}
        <span className="lv-hover">{hover ? `${hover.x}, ${hover.y}` : ''}</span>
      </div>
      <div className="lv-body">
        <div className="lv-palette">
          {TILES.map((t) => (
            <button key={t.id} className={`lv-tile${!art && tile === t.id ? ' on' : ''}`} onClick={() => (setTile(t.id), setArt(null), tool === 'erase' || tool === 'note' ? setTool('paint') : null)}>
              <span style={{ background: t.color }}>{MARKERS[t.id]}</span>
              {t.label}
              {tally[t.id] ? <em>{tally[t.id]}</em> : null}
            </button>
          ))}
          <strong className="lv-sets-title">Tilesets</strong>
          {sets.map((t, i) => (
            <div key={t.id} className="lv-set">
              <div className="lv-set-head">
                <span title={t.name}>{t.name}</span>
                <label className="ld-inline" title="Size of one tile in the picture, in pixels">
                  <NumberInput value={t.tileSize} min={4} max={512} onChange={(v) => setTileSize(i, Math.max(4, Math.round(v)))} />
                  px
                </label>
                <button className="icon-btn" aria-label={`Remove ${t.name}`} title="Remove tileset" onClick={() => removeTileset(i)}>
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="lv-atlas" style={{ gridTemplateColumns: `repeat(${t.columns}, 1fr)` }}>
                {Array.from({ length: t.columns * t.rows }, (_, n) => {
                  const col = n % t.columns
                  const row = Math.floor(n / t.columns)
                  const key = artKey(i, col, row)
                  return (
                    <button
                      key={key}
                      className={`lv-atlas-tile${art === key ? ' on' : ''}`}
                      aria-label={`Tile ${col}, ${row}`}
                      style={{ backgroundImage: `url("${urlOf(t.image)}")`, backgroundSize: `${t.columns * 100}% ${t.rows * 100}%`, backgroundPosition: `${t.columns > 1 ? (col / (t.columns - 1)) * 100 : 0}% ${t.rows > 1 ? (row / (t.rows - 1)) * 100 : 0}%` }}
                      onClick={() => (setArt(key), tool === 'erase' || tool === 'note' || tool === 'room' ? setTool('paint') : null)}
                    />
                  )
                })}
              </div>
            </div>
          ))}
          <button className="btn btn-ghost" onClick={() => void addTileset()}>
            <ImagePlus size={14} /> Add a tileset image
          </button>
        </div>
        <div className="lv-canvas">
          <canvas
            ref={canvas}
            style={{ width: d.width * CELL * zoom, height: d.height * CELL * zoom }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={() => (onUp(), setHover(null))}
            onContextMenu={(e) => e.preventDefault()}
          />
        </div>
        <aside className="lv-notes">
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
    </div>
  )
}
