import { describe, expect, it } from 'vitest'
import { lineSign, signsTo, type SignStroke } from './asciiBrush'

const stroke = (mode: SignStroke['mode'], size = 0): SignStroke => ({ mode, sign: '#', size, color: '#ff0000', cw: 4, ch: 8, cols: 10, rows: 5, marks: {}, done: new Set(), anchor: null, dir: null })

describe('sign brushes', () => {
  it('picks the sign from the stroke direction', () => {
    expect(lineSign({ x: 10, y: 0 }, null, 0.3)).toBe('-')
    expect(lineSign({ x: 10, y: 0 }, null, 0.9)).toBe('_')
    expect(lineSign({ x: 10, y: -10 }, null, 0.5)).toBe('/')
    expect(lineSign({ x: 10, y: 10 }, null, 0.5)).toBe('\\')
    expect(lineSign({ x: 0, y: 10 }, null, 0.5)).toBe('|')
    // Going down, bending from left to right: (
    expect(lineSign({ x: 3, y: 10 }, { x: -3, y: 10 }, 0.5)).toBe('(')
    expect(lineSign({ x: -3, y: 10 }, { x: 3, y: 10 }, 0.5)).toBe(')')
  })

  it('shade counts once per stroke, subtract takes it back, auto clears', () => {
    const st = stroke('shade')
    signsTo(st, { x: 1, y: 1 }, null)
    signsTo(st, { x: 2, y: 2 }, { x: 1, y: 1 })
    expect(st.marks['0,0']).toEqual({ d: 1, c: '#ff0000' })
    const sub = { ...stroke('lighten'), marks: st.marks }
    signsTo(sub, { x: 1, y: 1 }, null)
    expect(st.marks['0,0']).toBeUndefined()
    const again = { ...stroke('shade'), marks: st.marks }
    signsTo(again, { x: 1, y: 1 }, null)
    const auto = { ...stroke('auto'), marks: st.marks }
    expect(signsTo(auto, { x: 1, y: 1 }, null)).toEqual({})
  })

  it('sign brush paints the cells along the stroke', () => {
    const st = stroke('sign')
    signsTo(st, { x: 1, y: 1 }, null)
    signsTo(st, { x: 13, y: 1 }, { x: 1, y: 1 })
    expect(Object.keys(st.marks).sort()).toEqual(['0,0', '12,0', '4,0', '8,0'])
    expect(st.marks['8,0'].s).toBe('#')
  })
})
