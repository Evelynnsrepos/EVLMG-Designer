import { Marked, type Token, type Tokens, type TokenizerExtension } from 'marked'
import { REF_CARD_NODE, REF_NODE } from './doc'
import type { RefTarget, RichTextDoc } from './types'

/**
 * Markdown text -> stored rich text, for pasting and importing with the Writer's
 * Markdown Syntax switch (0.19). Needs no DOM. Understands normal Markdown plus
 * `==highlight==`, `%%comments%%`, `#tags`, `[[Name]]` / `[[Name|text]]`, `![[Name]]`,
 * `- [ ]` checklists, `> [!note]` callouts, footnotes and tables.
 */

/** Finds a link target by its exact name; undefined when nothing has that name. */
export type FindRef = (label: string) => RefTarget | undefined

type Mark = { type: string; attrs?: Record<string, unknown> }
type Inline = RichTextDoc

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i
const CALLOUT = /^\[!(\w+)\]([+-]?)[ \t]*(.*)$/
/** A tag needs at least one letter, so "issue #1" stays text. */
const TAG = /^#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/u

const inlineRule = (name: string, startAt: string | RegExp, re: RegExp, extra?: (m: RegExpExecArray) => object): TokenizerExtension => ({
  name,
  level: 'inline',
  start: (src) => {
    const i = typeof startAt === 'string' ? src.indexOf(startAt) : src.search(startAt)
    return i < 0 ? undefined : i
  },
  tokenizer(src) {
    const m = re.exec(src)
    return m ? { type: name, raw: m[0], text: m[1], ...extra?.(m) } : undefined
  },
})

const parser = new Marked({
  gfm: true,
  extensions: [
    {
      name: 'footnoteDef',
      level: 'block',
      start: (src) => src.match(/^\[\^/m)?.index,
      tokenizer(src) {
        const m = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)(?:\n|$)/.exec(src)
        return m ? { type: 'footnoteDef', raw: m[0], label: m[1], text: m[2].replace(/\n\s+/g, ' ').trim() } : undefined
      },
    },
    inlineRule('wikiEmbed', '![[', /^!\[\[([^[\]\n]+)\]\]/),
    inlineRule('wikiLink', '[[', /^\[\[([^[\]\n]+)\]\]/),
    inlineRule('inlineFootnote', '^[', /^\^\[([^\]\n]+)\]/),
    inlineRule('footnoteRef', '[^', /^\[\^([^\]\s]+)\]/),
    inlineRule('comment', '%%', /^%%([\s\S]+?)%%/),
    {
      name: 'highlight',
      level: 'inline',
      start: (src) => (src.includes('==') ? src.indexOf('==') : undefined),
      tokenizer(src) {
        const m = /^==(?=\S)([^=\n]+?)==/.exec(src)
        return m ? { type: 'highlight', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) } : undefined
      },
    },
    // Only where a tag can start: at the beginning or after a space.
    inlineRule('tag', /(?:^|(?<=\s))#[\p{L}\p{N}_/-]/u, TAG),
  ],
})

/** Read Markdown into a rich text document. `findRef` turns `[[Name]]` into links; unknown names stay as text. */
export function markdownToRichText(markdown: string, findRef: FindRef = () => undefined): RichTextDoc {
  const tokens = parser.lexer(markdown.replace(/\r\n?/g, '\n'))
  const notes = new Map<string, string>()
  const collect = (list: Token[]) =>
    list.forEach((t) => {
      if (t.type === 'footnoteDef') notes.set(t.label, t.text)
      if ('tokens' in t && t.tokens) collect(t.tokens)
    })
  collect(tokens)

  const text = (value: string, marks: Mark[]): Inline[] => (value ? [{ type: 'text', text: value, ...(marks.length ? { marks } : {}) }] : [])

  /** Inline content; images and embeds come back as blocks, and `paragraphs` splits around them. */
  const inline = (list: Token[] | undefined, marks: Mark[] = []): Inline[] => {
    const out: Inline[] = []
    let own = marks
    for (const t of list ?? []) {
      const tok = t as Tokens.Generic
      switch (t.type) {
        case 'text':
          out.push(...(tok.tokens ? inline(tok.tokens, own) : text(tok.text, own)))
          break
        case 'escape':
          out.push(...text(tok.text, own))
          break
        case 'strong':
          out.push(...inline(tok.tokens, [...own, { type: 'bold' }]))
          break
        case 'em':
          out.push(...inline(tok.tokens, [...own, { type: 'italic' }]))
          break
        case 'del':
          out.push(...inline(tok.tokens, [...own, { type: 'strike' }]))
          break
        case 'highlight':
          out.push(...inline(tok.tokens, [...own, { type: 'highlight' }]))
          break
        case 'codespan':
          out.push(...text(tok.text, [...own, { type: 'code' }]))
          break
        case 'link':
          out.push(...inline(tok.tokens, [...own, { type: 'link', attrs: { href: tok.href } }]))
          break
        case 'image':
          out.push({ type: 'image', attrs: { src: tok.href, alt: tok.text || null } })
          break
        case 'br':
          out.push({ type: 'hardBreak' })
          break
        case 'comment':
          out.push(...text(tok.text, [...own, { type: 'comment' }]))
          break
        case 'tag':
          out.push(...text(tok.raw, [...own, { type: 'tag' }]))
          break
        case 'footnoteRef':
          out.push({ type: 'footnote', attrs: { note: notes.get(tok.text) ?? '' } })
          break
        case 'inlineFootnote':
          out.push({ type: 'footnote', attrs: { note: tok.text } })
          break
        case 'wikiLink': {
          const [target, shown] = tok.text.split('|')
          const hit = findRef(target.split('#')[0].trim())
          out.push(...(hit ? [{ type: REF_NODE, attrs: { kind: hit.kind, id: hit.id, text: shown?.trim() || null } }] : text(tok.raw, own)))
          break
        }
        case 'wikiEmbed': {
          const name = tok.text.split('|')[0].trim()
          const hit = IMAGE_FILE.test(name) ? undefined : findRef(name.split('#')[0])
          if (IMAGE_FILE.test(name)) out.push({ type: 'image', attrs: { src: name, alt: null } })
          else out.push(...(hit ? [{ type: REF_CARD_NODE, attrs: { kind: hit.kind, id: hit.id } }] : text(tok.raw, own)))
          break
        }
        case 'html':
          // Our own export writes underline as <u>…</u>; other HTML stays as written.
          if (/^<u>$/i.test(tok.raw)) own = [...own, { type: 'underline' }]
          else if (/^<\/u>$/i.test(tok.raw)) own = own.filter((m) => m.type !== 'underline')
          else if (/^<br\s*\/?>$/i.test(tok.raw)) out.push({ type: 'hardBreak' })
          else out.push(...text(tok.raw, own))
          break
        case 'checkbox':
          break
        default:
          out.push(...text(tok.raw, own))
      }
    }
    return out
  }

  const isBlock = (n: Inline) => n.type === 'image' || n.type === REF_CARD_NODE

  /** Paragraph(s) from inline tokens, split around images and embeds (those are blocks here). */
  const paragraphs = (list: Token[] | undefined): RichTextDoc[] => {
    const out: RichTextDoc[] = []
    let run: Inline[] = []
    const flush = () => {
      // Whitespace left between two pictures is not a paragraph.
      if (run.some((n) => n.type !== 'text' || n.text?.trim())) out.push({ type: 'paragraph', content: run })
      run = []
    }
    for (const n of inline(list)) {
      if (isBlock(n)) {
        flush()
        out.push(n)
      } else run.push(n)
    }
    flush()
    return out.length ? out : [{ type: 'paragraph' }]
  }

  /** List items must start with a paragraph. */
  const itemContent = (list: Token[]) => {
    const content = blocks(list)
    return content[0]?.type === 'paragraph' ? content : [{ type: 'paragraph' }, ...content]
  }

  const cell = (type: string, c: Tokens.TableCell) => ({ type, content: [{ type: 'paragraph', content: inline(c.tokens) }] })

  const blocks = (list: Token[]): RichTextDoc[] =>
    list.flatMap((t): RichTextDoc[] => {
      const tok = t as Tokens.Generic
      switch (t.type) {
        case 'space':
        case 'checkbox':
        case 'def':
        case 'footnoteDef':
          return []
        case 'heading':
          return [{ type: 'heading', attrs: { level: tok.depth }, content: inline(tok.tokens) }]
        case 'paragraph':
        case 'text':
          return paragraphs(tok.tokens ?? [{ type: 'text', raw: tok.text, text: tok.text } as Token])
        case 'list': {
          const items = (t as Tokens.List).items
          if (items.some((i) => i.task)) {
            return [{ type: 'taskList', content: items.map((i) => ({ type: 'taskItem', attrs: { checked: !!i.checked }, content: itemContent(i.tokens) })) }]
          }
          const ordered = (t as Tokens.List).ordered
          return [
            {
              type: ordered ? 'orderedList' : 'bulletList',
              ...(ordered ? { attrs: { start: Number((t as Tokens.List).start) || 1 } } : {}),
              content: items.map((i) => ({ type: 'listItem', content: itemContent(i.tokens) })),
            },
          ]
        }
        case 'blockquote': {
          const [first, ...rest] = tok.text.split('\n')
          const callout = CALLOUT.exec(first)
          if (!callout) return [{ type: 'blockquote', content: blocks(tok.tokens ?? []) }]
          const body = blocks(parser.lexer(rest.join('\n')))
          return [
            {
              type: 'callout',
              attrs: { kind: callout[1].toLowerCase(), fold: callout[2], title: callout[3].trim() || null },
              content: body.length ? body : [{ type: 'paragraph' }],
            },
          ]
        }
        case 'code':
          return [{ type: 'codeBlock', attrs: { language: tok.lang || null }, ...(tok.text ? { content: [{ type: 'text', text: tok.text }] } : {}) }]
        case 'hr':
          return [{ type: 'horizontalRule' }]
        case 'table': {
          const table = t as Tokens.Table
          return [
            {
              type: 'table',
              content: [
                { type: 'tableRow', content: table.header.map((c) => cell('tableHeader', c)) },
                ...table.rows.map((row) => ({ type: 'tableRow', content: row.map((c) => cell('tableCell', c)) })),
              ],
            },
          ]
        }
        default:
          return tok.raw.trim() ? [{ type: 'paragraph', content: text(tok.raw.trim(), []) }] : []
      }
    })

  const content = blocks(tokens)
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

/** True when pasted plain text uses Markdown, so it is worth converting instead of pasting as is. */
export function looksLikeMarkdown(text: string): boolean {
  return /^(#{1,6} |[-*+] |\d+\. |> |```|\|.*\||- \[[ xX]\] )|\*\*\S|==\S|\[\[|\]\(|%%|\[\^/m.test(text)
}
