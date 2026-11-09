import { ArrowUp, Download, Flag, ImagePlus, Link2, Lock, Plus, Settings2, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { newId, type ComponentType, type Id } from '@/core/model'
import { getManifest, type PanelProps } from '@/core/registry'
import { pickAndImportAssets, useAssetUrl } from '@/core/assets'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { Modal } from '@/shared/ui'
import { Kanban, moveCard } from '@/shared/kanban'
import '@/shared/listDetail/listDetail.css'
import { combineRefProviders, rankRefItems, useEntityRefProvider, type RefItem } from '@/shared/richtext'
import { ProofTextarea } from '@/shared/spell'
import { useArticleRefProvider } from '@/shared/wiki'
import { openDocument } from '@/shared/entityList'
import { saveTextFile } from '@/core/export'
import { COLUMNS, PRIORITIES, createTasksDoc, milestoneProgress, newTask, openBlockers, tasksCSV, type Task, type TaskLink, type TasksDoc } from './model'
import './tasks.css'

/** Task board (v0.10): to-dos linked to the items, characters, articles and documents they are about. */

const CATEGORY_COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#9c36b5', '#e03131', '#0c8599', '#f08c00', '#c2255c']
const CATEGORY_NAMES = ['Art', 'Code', 'Sound', 'Writing', 'Design']

function CardImage({ path }: { path: string }) {
  const url = useAssetUrl(path)
  return url ? <img className="tk-img" src={url} alt="" /> : null
}

export default function View({ active }: PanelProps) {
  const doc = useDocument<TasksDoc>('tasks', 'tasks', createTasksDoc)
  useUndoRedoKeys(doc, active)
  const entityRefs = useEntityRefProvider()
  const articleRefs = useArticleRefProvider()
  const refs = useMemo(() => combineRefProviders(entityRefs, articleRefs), [entityRefs, articleRefs])
  const documents = useProjectStore((s) => s.meta?.documents ?? [])
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const [category, setCategory] = useState('')
  const [manage, setManage] = useState(false)
  const root = useProjectStore((s) => s.root)
  if (!doc.data) return null
  const d = doc.data
  const set = (fn: (d: TasksDoc) => TasksDoc) => doc.update(fn)
  const edit = (id: Id, patch: Partial<Task>) => set((x) => ({ ...x, items: x.items.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  const t = d.items.find((x) => x.id === openId)
  const columns = d.columns?.length ? d.columns : COLUMNS
  const categories = d.categories ?? []
  const catOf = (id: Id) => categories.find((c) => c.id === id)
  const lastColumn = columns[columns.length - 1]
  const milestones = d.milestones ?? []
  const people = [...new Set(d.items.map((x) => x.assignee.trim()).filter(Boolean))]

  const docItems: RefItem[] = documents.map((doc) => ({ kind: `doc:${doc.type}`, id: doc.id, label: doc.title, hint: getManifest(doc.type)?.name }))
  const label = (l: TaskLink): RefItem | undefined => (l.kind.startsWith('doc:') ? docItems.find((x) => x.id === l.id) : refs.resolve(l))
  const open = (l: TaskLink) => (l.kind.startsWith('doc:') ? openDocument(l.kind.slice(4) as ComponentType, l.id) : refs.open?.(l))
  const suggestions = query.trim() ? rankRefItems([...refs.search(query), ...docItems], query, 8) : []
  const shown = d.items
    .filter((x) => !filter || x.assignee.toLowerCase().includes(filter.toLowerCase()) || x.title.toLowerCase().includes(filter.toLowerCase()))
    .filter((x) => !category || (x.categoryIds ?? []).includes(category))
    // Tasks of a removed column show up in the first one.
    .map((x) => (columns.some((c) => c.id === x.column) ? x : { ...x, column: columns[0].id }))

  return (
    <div className="tk">
      <div className="ld-toolbar">
        <input className="input" style={{ width: 220 }} placeholder="Filter by title or person" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {categories.length > 0 && (
          <select className="input" style={{ width: 'auto' }} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-ghost" onClick={() => setManage(true)}>
          <Settings2 size={14} /> Columns, categories and milestones
        </button>
        <button className="btn btn-ghost" title="A CSV file Jira and Linear can import" onClick={() => saveTextFile({ title: 'Export tasks for Jira or Linear', defaultName: 'tasks.csv', text: tasksCSV(d), filter: { name: 'CSV', extensions: ['csv'] } })}>
          <Download size={14} /> CSV for Jira/Linear
        </button>
        <span className="muted">
          {d.items.filter((x) => x.column !== lastColumn.id).length} open, {d.items.filter((x) => x.column === lastColumn.id).length} in {lastColumn.title}
        </span>
        {milestoneProgress(d).map((p) => (
          <span key={p.milestone.id} className={`kb-chip${p.late ? ' tk-p-urgent' : ''}`} title={p.late ? 'Past its date with open tasks' : undefined}>
            <Flag size={10} /> {p.milestone.name}: {p.done}/{p.total} done{p.hoursLeft ? `, ${p.hoursLeft}h left` : ''}
            {p.milestone.date && ` (${p.milestone.date})`}
          </span>
        ))}
      </div>
      <div className="tk-body">
        <Kanban
          columns={columns}
          cards={shown}
          columnOf={(x) => x.column}
          selectedId={openId}
          onOpen={setOpenId}
          onAdd={(col) => {
            const n = newTask(col)
            set((x) => ({ ...x, items: [...x.items, n] }))
            setOpenId(n.id)
          }}
          onMove={(id, col, before) => set((x) => ({ ...x, items: moveCard(x.items, id, before, (c) => ({ ...c, column: col })) }))}
          renderCard={(x) => (
            <>
              {x.image && <CardImage path={x.image} />}
              <div className="kb-card-title">{x.title}</div>
              <div className="kb-card-meta">
                {(x.categoryIds ?? []).map((id) =>
                  catOf(id) ? (
                    <span key={id} className="kb-chip tk-cat" style={{ background: catOf(id)!.color }}>
                      {catOf(id)!.name}
                    </span>
                  ) : null,
                )}
                {openBlockers(d, x).length > 0 && (
                  <span className="kb-chip tk-p-high" title={`Waiting for ${openBlockers(d, x).map((b) => b.title).join(', ')}`}>
                    <Lock size={10} /> Blocked
                  </span>
                )}
                {x.priority !== 'Normal' && <span className={`kb-chip tk-p-${x.priority.toLowerCase()}`}>{x.priority}</span>}
                {x.assignee && <span className="kb-chip">{x.assignee}</span>}
                {x.due && <span className="kb-chip">{x.due}</span>}
                {x.estimate ? <span className="kb-chip">{x.estimate}h</span> : null}
                {x.milestone && milestones.find((m) => m.id === x.milestone) && (
                  <span className="kb-chip">
                    <Flag size={10} /> {milestones.find((m) => m.id === x.milestone)!.name}
                  </span>
                )}
                {x.links.slice(0, 3).map((l) => (
                  <span key={l.id} className="kb-chip tk-link">
                    <Link2 size={10} /> {label(l)?.label ?? 'missing'}
                  </span>
                ))}
              </div>
            </>
          )}
        />
        {t && (
          <aside className="tk-side">
            <div className="ld-inline">
              <input className="input" style={{ flex: 1, fontWeight: 600 }} value={t.title} onChange={(e) => edit(t.id, { title: e.target.value })} aria-label="Task" />
              <button className="icon-btn" aria-label="Close" onClick={() => setOpenId(null)}>
                <X size={14} />
              </button>
            </div>
            {t.image && <CardImage path={t.image} />}
            {root && (
              <div className="ld-inline">
                <button
                  className="btn"
                  onClick={async () => {
                    const [a] = await pickAndImportAssets(root, 'image', 'Picture for the task')
                    if (a) edit(t.id, { image: a.path })
                  }}
                >
                  <ImagePlus size={14} /> {t.image ? 'Change picture' : 'Add picture'}
                </button>
                {t.image && (
                  <button className="btn btn-ghost" onClick={() => edit(t.id, { image: null })}>
                    Remove picture
                  </button>
                )}
              </div>
            )}
            <div className="ld-field">
              <span>Categories</span>
              <div className="ld-inline">
                {categories.map((c) => {
                  const on = (t.categoryIds ?? []).includes(c.id)
                  return (
                    <button
                      key={c.id}
                      className={`tk-catpick${on ? ' on' : ''}`}
                      style={{ borderColor: c.color, background: on ? c.color : 'transparent' }}
                      onClick={() => edit(t.id, { categoryIds: on ? (t.categoryIds ?? []).filter((x) => x !== c.id) : [...(t.categoryIds ?? []), c.id] })}
                    >
                      {c.name}
                    </button>
                  )
                })}
                <button className="btn btn-ghost" onClick={() => setManage(true)}>
                  {categories.length ? 'Edit categories' : 'Make categories'}
                </button>
              </div>
            </div>
            <label className="ld-field">
              <span>Who</span>
              <input className="input" list="tk-people" value={t.assignee} onChange={(e) => edit(t.id, { assignee: e.target.value })} />
              <datalist id="tk-people">
                {people.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </label>
            <label className="ld-field">
              <span>Estimate (hours)</span>
              <input className="input" type="number" min={0} step={0.5} value={t.estimate ?? ''} onChange={(e) => edit(t.id, { estimate: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })} />
            </label>
            <label className="ld-field">
              <span>Milestone</span>
              <select className="input" value={t.milestone ?? ''} onChange={(e) => edit(t.id, { milestone: e.target.value || null })}>
                <option value="">None</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="ld-field">
              <span>Waits for</span>
              {(t.blockedBy ?? []).map((id) => (
                <div key={id} className="ld-inline">
                  <button className="btn btn-ghost" onClick={() => setOpenId(id)}>
                    <Lock size={12} /> {d.items.find((o) => o.id === id)?.title ?? 'deleted task'}
                    {d.items.find((o) => o.id === id)?.column === lastColumn.id && <span className="muted"> (done)</span>}
                  </button>
                  <button className="icon-btn" aria-label="Remove" onClick={() => edit(t.id, { blockedBy: (t.blockedBy ?? []).filter((k) => k !== id) })}>
                    <X size={12} />
                  </button>
                </div>
              ))}
              <select className="input" value="" onChange={(e) => e.target.value && edit(t.id, { blockedBy: [...(t.blockedBy ?? []), e.target.value] })}>
                <option value="">Add a task this one waits for…</option>
                {d.items
                  .filter((o) => o.id !== t.id && !(t.blockedBy ?? []).includes(o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                    </option>
                  ))}
              </select>
            </div>
            <label className="ld-field">
              <span>Due</span>
              <input className="input" type="date" value={t.due} onChange={(e) => edit(t.id, { due: e.target.value })} />
            </label>
            <label className="ld-field">
              <span>Priority</span>
              <select className="input" value={t.priority} onChange={(e) => edit(t.id, { priority: e.target.value as Task['priority'] })}>
                {PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="ld-field">
              <span>Notes</span>
              <ProofTextarea className="input" rows={4} value={t.notes} onChange={(e) => edit(t.id, { notes: e.target.value })} />
            </label>
            <div className="ld-section">
              <strong>Linked to</strong>
              {t.links.map((l) => (
                <div key={l.id} className="ld-inline">
                  <button className="btn btn-ghost" onClick={() => open(l)}>
                    <Link2 size={12} /> {label(l)?.label ?? 'missing'} <span className="muted">{label(l)?.hint}</span>
                  </button>
                  <button className="icon-btn" aria-label="Remove link" onClick={() => edit(t.id, { links: t.links.filter((o) => o.id !== l.id) })}>
                    <X size={12} />
                  </button>
                </div>
              ))}
              <input className="input" placeholder="Link an item, character, article or document…" value={query} onChange={(e) => setQuery(e.target.value)} />
              {suggestions.map((s) => (
                <button
                  key={`${s.kind}:${s.id}`}
                  className="tk-suggest"
                  onClick={() => {
                    if (!t.links.some((l) => l.id === s.id)) edit(t.id, { links: [...t.links, { kind: s.kind, id: s.id }] })
                    setQuery('')
                  }}
                >
                  {s.label} <span className="muted">{s.hint}</span>
                </button>
              ))}
            </div>
            <button
              className="btn btn-danger ld-danger"
              onClick={() => {
                set((x) => ({ ...x, items: x.items.filter((o) => o.id !== t.id).map((o) => (o.blockedBy?.includes(t.id) ? { ...o, blockedBy: o.blockedBy.filter((k) => k !== t.id) } : o)) }))
                setOpenId(null)
              }}
            >
              <Trash2 size={14} /> Delete task
            </button>
          </aside>
        )}
      </div>
      {manage && (
        <Modal onClose={() => setManage(false)}>
          <div className="tk-manage">
            <h3>Columns</h3>
            {columns.map((c, i) => (
              <div key={c.id} className="ld-inline">
                <input type="color" value={c.color} onChange={(e) => set((x) => ({ ...x, columns: columns.map((o) => (o.id === c.id ? { ...o, color: e.target.value } : o)) }))} />
                <input className="input" value={c.title} onChange={(e) => set((x) => ({ ...x, columns: columns.map((o) => (o.id === c.id ? { ...o, title: e.target.value } : o)) }))} />
                <button
                  className="icon-btn"
                  title="Move earlier"
                  aria-label="Move earlier"
                  disabled={i === 0}
                  onClick={() =>
                    set((x) => {
                      const next = [...columns]
                      ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                      return { ...x, columns: next }
                    })
                  }
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  className="icon-btn"
                  aria-label="Remove column"
                  disabled={columns.length < 2}
                  onClick={() =>
                    set((x) => {
                      const rest = columns.filter((o) => o.id !== c.id)
                      return { ...x, columns: rest, items: x.items.map((it) => (it.column === c.id ? { ...it, column: rest[0].id } : it)) }
                    })
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <button className="btn btn-ghost" onClick={() => set((x) => ({ ...x, columns: [...columns, { id: newId(), title: 'New column', color: '#9aa0a6' }] }))}>
              <Plus size={14} /> Add column
            </button>
            <h3>Categories</h3>
            <p className="muted">Sort tasks by area of work, like Art, Code, Sound or Writing. A task can have several.</p>
            {categories.map((c) => (
              <div key={c.id} className="ld-inline">
                <input type="color" value={c.color} onChange={(e) => set((x) => ({ ...x, categories: categories.map((o) => (o.id === c.id ? { ...o, color: e.target.value } : o)) }))} />
                <input className="input" value={c.name} onChange={(e) => set((x) => ({ ...x, categories: categories.map((o) => (o.id === c.id ? { ...o, name: e.target.value } : o)) }))} />
                <button
                  className="icon-btn"
                  aria-label="Remove category"
                  onClick={() =>
                    set((x) => ({ ...x, categories: categories.filter((o) => o.id !== c.id), items: x.items.map((it) => ({ ...it, categoryIds: (it.categoryIds ?? []).filter((k) => k !== c.id) })) }))
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <button
              className="btn btn-ghost"
              onClick={() =>
                set((x) => ({ ...x, categories: [...categories, { id: newId(), name: CATEGORY_NAMES[categories.length] ?? 'Category', color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length] }] }))
              }
            >
              <Plus size={14} /> Add category
            </button>
            <h3>Milestones</h3>
            <p className="muted">Like Vertical slice, Alpha, Beta or Launch. The toolbar shows how many of their tasks are done and the hours left.</p>
            {milestones.map((m) => (
              <div key={m.id} className="ld-inline">
                <input className="input" value={m.name} onChange={(e) => set((x) => ({ ...x, milestones: milestones.map((o) => (o.id === m.id ? { ...o, name: e.target.value } : o)) }))} />
                <input className="input" type="date" style={{ width: 'auto' }} value={m.date} onChange={(e) => set((x) => ({ ...x, milestones: milestones.map((o) => (o.id === m.id ? { ...o, date: e.target.value } : o)) }))} />
                <button
                  className="icon-btn"
                  aria-label="Remove milestone"
                  onClick={() => set((x) => ({ ...x, milestones: milestones.filter((o) => o.id !== m.id), items: x.items.map((it) => (it.milestone === m.id ? { ...it, milestone: null } : it)) }))}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <button className="btn btn-ghost" onClick={() => set((x) => ({ ...x, milestones: [...milestones, { id: newId(), name: ['Vertical slice', 'Alpha', 'Beta', 'Launch'][milestones.length] ?? 'Milestone', date: '' }] }))}>
              <Plus size={14} /> Add milestone
            </button>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setManage(false)}>
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
