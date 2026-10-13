import { extensionOf, importAssetFromBlob, resolveAssetPath, type ImportedAsset } from '@/core/assets'
import { getFs } from '@/core/fs'

/**
 * v0.18: pictures with an empty transparent border (a small dot drawn on a big Draw canvas) are trimmed
 * to what is drawn when they are placed on a board or sent to another tool. The original file stays as it is.
 */

/** The box around every pixel that is not fully transparent; null when nothing is drawn. */
export function alphaBounds(data: Uint8ClampedArray, w: number, h: number) {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** The picture cut to what is drawn, or null when there is no empty border to cut. */
export async function trimTransparent(blob: Blob): Promise<Blob | null> {
  const img = await createImageBitmap(blob).catch(() => null)
  if (!img) return null
  const c = new OffscreenCanvas(img.width, img.height)
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const box = alphaBounds(ctx.getImageData(0, 0, img.width, img.height).data, img.width, img.height)
  if (!box || (box.w === img.width && box.h === img.height)) return null
  const out = new OffscreenCanvas(box.w, box.h)
  out.getContext('2d')!.drawImage(c, -box.x, -box.y)
  return out.convertToBlob({ type: 'image/png' })
}

/** A trimmed copy of a project picture (PNG or WebP; JPGs have no transparency, GIFs would lose their animation). */
export async function trimmedAsset(root: string, asset: ImportedAsset): Promise<ImportedAsset> {
  if (asset.kind !== 'image' || !['png', 'webp'].includes(extensionOf(asset.path))) return asset
  try {
    const bytes = await getFs().readBinary(await resolveAssetPath(root, asset.path))
    const trimmed = await trimTransparent(new Blob([bytes as BlobPart]))
    if (!trimmed) return asset
    return (await importAssetFromBlob(root, trimmed, 'image', asset.name.replace(/\.\w+$/, '') + '.png')) ?? asset
  } catch {
    return asset
  }
}
