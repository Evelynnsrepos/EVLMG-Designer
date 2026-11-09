import { ListTodo, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { PanelProps } from '@/core/registry'
import { loadDocumentNow, updateDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { openDocument } from '@/shared/entityList'
import { createTasksDoc, newTask, type Task, type TasksDoc } from '../tasks/model'
import { NumberInput } from '@/shared/calculators'
import { Field, ListDetail, useItems } from '@/shared/listDetail'
import { ProofTextarea } from '@/shared/spell'
import { byBuild, createPlaytestsDoc, newFinding, newSession, openFindings, SEVERITIES, type Finding, type PlaytestsDoc, type Session, type Severity } from './model'
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
    if (ses) list.edit(sessionId, { findings: ses.findings.map((f) => (f.id === findingId ? { ...f, ...patch } : f)) })
  }
  const sevColor = (k: Severity) => SEVERITIES.find((x) => x.id === k)?.color
  const sorted = [...list.items].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <ListDetail
      rows={sorted.map((x) => ({ id: x.id, label: `${x.date} · ${x.tester || 'Tester'}`, sub: `${x.build ? `build ${x.build} · ` : ''}${x.findings.filter((f) => !f.fixed).length} open findings` }))}
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
            <strong>Findings</strong>
            {s.findings.map((f) => (
              <div key={f.id} className={`ld-inline pt-finding${f.fixed ? ' fixed' : ''}`}>
                <input type="checkbox" title="Fixed" checked={f.fixed} onChange={(e) => editFinding(s.id, f.id, { fixed: e.target.checked })} />
                <select className="input" style={{ color: sevColor(f.severity) }} value={f.severity} onChange={(e) => editFinding(s.id, f.id, { severity: e.target.value as Severity })}>
                  {SEVERITIES.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
                <input className="input pt-text" placeholder="What happened" value={f.text} onChange={(e) => editFinding(s.id, f.id, { text: e.target.value })} />
                <input className="input pt-area" placeholder="Where" value={f.area} onChange={(e) => editFinding(s.id, f.id, { area: e.target.value })} />
                <button
                  className="icon-btn"
                  title={f.taskId ? 'Open its task' : 'Make a task for this on the Task board'}
                  aria-label={f.taskId ? 'Open its task' : 'Make a task'}
                  disabled={!f.text.trim()}
                  onClick={async () => {
                    if (!f.taskId) editFinding(s.id, f.id, { taskId: await makeTask(f, s.tester) })
                    openDocument('tasks')
                  }}
                >
                  <ListTodo size={13} color={f.taskId ? 'var(--accent)' : undefined} />
                </button>
                <button className="icon-btn" aria-label="Remove finding" onClick={() => edit({ findings: s.findings.filter((x) => x.id !== f.id) })}>
                  <X size={13} />
                </button>
              </div>
            ))}
            <button className="btn btn-ghost ld-danger" onClick={() => edit({ findings: [...s.findings, newFinding()] })}>
              <Plus size={14} /> Add finding
            </button>
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
        <Overview sessions={list.items} sevColor={sevColor} onOpen={setSelectedId} onFix={(sid, fid) => editFinding(sid, fid, { fixed: true })} />
      )}
    </ListDetail>
  )
}

function Overview({ sessions, sevColor, onOpen, onFix }: { sessions: Session[]; sevColor(k: Severity): string | undefined; onOpen(id: string): void; onFix(sessionId: string, findingId: string): void }) {
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
      <h3>Open findings ({open.list.length})</h3>
      {open.areas.length > 0 && <p className="muted">Most in: {open.areas.slice(0, 5).map(([a, n]) => `${a} (${n})`).join(', ')}</p>}
      {open.list.map((f) => (
        <div key={f.id} className="ld-inline pt-finding">
          <span className="pt-sev" style={{ background: sevColor(f.severity) }} />
          <span className="pt-text">{f.text}</span>
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
  )
}

const PRIORITY: Record<Severity, Task['priority']> = { blocker: 'Urgent', major: 'High', minor: 'Normal', idea: 'Low' }

/** Puts a finding on the Task board's first column and returns the new task's id. */
async function makeTask(f: Finding, tester: string): Promise<string | null> {
  const root = useProjectStore.getState().root
  if (!root) return null
  const d = await loadDocumentNow<TasksDoc>(root, 'tasks', 'tasks', createTasksDoc)
  const t = { ...newTask((d.columns?.[0] ?? { id: 'todo' }).id), title: f.text.trim(), notes: `From a playtest${tester ? ` by ${tester}` : ''}${f.area ? `, where: ${f.area}` : ''}.`, priority: PRIORITY[f.severity] }
  updateDocument<TasksDoc>(root, 'tasks', 'tasks', (x) => ({ ...x, items: [...x.items, t] }))
  return t.id
}
