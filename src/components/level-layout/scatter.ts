import { newId, type Id } from '@/core/model'
import { artKey, cellKey, parseArt, type Stamp, type TileLibrary } from './model'

/** 0.23.4: one detail a scatter set puts down: a single tile, or a group of tiles that always goes down whole. */
export interface ScatterPiece extends Stamp {
  id: Id
  /** How often it shows up compared to the set's other details, 1–10. */
  weight: number
}

/** 0.23.4: details spread at random, like Godot's scattering: rocks in a field, different stones in a path. */
export interface ScatterSet {
  id: Id
  name: string
  pieces: ScatterPiece[]
  /** Percent of the area's cells that start a detail. */
  amount: number
  /** Empty cells kept between two details. */
  spacing: number
  /** 0 spreads evenly, 100 gathers the details in patches. */
  clump: number
  /** Anywhere; only over a tile on a layer below; or only over the same tile as where the stroke starts. */
  onlyOn: 'anywhere' | 'tiles' | 'start'
}

/** The shared tile library also keeps the scatter sets, so every level can use them. */
export type LevelLibrary = TileLibrary & { scatter?: ScatterSet[] }

export const newScatterSet = (name: string): ScatterSet => ({ id: newId(), name, pieces: [], amount: 15, spacing: 1, clump: 0, onlyOn: 'anywhere' })

/** A number in [0, 1) that depends only on the seed and the cell, so the same seed always scatters the same way. */
export function hash01(seed: number, x: number, y: number, salt = 0): number {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32
}

/** Smooth noise with patches about five cells across, for clumping. */
function patches(seed: number, x: number, y: number): number {
  const S = 5
  const gx = Math.floor(x / S)
  const gy = Math.floor(y / S)
  const sm = (t: number) => t * t * (3 - 2 * t)
  const fx = sm(x / S - gx)
  const fy = sm(y / S - gy)
  const v = (i: number, j: number) => hash01(seed, i, j, 7)
  const top = v(gx, gy) + (v(gx + 1, gy) - v(gx, gy)) * fx
  const bottom = v(gx, gy + 1) + (v(gx + 1, gy + 1) - v(gx, gy + 1)) * fx
  return top + (bottom - top) * fy
}

export interface ScatterInput {
  set: ScatterSet
  /** The layer's picture tiles before scattering. */
  art: Record<string, string>
  /** The area, in the order it was painted. */
  cells: [number, number][]
  seed: number
  size: { width: number; height: number }
  /** False where no detail may go (blocked cells, "Only on"). */
  allowed(x: number, y: number): boolean
}

/**
 * The layer with the set's details spread over the area. A detail only goes where all its cells are inside the
 * area and the level, allowed, empty on this layer and at least `spacing` cells away from any other tile on it.
 */
export function scatter(i: ScatterInput): Record<string, string> {
  const art = { ...i.art }
  const pieces = i.set.pieces.filter((p) => p.weight > 0)
  const total = pieces.reduce((n, p) => n + p.weight, 0)
  if (!total) return art
  const area = new Set(i.cells.map(([x, y]) => cellKey(x, y)))
  const amount = i.set.amount / 100
  const clump = i.set.clump / 100
  const gap = Math.max(0, Math.round(i.set.spacing))
  const free = (x: number, y: number, w: number, h: number) => {
    for (let cy = y; cy < y + h; cy++)
      for (let cx = x; cx < x + w; cx++) if (cx >= i.size.width || cy >= i.size.height || !area.has(cellKey(cx, cy)) || !i.allowed(cx, cy)) return false
    for (let cy = y - gap; cy < y + h + gap; cy++) for (let cx = x - gap; cx < x + w + gap; cx++) if (art[cellKey(cx, cy)]) return false
    return true
  }
  for (const [x, y] of i.cells) {
    // Clumped: the chance doubles on the noise's high spots and drops to nothing on its low ones.
    const t = Math.max(0, Math.min(1, (patches(i.seed, x, y) - 0.3) / 0.4))
    const chance = amount * (1 - clump + clump * 2 * t * t * (3 - 2 * t))
    if (hash01(i.seed, x, y, 1) >= chance) continue
    let r = hash01(i.seed, x, y, 2) * total
    const p = pieces.find((q) => (r -= q.weight) < 0) ?? pieces[pieces.length - 1]
    if (!free(x, y, p.w, p.h)) continue
    for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) art[cellKey(x + dx, y + dy)] = artKey(p.set, p.col + dx, p.row + dy)
  }
  return art
}

/** The layer with the set's details taken out of these cells (right-click with Scatter); other tiles stay. */
export function unscatter(art: Record<string, string>, cells: [number, number][], set: ScatterSet): Record<string, string> {
  const out = { ...art }
  for (const [x, y] of cells) {
    const k = cellKey(x, y)
    if (!out[k]) continue
    const a = parseArt(out[k])
    if (set.pieces.some((p) => p.set === a.set && a.col >= p.col && a.col < p.col + p.w && a.row >= p.row && a.row < p.row + p.h)) delete out[k]
  }
  return out
}
