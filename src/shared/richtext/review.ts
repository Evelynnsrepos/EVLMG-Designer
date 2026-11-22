import { Extension, Mark, type Editor } from '@tiptap/core'
import type { Mark as PMMark, Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'

/**
 * Review (0.35): comments on text, and track changes. A comment is a mark that carries its own
 * text and replies, so it travels with the words when they are cut, pasted or shared. Track
 * changes marks typed text as added and keeps deleted text, crossed out, until it is accepted.
 */

export interface RemarkReply {
  author: string
  text: string
  at: number
}
export interface RemarkAttrs {
  id: string
  author: string
  text: string
  at: number
  replies: RemarkReply[]
}

/** A comment on a stretch of text. */
export const Remark = Mark.create({
  name: 'remark',
  inclusive: false,
  // Comments may overlap.
  excludes: '',
  addAttributes: () => ({
    id: { default: '' },
    author: { default: '' },
    text: { default: '' },
    at: { default: 0 },
    replies: { default: [] },
  }),
  parseHTML: () => [{ tag: 'span[data-remark]', getAttrs: (el) => ({ id: el.getAttribute('data-remark') }) }],
  renderHTML: ({ HTMLAttributes: a }) => ['span', { 'data-remark': a.id, class: 'richtext-remark' }, 0],
})

const changeMark = (name: string) =>
  Mark.create({
    name,
    inclusive: false,
    excludes: 'insertion deletion',
    addAttributes: () => ({ author: { default: '' }, at: { default: 0 } }),
    parseHTML: () => [{ tag: `span[data-${name}]` }],
    renderHTML: ({ HTMLAttributes: a }) => ['span', { [`data-${name}`]: '', class: `richtext-${name}`, title: a.author ? `${a.author}` : '' }, 0],
  })
export const Insertion = changeMark('insertion')
export const Deletion = changeMark('deletion')

const SKIP = 'trackSkip'
const trackKey = new PluginKey('track-changes')

/** Should this transaction be recorded? Not undo/redo, not a teammate's typing, not our own accept/reject. */
function recordable(t: Transaction) {
  if (!t.docChanged || t.getMeta(SKIP) || t.getMeta('history$') || t.getMeta('y-sync$') || t.getMeta('addToHistory') === false) return false
  return t.steps.every((s) => s instanceof ReplaceStep)
}

/** With `enabled()` on, typing is marked as added and deleting only crosses text out. */
export const TrackChanges = Extension.create<{ enabled: () => boolean; author: () => string }>({
  name: 'trackChanges',
  addOptions: () => ({ enabled: () => false, author: () => '' }),
  addProseMirrorPlugins() {
    const { enabled, author } = this.options
    return [
      new Plugin({
        key: trackKey,
        appendTransaction: (trs, oldState, state) => {
          if (!enabled() || trs.length !== 1 || !recordable(trs[0])) return null
          const t = trs[0]
          const { insertion, deletion } = state.schema.marks
          // Rounded to the minute, so one burst of typing stays one change.
          const attrs = { author: author(), at: Math.floor(Date.now() / 60000) * 60000 }
          const tr = state.tr
          let caret: number | null = null
          t.steps.forEach((raw, i) => {
            const step = raw as ReplaceStep
            const before = t.docs[i]
            const after = t.mapping.slice(i + 1)
            const toNow = (pos: number, assoc: number) => tr.mapping.map(after.map(pos, assoc), assoc)
            // Typed text: marked as added.
            if (step.slice.size) {
              const from = toNow(step.from, -1)
              const to = toNow(step.from + step.slice.size, 1)
              tr.removeMark(from, to, deletion).addMark(from, to, insertion.create(attrs))
            }
            // Deleted text: put back, crossed out. Text you added yourself just goes; so do whole paragraphs.
            if (step.to > step.from) {
              const $from = before.resolve(step.from)
              if ($from.sameParent(before.resolve(step.to)) && $from.parent.inlineContent) {
                const kept: PMNode[] = []
                before.nodesBetween(step.from, step.to, (node, pos) => {
                  if (!node.isInline) return
                  if (node.marks.some((m) => m.type === insertion)) return
                  const part = node.isText ? node.cut(Math.max(0, step.from - pos), Math.min(node.nodeSize, step.to - pos)) : node
                  kept.push(part.mark(deletion.create(attrs).addToSet(part.marks)))
                })
                if (kept.length) {
                  const at = toNow(step.from, -1)
                  tr.insert(at, kept)
                  const size = kept.reduce((n, k) => n + k.nodeSize, 0)
                  // Backspace leaves the caret before the crossed-out text, Delete after it.
                  const back = oldState.selection.empty && oldState.selection.head === step.to
                  caret = back ? at : at + size
                }
              }
            }
          })
          if (!tr.docChanged) return null
          if (caret !== null && state.selection.empty) tr.setSelection(TextSelection.create(tr.doc, caret))
          return tr.setMeta(SKIP, true)
        },
      }),
    ]
  },
})

/** One added or removed stretch, for the review list. */
export interface Change {
  kind: 'insertion' | 'deletion'
  from: number
  to: number
  text: string
  author: string
}

export function listChanges(doc: PMNode): Change[] {
  const out: Change[] = []
  doc.descendants((node, pos) => {
    if (!node.isInline) return
    const m = node.marks.find((x) => x.type.name === 'insertion' || x.type.name === 'deletion')
    if (!m) return
    const last = out[out.length - 1]
    const text = node.isText ? node.text! : ' '
    if (last && last.kind === m.type.name && last.to === pos && last.author === m.attrs.author) {
      last.to = pos + node.nodeSize
      last.text += text
    } else out.push({ kind: m.type.name as Change['kind'], from: pos, to: pos + node.nodeSize, text, author: m.attrs.author })
  })
  return out
}

/** Accept (keep the new state) or reject (go back) one stretch, or everything when `range` is missing. */
export function resolveChanges(editor: Editor, accept: boolean, range?: { from: number; to: number }) {
  const { insertion, deletion } = editor.schema.marks
  const tr = editor.state.tr.setMeta(SKIP, true)
  const from = range?.from ?? 0
  const to = range?.to ?? editor.state.doc.content.size
  const gone = accept ? deletion : insertion
  const kept = accept ? insertion : deletion
  const cut: { from: number; to: number }[] = []
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isInline && node.marks.some((m) => m.type === gone)) cut.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize) })
  })
  tr.removeMark(from, to, kept)
  for (const c of cut.reverse()) tr.delete(c.from, c.to)
  editor.view.dispatch(tr)
}

/** Every comment in the text, in reading order, with the words it is on. */
export function listRemarks(doc: PMNode) {
  const map = new Map<string, { attrs: RemarkAttrs; from: number; to: number; quote: string }>()
  doc.descendants((node, pos) => {
    if (!node.isInline) return
    for (const m of node.marks) {
      if (m.type.name !== 'remark') continue
      const r = map.get(m.attrs.id)
      const text = node.isText ? node.text! : ''
      if (r) {
        r.to = pos + node.nodeSize
        r.quote += text
      } else map.set(m.attrs.id, { attrs: m.attrs as RemarkAttrs, from: pos, to: pos + node.nodeSize, quote: text })
    }
  })
  return [...map.values()]
}

/** Changes one comment's attributes everywhere it is (comments can span several text pieces). */
export function updateRemark(editor: Editor, id: string, patch: Partial<RemarkAttrs> | null) {
  const type = editor.schema.marks.remark
  const tr = editor.state.tr.setMeta(SKIP, true)
  editor.state.doc.descendants((node, pos) => {
    const m = node.marks.find((x: PMMark) => x.type === type && x.attrs.id === id)
    if (!m) return
    tr.removeMark(pos, pos + node.nodeSize, m)
    if (patch) tr.addMark(pos, pos + node.nodeSize, type.create({ ...m.attrs, ...patch }))
  })
  editor.view.dispatch(tr)
}

/** Puts a new, empty comment on the selected words; returns its id. */
export function addRemark(editor: Editor, author: string): string | null {
  const { from, to, empty } = editor.state.selection
  if (empty) return null
  const id = Math.random().toString(36).slice(2, 10)
  editor.view.dispatch(editor.state.tr.setMeta(SKIP, true).addMark(from, to, editor.schema.marks.remark.create({ id, author, text: '', at: Date.now(), replies: [] })))
  return id
}

export function reviewExtensions(track: () => boolean, author: () => string) {
  return [Remark, Insertion, Deletion, TrackChanges.configure({ enabled: track, author })]
}
