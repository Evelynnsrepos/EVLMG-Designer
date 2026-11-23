import { ArrowRight, BellOff, BookPlus, CaseUpper, Trash2, Volume2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSettings } from '@/core/state'
import { aiReady, fixOptions, fixTitle, guessLang, ignoreFix } from './proof'
import { sentences, type Lang } from './lang'

/** A click on underlined text. `from`/`to` are the caller's own positions; `para`/`at` locate the spot in its paragraph. */
export interface ProofHit {
  x: number
  y: number
  from: number
  to: number
  bad: string
  /** The AI helper's fix, when it underlined this spot. */
  fix?: string
  /** Set when the dictionary does not know this word. */
  word?: string
  para: string
  at: number
  /** A writing hint: the words that could be meant, the one-line explanation and the kind of hint. */
  fixes?: string[]
  why?: string
  rule?: string
  lang?: Lang
  /** Every hint of the same kind in the paragraph (German nouns typed small), in the caller's positions. */
  group?: { from: number; to: number; fix: string }[]
  /** Going through the text one mistake at a time: the card shows the sentence and moves on after a fix. */
  walk?: boolean
}

/** Reads the sentence around the hit aloud, in its language, with the computer's own voice. Hearing a sentence often shows the wrong word. */
function readAloud(hit: ProofHit) {
  const s = sentences(hit.para).findLast((x) => x.from <= hit.at)?.text ?? hit.para
  const say = new SpeechSynthesisUtterance(s)
  say.lang = (hit.lang ?? guessLang(s)) === 'de' ? 'de-DE' : 'en-US'
  say.rate = 0.9
  speechSynthesis.cancel()
  speechSynthesis.speak(say)
}
const NOT_TYPING = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Escape'])
const canRead = () => typeof speechSynthesis !== 'undefined' && speechSynthesis.getVoices().length > 0

const UI = {
  kind: 'Correctness',
  more: 'Looking for more options…',
  none: 'No suggestions',
  dismiss: 'Dismiss',
  add: 'Add to dictionary',
  hint: 'Check this word',
  read: 'Read the sentence aloud',
  off: 'Stop hints like this',
  everywhere: 'Fix this word everywhere in this text',
  nouns: (n: number) => `Capital letters for all ${n} nouns in this paragraph`,
  next: 'Next',
  keys: 'Enter takes the first fix · → goes on · Esc stops',
  close: 'Close',
}

/** Suggestion card on an underline: what kind of mistake, about 3 fixes, Dismiss and Add to dictionary. */
export function ProofCard({
  hit,
  replace,
  onClose,
  replaceAll,
  replaceMany,
  onNext,
}: {
  hit: ProofHit
  replace: (from: number, to: number, text: string) => void
  onClose: () => void
  /** Replaces the whole word `bad` everywhere in the text, as one undo step. Without it the card has no "everywhere" box. */
  replaceAll?: (bad: string, fix: string) => void
  /** Several replacements as one undo step. */
  replaceMany?: (list: { from: number; to: number; fix: string }[]) => void
  /** Walk-through: open the next underline after this document position. */
  onNext?: (after: number) => void
}) {
  const [everywhere, setEverywhere] = useState(false)
  const [options, setOptions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const card = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: hit.x, top: hit.y + 14 })

  useEffect(() => {
    let live = true
    void fixOptions(hit.para, hit.at, hit.at + hit.bad.length, hit.fix, hit.word, (o) => live && setOptions(o), { fixes: hit.fixes, lang: hit.lang }).then(() => live && setLoading(false))
    const close = (e: MouseEvent | KeyboardEvent) => {
      // Esc closes the card only; preventDefault keeps the shell from switching to Layout Mode (ED-7).
      if (e instanceof KeyboardEvent && e.key === 'Escape') e.preventDefault()
      const walkKey = e instanceof KeyboardEvent && hit.walk && (e.key === 'Enter' || e.key === 'ArrowRight')
      // Esc, a click elsewhere, or typing in the text (any key but a bare modifier) closes the card.
      const typed = e instanceof KeyboardEvent && !walkKey && !NOT_TYPING.has(e.key) && !(e.target as Element | null)?.closest?.('.proof-card')
      if (e instanceof KeyboardEvent ? e.key === 'Escape' || typed : !(e.target as Element).closest?.('.proof-card')) onClose()
      // Walk-through keys: Enter takes the first fix, the right arrow skips to the next mistake.
      if (walkKey) {
        e.preventDefault()
        e.stopPropagation()
        const first = card.current?.querySelector<HTMLButtonElement>('.proof-card-option')
        if (e.key === 'Enter' && first) first.click()
        else onNext?.(hit.from)
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close, true)
    return () => {
      live = false
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close, true)
    }
  }, [hit, onClose, onNext])

  // Stay on screen: below the word, or above it near the bottom edge.
  useLayoutEffect(() => {
    const r = card.current!.getBoundingClientRect()
    const left = Math.max(8, Math.min(hit.x - 16, window.innerWidth - r.width - 8))
    const top = hit.y + 14 + r.height > window.innerHeight - 8 ? Math.max(8, hit.y - r.height - 14) : hit.y + 14
    if (left !== pos.left || top !== pos.top) setPos({ left, top })
  }, [hit, options, loading, pos])

  const spelling = hit.fix === undefined
  const sentence = hit.walk ? sentences(hit.para).findLast((x) => x.from <= hit.at) : undefined
  const pick = (o: string) => {
    // Remember what the writer meant by this spelling: next time it is the first fix.
    if (hit.word && !hit.rule) {
      const s = useSettings.getState()
      s.update({ learnedFixes: { ...s.learnedFixes, [hit.word.toLowerCase()]: o } })
    }
    if (everywhere && replaceAll) replaceAll(hit.bad, o)
    else replace(hit.from, hit.to, o)
    if (hit.walk && onNext) onNext(hit.from + o.length)
    else onClose()
  }
  return (
    <div ref={card} className="proof-card" style={{ position: 'fixed', ...pos }} role="dialog" aria-label={UI.kind}>
      <header className="proof-card-head">
        <span className={spelling ? 'proof-dot proof-dot-spell' : 'proof-dot'} />
        <span>
          {hit.why ? UI.hint : `${UI.kind} · ${fixTitle(hit.bad, hit.fix, hit.word !== undefined && hit.fix === undefined)}`}
        </span>
        {canRead() && (
          <button className="icon-btn" title={UI.read} onClick={() => readAloud(hit)}>
            <Volume2 size={14} />
          </button>
        )}
        <button className="icon-btn" title={UI.close} onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      {sentence ? (
        <div className="proof-card-sentence">
          {sentence.text.slice(0, hit.at - sentence.from)}
          <mark>{hit.bad}</mark>
          {sentence.text.slice(hit.at - sentence.from + hit.bad.length)}
        </div>
      ) : (
        <div className="proof-card-bad">{hit.bad}</div>
      )}
      {hit.why && <div className="proof-card-why">{hit.why}</div>}
      <div className="proof-card-options">
        {options.map((o) => (
          <button
            key={o}
            className="proof-card-option"
            onClick={() => pick(o)}
          >
            {o}
          </button>
        ))}
        {!loading && options.length === 0 && <span className="muted">{UI.none}</span>}
      </div>
      {loading && aiReady() && <div className="proof-card-note">{UI.more}</div>}
      {hit.word && !hit.rule && replaceAll && (
        <label className="proof-card-note proof-card-check">
          <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} /> {UI.everywhere}
        </label>
      )}
      {hit.group && hit.group.length > 1 && replaceMany && (
        <button
          className="proof-card-all"
          onClick={() => {
            replaceMany(hit.group!)
            onClose()
          }}
        >
          <CaseUpper size={14} /> {UI.nouns(hit.group.length)}
        </button>
      )}
      {hit.walk && (
        <div className="proof-card-walk">
          <span className="proof-card-note">{UI.keys}</span>
          <button onClick={() => onNext?.(hit.from)}>
            {UI.next} <ArrowRight size={14} />
          </button>
        </div>
      )}
      <footer className="proof-card-foot">
        <button
          onClick={() => {
            ignoreFix(hit.fix === undefined ? (hit.word ?? hit.bad) : hit.bad, hit.fix ?? '')
            onClose()
          }}
        >
          <Trash2 size={14} /> {UI.dismiss}
        </button>
        {hit.rule && (
          <button
            onClick={() => {
              const s = useSettings.getState()
              if (!s.spellRulesOff.includes(hit.rule!)) s.update({ spellRulesOff: [...s.spellRulesOff, hit.rule!] })
              onClose()
            }}
          >
            <BellOff size={14} /> {UI.off}
          </button>
        )}
        {hit.word && (
          <button
            onClick={() => {
              useSettings.getState().addWord(hit.word!)
              onClose()
            }}
          >
            <BookPlus size={14} /> {UI.add}
          </button>
        )}
      </footer>
    </div>
  )
}
