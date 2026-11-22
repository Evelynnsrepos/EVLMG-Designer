import { describe, expect, it } from 'vitest'
import { AsciiGrid, asciiAnsi, asciiHtml, asciiSettings, CHARSETS, type Atlas } from './ascii'

/** A fake atlas (no canvas in tests): character i has i·10 ink everywhere. */
function atlas(chars: string, cw: number): Atlas {
  const all = chars + '|/-\\'
  const ch = cw * 2
  const ink = new Uint8Array(all.length * cw * ch)
  for (let i = 0; i < all.length; i++) ink.fill(i * 10, i * cw * ch, (i + 1) * cw * ch)
  return { key: chars, chars: all, ramp: chars.length, cw, ch, ink }
}

/** A w×h picture, `fill(x, y)` gives straight RGBA. */
function picture(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(fill(x, y), (y * w + x) * 4)
  return px
}

function grid(w: number, h: number, px: Uint8ClampedArray, v: Record<string, number>, ascii = {}) {
  const s = asciiSettings({ v: { set: 0, cell: 2, look: 0, colour: 0, ...v }, ascii })
  const g = new AsciiGrid()
  g.prepare(w, h, s, atlas(s.chars, s.cell))
  const all = { x: 0, y: 0, w, h }
  g.readPixels(px, all, g.cellsOf(all))
  return g
}

describe('ASCII art', () => {
  it('picks lighter letters for lighter cells and leaves see-through cells empty', () => {
    // 4 cells of 2×4 px in a row: black, grey, white, see-through.
    const px = picture(8, 4, (x) => (x < 2 ? [0, 0, 0, 255] : x < 4 ? [128, 128, 128, 255] : x < 6 ? [255, 255, 255, 255] : [0, 0, 0, 0]))
    const g = grid(8, 4, px, {})
    expect(g.pickAll()).toEqual({ x: 0, y: 0, w: 3, h: 1 })
    expect(g.text()).toEqual(['@='])
    // Nothing changed: nothing to draw again.
    expect(g.pickAll()).toBeNull()
  })

  it('bright parts and painted parts', () => {
    const px = picture(4, 4, (x) => (x < 2 ? [255, 255, 255, 255] : [0, 0, 0, 128]))
    expect(grid(4, 4, px, { look: 1 }).pickAll() && grid(4, 4, px, { look: 1 }).text()).toBeTruthy()
    const bright = grid(4, 4, px, { look: 1 })
    bright.pickAll()
    expect(bright.text()).toEqual(['@'])
    const painted = grid(4, 4, px, { look: 2 })
    painted.pickAll()
    expect(painted.text()[0][0]).toBe('@')
    expect(painted.text()[0][1]).toBe(CHARSETS[0].chars[5])
  })

  it('colour per letter, or one colour', () => {
    const px = picture(2, 4, () => [200, 10, 10, 255])
    const g = grid(2, 4, px, {})
    g.pickAll()
    expect([...g.pick.slice(0, 3)]).toEqual([200, 10, 10])
    const one = grid(2, 4, px, { colour: 1 }, { ink: '#00ff00' })
    one.pickAll()
    expect([...one.pick.slice(0, 3)]).toEqual([0, 255, 0])
  })

  it('draws the letter ink in the cell colour; a background fills the rest', () => {
    const px = picture(2, 4, () => [0, 0, 0, 255])
    const g = grid(2, 4, px, { paper: 1 }, { paper: '#ffffff' })
    g.pickAll()
    const out = new Uint8ClampedArray(2 * 4 * 4)
    g.paint(out, { x: 0, y: 0, w: 2, h: 4 })
    // '@' is ramp index 9 → 90 ink: black over white.
    expect([...out.slice(0, 4)]).toEqual([255 - 90, 255 - 90, 255 - 90, 255])
    const clear = grid(2, 4, px, {})
    clear.pickAll()
    clear.paint(out, { x: 0, y: 0, w: 2, h: 4 })
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 90])
  })

  it('edge lines follow the direction of a boundary', () => {
    // Left half black, right half white: a vertical edge.
    const px = picture(16, 16, (x) => (x < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255]))
    const g = grid(16, 16, px, { edges: 1 })
    g.pickAll()
    expect(g.text()[1]).toContain('|')
    const flat = grid(
      16,
      16,
      picture(16, 16, (_, y) => (y < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
      { edges: 1 },
    )
    flat.pickAll()
    expect(flat.text().join('')).toContain('-')
  })

  it('dithering spreads a flat grey over two letters', () => {
    const px = picture(32, 32, () => [120, 120, 120, 255])
    const plain = grid(32, 32, px, {})
    plain.pickAll()
    expect(new Set(plain.text().join(''))).toHaveProperty('size', 1)
    for (const dither of [1, 2]) {
      const d = grid(32, 32, px, { dither })
      d.pickAll()
      expect(new Set(d.text().join('')).size).toBeGreaterThan(1)
    }
  })

  it('only the cells under a change are read again', () => {
    const px = picture(8, 8, () => [255, 255, 255, 255])
    const g = grid(8, 8, px, {})
    g.pickAll()
    px.set([0, 0, 0, 255], (5 * 8 + 5) * 4)
    const at = { x: 5, y: 5, w: 1, h: 1 }
    g.readPixels(px, { x: 0, y: 0, w: 8, h: 8 }, g.cellsOf(at))
    expect(g.pickAll()).toEqual({ x: 2, y: 1, w: 1, h: 1 })
  })

  it('your own letters', () => {
    const s = asciiSettings({ v: { set: 3 }, ascii: { chars: 'oo.O' } })
    expect(s.chars).toBe('o.O')
    expect(asciiSettings({ v: { set: 3 } }).chars).toBe(CHARSETS[0].chars)
  })

  it('exports text, coloured web pages and terminal colours', () => {
    const px = picture(4, 4, (x) => (x < 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]))
    const g = grid(4, 4, px, { look: 2 })
    g.pickAll()
    expect(g.text()).toEqual(['@'])
    expect(asciiHtml(g, 'a<b')).toContain('<span style="color:#ff0000">@</span>')
    expect(asciiHtml(g, 'a<b')).toContain('a&lt;b')
    expect(asciiAnsi(g)).toBe('\x1b[38;2;255;0;0m@\x1b[0m\n')
  })
})
