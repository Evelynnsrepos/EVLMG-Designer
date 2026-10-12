import { zlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { readAse } from './ase'
import { getPx } from './model'

/** A tiny file by the published layout: 2 frames of 2×1 RGBA, one layer, a zlib cel, a linked cel and a tag. */
function sample(): Uint8Array {
  const out: number[] = []
  const u8 = (n: number) => out.push(n & 255)
  const u16 = (n: number) => (u8(n), u8(n >> 8))
  const u32 = (n: number) => (u16(n), u16(n >>> 16))
  const str = (s: string) => (u16(s.length), [...s].forEach((c) => u8(c.charCodeAt(0))))
  const chunk = (type: number, body: () => void) => {
    const start = out.length
    u32(0)
    u16(type)
    body()
    const size = out.length - start
    ;[size, size >> 8, size >> 16, size >>> 24].forEach((b, i) => (out[start + i] = b & 255))
  }
  const frame = (duration: number, body: () => void, chunks: number) => {
    const start = out.length
    u32(0), u16(0xf1fa), u16(chunks), u16(duration), u16(0), u32(chunks)
    body()
    const size = out.length - start
    ;[size, size >> 8, size >> 16, size >>> 24].forEach((b, i) => (out[start + i] = b & 255))
  }
  // Header
  u32(0), u16(0xa5e0), u16(2), u16(2), u16(1), u16(32), u32(1), u16(100), u32(0), u32(0), u8(0), u8(0), u8(0), u8(0), u16(0), u8(1), u8(1)
  while (out.length < 128) u8(0)
  frame(
    120,
    () => {
      chunk(0x2004, () => (u16(1), u16(0), u16(0), u16(0), u16(0), u16(0), u8(255), u8(0), u8(0), u8(0), str('Body')))
      chunk(0x2005, () => {
        u16(0), u16(0), u16(0), u8(255), u16(2), u16(0), u8(0), u8(0), u8(0), u8(0), u8(0), u16(2), u16(1)
        zlibSync(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255])).forEach(u8)
      })
      chunk(0x2018, () => {
        u16(1), u32(0), u32(0)
        u16(0), u16(1), u8(2), u16(0), u32(0), u16(0), u8(0), u8(0), u8(0), u8(0), str('walk')
      })
    },
    3,
  )
  frame(80, () => chunk(0x2005, () => (u16(0), u16(0), u16(0), u8(255), u16(1), u16(0), u8(0), u8(0), u8(0), u8(0), u8(0), u16(0))), 1)
  return new Uint8Array(out)
}

describe('.ase import', () => {
  it('reads layers, compressed and linked cels, durations and tags', () => {
    const f = readAse(sample())
    expect(f.width).toBe(2)
    expect(f.layers).toEqual([{ name: 'Body', visible: true, opacity: 1 }])
    expect(f.frames.map((x) => x.duration)).toEqual([120, 80])
    expect(getPx(f.frames[0].cels[0]!, 1, 0)).toEqual([0, 0, 255, 255])
    expect(f.frames[1].cels[0]).toBe(f.frames[0].cels[0])
    expect(f.tags).toEqual([{ name: 'walk', from: 0, to: 1, loop: 'pingpong' }])
  })
})
