import { Plus, Scissors, Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { newId } from '@/core/model'
import { drawTile } from '@/shared/tileset'
import type { TileImage } from './images'
import { tileRect, type Tileset } from './model'
import type { ScatterPiece, ScatterSet } from './scatter'

interface Props {
  sets: ScatterSet[]
  current?: ScatterSet
  tilesets: Tileset[]
  images: Record<string, TileImage>
  onPick(id: string): void
  onAdd(): void
  onRemove(set: ScatterSet): void
  change(id: string, patch: Partial<ScatterSet>): void
}

/** 0.23.4: the Scatter tool's sets, their details and how strongly they spread. Shown on the right while Scatter is picked. */
export function ScatterPanel({ sets, current, tilesets, images, onPick, onAdd, onRemove, change }: Props) {
  const set = current
  const pieces = (fn: (p: ScatterPiece[]) => ScatterPiece[]) => set && change(set.id, { pieces: fn(set.pieces) })
  /** A group back into its single tiles, each as often as the group was. */
  const split = (p: ScatterPiece) =>
    pieces((ps) =>
      ps.flatMap((q) => {
        if (q.id !== p.id) return [q]
        const out: ScatterPiece[] = []
        for (let r = 0; r < p.h; r++) for (let c = 0; c < p.w; c++) out.push({ id: newId(), set: p.set, col: p.col + c, row: p.row + r, w: 1, h: 1, weight: p.weight })
        return out
      }),
    )
  return (
    <div className="lv-scatter">
      <strong>
        Scatter
        <button className="icon-btn" title="New scatter set" aria-label="New scatter set" onClick={onAdd}>
          <Plus size={14} />
        </button>
      </strong>
      {sets.length > 0 && (
        <div className="lv-scatter-set">
          <select className="input" aria-label="Scatter set" value={set?.id} onChange={(e) => onPick(e.target.value)}>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {set && (
            <button className="icon-btn" title="Delete this scatter set" aria-label="Delete scatter set" onClick={() => onRemove(set)}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}
      {set && <input className="input" aria-label="Scatter set name" value={set.name} onChange={(e) => change(set.id, { name: e.target.value })} />}
      <p className="muted lv-layers-hint">
        {set?.pieces.length ? 'Add more: ' : 'Add details: '}click a tile in the tileset panel below, or drag over several to add them as one group that always goes down whole.
      </p>
      {set?.pieces.map((p) => (
        <div key={p.id} className="lv-piece">
          <Thumb piece={p} set={tilesets.find((t) => t.id === p.set)} image={images[p.set]} />
          <label className="lv-piece-weight" title="How often this detail shows up compared to the others">
            {p.w * p.h > 1 ? `${p.w} × ${p.h} group` : 'Tile'}
            <input type="range" min={1} max={10} step={1} value={p.weight} onChange={(e) => pieces((ps) => ps.map((q) => (q.id === p.id ? { ...q, weight: Number(e.target.value) } : q)))} />
          </label>
          {p.w * p.h > 1 && (
            <button className="icon-btn" title="Split into single tiles" aria-label="Split group" onClick={() => split(p)}>
              <Scissors size={12} />
            </button>
          )}
          <button className="icon-btn" title="Take this detail out of the set" aria-label="Remove detail" onClick={() => pieces((ps) => ps.filter((q) => q.id !== p.id))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {set && (
        <div className="lv-scatter-controls">
          <label title="How much of the area gets a detail">
            Amount <span>{set.amount} %</span>
            <input type="range" min={0} max={100} step={1} value={set.amount} onChange={(e) => change(set.id, { amount: Number(e.target.value) })} />
          </label>
          <label title="The smallest gap between two details, in cells">
            Spacing <span>{set.spacing}</span>
            <input type="range" min={0} max={5} step={1} value={set.spacing} onChange={(e) => change(set.id, { spacing: Number(e.target.value) })} />
          </label>
          <label title="Even spreads the details out; Patches gathers them in little groups">
            Clumping <span>{set.clump ? `${set.clump} %` : 'even'}</span>
            <input type="range" min={0} max={100} step={5} value={set.clump} onChange={(e) => change(set.id, { clump: Number(e.target.value) })} />
          </label>
          <label title="Where details may go, looking at the layers below the picked one">
            Only on
            <select className="input" value={set.onlyOn} onChange={(e) => change(set.id, { onlyOn: e.target.value as ScatterSet['onlyOn'] })}>
              <option value="anywhere">Anywhere</option>
              <option value="tiles">Tiles on a layer below</option>
              <option value="start">The tile you start on</option>
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

/** A detail's tiles, small. */
function Thumb({ piece, set, image }: { piece: ScatterPiece; set?: Tileset; image?: TileImage }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    if (!c || !set || !image) return
    const g = c.getContext('2d')!
    const cell = Math.floor(32 / Math.max(piece.w, piece.h))
    c.width = cell * piece.w
    c.height = cell * piece.h
    g.imageSmoothingEnabled = false
    for (let r = 0; r < piece.h; r++)
      for (let col = 0; col < piece.w; col++) {
        const t = tileRect(set, piece.col + col, piece.row + r)
        drawTile(g, image, t.x, t.y, t.size, col * cell, r * cell, cell, 0, t.h, cell)
      }
  }, [piece, set, image])
  return <canvas ref={canvas} className="lv-piece-thumb sharp" width={32} height={32} />
}
