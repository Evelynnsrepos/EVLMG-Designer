import { ChevronDown, ChevronRight, Grid2x2, Grid3x3, ImagePlus, PanelBottom, PictureInPicture2, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { postIntent } from '@/core/state'
import { openComponent } from '@/shell/editor/actions'
import type { TileImage } from './images'
import { tileRect, type Stamp, type Tileset } from './model'

const COLORS: (string | undefined)[] = [undefined, '#e03131', '#f08c00', '#f5b301', '#2f9e44', '#0c8599', '#1971c2', '#7048e8', '#c2255c']

interface Props {
  sets: Tileset[]
  images: Record<string, TileImage>
  stamp: Stamp | null
  onStamp(s: Stamp): void
  change(id: string, patch: Partial<Tileset>): void
  onAdd(): void
  onReplace(t: Tileset): void
  onGrid(t: Tileset): void
  onRemove(t: Tileset): void
}

/**
 * v0.15: the tilesets at the bottom of Level Layout, like Godot's TileSet panel: the library on the left
 * (search, sort, folders, colours) and the picked tileset's picture on the right, where a drag picks a
 * block of tiles to paint as a stamp. It can float over the level instead ("pop out").
 */
export function TilesetDock(p: Props) {
  const [floating, setFloating] = useState(false)
  const [pos, setPos] = useState({ x: 60, y: 80 })
  const [height, setHeight] = useState(260)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'name' | 'added'>('name')
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const current = p.sets.find((t) => t.id === openId) ?? p.sets.find((t) => t.id === p.stamp?.set) ?? p.sets[0]

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = p.sets
      .filter((t) => !q || t.name.toLowerCase().includes(q) || t.folder?.toLowerCase().includes(q))
      .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (b.added ?? 0) - (a.added ?? 0)))
    const out = new Map<string, Tileset[]>()
    for (const t of list) out.set(t.folder ?? '', [...(out.get(t.folder ?? '') ?? []), t])
    return [...out].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
  }, [p.sets, query, sort])
  const folders = [...new Set(p.sets.map((t) => t.folder).filter(Boolean))] as string[]

  /** Drag the floating window by its header. */
  const move = (e: React.PointerEvent) => {
    if (!floating || (e.target as HTMLElement).closest('button, input, select')) return
    const start = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    const onMove = (ev: PointerEvent) => setPos({ x: Math.max(0, ev.clientX - start.x), y: Math.max(0, ev.clientY - start.y) })
    const onUp = () => (window.removeEventListener('pointermove', onMove), window.removeEventListener('pointerup', onUp))
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  /** Drag the top edge of the docked panel to make it taller or shorter. */
  const resize = (e: React.PointerEvent) => {
    const start = { y: e.clientY, h: height }
    const onMove = (ev: PointerEvent) => setHeight(Math.max(120, Math.min(window.innerHeight - 200, start.h + start.y - ev.clientY)))
    const onUp = () => (window.removeEventListener('pointermove', onMove), window.removeEventListener('pointerup', onUp))
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <section className={`lv-dock${floating ? ' floating' : ''}`} style={floating ? { left: pos.x, top: pos.y } : { height }} aria-label="Tilesets">
      {!floating && <div className="lv-dock-grip" onPointerDown={resize} title="Drag to resize" />}
      <header className="lv-dock-head" onPointerDown={move}>
        <strong>Tilesets</strong>
        <span className="lv-dock-search">
          <Search size={13} />
          <input className="input" placeholder="Search tilesets" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as 'name' | 'added')} title="Sort">
          <option value="name">A–Z</option>
          <option value="added">Newest first</option>
        </select>
        <button className="btn btn-ghost lv-btn" onClick={p.onAdd}>
          <ImagePlus size={14} /> Add
        </button>
        <button className="icon-btn" title={floating ? 'Dock at the bottom' : 'Pop out (float over the level)'} onClick={() => setFloating(!floating)}>
          {floating ? <PanelBottom size={15} /> : <PictureInPicture2 size={15} />}
        </button>
      </header>
      <div className="lv-dock-body">
        <nav className="lv-dock-list">
          {p.sets.length === 0 && <p className="muted">Add a tileset picture to paint with its tiles. Every level in this project can use it.</p>}
          {groups.map(([folder, list]) => (
            <div key={folder}>
              {folder && (
                <button className="lv-folder" onClick={() => setClosed((c) => ({ ...c, [folder]: !c[folder] }))}>
                  {closed[folder] ? <ChevronRight size={13} /> : <ChevronDown size={13} />} {folder}
                </button>
              )}
              {!closed[folder] &&
                list.map((t) => (
                  <button key={t.id} className={`lv-set-item${t.id === current?.id ? ' on' : ''}${folder ? ' nested' : ''}`} onClick={() => setOpenId(t.id)}>
                    <span className="lv-dot" style={{ background: t.color ?? 'var(--border)' }} />
                    <span className="lv-set-name">{t.name}</span>
                  </button>
                ))}
            </div>
          ))}
        </nav>
        {current && (
          <div className="lv-dock-main">
            <div className="lv-dock-tools">
              <input className="input lv-name" aria-label="Tileset name" value={current.name} onChange={(e) => p.change(current.id, { name: e.target.value })} />
              <input className="input lv-folder-input" list="lv-folders" placeholder="Folder" aria-label="Folder" value={current.folder ?? ''} onChange={(e) => p.change(current.id, { folder: e.target.value || undefined })} />
              <datalist id="lv-folders">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
              <span className="lv-colors">
                {COLORS.map((c) => (
                  <button key={c ?? 'none'} className={`lv-color${current.color === c ? ' on' : ''}`} style={{ background: c ?? 'transparent' }} title={c ? 'Colour' : 'No colour'} onClick={() => p.change(current.id, { color: c })} />
                ))}
              </span>
              <label className="sketch-check" title="Pure black pixels become see-through, for pictures drawn on a black background">
                <input type="checkbox" checked={!!current.blackTransparent} onChange={(e) => p.change(current.id, { blackTransparent: e.target.checked || undefined })} /> Black is see-through
              </label>
              <button className="btn btn-ghost lv-btn" title="Tile size, margin and spacing" onClick={() => p.onGrid(current)}>
                <Grid3x3 size={14} /> Grid
              </button>
              <button className="btn btn-ghost lv-btn" title="Swap in a new version of the picture; names, blocking tiles and painted levels stay" onClick={() => p.onReplace(current)}>
                <RefreshCw size={14} /> Replace
              </button>
              <button className="btn btn-ghost lv-btn" title="Open this tileset in Pixel Art to draw its tiles; changes come back here" onClick={() => (postIntent('pixel-art', { action: 'edit-tileset', id: current.id }), openComponent('pixel-art'))}>
                <Grid2x2 size={14} /> Edit in Pixel Art
              </button>
              <button className="icon-btn" title="Remove this tileset from the project" onClick={() => p.onRemove(current)}>
                <Trash2 size={14} />
              </button>
            </div>
            {p.stamp?.set === current.id && <SolidCheck set={current} stamp={p.stamp} change={p.change} />}
            <Atlas key={current.id} set={current} image={p.images[current.id]} stamp={p.stamp?.set === current.id ? p.stamp : null} onStamp={p.onStamp} />
          </div>
        )}
      </div>
    </section>
  )
}

/** v0.14: the picked tiles block movement (fences, walls), for Godot's collision. */
function SolidCheck({ set, stamp, change }: { set: Tileset; stamp: Stamp; change: Props['change'] }) {
  const ids: string[] = []
  for (let r = stamp.row; r < stamp.row + stamp.h; r++) for (let c = stamp.col; c < stamp.col + stamp.w; c++) ids.push(`${c}:${r}`)
  const on = ids.every((id) => set.solid?.includes(id))
  return (
    <label className="sketch-check lv-solid">
      <input type="checkbox" checked={on} onChange={(e) => change(set.id, { solid: e.target.checked ? [...new Set([...(set.solid ?? []), ...ids])] : (set.solid ?? []).filter((v) => !ids.includes(v)) })} />
      {ids.length > 1 ? 'These tiles block movement' : 'This tile blocks movement'} (fences, walls, houses)
    </label>
  )
}

/** The tileset picture with its grid; click a tile, or drag over several to paint them as one stamp. */
function Atlas({ set, image, stamp, onStamp }: { set: Tileset; image?: TileImage; stamp: Stamp | null; onStamp(s: Stamp): void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState(() => Math.max(1, Math.min(4, Math.floor(48 / set.tileSize) || 1)))
  const [drag, setDrag] = useState<{ col: number; row: number } | null>(null)

  useEffect(() => {
    const c = canvas.current
    if (!c || !image) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(set.width * zoom * dpr)
    c.height = Math.round(set.height * zoom * dpr)
    c.style.width = `${set.width * zoom}px`
    c.style.height = `${set.height * zoom}px`
    const g = c.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.setTransform(zoom * dpr, 0, 0, zoom * dpr, 0, 0)
    g.drawImage(image, 0, 0)
    g.lineWidth = 1 / (zoom * dpr)
    for (let row = 0; row < set.rows; row++)
      for (let col = 0; col < set.columns; col++) {
        const r = tileRect(set, col, row)
        g.strokeStyle = 'rgba(255, 255, 255, 0.18)'
        g.strokeRect(r.x, r.y, r.size, r.size)
        if (set.solid?.includes(`${col}:${row}`)) {
          g.fillStyle = 'rgba(224, 49, 49, 0.25)'
          g.fillRect(r.x, r.y, r.size, r.size)
        }
      }
    if (stamp) {
      const a = tileRect(set, stamp.col, stamp.row)
      const b = tileRect(set, stamp.col + stamp.w - 1, stamp.row + stamp.h - 1)
      g.lineWidth = 2 / zoom
      g.strokeStyle = '#4dabf7'
      g.strokeRect(a.x, a.y, b.x + b.size - a.x, b.y + b.size - a.y)
    }
  }, [set, image, zoom, stamp])

  const tileAt = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * set.width - (set.margin ?? 0)
    const py = ((e.clientY - r.top) / r.height) * set.height - (set.margin ?? 0)
    const step = set.tileSize + (set.spacing ?? 0)
    return { col: Math.max(0, Math.min(set.columns - 1, Math.floor(px / step))), row: Math.max(0, Math.min(set.rows - 1, Math.floor(py / step))) }
  }
  const pick = (a: { col: number; row: number }, b: { col: number; row: number }) =>
    onStamp({ set: set.id, col: Math.min(a.col, b.col), row: Math.min(a.row, b.row), w: Math.abs(a.col - b.col) + 1, h: Math.abs(a.row - b.row) + 1 })

  return (
    <div className="lv-atlas-wrap">
      <div className="lv-atlas-scroll">
        {image ? (
          <canvas
            ref={canvas}
            className="lv-atlas"
            onPointerDown={(e) => {
              const t = tileAt(e)
              e.currentTarget.setPointerCapture(e.pointerId)
              setDrag(t)
              pick(t, t)
            }}
            onPointerMove={(e) => drag && pick(drag, tileAt(e))}
            onPointerUp={() => setDrag(null)}
          />
        ) : (
          <p className="muted">Loading the picture…</p>
        )}
      </div>
      <label className="ld-inline lv-atlas-zoom" title="Zoom">
        <input type="range" min={1} max={8} step={1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> {zoom}×
      </label>
    </div>
  )
}
