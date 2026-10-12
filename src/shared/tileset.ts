import type { Id } from '@/core/model'

/**
 * Tilesets (v0.13), kept in one library per project (v0.15) that Level Layout and Pixel Art share:
 * a picture cut into square tiles, like a Godot TileSet. Stored as the Level Layout document `tilesets`.
 */

export interface Tileset {
  id: Id
  name: string
  image: string
  /** Size of one tile in the image, in pixels. */
  tileSize: number
  columns: number
  rows: number
  /** The image's size in pixels, to work out columns and rows when the tile size changes. */
  width: number
  height: number
  /** v0.14: tiles that block movement (fences, house walls), as "column:row". */
  solid?: string[]
  /** v0.15: empty pixels before the first tile (top and left) and between tiles. */
  margin?: number
  spacing?: number
  /** v0.15: pure black pixels are see-through (for tilesets drawn on a black background). */
  blackTransparent?: boolean
  /** v0.15: sorting the library. */
  folder?: string
  color?: string
  added?: number
}

/** v0.15: the tilesets of every level in the project, so a new level tab can use them right away. */
export interface TileLibrary {
  tilesets: Tileset[]
}
export const LIBRARY_ID = 'tilesets'
export const createLibrary = (): TileLibrary => ({ tilesets: [] })

/** Columns and rows that fit in the image with this tile size, margin and spacing. */
export function grid(t: Pick<Tileset, 'width' | 'height' | 'tileSize' | 'margin' | 'spacing'>) {
  const m = t.margin ?? 0
  const s = t.spacing ?? 0
  const fit = (size: number) => Math.max(1, Math.floor((size - m + s) / (t.tileSize + s)))
  const columns = fit(t.width)
  const rows = fit(t.height)
  // Pixels left over on the right and bottom: a sign of a wrong tile size.
  const rest = (size: number, n: number) => size - m - n * t.tileSize - (n - 1) * s
  return { columns, rows, restX: rest(t.width, columns), restY: rest(t.height, rows) }
}

/** Where tile column,row lies in the image. */
export const tileRect = (t: Tileset, col: number, row: number) => {
  const m = t.margin ?? 0
  const s = t.spacing ?? 0
  return { x: m + col * (t.tileSize + s), y: m + row * (t.tileSize + s), size: t.tileSize }
}

/** A good first guess at the tile size: the biggest common size that divides the image evenly. */
export function guessTileSize(width: number, height: number): number {
  return [16, 32, 48, 64, 24, 8].find((s) => width % s === 0 && height % s === 0 && width / s >= 2) ?? 16
}

