import { strFromU8, unzipSync } from 'fflate'
import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hexColor, richTextToDocx } from './docx'

const t = (text: string, ...marks: object[]) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) })
export const SAMPLE = {
  type: 'doc',
  content: [
    { type: 'tableOfContents' },
    { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [t('Chapter & one')] },
    { type: 'paragraph', attrs: { lineHeight: 2, indent: 1 }, content: [t('Small caps', { type: 'smallCaps' }), t(' H'), t('2', { type: 'subscript' }), t('O red', { type: 'textColor', attrs: { color: 'rgb(211, 58, 58)' } }), t(' gone', { type: 'deletion' }), t(' note', { type: 'comment' })] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('one')] }, { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('inner')] }] }] }] }] },
    { type: 'pageBreak' },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2, background: '#e7f1fb' }, content: [{ type: 'paragraph', content: [t('Head')] }] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [t('a')] }] }, { type: 'tableCell', content: [{ type: 'paragraph', content: [t('b')] }] }] }] },
    { type: 'paragraph', content: [t('With a note'), { type: 'footnote', attrs: { note: 'The note' } }] },
  ],
}

describe('docx export', () => {
  it('writes the parts and the formatting', () => {
    const bytes = richTextToDocx('Test', SAMPLE, { header: 'My header', footer: 'Foot', numbers: true }, () => undefined)
    if (process.env.DOCX_OUT) writeFileSync(process.env.DOCX_OUT, bytes)
    const files = unzipSync(bytes)
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/footer1.xml', 'word/header1.xml', 'word/numbering.xml', 'word/styles.xml'])
    const doc = strFromU8(files['word/document.xml'])
    expect(doc).toContain('Chapter &amp; one')
    expect(doc).toContain('<w:smallCaps/>')
    expect(doc).toContain('<w:vertAlign w:val="subscript"/>')
    expect(doc).toContain('<w:color w:val="D33A3A"/>')
    expect(doc).toContain('<w:br w:type="page"/>')
    expect(doc).toContain('<w:gridSpan w:val="2"/>')
    expect(doc).toContain('w:fill="E7F1FB"')
    expect(doc).not.toContain('gone')
    expect(doc).not.toContain('"> note<')
    expect(strFromU8(files['word/footer1.xml'])).toContain(' PAGE ')
  })
  it('reads colours', () => {
    expect(hexColor('#abc')).toBe('AABBCC')
    expect(hexColor('rgb(0, 255, 16)')).toBe('00FF10')
    expect(hexColor('var(--x)')).toBeNull()
  })
})
