import { Trash2 } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import type { Enemy } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { createAbilitiesDoc, type AbilitiesDoc, type Ability } from '@/components/abilities/model'
import { NumberInput } from '@/shared/calculators'
import { promptDialog } from '@/shared/dialogs'
import { ImagePicker } from '@/shared/entityList'
import { Field, ListDetail, useItems } from '@/shared/listDetail'
import { PixelSprite, SpritePicker } from '@/shared/pixel/PixelSprite'
import { ProofTextarea } from '@/shared/spell'
import { allElements, effectSummary, effectTotal, emptyStatusDoc, exampleStatusDoc, newEffect, newReaction, reactionFor, STATUS_DOC, type Reaction, type StatusDoc, type StatusEffect } from './model'
import './status-effects.css'

/** Status Effects & Reactions (missing tools phase 1). */
export default function View({ active }: PanelProps) {
  const doc = useDocument<StatusDoc>(STATUS_DOC.type, STATUS_DOC.id, emptyStatusDoc)
  const list = useItems<StatusEffect, StatusDoc>(STATUS_DOC.type, STATUS_DOC.id, emptyStatusDoc)
  useUndoRedoKeys(doc, active)
  const abilities = useItems<Ability, AbilitiesDoc>('abilities', 'abilities', createAbilitiesDoc).items
  const enemies = useProjectStore((s) => s.entities.enemy) as Enemy[]
  const [tab, setTab] = useState<'effects' | 'reactions'>('effects')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (!doc.data) return null
  const d = doc.data
  const e = list.items.find((x) => x.id === selectedId)
  const isEmpty = !d.items.length && !d.reactions.length
  const extra = [...abilities.map((a) => a.element), ...enemies.flatMap((x) => Object.keys(x.resistances ?? {}))]

  const add = () => {
    const n = newEffect()
    list.add(n)
    setSelectedId(n.id)
  }
  const remove = (id: string) => {
    doc.update((x) => ({
      ...x,
      items: x.items.filter((i) => i.id !== id).map((i) => (i.cancels.includes(id) ? { ...i, cancels: i.cancels.filter((c) => c !== id) } : i)),
      reactions: x.reactions.map((r) => (r.addsEffectId === id ? { ...r, addsEffectId: null } : r)),
    }))
    setSelectedId(null)
  }

  return (
    <div className="se-wrap">
      <div className="se-tabs">
        <button className={`btn btn-ghost${tab === 'effects' ? ' on' : ''}`} onClick={() => setTab('effects')}>
          Effects
        </button>
        <button className={`btn btn-ghost${tab === 'reactions' ? ' on' : ''}`} onClick={() => setTab('reactions')}>
          Reactions
        </button>
        {isEmpty && (
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => doc.update(() => exampleStatusDoc())}>
            Start with examples (Burn, Wet, Freeze…)
          </button>
        )}
      </div>
      {tab === 'effects' ? (
        <ListDetail
          rows={list.items.map((x) => ({ id: x.id, label: x.name, sub: effectSummary(x), color: x.good ? '#2f9e44' : '#e03131' }))}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAdd={add}
          addLabel="New effect"
          empty="No effects yet. Make one with New effect, or start with the examples."
        >
          {e && <EffectPage e={e} all={list.items} edit={(p) => list.edit(e.id, p)} remove={() => remove(e.id)} />}
        </ListDetail>
      ) : (
        <Reactions d={d} elements={allElements(d, extra)} update={(fn) => doc.update(fn)} />
      )}
    </div>
  )
}

function EffectPage({ e, all, edit, remove }: { e: StatusEffect; all: StatusEffect[]; edit(p: Partial<StatusEffect>): void; remove(): void }) {
  const one = effectTotal(e, 1)
  const max = effectTotal(e, e.maxStacks)
  return (
    <div className="ld-page">
      <div className="wide ld-inline">
        <div style={{ width: 72 }}>
          {e.sprite ? <PixelSprite sprite={e.sprite} size={96} /> : <ImagePicker path={e.image} alt={e.name} onChange={(image) => edit({ image })} />}
          <SpritePicker sprite={e.sprite} onChange={(sprite) => edit({ sprite })} />
        </div>
        <input className="input" style={{ flex: 1, fontSize: 18, fontWeight: 600 }} value={e.name} onChange={(x) => edit({ name: x.target.value })} aria-label="Name" />
      </div>
      <Field label="It">
        <select className="input" value={e.good ? 'good' : 'bad'} onChange={(x) => edit({ good: x.target.value === 'good' })}>
          <option value="bad">Hurts (debuff)</option>
          <option value="good">Helps (buff)</option>
        </select>
      </Field>
      <Field label="Lasts (s)">
        <NumberInput value={e.seconds} min={0} onChange={(seconds) => edit({ seconds })} />
      </Field>
      <Field label="Element">
        <input className="input" placeholder="e.g. Fire" value={e.element} onChange={(x) => edit({ element: x.target.value })} />
      </Field>
      <Field label="Stacks up to">
        <NumberInput value={e.maxStacks} min={1} onChange={(maxStacks) => edit({ maxStacks: Math.max(1, Math.round(maxStacks)) })} />
      </Field>
      <Field label="Lands again">
        <select className="input" value={e.stacking} onChange={(x) => edit({ stacking: x.target.value as StatusEffect['stacking'] })}>
          <option value="refresh">Timer starts over</option>
          <option value="stronger">One more stack, timer starts over</option>
          <option value="ignore">Nothing happens</option>
        </select>
      </Field>
      <Field label="Can't act">
        <input type="checkbox" checked={e.stops} onChange={(x) => edit({ stops: x.target.checked })} title="Stun, freeze, sleep: the target skips its turns" />
      </Field>

      <div className="ld-section">
        <strong>Every few seconds</strong>
        <label className="ld-inline">
          <input type="checkbox" checked={!!e.tick} onChange={(x) => edit({ tick: x.target.checked ? { amount: 5, every: 1, heal: e.good } : null })} /> Damages or heals over time
        </label>
        {e.tick && (
          <div className="ld-inline">
            <select className="input" value={e.tick.heal ? 'heal' : 'dmg'} onChange={(x) => edit({ tick: { ...e.tick!, heal: x.target.value === 'heal' } })}>
              <option value="dmg">Damage</option>
              <option value="heal">Healing</option>
            </select>
            <NumberInput value={e.tick.amount} min={0} onChange={(amount) => edit({ tick: { ...e.tick!, amount } })} />
            <span>every</span>
            <NumberInput value={e.tick.every} min={0.1} onChange={(every) => edit({ tick: { ...e.tick!, every } })} />
            <span>s, per stack</span>
          </div>
        )}
      </div>

      <div className="ld-section">
        <strong>Stat changes while active (per stack)</strong>
        {e.stats.map((s, i) => (
          <div key={i} className="ld-inline">
            <select className="input" value={s.stat} onChange={(x) => edit({ stats: e.stats.map((y, j) => (j === i ? { ...y, stat: x.target.value } : y)) })}>
              {['ATK', 'DEF', 'SPD', 'CRIT'].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <NumberInput value={s.percent} onChange={(percent) => edit({ stats: e.stats.map((y, j) => (j === i ? { ...y, percent } : y)) })} />
            <span>%</span>
            <button className="btn btn-ghost" title="Remove" onClick={() => edit({ stats: e.stats.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => edit({ stats: [...e.stats, { stat: 'SPD', percent: -20 }] })}>
          + Stat change
        </button>
      </div>

      <div className="ld-section">
        <strong>Removes these when it lands</strong>
        <div className="ld-inline">
          {e.cancels.map((id) => (
            <button key={id} className="btn btn-ghost" title="Remove" onClick={() => edit({ cancels: e.cancels.filter((c) => c !== id) })}>
              {all.find((x) => x.id === id)?.name ?? '(deleted)'} ×
            </button>
          ))}
          <select className="input" value="" onChange={(x) => x.target.value && edit({ cancels: [...e.cancels, x.target.value] })}>
            <option value="">Add an effect…</option>
            {all
              .filter((x) => x.id !== e.id && !e.cancels.includes(x.id))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <Field label="Description" wide>
        <ProofTextarea className="input" rows={3} value={e.description} onChange={(x) => edit({ description: x.target.value })} />
      </Field>
      <p className="se-try wide">
        {effectSummary(e)}
        {e.tick && e.maxStacks > 1 && ` · at ${e.maxStacks} stacks: ${max.total} over ${max.ticks} ticks`}
        {e.tick && e.maxStacks <= 1 && ` · ${one.ticks} ticks`}
      </p>
      <button className="btn btn-danger ld-danger" onClick={remove}>
        <Trash2 size={14} /> Delete effect
      </button>
    </div>
  )
}

/** The grid: rows = element already on the target, columns = element of the hit. Arrow keys move, Enter edits, Delete clears. */
function Reactions({ d, elements, update }: { d: StatusDoc; elements: string[]; update(fn: (d: StatusDoc) => StatusDoc): void }) {
  const [cell, setCell] = useState<[string, string] | null>(null)
  const r = cell ? reactionFor(d, cell[0], cell[1]) : undefined
  const edit = (id: string, p: Partial<Reaction>) => update((x) => ({ ...x, reactions: x.reactions.map((y) => (y.id === id ? { ...y, ...p } : y)) }))
  const open = (first: string, second: string) => {
    setCell([first, second])
    if (!reactionFor(d, first, second)) update((x) => ({ ...x, reactions: [...x.reactions, newReaction(first, second)] }))
  }
  const clear = (first: string, second: string) => {
    const found = reactionFor(d, first, second)
    if (found) update((x) => ({ ...x, reactions: x.reactions.filter((y) => y.id !== found.id) }))
  }
  const addElement = async () => {
    const name = (await promptDialog('New element', ''))?.trim()
    if (name && !elements.some((x) => x.toLowerCase() === name.toLowerCase())) update((x) => ({ ...x, elements: [...x.elements, name] }))
  }
  const onKey = (ev: KeyboardEvent<HTMLButtonElement>, row: number, col: number) => {
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (moves[ev.key]) {
      ev.preventDefault()
      const [dr, dc] = moves[ev.key]
      const next = ev.currentTarget.closest('table')?.querySelector<HTMLButtonElement>(`[data-cell="${row + dr}-${col + dc}"]`)
      next?.focus()
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault()
      clear(elements[row], elements[col])
    }
  }

  return (
    <div className="se-react">
      <p className="muted">
        What happens when an element hits a target that already carries another one. Rows: on the target. Columns: the hit. Click a cell (or move with the arrow keys and press Enter) to make a reaction; Delete clears it.
      </p>
      {elements.length === 0 ? (
        <p className="muted">No elements yet. Give abilities an element, or add one here.</p>
      ) : (
        <table className="se-grid">
          <thead>
            <tr>
              <th>on target ↓ / hit →</th>
              {elements.map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {elements.map((first, row) => (
              <tr key={first}>
                <th>{first}</th>
                {elements.map((second, col) => {
                  const found = reactionFor(d, first, second)
                  const on = cell && cell[0] === first && cell[1] === second
                  return (
                    <td key={second}>
                      <button data-cell={`${row}-${col}`} className={`${on ? 'on' : ''}${found ? '' : ' empty'}`} onClick={() => open(first, second)} onKeyDown={(ev) => onKey(ev, row, col)} title={`${first} then ${second}`}>
                        {found ? `${found.name} ×${found.multiplier}` : '·'}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div>
        <button className="btn btn-ghost" onClick={addElement}>
          + Element
        </button>
      </div>
      {r && (
        <div className="ld-page">
          <h3>
            {r.first} then {r.second}
          </h3>
          <Field label="Name">
            <input className="input" value={r.name} onChange={(x) => edit(r.id, { name: x.target.value })} />
          </Field>
          <Field label="Damage ×">
            <NumberInput value={r.multiplier} min={0} onChange={(multiplier) => edit(r.id, { multiplier })} />
          </Field>
          <Field label="Adds effect">
            <select className="input" value={r.addsEffectId ?? ''} onChange={(x) => edit(r.id, { addsEffectId: x.target.value || null })}>
              <option value="">None</option>
              {d.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Uses up ${r.first}`}>
            <input type="checkbox" checked={r.consumes} onChange={(x) => edit(r.id, { consumes: x.target.checked })} />
          </Field>
          <Field label="Description" wide>
            <ProofTextarea className="input" rows={2} value={r.description} onChange={(x) => edit(r.id, { description: x.target.value })} />
          </Field>
          <button
            className="btn btn-danger ld-danger"
            onClick={() => {
              clear(r.first, r.second)
              setCell(null)
            }}
          >
            <Trash2 size={14} /> Delete reaction
          </button>
        </div>
      )}
    </div>
  )
}
