import { unzlibSync, zlibSync } from 'fflate'
import { blank, hexToRgba, rgbaToHex, type Img, type LoopMode } from '@/shared/pixel/model'

/**
 * `.ase` / `.aseprite` import, written from the openly published file format description.
 * Reads normal layers, frames and durations, cels (raw, linked, zlib), palettes and tags in
 * RGBA, grayscale and indexed colour. Group and tilemap layers are skipped.
 */
export interface AseFile {
  width: number
  height: number
  layers: { name: string; visible: boolean; opacity: number }[]
  /** Per frame: duration and one image per layer (undefined = empty). */
  frames: { duration: number; cels: (Img | undefined)[] }[]
  palette: string[]
  tags: { name: string; from: number; to: number; loop: LoopMode }[]
}

export function readAse(bytes: Uint8Array): AseFile {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (v.getUint16(4, true) !== 0xa5e0) throw new Error('Not an .ase file')
  const frameCount = v.getUint16(6, true)
  const width = v.getUint16(8, true)
  const height = v.getUint16(10, true)
  const depth = v.getUint16(12, true)
  const layerOpacity = (v.getUint32(14, true) & 1) === 1
  const transparent = v.getUint8(28)
  const str = (at: number) => {
    const n = v.getUint16(at, true)
    return { s: new TextDecoder().decode(bytes.subarray(at + 2, at + 2 + n)), end: at + 2 + n }
  }

  const palette: string[] = []
  const rgba: [number, number, number, number][] = []
  /** Index into `layers` per file layer, or -1 for skipped (group, tilemap) layers. */
  const layerMap: number[] = []
  const layers: AseFile['layers'] = []
  const frames: AseFile['frames'] = []
  const tags: AseFile['tags'] = []
  // Linked cels point to the frame that holds the pixels; resolved at the end.
  const links: { frame: number; layer: number; from: number }[] = []

  const toImg = (w: number, h: number, px: Uint8Array) => {
    const img = blank(w, h)
    const d = img.data
    for (let i = 0; i < w * h; i++) {
      if (depth === 32) d.set(px.subarray(i * 4, i * 4 + 4), i * 4)
      else if (depth === 16) d.set([px[i * 2], px[i * 2], px[i * 2], px[i * 2 + 1]], i * 4)
      else if (px[i] !== transparent) d.set(rgba[px[i]] ?? [0, 0, 0, 255], i * 4)
    }
    return img
  }

  let at = 128
  for (let f = 0; f < frameCount; f++) {
    const frameBytes = v.getUint32(at, true)
    const old = v.getUint16(at + 6, true)
    const duration = v.getUint16(at + 8, true)
    const chunks = v.getUint32(at + 12, true) || old
    const frame = { duration: duration || 100, cels: [] as (Img | undefined)[] }
    let c = at + 16
    for (let k = 0; k < chunks; k++) {
      const size = v.getUint32(c, true)
      const type = v.getUint16(c + 4, true)
      const p = c + 6
      if (type === 0x2004) {
        const flags = v.getUint16(p, true)
        const kind = v.getUint16(p + 2, true)
        const opacity = v.getUint8(p + 12)
        if (kind === 0) {
          layerMap.push(layers.length)
          layers.push({ name: str(p + 16).s, visible: (flags & 1) === 1, opacity: layerOpacity ? opacity / 255 : 1 })
        } else layerMap.push(-1)
      } else if (type === 0x2005) {
        const li = layerMap[v.getUint16(p, true)] ?? -1
        const x = v.getInt16(p + 2, true)
        const y = v.getInt16(p + 4, true)
        const celType = v.getUint16(p + 7, true)
        if (li >= 0) {
          let img: Img | undefined
          if (celType === 0) {
            const w = v.getUint16(p + 16, true)
            const h = v.getUint16(p + 18, true)
            img = toImg(w, h, bytes.subarray(p + 20, c + size))
          } else if (celType === 2) {
            const w = v.getUint16(p + 16, true)
            const h = v.getUint16(p + 18, true)
            img = toImg(w, h, unzlibSync(bytes.subarray(p + 20, c + size)))
          } else if (celType === 1) links.push({ frame: f, layer: li, from: v.getUint16(p + 16, true) })
          if (img) {
            // Cels can sit anywhere; place them on a full-size image.
            const full = blank(width, height)
            for (let yy = 0; yy < img.height; yy++)
              for (let xx = 0; xx < img.width; xx++) {
                const tx = x + xx
                const ty = y + yy
                if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
                full.data.set(img.data.subarray((yy * img.width + xx) * 4, (yy * img.width + xx) * 4 + 4), (ty * width + tx) * 4)
              }
            frame.cels[li] = full
          }
        }
      } else if (type === 0x2019) {
        const first = v.getUint32(p + 4, true)
        const last = v.getUint32(p + 8, true)
        let e = p + 20
        for (let i = first; i <= last; i++) {
          const flags = v.getUint16(e, true)
          rgba[i] = [v.getUint8(e + 2), v.getUint8(e + 3), v.getUint8(e + 4), v.getUint8(e + 5)]
          palette[i] = rgbaToHex(rgba[i][0], rgba[i][1], rgba[i][2])
          e += 6
          if (flags & 1) e = str(e).end
        }
      } else if (type === 0x0004 && !palette.length) {
        const packets = v.getUint16(p, true)
        let e = p + 2
        let i = 0
        for (let n = 0; n < packets; n++) {
          i += v.getUint8(e)
          const count = v.getUint8(e + 1) || 256
          e += 2
          for (let j = 0; j < count; j++, i++, e += 3) {
            rgba[i] = [v.getUint8(e), v.getUint8(e + 1), v.getUint8(e + 2), 255]
            palette[i] = rgbaToHex(rgba[i][0], rgba[i][1], rgba[i][2])
          }
        }
      } else if (type === 0x2018) {
        const n = v.getUint16(p, true)
        let e = p + 10
        for (let i = 0; i < n; i++) {
          const dir = v.getUint8(e + 4)
          const name = str(e + 17)
          tags.push({ name: name.s, from: v.getUint16(e, true), to: v.getUint16(e + 2, true), loop: dir === 1 ? 'reverse' : dir >= 2 ? 'pingpong' : 'forward' })
          e = name.end
        }
      }
      c += size
    }
    frames.push(frame)
    at += frameBytes
  }
  for (const l of links) frames[l.frame].cels[l.layer] = frames[l.from]?.cels[l.layer]
  return { width, height, layers, frames, palette: palette.filter(Boolean), tags }
}

/**
 * `.aseprite` save (pro fixes phase 5 #11): RGBA, one zlib cel per layer and frame cropped to its pixels,
 * linked cels where a frame reuses the same picture, the palette and the tags. readAse reads it back the same.
 */
export function writeAse(f: AseFile): Uint8Array {
  const out: number[] = []
  const u8 = (n: number) => out.push(n & 255)
  const u16 = (n: number) => (u8(n), u8(n >> 8))
  const u32 = (n: number) => (u16(n), u16(n >>> 16))
  const str = (s: string) => {
    const b = new TextEncoder().encode(s)
    u16(b.length)
    b.forEach(u8)
  }
  const fill = (at: number, n: number) => [0, 8, 16, 24].forEach((sh, i) => (out[at + i] = (n >>> sh) & 255))
  const chunk = (type: number, body: () => void) => {
    const start = out.length
    u32(0)
    u16(type)
    body()
    fill(start, out.length - start)
  }
  // Header (128 bytes): size, magic, frames, size, 32-bit colour, "layer opacity is valid", speed, palette size, pixel ratio 1:1.
  u32(0), u16(0xa5e0), u16(f.frames.length), u16(f.width), u16(f.height), u16(32), u32(1), u16(100), u32(0), u32(0)
  u8(0), u8(0), u8(0), u8(0), u16(f.palette.length), u8(1), u8(1)
  while (out.length < 128) u8(0)
  const first = new Map<Img, number>()
  f.frames.forEach((fr, fi) => {
    const start = out.length
    u32(0), u16(0xf1fa), u16(0), u16(fr.duration), u16(0), u32(0)
    let chunks = 0
    if (fi === 0) {
      if (f.palette.length) {
        chunks++
        chunk(0x2019, () => {
          u32(f.palette.length), u32(0), u32(f.palette.length - 1), u32(0), u32(0)
          for (const hex of f.palette) {
            const [r, g, b] = hexToRgba(hex)
            u16(0), u8(r), u8(g), u8(b), u8(255)
          }
        })
      }
      for (const l of f.layers) {
        chunks++
        chunk(0x2004, () => {
          u16((l.visible ? 1 : 0) | 2), u16(0), u16(0), u16(0), u16(0), u16(0), u8(Math.round(l.opacity * 255)), u8(0), u8(0), u8(0)
          str(l.name)
        })
      }
      if (f.tags.length) {
        chunks++
        chunk(0x2018, () => {
          u16(f.tags.length), u32(0), u32(0)
          for (const t of f.tags) {
            u16(t.from), u16(t.to), u8(t.loop === 'reverse' ? 1 : t.loop === 'pingpong' ? 2 : 0), u16(0), u32(0), u16(0), u8(0), u8(0), u8(0), u8(0)
            str(t.name)
          }
        })
      }
    }
    fr.cels.forEach((img, li) => {
      if (!img) return
      const from = first.get(img)
      const box = from === undefined ? bounds(img) : null
      if (from === undefined && !box) return
      chunks++
      chunk(0x2005, () => {
        u16(li), u16(box?.x ?? 0), u16(box?.y ?? 0), u8(255), u16(from === undefined ? 2 : 1), u16(0), u8(0), u8(0), u8(0), u8(0), u8(0)
        if (from !== undefined) return u16(from)
        const px = new Uint8Array(box!.w * box!.h * 4)
        for (let y = 0; y < box!.h; y++) px.set(img.data.subarray(((box!.y + y) * img.width + box!.x) * 4, ((box!.y + y) * img.width + box!.x + box!.w) * 4), y * box!.w * 4)
        u16(box!.w), u16(box!.h)
        zlibSync(px).forEach(u8)
      })
      if (from === undefined) first.set(img, fi)
    })
    out[start + 6] = Math.min(chunks, 0xffff) & 255
    out[start + 7] = (Math.min(chunks, 0xffff) >> 8) & 255
    fill(start + 12, chunks)
    fill(start, out.length - start)
  })
  fill(0, out.length)
  return Uint8Array.from(out)
}

/** The smallest box around the visible pixels, or null when there are none. */
function bounds(img: Img): { x: number; y: number; w: number; h: number } | null {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}
