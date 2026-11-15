import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { linter, type Diagnostic } from '@codemirror/lint'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, hoverTooltip, keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { basicSetup } from 'codemirror'
import { completionsAt, findProblems, refAt, type DesignData, type DesignEntry } from './designData'
import { gdscript } from './gdscript'

/** Colours come from CSS variables (code.css), so both themes work. */
const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--code-keyword)' },
  { tag: [t.atom, t.number, t.bool], color: 'var(--code-number)' },
  { tag: t.string, color: 'var(--code-string)' },
  { tag: t.special(t.string), color: 'var(--code-node)' },
  { tag: t.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: t.typeName, color: 'var(--code-type)' },
  { tag: t.definition(t.variableName), color: 'var(--code-def)', fontWeight: '600' },
  { tag: t.special(t.variableName), color: 'var(--code-call)' },
  { tag: t.meta, color: 'var(--code-meta)' },
  { tag: t.operator, color: 'var(--code-operator)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, monospace", lineHeight: '1.55' },
  '.cm-gutters': { backgroundColor: 'var(--bg-sunken)', color: 'var(--text-muted)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--code-line)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--code-selection)' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-text)' },
  '.cm-panels': { backgroundColor: 'var(--bg-elevated)', color: 'var(--text)' },
  '.code-design-link': { textDecoration: 'underline dotted', cursor: 'pointer' },
})

/** Design data inside GDScript: ids complete, wrong ids are underlined, hover shows the entry, Ctrl+click opens it. */
function designLinks(data: () => DesignData, jump: (entry: DesignEntry) => void): Extension {
  const complete = (cx: CompletionContext): CompletionResult | null => {
    const line = cx.state.doc.lineAt(cx.pos)
    const found = completionsAt(line.text.slice(0, cx.pos - line.from), data())
    return found && { from: line.from + found.from, options: found.options, validFor: /^[\w-]*$/ }
  }
  return [
    gdscript.data.of({ autocomplete: complete }),
    linter(
      (view) =>
        findProblems(view.state.doc.toString(), data()).map(
          (p): Diagnostic => ({
            from: p.from,
            to: p.to,
            severity: 'warning',
            source: 'Design data',
            message: p.message,
            actions: p.fix ? [{ name: `Change to "${p.fix}"`, apply: (v, from, to) => v.dispatch({ changes: { from, to, insert: p.fix! }, userEvent: 'input.complete' }) }] : [],
          }),
        ),
      { delay: 400 },
    ),
    hoverTooltip((view, pos) => {
      const line = view.state.doc.lineAt(pos)
      const ref = refAt(line.text, pos - line.from, data())
      if (!ref) return null
      return {
        pos: line.from + ref.from,
        end: line.from + ref.to,
        create() {
          const dom = document.createElement('div')
          dom.className = 'code-design-card'
          const title = dom.appendChild(document.createElement('strong'))
          title.textContent = ref.title
          if (ref.detail) dom.appendChild(document.createElement('div')).textContent = ref.detail
          if (ref.entry) dom.appendChild(document.createElement('small')).textContent = 'Ctrl+click to open it'
          return { dom }
        },
      }
    }),
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        if (pos === null) return false
        const line = view.state.doc.lineAt(pos)
        const entry = refAt(line.text, pos - line.from, data())?.entry
        if (!entry) return false
        jump(entry)
        return true
      },
    }),
  ]
}

/** Holds the language server's part of a file, so it can be swapped in when Godot connects later. */
export const lspCompartment = new Compartment()

export interface EditorOptions {
  /** Path inside the game folder; picks the language. */
  path: string
  /** The language server's part for this file, when Godot is connected. */
  lsp: Extension | null
  data: () => DesignData
  jump: (entry: DesignEntry) => void
  /** Combo mode and the tool's own keys. */
  extras: Extension[]
  onChange: () => void
}

/** One file's editor state: its text, its own undo history, colours and helpers. */
export function createState(text: string, o: EditorOptions): EditorState {
  const gd = /\.gd$/i.test(o.path)
  return EditorState.create({
    doc: text,
    extensions: [
      // The tool's keys first, so they win over the editor's defaults.
      o.extras,
      basicSetup,
      keymap.of([indentWithTab]),
      theme,
      syntaxHighlighting(highlight),
      // Godot writes tabs.
      gd ? [gdscript, indentUnit.of('\t'), EditorState.tabSize.of(4), designLinks(o.data, o.jump)] : [],
      lspCompartment.of(gd && o.lsp ? o.lsp : []),
      EditorView.updateListener.of((u) => u.docChanged && o.onChange()),
    ],
  })
}
