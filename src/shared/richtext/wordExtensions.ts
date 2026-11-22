import { Extension, Mark, mergeAttributes, Node, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Word processor formatting for the Writer (0.35): small caps, superscript, subscript, text colour,
 * alignment, indent, page breaks and a table of contents that updates itself. Part of every rich
 * text editor (so text pasted from the Writer into the Wiki keeps its look); only the Writer's
 * ribbon has buttons for them.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wordFormat: {
      setTextAlign: (align: 'left' | 'center' | 'right' | 'justify') => ReturnType
      setLineHeight: (height: number | null) => ReturnType
      changeIndent: (step: 1 | -1) => ReturnType
      setPageBreak: () => ReturnType
      setTableOfContents: () => ReturnType
    }
  }
}

const simpleMark = (name: string, tag: string, shortcut: string, style?: string) =>
  Mark.create({
    name,
    // Superscript and subscript can't both be on the same letters.
    excludes: name === 'superscript' ? 'subscript' : name === 'subscript' ? 'superscript' : undefined,
    parseHTML: () => [style ? { tag: `${tag}[data-${name}]` } : { tag }],
    renderHTML: ({ HTMLAttributes }) => [tag, mergeAttributes(style ? { [`data-${name}`]: '', style } : {}, HTMLAttributes), 0],
    addKeyboardShortcuts() {
      return { [shortcut]: () => this.editor.commands.toggleMark(this.name) }
    },
  })

/** Kapitälchen: small letters drawn as small capitals. */
export const SmallCaps = simpleMark('smallCaps', 'span', 'Mod-Shift-k', 'font-variant:small-caps')
export const Superscript = simpleMark('superscript', 'sup', 'Mod-.')
export const Subscript = simpleMark('subscript', 'sub', 'Mod-,')

/** Text colour; one mark, so changing the colour replaces the old one. */
export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes: () => ({ color: { default: null, parseHTML: (el) => el.style.color || null } }),
  parseHTML: () => [{ tag: 'span[data-color]' }],
  renderHTML: ({ HTMLAttributes: a }) => ['span', { 'data-color': '', style: a.color ? `color:${a.color}` : '' }, 0],
})

const ALIGNS = ['left', 'center', 'right', 'justify'] as const
const BLOCKS = ['paragraph', 'heading']
export const MAX_INDENT = 8

/** Alignment and indent for paragraphs and headings; stored as block attributes. */
export const BlockFormat = Extension.create({
  name: 'wordFormat',
  addGlobalAttributes: () => [
    {
      types: BLOCKS,
      attributes: {
        textAlign: {
          default: null,
          parseHTML: (el) => (ALIGNS as readonly string[]).includes(el.style.textAlign) ? el.style.textAlign : null,
          renderHTML: (a) => (a.textAlign ? { style: `text-align:${a.textAlign}` } : {}),
        },
        lineHeight: {
          default: null,
          parseHTML: (el) => Number(el.style.lineHeight) || null,
          renderHTML: (a) => (a.lineHeight ? { style: `line-height:${a.lineHeight}` } : {}),
        },
        indent: {
          default: 0,
          parseHTML: (el) => (el.style.marginLeft.endsWith('em') ? Math.min(MAX_INDENT, Math.round(parseFloat(el.style.marginLeft) / 2) || 0) : 0),
          renderHTML: (a) => (a.indent ? { style: `margin-left:${a.indent * 2}em` } : {}),
        },
      },
    },
  ],
  addCommands: () => ({
    // Left is the normal look, so it is stored as "nothing set".
    setTextAlign:
      (align) =>
      ({ commands }) =>
        BLOCKS.map((t) => commands.updateAttributes(t, { textAlign: align === 'left' ? null : align })).some(Boolean),
    // null = the document's line spacing from the View tab.
    setLineHeight:
      (height) =>
      ({ commands }) =>
        BLOCKS.map((t) => commands.updateAttributes(t, { lineHeight: height })).some(Boolean),
    changeIndent:
      (step) =>
      ({ editor, state, tr, dispatch }) => {
        // In a list, indent means nesting the item, like everywhere else.
        if (editor.isActive('listItem') || editor.isActive('taskItem')) {
          const item = editor.isActive('taskItem') ? 'taskItem' : 'listItem'
          return step > 0 ? editor.commands.sinkListItem(item) : editor.commands.liftListItem(item)
        }
        let changed = false
        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
          if (!BLOCKS.includes(node.type.name)) return
          const indent = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent ?? 0) + step))
          if (indent === node.attrs.indent) return false
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent })
          changed = true
          return false
        })
        if (changed) dispatch?.(tr)
        return changed
      },
    setPageBreak:
      () =>
      ({ commands }) =>
        commands.insertContent({ type: 'pageBreak' }),
    setTableOfContents:
      () =>
      ({ commands }) =>
        commands.insertContent({ type: 'tableOfContents' }),
  }),
  addKeyboardShortcuts() {
    const align = (a: (typeof ALIGNS)[number]) => () => this.editor.commands.setTextAlign(a)
    return {
      'Mod-Shift-l': align('left'),
      'Mod-Shift-e': align('center'),
      'Mod-Shift-r': align('right'),
      'Mod-Shift-j': align('justify'),
      'Mod-]': () => this.editor.commands.changeIndent(1),
      'Mod-[': () => this.editor.commands.changeIndent(-1),
      'Mod-Enter': () => this.editor.commands.setPageBreak(),
    }
  },
})

/** Starts a new page when printed; a dashed line on screen. */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: () => ['div', { 'data-page-break': '', class: 'richtext-page-break', contenteditable: 'false' }],
  renderText: () => '\n',
})

/** The headings of a document, in order, for the table of contents. */
export function headingsOf(doc: PMNode) {
  const list: { level: number; text: string; pos: number }[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') list.push({ level: node.attrs.level, text: node.textContent, pos })
    return node.type.name !== 'heading'
  })
  return list
}

/** A table of contents block: lists every heading, follows edits, click an entry to jump there. */
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'nav[data-toc]' }],
  renderHTML: () => ['nav', { 'data-toc': '', class: 'richtext-toc' }],
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement('nav')
      dom.className = 'richtext-toc'
      dom.contentEditable = 'false'
      let last = ''
      const paint = () => {
        const list = headingsOf(editor.state.doc)
        const key = JSON.stringify(list.map((h) => [h.level, h.text]))
        if (key === last) return
        last = key
        dom.replaceChildren(Object.assign(document.createElement('div'), { className: 'richtext-toc-title', textContent: TOC_TITLE }))
        if (!list.length) dom.append(Object.assign(document.createElement('div'), { className: 'richtext-toc-empty', textContent: TOC_EMPTY }))
        list.forEach((h, i) => {
          const row = document.createElement('button')
          row.type = 'button'
          row.className = 'richtext-toc-item'
          row.style.paddingLeft = `${(h.level - 1) * 1.2}em`
          row.textContent = h.text || '…'
          row.addEventListener('mousedown', (e) => e.preventDefault())
          row.addEventListener('click', () => jumpToHeading(editor, i))
          dom.append(row)
        })
      }
      paint()
      editor.on('update', paint)
      return { dom, ignoreMutation: () => true, destroy: () => void editor.off('update', paint) }
    }
  },
})

const TOC_TITLE = 'Contents'
const TOC_EMPTY = 'Add headings and they show up here.'

/** Puts the caret in the n-th heading and scrolls it into view. */
export function jumpToHeading(editor: Editor, index: number) {
  const h = headingsOf(editor.state.doc)[index]
  if (h) editor.chain().focus().setTextSelection(h.pos + 1).scrollIntoView().run()
}

export function wordExtensions() {
  return [SmallCaps, Superscript, Subscript, TextColor, BlockFormat, PageBreak, TableOfContents]
}

/** Changes the letter case of the selected text, keeping its formatting. */
export type CaseMode = 'upper' | 'lower' | 'title' | 'sentence'
export function changeCase(text: string, mode: CaseMode, startsSentence = true) {
  if (mode === 'upper') return text.toLocaleUpperCase()
  if (mode === 'lower') return text.toLocaleLowerCase()
  let out = ''
  let start = startsSentence
  let wordStart = true
  for (const ch of text) {
    const letter = /\p{L}/u.test(ch)
    if (letter) out += (mode === 'title' ? wordStart : start) ? ch.toLocaleUpperCase() : ch.toLocaleLowerCase()
    else out += ch
    if (letter) start = false
    else if (/[.!?]/.test(ch)) start = true
    wordStart = !letter && !/['’]/.test(ch)
  }
  return out
}

export function changeSelectionCase(editor: Editor, mode: CaseMode) {
  const { from, to } = editor.state.selection
  if (from === to) return
  const tr = editor.state.tr
  const parts: { pos: number; node: PMNode; start: number; end: number }[] = []
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) parts.push({ pos, node, start: Math.max(from, pos), end: Math.min(to, pos + node.nodeSize) })
  })
  // The text before the selection says whether it starts a sentence.
  const before = editor.state.doc.textBetween(Math.max(0, from - 3), from, '\n')
  let sentence = !before.trim() || /[.!?\n]\s*$/.test(before)
  const mapped = parts.map((p) => {
    const text = p.node.text!.slice(p.start - p.pos, p.end - p.pos)
    const next = changeCase(text, mode, sentence)
    if (/\p{L}/u.test(text)) sentence = /[.!?]\s*$/.test(text)
    return { ...p, next }
  })
  // From the end, so earlier positions stay right even when a letter grows (ß to SS).
  for (const p of mapped.reverse()) tr.replaceWith(p.start, p.end, editor.schema.text(p.next, p.node.marks))
  tr.setSelection(editor.state.selection.map(tr.doc, tr.mapping))
  editor.view.dispatch(tr)
}
