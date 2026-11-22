import { Plus, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { newId } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useUndoRedoKeys } from '@/core/state'
import { openDocument } from '@/shared/entityList'
import { NumberInput, PresetHeader } from '@/shared/calculators'
import '@/shared/listDetail/listDetail.css'
import { BEAT_KINDS, createPacingDoc, newBeat, pacingNotes, type Beat, type BeatKind, type PacingDoc } from './model'
import { createPlaytestsDoc, RATINGS, sectionAverages, type PlaytestsDoc, type SectionAverage } from '../playtests/model'
import './pacing.css'

const W = 900
const H = 300
const PAD = { l: 40, r: 20, t: 20, b: 50 }

/** Pacing / player journey graph (v0.10). Drag points up and down to set a beat's value. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<PacingDoc>('pacing', documentId!, createPacingDoc)
  useUndoRedoKeys(doc, active)
  const [sel, setSel] = useState<string | null>(null)
  const [drag, setDrag] = useState<{
    beat: string
    curve: string
    value: number
  } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const tests = useDocument<PlaytestsDoc>('playtests', 'playtests', createPlaytestsDoc)
  const [showTests, setShowTests] = useState(true)
  if (!doc.data) return null
  const d = doc.data
  // 0.35: what playtesters felt in each beat (sections of sessions that picked this journey).
  const felt = new Map<string, SectionAverage>(sectionAverages(tests.data?.items ?? [], new Set(d.beats.map((b) => b.id))).flatMap((a) => (a.beatId && a.testers ? [[a.beatId, a] as const] : [])))
  const overlay = showTests && felt.size > 0
  const set = (fn: (d: PacingDoc) => PacingDoc) => doc.update(fn)
  const editBeat = (id: string, patch: Partial<Beat>) =>
    set((x) => ({
      ...x,
      beats: x.beats.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }))
  const beats = [...d.beats].sort((a, b) => a.at - b.at)
  const max = Math.max(10, ...beats.map((b) => b.at))
  const x = (at: number) => PAD.l + (at / max) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - v / 10) * (H - PAD.t - PAD.b)
  const valueAt = (clientY: number) => {
    const r = svg.current!.getBoundingClientRect()
    const py = ((clientY - r.top) / r.height) * H
    return Math.max(0, Math.min(10, Math.round((1 - (py - PAD.t) / (H - PAD.t - PAD.b)) * 20) / 2))
  }
  const val = (b: Beat, curve: string) => (drag && drag.beat === b.id && drag.curve === curve ? drag.value : (b.values[curve] ?? 0))
  const beat = d.beats.find((b) => b.id === sel)
  const notes = [
    ...d.curves.flatMap((c) => pacingNotes(d.beats, c)),
    ...(overlay
      ? beats.flatMap((b) => {
          const a = felt.get(b.id)
          return a?.flags.length ? [`Testers found "${b.name}" ${a.flags.join(', ')} (${a.testers} tester${a.testers > 1 ? 's' : ''}).`] : []
        })
      : []),
  ]
  const fy = (v: number) => y(((v - 1) / 4) * 10)
  const funBeats = beats.filter((b) => felt.get(b.id)?.fun != null)
  const planned = (b: Beat) => {
    const i = beats.indexOf(b)
    return i >= 0 && i < beats.length - 1 ? beats[i + 1].at - b.at : null
  }

  return (
    <div className="pc">
      <div className="pc-head">
        <PresetHeader documentId={documentId!} kind="Pacing" undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
      </div>
      <div className="ld-toolbar">
        <button
          className="btn btn-primary"
          onClick={() => {
            const n = newBeat((beats.at(-1)?.at ?? 0) + 10, d.curves)
            set((x) => ({ ...x, beats: [...x.beats, n] }))
            setSel(n.id)
          }}
        >
          <Plus size={14} /> Add beat
        </button>
        {d.curves.map((c) => (
          <span key={c.id} className="pc-curve">
            <input
              type="color"
              value={c.color}
              onChange={(e) =>
                set((x) => ({
                  ...x,
                  curves: x.curves.map((o) => (o.id === c.id ? { ...o, color: e.target.value } : o)),
                }))
              }
              aria-label="Curve color"
            />
            <input
              className="input"
              value={c.name}
              onChange={(e) =>
                set((x) => ({
                  ...x,
                  curves: x.curves.map((o) => (o.id === c.id ? { ...o, name: e.target.value } : o)),
                }))
              }
            />
            {d.curves.length > 1 && (
              <button
                className="icon-btn"
                aria-label="Remove curve"
                onClick={() =>
                  set((x) => ({
                    ...x,
                    curves: x.curves.filter((o) => o.id !== c.id),
                  }))
                }
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        <button
          className="btn btn-ghost"
          onClick={() =>
            set((x) => ({
              ...x,
              curves: [...x.curves, { id: newId(), name: 'Difficulty', color: '#3e8ef7' }],
            }))
          }
        >
          <Plus size={14} /> Curve
        </button>
        {felt.size > 0 && (
          <label className="ld-inline" title="Show what playtesters felt in each beat (from the Playtests tool)">
            <input type="checkbox" checked={showTests} onChange={(e) => setShowTests(e.target.checked)} />
            Playtests
          </label>
        )}
        <label className="ld-inline">
          Unit
          <input className="input" style={{ width: 70 }} value={d.unit} onChange={(e) => set((x) => ({ ...x, unit: e.target.value }))} />
        </label>
      </div>
      <div className="pc-body">
        <div className="pc-main">
          <svg
            ref={svg}
            className="pc-chart"
            viewBox={`0 0 ${W} ${H}`}
            onMouseMove={(e) => drag && setDrag({ ...drag, value: valueAt(e.clientY) })}
            onMouseUp={() => {
              if (drag) {
                const b = d.beats.find((o) => o.id === drag.beat)
                if (b)
                  editBeat(b.id, {
                    values: { ...b.values, [drag.curve]: drag.value },
                  })
              }
              setDrag(null)
            }}
            onMouseLeave={() => setDrag(null)}
          >
            {[0, 2.5, 5, 7.5, 10].map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="pc-grid" />
                <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="pc-axis">
                  {v}
                </text>
              </g>
            ))}
            {beats.map((b) => (
              <g key={b.id}>
                <line x1={x(b.at)} x2={x(b.at)} y1={PAD.t} y2={H - PAD.b} className={`pc-beatline${sel === b.id ? ' on' : ''}`} />
                <text x={x(b.at)} y={H - PAD.b + 16} textAnchor="middle" className="pc-axis" onClick={() => setSel(b.id)}>
                  {b.name.slice(0, 14)}
                </text>
                <text x={x(b.at)} y={H - PAD.b + 30} textAnchor="middle" className="pc-axis muted">
                  {b.at} {d.unit}
                </text>
              </g>
            ))}
            {overlay && beats.map((b) => (felt.get(b.id)?.flags.length ? <rect key={`f${b.id}`} x={x(b.at) - 14} width={28} y={PAD.t} height={H - PAD.t - PAD.b} rx={6} className="pc-flagband" /> : null))}
            {d.curves.map((c) => (
              <g key={c.id}>
                <polyline fill="none" stroke={c.color} strokeWidth={3} strokeLinejoin="round" points={beats.map((b) => `${x(b.at)},${y(val(b, c.id))}`).join(' ')} />
                {beats.map((b) => (
                  <circle
                    key={b.id}
                    cx={x(b.at)}
                    cy={y(val(b, c.id))}
                    r={sel === b.id ? 8 : 6}
                    fill={c.color}
                    stroke="var(--bg)"
                    strokeWidth={2}
                    className="pc-point"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setSel(b.id)
                      setDrag({
                        beat: b.id,
                        curve: c.id,
                        value: b.values[c.id] ?? 0,
                      })
                    }}
                  >
                    <title>{`${b.name}: ${c.name} ${b.values[c.id] ?? 0}`}</title>
                  </circle>
                ))}
              </g>
            ))}
            {overlay && funBeats.length > 0 && (
              <g className="pc-felt">
                <polyline fill="none" strokeWidth={2} strokeDasharray="6 5" points={funBeats.map((b) => `${x(b.at)},${fy(felt.get(b.id)!.fun!)}`).join(' ')} />
                {funBeats.map((b) => (
                  <circle key={b.id} cx={x(b.at)} cy={fy(felt.get(b.id)!.fun!)} r={4}>
                    <title>{`Testers: fun ${felt.get(b.id)!.fun} of 5 (${felt.get(b.id)!.testers})`}</title>
                  </circle>
                ))}
              </g>
            )}
          </svg>
          {overlay && (
            <p className="pc-legend muted">
              <span className="pc-legend-dash" /> Testers: fun (1 to 5, drawn on the same height) <span className="pc-legend-band" /> testers had a problem here
            </p>
          )}
          {notes.length > 0 && (
            <div className="pc-notes">
              {notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
          )}
          <div className="pc-strip">
            {beats.map((b) => (
              <button key={b.id} className={`pc-card${sel === b.id ? ' on' : ''}`} onClick={() => setSel(b.id)}>
                <strong>{b.name}</strong>
                <span>
                  {b.kind}
                  {b.emotion ? ` · ${b.emotion}` : ''}
                </span>
                {overlay && felt.get(b.id) && <FeltLine a={felt.get(b.id)!} />}
              </button>
            ))}
          </div>
        </div>
        {beat && (
          <aside className="pc-side">
            <div className="ld-inline">
              <input className="input" style={{ flex: 1, fontWeight: 600 }} value={beat.name} onChange={(e) => editBeat(beat.id, { name: e.target.value })} aria-label="Beat name" />
              <button className="icon-btn" aria-label="Close" onClick={() => setSel(null)}>
                <X size={14} />
              </button>
            </div>
            <label className="ld-field">
              <span>Kind</span>
              <select className="input" value={beat.kind} onChange={(e) => editBeat(beat.id, { kind: e.target.value as BeatKind })}>
                {BEAT_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="ld-field">
              <span>At ({d.unit})</span>
              <NumberInput value={beat.at} min={0} onChange={(at) => editBeat(beat.id, { at })} />
            </label>
            {d.curves.map((c) => (
              <label key={c.id} className="ld-field">
                <span style={{ color: c.color }}>
                  {c.name}: {beat.values[c.id] ?? 0}
                </span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.5}
                  value={beat.values[c.id] ?? 0}
                  onChange={(e) =>
                    editBeat(beat.id, {
                      values: {
                        ...beat.values,
                        [c.id]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
            <label className="ld-field">
              <span>How the player should feel</span>
              <input className="input" placeholder="Tense, relieved, awed…" value={beat.emotion} onChange={(e) => editBeat(beat.id, { emotion: e.target.value })} />
            </label>
            {felt.get(beat.id) && <FeltPanel a={felt.get(beat.id)!} planned={planned(beat)} unit={d.unit} />}
            <label className="ld-field">
              <span>Notes</span>
              <textarea className="input" rows={4} value={beat.notes} onChange={(e) => editBeat(beat.id, { notes: e.target.value })} />
            </label>
            <button
              className="btn btn-danger ld-danger"
              onClick={() => {
                set((x) => ({
                  ...x,
                  beats: x.beats.filter((o) => o.id !== beat.id),
                }))
                setSel(null)
              }}
            >
              <Trash2 size={14} /> Delete beat
            </button>
          </aside>
        )}
      </div>
    </div>
  )
}

/** One line on a beat card: how many testers and what went wrong. */
function FeltLine({ a }: { a: SectionAverage }) {
  const tags = a.tags.slice(0, 2).map(([t, n]) => `${t} ×${n}`)
  return (
    <span className={a.flags.length ? 'pc-felt-line bad' : 'pc-felt-line'}>
      {a.testers} tester{a.testers > 1 ? 's' : ''}: {[...(a.flags.length ? a.flags : ['fine']), ...tags].join(', ')}
    </span>
  )
}

/** Averages of one beat in the side panel, with planned vs played minutes. */
function FeltPanel({ a, planned, unit }: { a: SectionAverage; planned: number | null; unit: string }) {
  return (
    <div className="pc-feltpanel">
      <strong>
        Playtests ({a.testers} tester{a.testers > 1 ? 's' : ''})
      </strong>
      {RATINGS.map((r) =>
        a[r.key] == null ? null : (
          <div key={r.key} className="pc-felt-row" title={`1 = ${r.low}, 5 = ${r.high}`}>
            <span>{r.label}</span>
            <span className="pc-felt-bar">
              <span style={{ width: `${((a[r.key]! - 1) / 4) * 100}%` }} />
            </span>
            <span>{a[r.key]}</span>
          </div>
        ),
      )}
      {a.minutes != null && (
        <p className="muted">
          Played {a.minutes} min
          {planned != null && unit === 'min' ? ` (planned ${planned} min)` : ''}
        </p>
      )}
      {a.flags.length > 0 && <p className="pc-felt-line bad">{a.flags.join(', ')}</p>}
      {a.tags.length > 0 && <p className="muted">Seen: {a.tags.map(([t, n]) => `${t} ×${n}`).join(', ')}</p>}
      {a.bugs > 0 && (
        <p className="muted">
          {a.bugs} open bug{a.bugs > 1 ? 's' : ''}
        </p>
      )}
      <button className="btn btn-ghost" onClick={() => openDocument('playtests')}>
        Open Playtests
      </button>
    </div>
  )
}
