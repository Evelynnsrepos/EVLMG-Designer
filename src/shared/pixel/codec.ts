import { useEffect, useState } from 'react'
import { blank, type Img } from './model'

/** Decoded cels by data URL, shared by every open Pixel Art file (a URL never changes its pixels). */
const decoded = new Map<string, Img>()

export const cached = (url: string | undefined) => (url ? decoded.get(url) : undefined)

/** PNG or GIF bytes, or a data URL, to pixels. */
export async function decode(src: string | Uint8Array): Promise<Img> {
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : new Blob([src as Uint8Array<ArrayBuffer>])
  const bmp = await createImageBitmap(blob)
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const g = c.getContext('2d')!
  g.drawImage(bmp, 0, 0)
  const d = g.getImageData(0, 0, bmp.width, bmp.height)
  return { width: d.width, height: d.height, data: d.data }
}

export function toCanvas(img: Img, scale = 1): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  if (scale === 1) return c
  const big = document.createElement('canvas')
  big.width = img.width * scale
  big.height = img.height * scale
  const g = big.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.drawImage(c, 0, 0, big.width, big.height)
  return big
}

/** Pixels to a PNG data URL (and remembered decoded); null when the image is fully transparent. */
export function encode(img: Img): string | null {
  let any = false
  for (let i = 3; i < img.data.length; i += 4)
    if (img.data[i]) {
      any = true
      break
    }
  if (!any) return null
  const url = toCanvas(img).toDataURL('image/png')
  decoded.set(url, img)
  return url
}

export const pngBytes = async (img: Img, scale = 1) => new Uint8Array(await (await new Promise<Blob | null>((res) => toCanvas(img, scale).toBlob(res, 'image/png')))!.arrayBuffer())

/** Decode every cel of the file; re-renders when one arrives. */
export function useDecoded(urls: string[]): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    let gone = false
    for (const u of urls) if (u.startsWith('data:') && !decoded.has(u)) void decode(u).then((img) => (decoded.set(u, img), gone || setN((x) => x + 1)))
    return () => {
      gone = true
    }
  }, [urls])
  return n
}

/** A cel's pixels, or an empty image of the canvas size. */
export const celImg = (url: string | undefined, w: number, h: number) => cached(url) ?? blank(w, h)
