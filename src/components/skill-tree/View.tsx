import { Minus, Plus, RotateCcw, Settings2, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useUndoRedoKeys } from '@/core/state'
import { NumberInput, PresetHeader } from '@/shared/calculators'
import { confirmDialog } from '@/shared/dialogs'
import { ImagePicker } from '@/shared/entityList'
import { FlowGraph } from '@/shared/graph'
import { ProofTextarea } from '@/shared/spell'
import {
  cannotAdd,
  cannotRankGroup,
  cannotRemove,
  cannotUnrankGroup,
  carryable,
  createSkillTreeDoc,
  currencyName,
  freeCell,
  fullTreeCost,
  groupLoop,
  learned,
  MAIN,
  needed,
  newCurrency,
  newGroup,
  newSkill,
  newType,
  normalizeSkillTree,
  spentOf,
  totalOf,
  typeOf,
  wouldLoop,
  type Skill,
  type SkillGroup,
  type SkillTreeDoc,
} from './model'
import './skill-tree.css'

const T = {
  kind: 'Skill tree',
  empty: 'No skills yet. Make one with New skill, then link skills with "Needs first" to grow the tree. Settings adds your own node types, currencies and groups.',
  pick: 'Click a skill to put points into it.',
  loop: 'That would make a loop: it would need itself.',
}
const GRID_W = 8

type Mode = 'edit' | 'groups' | 'plan'

/** Skill / talent tree editor with a build planner. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<SkillTreeDoc>('skill-tree', documentId!, createSkillTreeDoc)
  useUndoRedoKeys(doc, active)
  const [selectedId, setSelectedId] = useState<Id | null>(null)
  const [groupId, setGroupId] = useState<Id | null>(null)
  const [mode, setMode] = useState<Mode>('edit')
  const [showSettings, setShowSettings] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  if (!doc.data) return null
  const d = normalizeSkillTree(doc.data)
  const set = (fn: (d: SkillTreeDoc) => Partial<SkillTreeDoc>) => doc.update((x) => ({ ...normalizeSkillTree(x), ...fn(normalizeSkillTree(x)) }))
  const edit = (id: Id, patch: Partial<Skill>) => set((x) => ({ skills: x.skills.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const editGroup = (id: Id, patch: Partial<SkillGroup>) => set((x) => ({ groups: x.groups!.map((g) => (g.id === id ? { ...g, ...patch } : g)) }))
  const sel = d.skills.find((s) => s.id === selectedId) ?? null
  const groups = d.groups!
  const grid = d.layout === 'grid'
  const colorOf = (s: Skill) => groups.find((g) => g.id === s.groupId)?.color ?? typeOf(d, s)?.color
  const learnedIds = new Set(learned(d).map((s) => s.id))

  const add = (cell?: { x: number; y: number }) => {
    const s = { ...newSkill(), kind: d.types![d.types!.length > 1 ? 1 : 0].id, ...(grid ? { cell: cell ?? freeCell(d.skills, GRID_W) } : {}) }
    set((x) => ({ skills: [...x.skills, s] }))
    setSelectedId(s.id)
    setMode('edit')
  }
  const addGroup = () => {
    const g = newGroup()
    set((x) => ({ groups: [...x.groups!, g] }))
    setGroupId(g.id)
  }
  const remove = async (s: Skill) => {
    if (!(await confirmDialog({ title: `Delete ${s.name}?`, message: 'Skills that needed it lose that link. You can undo with Ctrl+Z.', confirmLabel: 'Delete', danger: true }))) return
    set((x) => {
      const plan = { ...x.plan }
      delete plan[s.id]
      return { skills: x.skills.filter((o) => o.id !== s.id).map((o) => ({ ...o, requires: o.requires.filter((r) => r !== s.id) })), plan, carried: x.carried!.filter((c) => c !== s.id) }
    })
    setSelectedId(null)
  }
  const changeRank = (id: Id, delta: 1 | -1) => {
    const why = delta > 0 ? cannotAdd(d, id) : cannotRemove(d, id)
    if (why) return setMessage(why)
    setMessage(null)
    set((x) => ({ plan: { ...x.plan, [id]: (x.plan[id] ?? 0) + delta } }))
  }
  const rankGroup = (id: Id, delta: 1 | -1) => {
    const why = delta > 0 ? cannotRankGroup(d, id) : cannotUnrankGroup(d, id)
    if (why) return setMessage(why)
    setMessage(null)
    set((x) => ({ groupRanks: { ...x.groupRanks, [id]: (x.groupRanks![id] ?? 0) + delta } }))
  }
  const currencies = [{ id: MAIN, name: currencyName(d, undefined) }, ...d.currencies!]

  let side: ReactNode = null
  if (showSettings) side = <SettingsPanel d={d} set={set} onClose={() => setShowSettings(false)} />
  else if (mode === 'groups') {
    const g = groups.find((x) => x.id === groupId)
    side = g ? (
      <GroupDetail
        g={g}
        d={d}
        edit={(p) => editGroup(g.id, p)}
        onRemove={() => {
          set((x) => ({
            groups: x.groups!.filter((o) => o.id !== g.id).map((o) => ({ ...o, requires: o.requires.filter((r) => r.groupId !== g.id) })),
            skills: x.skills.map((s) => (s.groupId === g.id ? { ...s, groupId: undefined } : s)),
          }))
          setGroupId(null)
        }}
      />
    ) : (
      <aside className="skills-side">
        <p className="muted">Groups are classes, jobs, weapons or branches. Each ranks up on its own and teaches its skills at the ranks you set. A group can need other groups at a rank first and cost something to unlock.</p>
      </aside>
    )
  } else if (mode === 'plan') {
    side = (
      <aside className="skills-side">
        {groups.length > 0 && (
          <Card title="Group ranks">
            {groups.map((g) => (
              <div key={g.id} className="skills-rank">
                <button className="icon-btn" aria-label={`Take back a ${g.name} rank`} onClick={() => rankGroup(g.id, -1)}>
                  <Minus size={14} />
                </button>
                <span className="skills-rank-name" style={{ color: g.color }}>
                  {g.name}
                </span>
                <span>
                  {d.groupRanks![g.id] ?? 0} / {g.maxRank}
                </span>
                <button className="icon-btn" aria-label={`Add a ${g.name} rank`} onClick={() => rankGroup(g.id, 1)}>
                  <Plus size={14} />
                </button>
              </div>
            ))}
            {d.oneGroupActive && <ActivePicker d={d} set={set} />}
          </Card>
        )}
        {sel ? (
          <Card title={sel.name}>
            {sel.effect && <p>{sel.effect}</p>}
            {sel.groupId ? (
              <p className="muted">{learnedIds.has(sel.id) ? 'Learned through its group.' : cannotAdd(d, sel.id)}</p>
            ) : (
              <div className="skills-rank">
                <button className="icon-btn" aria-label="Take back a rank" title="Take back a rank" onClick={() => changeRank(sel.id, -1)}>
                  <Minus size={16} />
                </button>
                <strong>
                  Rank {d.plan[sel.id] ?? 0} of {sel.maxRank}
                </strong>
                <button className="icon-btn" aria-label="Add a rank" title="Add a rank" onClick={() => changeRank(sel.id, 1)}>
                  <Plus size={16} />
                </button>
              </div>
            )}
          </Card>
        ) : (
          <p className="muted">{T.pick}</p>
        )}
        {message && <p className="skills-message">{message}</p>}
      </aside>
    )
  } else if (sel)
    side = (
      <SkillDetail
        s={sel}
        d={d}
        edit={(p) => edit(sel.id, p)}
        onRemove={() => void remove(sel)}
        onSelect={setSelectedId}
        onLoop={() => setMessage(T.loop)}
        message={message}
      />
    )

  return (
    <div className="skills">
      <div className="skills-head">
        <PresetHeader documentId={documentId!} kind={T.kind} undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
      </div>
      <div className="skills-toolbar">
        <button className="btn btn-primary" onClick={() => (mode === 'groups' ? addGroup() : add())}>
          <Plus size={14} /> {mode === 'groups' ? 'New group' : 'New skill'}
        </button>
        <div className="calc-segmented skills-mode" role="tablist">
          {(
            [
              ['edit', 'Edit skills'],
              ['groups', 'Groups'],
              ['plan', 'Plan a build'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              className={mode === m ? 'on' : ''}
              onClick={() => {
                setMode(m)
                setMessage(null)
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === 'edit' && (
          <div className="calc-segmented skills-mode" role="tablist" aria-label="Layout">
            <button className={!grid ? 'on' : ''} onClick={() => set(() => ({ layout: 'tree' }))} title="Drawn from the Needs first links">
              Tree
            </button>
            <button
              className={grid ? 'on' : ''}
              title="Nodes on a grid of cells you place yourself"
              onClick={() =>
                set((x) => {
                  const skills = [...x.skills]
                  skills.forEach((s, i) => {
                    if (!s.cell) skills[i] = { ...s, cell: freeCell(skills, GRID_W) }
                  })
                  return { layout: 'grid', skills }
                })
              }
            >
              Grid
            </button>
          </div>
        )}
        {mode === 'plan' && (
          <>
            <label className="skills-field">
              Level
              <NumberInput value={d.budget.level} min={0} onChange={(v) => set((x) => ({ budget: { ...x.budget, level: Math.max(0, Math.round(v)) } }))} />
            </label>
            <div className="skills-totals">
              {currencies.map((c) => {
                const used = spentOf(d, c.id)
                const all = totalOf(d, c.id)
                return (
                  <span key={c.id} className={`skills-total-chip${used > all ? ' over' : ''}`}>
                    {used} / {all} {c.name}
                  </span>
                )
              })}
            </div>
            <button className="btn btn-ghost" onClick={() => set(() => ({ plan: {}, groupRanks: {}, carried: [], activeGroup: null }))}>
              <RotateCcw size={14} /> Reset build
            </button>
          </>
        )}
        <span className="skills-spacer" />
        {mode === 'edit' && <span className="skills-total">{d.skills.length} skills · maxing everything costs {fullTreeCost(d)}</span>}
        <button className={`btn btn-ghost${showSettings ? ' on' : ''}`} onClick={() => setShowSettings((v) => !v)} aria-pressed={showSettings}>
          <Settings2 size={14} /> Settings
        </button>
      </div>

      <div className="skills-body">
        <div className="skills-graph">
          {mode === 'groups' ? (
            groups.length === 0 ? (
              <p className="muted skills-empty">No groups yet. Make one with New group: a class, job, weapon or branch that ranks up and teaches skills.</p>
            ) : (
              <FlowGraph
                nodes={groups.map((g) => ({ id: g.id, label: g.name, sub: `${g.maxRank} ranks · ${d.skills.filter((s) => s.groupId === g.id).length} skills`, color: g.color }))}
                edges={groups.flatMap((g) => g.requires.map((r) => ({ from: r.groupId, to: g.id, label: `rank ${r.rank}` })))}
                selectedId={groupId}
                onSelect={setGroupId}
              />
            )
          ) : d.skills.length === 0 ? (
            <p className="muted skills-empty">{T.empty}</p>
          ) : grid ? (
            <SkillGrid
              d={d}
              mode={mode}
              learnedIds={learnedIds}
              selectedId={selectedId}
              colorOf={colorOf}
              onSelect={(id) => {
                setSelectedId(id)
                if (mode === 'plan') setMessage(null)
              }}
              onEmpty={(cell) => (sel ? edit(sel.id, { cell }) : add(cell))}
            />
          ) : (
            <FlowGraph
              nodes={d.skills.map((s) => {
                const rank = s.groupId ? (learnedIds.has(s.id) ? 1 : 0) : (d.plan[s.id] ?? 0)
                return {
                  id: s.id,
                  label: s.name || 'Untitled skill',
                  sub: s.groupId
                    ? `${groups.find((g) => g.id === s.groupId)?.name ?? '?'} rank ${Math.max(1, s.learnAt ?? 1)}`
                    : mode === 'plan'
                      ? `${rank} / ${s.maxRank}`
                      : `${s.maxRank > 1 ? `${s.maxRank} ranks · ` : ''}${s.cost} ${currencyName(d, s.currencyId)}`,
                  color: colorOf(s),
                  muted: mode === 'plan' && rank === 0,
                }
              })}
              edges={d.skills.flatMap((s) => s.requires.map((r) => ({ from: r, to: s.id, label: needed(s) < s.requires.length ? `${needed(s)} of ${s.requires.length}` : undefined })))}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id)
                if (mode === 'plan' && id !== selectedId) setMessage(null)
              }}
            />
          )}
        </div>
        {side}
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="skills-card">
      <h4>{title}</h4>
      {children}
    </section>
  )
}

function ActivePicker({ d, set }: { d: SkillTreeDoc; set(fn: (d: SkillTreeDoc) => Partial<SkillTreeDoc>): void }) {
  const groups = d.groups!
  const active = groups.find((g) => g.id === d.activeGroup)
  const picked = d.carried!
  const options = carryable(d)
  return (
    <>
      <label className="skills-field">
        Active group
        <select className="input" value={d.activeGroup ?? ''} onChange={(e) => set(() => ({ activeGroup: e.target.value || null, carried: [] }))}>
          <option value="">None</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      {active && active.carrySlots > 0 && (
        <div className="skills-field">
          Carried skills ({picked.length} of {active.carrySlots})
          {options.map((sk) => (
            <label key={sk.id} className="skills-inline">
              <input
                type="checkbox"
                checked={picked.includes(sk.id)}
                disabled={!picked.includes(sk.id) && picked.length >= active.carrySlots}
                onChange={(e) => set(() => ({ carried: e.target.checked ? [...picked, sk.id] : picked.filter((x) => x !== sk.id) }))}
              />
              {sk.name}
            </label>
          ))}
          {options.length === 0 && <span className="muted">Learn carryable skills in other groups first.</span>}
        </div>
      )}
    </>
  )
}

/** Nodes on a grid; empty cells add or move a node. */
function SkillGrid({
  d,
  mode,
  learnedIds,
  selectedId,
  colorOf,
  onSelect,
  onEmpty,
}: {
  d: SkillTreeDoc
  mode: Mode
  learnedIds: Set<Id>
  selectedId: Id | null
  colorOf(s: Skill): string | undefined
  onSelect(id: Id): void
  onEmpty(cell: { x: number; y: number }): void
}) {
  const placed = d.skills.filter((s) => s.cell)
  const w = Math.max(GRID_W, ...placed.map((s) => s.cell!.x + 2))
  const h = Math.max(4, ...placed.map((s) => s.cell!.y + 2))
  const at = new Map(placed.map((s) => [`${s.cell!.x},${s.cell!.y}`, s]))
  return (
    <div className="skills-grid" style={{ gridTemplateColumns: `repeat(${w}, 68px)` }}>
      {Array.from({ length: w * h }, (_, i) => {
        const x = i % w
        const y = Math.floor(i / w)
        const s = at.get(`${x},${y}`)
        if (!s) return <button key={i} className="skills-cell empty" aria-label={`Empty cell ${x + 1}, ${y + 1}`} title="Add a skill here, or move the picked one here" onClick={() => onEmpty({ x, y })} disabled={mode !== 'edit'} />
        const rank = s.groupId ? (learnedIds.has(s.id) ? 1 : 0) : (d.plan[s.id] ?? 0)
        return (
          <button
            key={i}
            className={`skills-cell${s.id === selectedId ? ' on' : ''}${mode === 'plan' && rank === 0 ? ' off' : ''}${s.start ? ' start' : ''}`}
            style={{ borderColor: colorOf(s) }}
            title={[s.name, s.effect].filter(Boolean).join(': ')}
            onClick={() => onSelect(s.id)}
          >
            <span>{s.name}</span>
            {mode === 'plan' && !s.groupId && (
              <small>
                {rank}/{s.maxRank}
              </small>
            )}
          </button>
        )
      })}
    </div>
  )
}

function SkillDetail({ s, d, edit, onRemove, onSelect, onLoop, message }: { s: Skill; d: SkillTreeDoc; edit(p: Partial<Skill>): void; onRemove(): void; onSelect(id: Id): void; onLoop(): void; message: string | null }) {
  const skills = d.skills
  const others = skills.filter((o) => o.id !== s.id && !s.requires.includes(o.id))
  const unlocks = skills.filter((o) => o.requires.includes(s.id))
  const groups = d.groups!
  return (
    <aside className="skills-side">
      <div className="skills-detail-head">
        <div className="skills-image">
          <ImagePicker path={s.image} alt={s.name} onChange={(image) => edit({ image })} />
        </div>
        <label className="skills-field grow">
          Name
          <input className="input" value={s.name} onChange={(e) => edit({ name: e.target.value })} />
        </label>
      </div>
      <div className="skills-row">
        <label className="skills-field">
          Type
          <select className="input" value={s.kind} onChange={(e) => edit({ kind: e.target.value })}>
            {d.types!.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="skills-field">
          Max rank
          <NumberInput value={s.maxRank} min={1} onChange={(v) => edit({ maxRank: Math.max(1, Math.round(v)) })} />
        </label>
      </div>
      <label className="skills-field">
        Effect
        <input className="input" placeholder="e.g. +5% crit chance per rank" value={s.effect} onChange={(e) => edit({ effect: e.target.value })} />
      </label>

      <Card title="How it is learned">
        {groups.length > 0 && (
          <label className="skills-field">
            Taught by
            <select className="input" value={s.groupId ?? ''} onChange={(e) => edit({ groupId: e.target.value || undefined })}>
              <option value="">Nothing: bought with {currencyName(d, s.currencyId)}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {s.groupId ? (
          <div className="skills-row">
            <label className="skills-field">
              At group rank
              <NumberInput value={s.learnAt ?? 1} min={1} onChange={(v) => edit({ learnAt: Math.max(1, Math.round(v)) })} />
            </label>
            <label className="skills-inline">
              <input type="checkbox" checked={!!s.carryable} onChange={(e) => edit({ carryable: e.target.checked })} /> Other groups can carry it
            </label>
          </div>
        ) : (
          <div className="skills-row">
            <label className="skills-field">
              Cost per rank
              <NumberInput value={s.cost} min={0} onChange={(v) => edit({ cost: Math.max(0, v) })} />
            </label>
            {d.currencies!.length > 0 && (
              <label className="skills-field">
                Paid in
                <select className="input" value={s.currencyId ?? ''} onChange={(e) => edit({ currencyId: e.target.value || undefined })}>
                  <option value="">{currencyName(d, undefined)}</option>
                  {d.currencies!.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="skills-field">
              Spent in tree first
              <NumberInput value={s.pointsNeeded} min={0} onChange={(v) => edit({ pointsNeeded: Math.max(0, v) })} />
            </label>
            <label className="skills-field">
              Level needed
              <NumberInput value={s.minLevel ?? 0} min={0} onChange={(v) => edit({ minLevel: Math.max(0, Math.round(v)) || undefined })} />
            </label>
          </div>
        )}
        {d.layout === 'grid' && (
          <label className="skills-inline">
            <input type="checkbox" checked={!!s.start} onChange={(e) => edit({ start: e.target.checked })} /> Start cell (free to begin from)
          </label>
        )}
      </Card>

      <Card title="Needs first">
        <div className="skills-chips">
          {s.requires.map((r) => (
            <span key={r} className="skills-chip">
              <button className="skills-link" onClick={() => onSelect(r)}>
                {skills.find((o) => o.id === r)?.name ?? '?'}
              </button>
              <button className="icon-btn" aria-label="Remove" onClick={() => edit({ requires: s.requires.filter((x) => x !== r) })}>
                <X size={12} />
              </button>
            </span>
          ))}
          {others.length > 0 && (
            <select
              className="input skills-add"
              value=""
              onChange={(e) => {
                const id = e.target.value
                if (!id) return
                if (wouldLoop(skills, s.id, id)) return onLoop()
                edit({ requires: [...s.requires, id] })
              }}
              aria-label="Add a skill it needs"
            >
              <option value="">+ Skill…</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {s.requires.length > 1 && (
          <label className="skills-field">
            How many of them
            <select className="input" value={needed(s) === s.requires.length ? 0 : needed(s)} onChange={(e) => edit({ needCount: Number(e.target.value) || undefined })}>
              <option value={0}>All of them</option>
              {Array.from({ length: s.requires.length - 1 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i === 0 ? 'Any one' : `Any ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="skills-field">
          Also needs (in words)
          <input className="input" placeholder="e.g. a key item, a finished quest" value={s.needsText ?? ''} onChange={(e) => edit({ needsText: e.target.value })} />
        </label>
        {unlocks.length > 0 && (
          <div className="skills-field">
            Opens
            <div className="skills-chips">
              {unlocks.map((o) => (
                <button key={o.id} className="skills-link skills-chip" onClick={() => onSelect(o.id)}>
                  {o.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>
      <label className="skills-field">
        Notes
        <ProofTextarea className="input" rows={3} value={s.notes} onChange={(e) => edit({ notes: e.target.value })} />
      </label>
      {message && <p className="skills-message">{message}</p>}
      <button className="btn btn-danger skills-delete" onClick={onRemove}>
        <Trash2 size={14} /> Delete skill
      </button>
    </aside>
  )
}

function GroupDetail({ g, d, edit, onRemove }: { g: SkillGroup; d: SkillTreeDoc; edit(p: Partial<SkillGroup>): void; onRemove(): void }) {
  const [loop, setLoop] = useState(false)
  const groups = d.groups!
  const others = groups.filter((o) => o.id !== g.id && !g.requires.some((r) => r.groupId === o.id))
  const own = d.skills.filter((s) => s.groupId === g.id).sort((a, b) => (a.learnAt ?? 1) - (b.learnAt ?? 1))
  return (
    <aside className="skills-side">
      <div className="skills-detail-head">
        <input type="color" value={g.color} onChange={(e) => edit({ color: e.target.value })} aria-label="Color" />
        <label className="skills-field grow">
          Name
          <input className="input" value={g.name} onChange={(e) => edit({ name: e.target.value })} />
        </label>
      </div>
      <div className="skills-row">
        <label className="skills-field">
          Max rank
          <NumberInput value={g.maxRank} min={1} onChange={(v) => edit({ maxRank: Math.max(1, Math.round(v)) })} />
        </label>
        {d.oneGroupActive && (
          <label className="skills-field">
            Carry slots
            <NumberInput value={g.carrySlots} min={0} onChange={(v) => edit({ carrySlots: Math.max(0, Math.round(v)) })} />
          </label>
        )}
      </div>
      <Card title="Unlock">
        <div className="skills-row">
          <label className="skills-field">
            Cost
            <NumberInput value={g.unlockCost} min={0} onChange={(v) => edit({ unlockCost: Math.max(0, v) })} />
          </label>
          <label className="skills-field">
            Paid in
            <select className="input" value={g.unlockCurrencyId ?? ''} onChange={(e) => edit({ unlockCurrencyId: e.target.value || undefined })}>
              <option value="">{currencyName(d, undefined)}</option>
              {d.currencies!.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="skills-field">
          How it unlocks, in words
          <input className="input" placeholder="e.g. after chapter 2, or from a mentor" value={g.unlockNote} onChange={(e) => edit({ unlockNote: e.target.value })} />
        </label>
        <div className="skills-field">
          Needs these groups first
          {g.requires.map((r) => (
            <div key={r.groupId} className="skills-rank">
              <span>{groups.find((o) => o.id === r.groupId)?.name ?? '?'} at rank</span>
              <NumberInput value={r.rank} min={1} onChange={(v) => edit({ requires: g.requires.map((x) => (x.groupId === r.groupId ? { ...x, rank: Math.max(1, Math.round(v)) } : x)) })} />
              <button className="icon-btn" aria-label="Remove" onClick={() => edit({ requires: g.requires.filter((x) => x.groupId !== r.groupId) })}>
                <X size={12} />
              </button>
            </div>
          ))}
          {others.length > 0 && (
            <select
              className="input"
              value=""
              onChange={(e) => {
                const id = e.target.value
                if (!id) return
                if (groupLoop(groups, g.id, id)) return setLoop(true)
                setLoop(false)
                edit({ requires: [...g.requires, { groupId: id, rank: groups.find((o) => o.id === id)?.maxRank ?? 1 }] })
              }}
              aria-label="Add a group it needs"
            >
              <option value="">+ Group…</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          {loop && <p className="skills-message">That would make a loop: it would need itself.</p>}
        </div>
      </Card>
      <Card title={`Teaches (${own.length})`}>
        {own.map((s) => (
          <span key={s.id} className="skills-teach">
            <b>Rank {Math.max(1, s.learnAt ?? 1)}</b> {s.name}
            {s.carryable ? <em> · carryable</em> : null}
          </span>
        ))}
        {own.length === 0 && <span className="muted">On a skill, pick this group under Taught by.</span>}
      </Card>
      <button className="btn btn-danger skills-delete" onClick={onRemove}>
        <Trash2 size={14} /> Delete group
      </button>
    </aside>
  )
}

function SettingsPanel({ d, set, onClose }: { d: SkillTreeDoc; set(fn: (d: SkillTreeDoc) => Partial<SkillTreeDoc>): void; onClose(): void }) {
  const types = d.types!
  const cur = d.currencies!
  return (
    <aside className="skills-side skills-settings" aria-label="Skill tree settings">
      <header>
        <h3>Settings</h3>
        <button className="icon-btn" aria-label="Close settings" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <Card title="Node types">
        <p className="muted">What nodes can be: skills, stat boosts, locks, keystones… Each gets a colour.</p>
        {types.map((t) => (
          <div key={t.id} className="skills-inline">
            <input type="color" value={t.color} onChange={(e) => set((x) => ({ types: x.types!.map((o) => (o.id === t.id ? { ...o, color: e.target.value } : o)) }))} aria-label={`${t.label} colour`} />
            <input className="input" value={t.label} onChange={(e) => set((x) => ({ types: x.types!.map((o) => (o.id === t.id ? { ...o, label: e.target.value } : o)) }))} aria-label="Type name" />
            {types.length > 1 && (
              <button
                className="icon-btn"
                aria-label={`Remove ${t.label}`}
                onClick={() => set((x) => ({ types: x.types!.filter((o) => o.id !== t.id), skills: x.skills.map((s) => (s.kind === t.id ? { ...s, kind: x.types!.find((o) => o.id !== t.id)!.id } : s)) }))}
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => set((x) => ({ types: [...x.types!, newType()] }))}>
          <Plus size={14} /> Add type
        </button>
      </Card>
      <Card title="Currencies">
        <p className="muted">What skills and groups cost. Each grows with the level in Plan a build.</p>
        <div className="skills-cur head">
          <span>Name</span>
          <span>At start</span>
          <span>Per level</span>
          <span />
        </div>
        <div className="skills-cur">
          <input className="input" value={d.budget.unit ?? ''} placeholder="points" onChange={(e) => set((x) => ({ budget: { ...x.budget, unit: e.target.value } }))} aria-label="Main points name" />
          <NumberInput value={d.budget.start} min={0} onChange={(v) => set((x) => ({ budget: { ...x.budget, start: v } }))} />
          <NumberInput value={d.budget.perLevel} min={0} onChange={(v) => set((x) => ({ budget: { ...x.budget, perLevel: v } }))} />
          <span />
        </div>
        {cur.map((c) => {
          const up = (p: Partial<typeof c>) => set((x) => ({ currencies: x.currencies!.map((o) => (o.id === c.id ? { ...o, ...p } : o)) }))
          return (
            <div key={c.id} className="skills-cur">
              <input className="input" value={c.name} onChange={(e) => up({ name: e.target.value })} aria-label="Currency name" />
              <NumberInput value={c.start} min={0} onChange={(v) => up({ start: v })} />
              <NumberInput value={c.perLevel} min={0} onChange={(v) => up({ perLevel: v })} />
              <button
                className="icon-btn"
                aria-label={`Remove ${c.name}`}
                onClick={() =>
                  set((x) => ({
                    currencies: x.currencies!.filter((o) => o.id !== c.id),
                    skills: x.skills.map((s) => (s.currencyId === c.id ? { ...s, currencyId: undefined } : s)),
                    groups: x.groups!.map((g) => (g.unlockCurrencyId === c.id ? { ...g, unlockCurrencyId: undefined } : g)),
                  }))
                }
              >
                <X size={13} />
              </button>
            </div>
          )
        })}
        <button className="btn btn-ghost" onClick={() => set((x) => ({ currencies: [...x.currencies!, newCurrency()] }))}>
          <Plus size={14} /> Add currency
        </button>
      </Card>
      <Card title="Rules">
        <label className="skills-inline">
          <input type="checkbox" checked={d.gridOpensNext !== false} onChange={(e) => set(() => ({ gridOpensNext: e.target.checked }))} /> On a grid, a node opens next to a learned one
        </label>
        <label className="skills-inline">
          <input type="checkbox" checked={!!d.oneGroupActive} onChange={(e) => set(() => ({ oneGroupActive: e.target.checked }))} /> Only one group is active at a time; it can carry skills from others
        </label>
      </Card>
    </aside>
  )
}
