import { Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { newId, type Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useUndoRedoKeys } from '@/core/state'
import { NumberInput } from '@/shared/calculators'
import { Kanban, moveCard } from '@/shared/kanban'
import '@/shared/listDetail/listDetail.css'
import { ProofTextarea } from '@/shared/spell'
import './scope.css'

/** Feature & scope planner (v0.10): every feature sorted into must, should, could, won't and cut, with effort. */

const COLUMNS = [
  { id: 'must', title: 'Must have', color: '#e03131' },
  { id: 'should', title: 'Should have', color: '#f08c00' },
  { id: 'could', title: 'Could have', color: '#3e8ef7' },
  { id: 'wont', title: 'Won’t have (now)', color: '#9aa0a6' },
  { id: 'cut', title: 'Cut', color: '#495057' },
] as const
type Priority = (typeof COLUMNS)[number]['id']
const STATUSES = ['Idea', 'Planned', 'In progress', 'Done'] as const

interface Feature {
  id: Id
  title: string
  description: string
  priority: Priority
  /** Days of work. */
  effort: number
  status: (typeof STATUSES)[number]
  /** Vision pillar it serves. */
  pillarId: Id | null
  /** 0.28: days per discipline; when set, effort is their sum. */
  split?: Partial<Record<Discipline, number>>
}

const DISCIPLINES = ['Design', 'Code', 'Art', 'Sound', 'Writing', 'QA'] as const
type Discipline = (typeof DISCIPLINES)[number]

interface ScopeDoc {
  items: Feature[]
  /** Days available until release. */
  capacity: number
}

const createScopeDoc = (): ScopeDoc => ({ items: [], capacity: 120 })
const newFeature = (priority: Priority): Feature => ({ id: newId(), title: 'New feature', description: '', priority, effort: 3, status: 'Idea', pillarId: null })

export default function View({ active }: PanelProps) {
  const doc = useDocument<ScopeDoc>('scope', 'scope', createScopeDoc)
  useUndoRedoKeys(doc, active)
  const pillars = useDocument<{ pillars: { id: Id; title: string; color: string }[] }>('vision', 'vision', () => ({ pillars: [] })).data?.pillars ?? []
  const [openId, setOpenId] = useState<string | null>(null)
  if (!doc.data) return null
  const d = doc.data
  const set = (fn: (d: ScopeDoc) => ScopeDoc) => doc.update(fn)
  const edit = (id: Id, patch: Partial<Feature>) => set((x) => ({ ...x, items: x.items.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
  const sum = (p: Priority[]) => d.items.filter((f) => p.includes(f.priority)).reduce((s, f) => s + f.effort, 0)
  const planned = sum(['must', 'should'])
  const byDiscipline = DISCIPLINES.map((k) => [k, d.items.filter((x) => x.priority === 'must' || x.priority === 'should').reduce((a, x) => a + (x.split?.[k] ?? 0), 0)] as const).filter(([, n]) => n > 0)
  const f = d.items.find((x) => x.id === openId)
  const pillar = (id: Id | null) => pillars.find((p) => p.id === id)

  return (
    <div className="sc">
      <div className="ld-toolbar">
        <span className="ld-inline">
          Days until release
          <NumberInput value={d.capacity} min={0} onChange={(capacity) => set((x) => ({ ...x, capacity }))} />
        </span>
        <span className={planned > d.capacity ? 'sc-over' : 'muted'}>
          Must + should: {planned} of {d.capacity} days{planned > d.capacity ? ` — ${planned - d.capacity} days too many, move something to could or cut` : ''}
        </span>
        <span className="muted">Could have: {sum(['could'])} days</span>
        {byDiscipline.length > 0 && <span className="muted">Must + should by discipline: {byDiscipline.map(([k, n]) => `${k} ${n}d`).join(', ')}</span>}
      </div>
      <div className="sc-body">
        <Kanban
          columns={COLUMNS.map((c) => ({ ...c, extra: `${d.items.filter((x) => x.priority === c.id).length} · ${sum([c.id])}d` }))}
          cards={d.items}
          columnOf={(x) => x.priority}
          selectedId={openId}
          onOpen={setOpenId}
          onAdd={(col) => {
            const n = newFeature(col as Priority)
            set((x) => ({ ...x, items: [...x.items, n] }))
            setOpenId(n.id)
          }}
          onMove={(id, col, before) => set((x) => ({ ...x, items: moveCard(x.items, id, before, (c) => ({ ...c, priority: col as Priority })) }))}
          renderCard={(x) => (
            <>
              <div className="kb-card-title">{x.title}</div>
              <div className="kb-card-meta">
                <span className="kb-chip">{x.effort}d</span>
                <span className="kb-chip">{x.status}</span>
                {pillar(x.pillarId) && (
                  <span className="kb-chip" style={{ color: pillar(x.pillarId)!.color }}>
                    {pillar(x.pillarId)!.title}
                  </span>
                )}
              </div>
            </>
          )}
        />
        {f && (
          <aside className="sc-side">
            <div className="ld-inline">
              <input className="input" style={{ flex: 1, fontWeight: 600 }} value={f.title} onChange={(e) => edit(f.id, { title: e.target.value })} aria-label="Feature name" />
              <button className="icon-btn" aria-label="Close" onClick={() => setOpenId(null)}>
                <X size={14} />
              </button>
            </div>
            <label className="ld-field">
              <span>Priority</span>
              <select className="input" value={f.priority} onChange={(e) => edit(f.id, { priority: e.target.value as Priority })}>
                {COLUMNS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="ld-field">
              <span>Effort (days)</span>
              <NumberInput value={f.effort} min={0} onChange={(effort) => edit(f.id, { effort, split: undefined })} />
            </label>
            <div className="ld-field">
              <span>Days per discipline (optional; sets the effort, typing an effort clears them)</span>
              <div className="ld-inline" style={{ flexWrap: 'wrap' }}>
                {DISCIPLINES.map((k) => (
                  <label key={k} className="ld-inline">
                    {k}
                    <NumberInput
                      value={f.split?.[k] ?? 0}
                      min={0}
                      onChange={(n) => {
                        const split = { ...f.split, [k]: n }
                        const total = Object.values(split).reduce((a, b) => a + (b ?? 0), 0)
                        edit(f.id, total ? { split, effort: total } : { split: undefined })
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
            <label className="ld-field">
              <span>Status</span>
              <select className="input" value={f.status} onChange={(e) => edit(f.id, { status: e.target.value as Feature['status'] })}>
                {STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="ld-field">
              <span>Serves pillar</span>
              <select className="input" value={f.pillarId ?? ''} onChange={(e) => edit(f.id, { pillarId: e.target.value || null })}>
                <option value="">{pillars.length ? 'None' : 'Write pillars in Vision & Pillars'}</option>
                {pillars
                  .filter((p) => p.title)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="ld-field">
              <span>Description</span>
              <ProofTextarea className="input" rows={5} value={f.description} onChange={(e) => edit(f.id, { description: e.target.value })} />
            </label>
            <button
              className="btn btn-danger ld-danger"
              onClick={() => {
                set((x) => ({ ...x, items: x.items.filter((o) => o.id !== f.id) }))
                setOpenId(null)
              }}
            >
              <Trash2 size={14} /> Delete feature
            </button>
          </aside>
        )}
      </div>
    </div>
  )
}
