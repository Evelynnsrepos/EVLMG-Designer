import { AlertTriangle, Download, Eye, EyeOff, Lock, Plus, Settings2, Trash2, Trophy, X } from 'lucide-react'
import { strToU8, zipSync } from 'fflate'
import { useState, type ReactNode } from 'react'
import type { Id } from '@/core/model'
import { saveBinaryFile, saveTextFile } from '@/core/export/saveTextFile'
import type { PanelProps } from '@/core/registry'
import { useUndoRedoKeys } from '@/core/state'
import { NumberInput } from '@/shared/calculators'
import { toCSV } from '@/shared/csv'
import { ImagePicker } from '@/shared/entityList'
import { ConditionsEditor, describeCondition, useFlags, type Flag } from '@/shared/flags'
import { FlowGraph } from '@/shared/graph'
import { Field, ListDetail, useItems } from '@/shared/listDetail'
import { PixelSprite, SpritePicker } from '@/shared/pixel/PixelSprite'
import { ProofTextarea } from '@/shared/spell'
import {
  ACHIEVEMENT_KINDS,
  checks,
  createAchievementsDoc,
  kindColor,
  newAchievement,
  newField,
  newGroup,
  pointsByGroup,
  removeAchievement,
  SETUPS,
  settingsOf,
  suggestApiName,
  summary,
  toRows,
  treePack,
  wouldLoop,
  type Achievement,
  type AchievementKind,
  type AchievementSettings,
  type AchievementsDoc,
  type CustomField,
} from './model'
import './achievements.css'

/** How an achievement unlocks, in one line. */
function describeUnlock(a: Achievement, list: Achievement[], flags: Flag[]): string {
  const parts = [
    ...(a.needsAllOthers ? ['all other achievements'] : []),
    ...(a.needs ?? []).map((id) => list.find((x) => x.id === id)?.name ?? '?'),
    ...(a.when ?? []).map((c) => describeCondition(c, flags)),
  ]
  const joined = parts.join(a.match === 'any' ? ' or ' : ' and ')
  return joined || a.unlock || 'Not set yet'
}

/** Achievements (v0.10, flexible since v0.35): what players earn, how, and how it fits each platform. */
export default function View({ active }: PanelProps) {
  const list = useItems<Achievement, AchievementsDoc>('achievements', 'achievements', createAchievementsDoc)
  useUndoRedoKeys(list.doc, active)
  const { flags } = useFlags()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'overview' | 'tree'>('list')
  const [showSettings, setShowSettings] = useState(false)
  const [showChecks, setShowChecks] = useState(false)
  const s = settingsOf(list.doc.data)
  const items = list.items
  const a = items.find((x) => x.id === selectedId)
  const sum = summary(items)
  const problems = checks(items, s)
  const setSettings = (patch: Partial<AchievementSettings>) => list.doc.update((d) => ({ ...d, settings: { ...settingsOf(d), ...patch } }))
  const describe = (x: Achievement) => describeUnlock(x, items, flags)
  const open = (id: Id) => {
    setSelectedId(id)
    setView('list')
  }

  const exportCsv = () => void saveTextFile({ title: 'Export achievements', defaultName: 'achievements.csv', text: toCSV(toRows(items, s, describe)), filter: { name: 'CSV', extensions: ['csv'] } })
  const exportJson = () => void saveTextFile({ title: 'Export achievements', defaultName: 'achievements.json', text: JSON.stringify({ settings: s, achievements: items }, null, 2), filter: { name: 'JSON', extensions: ['json'] } })
  const exportPack = () => {
    const files = treePack(items, s)
    const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
    void saveBinaryFile({ title: 'Export data pack', defaultName: 'achievements-data-pack.zip', bytes, filter: { name: 'Zip', extensions: ['zip'] } })
  }

  const budget = s.budget
  const base = pointsByGroup(items).get(null) ?? 0
  const toolbar = (
    <>
      <div className="calc-segmented" role="tablist" aria-label="View">
        {(['list', 'overview', 'tree'] as const).map((v) => (
          <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
            {v === 'list' ? 'List' : v === 'overview' ? 'Overview' : 'Unlock tree'}
          </button>
        ))}
      </div>
      <span className="ach-stats">
        {sum.count} achievements · {sum.hidden} hidden
        {budget > 0 ? (
          <span className={`ach-budget${base > budget ? ' over' : ''}`} title={`${base} of ${budget} ${s.pointsName}`}>
            <i style={{ width: `${Math.min(100, (base / budget) * 100)}%` }} />
            <b>
              {base} / {budget} {s.pointsName}
            </b>
          </span>
        ) : (
          <>
            {' '}
            · {sum.points} {s.pointsName.toLowerCase()}
          </>
        )}
      </span>
      <span className="ach-spacer" />
      {problems.length > 0 && (
        <button className={`btn btn-ghost ach-fix${showChecks ? ' on' : ''}`} onClick={() => setShowChecks((v) => !v)} aria-pressed={showChecks}>
          <AlertTriangle size={14} /> {problems.length} to fix
        </button>
      )}
      <ExportMenu disabled={!items.length} onCsv={exportCsv} onJson={exportJson} onPack={s.tree ? exportPack : undefined} />
      <button className={`btn btn-ghost${showSettings ? ' on' : ''}`} onClick={() => setShowSettings((v) => !v)} aria-pressed={showSettings}>
        <Settings2 size={14} /> Settings
      </button>
    </>
  )
  const checkList = showChecks && problems.length > 0 && (
    <ul className="ach-checks">
      {problems.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  )
  const settingsPanel = showSettings && <SettingsPanel s={s} set={setSettings} onClose={() => setShowSettings(false)} />

  if (view !== 'list')
    return (
      <div className="ach-wide">
        <div className="ld-toolbar">
          <button className="btn btn-primary" onClick={() => open(addNew(list.add))}>
            <Plus size={14} /> New achievement
          </button>
          {toolbar}
        </div>
        <div className="ach-wide-body">
          <div className="ach-wide-main">
            {checkList}
            {view === 'overview' ? (
              <Overview items={items} s={s} describe={describe} onOpen={open} />
            ) : items.length ? (
              <FlowGraph
                nodes={items.map((x) => ({ id: x.id, label: x.name, sub: [x.grade, `${x.points} ${s.pointsName.toLowerCase()}`, x.needsAllOthers ? 'needs all others' : ''].filter(Boolean).join(' · '), color: kindColor(x.kind), muted: x.hidden }))}
                edges={[...items.flatMap((x) => (x.needs ?? []).map((r) => ({ from: r, to: x.id }))), ...items.filter((x) => x.parentId).map((x) => ({ from: x.parentId!, to: x.id, label: 'parent' }))]}
                selectedId={selectedId}
                onSelect={open}
              />
            ) : (
              <p className="muted ach-empty">No achievements yet.</p>
            )}
          </div>
          {settingsPanel}
        </div>
      </div>
    )

  return (
    <ListDetail
      rows={items.map((x) => ({
        id: x.id,
        label: `${x.hidden ? '🔒 ' : ''}${x.name}`,
        sub: [x.grade, `${x.points} ${s.pointsName.toLowerCase()}`, s.groups.find((g) => g.id === x.groupId)?.name].filter(Boolean).join(' · '),
        color: kindColor(x.kind),
      }))}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onAdd={() => setSelectedId(addNew(list.add))}
      addLabel="New achievement"
      empty="No achievements yet. Make one with New achievement. Settings sets up points, grades and fields for your platforms."
      toolbar={toolbar}
    >
      <div className="ach-split">
        <div className="ach-scroll">
          {checkList}
          {a ? (
            <Page
              a={a}
              items={items}
              s={s}
              edit={(p) => list.edit(a.id, p)}
              onOpen={setSelectedId}
              onDelete={() => {
                list.doc.update((d) => ({ ...d, items: removeAchievement(d.items, a.id) }))
                setSelectedId(null)
              }}
            />
          ) : (
            <p className="muted ach-empty">Pick an achievement on the left, or make a new one.</p>
          )}
        </div>
        {settingsPanel}
      </div>
    </ListDetail>
  )
}

function addNew(add: (a: Achievement) => void): Id {
  const n = newAchievement()
  add(n)
  return n.id
}

function ExportMenu({ disabled, onCsv, onJson, onPack }: { disabled: boolean; onCsv(): void; onJson(): void; onPack?: () => void }) {
  const [open, setOpen] = useState(false)
  const pick = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  return (
    <div className="ach-menu">
      <button className="btn btn-ghost" disabled={disabled} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Download size={14} /> Export
      </button>
      {open && (
        <div className="ach-menu-list" role="menu">
          <button role="menuitem" onClick={pick(onCsv)}>
            Spreadsheet (.csv)
            <small>For store and platform upload sheets</small>
          </button>
          <button role="menuitem" onClick={pick(onJson)}>
            Data (.json)
            <small>Everything, for your game or tools</small>
          </button>
          {onPack && (
            <button role="menuitem" onClick={pick(onPack)}>
              Data pack (.zip)
              <small>One file per achievement with parent and frame</small>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="ach-sec">
      <header>
        <h4>{title}</h4>
        {hint && <span className="muted">{hint}</span>}
      </header>
      <div className="ach-grid">{children}</div>
    </section>
  )
}

/** How the achievement looks to players, locked and unlocked. */
function Preview({ a, s }: { a: Achievement; s: AchievementSettings }) {
  const icon = a.sprite ? <PixelSprite sprite={a.sprite} size={44} /> : <Trophy size={22} />
  const badge = a.grade || `${a.points} ${s.pointsName === 'Points' ? 'pts' : s.pointsName}`
  return (
    <div className="ach-preview" aria-label="What players see">
      <div className="ach-toast locked">
        <div className="ach-toast-icon">{a.hidden ? <Lock size={20} /> : icon}</div>
        <div className="ach-toast-text">
          <strong>{a.hidden ? 'Hidden achievement' : a.name}</strong>
          <span>{a.hidden ? a.lockedDescription || 'Keep playing to find out.' : a.lockedDescription || a.description || 'No description yet'}</span>
        </div>
        <span className="ach-toast-tag">
          <EyeOff size={12} /> Locked
        </span>
      </div>
      <div className="ach-toast">
        <div className="ach-toast-icon on">{icon}</div>
        <div className="ach-toast-text">
          <strong>{a.name}</strong>
          <span>{a.description || 'No description yet'}</span>
        </div>
        <span className="ach-toast-tag on">
          <Eye size={12} /> {badge}
        </span>
      </div>
    </div>
  )
}

function Page({ a, items, s, edit, onOpen, onDelete }: { a: Achievement; items: Achievement[]; s: AchievementSettings; edit(p: Partial<Achievement>): void; onOpen(id: Id): void; onDelete(): void }) {
  const [loop, setLoop] = useState(false)
  const needs = a.needs ?? []
  const pickable = items.filter((o) => o.id !== a.id && !needs.includes(o.id))
  const link = (id: Id, then: () => void) => {
    if (wouldLoop(items, a.id, id)) return setLoop(true)
    setLoop(false)
    then()
  }
  const setCustom = (f: CustomField, v: string | number | boolean) => edit({ custom: { ...a.custom, [f.id]: v } })
  return (
    <div className="ach-page">
      <div className="ach-hero">
        <div className="ach-icon">{a.sprite ? <PixelSprite sprite={a.sprite} size={72} /> : <ImagePicker path={a.image} alt={a.name} onChange={(image) => edit({ image })} />}</div>
        <div className="ach-hero-main">
          <input className="input ach-title" value={a.name} onChange={(e) => edit({ name: e.target.value })} aria-label="Title" />
          <div className="ach-hero-row">
            <select className="input" value={a.kind} onChange={(e) => edit({ kind: e.target.value as AchievementKind })} aria-label="Category">
              {ACHIEVEMENT_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <SpritePicker sprite={a.sprite} onChange={(sprite) => edit({ sprite })} />
          </div>
        </div>
      </div>
      <Preview a={a} s={s} />

      <Section title="What players see">
        <Field label="Description, once unlocked" wide>
          <ProofTextarea className="input" rows={2} value={a.description} onChange={(e) => edit({ description: e.target.value })} />
        </Field>
        <Field label="Text while locked (optional)" wide>
          <input className="input" placeholder={a.hidden ? 'Keep playing to find out.' : 'Same as the description'} value={a.lockedDescription ?? ''} onChange={(e) => edit({ lockedDescription: e.target.value })} />
        </Field>
        <label className="ld-inline">
          <input type="checkbox" checked={a.hidden} onChange={(e) => edit({ hidden: e.target.checked })} /> Hidden until unlocked (no spoilers)
        </label>
      </Section>

      <Section title="When it unlocks" hint="Mix other achievements and game flags">
        <Field label="Unlocks when" wide>
          <select className="input" value={a.match ?? 'all'} onChange={(e) => edit({ match: e.target.value as 'all' | 'any' })}>
            <option value="all">all of these are true</option>
            <option value="any">any one of these is true</option>
          </select>
        </Field>
        <div className="ld-field wide">
          <span>Other achievements done first</span>
          <div className="ach-chips">
            <label className="ach-chip ach-chip-check">
              <input type="checkbox" checked={!!a.needsAllOthers} onChange={(e) => edit({ needsAllOthers: e.target.checked })} /> All others{s.groups.length ? ' in its group' : ''}
            </label>
            {needs.map((r) => (
              <span key={r} className="ach-chip">
                <button className="ach-link" onClick={() => onOpen(r)}>
                  {items.find((o) => o.id === r)?.name ?? '?'}
                </button>
                <button className="icon-btn" aria-label="Remove" onClick={() => edit({ needs: needs.filter((x) => x !== r) })}>
                  <X size={12} />
                </button>
              </span>
            ))}
            {pickable.length > 0 && (
              <select className="input ach-add" value="" onChange={(e) => e.target.value && link(e.target.value, () => edit({ needs: [...needs, e.target.value] }))} aria-label="Add an achievement">
                <option value="">+ Achievement…</option>
                {pickable.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div className="ld-field wide">
          <ConditionsEditor label="Game flags (counters and states, shared with quests and dialogue)" value={a.when ?? []} onChange={(when) => edit({ when })} />
        </div>
        <Field label="In words (for the team)" wide>
          <input className="input" placeholder="e.g. Defeat 100 slimes without taking damage" value={a.unlock} onChange={(e) => edit({ unlock: e.target.value })} />
        </Field>
        <label className="ld-inline">
          <input type="checkbox" checked={!!a.showProgress} onChange={(e) => edit({ showProgress: e.target.checked })} /> Show a progress bar
        </label>
        {a.showProgress && (
          <Field label="Steps to finish">
            <NumberInput value={a.goal} min={1} onChange={(goal) => edit({ goal: Math.max(1, Math.round(goal)) })} />
          </Field>
        )}
        {loop && <p className="ach-warn">That would make a loop: it would wait for itself.</p>}
      </Section>

      <Section title="Value and balance">
        <Field label={s.pointsName}>
          <NumberInput value={a.points} min={0} onChange={(points) => edit({ points })} />
        </Field>
        {s.grades.length > 0 && (
          <Field label="Grade">
            <select className="input" value={a.grade ?? ''} onChange={(e) => edit({ grade: e.target.value || undefined })}>
              <option value="">Not set</option>
              {s.grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
        )}
        {s.groups.length > 0 && (
          <Field label="Group">
            <select className="input" value={a.groupId ?? ''} onChange={(e) => edit({ groupId: e.target.value || null })}>
              <option value="">Base game</option>
              {s.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Players who get it (%)">
          <NumberInput value={a.expectedPercent} min={0} max={100} onChange={(expectedPercent) => edit({ expectedPercent })} />
        </Field>
        <Field label="Earned around hour">
          <NumberInput value={a.hour ?? 0} min={0} onChange={(v) => edit({ hour: v > 0 ? v : null })} />
        </Field>
        <Field label="Reward in the game" wide>
          <input className="input" placeholder="e.g. Title “Slime Bane”" value={a.reward} onChange={(e) => edit({ reward: e.target.value })} />
        </Field>
      </Section>

      <Section title="For the build" hint="Set up more in Settings">
        <Field label={s.needApiName ? 'API name' : 'API name (optional)'}>
          <div className="ach-inline">
            <input className="input" value={a.apiName ?? ''} placeholder={suggestApiName(a.name)} onChange={(e) => edit({ apiName: e.target.value })} />
            {!a.apiName && (
              <button className="btn btn-ghost" onClick={() => edit({ apiName: suggestApiName(a.name) })}>
                Use
              </button>
            )}
          </div>
        </Field>
        {s.tree && (
          <>
            <Field label="Hangs under">
              <select className="input" value={a.parentId ?? ''} onChange={(e) => (e.target.value ? link(e.target.value, () => edit({ parentId: e.target.value })) : edit({ parentId: null }))}>
                <option value="">Nothing (starts a tab)</option>
                {items
                  .filter((o) => o.id !== a.id)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </Field>
            {s.frames.length > 0 && (
              <Field label="Frame">
                <select className="input" value={a.frame ?? ''} onChange={(e) => edit({ frame: e.target.value || undefined })}>
                  <option value="">Not set</option>
                  {s.frames.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </>
        )}
        {s.fields.map((f) => (
          <CustomInput key={f.id} f={f} value={a.custom?.[f.id]} onChange={(v) => setCustom(f, v)} />
        ))}
      </Section>

      <button className="btn btn-danger ach-delete" onClick={onDelete}>
        <Trash2 size={14} /> Delete achievement
      </button>
    </div>
  )
}

function CustomInput({ f, value, onChange }: { f: CustomField; value: string | number | boolean | undefined; onChange(v: string | number | boolean): void }) {
  if (f.type === 'check')
    return (
      <label className="ld-inline">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {f.name}
      </label>
    )
  return (
    <Field label={f.name}>
      {f.type === 'number' ? (
        <NumberInput value={typeof value === 'number' ? value : 0} onChange={onChange} />
      ) : f.type === 'choice' ? (
        <select className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">Not set</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  )
}

/** All achievements in one table, with totals per group and grade. */
function Overview({ items, s, describe, onOpen }: { items: Achievement[]; s: AchievementSettings; describe(a: Achievement): string; onOpen(id: Id): void }) {
  const [sort, setSort] = useState<'hour' | 'points' | 'name' | 'percent'>('hour')
  const sorted = [...items].sort((x, y) =>
    sort === 'name' ? x.name.localeCompare(y.name) : sort === 'points' ? y.points - x.points : sort === 'percent' ? x.expectedPercent - y.expectedPercent : (x.hour ?? 1e9) - (y.hour ?? 1e9),
  )
  const groups = [{ id: null as Id | null, name: 'Base game', budget: s.budget }, ...s.groups]
  return (
    <div className="ach-overview">
      <div className="ach-totals">
        {groups.map((g) => {
          const mine = items.filter((x) => (x.groupId ?? null) === g.id)
          const pts = mine.reduce((n, x) => n + x.points, 0)
          return (
            <div key={g.id ?? 'base'} className="ach-total">
              <strong>{g.name}</strong>
              <span>
                {mine.length} achievements · {pts}
                {g.budget ? ` / ${g.budget}` : ''} {s.pointsName.toLowerCase()}
              </span>
              {s.grades.length > 0 && <span className="muted">{s.grades.map((gr) => `${mine.filter((x) => x.grade === gr).length} ${gr}`).join(' · ')}</span>}
            </div>
          )
        })}
        <label className="ld-inline ach-sort">
          Sort by
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="hour">When in the game</option>
            <option value="points">{s.pointsName}</option>
            <option value="percent">Rarest first</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <table className="ach-table">
        <thead>
          <tr>
            <th>Achievement</th>
            {s.grades.length > 0 && <th>Grade</th>}
            <th className="num">{s.pointsName}</th>
            {s.groups.length > 0 && <th>Group</th>}
            <th>Unlocks when</th>
            <th className="num">Hour</th>
            <th className="num">Players</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((x) => (
            <tr key={x.id} onClick={() => onOpen(x.id)}>
              <td>
                <span className="ld-dot" style={{ background: kindColor(x.kind) }} /> {x.hidden && <Lock size={12} />} {x.name}
              </td>
              {s.grades.length > 0 && <td>{x.grade ?? '–'}</td>}
              <td className="num">{x.points}</td>
              {s.groups.length > 0 && <td>{s.groups.find((g) => g.id === x.groupId)?.name ?? 'Base game'}</td>}
              <td className="muted">{describe(x)}</td>
              <td className="num">{x.hour ?? '–'}</td>
              <td className="num">{x.expectedPercent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && <p className="muted ach-empty">No achievements yet.</p>}
    </div>
  )
}

function SettingsPanel({ s, set, onClose }: { s: AchievementSettings; set(p: Partial<AchievementSettings>): void; onClose(): void }) {
  const editField = (id: Id, p: Partial<CustomField>) => set({ fields: s.fields.map((f) => (f.id === id ? { ...f, ...p } : f)) })
  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean)
  return (
    <aside className="ach-settings" aria-label="Achievement settings">
      <header>
        <h3>Settings</h3>
        <button className="icon-btn" aria-label="Close settings" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <section>
        <h4>Quick setup</h4>
        <p className="muted">Turns on what a platform asks for. Combine them and change anything after.</p>
        <div className="ach-setups">
          {SETUPS.map((x) => (
            <button key={x.id} className="ach-setup" onClick={() => set(x.apply(s))}>
              <strong>{x.label}</strong>
              <small>{x.note}</small>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h4>Points</h4>
        <div className="ach-grid">
          <Field label="Name for points">
            <input className="input" value={s.pointsName} onChange={(e) => set({ pointsName: e.target.value || 'Points' })} />
          </Field>
          <Field label="Base game budget (0 = none)">
            <NumberInput value={s.budget} min={0} onChange={(budget) => set({ budget: Math.max(0, Math.round(budget)) })} />
          </Field>
        </div>
      </section>
      <section>
        <h4>Grades</h4>
        <Field label="Lowest to highest, comma between (empty = none)" wide>
          <input className="input" defaultValue={s.grades.join(', ')} key={s.grades.join()} placeholder="Bronze, Silver, Gold" onBlur={(e) => set({ grades: list(e.target.value) })} />
        </Field>
        {s.grades.length > 0 && (
          <label className="ld-inline">
            <input type="checkbox" checked={s.topGradeNeedsAll} onChange={(e) => set({ topGradeNeedsAll: e.target.checked })} /> {s.grades[s.grades.length - 1]} is given once per group and needs all others
          </label>
        )}
      </section>
      <section>
        <h4>Groups</h4>
        <p className="muted">For add-ons, updates or seasons. Each can have its own budget.</p>
        {s.groups.map((g) => (
          <div key={g.id} className="ach-inline">
            <input className="input" value={g.name} onChange={(e) => set({ groups: s.groups.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)) })} aria-label="Group name" />
            <NumberInput value={g.budget} min={0} onChange={(v) => set({ groups: s.groups.map((x) => (x.id === g.id ? { ...x, budget: Math.max(0, Math.round(v)) } : x)) })} />
            <button className="icon-btn" aria-label={`Remove ${g.name}`} onClick={() => set({ groups: s.groups.filter((x) => x.id !== g.id) })}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => set({ groups: [...s.groups, newGroup()] })}>
          <Plus size={14} /> Add group
        </button>
      </section>
      <section>
        <h4>Structure</h4>
        <label className="ld-inline">
          <input type="checkbox" checked={s.needApiName} onChange={(e) => set({ needApiName: e.target.checked })} /> Every achievement needs an API name
        </label>
        <label className="ld-inline">
          <input type="checkbox" checked={s.tree} onChange={(e) => set({ tree: e.target.checked })} /> Tree with tabs: each achievement hangs under another
        </label>
        {s.tree && (
          <div className="ach-grid">
            <Field label="Frames, comma between">
              <input className="input" defaultValue={s.frames.join(', ')} key={s.frames.join()} placeholder="Task, Goal, Challenge" onBlur={(e) => set({ frames: list(e.target.value) })} />
            </Field>
            <Field label="Data pack folder name">
              <input className="input" value={s.namespace} onChange={(e) => set({ namespace: e.target.value })} />
            </Field>
          </div>
        )}
      </section>
      <section>
        <h4>Your own fields</h4>
        <p className="muted">Anything your platform or team needs, like a second icon, a store id or a voice line.</p>
        {s.fields.map((f) => (
          <div key={f.id} className="ach-field-row">
            <input className="input" value={f.name} onChange={(e) => editField(f.id, { name: e.target.value })} aria-label="Field name" />
            <select className="input" value={f.type} onChange={(e) => editField(f.id, { type: e.target.value as CustomField['type'] })} aria-label="Field type">
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="choice">Choice</option>
              <option value="check">Yes / no</option>
            </select>
            <button className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => set({ fields: s.fields.filter((x) => x.id !== f.id) })}>
              <X size={13} />
            </button>
            {f.type === 'choice' && <input className="input ach-options" defaultValue={f.options.join(', ')} key={f.options.join()} placeholder="Choices, comma between" onBlur={(e) => editField(f.id, { options: list(e.target.value) })} />}
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => set({ fields: [...s.fields, newField()] })}>
          <Plus size={14} /> Add field
        </button>
      </section>
    </aside>
  )
}
