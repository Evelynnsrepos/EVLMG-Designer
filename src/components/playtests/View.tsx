import { ListTodo, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { PanelProps } from '@/core/registry'
import { loadDocumentNow, updateDocument, useDocumentsOfType, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { openDocument } from '@/shared/entityList'
import { createTasksDoc, newTask, type Task, type TasksDoc } from '../tasks/model'
import { createPacingDoc, type PacingDoc } from '../pacing/model'
import { NumberInput } from '@/shared/calculators'
import { Field, ListDetail, useItems } from '@/shared/listDetail'
import { ProofTextarea } from '@/shared/spell'
import {
  byBuild,
  createPlaytestsDoc,
  newFinding,
  newSession,
  openFindings,
  RATINGS,
  sectionAverages,
  SEVERITIES,
  syncSections,
  type Finding,
  type PlaytestsDoc,
  type SectionRating,
  type Session,
  type Severity,
} from './model'
import { SectionTable, Watch } from './Sections'
import './playtests.css'

/** Playtest tracker (v0.10). */
export default function View({ active }: PanelProps) {
  const list = useItems<Session, PlaytestsDoc>('playtests', 'playtests', createPlaytestsDoc)
  useUndoRedoKeys(list.doc, active)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const s = list.items.find((x) => x.id === selectedId)
  const edit = (p: Partial<Session>) => s && list.edit(s.id, p)
  const editFinding = (sessionId: string, findingId: string, patch: Partial<Finding>) => {
    const ses = list.items.find((x) => x.id === sessionId)
    if (ses)
      list.edit(sessionId, {
        findings: ses.findings.map((f) => (f.id === findingId ? { ...f, ...patch } : f)),
      })
  }
  const sevColor = (k: Severity) => SEVERITIES.find((x) => x.id === k)?.color
  const sorted = [...list.items].sort((a, b) => b.date.localeCompare(a.date))
  const journeys = useDocumentsOfType<PacingDoc>('pacing', createPacingDoc)
  const journey = journeys.find((j) => j.id === s?.journeyId)
  const sections: SectionRating[] = s ? (journey ? syncSections(s.sections ?? [], journey.data.beats) : (s.sections ?? [])) : []

  return (
    <ListDetail
      rows={sorted.map((x) => ({
        id: x.id,
        label: `${x.date} · ${x.tester || 'Tester'}`,
        sub: `${x.build ? `build ${x.build} · ` : ''}${x.findings.filter((f) => !f.fixed).length} open findings`,
      }))}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onAdd={() => {
        const n = newSession()
        list.add(n)
        setSelectedId(n.id)
      }}
      addLabel="New session"
      empty="No playtests yet. Add a session after each test: who played, which build, scores and what they found."
      toolbar={
        <button className={`btn${selectedId === null ? ' btn-primary' : ''}`} onClick={() => setSelectedId(null)}>
          Overview
        </button>
      }
    >
      {s ? (
        <div className="ld-page">
          <Field label="Date">
            <input className="input" type="date" value={s.date} onChange={(e) => edit({ date: e.target.value })} />
          </Field>
          <Field label="Tester">
            <input className="input" value={s.tester} onChange={(e) => edit({ tester: e.target.value })} />
          </Field>
          <Field label="Build / version">
            <input className="input" value={s.build} onChange={(e) => edit({ build: e.target.value })} />
          </Field>
          <Field label="Minutes played">
            <NumberInput value={s.minutes} min={0} onChange={(minutes) => edit({ minutes })} />
          </Field>
          {(['fun', 'difficulty', 'clarity'] as const).map((k) => (
            <Field key={k} label={`${k === 'fun' ? 'Fun' : k === 'difficulty' ? 'Difficulty (5 = right)' : 'Clarity'}: ${s[k]}/10`}>
              <input type="range" min={1} max={10} value={s[k]} onChange={(e) => edit({ [k]: Number(e.target.value) })} />
            </Field>
          ))}
          <Field label="Notes and quotes" wide>
            <ProofTextarea className="input" rows={3} value={s.notes} onChange={(e) => edit({ notes: e.target.value })} />
          </Field>
          <div className="ld-section">
            <strong>Sections</strong>
            <div className="ld-inline">
              <span className="muted">Sections from</span>
              <select className="input" value={s.journeyId ?? ''} onChange={(e) => edit({ journeyId: e.target.value || null })} aria-label="Sections from">
                <option value="">My own list</option>
                {journeys.map((j) => (
                  <option key={j.id} value={j.id}>
                    Pacing Graph: {j.title}
                  </option>
                ))}
                {s.journeyId && !journey && <option value={s.journeyId}>(a journey that is gone)</option>}
              </select>
            </div>
            <p className="muted pt-hint">
              Rate each part from 1 to 5. Pace, length and difficulty: 3 is just right. Leave anything the tester did not say empty.
              {journey ? ' The averages show up in the Pacing Graph.' : ' Pick a Pacing Graph journey to rate its beats and see the averages there.'}
            </p>
            <SectionTable sections={sections} onChange={(next) => edit({ sections: next })} />
          </div>
          <div className="ld-section">
            <strong>Watch</strong>
            <Watch session={s} sections={sections} onChange={edit} />
          </div>
          <div className="ld-section">
            <strong>Findings and bugs</strong>
            {s.findings.map((f) => (
              <div key={f.id} className={`ld-inline pt-finding${f.fixed ? ' fixed' : ''}`}>
                <input type="checkbox" title="Fixed" checked={f.fixed} onChange={(e) => editFinding(s.id, f.id, { fixed: e.target.checked })} />
                <select
                  className="input"
                  style={{ color: sevColor(f.severity) }}
                  value={f.severity}
                  onChange={(e) =>
                    editFinding(s.id, f.id, {
                      severity: e.target.value as Severity,
                    })
                  }
                >
                  {SEVERITIES.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={f.kind ?? 'feedback'}
                  onChange={(e) =>
                    editFinding(s.id, f.id, {
                      kind: e.target.value as Finding['kind'],
                    })
                  }
                  aria-label="Bug or feedback"
                >
                  <option value="feedback">Feedback</option>
                  <option value="bug">Bug</option>
                </select>
                <input className="input pt-text" placeholder="What happened" value={f.text} onChange={(e) => editFinding(s.id, f.id, { text: e.target.value })} />
                {sections.length > 0 ? (
                  <select
                    className="input pt-area"
                    value={f.sectionId ?? ''}
                    onChange={(e) =>
                      editFinding(s.id, f.id, {
                        sectionId: e.target.value || null,
                        area: sections.find((x) => x.id === e.target.value)?.name ?? f.area,
                      })
                    }
                    aria-label="Section"
                  >
                    <option value="">Where?</option>
                    {sections.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="input pt-area" placeholder="Where" value={f.area} onChange={(e) => editFinding(s.id, f.id, { area: e.target.value })} />
                )}
                <button
                  className="icon-btn"
                  title={f.taskId ? 'Open its task' : 'Make a task for this on the Task board'}
                  aria-label={f.taskId ? 'Open its task' : 'Make a task'}
                  disabled={!f.text.trim()}
                  onClick={async () => {
                    if (!f.taskId)
                      editFinding(s.id, f.id, {
                        taskId: await makeTask(f, s.tester),
                      })
                    openDocument('tasks')
                  }}
                >
                  <ListTodo size={13} color={f.taskId ? 'var(--accent)' : undefined} />
                </button>
                <button className="icon-btn" aria-label="Remove finding" onClick={() => edit({ findings: s.findings.filter((x) => x.id !== f.id) })}>
                  <X size={13} />
                </button>
                {f.kind === 'bug' && <input className="input pt-steps" placeholder="Steps to make it happen again" value={f.steps ?? ''} onChange={(e) => editFinding(s.id, f.id, { steps: e.target.value })} />}
              </div>
            ))}
            <div className="ld-inline">
              <button className="btn btn-ghost" onClick={() => edit({ findings: [...s.findings, newFinding()] })}>
                <Plus size={14} /> Add finding
              </button>
              <button className="btn btn-ghost" onClick={() => edit({ findings: [...s.findings, newFinding('bug')] })}>
                <Plus size={14} /> Add bug
              </button>
            </div>
          </div>
          <button
            className="btn btn-danger ld-danger"
            onClick={() => {
              list.remove(s.id)
              setSelectedId(null)
            }}
          >
            <Trash2 size={14} /> Delete session
          </button>
        </div>
      ) : (
        <Overview sessions={list.items} journeys={journeys} sevColor={sevColor} onOpen={setSelectedId} onFix={(sid, fid) => editFinding(sid, fid, { fixed: true })} />
      )}
    </ListDetail>
  )
}

function Overview({
  sessions,
  journeys,
  sevColor,
  onOpen,
  onFix,
}: {
  sessions: Session[]
  journeys: { id: string; title: string; data: PacingDoc }[]
  sevColor(k: Severity): string | undefined
  onOpen(id: string): void
  onFix(sessionId: string, findingId: string): void
}) {
  if (!sessions.length) return <p className="muted">Add a session to see scores per build and open findings here.</p>
  const builds = byBuild(sessions)
  const open = openFindings(sessions)
  const minutes = sessions.reduce((t, x) => t + x.minutes, 0)
  return (
    <div className="pt-overview">
      <p>
        {sessions.length} sessions, {new Set(sessions.map((x) => x.tester.trim()).filter(Boolean)).size} testers, {Math.round(minutes / 6) / 10} hours played.
      </p>
      <h3>Scores per build</h3>
      <table className="calc-table pt-table">
        <thead>
          <tr>
            <th>Build</th>
            <th>Sessions</th>
            <th>Fun</th>
            <th>Difficulty</th>
            <th>Clarity</th>
          </tr>
        </thead>
        <tbody>
          {builds.map((b) => (
            <tr key={b.build}>
              <td>{b.build}</td>
              <td>{b.sessions}</td>
              {(['fun', 'difficulty', 'clarity'] as const).map((k) => (
                <td key={k}>
                  <span className="pt-bar" style={{ width: `${b[k] * 10}%` }} /> {b[k]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <SectionOverview sessions={sessions} journeys={journeys} />
      {[
        { title: 'Open bugs', rows: open.list.filter((f) => f.kind === 'bug') },
        {
          title: 'Open feedback',
          rows: open.list.filter((f) => f.kind !== 'bug'),
        },
      ].map((g) => (
        <div key={g.title}>
          <h3>
            {g.title} ({g.rows.length})
          </h3>
          {g.title === 'Open feedback' && open.areas.length > 0 && (
            <p className="muted">
              Most findings in:{' '}
              {open.areas
                .slice(0, 5)
                .map(([a, n]) => `${a} (${n})`)
                .join(', ')}
            </p>
          )}
          {g.rows.map((f) => (
            <div key={f.id} className="ld-inline pt-finding">
              <span className="pt-sev" style={{ background: sevColor(f.severity) }} />
              <span className="pt-text">
                {f.text}
                {f.steps ? <span className="muted"> · Steps: {f.steps}</span> : null}
              </span>
              <span className="muted">
                {f.area} · {f.tester}
              </span>
              <button className="btn btn-ghost" onClick={() => onOpen(f.sessionId)}>
                Session
              </button>
              <button className="btn btn-ghost" onClick={() => onFix(f.sessionId, f.id)}>
                Mark fixed
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Averages per section, one table per journey plus one for hand-made sections (0.35). */
function SectionOverview({ sessions, journeys }: { sessions: Session[]; journeys: { id: string; title: string; data: PacingDoc }[] }) {
  const all = sectionAverages(sessions).filter((a) => a.testers || a.tags.length || a.bugs)
  if (!all.length) return null
  const groups = [
    ...journeys.map((j) => {
      const order = [...j.data.beats].sort((a, b) => a.at - b.at).map((b) => b.id)
      const rows = all.filter((a) => a.beatId && order.includes(a.beatId)).sort((a, b) => order.indexOf(a.beatId!) - order.indexOf(b.beatId!))
      return { title: `By section: ${j.title}`, rows }
    }),
    {
      title: 'By section',
      rows: all.filter((a) => !a.beatId || !journeys.some((j) => j.data.beats.some((b) => b.id === a.beatId))),
    },
  ].filter((g) => g.rows.length)
  return (
    <>
      {groups.map((g) => (
        <div key={g.title}>
          <h3>{g.title}</h3>
          <div className="pt-sections">
            <table className="calc-table pt-table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Testers</th>
                  {RATINGS.map((r) => (
                    <th key={r.key} title={`1 = ${r.low}, 5 = ${r.high}`}>
                      {r.label}
                    </th>
                  ))}
                  <th>Minutes</th>
                  <th>Seen while watching</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((a) => (
                  <tr key={a.key}>
                    <td>
                      {a.name}
                      {a.flags.length > 0 && <span className="pt-flag"> {a.flags.join(', ')}</span>}
                    </td>
                    <td>{a.testers}</td>
                    {RATINGS.map((r) => (
                      <td key={r.key}>{a[r.key] ?? '–'}</td>
                    ))}
                    <td>{a.minutes ?? '–'}</td>
                    <td className="muted">
                      {a.tags
                        .slice(0, 3)
                        .map(([t, n]) => `${t} ×${n}`)
                        .join(', ')}
                      {a.bugs ? `${a.tags.length ? ', ' : ''}${a.bugs} open bug${a.bugs > 1 ? 's' : ''}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  )
}

const PRIORITY: Record<Severity, Task['priority']> = {
  blocker: 'Urgent',
  major: 'High',
  minor: 'Normal',
  idea: 'Low',
}

/** Puts a finding on the Task board's first column and returns the new task's id. */
async function makeTask(f: Finding, tester: string): Promise<string | null> {
  const root = useProjectStore.getState().root
  if (!root) return null
  const d = await loadDocumentNow<TasksDoc>(root, 'tasks', 'tasks', createTasksDoc)
  const t = {
    ...newTask((d.columns?.[0] ?? { id: 'todo' }).id),
    title: f.text.trim(),
    notes: `From a playtest${tester ? ` by ${tester}` : ''}${f.area ? `, where: ${f.area}` : ''}.`,
    priority: PRIORITY[f.severity],
  }
  updateDocument<TasksDoc>(root, 'tasks', 'tasks', (x) => ({
    ...x,
    items: [...x.items, t],
  }))
  return t.id
}
