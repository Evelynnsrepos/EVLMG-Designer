import { Flag as FlagIcon, Link2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { newId, type Entity } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { LineChart, NumberInput } from '@/shared/calculators'
import { jumpTo } from '@/shared/entityList'
import { toFlagName, useFlags } from '@/shared/flags'
import { pickJumpTarget, targetLabel } from '@/shared/jumps/Jumps'
import { Field, ListDetail, useItems } from '@/shared/listDetail'
import { ProofTextarea } from '@/shared/spell'
import { BOND_KINDS, createRelationshipsDoc, daysPerRank, MOODS, newBond, pointsPerDay, rankCost, rankTotals, RELATIONSHIPS_DOC, type Bond, type Mood, type RankCurve, type RelationshipsDoc } from './model'
import './relationships.css'

/** shortcut: plain weekday names; read the Calendar's own weekdays when someone asks for it. */
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const RULES = '__rules'

/** Relationships (missing tools phase 2). */
export default function View({ active }: PanelProps) {
  const doc = useDocument<RelationshipsDoc>(RELATIONSHIPS_DOC.type, RELATIONSHIPS_DOC.id, createRelationshipsDoc)
  const list = useItems<Bond, RelationshipsDoc>(RELATIONSHIPS_DOC.type, RELATIONSHIPS_DOC.id, createRelationshipsDoc)
  useUndoRedoKeys(doc, active)
  const characters = useProjectStore((s) => s.entities.character) as Entity[]
  const items = useProjectStore((s) => s.entities.item) as Entity[]
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (!doc.data) return null
  const d = doc.data
  const nameOf = (b: Bond) => characters.find((c) => c.id === b.characterId)?.name || (b.characterId ? '(deleted character)' : 'Pick a character')
  const b = list.items.find((x) => x.id === selectedId)

  const add = () => {
    const free = characters.find((c) => !d.items.some((x) => x.characterId === c.id))
    const n = newBond(free?.id ?? null)
    list.add(n)
    setSelectedId(n.id)
  }

  return (
    <ListDetail
      rows={list.items.map((x) => {
        const days = daysPerRank(x, d).at(-1)
        return { id: x.id, label: nameOf(x), sub: `${x.bondKind} · ${x.ranks} ranks${days !== undefined && Number.isFinite(days) ? ` · max in ${days} days` : ''}`, color: '#c2255c' }
      })}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onAdd={add}
      addLabel="New bond"
      empty={characters.length ? 'No bonds yet. Make one with New bond.' : 'No bonds yet. Add characters in the Character List, then make a bond with New bond.'}
      toolbar={
        <button className={`btn btn-ghost${selectedId === RULES ? ' on' : ''}`} onClick={() => setSelectedId(RULES)}>
          Points &amp; actions
        </button>
      }
    >
      {selectedId === RULES ? (
        <Rules d={d} update={(fn) => doc.update(fn)} />
      ) : (
        b && <BondPage b={b} d={d} name={nameOf(b)} characters={characters} items={items} edit={(p) => list.edit(b.id, p)} remove={() => (list.remove(b.id), setSelectedId(null))} />
      )}
    </ListDetail>
  )
}

function Rules({ d, update }: { d: RelationshipsDoc; update(fn: (d: RelationshipsDoc) => RelationshipsDoc): void }) {
  const editAction = (id: string, p: Partial<RelationshipsDoc['actions'][number]>) => update((x) => ({ ...x, actions: x.actions.map((a) => (a.id === id ? { ...a, ...p } : a)) }))
  return (
    <div className="ld-page">
      <h3>Points &amp; actions</h3>
      <p className="muted wide">These count for every bond. Per day is how often a player does it in one in-game day (0.2 = once every five days); it only feeds the plan.</p>
      <div className="ld-section">
        <strong>Actions that raise a bond</strong>
        {d.actions.map((a) => (
          <div key={a.id} className="ld-inline">
            <input className="input" value={a.name} onChange={(e) => editAction(a.id, { name: e.target.value })} aria-label="Action" />
            <label className="ld-inline">
              Points <NumberInput value={a.points} onChange={(points) => editAction(a.id, { points })} />
            </label>
            <label className="ld-inline">
              Per day <NumberInput value={a.perDay} min={0} onChange={(perDay) => editAction(a.id, { perDay })} />
            </label>
            <button className="btn btn-ghost" title="Remove" onClick={() => update((x) => ({ ...x, actions: x.actions.filter((y) => y.id !== a.id) }))}>
              ×
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => update((x) => ({ ...x, actions: [...x.actions, { id: newId(), name: 'New action', points: 10, perDay: 1 }] }))}>
          + Action
        </button>
      </div>
      <div className="ld-section">
        <strong>Gift points</strong>
        <div className="ld-inline">
          {MOODS.map((m) => (
            <label key={m.id} className="ld-field" style={{ width: 100 }}>
              <span style={{ color: m.color }}>{m.label}</span>
              <NumberInput value={d.moodPoints[m.id]} onChange={(v) => update((x) => ({ ...x, moodPoints: { ...x.moodPoints, [m.id]: v } }))} />
            </label>
          ))}
          <label className="ld-field" style={{ width: 120 }}>
            <span>Gifts per day</span>
            <NumberInput value={d.giftsPerDay} min={0} onChange={(giftsPerDay) => update((x) => ({ ...x, giftsPerDay }))} />
          </label>
        </div>
      </div>
    </div>
  )
}

function BondPage({ b, d, name, characters, items, edit, remove }: { b: Bond; d: RelationshipsDoc; name: string; characters: Entity[]; items: Entity[]; edit(p: Partial<Bond>): void; remove(): void }) {
  const flags = useFlags()
  const totals = rankTotals(b)
  const days = daysPerRank(b, d)
  const per = pointsPerDay(b, d)
  const setCurve = (p: Partial<RankCurve>) => edit({ curve: { ...b.curve, ...p } })
  const flag = flags.flags.find((f) => f.id === b.flagId)

  return (
    <div className="ld-page">
      <div className="wide ld-inline">
        <select className="input" style={{ flex: 1, fontSize: 18, fontWeight: 600 }} value={b.characterId ?? ''} onChange={(e) => edit({ characterId: e.target.value || null })} aria-label="Character">
          <option value="">{name}</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || 'Untitled'}
            </option>
          ))}
        </select>
      </div>
      <Field label="Bond">
        <input className="input" list="rel-kinds" value={b.bondKind} onChange={(e) => edit({ bondKind: e.target.value })} />
        <datalist id="rel-kinds">
          {BOND_KINDS.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </Field>
      <Field label="Ranks">
        <NumberInput value={b.ranks} min={1} max={100} onChange={(ranks) => edit({ ranks: Math.max(1, Math.round(ranks)) })} />
      </Field>
      <Field label="Points per rank">
        <select className="input" value={b.curve.mode} onChange={(e) => setCurve({ mode: e.target.value as RankCurve['mode'], custom: b.curve.custom.length ? b.curve.custom : totals.map((_, i) => rankCost(b.curve, i + 1)) })}>
          <option value="flat">Same for every rank</option>
          <option value="linear">A bit more each rank</option>
          <option value="growing">Grows by a percent</option>
          <option value="custom">Typed by hand</option>
        </select>
      </Field>
      {b.curve.mode !== 'custom' && (
        <Field label="First rank">
          <NumberInput value={b.curve.base} min={0} onChange={(base) => setCurve({ base })} />
        </Field>
      )}
      {(b.curve.mode === 'linear' || b.curve.mode === 'growing') && (
        <Field label={b.curve.mode === 'linear' ? 'More per rank' : 'Grows by %'}>
          <NumberInput value={b.curve.step} onChange={(step) => setCurve({ step })} />
        </Field>
      )}

      <div className="ld-section">
        <strong>Ranks</strong>
        <table className="calc-table rel-ranks">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Points</th>
              <th>Total</th>
              <th>Day</th>
              <th>Unlocks</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((t, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{b.curve.mode === 'custom' ? <NumberInput value={rankCost(b.curve, i + 1)} min={0} onChange={(v) => setCurve({ custom: totals.map((_, j) => (j === i ? v : rankCost(b.curve, j + 1))) })} /> : rankCost(b.curve, i + 1)}</td>
                <td>{t}</td>
                <td>{Number.isFinite(days[i]) ? days[i] : '–'}</td>
                <td className="muted">
                  {b.unlocks
                    .filter((u) => u.rank === i + 1)
                    .map((u) => u.text)
                    .join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ld-section">
        <strong>Plan</strong>
        <p className="muted">
          {per > 0 ? `${Math.round(per * 10) / 10} points a day with the actions and gifts under Points & actions: top rank on day ${days.at(-1)}.` : 'No points per day yet: set how often actions happen under Points & actions.'}
        </p>
        {per > 0 && totals.length > 1 && <LineChart xs={days.map((x) => (Number.isFinite(x) ? x : 0))} series={[{ name: 'Rank', values: totals.map((_, i) => i + 1) }]} xLabel="Days" />}
      </div>

      <div className="ld-section">
        <strong>Gifts</strong>
        {b.gifts.map((g, i) => (
          <div key={g.itemId} className="ld-inline">
            <span style={{ minWidth: 140 }}>{items.find((x) => x.id === g.itemId)?.name ?? '(deleted item)'}</span>
            <select className="input" value={g.mood} onChange={(e) => edit({ gifts: b.gifts.map((x, j) => (j === i ? { ...x, mood: e.target.value as Mood } : x)) })}>
              {MOODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({d.moodPoints[m.id] > 0 ? '+' : ''}
                  {d.moodPoints[m.id]})
                </option>
              ))}
            </select>
            <button className="btn btn-ghost" title="Remove" onClick={() => edit({ gifts: b.gifts.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
        {items.length ? (
          <select className="input" value="" onChange={(e) => e.target.value && edit({ gifts: [...b.gifts, { itemId: e.target.value, mood: 'like' }] })}>
            <option value="">Add an item from the Item List…</option>
            {items
              .filter((x) => !b.gifts.some((g) => g.itemId === x.id))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name || 'Untitled'}
                </option>
              ))}
          </select>
        ) : (
          <p className="muted">Add items in the Item List to pick gifts.</p>
        )}
      </div>

      <div className="ld-section">
        <strong>What each rank unlocks</strong>
        {b.unlocks.map((u, i) => (
          <div key={u.id} className="ld-inline">
            <label className="ld-inline">
              Rank <NumberInput value={u.rank} min={1} max={b.ranks} onChange={(rank) => edit({ unlocks: b.unlocks.map((x, j) => (j === i ? { ...x, rank: Math.round(rank) } : x)) })} />
            </label>
            <input className="input" style={{ flex: 1 }} value={u.text} onChange={(e) => edit({ unlocks: b.unlocks.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} aria-label="Unlocks" />
            {u.target ? (
              <button className="btn btn-ghost" title="Open" onClick={() => jumpTo(u.target!)}>
                <Link2 size={14} /> {targetLabel(u.target)}
              </button>
            ) : (
              <button
                className="btn btn-ghost"
                title="Link a quest, dialogue, ability or anything else"
                onClick={async () => {
                  const target = await pickJumpTarget('What does this rank unlock?')
                  if (target) edit({ unlocks: b.unlocks.map((x, j) => (j === i ? { ...x, target } : x)) })
                }}
              >
                <Link2 size={14} /> Link
              </button>
            )}
            <button className="btn btn-ghost" title="Remove" onClick={() => edit({ unlocks: b.unlocks.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => edit({ unlocks: [...b.unlocks, { id: newId(), rank: Math.min(b.ranks, (b.unlocks.at(-1)?.rank ?? 0) + 1), text: '', target: null }] })}>
          + Unlock
        </button>
      </div>

      <div className="ld-section">
        <strong>When they're free</strong>
        {b.free.map((f, i) => (
          <div key={f.id} className="ld-inline">
            <select className="input" value={f.day} onChange={(e) => edit({ free: b.free.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)) })}>
              {WEEKDAYS.map((w, k) => (
                <option key={w} value={k}>
                  {w}
                </option>
              ))}
            </select>
            <input className="input" type="time" value={f.from} onChange={(e) => edit({ free: b.free.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} aria-label="From" />
            <span>to</span>
            <input className="input" type="time" value={f.to} onChange={(e) => edit({ free: b.free.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} aria-label="To" />
            <button className="btn btn-ghost" title="Remove" onClick={() => edit({ free: b.free.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => edit({ free: [...b.free, { id: newId(), day: 0, from: '18:00', to: '21:00' }] })}>
          + Free time
        </button>
      </div>

      <div className="ld-section">
        <strong>Flag for dialogues and quests</strong>
        {flag ? (
          <p className="muted">
            <FlagIcon size={12} /> <code>{flag.name}</code> holds the bond's points. Dialogue Editor and Quests can check it, for example {flag.name} &gt;= {totals[Math.min(2, totals.length - 1)] ?? 0} for rank {Math.min(3, totals.length)}.
          </p>
        ) : (
          <button className="btn btn-ghost" onClick={() => edit({ flagId: flags.add(toFlagName(`bond ${name === 'Pick a character' ? 'new' : name}`), 'number').id })}>
            <FlagIcon size={14} /> Make a flag
          </button>
        )}
      </div>

      <Field label="Notes" wide>
        <ProofTextarea className="input" rows={3} value={b.notes} onChange={(e) => edit({ notes: e.target.value })} />
      </Field>
      <button className="btn btn-danger ld-danger" onClick={remove}>
        <Trash2 size={14} /> Delete bond
      </button>
    </div>
  )
}
