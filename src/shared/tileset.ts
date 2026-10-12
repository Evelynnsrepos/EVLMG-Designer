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


// ---- Placed tiles can be mirrored and turned (v0.16), like Godot's alternative tiles ----------------

/** Bits of a placed tile's transform: mirror left/right, mirror up/down, swap x and y (applied first). */
export const FLIP_H = 1
export const FLIP_V = 2
export const TRANSPOSE = 4

type M = [number, number, number, number]
const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]]
/** The flags as a matrix: transpose first, then the mirrors. */
function matrix(flags: number): M {
  let m: M = [1, 0, 0, 1]
  if (flags & TRANSPOSE) m = mul([0, 1, 1, 0], m)
  if (flags & FLIP_H) m = mul([-1, 0, 0, 1], m)
  if (flags & FLIP_V) m = mul([1, 0, 0, -1], m)
  return m
}

/** The flags after turning a quarter (clockwise or not) or mirroring on top of the current ones. */
export function turnFlags(flags: number, how: 'cw' | 'ccw' | 'h' | 'v'): number {
  const op: M = how === 'cw' ? [0, -1, 1, 0] : how === 'ccw' ? [0, 1, -1, 0] : how === 'h' ? [-1, 0, 0, 1] : [1, 0, 0, -1]
  const want = mul(op, matrix(flags)).join()
  for (let f = 0; f < 8; f++) if (matrix(f).join() === want) return f
  return flags
}

/** The source pixel shown at x,y of a placed tile of `size` with these flags. */
export function tilePixel(flags: number, x: number, y: number, size: number): [number, number] {
  let [sx, sy] = [x, y]
  // Undo in reverse order: mirrors, then the transpose.
  if (flags & FLIP_V) sy = size - 1 - sy
  if (flags & FLIP_H) sx = size - 1 - sx
  if (flags & TRANSPOSE) [sx, sy] = [sy, sx]
  return [sx, sy]
}

/** Draw one tile from `img` (source corner sx,sy) into a cell of `cell` px at dx,dy, mirrored and turned. */
export function drawTile(g: CanvasRenderingContext2D, img: CanvasImageSource, sx: number, sy: number, size: number, dx: number, dy: number, cell: number, flags: number) {
  if (!flags) return g.drawImage(img, sx, sy, size, size, dx, dy, cell, cell)
  const [a, b, c, d] = matrix(flags)
  g.save()
  g.translate(dx + cell / 2, dy + cell / 2)
  g.transform(a, c, b, d, 0, 0)
  g.drawImage(img, sx, sy, size, size, -cell / 2, -cell / 2, cell, cell)
  g.restore()
}

/** Godot 4 alternative-tile bits for these flags. */
export const godotAlternative = (flags: number) => (flags & FLIP_H ? 4096 : 0) | (flags & FLIP_V ? 8192 : 0) | (flags & TRANSPOSE ? 16384 : 0)
