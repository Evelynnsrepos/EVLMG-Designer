import { describe, expect, it } from 'vitest'
import { countRichTextWords, richTextToMarkdown, richTextToPlainText } from './doc'
import { looksLikeMarkdown, markdownToRichText } from './markdown'
import type { RichTextDoc } from './types'

const names: Record<string, string> = { Ironhold: 'town-1', Lore: 'doc-1' }
const findRef = (label: string) => (names[label] ? { kind: label === 'Lore' ? 'document' : 'town', id: names[label] } : undefined)
const resolve = (t: { id: string }) => Object.keys(names).find((n) => names[n] === t.id)

const parse = (md: string) => markdownToRichText(md, findRef).content!

describe('markdownToRichText', () => {
  it('reads headings, marks and the extra inline syntax', () => {
    const [h, p] = parse('#### Deep\n\n**Bold** ==glow== %%secret%% #lore/old and `code`')
    expect(h).toEqual({ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Deep' }] })
    const marked = (p.content ?? []).filter((n) => n.marks).map((n) => [n.text, n.marks![0].type])
    expect(marked).toEqual([
      ['Bold', 'bold'],
      ['glow', 'highlight'],
      ['secret', 'comment'],
      ['#lore/old', 'tag'],
      ['code', 'code'],
    ])
  })

  it('keeps "#1" as text', () => {
    expect(parse('issue #1')[0].content).toEqual([{ type: 'text', text: 'issue #1' }])
  })

  it('links known names, keeps shown text, leaves unknown names as text', () => {
    const [p] = parse('See [[Ironhold|the city]] and [[Nowhere]].')
    expect(p.content).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'ref', attrs: { kind: 'town', id: 'town-1', text: 'the city' } },
      { type: 'text', text: ' and ' },
      { type: 'text', text: '[[Nowhere]]' },
      { type: 'text', text: '.' },
    ])
  })

  it('turns embeds into jump cards and pictures', () => {
    expect(parse('![[Lore]]\n\n![[map.png]]')).toEqual([
      { type: 'refCard', attrs: { kind: 'document', id: 'doc-1' } },
      { type: 'image', attrs: { src: 'map.png', alt: null } },
    ])
  })

  it('reads checklists, callouts, footnotes and tables', () => {
    const [tasks, callout, p, table] = parse(
      '- [ ] open\n- [x] done\n\n> [!warning]- Careful\n> Hot stuff\n\nText[^a] more^[inline note]\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[^a]: The note',
    )
    expect(tasks.content!.map((i) => i.attrs!.checked)).toEqual([false, true])
    expect(callout).toMatchObject({ type: 'callout', attrs: { kind: 'warning', fold: '-', title: 'Careful' } })
    expect(callout.content![0].content![0].text).toBe('Hot stuff')
    expect(p.content!.filter((n) => n.type === 'footnote').map((n) => n.attrs!.note)).toEqual(['The note', 'inline note'])
    expect(table.content!.map((r) => r.content!.map((c) => c.type))).toEqual([
      ['tableHeader', 'tableHeader'],
      ['tableCell', 'tableCell'],
    ])
  })
})

describe('export with the new formats', () => {
  const doc: RichTextDoc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 5 }, content: [{ type: 'text', text: 'Notes' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hot', marks: [{ type: 'highlight' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'todo later', marks: [{ type: 'comment' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: '#idea', marks: [{ type: 'tag' }] },
          { type: 'text', text: ' in ' },
          { type: 'ref', attrs: { kind: 'town', id: 'town-1', text: 'the city' } },
          { type: 'footnote', attrs: { note: 'Built in year 3' } },
        ],
      },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Map' }] }] }] },
      { type: 'callout', attrs: { kind: 'tip', fold: '', title: null }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Be kind' }] }] },
      { type: 'refCard', attrs: { kind: 'document', id: 'doc-1' } },
    ],
  }

  it('writes the same syntax it reads', () => {
    const md = richTextToMarkdown(doc, resolve)
    expect(md).toBe(
      '##### Notes\n\n==Hot== %%todo later%% #idea in [[Ironhold|the city]][^1]\n\n- [x] Map\n\n> [!tip]\n> Be kind\n\n![[Lore]]\n\n[^1]: Built in year 3\n',
    )
    expect(markdownToRichText(md, findRef)).toEqual(markdownToRichText(richTextToMarkdown(markdownToRichText(md, findRef), resolve), findRef))
  })

  it('leaves comments out of plain text and comments and tags out of the word count', () => {
    expect(richTextToPlainText(doc, resolve)).not.toContain('todo later')
    expect(richTextToPlainText(doc, resolve)).toContain('[1] Built in year 3')
    // Notes, Hot, in, the, city, Map, Tip, Be, kind, Lore
    expect(countRichTextWords(doc, resolve)).toBe(10)
  })
})

describe('looksLikeMarkdown', () => {
  it('spots Markdown and leaves plain prose alone', () => {
    expect(looksLikeMarkdown('# Title\n\ntext')).toBe(true)
    expect(looksLikeMarkdown('Some ==highlight==')).toBe(true)
    expect(looksLikeMarkdown('Just a sentence. Another one.')).toBe(false)
  })
})
