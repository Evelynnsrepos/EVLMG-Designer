import { Eye, Pause, Plus, SkipForward, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { newId } from '@/core/model'
import { clock, newFinding, newSection, RATINGS, WATCH_TAGS, type Observation, type SectionRating, type Session } from './model'

/** Sections of one session with 1–5 buttons per rating (0.35). Clicking the chosen number again clears it. */
export function SectionTable({ sections, onChange }: { sections: SectionRating[]; onChange(next: SectionRating[]): void }) {
  const [name, setName] = useState('')
  const edit = (id: string, patch: Partial<SectionRating>) => onChange(sections.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const add = () => {
    if (!name.trim()) return
    onChange([...sections, newSection(name.trim())])
    setName('')
  }
  return (
    <div className="pt-sections">
      {sections.length > 0 && (
        <table className="calc-table pt-sec-table">
          <thead>
            <tr>
              <th>Section</th>
              {RATINGS.map((r) => (
                <th key={r.key} title={`1 = ${r.low}, 5 = ${r.high}`}>
                  {r.label}
                </th>
              ))}
              <th>Minutes</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sections.map((sec) => (
              <tr key={sec.id}>
                <td className="pt-sec-name">{sec.name}</td>
                {RATINGS.map((r) => (
                  <td key={r.key}>
                    <Dots value={sec[r.key]} label={r} onChange={(v) => edit(sec.id, { [r.key]: v })} />
                  </td>
                ))}
                <td>
                  <input
                    className="input pt-min"
                    type="number"
                    min={0}
                    step={0.5}
                    value={sec.minutes ?? ''}
                    onChange={(e) =>
                      edit(sec.id, {
                        minutes: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                      })
                    }
                    aria-label={`Minutes in ${sec.name}`}
                  />
                </td>
                <td>
                  <input className="input pt-sec-note" value={sec.notes} onChange={(e) => edit(sec.id, { notes: e.target.value })} aria-label={`Note for ${sec.name}`} />
                </td>
                <td>
                  {!sec.beatId && (
                    <button className="icon-btn" aria-label="Remove section" onClick={() => onChange(sections.filter((x) => x.id !== sec.id))}>
                      <X size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="ld-inline">
        <input className="input" placeholder="Section name, e.g. Tutorial" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn btn-ghost" onClick={add} disabled={!name.trim()}>
          <Plus size={14} /> Add section
        </button>
      </div>
    </div>
  )
}

function Dots({ value, label, onChange }: { value: number | null | undefined; label: (typeof RATINGS)[number]; onChange(v: number | null): void }) {
  const right = label.key !== 'fun' && label.key !== 'boring'
  return (
    <span className="pt-dots" role="radiogroup" aria-label={label.label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          className={`pt-dot${value === n ? ' on' : ''}${right && n === 3 ? ' mid' : ''}`}
          title={n === 1 ? label.low : n === 5 ? label.high : right && n === 3 ? 'Just right' : String(n)}
          onClick={() => onChange(value === n ? null : n)}
        >
          {n}
        </button>
      ))}
    </span>
  )
}

/**
 * Watch mode (0.35): a timer, the current section and one-click tags for what the tester does.
 * Next section / Stop add the time spent to the section's minutes.
 */
export function Watch({ session, sections, onChange }: { session: Session; sections: SectionRating[]; onChange(patch: Partial<Session>): void }) {
  const log = session.log ?? []
  const [run, setRun] = useState<{
    start: number
    base: number
    secStart: number
    sectionId: string | null
  } | null>(null)
  const [text, setText] = useState('')
  const [, tick] = useState(0)
  useEffect(() => {
    if (!run) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [run])
  const now = run ? run.base + (Date.now() - run.start) / 1000 : Math.max(0, ...log.map((o) => o.t))
  const current = sections.find((x) => x.id === run?.sectionId)

  /** Sections with the time since `run.secStart` added to the current one. */
  const withTime = () => {
    if (!run?.sectionId) return sections
    const add = (now - run.secStart) / 60
    if (add < 0.25) return sections // under 15 s: just passing through, leave it unrated
    return sections.map((x) => (x.id === run.sectionId ? { ...x, minutes: Math.round(((x.minutes ?? 0) + add) * 2) / 2 } : x))
  }
  const note = (tag: string) => {
    const o: Observation = {
      id: newId(),
      t: Math.round(now),
      sectionId: run?.sectionId ?? null,
      tag,
      text: text.trim(),
    }
    const patch: Partial<Session> = { log: [...log, o] }
    if (tag === 'Bug')
      patch.findings = [
        ...session.findings,
        {
          ...newFinding('bug'),
          text: o.text || `Bug at ${clock(o.t)}`,
          sectionId: o.sectionId,
          area: current?.name ?? '',
        },
      ]
    onChange(patch)
    setText('')
  }
  const start = () =>
    setRun({
      start: Date.now(),
      base: now,
      secStart: now,
      sectionId: run?.sectionId ?? sections[0]?.id ?? null,
    })
  const stop = () => {
    onChange({
      sections: withTime(),
      minutes: Math.max(session.minutes, Math.round(now / 60)),
    })
    setRun(null)
  }
  const moveTo = (id: string | null) => {
    if (!run) return
    onChange({ sections: withTime() })
    setRun({ ...run, secStart: now, sectionId: id })
  }
  const next = () => moveTo(sections[sections.findIndex((x) => x.id === run?.sectionId) + 1]?.id ?? null)

  return (
    <div className={`pt-watch${run ? ' on' : ''}`}>
      <div className="ld-inline">
        {run ? (
          <button className="btn btn-primary" onClick={stop}>
            <Pause size={14} /> Stop watching
          </button>
        ) : (
          <button className="btn btn-primary" onClick={start} title="Start a timer and note what the tester does while they play">
            <Eye size={14} /> {log.length ? 'Go on watching' : 'Watch'}
          </button>
        )}
        <span className="pt-clock">{clock(now)}</span>
        {run && sections.length > 0 && (
          <>
            <select className="input" value={run.sectionId ?? ''} onChange={(e) => moveTo(e.target.value || null)} aria-label="Current section">
              <option value="">No section</option>
              {sections.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <button className="btn btn-ghost" onClick={next} disabled={!run.sectionId} title="The tester moved on; the time spent is added to this section's minutes">
              <SkipForward size={14} /> Next section
            </button>
          </>
        )}
      </div>
      {run && (
        <>
          <div className="pt-tags">
            {WATCH_TAGS.map((t) => (
              <button key={t} className={`btn${t === 'Bug' ? ' btn-danger' : ''}`} onClick={() => note(t)}>
                {t}
              </button>
            ))}
          </div>
          <input
            className="input"
            placeholder="What happened? Enter adds a note (a tag button adds it with the tag)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && text.trim() && note('')}
          />
        </>
      )}
      {log.length > 0 && (
        <ul className="pt-log">
          {[...log].reverse().map((o) => (
            <li key={o.id}>
              <span className="pt-clock">{clock(o.t)}</span>
              {o.tag && <span className="pt-tag">{o.tag}</span>}
              <span className="muted">{sections.find((x) => x.id === o.sectionId)?.name ?? ''}</span>
              <span className="pt-text">{o.text}</span>
              <button className="icon-btn" aria-label="Remove note" onClick={() => onChange({ log: log.filter((x) => x.id !== o.id) })}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
