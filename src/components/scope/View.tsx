import { ArrowUpToLine, Plus, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { newId, type Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useUndoRedoKeys } from '@/core/state'
import { NumberInput } from '@/shared/calculators'
import { confirmDialog } from '@/shared/dialogs'
import { Kanban, moveCard } from '@/shared/kanban'
import '@/shared/listDetail/listDetail.css'
import { ProofTextarea } from '@/shared/spell'
import {
  COLUMNS,
  DISCIPLINES,
  MARKS,
  STATUSES,
  addToVersion,
  createScopeDoc,
  deleteFeature,
  feedBack,
  newFeature,
  newVersion,
  notInVersion,
  resolveItems,
  versionDays,
  versionsOf,
  type Feature,
  type Mark,
  type Priority,
  type ScopeDoc,
  type Version,
} from './model'
import './scope.css'

/** Feature & scope planner (v0.10): every feature sorted into must, should, could, won't and cut, with effort.
 *  0.35: versions (0.1, 1.0, 1.1 …) take features from the full release plan, plus their own; each is planned, added or cut. */

type Pillar = { id: Id; title: string; color: string }

export default function View({ active }: PanelProps) {
  const doc = useDocument<ScopeDoc>('scope', 'scope', createScopeDoc)
  useUndoRedoKeys(doc, active)
  const pillars = useDocument<{ pillars: Pillar[] }>('vision', 'vision', () => ({ pillars: [] })).data?.pillars ?? []
  const [openId, setOpenId] = useState<string | null>(null)
  const [versionId, setVersionId] = useState<Id | null>(null)
  if (!doc.data) return null
  const d = doc.data
  const set = (fn: (d: ScopeDoc) => ScopeDoc) => doc.update(fn)
  const versions = d.versions ?? []
  const version = versions.find((v) => v.id === versionId)
  const setVersion = (fn: (v: Version) => Version) => set((x) => ({ ...x, versions: (x.versions ?? []).map((v) => (v.id === version?.id ? fn(v) : v)) }))
  const pillar = (id: Id | null) => pillars.find((p) => p.id === id)
  const pillarChip = (x: Feature) =>
    pillar(x.pillarId) && (
      <span className="kb-chip" style={{ color: pillar(x.pillarId)!.color }}>
        {pillar(x.pillarId)!.title}
      </span>
    )

  const picker = (
    <span className="ld-inline">
      <select
        className="input"
        value={version?.id ?? ''}
        aria-label="Plan or version"
        onChange={(e) => {
          setVersionId(e.target.value || null)
          setOpenId(null)
        }}
      >
        <option value="">Full release plan</option>
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            Version {v.name}
          </option>
        ))}
      </select>
      <button
        className="btn"
        title="Make a version (a release or an update) and pick its features from the full plan"
        onClick={() => {
          const v = newVersion(versions)
          set((x) => ({ ...x, versions: [...(x.versions ?? []), v] }))
          setVersionId(v.id)
          setOpenId(null)
        }}
      >
        <Plus size={14} /> New version
      </button>
    </span>
  )

  if (version) {
    const rows = resolveItems(d, version)
    const days = versionDays(d, version)
    const open = rows.find((r) => r.item.id === openId)
    const missing = notInVersion(d, version)
    const editOpen = (patch: Partial<Feature>) => {
      if (!open) return
      if (open.custom) setVersion((v) => ({ ...v, items: v.items.map((i) => (i.id === open.item.id ? { ...i, feature: { ...i.feature!, ...patch } } : i)) }))
      else set((x) => ({ ...x, items: x.items.map((f) => (f.id === open.feature.id ? { ...f, ...patch } : f)) }))
    }
    return (
      <div className="sc">
        <div className="ld-toolbar">
          {picker}
          <span className="ld-inline">
            Name
            <input className="input sc-vname" value={version.name} onChange={(e) => setVersion((v) => ({ ...v, name: e.target.value }))} aria-label="Version name" />
          </span>
          <span className="ld-inline">
            Days
            <NumberInput value={version.capacity} min={0} onChange={(capacity) => setVersion((v) => ({ ...v, capacity }))} />
          </span>
          <span className={days.inScope > version.capacity ? 'sc-over' : 'muted'}>
            Planned + added: {days.inScope} of {version.capacity} days{days.inScope > version.capacity ? ` — ${days.inScope - version.capacity} days too many, cut something` : ''}
          </span>
          {days.added > 0 && <span className="muted">Added later: {days.added} days</span>}
          {days.cut > 0 && <span className="muted">Cut: {days.cut} days</span>}
          <select
            className="input sc-add"
            value=""
            aria-label="Add from the full plan"
            onChange={(e) => {
              const ref = e.target.value
              if (!ref) return
              set((x) => addToVersion(x, version.id, { id: newId(), mark: 'planned', ref }))
            }}
          >
            <option value="">{missing.length ? 'Add from the full plan…' : 'Everything from the full plan is in'}</option>
            {COLUMNS.map((c) => {
              const list = missing.filter((f) => f.priority === c.id)
              return (
                list.length > 0 && (
                  <optgroup key={c.id} label={c.title}>
                    {list.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.title} ({f.effort}d)
                      </option>
                    ))}
                  </optgroup>
                )
              )
            })}
          </select>
          <button
            className="icon-btn"
            title="Delete this version (the full plan keeps its features)"
            aria-label="Delete version"
            onClick={async () => {
              if (!(await confirmDialog({ title: `Delete version ${version.name}?`, message: 'Its own features go too. The full release plan keeps all of its features.', danger: true }))) return
              set((x) => ({ ...x, versions: (x.versions ?? []).filter((v) => v.id !== version.id) }))
              setVersionId(null)
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="sc-body">
          <Kanban
            columns={MARKS.map((c) => ({ ...c, extra: `${rows.filter((r) => r.item.mark === c.id).length} · ${rows.filter((r) => r.item.mark === c.id).reduce((s, r) => s + r.feature.effort, 0)}d` }))}
            cards={rows.map((r) => ({ ...r, id: r.item.id }))}
            columnOf={(r) => r.item.mark}
            selectedId={openId}
            onOpen={setOpenId}
            onAdd={(col) => {
              const item = { id: newId(), mark: col as Mark, feature: { ...newFeature('should'), title: 'New feature (this version only)' } }
              set((x) => addToVersion(x, version.id, item))
              setOpenId(item.id)
            }}
            onMove={(id, col, before) => setVersion((v) => ({ ...v, items: moveCard(v.items, id, before, (c) => ({ ...c, mark: col as Mark })) }))}
            renderCard={(r) => (
              <>
                <div className="kb-card-title">{r.feature.title}</div>
                <div className="kb-card-meta">
                  <span className="kb-chip">{r.feature.effort}d</span>
                  <span className="kb-chip">{r.feature.status}</span>
                  <span className="kb-chip" title={r.custom ? 'Not in the full release plan' : 'From the full release plan'}>
                    {r.custom ? 'Only this version' : COLUMNS.find((c) => c.id === r.feature.priority)?.title}
                  </span>
                  {pillarChip(r.feature)}
                </div>
              </>
            )}
          />
          {!open && (
            <aside className="sc-side">
              <label className="ld-field">
                <span>What this version or update is about (notes, patch notes)</span>
                <ProofTextarea className="input" rows={10} value={version.notes} onChange={(e) => setVersion((v) => ({ ...v, notes: e.target.value }))} />
              </label>
              <span className="muted">Add features from the full plan with the list above, or make ones only this version has with +. Drag a card to Added when it came in after planning, or to Cut when it was dropped.</span>
            </aside>
          )}
          {open && (
            <FeatureForm
              f={open.feature}
              pillars={pillars}
              onEdit={editOpen}
              onClose={() => setOpenId(null)}
              top={
                <>
                  <label className="ld-field">
                    <span>In this version</span>
                    <select className="input" value={open.item.mark} onChange={(e) => setVersion((v) => ({ ...v, items: v.items.map((i) => (i.id === open.item.id ? { ...i, mark: e.target.value as Mark } : i)) }))}>
                      {MARKS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {open.custom ? (
                    <button className="btn" title="Put it into the full release plan too; edits then show in both" onClick={() => set((x) => feedBack(x, version.id, open.item.id))}>
                      <ArrowUpToLine size={14} /> Add to the full release plan
                    </button>
                  ) : (
                    <span className="muted">From the full release plan: changes here change it there too.</span>
                  )}
                </>
              }
              priority={!open.custom}
              deleteLabel={open.custom ? 'Delete feature' : 'Take out of this version'}
              onDelete={() => {
                setVersion((v) => ({ ...v, items: v.items.filter((i) => i.id !== open.item.id) }))
                setOpenId(null)
              }}
            />
          )}
        </div>
      </div>
    )
  }

  const edit = (id: Id, patch: Partial<Feature>) => set((x) => ({ ...x, items: x.items.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
  const sum = (p: Priority[]) => d.items.filter((f) => p.includes(f.priority)).reduce((s, f) => s + f.effort, 0)
  const planned = sum(['must', 'should'])
  const byDiscipline = DISCIPLINES.map((k) => [k, d.items.filter((x) => x.priority === 'must' || x.priority === 'should').reduce((a, x) => a + (x.split?.[k] ?? 0), 0)] as const).filter(([, n]) => n > 0)
  const f = d.items.find((x) => x.id === openId)
  const versionName = (id: Id) => versions.find((v) => v.id === id)?.name

  return (
    <div className="sc">
      <div className="ld-toolbar">
        {picker}
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
                {pillarChip(x)}
                {x.addedIn && versionName(x.addedIn) && <span className="kb-chip sc-added">Added in {versionName(x.addedIn)}</span>}
                {versionsOf(d, x.id).map((v) => (
                  <span key={v.id} className="kb-chip sc-ver">
                    {v.name}
                  </span>
                ))}
              </div>
            </>
          )}
        />
        {f && (
          <FeatureForm
            f={f}
            pillars={pillars}
            onEdit={(patch) => edit(f.id, patch)}
            onClose={() => setOpenId(null)}
            priority
            deleteLabel="Delete feature"
            onDelete={() => {
              set((x) => deleteFeature(x, f.id))
              setOpenId(null)
            }}
          />
        )}
      </div>
    </div>
  )
}

function FeatureForm({
  f,
  pillars,
  onEdit,
  onClose,
  onDelete,
  deleteLabel,
  priority,
  top,
}: {
  f: Feature
  pillars: Pillar[]
  onEdit(patch: Partial<Feature>): void
  onClose(): void
  onDelete(): void
  deleteLabel: string
  /** Show the full-plan priority (not for version-only features). */
  priority?: boolean
  top?: ReactNode
}) {
  return (
    <aside className="sc-side">
      <div className="ld-inline">
        <input className="input" style={{ flex: 1, fontWeight: 600 }} value={f.title} onChange={(e) => onEdit({ title: e.target.value })} aria-label="Feature name" />
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {top}
      {priority && (
        <label className="ld-field">
          <span>Priority in the full plan</span>
          <select className="input" value={f.priority} onChange={(e) => onEdit({ priority: e.target.value as Priority })}>
            {COLUMNS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="ld-field">
        <span>Effort (days)</span>
        <NumberInput value={f.effort} min={0} onChange={(effort) => onEdit({ effort, split: undefined })} />
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
                  onEdit(total ? { split, effort: total } : { split: undefined })
                }}
              />
            </label>
          ))}
        </div>
      </div>
      <label className="ld-field">
        <span>Status</span>
        <select className="input" value={f.status} onChange={(e) => onEdit({ status: e.target.value as Feature['status'] })}>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="ld-field">
        <span>Serves pillar</span>
        <select className="input" value={f.pillarId ?? ''} onChange={(e) => onEdit({ pillarId: e.target.value || null })}>
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
        <ProofTextarea className="input" rows={5} value={f.description} onChange={(e) => onEdit({ description: e.target.value })} />
      </label>
      <button className="btn btn-danger ld-danger" onClick={onDelete}>
        <Trash2 size={14} /> {deleteLabel}
      </button>
    </aside>
  )
}
