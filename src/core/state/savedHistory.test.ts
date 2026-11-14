import { describe, expect, it } from 'vitest'
import { packHistory, unpackHistory } from './savedHistory'

const png = (n: number) => `data:image/png;base64,${String(n).repeat(400)}`

describe('undo history kept between sessions (0.31)', () => {
  it('comes back for the same document, with shared cel data stored once', () => {
    const past = [{ cels: { a: png(1) } }, { cels: { a: png(1), b: png(2) } }]
    const current = { cels: { a: png(1), b: png(3) } }
    const future = [{ cels: { a: png(4) } }]
    const text = packHistory(current, past, future)!
    expect(text.split(png(1)).length - 1).toBe(1)
    expect(unpackHistory(text, current)).toEqual({ past, future })
  })
  it('is ignored when the document changed since', () => {
    const text = packHistory({ v: 1 }, [{ v: 0 }], [])!
    expect(unpackHistory(text, { v: 2 })).toBeNull()
    expect(unpackHistory('not a history', { v: 1 })).toBeNull()
  })
  it('drops the oldest steps to stay under the size limit', () => {
    const past = Array.from({ length: 20 }, (_, i) => ({ v: png(i) }))
    const text = packHistory({ v: 0 }, past, [], 4000)!
    const back = unpackHistory(text, { v: 0 })!
    expect(text.length).toBeLessThanOrEqual(4000)
    expect(back.past.length).toBeGreaterThan(0)
    expect(back.past.at(-1)).toEqual(past.at(-1))
    expect(packHistory({ v: 0 }, [], [])).toBeNull()
  })
})
