import { saveBinaryFile, safeFileName } from '@/core/export'
import type { AdjustValues } from './adjust/filters'
import { asciiAnsi, asciiHtml, AsciiGrid, prepareGrid } from './ascii'

/** What an ASCII layer can be saved as (0.35). */
export type AsciiFormat = 'copy' | 'txt' | 'html' | 'ans' | 'png' | 'jpg' | 'webp'

export const ASCII_FORMATS: { id: AsciiFormat; label: string; title: string }[] = [
  { id: 'copy', label: 'Copy text', title: 'Copy the letters, to paste them anywhere' },
  { id: 'txt', label: '.txt', title: 'Plain text (colours are left out)' },
  { id: 'html', label: '.html', title: 'A web page with the letters in their colours' },
  { id: 'ans', label: '.ans', title: 'Text with colours for terminals (ANSI)' },
  { id: 'png', label: '.png', title: 'Picture, see-through where there are no letters' },
  { id: 'jpg', label: '.jpg', title: 'Picture on a white background' },
  { id: 'webp', label: '.webp', title: 'Picture, see-through where there are no letters' },
]

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }

/** The letters of `pixels` (a layer, or the picture below an ASCII adjustment layer). */
export function asciiGridOf(pixels: HTMLCanvasElement, a: AdjustValues): AsciiGrid {
  const grid = new AsciiGrid()
  const { width: w, height: h } = pixels
  prepareGrid(grid, w, h, a)
  const all = { x: 0, y: 0, w, h }
  grid.readPixels(pixels.getContext('2d')!.getImageData(0, 0, w, h).data, all, grid.cellsOf(all))
  grid.pickAll()
  return grid
}

function picture(grid: AsciiGrid, format: string): Promise<Uint8Array> {
  const c = document.createElement('canvas')
  c.width = grid.w
  c.height = grid.h
  const g = c.getContext('2d')!
  const img = g.createImageData(grid.w, grid.h)
  grid.paint(img.data, { x: 0, y: 0, w: grid.w, h: grid.h })
  g.putImageData(img, 0, 0)
  if (format === 'jpg') {
    g.globalCompositeOperation = 'destination-over'
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, c.width, c.height)
  }
  return new Promise((ok, fail) => c.toBlob((b) => (b ? b.arrayBuffer().then((x) => ok(new Uint8Array(x))) : fail(new Error('no picture'))), MIME[format], 0.92))
}

/** Copy or save the letters. False when the save window was cancelled. */
export async function exportAscii(grid: AsciiGrid, format: AsciiFormat, name: string): Promise<boolean> {
  const text = grid.text().join('\n') + '\n'
  if (format === 'copy') {
    await navigator.clipboard.writeText(text)
    return true
  }
  const bytes = format === 'txt' ? new TextEncoder().encode(text) : format === 'html' ? new TextEncoder().encode(asciiHtml(grid, name)) : format === 'ans' ? new TextEncoder().encode(asciiAnsi(grid)) : await picture(grid, format)
  return saveBinaryFile({ title: 'Export ASCII art', defaultName: `${safeFileName(name)}.${format}`, bytes, filter: { name: format.toUpperCase(), extensions: [format] } })
}

/** The letters of a small picture (Pixel Art): each picture pixel becomes `scale` px, one letter per 1×2 pixels. */
export function asciiGridOfImage(img: ImageData, a: AdjustValues, scale = 8): AsciiGrid {
  const src = document.createElement('canvas')
  src.width = img.width
  src.height = img.height
  src.getContext('2d')!.putImageData(img, 0, 0)
  const big = document.createElement('canvas')
  big.width = img.width * scale
  big.height = img.height * scale
  const g = big.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.drawImage(src, 0, 0, big.width, big.height)
  return asciiGridOf(big, { ...a, v: { ...a.v, cell: scale } })
}
