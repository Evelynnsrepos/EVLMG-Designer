import { describe, expect, it } from 'vitest'
import { moveToFolder } from './folders'

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
