import { Extension, type Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import {
  Bold,
  Code,
  Columns3,
  FileSymlink,
  Globe,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Info,
  Italic,
  Lightbulb,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareOff,
  Minus,
  Rows3,
  SquareCode,
  Strikethrough,
  Superscript,
  Table,
  TextQuote,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { promptDialog } from '../dialogs'
import type { RefMenuEntry } from './RefMenu'
import { refMenuRenderer } from './refMenuRenderer'

/**
 * Everything the Writer can insert, with the Markdown to type for it. One list feeds the
 * toolbar's + menu, the `/` menu and the Markdown help panel, so they never disagree.
 */
export interface InsertItem {
  id: string
  label: string
  /** What to type instead of clicking; '' when there is nothing to type. */
  type: string
  icon: LucideIcon
  group: string
  run: (editor: Editor) => void
  /** Formats selected text, so it is no use in the `/` menu on an empty line. */
  inline?: boolean
  /** Typing it only works with the Markdown Syntax switch on. */
  needsSyntax?: boolean
  /** Only offered when this is true (table tools inside a table). */
  when?: (editor: Editor) => boolean
}

const GROUP = { blocks: 'Blocks', text: 'Text', notes: 'Links and notes', table: 'This table' }
const c = (e: Editor) => e.chain().focus()
const inTable = (e: Editor) => e.isActive('table')
const callout = (kind: string, label: string, icon: LucideIcon): InsertItem => ({
  id: `callout-${kind}`,
  label,
  type: `> [!${kind}] `,
  icon,
  group: GROUP.blocks,
  needsSyntax: true,
  run: (e) => c(e).wrapIn('callout', { kind }).run(),
})

export const INSERTS: InsertItem[] = [
  { id: 'row', label: 'Add row below', type: '', icon: Rows3, group: GROUP.table, when: inTable, run: (e) => c(e).addRowAfter().run() },
  { id: 'column', label: 'Add column to the right', type: '', icon: Columns3, group: GROUP.table, when: inTable, run: (e) => c(e).addColumnAfter().run() },
  { id: 'row-del', label: 'Delete this row', type: '', icon: Trash2, group: GROUP.table, when: inTable, run: (e) => c(e).deleteRow().run() },
  { id: 'column-del', label: 'Delete this column', type: '', icon: Trash2, group: GROUP.table, when: inTable, run: (e) => c(e).deleteColumn().run() },
  { id: 'table-del', label: 'Delete the table', type: '', icon: Trash2, group: GROUP.table, when: inTable, run: (e) => c(e).deleteTable().run() },

  { id: 'h1', label: 'Heading 1', type: '# ', icon: Heading1, group: GROUP.blocks, run: (e) => c(e).toggleHeading({ level: 1 }).run() },
  { id: 'h2', label: 'Heading 2', type: '## ', icon: Heading2, group: GROUP.blocks, run: (e) => c(e).toggleHeading({ level: 2 }).run() },
  { id: 'h3', label: 'Heading 3', type: '### ', icon: Heading3, group: GROUP.blocks, run: (e) => c(e).toggleHeading({ level: 3 }).run() },
  { id: 'bullet', label: 'Bulleted list', type: '- ', icon: List, group: GROUP.blocks, run: (e) => c(e).toggleBulletList().run() },
  { id: 'ordered', label: 'Numbered list', type: '1. ', icon: ListOrdered, group: GROUP.blocks, run: (e) => c(e).toggleOrderedList().run() },
  { id: 'checklist', label: 'Checklist', type: '- [ ] ', icon: ListChecks, group: GROUP.blocks, needsSyntax: true, run: (e) => c(e).toggleTaskList().run() },
  { id: 'quote', label: 'Quote', type: '> ', icon: TextQuote, group: GROUP.blocks, run: (e) => c(e).toggleBlockquote().run() },
  callout('note', 'Note box', Info),
  callout('tip', 'Tip box', Lightbulb),
  callout('warning', 'Warning box', TriangleAlert),
  { id: 'divider', label: 'Divider line', type: '---', icon: Minus, group: GROUP.blocks, run: (e) => c(e).setHorizontalRule().run() },
  { id: 'codeblock', label: 'Code block', type: '``` ', icon: SquareCode, group: GROUP.blocks, run: (e) => c(e).toggleCodeBlock().run() },
  { id: 'table', label: 'Table', type: '', icon: Table, group: GROUP.blocks, when: (e) => !inTable(e), run: (e) => c(e).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },

  { id: 'bold', label: 'Bold', type: '**text**', icon: Bold, group: GROUP.text, inline: true, run: (e) => c(e).toggleBold().run() },
  { id: 'italic', label: 'Italic', type: '*text*', icon: Italic, group: GROUP.text, inline: true, run: (e) => c(e).toggleItalic().run() },
  { id: 'strike', label: 'Crossed out', type: '~~text~~', icon: Strikethrough, group: GROUP.text, inline: true, run: (e) => c(e).toggleStrike().run() },
  { id: 'highlight', label: 'Highlight', type: '==text==', icon: Highlighter, group: GROUP.text, inline: true, needsSyntax: true, run: (e) => c(e).toggleMark('highlight').run() },
  { id: 'code', label: 'Code', type: '`text`', icon: Code, group: GROUP.text, inline: true, run: (e) => c(e).toggleCode().run() },
  {
    id: 'comment',
    label: 'Hidden comment (not exported)',
    type: '%%text%%',
    icon: MessageSquareOff,
    group: GROUP.text,
    inline: true,
    needsSyntax: true,
    run: (e) => c(e).toggleMark('comment').run(),
  },

  { id: 'ref', label: 'Link to an entry or document', type: '[[', icon: Link2, group: GROUP.notes, run: (e) => c(e).insertContent('[[').run() },
  { id: 'card', label: 'Jump card', type: '![[', icon: FileSymlink, group: GROUP.notes, run: (e) => c(e).insertContent('![[').run() },
  {
    id: 'web',
    label: 'Web link',
    type: '[text](address)',
    icon: Globe,
    group: GROUP.notes,
    needsSyntax: true,
    run: async (e) => {
      const { from, to } = e.state.selection
      const href = (await promptDialog('Web address', 'https://'))?.trim()
      if (!href || href === 'https://') return
      const text = e.state.doc.textBetween(from, to) || href
      c(e).insertContentAt({ from, to }, { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).run()
    },
  },
  {
    id: 'footnote',
    label: 'Footnote',
    type: '^[note]',
    icon: Superscript,
    group: GROUP.notes,
    needsSyntax: true,
    run: async (e) => {
      const at = e.state.selection.to
      const note = await promptDialog('Footnote')
      if (note) c(e).insertContentAt(at, { type: 'footnote', attrs: { note } }).run()
    },
  },
  { id: 'tag', label: 'Tag', type: '#tag ', icon: Hash, group: GROUP.notes, needsSyntax: true, run: (e) => c(e).insertContent('#').run() },
]

const UI = {
  needsSyntax: 'Typing this needs the Markdown Syntax switch. Clicking always works.',
  type: 'or type',
}

/** The insert list as clickable rows: label on the left, the Markdown to type on the right. */
export function InsertList({ editor, syntax, onDone }: { editor: Editor; syntax: boolean; onDone?: () => void }) {
  const items = INSERTS.filter((i) => !i.when || i.when(editor))
  return (
    <div className="richtext-inserts">
      {[...new Set(items.map((i) => i.group))].map((group) => (
        <div key={group} role="group" aria-label={group}>
          <div className="richtext-inserts-group">{group}</div>
          {items
            .filter((i) => i.group === group)
            .map((i) => (
              <button
                key={i.id}
                type="button"
                className="richtext-inserts-item"
                title={i.needsSyntax && !syntax ? UI.needsSyntax : undefined}
                // mousedown keeps the selection in the editor
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  i.run(editor)
                  onDone?.()
                }}
              >
                <i.icon size={15} />
                <span>{i.label}</span>
                {i.type && <code className={i.needsSyntax && !syntax ? 'is-off' : undefined}>{i.type.trim()}</code>}
              </button>
            ))}
        </div>
      ))}
    </div>
  )
}

/** `/` at the start of a line opens the insert list; keep typing to filter, Enter to pick. */
export const SlashMenu = Extension.create<{ enabled: () => boolean }>({
  name: 'slashMenu',
  addOptions: () => ({ enabled: () => false }),
  addProseMirrorPlugins() {
    const enabled = this.options.enabled
    return [
      Suggestion<RefMenuEntry, RefMenuEntry>({
        editor: this.editor,
        pluginKey: new PluginKey('slash-menu'),
        char: '/',
        startOfLine: true,
        allow: () => enabled(),
        items: ({ query, editor }) =>
          INSERTS.filter((i) => !i.inline && (!i.when || i.when(editor)) && i.label.toLowerCase().includes(query.toLowerCase())).map((i) => ({
            type: 'ref',
            item: { kind: 'insert', id: i.id, label: i.label, hint: i.type.trim() },
          })),
        command: ({ editor, range, props: entry }) => {
          editor.chain().focus().deleteRange(range).run()
          if (entry.type === 'ref') INSERTS.find((i) => i.id === entry.item.id)?.run(editor)
        },
        render: refMenuRenderer,
      }),
    ]
  },
})
