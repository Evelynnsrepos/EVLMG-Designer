import { ArrowUpToLine, FileText, Lock, LockOpen, Map as MapIcon, Plus, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { saveTextFile, safeFileName } from '@/core/export'
import { newId, type Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useUndoRedoKeys } from '@/core/state'
import { NumberInput } from '@/shared/calculators'
import { choiceDialog, confirmDialog } from '@/shared/dialogs'
import { Kanban, moveCard } from '@/shared/kanban'
import '@/shared/listDetail/listDetail.css'
import { ProofTextarea } from '@/shared/spell'
import {
  COLUMNS,
  DISCIPLINES,
  MARKS,
  STATUSES,
  VERSION_STATES,
  addToVersion,
  createScopeDoc,
  deleteFeature,
  editVersion,
  feedBack,
  moveItem,
  newFeature,
  newItem,
  newVersion,
  notInVersion,
  patchNotes,
  putFeature,
  resolveItems,
  setMark,
  ship,
  unfinished,
  unplanned,
  versionDays,
  versionsOf,
  type Feature,
  type Mark,
  type Priority,
  type ScopeDoc,
  type Version,
  type VersionState,
} from './model'
import './scope.css'

/** Feature & scope planner (v0.10): every feature sorted into must, should, could, won't and cut, with effort.
 *  0.35: versions (0.1, 1.0, 1.1 …) take features from the full release plan, plus their own; each is planned,
 *  added or cut, with scope lock, shipping with carry-over, a roadmap of all versions and patch notes. */

type Pillar = { id: Id; title: string; color: string }
/** What the board shows: the full plan, the roadmap of all versions, or one version. */
type Mode = { kind: 'plan' } | { kind: 'roadmap' } | { kind: 'version'; id: Id }

const ROADMAP = '__roadmap'
const NONE = '__none'
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '')
const stateTitle = (s?: VersionState) => VERSION_STATES.find((x) => x.id === (s ?? 'planned'))!.title

export default function View({ active }: PanelProps) {
  const doc = useDocument<ScopeDoc>('scope', 'scope', createScopeDoc)
  useUndoRedoKeys(doc, active)
  const pillars = useDocument<{ pillars: Pillar[] }>('vision', 'vision', () => ({ pillars: [] })).data?.pillars ?? []
  const [openId, setOpenId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>({ kind: 'plan' })
  const [filter, setFilter] = useState('')
  if (!doc.data) return null
  const d = doc.data
  const set = (fn: (d: ScopeDoc) => ScopeDoc) => doc.update(fn)
  const versions = d.versions ?? []
  const version = mode.kind === 'version' ? versions.find((v) => v.id === mode.id) : undefined
  const go = (m: Mode, open: string | null = null) => {
    setMode(m)
    setOpenId(open)
  }
  const pillar = (id: Id | null) => pillars.find((p) => p.id === id)
  const pillarChip = (x: Feature) =>
    pillar(x.pillarId) && (
      <span className="kb-chip" style={{ color: pillar(x.pillarId)!.color }}>
        {pillar(x.pillarId)!.title}
      </span>
    )
  const exportNotes = (list: Version[], name: string) =>
    void saveTextFile({ title: 'Save patch notes', defaultName: `${safeFileName(name, 'patch notes')}.md`, text: `# ${name}\n\n${patchNotes(d, list)}`, filter: { name: 'Markdown', extensions: ['md'] } })
  const addVersion = () => {
    const v = newVersion(versions)
    set((x) => ({ ...x, versions: [...(x.versions ?? []), v] }))
    go({ kind: 'version', id: v.id })
  }

  const picker = (
    <span className="ld-inline">
      <select
        className="input"
        value={mode.kind === 'version' ? mode.id : mode.kind === 'roadmap' ? ROADMAP : ''}
        aria-label="Plan or version"
        onChange={(e) => go(e.target.value === ROADMAP ? { kind: 'roadmap' } : e.target.value ? { kind: 'version', id: e.target.value } : { kind: 'plan' })}
      >
        <option value="">Full release plan</option>
        <option value={ROADMAP}>Roadmap: all versions</option>
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            Version {v.name}
            {v.state === 'shipped' ? ' (shipped)' : ''}
          </option>
        ))}
      </select>
      <button className="btn" title="Make a version (a release or an update) and pick its features from the full plan" onClick={addVersion}>
        <Plus size={14} /> New version
      </button>
    </span>
  )

  // ---------- roadmap: every version side by side ----------
  if (mode.kind === 'roadmap') {
    type Card = { id: string; col: string; feature: Feature; versionId?: Id; mark?: Mark; custom?: boolean }
    const cards: Card[] = [
      ...unplanned(d).map((f) => ({ id: `u:${f.id}`, col: NONE, feature: f })),
      ...versions.flatMap((v) => resolveItems(d, v).filter((r) => r.item.mark !== 'cut').map((r) => ({ id: r.item.id, col: v.id, feature: r.feature, versionId: v.id, mark: r.item.mark, custom: r.custom }))),
    ]
    const shipped = (id: string) => versions.find((v) => v.id === id)?.state === 'shipped'
    return (
      <div className="sc">
        <div className="ld-toolbar">
          {picker}
          <span className="muted" title="A locked or shipped version keeps what leaves as cut, “Moved to …”.">Drag features between versions.</span>
          {versions.length > 0 && (
            <button className="btn" onClick={() => exportNotes(versions, 'Changelog')}>
              <FileText size={14} /> Changelog
            </button>
          )}
        </div>
        <div className="sc-body">
          <Kanban
            columns={[
              { id: NONE, title: 'Not in a version yet', color: '#9aa0a6', extra: `${unplanned(d).length} · ${unplanned(d).reduce((s, f) => s + f.effort, 0)}d` },
              ...versions.map((v) => {
                const days = versionDays(d, v)
                return { id: v.id, title: v.name, color: v.state === 'shipped' ? '#2f9e44' : v.state === 'active' ? '#f08c00' : '#3e8ef7', extra: `${stateTitle(v.state)}${v.target ? ` · ${v.target}` : ''} · ${days.inScope}/${v.capacity}d` }
              }),
            ]}
            cards={cards}
            columnOf={(c) => c.col}
            selectedId={null}
            onOpen={(id) => {
              const c = cards.find((x) => x.id === id)
              if (!c) return
              if (c.versionId) go({ kind: 'version', id: c.versionId }, c.id)
              else go({ kind: 'plan' }, c.feature.id)
            }}
            onAdd={(col) => {
              if (col === NONE) {
                const n = newFeature('should')
                set((x) => ({ ...x, items: [...x.items, n] }))
                go({ kind: 'plan' }, n.id)
              } else if (!shipped(col)) {
                const item = newItem(versions.find((x) => x.id === col)!, { feature: { ...newFeature('should'), title: 'New feature (this version only)' } })
                set((x) => addToVersion(x, col, item))
                go({ kind: 'version', id: col }, item.id)
              }
            }}
            onMove={(id, col, before) => {
              const c = cards.find((x) => x.id === id)
              if (!c || (col !== NONE && shipped(col) && c.col !== col)) return
              if (!c.versionId) {
                if (col !== NONE) set((x) => putFeature(x, col, { ref: c.feature.id }))
              } else if (c.col === col) {
                set((x) => editVersion(x, col, (v) => ({ ...v, items: moveCard(v.items, id, before, (i) => i) })))
              } else set((x) => moveItem(x, c.versionId!, id, col === NONE ? null : col))
            }}
            renderCard={(c) => (
              <>
                <div className="kb-card-title">{c.feature.title}</div>
                <div className="kb-card-meta">
                  <span className="kb-chip">{c.feature.effort}d</span>
                  <span className="kb-chip">{c.feature.status}</span>
                  {c.mark === 'added' && <span className="kb-chip sc-added">Added</span>}
                  {c.custom && <span className="kb-chip">Only this version</span>}
                </div>
              </>
            )}
          />
        </div>
      </div>
    )
  }

  // ---------- one version ----------
  if (version) {
    const rows = resolveItems(d, version)
    const days = versionDays(d, version)
    const open = rows.find((r) => r.item.id === openId)
    const isShipped = version.state === 'shipped'
    const inScope = rows.filter((r) => r.item.mark !== 'cut')
    const done = inScope.filter((r) => r.feature.status === 'Done').length
    const missing = notInVersion(d, version).filter((f) => f.title.toLowerCase().includes(filter.toLowerCase()))
    const setVersion = (fn: (v: Version) => Version) => set((x) => editVersion(x, version.id, fn))
    const editOpen = (patch: Partial<Feature>) => {
      if (!open) return
      if (open.custom) setVersion((v) => ({ ...v, items: v.items.map((i) => (i.id === open.item.id ? { ...i, feature: { ...i.feature!, ...patch } } : i)) }))
      else set((x) => ({ ...x, items: x.items.map((f) => (f.id === open.feature.id ? { ...f, ...patch } : f)) }))
    }
    const changeState = async (state: VersionState) => {
      if (state !== 'shipped') return setVersion((v) => ({ ...v, state, shippedAt: undefined }))
      const left = unfinished(d, version)
      const next = versions.slice(versions.indexOf(version) + 1).find((v) => v.state !== 'shipped')
      let carry: Id | null | 'new' = null
      if (left.length) {
        const pick = await choiceDialog({
          title: `Ship ${version.name}`,
          message: `${left.length} feature${left.length === 1 ? ' is' : 's are'} not done: ${left.map((r) => r.feature.title).join(', ')}. Move them on? They stay here as cut, “Moved to …”.`,
          choices: [next ? `Move them to ${next.name}` : 'Move them to a new version', 'Keep them in this version'],
        })
        if (pick === null) return
        if (pick === 0) carry = next?.id ?? 'new'
      }
      const nv = carry === 'new' ? newVersion(versions) : null
      set((x) => ship(nv ? { ...x, versions: [...(x.versions ?? []), nv] } : x, version.id, nv?.id ?? (carry as Id | null)))
    }
    return (
      <div className="sc">
        <div className="ld-toolbar">
          {picker}
          <button className="btn" title="Save these patch notes as a Markdown file" onClick={() => exportNotes([version], `Patch notes ${version.name}`)}>
            <FileText size={14} /> Patch notes
          </button>
          <button
            className="icon-btn"
            title="Delete this version (the full plan keeps its features)"
            aria-label="Delete version"
            onClick={async () => {
              if (!(await confirmDialog({ title: `Delete version ${version.name}?`, message: 'Its own features go too. The full release plan keeps all of its features. Ctrl+Z brings it back.', danger: true }))) return
              set((x) => ({ ...x, versions: (x.versions ?? []).filter((v) => v.id !== version.id) }))
              go({ kind: 'plan' })
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="ld-toolbar sc-vbar">
          <span className="ld-inline">
            Name
            <input className="input sc-vname" value={version.name} onChange={(e) => setVersion((v) => ({ ...v, name: e.target.value }))} aria-label="Version name" />
          </span>
          <select className="input sc-state" value={version.state ?? 'planned'} aria-label="Version state" onChange={(e) => void changeState(e.target.value as VersionState)}>
            {VERSION_STATES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <span className="ld-inline">
            Release
            <input className="input sc-date" type="date" value={version.target ?? ''} onChange={(e) => setVersion((v) => ({ ...v, target: e.target.value || undefined }))} aria-label="Planned release day" />
          </span>
          <span className="ld-inline">
            Days
            <NumberInput value={version.capacity} min={0} onChange={(capacity) => setVersion((v) => ({ ...v, capacity }))} />
          </span>
          {!isShipped && (
            <button
              className={`btn${version.lockedAt ? ' sc-locked' : ''}`}
              title={version.lockedAt ? 'Open the scope again: new features count as planned' : 'Lock the scope: anything put in from now on counts as Added'}
              onClick={() => setVersion((v) => ({ ...v, lockedAt: v.lockedAt ? undefined : new Date().toISOString() }))}
            >
              {version.lockedAt ? <Lock size={14} /> : <LockOpen size={14} />} {version.lockedAt ? `Scope locked ${fmt(version.lockedAt)}` : 'Lock scope'}
            </button>
          )}
        </div>
        <div className="ld-toolbar sc-sum">
          {isShipped && <span className="sc-shipped">Shipped {fmt(version.shippedAt)}</span>}
          <span className={days.inScope > version.capacity ? 'sc-over' : 'muted'}>
            Planned + added: {days.inScope} of {version.capacity} days{days.inScope > version.capacity ? ` — ${days.inScope - version.capacity} days too many, cut something` : ''}
          </span>
          <span className="muted">
            Done: {done} of {inScope.length}
          </span>
          {days.added > 0 && <span className="muted">Added later: {days.added} days</span>}
          {days.cut > 0 && <span className="muted">Cut: {days.cut} days</span>}
        </div>
        <div className="sc-body">
          <Kanban
            columns={MARKS.map((c) => ({ ...c, extra: `${rows.filter((r) => r.item.mark === c.id).length} · ${rows.filter((r) => r.item.mark === c.id).reduce((s, r) => s + r.feature.effort, 0)}d` }))}
            cards={rows.map((r) => ({ ...r, id: r.item.id }))}
            columnOf={(r) => r.item.mark}
            selectedId={openId}
            onOpen={setOpenId}
            onAdd={(col) => {
              const item = { id: newId(), mark: col as Mark, feature: { ...newFeature('should'), title: 'New feature (this version only)' }, log: [{ at: new Date().toISOString(), mark: col as Mark }] }
              setVersion((v) => ({ ...v, items: [...v.items, item] }))
              setOpenId(item.id)
            }}
            onMove={(id, col, before) => set((x) => editVersion(setMark(x, version.id, id, col as Mark), version.id, (v) => ({ ...v, items: moveCard(v.items, id, before, (i) => i) })))}
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
                {r.item.mark === 'cut' && r.item.reason && <div className="sc-reason">{r.item.reason}</div>}
              </>
            )}
          />
          {!open && (
            <aside className="sc-side">
              <label className="ld-field">
                <span>What this version or update is about (notes, patch notes intro)</span>
                <ProofTextarea className="input" rows={5} value={version.notes} onChange={(e) => setVersion((v) => ({ ...v, notes: e.target.value }))} />
              </label>
              <div className="ld-field">
                <span>From the full plan{version.lockedAt && !isShipped ? ' (scope is locked: these come in as Added)' : ''}</span>
                {isShipped ? (
                  <span className="muted">This version is shipped. Set it back to In progress to change it.</span>
                ) : (
                  <>
                    <input className="input" placeholder="Find a feature" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a feature in the full plan" />
                    <div className="sc-pick">
                      {COLUMNS.map((c) => {
                        const list = missing.filter((f) => f.priority === c.id)
                        return (
                          list.length > 0 && (
                            <div key={c.id}>
                              <div className="sc-pick-head" style={{ borderColor: c.color }}>
                                {c.title}
                              </div>
                              {list.map((f) => (
                                <button key={f.id} className="sc-pick-row" title="Put into this version" onClick={() => set((x) => putFeature(x, version.id, { ref: f.id }))}>
                                  <Plus size={12} /> <span>{f.title}</span> <span className="muted">{f.effort}d</span>
                                </button>
                              ))}
                            </div>
                          )
                        )
                      })}
                      {missing.length === 0 && <span className="muted">{filter ? 'Nothing found.' : 'Everything from the full plan is in this version.'}</span>}
                    </div>
                  </>
                )}
              </div>
              <span className="muted">+ on a column makes a feature only this version has. Drag a card to Added when it came in after planning, or to Cut when it was dropped.</span>
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
                    <select className="input" value={open.item.mark} onChange={(e) => set((x) => setMark(x, version.id, open.item.id, e.target.value as Mark))}>
                      {MARKS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {open.item.mark === 'cut' && (
                    <label className="ld-field">
                      <span>Why was it cut?</span>
                      <input className="input" value={open.item.reason ?? ''} onChange={(e) => setVersion((v) => ({ ...v, items: v.items.map((i) => (i.id === open.item.id ? { ...i, reason: e.target.value } : i)) }))} />
                    </label>
                  )}
                  {open.item.movedTo && versions.some((v) => v.id === open.item.movedTo) && (
                    <button className="btn" onClick={() => go({ kind: 'version', id: open.item.movedTo! })}>
                      Go to {versions.find((v) => v.id === open.item.movedTo)!.name}
                    </button>
                  )}
                  {open.custom ? (
                    <button className="btn" title="Put it into the full release plan too; edits then show in both" onClick={() => set((x) => feedBack(x, version.id, open.item.id))}>
                      <ArrowUpToLine size={14} /> Add to the full release plan
                    </button>
                  ) : (
                    <span className="muted">From the full release plan: changes here change it there too.</span>
                  )}
                </>
              }
              bottom={
                (open.item.log?.length ?? 0) > 0 && (
                  <div className="ld-field">
                    <span>History in this version</span>
                    <ul className="sc-log">
                      {open.item.log!.map((l, k) => (
                        <li key={k}>
                          <span className="muted">{fmt(l.at)}</span> {MARKS.find((m) => m.id === l.mark)?.title}
                          {l.note ? `: ${l.note}` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
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

  // ---------- the full release plan ----------
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
        {versions.length > 0 && (
          <button className="btn" onClick={() => go({ kind: 'roadmap' })}>
            <MapIcon size={14} /> Roadmap
          </button>
        )}
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
            top={
              versions.length > 0 && (
                <div className="ld-field">
                  <span>In versions</span>
                  <div className="ld-inline" style={{ flexWrap: 'wrap' }}>
                    {versions.map((v) => {
                      const it = v.items.find((i) => i.ref === f.id)
                      return it ? (
                        <button key={v.id} className="kb-chip sc-chip-btn" title={it.reason} onClick={() => go({ kind: 'version', id: v.id }, it.id)}>
                          {v.name}: {MARKS.find((m) => m.id === it.mark)?.title}
                        </button>
                      ) : v.state !== 'shipped' ? (
                        <button key={v.id} className="kb-chip sc-chip-btn sc-chip-add" title={`Put into ${v.name}`} onClick={() => set((x) => putFeature(x, v.id, { ref: f.id }))}>
                          + {v.name}
                        </button>
                      ) : null
                    })}
                  </div>
                </div>
              )
            }
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
  bottom,
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
  bottom?: ReactNode
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
      {bottom}
      <button className="btn btn-danger ld-danger" onClick={onDelete}>
        <Trash2 size={14} /> {deleteLabel}
      </button>
    </aside>
  )
}
