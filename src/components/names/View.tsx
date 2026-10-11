import { Dices, Plus, Star, X } from 'lucide-react'
import { useState } from 'react'
import type { PanelProps } from '@/core/registry'
import { useDocument, useUndoRedoKeys } from '@/core/state'
import { NumberInput, PresetHeader } from '@/shared/calculators'
import '@/shared/listDetail/listDetail.css'
import { createLanguageDoc, makeWord, names, newWord, PRESETS, rng, translate, type LanguageDoc } from './model'
import './names.css'
import { NAME_STYLES, styleNames } from './styles'

/** Name generator and small conlang builder (v0.10). */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<LanguageDoc>('names', documentId!, createLanguageDoc)
  useUndoRedoKeys(doc, active)
  const [batch, setBatch] = useState<string[]>([])
  const [text, setText] = useState('The king returns to the old forest.')
  // v0.13: real-world name styles (German, Polish, Canadian…), searchable.
  const [style, setStyle] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [invent, setInvent] = useState(false)
  const shownStyles = NAME_STYLES.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
  if (!doc.data) return null
  const d = doc.data
  const set = (patch: Partial<LanguageDoc>) => doc.update((x) => ({ ...x, ...patch }))
  const picked = NAME_STYLES.find((s) => s.name === style)
  const roll = () => setBatch(picked ? styleNames(picked, 24, invent, rng(Date.now())) : names(d, 24))
  const field = (key: 'consonants' | 'vowels' | 'patterns' | 'forbidden' | 'endings', label: string, hint: string) => (
    <label className="ld-field">
      <span>{label}</span>
      <input className="input" placeholder={hint} value={d[key]} onChange={(e) => set({ [key]: e.target.value })} />
    </label>
  )

  return (
    <div className="nm">
      <div className="nm-head">
        <PresetHeader documentId={documentId!} kind="Language" undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
      </div>
      <div className="nm-body">
        <section className="nm-col">
          <h3>Sounds</h3>
          <label className="ld-field">
            <span>Start from</span>
            <select className="input" value="" onChange={(e) => e.target.value && set(PRESETS[e.target.value])}>
              <option value="">A preset…</option>
              {Object.keys(PRESETS).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          {field('consonants', 'Consonants', 'k t r s th …')}
          {field('vowels', 'Vowels', 'a e i o u …')}
          {field('patterns', 'Syllable shapes (C = consonant, V = vowel)', 'CV CVC V')}
          <div className="ld-inline">
            Syllables
            <NumberInput value={d.minSyllables} min={1} max={8} onChange={(v) => set({ minSyllables: Math.max(1, Math.round(v)) })} /> to
            <NumberInput value={d.maxSyllables} min={1} max={8} onChange={(v) => set({ maxSyllables: Math.max(1, Math.round(v)) })} />
          </div>
          {field('endings', 'Endings (sometimes added)', 'ion iel or')}
          {field('forbidden', 'Never use these letter pairs', 'qq aa')}
        </section>

        <section className="nm-col">
          <h3>
            Names
            <button className="btn btn-primary" onClick={roll}>
              <Dices size={14} /> Generate
            </button>
          </h3>
          <div className="nm-styles">
            <input className="input" placeholder={`Search ${NAME_STYLES.length} name styles…`} aria-label="Search name styles" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="nm-style-list" role="radiogroup" aria-label="Name style">
              <button role="radio" aria-checked={!style} className={!style ? 'on' : ''} onClick={() => setStyle(null)}>
                Your language (the sounds on the left)
              </button>
              {shownStyles.map((s) => (
                <button key={s.name} role="radio" aria-checked={style === s.name} className={style === s.name ? 'on' : ''} onClick={() => setStyle(s.name)}>
                  {s.name}
                </button>
              ))}
              {shownStyles.length === 0 && <span className="muted">No style matches.</span>}
            </div>
            {picked && (
              <label className="sketch-check">
                <input type="checkbox" checked={invent} onChange={(e) => setInvent(e.target.checked)} /> New names that sound like it (not real ones)
              </label>
            )}
          </div>
          {batch.length === 0 && <p className="muted">Press Generate for a batch of names. Click a name to keep it.</p>}
          <div className="nm-names">
            {batch.map((n) => (
              <button key={n} className={`nm-name${d.saved.includes(n) ? ' on' : ''}`} onClick={() => !d.saved.includes(n) && set({ saved: [...d.saved, n] })}>
                {n}
              </button>
            ))}
          </div>
          <strong>Kept names</strong>
          <div className="nm-names">
            {d.saved.length === 0 && <span className="muted">None yet.</span>}
            {d.saved.map((n) => (
              <span key={n} className="nm-name on">
                <Star size={11} /> {n}
                <button className="icon-btn" aria-label={`Remove ${n}`} onClick={() => set({ saved: d.saved.filter((x) => x !== n) })}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        </section>

        <section className="nm-col">
          <h3>
            Dictionary
            <button className="btn" onClick={() => set({ dictionary: [...d.dictionary, newWord()] })}>
              <Plus size={14} /> Add word
            </button>
          </h3>
          <table className="calc-table nm-dict">
            <thead>
              <tr>
                <th>Meaning</th>
                <th>Word</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.dictionary.map((w) => (
                <tr key={w.id}>
                  <td>
                    <input className="input" value={w.meaning} placeholder="king" onChange={(e) => set({ dictionary: d.dictionary.map((o) => (o.id === w.id ? { ...o, meaning: e.target.value } : o)) })} />
                  </td>
                  <td className="ld-inline">
                    <input className="input" value={w.word} placeholder="(made up)" onChange={(e) => set({ dictionary: d.dictionary.map((o) => (o.id === w.id ? { ...o, word: e.target.value } : o)) })} />
                    <button
                      className="icon-btn"
                      title="Make up a word"
                      aria-label="Make up a word"
                      onClick={() => set({ dictionary: d.dictionary.map((o) => (o.id === w.id ? { ...o, word: makeWord(d, rng(Date.now())) ?? o.word } : o)) })}
                    >
                      <Dices size={13} />
                    </button>
                  </td>
                  <td>
                    <button className="icon-btn" aria-label="Delete word" onClick={() => set({ dictionary: d.dictionary.filter((o) => o.id !== w.id) })}>
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <strong>Translate</strong>
          <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <p className="nm-out">{translate(d, text)}</p>
          <p className="muted">Words in the dictionary use your word; any other word always gets the same made-up word, so sentences stay consistent.</p>
        </section>
      </div>
    </div>
  )
}
