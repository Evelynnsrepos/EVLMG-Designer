import { describe, expect, it } from 'vitest'
import { richTextToMarkdown } from './doc'
import { markdownToRichText } from './markdown'
import { changeCase } from './wordExtensions'

describe('change case', () => {
  it('upper, lower, title and sentence case', () => {
    expect(changeCase('straße', 'upper')).toBe('STRASSE')
    expect(changeCase('HeLLo World', 'lower')).toBe('hello world')
    expect(changeCase("the dragon's lair", 'title')).toBe("The Dragon's Lair")
    expect(changeCase('one. two! three', 'sentence')).toBe('One. Two! Three')
    expect(changeCase('mid sentence', 'sentence', false)).toBe('mid sentence')
  })
})

describe('word formats in Markdown', () => {
  it('page breaks, contents, small caps and super/subscript survive a round trip', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'tableOfContents' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Caps', marks: [{ type: 'smallCaps' }] }, { type: 'text', text: '2', marks: [{ type: 'superscript' }] }, { type: 'text', text: 'x', marks: [{ type: 'subscript' }] }] },
        { type: 'pageBreak' },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    }
    const md = richTextToMarkdown(doc)
    const back = markdownToRichText(md)
    expect(back.content?.map((n) => n.type)).toEqual(['tableOfContents', 'paragraph', 'pageBreak', 'paragraph'])
    expect(back.content?.[1].content?.map((n) => [n.text, n.marks?.map((m) => m.type)])).toEqual([
      ['Caps', ['smallCaps']],
      ['2', ['superscript']],
      ['x', ['subscript']],
    ])
  })
})
