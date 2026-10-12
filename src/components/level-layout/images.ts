import { useEffect, useRef, useState } from 'react'
import { resolveAssetPath } from '@/core/assets'
import { getFs } from '@/core/fs'
import { useProjectStore } from '@/core/state'
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

/**
 * A project picture read from disk into a same-origin image, so its pixels can be read
 * (black made see-through) and saved again; the desktop asset URL would taint the canvas.
 */
export async function loadAssetImage(root: string, path: string): Promise<HTMLImageElement | null> {
  try {
    const bytes = await getFs().readBinary(await resolveAssetPath(root, path))
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]))
    const img = await loadImage(url)
    URL.revokeObjectURL(url)
    return img
  } catch {
    return null
  }
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
  const root = useProjectStore((s) => s.root)
  const [raw, setRaw] = useState<Record<string, HTMLImageElement>>({})
  const asked = useRef(new Set<string>())
  useEffect(() => {
    if (!root) return
    // ponytail: a picture still arriving from a teammate is not retried; reopening the level loads it.
    for (const t of sets) {
      if (asked.current.has(t.image)) continue
      asked.current.add(t.image)
      void loadAssetImage(root, t.image).then((img) => img && setRaw((m) => ({ ...m, [t.image]: img })))
    }
  }, [root, sets])
  const [out, setOut] = useState<Record<string, TileImage>>({})
  useEffect(() => {
    const next: Record<string, TileImage> = {}
    for (const t of sets) {
      const img = raw[t.image]
      if (img) next[t.id] = t.blackTransparent ? blackToTransparent(img) : img
    }
    setOut(next)
    // Only the picture and the black setting matter, not names or folders.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, sets.map((t) => `${t.id}${t.image}${t.blackTransparent}`).join()])
  return out
}
