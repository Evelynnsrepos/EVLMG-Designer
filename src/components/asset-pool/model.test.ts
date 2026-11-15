import { describe, expect, it } from 'vitest'
import { createPool, guessKind, isLate, makeMain, newEntry, parseChecklist, progress, trackedIds } from './model'

describe('asset pool', () => {
  it('reads checklists with bullets, numbers and checkboxes', () => {
    expect(parseChecklist('- [ ] Sword icon\n* Shield\n\n1. Boss music\n- [x] Logo\nPlain line')).toEqual(['Sword icon', 'Shield', 'Boss music', 'Logo', 'Plain line'])
  })

  it('knows which entities are already tracked per kind', () => {
    const pool = createPool()
    pool.entries.push(newEntry('Sword', 'Icon', { type: 'item', id: 'a' }))
    expect(trackedIds(pool, 'item', 'Icon')).toEqual(new Set(['a']))
    expect(trackedIds(pool, 'item', '3D model').size).toBe(0)
  })

  it('guesses the kind from the name', () => {
    expect(['Hero idle sprite', 'Sword icon', 'Forest music', 'Coin pickup sound', 'Boss model', 'Title screen UI', 'Button click sound', 'Fire explosion', 'Castle'].map((n) => guessKind(n))).toEqual([
      'Sprite', 'Icon', 'Music', 'Sound', '3D model', 'UI', 'Sound', 'VFX', '2D art',
    ])
    expect(guessKind('Castle', 'Other')).toBe('Other')
  })

  it('counts progress', () => {
    const done = { ...newEntry('x', 'Other'), status: 'done' as const }
    expect(progress([done, newEntry('y', 'Other')])).toEqual({ done: 1, total: 2 })
  })

  it('makes a picture the main one', () => {
    expect(makeMain(['a', 'b', 'c'], 2)).toEqual(['c', 'a', 'b'])
    expect(makeMain(['a', 'b'], 0)).toEqual(['a', 'b'])
  })

  it('is late only when the due date passed and it is not done', () => {
    const e = { ...newEntry('x', 'Icon'), due: '2026-01-01' }
    expect(isLate(e, '2026-01-02')).toBe(true)
    expect(isLate(e, '2026-01-01')).toBe(false)
    expect(isLate({ ...e, status: 'done' }, '2026-02-01')).toBe(false)
    expect(isLate(newEntry('y', 'Icon'), '2026-02-01')).toBe(false)
  })
})
