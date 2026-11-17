import { Flag, Link2, Plus, X } from 'lucide-react'
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { newId, type Entity, type Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { createTasksDoc, type TasksDoc } from '@/components/tasks/model'
import { NumberInput, PresetHeader } from '@/shared/calculators'
import { useEditSession } from '@/shared/calculators/editSession'
import { jumpTo } from '@/shared/entityList'
import { pickJumpTarget, targetLabel } from '@/shared/jumps/Jumps'
import { createLiveOpsDoc, passDays, rerunWarnings, shiftWeeks, totalWeeks, VERSION_COLORS, versionStarts, weekDate, type LiveOpsDoc } from './model'
import './live-ops.css'

const WEEK = 56
/** shortcut: the Economy's default player profiles; read a chosen Economy document's own when someone asks. */
const PROFILES = [
  { name: 'Casual', hoursPerDay: 0.5 },
  { name: 'Regular', hoursPerDay: 1.5 },
  { name: 'Core', hoursPerDay: 4 },
]

type Tab = 'plan' | 'list' | 'pass' | 'store'
type Drag = { kind: 'version' | 'event' | 'banner'; id: Id; mode: 'move' | 'size'; x0: number; orig: LiveOpsDoc }

/** Live-Service Planner (missing tools phase 4). */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<LiveOpsDoc>('live-ops', documentId!, createLiveOpsDoc)
  useUndoRedoKeys(doc, active)
  const session = useEditSession(doc)
  const tasks = useDocument<TasksDoc>('tasks', 'tasks', createTasksDoc)
  const characters = useProjectStore((s) => s.entities.character) as Entity[]
  const gachaDocs = useProjectStore((s) => s.meta?.documents ?? []).filter((x) => x.type === 'gacha')
  const [tab, setTab] = useState<Tab>('plan')
  const [picked, setPicked] = useState<Set<Id>>(new Set())
  const drag = useRef<Drag | null>(null)
  if (!doc.data) return null
  const d = doc.data
  const set = (fn: (d: LiveOpsDoc) => LiveOpsDoc) => doc.update(fn)
  const weeks = totalWeeks(d) + 2
  const starts = versionStarts(d)
  const warnings = rerunWarnings(d)
  const charName = (id: Id) => characters.find((c) => c.id === id)?.name || '(deleted)'
  const bannerName = (id: Id) => d.banners.find((b) => b.id === id)?.name ?? '?'
  const label = (w: number) => weekDate(d.start, w) || `W${w}`

  const down = (e: ReactPointerEvent, kind: Drag['kind'], id: Id, mode: Drag['mode']) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { kind, id, mode, x0: e.clientX, orig: d }
    session.begin()
  }
  const move = (e: ReactPointerEvent) => {
    const g = drag.current
    if (!g) return
    const dw = Math.round((e.clientX - g.x0) / WEEK)
    const dd = Math.round(((e.clientX - g.x0) / WEEK) * 7)
    const o = g.orig
    session.change(() => {
      if (g.kind === 'version') return { ...o, versions: o.versions.map((v) => (v.id === g.id ? { ...v, weeks: Math.max(1, v.weeks + dw) } : v)) }
      if (g.kind === 'event') return { ...o, events: o.events.map((v) => (v.id !== g.id ? v : g.mode === 'size' ? { ...v, days: Math.max(1, v.days + dd) } : { ...v, startWeek: Math.max(0, v.startWeek + dw) })) }
      return { ...o, banners: o.banners.map((v) => (v.id !== g.id ? v : g.mode === 'size' ? { ...v, weeks: Math.max(1, v.weeks + dw) } : { ...v, startWeek: Math.max(0, v.startWeek + dw) })) }
    })
  }
  const up = () => {
    if (!drag.current) return
    drag.current = null
    session.end()
  }
  const makeMilestones = () =>
    tasks.update((t) => {
      const have = new Set((t.milestones ?? []).map((m) => m.name))
      const add = d.versions.filter((v) => !have.has(v.name)).map((v, i) => ({ id: newId(), name: v.name, date: weekDate(d.start, starts[d.versions.indexOf(v)] ?? i) }))
      return add.length ? { ...t, milestones: [...(t.milestones ?? []), ...add] } : t
    })

  return (
    <div className="lo">
      <div className="lo-head">
        <PresetHeader documentId={documentId!} kind="Plan" undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
        <div className="ld-inline">
          {(['plan', 'list', 'pass', 'store'] as Tab[]).map((t) => (
            <button key={t} className={`btn btn-ghost${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
              {{ plan: 'Weeks', list: 'List', pass: 'Battle pass', store: 'Store' }[t]}
            </button>
          ))}
          <label className="ld-inline lo-start">
            Launch <input className="input" type="date" value={d.start} onChange={(e) => set((x) => ({ ...x, start: e.target.value }))} />
          </label>
          <button className="btn btn-ghost" onClick={makeMilestones} title="One Task Board milestone per version, so the production plan matches">
            <Flag size={14} /> Make milestones
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="lo-warn">
          {warnings.map((w, i) => (
            <p key={i} className="lo-warn-line">
              {charName(w.characterId)} is featured again {w.weeks} weeks after {bannerName(w.first)}, sooner than {d.rerunWeeks} weeks ({bannerName(w.again)}).
            </p>
          ))}
        </div>
      )}

      {tab === 'plan' && (
        <div className="lo-scroll" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="lo-grid" style={{ width: weeks * WEEK + 110 }}>
            <div className="lo-ruler">
              <span className="lo-rowname" />
              {Array.from({ length: weeks }, (_, w) => (
                <span key={w} className="lo-week" style={{ width: WEEK }} title={weekDate(d.start, w)}>
                  {w % 2 === 0 ? label(w).replace(/^\d{4}-/, '') : ''}
                </span>
              ))}
            </div>
            <Row name="Versions" onAdd={() => set((x) => ({ ...x, versions: [...x.versions, { id: newId(), name: `Version ${x.versions.length + 1}`, weeks: 6, color: VERSION_COLORS[x.versions.length % VERSION_COLORS.length], notes: '' }] }))}>
              {d.versions.map((v, i) => (
                <Bar key={v.id} left={starts[i] * WEEK} width={v.weeks * WEEK} color={v.color} title={`${v.name}: ${v.weeks} weeks`} onSize={(e) => down(e, 'version', v.id, 'size')}>
                  <input className="lo-bar-input" value={v.name} onChange={(e) => set((x) => ({ ...x, versions: x.versions.map((o) => (o.id === v.id ? { ...o, name: e.target.value } : o)) }))} aria-label="Version" />
                </Bar>
              ))}
            </Row>
            <Row name="Events" tall={Math.max(1, d.events.length)} onAdd={() => set((x) => ({ ...x, events: [...x.events, { id: newId(), name: 'New event', startWeek: 0, days: 7, rewards: '', target: null, color: '#f5a623' }] }))}>
              {d.events.map((v, i) => (
                <Bar key={v.id} top={i * 30} left={v.startWeek * WEEK} width={(v.days / 7) * WEEK} color={v.color} title={`${v.name}: ${v.days} days${v.rewards ? ` · ${v.rewards}` : ''}`} onMove={(e) => down(e, 'event', v.id, 'move')} onSize={(e) => down(e, 'event', v.id, 'size')}>
                  {v.name}
                </Bar>
              ))}
            </Row>
            <Row name="Banners" tall={2} onAdd={() => set((x) => ({ ...x, banners: [...x.banners, { id: newId(), name: `Banner ${x.banners.length + 1}`, startWeek: Math.max(0, ...x.banners.map((b) => b.startWeek + b.weeks)), weeks: 3, gachaDocId: null, featured: [] }] }))}>
              {d.banners.map((v, i) => (
                <Bar
                  key={v.id}
                  top={(i % 2) * 30}
                  left={v.startWeek * WEEK}
                  width={v.weeks * WEEK}
                  color={warnings.some((w) => w.again === v.id) ? '#e03131' : '#9c36b5'}
                  title={`${v.name}${v.featured.length ? `: ${v.featured.map(charName).join(', ')}` : ''}`}
                  onMove={(e) => down(e, 'banner', v.id, 'move')}
                  onSize={(e) => down(e, 'banner', v.id, 'size')}
                >
                  {v.name}
                  {v.featured.length ? ` · ${v.featured.map(charName).join(', ')}` : ''}
                </Bar>
              ))}
            </Row>
            {d.pass && (
              <Row name="Battle pass">
                <Bar left={0} width={d.pass.weeks * WEEK} color="#2f9e44" title={`${d.pass.tiers} tiers over ${d.pass.weeks} weeks`}>
                  {d.pass.tiers} tiers
                </Bar>
              </Row>
            )}
          </div>
          <p className="muted lo-hint">Drag an event or banner to move it, drag its right edge to make it longer. Versions follow each other: drag a version's right edge and everything after it moves. Details and bulk moves are in List.</p>
        </div>
      )}

      {tab === 'list' && (
        <div className="lo-body">
          <div className="ld-inline">
            <span className="muted">{picked.size ? `${picked.size} picked:` : 'Tick rows to move them together.'}</span>
            {picked.size > 0 &&
              [-1, 1, 2].map((by) => (
                <button key={by} className="btn btn-ghost" onClick={() => set((x) => shiftWeeks(x, picked, by))}>
                  {by > 0 ? `+${by}` : by} week{Math.abs(by) > 1 ? 's' : ''}
                </button>
              ))}
            <label className="ld-inline">
              Warn when featured again within <NumberInput value={d.rerunWeeks} min={0} onChange={(rerunWeeks) => set((x) => ({ ...x, rerunWeeks }))} /> weeks
            </label>
          </div>
          <h3>Versions</h3>
          <table className="calc-table lo-table">
            <tbody>
              {d.versions.map((v, i) => (
                <tr key={v.id}>
                  <td>
                    <input type="color" value={v.color} onChange={(e) => set((x) => ({ ...x, versions: x.versions.map((o) => (o.id === v.id ? { ...o, color: e.target.value } : o)) }))} aria-label="Colour" />
                  </td>
                  <td>
                    <input className="input" value={v.name} onChange={(e) => set((x) => ({ ...x, versions: x.versions.map((o) => (o.id === v.id ? { ...o, name: e.target.value } : o)) }))} />
                  </td>
                  <td className="muted">{label(starts[i])}</td>
                  <td>
                    <NumberInput value={v.weeks} min={1} onChange={(w) => set((x) => ({ ...x, versions: x.versions.map((o) => (o.id === v.id ? { ...o, weeks: Math.max(1, Math.round(w)) } : o)) }))} /> weeks
                  </td>
                  <td>
                    <input className="input" placeholder="Notes" value={v.notes} onChange={(e) => set((x) => ({ ...x, versions: x.versions.map((o) => (o.id === v.id ? { ...o, notes: e.target.value } : o)) }))} />
                  </td>
                  <td>
                    <button className="icon-btn" aria-label="Remove" onClick={() => set((x) => ({ ...x, versions: x.versions.filter((o) => o.id !== v.id) }))}>
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Events</h3>
          <table className="calc-table lo-table">
            <tbody>
              {d.events.map((v) => {
                const edit = (p: Partial<typeof v>) => set((x) => ({ ...x, events: x.events.map((o) => (o.id === v.id ? { ...o, ...p } : o)) }))
                return (
                  <tr key={v.id}>
                    <td>
                      <input type="checkbox" checked={picked.has(v.id)} onChange={() => setPicked(toggle(picked, v.id))} aria-label="Pick" />
                    </td>
                    <td>
                      <input className="input" value={v.name} onChange={(e) => edit({ name: e.target.value })} />
                    </td>
                    <td>
                      week <NumberInput value={v.startWeek} min={0} onChange={(startWeek) => edit({ startWeek })} />
                    </td>
                    <td>
                      <NumberInput value={v.days} min={1} onChange={(days) => edit({ days })} /> days
                    </td>
                    <td>
                      <input className="input" placeholder="Rewards" value={v.rewards} onChange={(e) => edit({ rewards: e.target.value })} />
                    </td>
                    <td>
                      {v.target ? (
                        <button className="btn btn-ghost" onClick={() => jumpTo(v.target!)}>
                          <Link2 size={13} /> {targetLabel(v.target)}
                        </button>
                      ) : (
                        <button className="btn btn-ghost" title="Link a quest, achievement or anything else" onClick={async () => { const target = await pickJumpTarget('What belongs to this event?'); if (target) edit({ target }) }}>
                          <Link2 size={13} /> Link
                        </button>
                      )}
                    </td>
                    <td>
                      <button className="icon-btn" aria-label="Remove" onClick={() => set((x) => ({ ...x, events: x.events.filter((o) => o.id !== v.id) }))}>
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <h3>Banners</h3>
          <table className="calc-table lo-table">
            <tbody>
              {d.banners.map((v) => {
                const edit = (p: Partial<typeof v>) => set((x) => ({ ...x, banners: x.banners.map((o) => (o.id === v.id ? { ...o, ...p } : o)) }))
                return (
                  <tr key={v.id}>
                    <td>
                      <input type="checkbox" checked={picked.has(v.id)} onChange={() => setPicked(toggle(picked, v.id))} aria-label="Pick" />
                    </td>
                    <td>
                      <input className="input" value={v.name} onChange={(e) => edit({ name: e.target.value })} />
                    </td>
                    <td>
                      week <NumberInput value={v.startWeek} min={0} onChange={(startWeek) => edit({ startWeek })} />
                    </td>
                    <td>
                      <NumberInput value={v.weeks} min={1} onChange={(weeks) => edit({ weeks })} /> weeks
                    </td>
                    <td>
                      <select className="input" value={v.gachaDocId ?? ''} onChange={(e) => edit({ gachaDocId: e.target.value || null })} title="Rates from a Gacha & Loot document">
                        <option value="">No Gacha document</option>
                        {gachaDocs.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.title}
                          </option>
                        ))}
                      </select>
                      {v.gachaDocId && (
                        <button className="icon-btn" title="Open" onClick={() => jumpTo({ kind: 'document', type: 'gacha', documentId: v.gachaDocId })}>
                          <Link2 size={13} />
                        </button>
                      )}
                    </td>
                    <td>
                      <div className="ld-inline">
                        {v.featured.map((c) => (
                          <button key={c} className="btn btn-ghost" title="Remove" onClick={() => edit({ featured: v.featured.filter((x) => x !== c) })}>
                            {charName(c)} ×
                          </button>
                        ))}
                        <select className="input" value="" onChange={(e) => e.target.value && edit({ featured: [...v.featured, e.target.value] })}>
                          <option value="">Feature a character…</option>
                          {characters
                            .filter((c) => !v.featured.includes(c.id))
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name || 'Untitled'}
                              </option>
                            ))}
                        </select>
                      </div>
                    </td>
                    <td>
                      <button className="icon-btn" aria-label="Remove" onClick={() => set((x) => ({ ...x, banners: x.banners.filter((o) => o.id !== v.id) }))}>
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'pass' && (
        <div className="lo-body">
          {!d.pass ? (
            <button className="btn btn-primary" onClick={() => set((x) => ({ ...x, pass: createLiveOpsDoc().pass }))}>
              <Plus size={14} /> Add a battle pass
            </button>
          ) : (
            <>
              <div className="ld-inline">
                <label className="ld-field">
                  <span>Tiers</span>
                  <NumberInput value={d.pass.tiers} min={1} onChange={(tiers) => set((x) => ({ ...x, pass: { ...x.pass!, tiers: Math.round(tiers) } }))} />
                </label>
                <label className="ld-field">
                  <span>XP per tier</span>
                  <NumberInput value={d.pass.xpPerTier} min={1} onChange={(xpPerTier) => set((x) => ({ ...x, pass: { ...x.pass!, xpPerTier } }))} />
                </label>
                <label className="ld-field">
                  <span>XP per hour played</span>
                  <NumberInput value={d.pass.xpPerHour} min={0} onChange={(xpPerHour) => set((x) => ({ ...x, pass: { ...x.pass!, xpPerHour } }))} />
                </label>
                <label className="ld-field">
                  <span>Runs for weeks</span>
                  <NumberInput value={d.pass.weeks} min={1} onChange={(weeks) => set((x) => ({ ...x, pass: { ...x.pass!, weeks } }))} />
                </label>
              </div>
              <div className="ld-result">
                {PROFILES.map((p) => {
                  const r = passDays(d.pass!, p.hoursPerDay)
                  return (
                    <div key={p.name} className="ld-stat">
                      <span>
                        {p.name} ({p.hoursPerDay} h a day)
                      </span>
                      <strong className={r.fits ? '' : 'lo-bad'}>{Number.isFinite(r.days) ? `${r.days} days` : 'never'}</strong>
                      <span>{r.fits ? 'finishes in time' : `misses it (${d.pass!.weeks * 7} days)`}</span>
                    </div>
                  )
                })}
              </div>
              <h3>Rewards</h3>
              <table className="calc-table lo-table">
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>Free</th>
                    <th>Paid</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.pass.rewards.map((r, i) => {
                    const edit = (p: Partial<typeof r>) => set((x) => ({ ...x, pass: { ...x.pass!, rewards: x.pass!.rewards.map((o, j) => (j === i ? { ...o, ...p } : o)) } }))
                    return (
                      <tr key={i}>
                        <td>
                          <NumberInput value={r.tier} min={1} max={d.pass!.tiers} onChange={(tier) => edit({ tier: Math.round(tier) })} />
                        </td>
                        <td>
                          <input className="input" value={r.free} onChange={(e) => edit({ free: e.target.value })} />
                        </td>
                        <td>
                          <input className="input" value={r.paid} onChange={(e) => edit({ paid: e.target.value })} />
                        </td>
                        <td>
                          <button className="icon-btn" aria-label="Remove" onClick={() => set((x) => ({ ...x, pass: { ...x.pass!, rewards: x.pass!.rewards.filter((_, j) => j !== i) } }))}>
                            <X size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="ld-inline">
                <button className="btn btn-ghost" onClick={() => set((x) => ({ ...x, pass: { ...x.pass!, rewards: [...x.pass!.rewards, { tier: Math.min(x.pass!.tiers, (x.pass!.rewards.at(-1)?.tier ?? 0) + 1), free: '', paid: '' }].sort((a, b) => a.tier - b.tier) } }))}>
                  <Plus size={14} /> Reward
                </button>
                <button className="btn btn-ghost" onClick={() => set((x) => ({ ...x, pass: null }))}>
                  Remove the battle pass
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'store' && (
        <div className="lo-body">
          <p className="muted">What is on sale which week.</p>
          <table className="calc-table lo-table">
            <tbody>
              {[...d.store]
                .sort((a, b) => a.week - b.week)
                .map((s) => {
                  const edit = (p: Partial<typeof s>) => set((x) => ({ ...x, store: x.store.map((o) => (o.id === s.id ? { ...o, ...p } : o)) }))
                  return (
                    <tr key={s.id}>
                      <td>
                        <input type="checkbox" checked={picked.has(s.id)} onChange={() => setPicked(toggle(picked, s.id))} aria-label="Pick" />
                      </td>
                      <td>
                        week <NumberInput value={s.week} min={0} onChange={(week) => edit({ week })} />
                      </td>
                      <td className="muted">{weekDate(d.start, s.week)}</td>
                      <td>
                        <input className="input" value={s.name} onChange={(e) => edit({ name: e.target.value })} />
                      </td>
                      <td>
                        <NumberInput value={s.price} min={0} onChange={(price) => edit({ price })} />
                      </td>
                      <td>
                        <input className="input" style={{ width: 90 }} value={s.currency} onChange={(e) => edit({ currency: e.target.value })} aria-label="Currency" />
                      </td>
                      <td>
                        <button className="icon-btn" aria-label="Remove" onClick={() => set((x) => ({ ...x, store: x.store.filter((o) => o.id !== s.id) }))}>
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
          <button className="btn btn-ghost" onClick={() => set((x) => ({ ...x, store: [...x.store, { id: newId(), week: 0, name: 'Starter bundle', price: 500, currency: 'Gems' }] }))}>
            <Plus size={14} /> Store item
          </button>
        </div>
      )}
    </div>
  )
}

const toggle = (s: Set<Id>, id: Id) => {
  const n = new Set(s)
  if (n.has(id)) n.delete(id)
  else n.add(id)
  return n
}

function Row({ name, tall = 1, onAdd, children }: { name: string; tall?: number; onAdd?(): void; children: ReactNode }) {
  return (
    <div className="lo-row" style={{ height: tall * 30 + 10 }}>
      <span className="lo-rowname">
        {name}
        {onAdd && (
          <button className="icon-btn" aria-label={`Add to ${name}`} onClick={onAdd}>
            <Plus size={13} />
          </button>
        )}
      </span>
      <div className="lo-lane">{children}</div>
    </div>
  )
}

function Bar({ left, width, top = 0, color, title, onMove, onSize, children }: { left: number; width: number; top?: number; color: string; title: string; onMove?(e: ReactPointerEvent): void; onSize?(e: ReactPointerEvent): void; children: ReactNode }) {
  return (
    <div className={`lo-bar${onMove ? ' movable' : ''}`} style={{ left, width: Math.max(14, width), top, background: color }} title={title} onPointerDown={onMove}>
      <span className="lo-bar-text">{children}</span>
      {onSize && <span className="lo-bar-size" onPointerDown={onSize} />}
    </div>
  )
}
