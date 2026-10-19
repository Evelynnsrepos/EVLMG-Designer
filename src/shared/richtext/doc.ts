import { countWords } from '@/core/project/stats'
import { fontStyle, imageStyle } from './styles'
import type { RefTarget, RichTextDoc } from './types'

/** Pure helpers for stored rich text. They need no DOM, so writers, exporters and tests can run anywhere. */

export const REF_NODE = 'ref'
/** `![[Name]]`: a jump card to a document, article or entry, on its own line (0.19). */
export const REF_CARD_NODE = 'refCard'
const isRefNode = (n: RichTextDoc) => n.type === REF_NODE || n.type === REF_CARD_NODE

export function emptyRichText(): RichTextDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

/** Accept a stored doc, a plain string (e.g. an old `notes` field), or nothing, and return a valid doc. */
export function normalizeRichText(value: unknown): RichTextDoc {
  if (value && typeof value === 'object' && (value as RichTextDoc).type === 'doc') return value as RichTextDoc
  if (typeof value === 'string' && value.length > 0) {
    return {
      type: 'doc',
      content: value
        .split(/\r?\n/)
        .map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
    }
  }
  return emptyRichText()
}

function walk(node: RichTextDoc, visit: (n: RichTextDoc) => void) {
  visit(node)
  node.content?.forEach((child) => walk(child, visit))
}

/** Every `[[` link in the document, each target once, in reading order. For backlinks and the connection map. */
export function extractRefs(doc: RichTextDoc): RefTarget[] {
  const seen = new Set<string>()
  const refs: RefTarget[] = []
  walk(doc, (n) => {
    if (!isRefNode(n) || !n.attrs?.id || !n.attrs?.kind) return
    const key = `${n.attrs.kind}:${n.attrs.id}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push({ kind: n.attrs.kind, id: n.attrs.id })
  })
  return refs
}

/** True when the document has no text, images or links. */
export function isRichTextEmpty(doc: RichTextDoc): boolean {
  let empty = true
  walk(doc, (n) => {
    if ((n.type === 'text' && n.text?.trim()) || n.type === 'image' || isRefNode(n) || n.type === 'footnote') empty = false
  })
  return empty
}

/** Returns the current name of a link target, or undefined when it no longer exists. */
export type LabelResolver = (target: RefTarget) => string | undefined

export const MISSING_REF_LABEL = 'missing link'

/** A link's shown text: its own text from `[[Name|text]]`, else the target's current name. */
const refLabel = (n: RichTextDoc, resolve?: LabelResolver) =>
  (n.attrs?.text as string | null) || (resolve?.({ kind: n.attrs?.kind, id: n.attrs?.id }) ?? MISSING_REF_LABEL)
const targetLabel = (n: RichTextDoc, resolve?: LabelResolver) => resolve?.({ kind: n.attrs?.kind, id: n.attrs?.id }) ?? MISSING_REF_LABEL

const hasMark = (n: RichTextDoc, type: string) => n.marks?.some((m) => m.type === type) ?? false

/** Words as the writer sees them, links counted by their current names (live word count, spec 8.6). %%Comments%% and #tags don't count. */
export function countRichTextWords(doc: RichTextDoc, resolve?: LabelResolver): number {
  return countWords(richTextToPlainText(doc, resolve, true))
}

function inlineText(n: RichTextDoc, resolve?: LabelResolver, forCount = false): string {
  if (n.type === 'text') return hasMark(n, 'comment') || (forCount && hasMark(n, 'tag')) ? '' : (n.text ?? '')
  if (n.type === REF_NODE) return refLabel(n, resolve)
  if (n.type === 'hardBreak') return '\n'
  if (n.type === 'footnote') return ''
  return (n.content ?? []).map((c) => inlineText(c, resolve, forCount)).join('')
}

const isList = (n: RichTextDoc) => n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList'
const bulletFor = (list: RichTextDoc, i: number, item: RichTextDoc) =>
  list.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}] ` : list.type === 'bulletList' ? '- ' : `${(list.attrs?.start ?? 1) + i}. `

const CALLOUT_TITLE = (n: RichTextDoc) => (n.attrs?.title as string | null) || capitalize(String(n.attrs?.kind ?? 'note'))
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Footnote texts in reading order; their number is their place in this list. */
function footnotes(doc: RichTextDoc): string[] {
  const notes: string[] = []
  walk(doc, (n) => void (n.type === 'footnote' && notes.push((n.attrs?.note as string) ?? '')))
  return notes
}

/** Plain text export: one line per block, links as their names, footnotes at the end. */
export function richTextToPlainText(doc: RichTextDoc, resolve?: LabelResolver, forCount = false): string {
  const lines: string[] = []
  const text = (n: RichTextDoc) => inlineText(n, resolve, forCount)
  const block = (n: RichTextDoc, indent: string) => {
    if (n.type === 'doc' || n.type === 'blockquote') {
      n.content?.forEach((c) => block(c, indent))
    } else if (n.type === 'callout') {
      lines.push(indent + CALLOUT_TITLE(n))
      n.content?.forEach((c) => block(c, indent))
    } else if (isList(n)) {
      n.content?.forEach((item, i) =>
        item.content?.forEach((c, j) => {
          if (isList(c)) block(c, indent + '   ')
          else lines.push(indent + (forCount ? '' : j === 0 ? bulletFor(n, i, item) : '   ') + text(c))
        }),
      )
    } else if (n.type === 'table') {
      n.content?.forEach((row) => lines.push(indent + (row.content ?? []).map(text).join('\t')))
    } else if (n.type === 'horizontalRule') {
      lines.push('---')
    } else if (n.type === 'image') {
      if (n.attrs?.alt) lines.push(indent + n.attrs.alt)
    } else if (n.type === REF_CARD_NODE) {
      lines.push(indent + targetLabel(n, resolve))
    } else {
      lines.push(indent + text(n))
    }
  }
  block(doc, '')
  if (!forCount) footnotes(doc).forEach((note, i) => lines.push(`${i ? '' : '\n'}[${i + 1}] ${note}`))
  return lines.join('\n').trim()
}

function escapeMarkdown(text: string) {
  return text.replace(/([\\`*_[\]#<>~])/g, '\\$1')
}

function inlineMarkdown(nodes: RichTextDoc[] | undefined, resolve?: LabelResolver, note?: () => number): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === REF_NODE) return n.attrs?.text ? `[[${targetLabel(n, resolve)}|${n.attrs.text}]]` : `[[${refLabel(n, resolve)}]]`
      if (n.type === 'hardBreak') return '  \n'
      if (n.type === 'footnote') return note ? `[^${note()}]` : ''
      if (n.type !== 'text') return inlineMarkdown(n.content, resolve, note)
      const marks = n.marks ?? []
      const has = (type: string) => marks.some((m) => m.type === type)
      if (has('tag')) return n.text ?? ''
      let text = has('code') ? '`' + (n.text ?? '') + '`' : escapeMarkdown(n.text ?? '')
      if (has('comment')) return `%%${n.text ?? ''}%%`
      if (has('highlight')) text = `==${text}==`
      if (has('bold')) text = `**${text}**`
      if (has('italic')) text = `*${text}*`
      if (has('underline')) text = `<u>${text}</u>`
      if (has('strike')) text = `~~${text}~~`
      const link = marks.find((m) => m.type === 'link')
      if (link?.attrs?.href) text = `[${text}](${link.attrs.href})`
      return text
    })
    .join('')
}

/** Markdown export (spec 8.6). Links become `[[Name]]`, plus `==highlight==`, `> [!note]` callouts, `- [ ]` and footnotes (0.19). */
export function richTextToMarkdown(doc: RichTextDoc, resolve?: LabelResolver): string {
  const notes = footnotes(doc)
  let noteCount = 0
  const next = () => ++noteCount
  const md = (nodes: RichTextDoc[] | undefined) => inlineMarkdown(nodes, resolve, next)
  const render = (n: RichTextDoc, indent: string, quote: string): string[] => {
    const lead = quote + indent
    switch (n.type) {
      case 'doc':
        return (n.content ?? []).flatMap((c) => render(c, indent, quote))
      case 'blockquote':
        return (n.content ?? []).flatMap((c) => render(c, indent, quote + '> '))
      case 'callout': {
        const head = `${lead}> [!${n.attrs?.kind ?? 'note'}]${n.attrs?.fold ?? ''}${n.attrs?.title ? ' ' + n.attrs.title : ''}`
        // Blocks inside a callout are joined by an empty quoted line, so it stays one callout.
        const body = (n.content ?? []).flatMap((c) => render(c, indent, quote + '> ')).join(`\n${quote}${indent}>\n`)
        return [`${head}\n${body}`]
      }
      case 'heading':
        return [`${lead}${'#'.repeat(n.attrs?.level ?? 1)} ${md(n.content)}`]
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        const lines = (n.content ?? []).flatMap((item, i) =>
          (item.content ?? []).flatMap((c, j) =>
            isList(c) ? render(c, indent + '   ', quote) : [lead + (j === 0 ? bulletFor(n, i, item) : '   ') + md(c.content)],
          ),
        )
        return [lines.join('\n')]
      }
      case 'table': {
        const rows = (n.content ?? []).map((row) => `${lead}| ${(row.content ?? []).map((c) => md(c.content?.flatMap((p) => p.content ?? [])).replace(/\|/g, '\\|')).join(' | ')} |`)
        const cols = n.content?.[0]?.content?.length ?? 1
        rows.splice(1, 0, `${lead}|${' --- |'.repeat(cols)}`)
        return [rows.join('\n')]
      }
      case REF_CARD_NODE:
        return [`${lead}![[${targetLabel(n, resolve)}]]`]
      case 'codeBlock':
        return [`${lead}\`\`\`\n${inlineText(n)}\n\`\`\``]
      case 'horizontalRule':
        return [`${lead}---`]
      case 'image':
        return [`${lead}![${escapeMarkdown(n.attrs?.alt ?? '')}](${n.attrs?.src ?? ''})`]
      default:
        return [lead + md(n.content)]
    }
  }
  const body = render(doc, '', '').join('\n\n').trim()
  return body + (notes.length ? '\n\n' + notes.map((note, i) => `[^${i + 1}]: ${note}`).join('\n') : '') + '\n'
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** HTML for the Design Book export (v0.7). `image` turns a stored path into a src (e.g. a data URL). */
export function richTextToHtml(doc: RichTextDoc, resolve?: LabelResolver, image: (src: string) => string = (s) => s): string {
  let noteCount = 0
  const inline = (nodes: RichTextDoc[] | undefined): string =>
    (nodes ?? [])
      .map((n) => {
        if (n.type === REF_NODE) return `<span class="ref">${escapeHtml(refLabel(n, resolve))}</span>`
        if (n.type === 'hardBreak') return '<br>'
        if (n.type === 'footnote') return `<sup title="${escapeHtml(n.attrs?.note ?? '')}">${++noteCount}</sup>`
        if (n.type !== 'text') return inline(n.content)
        if (hasMark(n, 'comment')) return ''
        const marks = n.marks ?? []
        let html = escapeHtml(n.text ?? '')
        for (const m of marks) {
          if (m.type === 'bold') html = `<strong>${html}</strong>`
          else if (m.type === 'italic') html = `<em>${html}</em>`
          else if (m.type === 'underline') html = `<u>${html}</u>`
          else if (m.type === 'strike') html = `<s>${html}</s>`
          else if (m.type === 'code') html = `<code>${html}</code>`
          else if (m.type === 'highlight') html = `<mark>${html}</mark>`
          else if (m.type === 'tag') html = `<span class="tag">${html}</span>`
          else if (m.type === 'link' && /^https?:/i.test(m.attrs?.href ?? '')) html = `<a href="${escapeHtml(m.attrs!.href)}">${html}</a>`
          else if (m.type === 'font') html = `<span style="${escapeHtml(fontStyle(m.attrs?.family, m.attrs?.size))}">${html}</span>`
        }
        return html
      })
      .join('')
  const block = (n: RichTextDoc): string => {
    const inner = () => (n.content ?? []).map(block).join('')
    switch (n.type) {
      case 'doc':
        return inner()
      case 'blockquote':
        return `<blockquote>${inner()}</blockquote>`
      case 'heading': {
        // Article headings sit below the book's own h1/h2.
        const level = Math.min(6, (n.attrs?.level ?? 1) + 2)
        return `<h${level}>${inline(n.content)}</h${level}>`
      }
      case 'bulletList':
        return `<ul>${inner()}</ul>`
      case 'orderedList':
        return `<ol>${inner()}</ol>`
      case 'listItem':
        return `<li>${inner()}</li>`
      case 'taskList':
        return `<ul class="tasks">${inner()}</ul>`
      case 'taskItem':
        return `<li><input type="checkbox" disabled${n.attrs?.checked ? ' checked' : ''}> ${inner()}</li>`
      case 'callout':
        return `<div class="callout callout-${escapeHtml(String(n.attrs?.kind ?? 'note'))}"><p><strong>${escapeHtml(CALLOUT_TITLE(n))}</strong></p>${inner()}</div>`
      case 'table':
        return `<table>${inner()}</table>`
      case 'tableRow':
        return `<tr>${inner()}</tr>`
      case 'tableHeader':
        return `<th>${inner()}</th>`
      case 'tableCell':
        return `<td>${inner()}</td>`
      case REF_CARD_NODE:
        return `<p class="ref">${escapeHtml(targetLabel(n, resolve))}</p>`
      case 'codeBlock':
        return `<pre><code>${escapeHtml(inlineText(n))}</code></pre>`
      case 'horizontalRule':
        return '<hr>'
      case 'image':
        if (!n.attrs?.src) return ''
        if (!n.attrs.width && !n.attrs.align) return `<img src="${escapeHtml(image(n.attrs.src))}" alt="${escapeHtml(n.attrs?.alt ?? '')}">`
        return `<div style="${imageStyle(n.attrs.width, n.attrs.align)}"><img style="width:100%" src="${escapeHtml(image(n.attrs.src))}" alt="${escapeHtml(n.attrs?.alt ?? '')}"></div>`
      default:
        return `<p>${inline(n.content)}</p>`
    }
  }
  return block(doc)
}
