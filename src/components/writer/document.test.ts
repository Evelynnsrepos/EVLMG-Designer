import { describe, expect, it } from 'vitest'
import { exportDocument, printPage } from './document'

const body = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Meet ' }, { type: 'ref', attrs: { kind: 'character', id: 'c1' } }, { type: 'text', text: '.' }] },
  ],
}
const resolve = (t: { id: string }) => (t.id === 'c1' ? 'Aria' : undefined)

describe('exportDocument', () => {
  it('exports Markdown with the title as heading and links as [[Name]]', () => {
    const out = exportDocument('Act 1: Intro?', body, 'markdown', resolve)
    expect(out.name).toBe('Act 1 Intro.md')
    expect(out.text).toContain('# Act 1: Intro?')
    expect(out.text).toContain('Meet [[Aria]].')
  })

  it('exports plain text with link names', () => {
    const out = exportDocument('Notes', body, 'text', resolve)
    expect(out.name).toBe('Notes.txt')
    expect(out.text.trim()).toBe('Meet Aria.')
  })

  it('does not add a title heading when the document already starts with one', () => {
    const withHeading = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Lore' }] }] }
    const out = exportDocument('Lore', withHeading, 'markdown', resolve)
    expect(out.text.match(/# Lore/g)).toHaveLength(1)
  })
})

describe('printPage', () => {
  it('wraps the editor HTML in a page and escapes the title', () => {
    const html = printPage('Tom & <Jerry>', '<p>Hi</p>')
    expect(html).toContain('<title>Tom &#38; &#60;Jerry&#62;</title>')
    expect(html).toContain('<body><p>Hi</p></body>')
  })
})
