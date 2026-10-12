import { useEffect, useState } from 'react'
import { useAssetUrls } from '@/core/assets'
import type { Tileset } from './model'

export type TileImage = HTMLImageElement | HTMLCanvasElement

/** Load an image from a URL; null when it is missing or broken. */
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => res(null)
    img.src = url
  })
}

/** The picture with pure black pixels (and almost black ones, from compression) made see-through (v0.15). */
export function blackToTransparent(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0)
  const data = g.getImageData(0, 0, c.width, c.height)
  const p = data.data
  for (let i = 0; i < p.length; i += 4) if (p[i] <= 8 && p[i + 1] <= 8 && p[i + 2] <= 8) p[i + 3] = 0
  g.putImageData(data, 0, 0)
  return c
}

/** The tilesets' pictures, ready to draw (black made see-through where asked), by tileset id. */
export function useTilesetImages(sets: Tileset[]): Record<string, TileImage> {
  const urlOf = useAssetUrls(sets.map((t) => t.image))
  const [raw, setRaw] = useState<Record<string, HTMLImageElement>>({})
  useEffect(() => {
    for (const t of sets) {
      const url = urlOf(t.image)
      if (!url || raw[url]) continue
      void loadImage(url).then((img) => img && setRaw((m) => ({ ...m, [url]: img })))
    }
  }, [sets, urlOf, raw])
  const [out, setOut] = useState<Record<string, TileImage>>({})
  useEffect(() => {
    const next: Record<string, TileImage> = {}
    for (const t of sets) {
      const img = raw[urlOf(t.image) ?? '']
      if (img) next[t.id] = t.blackTransparent ? blackToTransparent(img) : img
    }
    setOut(next)
    // Only the picture and the black setting matter, not names or folders.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, urlOf, sets.map((t) => `${t.id}${t.image}${t.blackTransparent}`).join()])
  return out
}
