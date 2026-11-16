import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const key = new PluginKey<string>('find-text')

export interface Match {
  from: number
  to: number
}

/** Every place `query` stands in the text, ignoring upper and lower case. */
export function findMatches(doc: PMNode, query: string): Match[] {
  const out: Match[] = []
  const q = query.toLowerCase()
  if (!q) return out
  // shortcut: looks inside one run of same-formatted text, so a word that is half bold is not found; join text nodes per paragraph if that comes up.
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text!.toLowerCase()
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) out.push({ from: pos + i, to: pos + i + q.length })
  })
  return out
}

/** Ctrl+F: marks what the find bar looks for. The bar itself is `FindBar`. */
export const FindText = Extension.create<{ onOpen: () => boolean }>({
  name: 'findText',
  addOptions: () => ({ onOpen: () => false }),
  addKeyboardShortcuts() {
    return { 'Mod-f': () => this.options.onOpen() }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<string>({
        key,
        state: { init: () => '', apply: (tr, q) => (tr.getMeta(key) as string | undefined) ?? q },
        props: {
          decorations: (state) => {
            const q = key.getState(state)
            if (!q) return null
            const { from, to } = state.selection
            return DecorationSet.create(
              state.doc,
              findMatches(state.doc, q).map((m) => Decoration.inline(m.from, m.to, { class: m.from === from && m.to === to ? 'richtext-found is-current' : 'richtext-found' })),
            )
          },
        },
      }),
    ]
  },
})

const UI = {
  find: 'Find',
  replace: 'Replace with',
  count: (i: number, n: number) => (n ? `${i || '–'} of ${n}` : 'Not found'),
  prev: 'Previous (Shift+Enter)',
  next: 'Next (Enter)',
  one: 'Replace',
  all: 'Replace all',
  close: 'Close (Esc)',
}

/** Find and replace bar under the toolbar. Replace all is one undo step. */
export function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState(() => editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to).slice(0, 80))
  const [replacement, setReplacement] = useState('')
  // Bumped after every jump or replace, so the "3 of 12" count is read again.
  const [, redraw] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    editor.view.dispatch(editor.state.tr.setMeta(key, query))
  }, [editor, query])
  useEffect(() => {
    input.current?.select()
    return () => void (editor.isDestroyed || editor.view.dispatch(editor.state.tr.setMeta(key, '')))
  }, [editor])

  const all = findMatches(editor.state.doc, query)
  const { from, to } = editor.state.selection
  const current = all.findIndex((m) => m.from === from && m.to === to)

  const go = (dir: 1 | -1) => {
    const list = findMatches(editor.state.doc, query)
    if (!list.length) return
    const at = editor.state.selection.from
    const next = dir > 0 ? (list.find((m) => m.from > at) ?? list[0]) : (list.findLast((m) => m.from < at) ?? list[list.length - 1])
    // The caret stays in the find box; the match is shown by its colour.
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, next.from, next.to)).scrollIntoView())
    redraw((n) => n + 1)
  }
  const replaceOne = () => {
    if (current >= 0) editor.view.dispatch(editor.state.tr.insertText(replacement, from, to))
    go(1)
  }
  const replaceAll = () => {
    const tr = editor.state.tr
    for (const m of [...all].reverse()) tr.insertText(replacement, m.from, m.to)
    if (tr.docChanged) editor.view.dispatch(tr)
    // The buttons switch off when nothing is left to replace; keep the keyboard in the bar so Esc still closes it.
    input.current?.focus()
    redraw((n) => n + 1)
  }

  return (
    <div
      className="richtext-find"
      role="search"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
          editor.commands.focus()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if ((e.target as HTMLElement).dataset.replace) replaceOne()
          else go(e.shiftKey ? -1 : 1)
        }
      }}
    >
      <input ref={input} className="input" autoFocus placeholder={UI.find} aria-label={UI.find} value={query} onChange={(e) => setQuery(e.target.value)} />
      <span className="richtext-find-count" aria-live="polite">
        {query ? UI.count(current + 1, all.length) : ''}
      </span>
      <button type="button" className="icon-btn" title={UI.prev} aria-label={UI.prev} onClick={() => go(-1)}>
        <ChevronUp size={16} />
      </button>
      <button type="button" className="icon-btn" title={UI.next} aria-label={UI.next} onClick={() => go(1)}>
        <ChevronDown size={16} />
      </button>
      <input className="input" data-replace="1" placeholder={UI.replace} aria-label={UI.replace} value={replacement} onChange={(e) => setReplacement(e.target.value)} />
      <button type="button" className="btn" disabled={!all.length} onClick={replaceOne}>
        {UI.one}
      </button>
      <button type="button" className="btn" disabled={!all.length} onClick={replaceAll}>
        {UI.all}
      </button>
      <button type="button" className="icon-btn" title={UI.close} aria-label={UI.close} onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  )
}
