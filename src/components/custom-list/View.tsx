import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ENTITY_TYPES, type Entity, type EntityType } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { NumberInput } from '@/shared/calculators'
import { ImagePicker, openEntity } from '@/shared/entityList'
import { Field, ListDetail } from '@/shared/listDetail'
import { ProofTextarea } from '@/shared/spell'
import { changeKind, createCustomListDoc, fromTemplate, TEMPLATES, FIELD_KINDS, newField, newRecord, type CustomField, type CustomListDoc, type CustomRecord, type EntryRef, type FieldKind, type FieldValue } from './model'
import './custom-list.css'

const TYPE_LABEL: Record<EntityType, string> = { item: 'Item', character: 'Character', town: 'Town', enemy: 'Enemy' }

/** Custom List (0.28): entries of your own kind, with your own fields. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<CustomListDoc>('custom-list', documentId!, createCustomListDoc)
  useUndoRedoKeys(doc, active)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'entries' | 'fields'>('entries')
  if (!doc.data) return null
  const d = doc.data
  const set = (fn: (d: CustomListDoc) => CustomListDoc) => doc.update(fn)
  const editRecord = (id: string, patch: Partial<CustomRecord>) => set((x) => ({ ...x, items: x.items.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
  const r = d.items.find((x) => x.id === selectedId)
  const firstText = d.fields.find((f) => f.kind === 'text' || f.kind === 'choice' || f.kind === 'number')

  const tabs = (
    <span className="cl-tabs">
      <button className={`btn btn-ghost${tab === 'entries' ? ' active' : ''}`} onClick={() => setTab('entries')}>
        Entries ({d.items.length})
      </button>
      <button className={`btn btn-ghost${tab === 'fields' ? ' active' : ''}`} onClick={() => setTab('fields')}>
        Fields ({d.fields.length})
      </button>
      {d.items.length === 0 && (
        <select className="input" style={{ width: 'auto' }} value="" aria-label="Start from a template" onChange={(e) => e.target.value && set(() => fromTemplate(e.target.value))}>
          <option value="">Start from a template…</option>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      )}
    </span>
  )

  if (tab === 'fields') return <FieldsEditor d={d} set={set} tabs={tabs} />

  return (
    <ListDetail
      rows={d.items.map((x) => ({ id: x.id, label: x.name, sub: firstText ? show(x.values[firstText.id], firstText) : '' }))}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onAdd={() => {
        const n = newRecord(`New ${d.one}`)
        set((x) => ({ ...x, items: [...x.items, n] }))
        setSelectedId(n.id)
      }}
      addLabel={`New ${d.one}`}
      empty={`No ${d.one} yet. Set up the fields this kind of entry needs under Fields, then add the first one.`}
      toolbar={tabs}
    >
      {r && (
        <div className="ld-page">
          <div className="wide ld-inline">
            <div style={{ width: 96, flex: 'none' }}>
              <ImagePicker path={r.image} alt={r.name} onChange={(image) => editRecord(r.id, { image })} />
            </div>
            <input className="input" style={{ flex: 1, fontSize: 18, fontWeight: 600 }} value={r.name} onChange={(e) => editRecord(r.id, { name: e.target.value })} aria-label="Name" />
          </div>
          {d.fields.map((f) => (
            <Field key={f.id} label={f.unit ? `${f.name} (${f.unit})` : f.name} wide={f.kind === 'long' || f.kind === 'entries' || f.kind === 'picture'}>
              <ValueInput field={f} value={r.values[f.id] ?? null} onChange={(v) => editRecord(r.id, { values: { ...r.values, [f.id]: v } })} />
            </Field>
          ))}
          <button
            className="btn btn-danger ld-danger"
            onClick={() => {
              set((x) => ({ ...x, items: x.items.filter((o) => o.id !== r.id) }))
              setSelectedId(null)
            }}
          >
            <Trash2 size={14} /> Delete {d.one}
          </button>
        </div>
      )}
    </ListDetail>
  )
}

/** Short text of a value for the list. */
function show(v: FieldValue | undefined, f: CustomField): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number') return `${v}${f.unit ? ` ${f.unit}` : ''}`
  if (typeof v === 'object') return ''
  return String(v)
}

function useEntries() {
  const entities = useProjectStore((s) => s.entities)
  return useMemo(() => ENTITY_TYPES.flatMap((t) => (entities[t] as Entity[]).map((e) => ({ type: t, id: e.id, name: e.name }))).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)), [entities])
}

function EntryPick({ value, onPick, skip = [] }: { value: EntryRef | null; onPick(r: EntryRef | null): void; skip?: EntryRef[] }) {
  const all = useEntries()
  const key = (r: EntryRef) => `${r.type}:${r.id}`
  const skipped = new Set(skip.map(key))
  return (
    <select className="input" value={value ? key(value) : ''} onChange={(e) => onPick(e.target.value ? (all.find((x) => key(x) === e.target.value) ?? null) : null)}>
      <option value="">{value ? 'None' : 'Pick an item, character, town or enemy…'}</option>
      {all
        .filter((x) => !skipped.has(key(x)))
        .map((x) => (
          <option key={key(x)} value={key(x)}>
            {TYPE_LABEL[x.type]}: {x.name}
          </option>
        ))}
    </select>
  )
}

function EntryChip({ r, onRemove }: { r: EntryRef; onRemove?(): void }) {
  const all = useEntries()
  const name = all.find((x) => x.type === r.type && x.id === r.id)?.name ?? '(deleted)'
  return (
    <span className="cl-chip">
      <button className="cl-chip-name" onClick={() => openEntity(r.type, r.id)}>
        {TYPE_LABEL[r.type]}: {name}
      </button>
      {onRemove && (
        <button className="icon-btn" aria-label={`Remove ${name}`} onClick={onRemove}>
          <X size={11} />
        </button>
      )}
    </span>
  )
}

function ValueInput({ field: f, value, onChange }: { field: CustomField; value: FieldValue; onChange(v: FieldValue): void }) {
  switch (f.kind) {
    case 'long':
      return <ProofTextarea className="input" rows={3} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
    case 'number':
      return <NumberInput value={typeof value === 'number' ? value : 0} onChange={(n) => onChange(n)} />
    case 'yesno':
      return <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} aria-label={f.name} />
    case 'choice':
      return (
        <select className="input" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {(f.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      )
    case 'entry': {
      const v = value && typeof value === 'object' && !Array.isArray(value) ? value : null
      return (
        <div className="ld-inline">
          {v && <EntryChip r={v} />}
          <EntryPick value={v} onPick={onChange} />
        </div>
      )
    }
    case 'entries': {
      const list = Array.isArray(value) ? value : []
      return (
        <div className="cl-chips">
          {list.map((r, i) => (
            <EntryChip key={`${r.type}:${r.id}`} r={r} onRemove={() => onChange(list.filter((_, j) => j !== i))} />
          ))}
          <EntryPick value={null} skip={list} onPick={(r) => r && onChange([...list, r])} />
        </div>
      )
    }
    case 'picture':
      return (
        <div style={{ width: 120 }}>
          <ImagePicker path={typeof value === 'string' ? value : null} alt={f.name} onChange={(p) => onChange(p)} />
        </div>
      )
    default:
      return <input className="input" value={typeof value === 'string' ? value : value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value)} />
  }
}

function FieldsEditor({ d, set, tabs }: { d: CustomListDoc; set(fn: (d: CustomListDoc) => CustomListDoc): void; tabs: React.ReactNode }) {
  const edit = (id: string, patch: Partial<CustomField>) => set((x) => ({ ...x, fields: x.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
  const move = (i: number, by: number) =>
    set((x) => {
      const fields = [...x.fields]
      const [f] = fields.splice(i, 1)
      fields.splice(Math.max(0, Math.min(fields.length, i + by)), 0, f)
      return { ...x, fields }
    })
  return (
    <div className="cl-fields">
      <div className="ld-toolbar">
        {tabs}
        <label className="ld-inline muted">
          One entry is called
          <input className="input" style={{ width: 140 }} value={d.one} onChange={(e) => set((x) => ({ ...x, one: e.target.value }))} placeholder="vehicle" />
        </label>
        <button className="btn" onClick={() => set((x) => ({ ...x, fields: [...x.fields, newField()] }))}>
          <Plus size={14} /> Field
        </button>
      </div>
      <p className="muted cl-hint">Every {d.one} has a name and a picture. Add the fields it needs; changing a field's kind converts what is already filled in where it can.</p>
      {d.fields.map((f, i) => (
        <div key={f.id} className="cl-field">
          <input className="input" value={f.name} onChange={(e) => edit(f.id, { name: e.target.value })} aria-label="Field name" />
          <select className="input" value={f.kind} onChange={(e) => set((x) => changeKind(x, f.id, e.target.value as FieldKind))} aria-label="Kind">
            {FIELD_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          {f.kind === 'choice' && (
            <input
              className="input"
              placeholder="Choices, comma separated"
              defaultValue={(f.options ?? []).join(', ')}
              onBlur={(e) => edit(f.id, { options: [...new Set(e.target.value.split(',').map((o) => o.trim()).filter(Boolean))] })}
            />
          )}
          {f.kind === 'number' && <input className="input" style={{ width: 90 }} placeholder="Unit" value={f.unit ?? ''} onChange={(e) => edit(f.id, { unit: e.target.value || undefined })} />}
          <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
            <ArrowUp size={13} />
          </button>
          <button className="icon-btn" aria-label="Move down" disabled={i === d.fields.length - 1} onClick={() => move(i, 1)}>
            <ArrowDown size={13} />
          </button>
          <button
            className="icon-btn"
            aria-label={`Delete ${f.name}`}
            onClick={() => set((x) => ({ ...x, fields: x.fields.filter((o) => o.id !== f.id), items: x.items.map((r) => ({ ...r, values: Object.fromEntries(Object.entries(r.values).filter(([k]) => k !== f.id)) })) }))}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
