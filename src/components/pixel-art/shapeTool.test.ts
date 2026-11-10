import { describe, expect, it, vi } from 'vitest'
import type { Img } from '@/shared/pixel/model'

// PNG encoding needs a browser canvas; keep the pictures in a map instead.
const store = new Map<string, Img>()
vi.mock('@/shared/pixel/codec', () => ({
  encode: (img: Img) => {
    if (img.data.every((v, i) => i % 4 !== 3 || v === 0)) return null
    const k = `png${store.size}`
    store.set(k, img)
    return k
  },
}))
const celImg = (k: string) => store.get(k)!
import { celKey, createPixelDoc, getPx, newFrame, type PixelDoc } from '@/shared/pixel/model'
import { newShape } from '@/shared/pixel/shapes'
import { withInBetweens, withShapes } from './shapeTool'

const doc = (): PixelDoc => {
  const d = createPixelDoc()
  return { ...d, started: true, width: 16, height: 16, layers: [{ ...d.layers[0], vector: true }], frames: [newFrame(), newFrame(), newFrame()] }
}

describe('shape layer cels', () => {
  it('draws the shapes into the cel and keeps them editable', () => {
    const d = doc()
    const key = celKey(d.layers[0].id, d.frames[0].id)
    const x = withShapes(d, key, [newShape([{ x: 1, y: 1 }, { x: 8, y: 1 }], false, { strokeColor: '#ff0000' })])
    expect(x.shapes![key].key).toBe(true)
    expect(getPx(celImg(x.cels[key]), 4, 1)).toEqual([255, 0, 0, 255])
    // No shapes left: no pixels left.
    expect(withShapes(x, key, []).cels[key]).toBeUndefined()
  })

  it('fills in-betweens from key to key and draws them', () => {
    const d = doc()
    const l = d.layers[0].id
    const a = newShape([{ x: 0, y: 5 }, { x: 0, y: 9 }], false, { strokeColor: '#00ff00' })
    let x = withShapes(d, celKey(l, d.frames[0].id), [a])
    x = withShapes(x, celKey(l, d.frames[2].id), [{ ...a, points: [{ x: 10, y: 5 }, { x: 10, y: 9 }] }])
    x = withInBetweens(x, l, 'even')
    const mid = celKey(l, d.frames[1].id)
    expect(x.shapes![mid]).toMatchObject({ key: false })
    expect(getPx(celImg(x.cels[mid]), 5, 7)).toEqual([0, 255, 0, 255])
  })
})
