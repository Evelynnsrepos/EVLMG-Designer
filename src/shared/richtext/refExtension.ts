import { InputRule, mergeAttributes, Node, type NodeViewRenderer } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { readJumpDrag, refTargetOf } from '@/shared/jumps/drag'
import Suggestion from '@tiptap/suggestion'
import { MISSING_REF_LABEL, REF_CARD_NODE, REF_NODE } from './doc'
import type { RefMenuEntry } from './RefMenu'
import { refMenuRenderer } from './refMenuRenderer'
import { findRefByLabel } from './refs'
import type { RefItem, RefProvider, RefTarget } from './types'

export interface RefOptions {
  /** Read lazily so the editor never has to be recreated when entities change. */
  getProvider: () => RefProvider | null
  /** Markdown Syntax switch (0.19): `[[Name|shown text]]` and `![[Name]]` while typing. */
  syntax: () => boolean
}

export interface RefStorage {
  /** Called by the editor component when names may have changed, so links repaint. */
  repaint: Set<() => void>
}

declare module '@tiptap/core' {
  interface Storage {
    ref: RefStorage
  }
}

const refKey = new PluginKey('richtext-ref-suggestion')

const refContent = (target: RefTarget) => [{ type: REF_NODE, attrs: { kind: target.kind, id: target.id } }, { type: 'text', text: ' ' }]

/** Query typed after `[[`, without any closing brackets the user already typed. */
const cleanQuery = (query: string) => query.replace(/\]+$/, '')

/**
 * Inline `[[` link to an entity, wiki article, or anything a RefProvider offers (WK-4).
 * Stored as `{ type: 'ref', attrs: { kind, id } }`; the name is looked up on every
 * render, so renaming the target updates every link (spec 3.3).
 */
export const RefExtension = Node.create<RefOptions, RefStorage>({
  name: REF_NODE,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { getProvider: () => null, syntax: () => false }
  },

  addStorage() {
    return { repaint: new Set() }
  },

  addAttributes() {
    return {
      kind: { default: null, parseHTML: (el) => el.getAttribute('data-ref-kind'), renderHTML: (a) => ({ 'data-ref-kind': a.kind }) },
      id: { default: null, parseHTML: (el) => el.getAttribute('data-ref-id'), renderHTML: (a) => ({ 'data-ref-id': a.id }) },
      /** Own shown text from `[[Name|text]]` (0.19); null shows the target's current name. */
      text: { default: null, parseHTML: (el) => el.getAttribute('data-ref-text'), renderHTML: (a) => (a.text ? { 'data-ref-text': a.text } : {}) },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-ref-id]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'richtext-ref' }, HTMLAttributes), shownText(node.attrs, this.options.getProvider())]
  },

  renderText({ node }) {
    return shownText(node.attrs, this.options.getProvider())
  },

  addNodeView() {
    return refNodeView('span', this.options.getProvider, this.storage.repaint)
  },

  addInputRules() {
    const { getProvider, syntax } = this.options
    const type = this.type
    return [
      // `![[Name]]`: a jump card on its own line, or a picture for an image file name (Markdown Syntax only).
      new InputRule({
        find: /!\[\[([^[\]\n]+)\]\]$/,
        handler: ({ range, match, chain }) => {
          if (!syntax()) return null
          const name = match[1].split('|')[0].trim()
          if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(name)) return void chain().deleteRange(range).setImage({ src: name }).run()
          const provider = getProvider()
          const hit = provider && findRefByLabel(provider, name)
          if (!hit) return null
          chain()
            .deleteRange(range)
            .insertContent({ type: REF_CARD_NODE, attrs: { kind: hit.kind, id: hit.id } })
            .run()
        },
      }),
      // Typing `[[Ironhold]]` in full turns into a link when a record with that exact name exists.
      new InputRule({
        find: /\[\[([^[\]\n]+)\]\]$/,
        handler: ({ state, range, match }) => {
          const provider = getProvider()
          const [name, shown] = syntax() ? match[1].split('|') : [match[1]]
          const hit = provider && findRefByLabel(provider, name.trim())
          if (!hit) return null
          state.tr.replaceWith(range.from, range.to, type.create({ kind: hit.kind, id: hit.id, text: shown?.trim() || null }))
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      // Backspace right after a link turns it back into `[[Name` so the user can pick another.
      Backspace: () =>
        this.editor.commands.command(({ tr, state }) => {
          const { selection } = state
          if (!selection.empty) return false
          const before = selection.$from.nodeBefore
          if (before?.type.name !== REF_NODE) return false
          const label = shownText(before.attrs, this.options.getProvider(), '')
          tr.insertText(`[[${label}`, selection.from - before.nodeSize, selection.from)
          return true
        }),
    }
  },

  addProseMirrorPlugins() {
    const getProvider = this.options.getProvider
    const type = this.type
    return [
      // 0.21: a jump point dropped into the text becomes a [[link to the same place.
      new Plugin({
        props: {
          handleDrop: (view, event) => {
            const target = readJumpDrag(event.dataTransfer)
            if (!target || !view.editable) return false
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from
            event.preventDefault()
            view.dispatch(view.state.tr.insert(at, [type.create(refTargetOf(target)), view.state.schema.text(' ')]))
            view.focus()
            return true
          },
        },
      }),
      Suggestion<RefMenuEntry, RefMenuEntry>({
        editor: this.editor,
        pluginKey: refKey,
        char: '[[',
        allowSpaces: true,
        allowedPrefixes: null,
        items: ({ query }) => {
          const provider = getProvider()
          if (!provider) return []
          const q = cleanQuery(query).trim()
          const entries: RefMenuEntry[] = provider.search(q).map((item) => ({ type: 'ref', item }))
          const exact = entries.some((e) => e.type === 'ref' && e.item.label.toLowerCase() === q.toLowerCase())
          if (provider.create && q && !exact) {
            entries.push({ type: 'create', label: q, text: provider.createLabel?.(q) ?? `Create "${q}"` })
          }
          return entries
        },
        command: ({ editor, range, props: entry }) => {
          const insert = (item: RefItem | null | undefined) => {
            if (item) editor.chain().focus().insertContentAt(range, refContent(item)).run()
          }
          if (entry.type === 'ref') return insert(entry.item)
          void Promise.resolve(getProvider()?.create?.(entry.label)).then(insert)
        },
        render: refMenuRenderer,
      }),
    ]
  },
})

const shownText = (attrs: Record<string, unknown>, provider: RefProvider | null, missing = MISSING_REF_LABEL) =>
  (attrs.text as string | null) || (provider?.resolve(attrs as unknown as RefTarget)?.label ?? missing)

/** Shared by inline links and jump cards: shows the current name, opens the target on click. */
function refNodeView(tag: 'span' | 'div', getProvider: () => RefProvider | null, repaints: Set<() => void>): NodeViewRenderer {
  return ({ node: initial }) => {
    let node = initial
    const dom = document.createElement(tag)
    dom.className = tag === 'span' ? 'richtext-ref' : 'richtext-refcard'
    dom.setAttribute('role', 'link')
    const target = () => node.attrs as RefTarget
    const paint = () => {
      const item = getProvider()?.resolve(target())
      dom.textContent = shownText(node.attrs, getProvider())
      dom.title = item ? `${item.hint ? item.hint + ': ' : ''}${item.label} (click to open)` : 'The linked record was deleted'
      dom.classList.toggle('richtext-ref-missing', !item)
      dom.style.color = item?.color ?? ''
    }
    dom.addEventListener('click', (e) => {
      e.preventDefault()
      if (getProvider()?.resolve(target())) getProvider()?.open?.(target())
    })
    paint()
    repaints.add(paint)
    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false
        node = next
        paint()
        return true
      },
      ignoreMutation: () => true,
      destroy: () => void repaints.delete(paint),
    }
  }
}

/** `![[Name]]` (0.19): a jump card to a document, article or entry on its own line; no copy of its text. */
export const RefCard = Node.create<Pick<RefOptions, 'getProvider'>>({
  name: REF_CARD_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  addOptions: () => ({ getProvider: () => null }),
  addAttributes: () => ({
    kind: { default: null, parseHTML: (el) => el.getAttribute('data-ref-kind'), renderHTML: (a) => ({ 'data-ref-kind': a.kind }) },
    id: { default: null, parseHTML: (el) => el.getAttribute('data-ref-id'), renderHTML: (a) => ({ 'data-ref-id': a.id }) },
  }),
  parseHTML: () => [{ tag: 'div[data-ref-id]' }],
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes({ class: 'richtext-refcard' }, HTMLAttributes), shownText(node.attrs, this.options.getProvider())]
  },
  addNodeView() {
    // Repaints with the inline links when names change.
    return refNodeView('div', this.options.getProvider, this.editor.storage.ref.repaint)
  },
})
