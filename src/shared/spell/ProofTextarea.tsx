import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import { useSettings } from '@/core/state'
import { findIssues, onAiResult, type Issue } from './proof'
import { spellAvailable } from './spell'
import { ProofCard, type ProofHit } from './ProofCard'
import './spell.css'

const DELAY_MS = 400
/** Styles the see-through copy needs so its words land exactly on the textarea's words. */
const COPY = ['font', 'letterSpacing', 'wordSpacing', 'lineHeight', 'textAlign', 'textIndent', 'tabSize', 'textTransform', 'boxSizing',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'] as const

interface Segment {
  text: string
  from: number
  issues: Issue[]
}

/** Cuts the text at every issue edge, so overlapping spelling and AI issues still draw as one underline each. */
function segments(text: string, issues: Issue[]): Segment[] {
  const cuts = [...new Set([0, text.length, ...issues.flatMap((i) => [i.from, i.to])])].sort((a, b) => a - b)
  return cuts.slice(0, -1).map((from, k) => ({
    text: text.slice(from, cuts[k + 1]),
    from,
    issues: issues.filter((i) => i.from <= from && i.to >= cuts[k + 1]),
  }))
}

/**
 * A `<textarea>` with the app's spell check and AI grammar suggestions: a see-through copy of the
 * text sits on top and draws the underlines; right-click an underline for the fixes. Drop-in
 * replacement for a controlled `<textarea>`.
 */
export function ProofTextarea({ ref, onScroll, onContextMenu, onClick, ...props }: ComponentProps<'textarea'>) {
  const el = useRef<HTMLTextAreaElement>(null)
  const copy = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => el.current!)
  const text = typeof props.value === 'string' ? props.value : ''
  const [issues, setIssues] = useState<{ text: string; list: Issue[] }>({ text: '', list: [] })
  const [hit, setHit] = useState<ProofHit | null>(null)
  const [again, setAgain] = useState(0)
  const on = spellAvailable()

  useEffect(() => {
    if (!on) return
    const offAi = onAiResult(() => setAgain((n) => n + 1))
    const offSettings = useSettings.subscribe(() => setAgain((n) => n + 1))
    return () => (offAi(), offSettings())
  }, [on])

  useEffect(() => {
    if (!on) return
    let live = true
    const timer = setTimeout(async () => {
      const lines = text.split('\n')
      const found = await findIssues(lines)
      let start = 0
      const list = lines.flatMap((line, i) => {
        const shifted = found[i].map((x) => ({ ...x, from: x.from + start, to: x.to + start }))
        start += line.length + 1
        return shifted
      })
      if (live) setIssues({ text, list })
    }, DELAY_MS)
    return () => (live = false, clearTimeout(timer))
  }, [on, text, again])

  // Keep the copy on top of the textarea (it may be resized, scrolled or restyled).
  useLayoutEffect(() => {
    const t = el.current
    const c = copy.current
    if (!t || !c) return
    const sync = () => {
      const css = getComputedStyle(t)
      for (const k of COPY) c.style[k] = css[k]
      const scrollbar = t.offsetWidth - t.clientWidth - parseFloat(css.borderLeftWidth) - parseFloat(css.borderRightWidth)
      Object.assign(c.style, { top: `${t.offsetTop}px`, left: `${t.offsetLeft}px`, width: `${t.offsetWidth - scrollbar}px`, height: `${t.offsetHeight}px` })
      c.scrollTop = t.scrollTop
    }
    sync()
    const watch = new ResizeObserver(sync)
    watch.observe(t)
    return () => watch.disconnect()
  })

  if (!on) return <textarea ref={el} onScroll={onScroll} onContextMenu={onContextMenu} onClick={onClick} {...props} />

  // Underlines only while they still match the text; they come back after the next check.
  const shown = issues.text === text ? issues.list : []

  /** The card for the underline under the mouse: the AI fix if there is one, the spelling otherwise. */
  const hitAt = (e: React.MouseEvent): ProofHit | null => {
    for (const span of copy.current?.querySelectorAll<HTMLElement>('[data-at]') ?? []) {
      if (![...span.getClientRects()].some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom)) continue
      const at = Number(span.dataset.at)
      const here = shown.filter((i) => i.from <= at && i.to > at)
      const main = here.find((i) => i.fix !== undefined) ?? here[0]
      if (!main) return null
      const spell = here.find((i) => i.fix === undefined && i.from === main.from && i.to === main.to)
      const start = text.lastIndexOf('\n', main.from - 1) + 1
      const end = text.indexOf('\n', main.to)
      const para = text.slice(start, end < 0 ? text.length : end)
      return { x: e.clientX, y: e.clientY, from: main.from, to: main.to, bad: text.slice(main.from, main.to), fix: main.fix, word: spell?.word, para, at: main.from - start, fixes: main.fixes, why: main.why, rule: main.rule, lang: main.lang }
    }
    return null
  }

  const replace = (from: number, to: number, fix: string) => {
    const t = el.current!
    t.focus()
    t.setSelectionRange(from, to)
    // Goes through the browser's own typing, so Ctrl+Z and React's onChange both see it.
    // oxlint-disable-next-line no-deprecated
    document.execCommand('insertText', false, fix)
  }

  return (
    <>
      <textarea
        ref={el}
        spellCheck={false}
        {...props}
        onScroll={(e) => {
          if (copy.current) copy.current.scrollTop = e.currentTarget.scrollTop
          onScroll?.(e)
        }}
        onContextMenu={(e) => {
          onContextMenu?.(e)
          const next = hitAt(e)
          if (!next) return
          e.preventDefault()
          setHit(next)
        }}
        // A click opens the suggestion card and still places the caret.
        onClick={(e) => {
          onClick?.(e)
          const next = hitAt(e)
          if (next) setHit(next)
        }}
      />
      <div ref={copy} className="proof-copy" aria-hidden>
        {segments(text, shown).map((s) =>
          s.issues.length ? (
            <span key={s.from} data-at={s.from} className={s.issues.some((i) => i.fix === undefined) ? 'spell-error' : 'grammar-error'}>
              {s.text}
            </span>
          ) : (
            s.text
          ),
        )}
        {'\n '}
      </div>
      {hit && createPortal(<ProofCard hit={hit} replace={replace} onClose={() => setHit(null)} />, document.body)}
    </>
  )
}
