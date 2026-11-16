import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { findMatches } from './find'
import { INSERTS } from './inserts'

describe('find', () => {
  const schema = getSchema([StarterKit])
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'The cat sat.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'A Cat, a concat.' }] },
    ],
  })
  it('finds every match with document positions, ignoring case', () => {
    const found = findMatches(doc, 'cat')
    expect(found.map((m) => doc.textBetween(m.from, m.to))).toEqual(['cat', 'Cat', 'cat'])
    expect(findMatches(doc, '')).toEqual([])
    expect(findMatches(doc, 'dog')).toEqual([])
  })
})

describe('insert list', () => {
  it('has unique ids, and typed-only-with-the-switch entries say what to type', () => {
    expect(new Set(INSERTS.map((i) => i.id)).size).toBe(INSERTS.length)
    expect(INSERTS.filter((i) => i.needsSyntax && !i.type)).toEqual([])
  })
})
