import { Minus, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useState } from 'react'
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
  cannotRankClass,
  cannotRemove,
  classLoop,
  createSkillTreeDoc,
  freeCell,
  fullTreeCost,
  inheritable,
  learned,
  newClass,
  newSkill,
  type SkillClass,
  normalizeSkillTree,
  SKILL_KINDS,
  spent,
  totalPoints,
  wouldLoop,
  type Skill,
  type SkillTreeDoc,
} from './model'
import './skill-tree.css'

const T = {
  kind: 'Skill tree',
  add: 'New skill',
  edit: 'Edit',
  plan: 'Plan a build',
  empty: 'No skills yet. Make one with New skill, then link skills with "Needs first" to grow the tree.',
  summary: (n: number, cost: number) => `${n} skills · maxing everything costs ${cost} points`,
  name: 'Name',
  type: 'Type',
  effect: 'Effect',
  effectHint: 'e.g. +5% crit chance per rank',
  maxRank: 'Max rank',
  cost: 'Points per rank',
  pointsNeeded: 'Points spent in the tree first',
  requires: 'Needs first',
  addRequire: 'Add a skill…',
  unlocks: 'Unlocks',
  notes: 'Notes',
  delete: 'Delete skill',
  loop: 'That would make a loop: the skill would need itself.',
  start: 'Points at start',
  perLevel: 'Points per level',
  level: 'Level',
  spent: (a: number, b: number, unit: string) => `${a} of ${b} ${unit} spent`,
  reset: 'Reset build',
  pick: 'Click a skill in the tree to put points into it.',
  rank: (r: number, m: number) => `Rank ${r} of ${m}`,
}

const kindColor = (k: Skill['kind']) => SKILL_KINDS.find((x) => x.id === k)?.color
const BOARD_W = 8

/** Skill / talent tree editor with a build planner. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<SkillTreeDoc>('skill-tree', documentId!, createSkillTreeDoc)
  useUndoRedoKeys(doc, active)
  const [selectedId, setSelectedId] = useState<Id | null>(null)
  const [mode, setMode] = useState<'edit' | 'classes' | 'plan'>('edit')
  const [classId, setClassId] = useState<Id | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  if (!doc.data) return null
  const d = normalizeSkillTree(doc.data)
  const set = (fn: (d: SkillTreeDoc) => Partial<SkillTreeDoc>) => doc.update((x) => ({ ...normalizeSkillTree(x), ...fn(normalizeSkillTree(x)) }))
  const edit = (id: Id, patch: Partial<Skill>) => set((x) => ({ skills: x.skills.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const sel = d.skills.find((s) => s.id === selectedId) ?? null
  const classes = d.classes ?? []
  const board = d.layout === 'board'
  const unit = d.budget.unit || 'points'
  const colorOf = (s: Skill) => classes.find((c) => c.id === s.classId)?.color ?? kindColor(s.kind)
  const editClass = (id: Id, patch: Partial<SkillClass>) => set((x) => ({ classes: (x.classes ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  const rankClass = (id: Id, delta: 1 | -1) => {
    const rank = d.classPlan?.[id] ?? 0
    const why = delta > 0 ? cannotRankClass(d, id) : rank === 0 ? 'No ranks to take back' : (classes.find((c) => c.requires.some((r) => r.classId === id && r.rank === rank) && (d.classPlan?.[c.id] ?? 0) > 0)?.name ?? null)
    if (why) return setMessage(delta < 0 && rank > 0 ? `${why} needs it` : why)
    setMessage(null)
    set((x) => ({ classPlan: { ...x.classPlan, [id]: rank + delta } }))
  }

  const add = (cell?: { x: number; y: number }) => {
    const s = { ...newSkill(), ...(board ? { cell: cell ?? freeCell(d.skills, BOARD_W) } : {}) }
    set((x) => ({ skills: [...x.skills, s] }))
    setSelectedId(s.id)
    setMode('edit')
  }
  const remove = async (s: Skill) => {
    if (!(await confirmDialog({ title: `Delete ${s.name}?`, message: 'Skills that needed it lose that link. You can undo with Ctrl+Z.', confirmLabel: 'Delete', danger: true }))) return
    set((x) => {
      const plan = { ...x.plan }
      delete plan[s.id]
      return { skills: x.skills.filter((o) => o.id !== s.id).map((o) => ({ ...o, requires: o.requires.filter((r) => r !== s.id) })), plan }
    })
    setSelectedId(null)
  }
  const changeRank = (id: Id, delta: 1 | -1) => {
    const why = delta > 0 ? cannotAdd(d, id) : cannotRemove(d, id)
    if (why) return setMessage(why)
    setMessage(null)
    set((x) => ({ plan: { ...x.plan, [id]: (x.plan[id] ?? 0) + delta } }))
  }

  return (
    <div className="skills">
      <div className="skills-head">
        <PresetHeader documentId={documentId!} kind={T.kind} undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
      </div>
      <div className="skills-toolbar">
        <button className="btn btn-primary" onClick={() => (mode === 'classes' ? (() => { const c = newClass(); set((x) => ({ classes: [...(x.classes ?? []), c] })); setClassId(c.id) })() : add())}>
          <Plus size={14} /> {mode === 'classes' ? 'New archetype' : T.add}
        </button>
        <div className="calc-segmented skills-mode" role="tablist">
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>
            {T.edit}
          </button>
          <button className={mode === 'classes' ? 'on' : ''} onClick={() => setMode('classes')} title="Jobs, classes or archetypes that learn skills by rank">
            Archetypes
          </button>
          <button className={mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')}>
            {T.plan}
          </button>
        </div>
        {mode === 'plan' ? (
          <>
            <label className="skills-field">
              {T.start}
              <NumberInput value={d.budget.start} min={0} onChange={(v) => set((x) => ({ budget: { ...x.budget, start: v } }))} />
            </label>
            <label className="skills-field">
              {T.perLevel}
              <NumberInput value={d.budget.perLevel} min={0} onChange={(v) => set((x) => ({ budget: { ...x.budget, perLevel: v } }))} />
            </label>
            <label className="skills-field">
              {T.level}
              <NumberInput value={d.budget.level} min={0} onChange={(v) => set((x) => ({ budget: { ...x.budget, level: v } }))} />
            </label>
            <label className="skills-field">
              Name of points
              <input className="input skills-unit" value={d.budget.unit ?? ''} placeholder="points" onChange={(e) => set((x) => ({ budget: { ...x.budget, unit: e.target.value } }))} />
            </label>
            <span className={`skills-total${spent(d) > totalPoints(d) ? ' over' : ''}`}>{T.spent(spent(d), totalPoints(d), unit)}</span>
            <button className="btn btn-ghost" onClick={() => set(() => ({ plan: {}, classPlan: {}, inherited: [] }))}>
              <RotateCcw size={14} /> {T.reset}
            </button>
          </>
        ) : (
          <>
            {mode === 'edit' && (
              <div className="calc-segmented skills-mode" role="tablist" aria-label="Layout">
                <button className={!board ? 'on' : ''} onClick={() => set(() => ({ layout: 'tree' }))} title="Drawn from the Needs first links">
                  Tree
                </button>
                <button
                  className={board ? 'on' : ''}
                  title="A board of cells, like a sphere grid or license board: skills open next to learned ones"
                  onClick={() => set((x) => {
                    const skills = [...x.skills]
                    skills.forEach((s, i) => { if (!s.cell) skills[i] = { ...s, cell: freeCell(skills, BOARD_W) } })
                    return { layout: 'board', skills }
                  })}
                >
                  Board
                </button>
              </div>
            )}
            <span className="skills-total">{T.summary(d.skills.length, fullTreeCost(d.skills))}</span>
          </>
        )}
      </div>

      <div className="skills-body">
        <div className="skills-graph">
          {mode === 'classes' ? (
            classes.length === 0 ? (
              <p className="muted skills-empty">No archetypes yet. Make one with New archetype. Archetypes (jobs, classes) learn their skills by rank, and can need other archetypes at a rank first, like Warrior rank 20 before Gladiator.</p>
            ) : (
              <FlowGraph
                nodes={classes.map((c) => ({ id: c.id, label: c.name, sub: `${c.maxRank} ranks · ${d.skills.filter((s) => s.classId === c.id).length} skills`, color: c.color }))}
                edges={classes.flatMap((c) => c.requires.map((r) => ({ from: r.classId, to: c.id, label: `rank ${r.rank}` })))}
                selectedId={classId}
                onSelect={setClassId}
              />
            )
          ) : d.skills.length === 0 ? (
            <p className="muted skills-empty">{T.empty}</p>
          ) : board ? (
            <SkillBoard d={d} mode={mode} selectedId={selectedId} colorOf={colorOf} onSelect={(id) => { setSelectedId(id); if (mode === 'plan') setMessage(null) }} onEmpty={(cell) => (sel && mode === 'edit' ? edit(sel.id, { cell }) : mode === 'edit' && add(cell))} />
          ) : (
            <FlowGraph
              nodes={d.skills.map((s) => {
                const rank = s.classId ? (learned(d).includes(s) ? 1 : 0) : (d.plan[s.id] ?? 0)
                return {
                  id: s.id,
                  label: s.name || 'Untitled skill',
                  sub: s.classId
                    ? `${classes.find((c) => c.id === s.classId)?.name ?? '?'} rank ${Math.max(1, s.learnAt ?? 1)}`
                    : mode === 'plan' ? `${rank} / ${s.maxRank}` : `${s.maxRank > 1 ? `${s.maxRank} ranks · ` : ''}${s.cost} pt${s.cost === 1 ? '' : 's'}`,
                  color: colorOf(s),
                  muted: mode === 'plan' && rank === 0,
                }
              })}
              edges={d.skills.flatMap((s) => s.requires.map((r) => ({ from: r, to: s.id })))}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id)
                if (mode === 'plan' && id !== selectedId) setMessage(null)
              }}
            />
          )}
        </div>
        {mode === 'classes' ? (
          (() => {
            const c = classes.find((x) => x.id === classId)
            return c ? <ClassDetail c={c} classes={classes} skills={d.skills} edit={(p) => editClass(c.id, p)} onRemove={() => {
              set((x) => ({ classes: (x.classes ?? []).filter((o) => o.id !== c.id).map((o) => ({ ...o, requires: o.requires.filter((r) => r.classId !== c.id) })), skills: x.skills.map((s) => (s.classId === c.id ? { ...s, classId: undefined } : s)) }))
              setClassId(null)
            }} /> : null
          })()
        ) : mode === 'plan' ? (
          <aside className="skills-side">
            {classes.length > 0 && (
              <div className="skills-field">
                Archetype ranks
                {classes.map((c) => (
                  <div key={c.id} className="skills-rank">
                    <button className="icon-btn" aria-label={`Take back a ${c.name} rank`} onClick={() => rankClass(c.id, -1)}>
                      <Minus size={14} />
                    </button>
                    <span style={{ color: c.color }}>{c.name}</span> {d.classPlan?.[c.id] ?? 0} / {c.maxRank}
                    <button className="icon-btn" aria-label={`Add a ${c.name} rank`} onClick={() => rankClass(c.id, 1)}>
                      <Plus size={14} />
                    </button>
                  </div>
                ))}
                <label className="skills-field">
                  Wearing
                  <select className="input" value={d.equipped ?? ''} onChange={(e) => set(() => ({ equipped: e.target.value || null, inherited: [] }))}>
                    <option value="">Nothing</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {(() => {
                  const worn = classes.find((c) => c.id === d.equipped)
                  if (!worn || worn.inheritSlots <= 0) return null
                  const picked = d.inherited ?? []
                  return (
                    <div className="skills-field">
                      Inherited skills ({picked.length} of {worn.inheritSlots})
                      {inheritable(d).map((sk) => (
                        <label key={sk.id} className="skills-inline">
                          <input
                            type="checkbox"
                            checked={picked.includes(sk.id)}
                            disabled={!picked.includes(sk.id) && picked.length >= worn.inheritSlots}
                            onChange={(e) => set(() => ({ inherited: e.target.checked ? [...picked, sk.id] : picked.filter((x) => x !== sk.id) }))}
                          />
                          {sk.name}
                        </label>
                      ))}
                      {inheritable(d).length === 0 && <span className="muted">Learn inheritable skills in other archetypes first.</span>}
                    </div>
                  )
                })()}
              </div>
            )}
            {sel ? (
              <>
                <h3>{sel.name}</h3>
                {sel.effect && <p>{sel.effect}</p>}
                <div className="skills-rank">
                  <button className="icon-btn" aria-label="Take back a rank" title="Take back a rank" onClick={() => changeRank(sel.id, -1)}>
                    <Minus size={16} />
                  </button>
                  <strong>{T.rank(d.plan[sel.id] ?? 0, sel.maxRank)}</strong>
                  <button className="icon-btn" aria-label="Add a rank" title="Add a rank" onClick={() => changeRank(sel.id, 1)}>
                    <Plus size={16} />
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">{T.pick}</p>
            )}
            {message && <p className="skills-message">{message}</p>}
          </aside>
        ) : (
          sel && <SkillDetail s={sel} skills={d.skills} classes={classes} board={board} edit={(p) => edit(sel.id, p)} onRemove={() => void remove(sel)} onSelect={setSelectedId} onLoop={() => setMessage(T.loop)} message={message} />
        )}
      </div>
    </div>
  )
}

function SkillDetail({
  s,
  skills,
  classes,
  board,
  edit,
  onRemove,
  onSelect,
  onLoop,
  message,
}: {
  s: Skill
  skills: Skill[]
  classes: SkillClass[]
  board: boolean
  edit(p: Partial<Skill>): void
  onRemove(): void
  onSelect(id: Id): void
  onLoop(): void
  message: string | null
}) {
  const others = skills.filter((o) => o.id !== s.id && !s.requires.includes(o.id))
  const unlocks = skills.filter((o) => o.requires.includes(s.id))
  return (
    <aside className="skills-side">
      <div className="skills-detail-head">
        <div className="skills-image">
          <ImagePicker path={s.image} alt={s.name} onChange={(image) => edit({ image })} />
        </div>
        <label className="skills-field grow">
          {T.name}
          <input className="input" value={s.name} onChange={(e) => edit({ name: e.target.value })} />
        </label>
      </div>
      <label className="skills-field">
        {T.type}
        <select className="input" value={s.kind} onChange={(e) => edit({ kind: e.target.value as Skill['kind'] })}>
          {SKILL_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label className="skills-field">
        {T.effect}
        <input className="input" placeholder={T.effectHint} value={s.effect} onChange={(e) => edit({ effect: e.target.value })} />
      </label>
      {classes.length > 0 && (
        <div className="skills-row">
          <label className="skills-field">
            Belongs to
            <select className="input" value={s.classId ?? ''} onChange={(e) => edit({ classId: e.target.value || undefined })}>
              <option value="">No archetype (bought with points)</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {s.classId && (
            <label className="skills-field">
              Learned at rank
              <NumberInput value={s.learnAt ?? 1} min={1} onChange={(v) => edit({ learnAt: Math.max(1, Math.round(v)) })} />
            </label>
          )}
          {s.classId && (
            <label className="skills-inline">
              <input type="checkbox" checked={!!s.inheritable} onChange={(e) => edit({ inheritable: e.target.checked })} /> Other archetypes can inherit it
            </label>
          )}
        </div>
      )}
      {board && (
        <div className="skills-row">
          <label className="skills-inline">
            <input type="checkbox" checked={!!s.start} onChange={(e) => edit({ start: e.target.checked })} /> Start cell
          </label>
          <span className="muted">Click an empty cell to move it there.</span>
        </div>
      )}
      <div className="skills-row">
        <label className="skills-field">
          {T.maxRank}
          <NumberInput value={s.maxRank} min={1} onChange={(v) => edit({ maxRank: Math.max(1, Math.round(v)) })} />
        </label>
        <label className="skills-field">
          {T.cost}
          <NumberInput value={s.cost} min={0} onChange={(v) => edit({ cost: Math.max(0, v) })} />
        </label>
        <label className="skills-field">
          {T.pointsNeeded}
          <NumberInput value={s.pointsNeeded} min={0} onChange={(v) => edit({ pointsNeeded: Math.max(0, v) })} />
        </label>
      </div>
      <div className="skills-field">
        {T.requires}
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
              className="input"
              value=""
              onChange={(e) => {
                const id = e.target.value
                if (!id) return
                if (wouldLoop(skills, s.id, id)) return onLoop()
                edit({ requires: [...s.requires, id] })
              }}
            >
              <option value="">{T.addRequire}</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {s.requires.length > 1 && (
        <label className="skills-inline">
          <input type="checkbox" checked={!!s.requireAny} onChange={(e) => edit({ requireAny: e.target.checked })} /> Any one of these is enough
        </label>
      )}
      {unlocks.length > 0 && (
        <div className="skills-field">
          {T.unlocks}
          <div className="skills-chips">
            {unlocks.map((o) => (
              <button key={o.id} className="skills-link skills-chip" onClick={() => onSelect(o.id)}>
                {o.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="skills-field">
        {T.notes}
        <ProofTextarea className="input" rows={3} value={s.notes} onChange={(e) => edit({ notes: e.target.value })} />
      </label>
      {message && <p className="skills-message">{message}</p>}
      <button className="btn btn-danger skills-delete" onClick={onRemove}>
        <Trash2 size={14} /> {T.delete}
      </button>
    </aside>
  )
}

/** A board of cells (sphere grid, license board): skills open next to learned ones. */
function SkillBoard({
  d,
  mode,
  selectedId,
  colorOf,
  onSelect,
  onEmpty,
}: {
  d: SkillTreeDoc
  mode: string
  selectedId: Id | null
  colorOf(s: Skill): string | undefined
  onSelect(id: Id): void
  onEmpty(cell: { x: number; y: number }): void
}) {
  const placed = d.skills.filter((s) => s.cell)
  const w = Math.max(BOARD_W, ...placed.map((s) => s.cell!.x + 2))
  const h = Math.max(4, ...placed.map((s) => s.cell!.y + 2))
  const at = new Map(placed.map((s) => [`${s.cell!.x},${s.cell!.y}`, s]))
  return (
    <div className="skills-board" style={{ gridTemplateColumns: `repeat(${w}, 64px)` }}>
      {Array.from({ length: w * h }, (_, i) => {
        const x = i % w
        const y = Math.floor(i / w)
        const s = at.get(`${x},${y}`)
        if (!s)
          return <button key={i} className="skills-cell empty" aria-label={`Empty cell ${x + 1}, ${y + 1}`} onClick={() => onEmpty({ x, y })} disabled={mode !== 'edit'} />
        const rank = d.plan[s.id] ?? 0
        return (
          <button
            key={i}
            className={`skills-cell${s.id === selectedId ? ' on' : ''}${mode === 'plan' && rank === 0 ? ' off' : ''}${s.start ? ' start' : ''}`}
            style={{ borderColor: colorOf(s) }}
            title={s.effect || s.name}
            onClick={() => onSelect(s.id)}
          >
            <span>{s.name}</span>
            {mode === 'plan' && <small>{rank}/{s.maxRank}</small>}
          </button>
        )
      })}
    </div>
  )
}

function ClassDetail({ c, classes, skills, edit, onRemove }: { c: SkillClass; classes: SkillClass[]; skills: Skill[]; edit(p: Partial<SkillClass>): void; onRemove(): void }) {
  const [loop, setLoop] = useState(false)
  const others = classes.filter((o) => o.id !== c.id && !c.requires.some((r) => r.classId === o.id))
  const own = skills.filter((s) => s.classId === c.id).sort((a, b) => (a.learnAt ?? 1) - (b.learnAt ?? 1))
  return (
    <aside className="skills-side">
      <div className="skills-detail-head">
        <input type="color" value={c.color} onChange={(e) => edit({ color: e.target.value })} aria-label="Color" />
        <label className="skills-field grow">
          Name
          <input className="input" value={c.name} onChange={(e) => edit({ name: e.target.value })} />
        </label>
      </div>
      <div className="skills-row">
        <label className="skills-field">
          Max rank
          <NumberInput value={c.maxRank} min={1} onChange={(v) => edit({ maxRank: Math.max(1, Math.round(v)) })} />
        </label>
        <label className="skills-field">
          Cost to unlock
          <NumberInput value={c.unlockCost} min={0} onChange={(v) => edit({ unlockCost: Math.max(0, v) })} />
        </label>
        <label className="skills-field">
          Inherit slots
          <NumberInput value={c.inheritSlots} min={0} onChange={(v) => edit({ inheritSlots: Math.max(0, Math.round(v)) })} />
        </label>
      </div>
      <label className="skills-field">
        How it unlocks
        <input className="input" placeholder="e.g. Bond with a follower, rank 2" value={c.unlockNote} onChange={(e) => edit({ unlockNote: e.target.value })} />
      </label>
      <div className="skills-field">
        Needs first
        {c.requires.map((r) => (
          <div key={r.classId} className="skills-rank">
            <span>{classes.find((o) => o.id === r.classId)?.name ?? '?'} at rank</span>
            <NumberInput value={r.rank} min={1} onChange={(v) => edit({ requires: c.requires.map((x) => (x.classId === r.classId ? { ...x, rank: Math.max(1, Math.round(v)) } : x)) })} />
            <button className="icon-btn" aria-label="Remove" onClick={() => edit({ requires: c.requires.filter((x) => x.classId !== r.classId) })}>
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
              if (classLoop(classes, c.id, id)) return setLoop(true)
              setLoop(false)
              edit({ requires: [...c.requires, { classId: id, rank: classes.find((o) => o.id === id)?.maxRank ?? 1 }] })
            }}
          >
            <option value="">Add an archetype…</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        {loop && <p className="skills-message">That would make a loop: it would need itself.</p>}
      </div>
      <div className="skills-field">
        Skills ({own.length})
        {own.map((s) => (
          <span key={s.id} className="muted">
            Rank {Math.max(1, s.learnAt ?? 1)}: {s.name}
            {s.inheritable ? ' (inheritable)' : ''}
          </span>
        ))}
        {own.length === 0 && <span className="muted">Pick this archetype under Belongs to on a skill.</span>}
      </div>
      <button className="btn btn-danger skills-delete" onClick={onRemove}>
        <Trash2 size={14} /> Delete archetype
      </button>
    </aside>
  )
}
