import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { useSettings } from '@/core/state'
import { useAiHelper } from './ai'
import { findIssues, onAiResult, type Issue } from './proof'
import { spellAvailable } from './spell'
import { KNOWN_WRONG } from './words'
import type { ProofHit } from './ProofCard'

interface SpellOptions {
  /** Click or right-click on underlined text; positions are document positions. */
  onMisspelling: (hit: ProofHit) => void
}

const key = new PluginKey<DecorationSet>('spell')
const DELAY_MS = 400

interface Paragraph {
  text: string
  /** Document position of each character. */
  pos: number[]
  /** Characters inside code, links or `[[` chips: never underlined. */
  skip: boolean[]
}

/** The text of every paragraph and heading, with document positions. */
function docParagraphs(doc: PMNode): Paragraph[] {
  const out: Paragraph[] = []
  doc.descendants((block, start) => {
    if (!block.isTextblock) return true
    const p: Paragraph = { text: '', pos: [], skip: [] }
    block.forEach((node, offset) => {
      const at = start + 1 + offset
      const text = node.isText ? node.text! : ' '
      const skip = !node.isText || node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link' || m.type.name === 'tag')
      for (let i = 0; i < text.length; i++) {
        p.pos.push(at + (node.isText ? i : 0))
        p.skip.push(skip)
      }
      p.text += text
    })
    out.push(p)
    return false
  })
  return out
}

type Spec = Issue & { para: string }
const spec = (p: Paragraph, issue: Issue): Spec => ({ ...issue, para: p.text })

/** The card for the underline at `pos`: the AI fix if there is one, the spelling otherwise. */
function hitAt(view: EditorView, pos: number, event: { clientX: number; clientY: number }): ProofHit | null {
  const found = key.getState(view.state)?.find(pos, pos) ?? []
  const ai = found.find((d) => (d.spec as Spec).fix !== undefined)
  const spell = found.find((d) => (d.spec as Spec).fix === undefined)
  const main = ai ?? spell
  if (!main) return null
  const s = main.spec as Spec
  const word = spell && spell.from === main.from && spell.to === main.to ? (spell.spec as Spec).word : undefined
  // Every German noun typed small in the same paragraph, so one click can fix them all.
  const block = view.state.doc.resolve(main.from)
  const group =
    s.rule === 'noun-capital'
      ? (key.getState(view.state)?.find(block.start(), block.end()) ?? []).filter((d) => (d.spec as Spec).rule === 'noun-capital').map((d) => ({ from: d.from, to: d.to, fix: (d.spec as Spec).fix! }))
      : undefined
  // The paragraph as it is now: after a fix the checked copy is a moment behind.
  const para = block.parent.textBetween(0, block.parent.content.size, undefined, ' ')
  const at = main.from - block.start()
  return { x: event.clientX, y: event.clientY, from: main.from, to: main.to, bad: para.slice(at, at + main.to - main.from), fix: s.fix, word, para, at, fixes: s.fixes, why: s.why, rule: s.rule, lang: s.lang, group }
}

/** The next underline after document position `after` (from the top again at the end), scrolled into view: for going through a text one mistake at a time. */
export function nextHit(view: EditorView, after: number): ProofHit | null {
  const all = (key.getState(view.state)?.find() ?? []).sort((a, b) => a.from - b.from)
  const next = all.find((d) => d.from > after) ?? all[0]
  if (!next) return null
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, next.from)).scrollIntoView())
  const box = view.coordsAtPos(next.from)
  const hit = hitAt(view, next.from, { clientX: box.left + 16, clientY: box.bottom })
  return hit && { ...hit, walk: true }
}

/** Underlines misspelled words (wavy red) and AI grammar suggestions (wavy blue), and reports clicks on them. */
export const SpellCheck = Extension.create<SpellOptions>({
  name: 'spellCheck',
  addOptions: () => ({ onMisspelling: () => {} }),

  addProseMirrorPlugins() {
    const options = this.options
    let timer: ReturnType<typeof setTimeout> | undefined
    let run = 0
    /** Auto-fix: what was just fixed, and words the writer took back (they are left alone from then on). */
    const autoFixed = new Map<string, number>()
    const noAuto = new Set<string>()

    const recheck = (view: EditorView) => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        const mine = ++run
        const doc = view.state.doc
        const paragraphs = docParagraphs(doc)
        // ponytail: whole-document rescan per pause; check only changed paragraphs if long chapters lag.
        const at = view.state.selection.head
        const focus = Math.max(0, paragraphs.findIndex((p) => p.pos.length > 0 && at <= p.pos[p.pos.length - 1] + 1))
        const issues = await findIssues(
          paragraphs.map((p) => p.text),
          focus,
        )
        if (mine !== run || view.isDestroyed || view.state.doc !== doc) return
        const decos = paragraphs.flatMap((p, i) =>
          issues[i]
            // Not the word still being typed.
            .filter((x) => !p.skip.slice(x.from, x.to).some(Boolean) && p.pos[x.to - 1] + 1 !== at)
            .map((x) => Decoration.inline(p.pos[x.from], p.pos[x.to - 1] + 1, { class: x.fix === undefined ? 'spell-error' : 'grammar-error' }, spec(p, x))),
        )
        view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(view.state.doc, decos)))
        // Auto-fix sure slips in the paragraph being written: finished words only, never the one at the cursor.
        const settings = useSettings.getState()
        const p = paragraphs[focus]
        if (!settings.spellAutoFix || !p) return
        const tr = view.state.tr
        for (const x of [...issues[focus]].reverse()) {
          const end = p.pos[x.to - 1] + 1
          if (!x.word || x.rule || end >= at || p.skip.slice(x.from, x.to).some(Boolean)) continue
          const lower = x.word.toLowerCase()
          // The same slip back within seconds means the writer undid the fix: leave that word alone.
          if (Date.now() - (autoFixed.get(lower) ?? 0) < 15000) noAuto.add(lower)
          let fix = settings.learnedFixes[lower] ?? KNOWN_WRONG[x.lang ?? 'en'].get(lower)
          if (!fix || noAuto.has(lower)) continue
          if (x.word[0] !== lower[0] && fix[0] === fix[0].toLowerCase()) fix = fix[0].toUpperCase() + fix.slice(1)
          tr.insertText(fix, p.pos[x.from], end)
          autoFixed.set(lower, Date.now())
        }
        // Its own undo step: one Ctrl+Z takes the fix back and keeps what was typed.
        if (tr.docChanged) view.dispatch(closeHistory(tr))
      }, DELAY_MS)
    }

    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => tr.getMeta(key) ?? set.map(tr.mapping, tr.doc),
        },
        props: {
          // Calm underlines: only the paragraph being written shows them (the rest stay known, for "Fix my text").
          decorations: (state) => {
            const set = key.getState(state)
            const head = state.selection.$head
            return set && useSettings.getState().spellCalm ? DecorationSet.create(state.doc, set.find(head.start(), head.end())) : set
          },
          attributes: (): Record<string, string> => (spellAvailable() ? { spellcheck: 'false' } : {}),
          // A click opens the suggestion card and still places the caret.
          handleClick: (view, pos, event) => {
            const hit = hitAt(view, pos, event)
            if (hit) options.onMisspelling(hit)
            return false
          },
          handleDOMEvents: {
            contextmenu: (view, event) => {
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
              const hit = at && hitAt(view, at.pos, event)
              if (!hit) return false
              event.preventDefault()
              options.onMisspelling(hit)
              return true
            },
          },
        },
        view: (view) => {
          recheck(view)
          // New personal words, languages, AI results or the AI helper finishing its download: check again.
          const offSettings = useSettings.subscribe(() => recheck(view))
          const offHelper = useAiHelper.subscribe((s, prev) => s.installed !== prev.installed && recheck(view))
          const offAi = onAiResult(() => recheck(view))
          return {
            update: (v, prev) => {
              if (!v.state.doc.eq(prev.doc)) recheck(v)
            },
            destroy: () => {
              clearTimeout(timer)
              offSettings()
              offHelper()
              offAi()
            },
          }
        },
      }),
    ]
  },
})
