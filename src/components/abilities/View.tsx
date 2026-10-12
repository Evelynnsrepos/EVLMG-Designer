import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Entity } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useProjectStore, useUndoRedoKeys } from '@/core/state'
import { NumberInput, useDamagePresets } from '@/shared/calculators'
import { ImagePicker } from '@/shared/entityList'
import { PixelSprite, SpritePicker } from '@/shared/pixel/PixelSprite'
import { formatNumber, libraryFor } from '@/shared/formulas'
import { Field, ListDetail, useItems } from '@/shared/listDetail'
import { ProofTextarea } from '@/shared/spell'
import { ABILITY_KINDS, abilityFormula, abilityStats, createAbilitiesDoc, kindColor, newAbility, type Ability, type AbilitiesDoc, type AbilityKind } from './model'

/** Ability / spell list (v0.10): skills with costs and cooldowns, their numbers from Damage Calculator formulas. */
export default function View({ active }: PanelProps) {
  const list = useItems<Ability, AbilitiesDoc>('abilities', 'abilities', createAbilitiesDoc)
  useUndoRedoKeys(list.doc, active)
  const presets = useDamagePresets()
  const characters = useProjectStore((s) => s.entities.character) as Entity[]
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [table, setTable] = useState(false)
  const a = list.items.find((x) => x.id === selectedId)
  const fmt = (v: number | null) => (v === null ? '–' : formatNumber(v))

  const add = () => {
    const n = newAbility()
    list.add(n)
    setSelectedId(n.id)
    setTable(false)
  }

  return (
    <ListDetail
      rows={list.items.map((x) => ({ id: x.id, label: x.name, sub: [ABILITY_KINDS.find((k) => k.id === x.kind)?.label, x.element, `${fmt(abilityStats(x, presets).value)}`].filter(Boolean).join(' · '), color: kindColor(x.kind) }))}
      selectedId={selectedId}
      onSelect={(id) => {
        setSelectedId(id)
        setTable(false)
      }}
      onAdd={add}
      addLabel="New ability"
      empty="No abilities yet. Make one with New ability."
      toolbar={
        <label className="ld-inline">
          <input type="checkbox" checked={table} onChange={(e) => setTable(e.target.checked)} /> Compare all in a table
        </label>
      }
    >
      {table ? (
        <AbilityTable items={list.items} presets={presets} onOpen={(id) => (setSelectedId(id), setTable(false))} />
      ) : (
        a && <AbilityPage a={a} edit={(p) => list.edit(a.id, p)} remove={() => (list.remove(a.id), setSelectedId(null))} presets={presets} characters={characters} />
      )}
    </ListDetail>
  )
}

function AbilityTable({ items, presets, onOpen }: { items: Ability[]; presets: ReturnType<typeof useDamagePresets>; onOpen(id: string): void }) {
  const [sort, setSort] = useState<'name' | 'value' | 'dps' | 'perCost'>('dps')
  const rows = items.map((a) => ({ a, s: abilityStats(a, presets) }))
  const key = (r: (typeof rows)[number]) => (sort === 'name' ? 0 : sort === 'value' ? (r.s.value ?? -Infinity) : sort === 'dps' ? (r.s.perSecond ?? -Infinity) : (r.s.perCost ?? -Infinity))
  rows.sort((x, y) => (sort === 'name' ? x.a.name.localeCompare(y.a.name) : key(y) - key(x)))
  const th = (id: typeof sort, label: string) => (
    <th className={sort === id ? 'on' : ''} onClick={() => setSort(id)}>
      {label}
    </th>
  )
  return (
    <table className="calc-table ab-table">
      <thead>
        <tr>
          {th('name', 'Ability')}
          <th>Type</th>
          {th('value', 'Value')}
          <th>Cooldown</th>
          <th>Cost</th>
          {th('dps', 'Per second')}
          {th('perCost', 'Per cost')}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ a, s }) => (
          <tr key={a.id} onClick={() => onOpen(a.id)}>
            <td style={{ color: kindColor(a.kind) }}>{a.name}</td>
            <td>{ABILITY_KINDS.find((k) => k.id === a.kind)?.label}</td>
            <td>{s.value === null ? '–' : formatNumber(s.value)}</td>
            <td>{a.cooldown}s</td>
            <td>{a.cost ? `${a.cost} ${a.costResource}` : '–'}</td>
            <td>{s.perSecond === null ? '–' : formatNumber(s.perSecond)}</td>
            <td>{s.perCost === null ? '–' : formatNumber(s.perCost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AbilityPage({
  a,
  edit,
  remove,
  presets,
  characters,
}: {
  a: Ability
  edit(p: Partial<Ability>): void
  remove(): void
  presets: ReturnType<typeof useDamagePresets>
  characters: Entity[]
}) {
  const stats = abilityStats(a, presets)
  const formula = abilityFormula(a, presets)
  const names = formula ? Object.keys(formula.values) : []
  return (
    <div className="ld-page">
      <div className="wide ld-inline">
        <div style={{ width: 72 }}>
          <>
            {a.sprite ? <PixelSprite sprite={a.sprite} size={96} /> : <ImagePicker path={a.image} alt={a.name} onChange={(image) => edit({ image })} />}
            <SpritePicker sprite={a.sprite} onChange={(sprite) => edit({ sprite })} />
          </>
        </div>
        <input className="input" style={{ flex: 1, fontSize: 18, fontWeight: 600 }} value={a.name} onChange={(e) => edit({ name: e.target.value })} aria-label="Name" />
      </div>
      <Field label="Type">
        <select className="input" value={a.kind} onChange={(e) => edit({ kind: e.target.value as AbilityKind })}>
          {ABILITY_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Element">
        <input className="input" placeholder="e.g. Fire" value={a.element} onChange={(e) => edit({ element: e.target.value })} />
      </Field>
      <Field label="Range">
        <input className="input" placeholder="e.g. 8 m, melee, self" value={a.range} onChange={(e) => edit({ range: e.target.value })} />
      </Field>
      <Field label="Cost">
        <div className="ld-inline">
          <NumberInput value={a.cost} min={0} onChange={(cost) => edit({ cost })} />
          <input className="input" style={{ width: 90 }} value={a.costResource} onChange={(e) => edit({ costResource: e.target.value })} aria-label="Cost resource" />
        </div>
      </Field>
      <Field label="Cooldown (s)">
        <NumberInput value={a.cooldown} min={0} onChange={(cooldown) => edit({ cooldown })} />
      </Field>
      <Field label="Cast time (s)">
        <NumberInput value={a.castTime} min={0} onChange={(castTime) => edit({ castTime })} />
      </Field>
      <Field label="Description" wide>
        <ProofTextarea className="input" rows={3} value={a.description} onChange={(e) => edit({ description: e.target.value })} />
      </Field>

      <div className="ld-section">
        <strong>Formula</strong>
        <div className="ld-inline">
          <select className="input" value={a.source} onChange={(e) => edit({ source: e.target.value as Ability['source'], values: {} })}>
            <option value="none">No number</option>
            <option value="formula">Formula from the library</option>
            <option value="preset">Damage Calculator preset</option>
          </select>
          {a.source === 'formula' && (
            <select className="input" value={a.formulaId} onChange={(e) => edit({ formulaId: e.target.value, values: {} })}>
              {libraryFor('damage').map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {g.formulas.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          {a.source === 'preset' && (
            <select className="input" value={a.presetId ?? ''} onChange={(e) => edit({ presetId: e.target.value || null, values: {} })}>
              <option value="">Pick a preset…</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
        </div>
        {formula && (
          <div className="ld-inline">
            {names.map((n) => (
              <label key={n} className="ld-field" style={{ width: 110 }}>
                <span>{n}</span>
                <NumberInput value={formula.values[n]} onChange={(v) => edit({ values: { ...a.values, [n]: v } })} />
              </label>
            ))}
          </div>
        )}
        {stats.error ? (
          <p className="muted">{stats.error}</p>
        ) : (
          stats.value !== null && (
            <div className="ld-result">
              <div className="ld-stat">
                <span>Value</span>
                <strong>{formatNumber(stats.value)}</strong>
              </div>
              <div className="ld-stat">
                <span>Per second</span>
                <strong>{stats.perSecond === null ? '–' : formatNumber(stats.perSecond)}</strong>
              </div>
              <div className="ld-stat">
                <span>Per {a.costResource || 'cost'}</span>
                <strong>{stats.perCost === null ? '–' : formatNumber(stats.perCost)}</strong>
              </div>
            </div>
          )
        )}
      </div>

      <div className="ld-section">
        <strong>Who can use it</strong>
        <div className="ld-inline">
          {a.users.map((id) => (
            <button key={id} className="btn btn-ghost" onClick={() => edit({ users: a.users.filter((u) => u !== id) })} title="Remove">
              {characters.find((c) => c.id === id)?.name ?? '(deleted)'} ×
            </button>
          ))}
          <select className="input" value="" onChange={(e) => e.target.value && edit({ users: [...a.users, e.target.value] })}>
            <option value="">Add a character…</option>
            {characters
              .filter((c) => !a.users.includes(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || 'Untitled'}
                </option>
              ))}
          </select>
        </div>
      </div>
      <button className="btn btn-danger ld-danger" onClick={remove}>
        <Trash2 size={14} /> Delete ability
      </button>
    </div>
  )
}
