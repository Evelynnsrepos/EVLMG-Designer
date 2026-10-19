import { Extension, InputRule, Mark, markInputRule, mergeAttributes, Node } from '@tiptap/core'
import Heading from '@tiptap/extension-heading'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { promptDialog } from '../dialogs'
import { looksLikeMarkdown, markdownToRichText } from './markdown'
import { findRefByLabel } from './refs'
import type { RefProvider } from './types'

/**
 * Extra formats for the Writer's "Markdown Syntax" switch (0.19): highlight, comments, tags,
 * headings 4 to 6, checklists, callouts, footnotes and tables. They are always part of the
 * editor, so switching off never loses anything; the switch only turns their typing rules
 * and Markdown paste on or off.
 */

export interface SyntaxOptions {
  /** Read on every keystroke, so the switch works without rebuilding the editor. */
  enabled: () => boolean
}

/** The same rules, applied only while the switch is on. */
export const gated = (enabled: () => boolean, rules: InputRule[]) =>
  rules.map((r) => new InputRule({ find: r.find, undoable: r.undoable, handler: (props) => (enabled() ? r.handler(props) : null) }))

const off = () => false

export const CALLOUT_KINDS = ['note', 'info', 'tip', 'success', 'question', 'warning', 'danger', 'bug', 'example', 'quote'] as const

/** H1 to H3 work as always; `#### ` to `###### ` only with the switch on. */
export const SyntaxHeading = Heading.extend<SyntaxOptions & { levels: (1 | 2 | 3 | 4 | 5 | 6)[] }>({
  addOptions() {
    return { ...this.parent!(), levels: [1, 2, 3, 4, 5, 6], enabled: off }
  },
  addInputRules() {
    const rules = this.parent!()
    return [...rules.slice(0, 3), ...gated(this.options.enabled, rules.slice(3))]
  },
})

/** `==text==` */
export const Highlight = Mark.create<SyntaxOptions>({
  name: 'highlight',
  addOptions: () => ({ enabled: off }),
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: ({ HTMLAttributes }) => ['mark', mergeAttributes({ class: 'richtext-highlight' }, HTMLAttributes), 0],
  addInputRules() {
    return gated(this.options.enabled, [markInputRule({ find: /(?:^|\s)(==(?!\s)([^=]+)==)$/, type: this.type })])
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.toggleMark(this.name) }
  },
})

/** `%%text%%`: a note to yourself, greyed, left out of exports and the word count. */
export const Comment = Mark.create<SyntaxOptions>({
  name: 'comment',
  inclusive: false,
  addOptions: () => ({ enabled: off }),
  parseHTML: () => [{ tag: 'span[data-comment]' }],
  renderHTML: () => ['span', { 'data-comment': '', class: 'richtext-comment', title: 'Comment: not exported or counted' }, 0],
  addInputRules() {
    return gated(this.options.enabled, [markInputRule({ find: /(?:^|\s)(%%([^%]+)%%)$/, type: this.type })])
  },
})

/** `#tag` (shown as a chip; letters, digits, `_`, `-` and `/` for nested tags). */
export const Tag = Mark.create<SyntaxOptions>({
  name: 'tag',
  inclusive: false,
  addOptions: () => ({ enabled: off }),
  parseHTML: () => [{ tag: 'span[data-tag]' }],
  renderHTML: () => ['span', { 'data-tag': '', class: 'richtext-tag' }, 0],
  addInputRules() {
    const type = this.type
    return gated(this.options.enabled, [
      new InputRule({
        // Runs once the space after the tag is typed; the space stays plain text.
        find: /(?:^|\s)(#[\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)\s$/u,
        handler: ({ state, range, match }) => {
          const end = range.to - 1
          state.tr.addMark(end - match[1].length, end, type.create()).removeStoredMark(type)
        },
      }),
    ])
  },
})

/** `- [ ] ` / `- [x] ` (also `[ ] ` on its own line) */
export const SyntaxTaskItem = TaskItem.extend<SyntaxOptions & { nested: boolean }>({
  addOptions() {
    return { ...this.parent!(), nested: true, enabled: off }
  },
  addInputRules() {
    return gated(this.options.enabled, [
      new InputRule({
        find: /^\[([ xX]?)\]\s$/,
        handler: ({ range, match, chain }) => {
          const run = chain().deleteRange(range).toggleTaskList()
          if (match[1].trim()) run.updateAttributes('taskItem', { checked: true })
          run.run()
        },
      }),
    ])
  },
})

/** `> [!note] ` and friends. Folding (`[!note]-`) is clicked open and shut on the title bar. */
export const Callout = Node.create<SyntaxOptions>({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addOptions: () => ({ enabled: off }),

  addAttributes() {
    return {
      kind: { default: 'note', parseHTML: (el) => el.getAttribute('data-callout'), renderHTML: (a) => ({ 'data-callout': a.kind }) },
      title: { default: null, parseHTML: (el) => el.getAttribute('data-title'), renderHTML: (a) => (a.title ? { 'data-title': a.title } : {}) },
      /** '' = can't fold, '+' = open, '-' = folded */
      fold: { default: '', parseHTML: (el) => el.getAttribute('data-fold') ?? '', renderHTML: (a) => (a.fold ? { 'data-fold': a.fold } : {}) },
    }
  },

  parseHTML: () => [{ tag: 'div[data-callout]', contentElement: '.richtext-callout-body' }],

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ class: 'richtext-callout' }, HTMLAttributes),
      ['div', { class: 'richtext-callout-title', contenteditable: 'false' }, calloutTitle(node.attrs)],
      ['div', { class: 'richtext-callout-body' }, 0],
    ]
  },

  addNodeView() {
    return ({ node: initial, editor, getPos }) => {
      let node = initial
      const dom = document.createElement('div')
      dom.className = 'richtext-callout'
      const head = document.createElement('div')
      head.className = 'richtext-callout-title'
      head.contentEditable = 'false'
      const title = document.createElement('span')
      const fold = document.createElement('button')
      fold.type = 'button'
      fold.className = 'richtext-callout-fold'
      const body = document.createElement('div')
      body.className = 'richtext-callout-body'
      head.append(title, fold)
      dom.append(head, body)

      const set = (attrs: Record<string, unknown>) => {
        const pos = getPos()
        if (typeof pos === 'number') editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }))
      }
      const paint = () => {
        dom.dataset.callout = node.attrs.kind
        dom.dataset.fold = node.attrs.fold
        title.textContent = calloutTitle(node.attrs)
        title.title = editor.isEditable ? 'Click to rename' : ''
        fold.hidden = !node.attrs.fold
        fold.textContent = node.attrs.fold === '-' ? '▸' : '▾'
        fold.setAttribute('aria-label', node.attrs.fold === '-' ? 'Unfold' : 'Fold')
      }
      title.addEventListener('click', async () => {
        if (!editor.isEditable) return
        const next = await promptDialog('Callout title', calloutTitle(node.attrs))
        if (next != null) set({ title: next.trim() || null })
      })
      fold.addEventListener('mousedown', (e) => e.preventDefault())
      fold.addEventListener('click', () => set({ fold: node.attrs.fold === '-' ? '+' : '-' }))
      paint()
      return {
        dom,
        contentDOM: body,
        update(next) {
          if (next.type !== node.type) return false
          node = next
          paint()
          return true
        },
        ignoreMutation: (m) => !body.contains(m.target),
      }
    }
  },

  addInputRules() {
    const type = this.type
    return gated(this.options.enabled, [
      new InputRule({
        // Typed at the start of a quote (`> ` already made one): `[!warning] `, `[!tip]- `
        find: /^\[!(\w+)\]([+-]?)\s$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.depth < 2 || $from.node(-1).type.name !== 'blockquote' || $from.index(-1) !== 0) return null
          state.tr.delete(range.from, range.to).setNodeMarkup($from.before(-1), type, { kind: match[1].toLowerCase(), fold: match[2], title: null })
        },
      }),
    ])
  },
})

const calloutTitle = (a: Record<string, unknown>) => (a.title as string | null) || String(a.kind ?? 'note').replace(/^./, (c) => c.toUpperCase())

/** A footnote: a small number in the text; its note shows on hover and is edited with a click. `^[note]` or `[^1]` makes one. */
export const Footnote = Node.create<SyntaxOptions>({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  addOptions: () => ({ enabled: off }),
  addAttributes: () => ({
    note: { default: '', parseHTML: (el) => el.getAttribute('data-note') ?? '', renderHTML: (a) => ({ 'data-note': a.note }) },
  }),
  parseHTML: () => [{ tag: 'sup[data-note]' }],
  renderHTML: ({ HTMLAttributes }) => ['sup', mergeAttributes({ class: 'richtext-footnote' }, HTMLAttributes)],
  renderText: () => '',

  addNodeView() {
    return ({ node: initial, editor, getPos }) => {
      let node = initial
      const dom = document.createElement('sup')
      dom.className = 'richtext-footnote'
      const paint = () => (dom.title = node.attrs.note || 'Empty footnote: click to write it')
      const edit = async () => {
        if (!editor.isEditable) return
        const note = await promptDialog('Footnote', node.attrs.note)
        const pos = getPos()
        if (note != null && typeof pos === 'number') editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { note }))
      }
      dom.addEventListener('click', () => void edit())
      paint()
      return {
        dom,
        update(next) {
          if (next.type !== node.type) return false
          node = next
          paint()
          return true
        },
        ignoreMutation: () => true,
      }
    }
  },

  addInputRules() {
    const type = this.type
    return gated(this.options.enabled, [
      new InputRule({
        find: /\^\[([^\]]+)\]$/,
        handler: ({ state, range, match }) => void state.tr.replaceWith(range.from, range.to, type.create({ note: match[1] })),
      }),
      new InputRule({
        find: /\[\^([^\]\s]+)\]$/,
        handler: ({ state, range }) => void state.tr.replaceWith(range.from, range.to, type.create({ note: '' })),
      }),
    ])
  },
})

export interface MarkdownPasteOptions extends SyntaxOptions {
  getProvider: () => RefProvider | null
}

/**
 * Typing rules for links and images, and Markdown paste: with the switch on, pasted plain text
 * that looks like Markdown becomes formatting. Ctrl+Shift+V still pastes it as it is.
 */
export const MarkdownSyntax = Extension.create<MarkdownPasteOptions>({
  name: 'markdownSyntax',
  addOptions: () => ({ enabled: off, getProvider: () => null }),

  addInputRules() {
    const schema = this.editor.schema
    return gated(this.options.enabled, [
      new InputRule({
        // `[text](https://…)` -> a web link
        find: /(^|[^!])\[([^[\]]+)\]\((\S+)\)$/,
        handler: ({ state, range, match }) => {
          const from = range.from + match[1].length
          const link = schema.marks.link.create({ href: match[3] })
          state.tr.replaceWith(from, range.to, schema.text(match[2], [link])).removeStoredMark(schema.marks.link)
        },
      }),
      new InputRule({
        // `![alt](path)` -> a picture
        find: /!\[([^[\]]*)\]\((\S+)\)$/,
        handler: ({ range, match, chain }) => {
          chain()
            .deleteRange(range)
            .setImage({ src: match[2], alt: match[1] || undefined })
            .run()
        },
      }),
    ])
  },

  addProseMirrorPlugins() {
    const { enabled, getProvider } = this.options
    const editor = this.editor
    let shift = false
    return [
      new Plugin({
        key: new PluginKey('markdown-paste'),
        props: {
          handleDOMEvents: {
            keydown: (_view, e) => void (shift = e.shiftKey),
            keyup: (_view, e) => void (shift = e.shiftKey),
          },
          handlePaste: (_view, event) => {
            const text = event.clipboardData?.getData('text/plain') ?? ''
            if (!enabled() || shift || event.clipboardData?.types.includes('text/html') || !looksLikeMarkdown(text)) return false
            const provider = getProvider()
            const doc = markdownToRichText(text, (label) => (provider ? findRefByLabel(provider, label) : undefined))
            return editor.commands.insertContent(doc.content ?? [])
          },
        },
      }),
    ]
  },
})

/** Everything above, wired to the switch. Tables have no typing rule; they come in by paste or import. */
export function syntaxExtensions(enabled: () => boolean, getProvider: () => RefProvider | null) {
  return [
    SyntaxHeading.configure({ enabled }),
    Highlight.configure({ enabled }),
    Comment.configure({ enabled }),
    Tag.configure({ enabled }),
    TaskList,
    SyntaxTaskItem.configure({ enabled }),
    Callout.configure({ enabled }),
    Footnote.configure({ enabled }),
    TableKit.configure({ table: { resizable: false } }),
    MarkdownSyntax.configure({ enabled, getProvider }),
  ]
}
