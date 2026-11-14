import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultGlass } from './theme'

const css = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const index = css('../index.css')
const glass = css('./glass.css')

/** The value of a token inside the first rule that starts with `selector`. */
function token(src: string, selector: string, name: string): string {
  const block = src.slice(src.indexOf(selector)).split('}')[0]
  const m = block.match(new RegExp(`${name}:\\s*([^;]+);`))
  if (!m) throw new Error(`${name} missing in ${selector}`)
  return m[1].trim()
}
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const lum = (c: number[]) => {
  const [r, g, b] = c.map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const percent = (mix: string) => Number(mix.match(/(\d+)%/)![1]) / 100

describe('glass look', () => {
  // Dialogs, menus and floating bars can sit over any picture: their text must stay readable (WCAG AA 4.5:1)
  // even over pure white or pure black.
  for (const theme of ['dark', 'light'] as const) {
    const sel = theme === 'dark' ? ":root[data-theme='dark']" : ":root[data-theme='light']"
    const fill = hex(token(index, sel, '--bg-elevated'))
    for (const level of [":root[data-glass] {", ":root[data-glass='light'] {"]) {
      const a = percent(token(glass, level, '--glass-fill-thick'))
      for (const under of [[255, 255, 255], [0, 0, 0]]) {
        const bg = fill.map((c, i) => c * a + under[i] * (1 - a))
        for (const t of ['--text', '--text-muted']) {
          it(`${theme} ${level} ${t} over ${under[0] ? 'white' : 'black'}`, () => {
            expect(contrast(hex(token(index, sel, t)), bg)).toBeGreaterThanOrEqual(4.5)
          })
        }
      }
    }
  }

  it('picks a safe default', () => {
    expect(defaultGlass({ reduceTransparency: false, softwareGpu: false, linux: false })).toBe('full')
    expect(defaultGlass({ reduceTransparency: false, softwareGpu: false, linux: true })).toBe('light')
    expect(defaultGlass({ reduceTransparency: false, softwareGpu: true, linux: true })).toBe('off')
    expect(defaultGlass({ reduceTransparency: true, softwareGpu: false, linux: false })).toBe('off')
  })
})
