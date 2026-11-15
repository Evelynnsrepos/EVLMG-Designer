import { describe, expect, it } from 'vitest'
import { homeLayout, moveSection, moveToFolder } from './folders'

describe('moveToFolder', () => {
  const folders = [
    { id: 'a', name: 'Games', open: true, paths: ['/p1'] },
    { id: 'b', name: 'Videos', open: false, paths: [] },
  ]
  it('keeps a project in one folder only', () => {
    const moved = moveToFolder(folders, '/p1', 'b')
    expect(moved.map((f) => f.paths)).toEqual([[], ['/p1']])
  })
  it('takes a project out of every folder', () => {
    expect(moveToFolder(folders, '/p1', null).every((f) => !f.paths.length)).toBe(true)
  })
})

describe('homeLayout', () => {
  const folders = [
    { id: 'a', name: 'Games', open: true, paths: [] },
    { id: 'b', name: 'Videos', open: true, paths: [] },
  ]
  it('starts with the folders, then Recent projects, then the rest', () => {
    expect(homeLayout(folders, []).map((s) => `${s.id}:${s.width}`)).toEqual(['a:wide', 'b:medium', 'recent:full', 'rest:full'])
  })
  it('keeps the saved order, drops deleted sections and puts new folders before Recent', () => {
    const saved = [
      { id: 'recent', width: 'half' as const, height: 'tall' as const },
      { id: 'gone', width: 'full' as const, height: 'short' as const },
      { id: 'a', width: 'narrow' as const, height: 'short' as const },
    ]
    expect(homeLayout(folders, saved).map((s) => s.id)).toEqual(['b', 'recent', 'a', 'rest'])
    expect(homeLayout(folders, saved)[1].width).toBe('half')
  })
  it('moves a section before another one', () => {
    const list = homeLayout(folders, [])
    expect(moveSection(list, 'recent', 'a').map((s) => s.id)).toEqual(['recent', 'a', 'b', 'rest'])
    expect(moveSection(list, 'a', null).map((s) => s.id)).toEqual(['b', 'recent', 'rest', 'a'])
  })
})
