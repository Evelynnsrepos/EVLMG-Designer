import { saveBinaryFile, safeFileName } from '@/core/export'
import { localized } from '../i18n'
import type { AdjustValues } from './adjust/filters'
import { asciiAnsi, asciiHtml, AsciiGrid, prepareGrid } from './ascii'

/** What an ASCII layer can be saved as (0.35). */
export type AsciiFormat = 'copy' | 'txt' | 'html' | 'ans' | 'png' | 'jpg' | 'webp'

const UI = localized(
  {
    copy: 'Copy text',
    save: 'Export ASCII art',
    titles: {
      copy: 'Copy the letters, to paste them anywhere',
      txt: 'Plain text (colours are left out)',
      html: 'A web page with the letters in their colours and fills, font included',
      ans: 'Text with colours and fills for terminals (ANSI)',
      png: 'Picture, see-through where there are no letters',
      jpg: 'Picture on a white background',
      webp: 'Picture, see-through where there are no letters',
    } as Record<AsciiFormat, string>,
  },
  {
    copy: 'Text kopieren',
    save: 'ASCII-Art exportieren',
    titles: {
      copy: 'Die Zeichen kopieren, um sie überall einzufügen',
      txt: 'Reiner Text (ohne Farben)',
      html: 'Eine Webseite mit den Zeichen in ihren Farben und Füllungen, Schrift eingebaut',
      ans: 'Text mit Farben und Füllungen für Terminals (ANSI)',
      png: 'Bild, durchsichtig wo keine Zeichen sind',
      jpg: 'Bild auf weißem Hintergrund',
      webp: 'Bild, durchsichtig wo keine Zeichen sind',
    },
  },
)

/** Labels and hints follow the interface language (read on every use). */
export const ASCII_FORMATS: { id: AsciiFormat; label: string; title: string }[] = (['copy', 'txt', 'html', 'ans', 'png', 'jpg', 'webp'] as const).map((id) => ({
  id,
  get label() {
    return id === 'copy' ? UI.copy : `.${id}`
  },
  get title() {
    return UI.titles[id]
  },
}))

/** The bundled letter font as a data: URL, so an exported web page looks the same on every computer. */
async function fontDataUrl(): Promise<string | undefined> {
  try {
    const res = await fetch('/fonts/game/JetBrainsMono-400-latin.woff2')
    if (!res.ok) return undefined
    const bytes = new Uint8Array(await res.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return `data:font/woff2;base64,${btoa(bin)}`
  } catch {
    // Without it the page falls back to the computer's own monospace font.
    return undefined
  }
}

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
  const bytes = format === 'txt' ? new TextEncoder().encode(text) : format === 'html' ? new TextEncoder().encode(asciiHtml(grid, name, await fontDataUrl())) : format === 'ans' ? new TextEncoder().encode(asciiAnsi(grid)) : await picture(grid, format)
  return saveBinaryFile({ title: UI.save, defaultName: `${safeFileName(name)}.${format}`, bytes, filter: { name: format.toUpperCase(), extensions: [format] } })
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
