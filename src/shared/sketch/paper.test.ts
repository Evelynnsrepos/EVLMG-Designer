import { describe, expect, it } from 'vitest'
import { createSketchDoc, paperMode, withPaper } from './model'

describe('canvas background (0.31)', () => {
  it('is solid for drawings saved before (no frosted field)', () => {
    expect(paperMode(createSketchDoc())).toBe('solid')
    expect(paperMode({ backgroundColor: null })).toBe('transparent')
  })
  it('keeps the colour when switching, and Blurred exports see-through', () => {
    const solid = { backgroundColor: '#ffeedd' as string | null, frosted: undefined as string | null | undefined }
    const blurred = withPaper(solid, 'blurred')
    expect(blurred).toEqual({ backgroundColor: null, frosted: '#ffeedd' })
    expect(paperMode(blurred)).toBe('blurred')
    expect(withPaper(blurred, 'solid')).toEqual({ backgroundColor: '#ffeedd', frosted: undefined })
    expect(withPaper(blurred, 'transparent')).toEqual({ backgroundColor: null, frosted: undefined })
  })
})
