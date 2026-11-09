import { newId, type EntityType, type Id } from '@/core/model'

/**
 * Custom List (0.28): a list of your own kind of entry (vehicles, buildings, perks, biomes…) with the fields
 * you define. One document per kind. Exported to engines as tools/custom-list.json.
 */
export const FIELD_KINDS = [
  { id: 'text', label: 'Text' },
  { id: 'long', label: 'Long text' },
  { id: 'number', label: 'Number' },
  { id: 'yesno', label: 'Yes / no' },
  { id: 'choice', label: 'Choice list' },
  { id: 'entry', label: 'Link to an entry' },
  { id: 'entries', label: 'Links to entries' },
  { id: 'picture', label: 'Picture' },
] as const

export type FieldKind = (typeof FIELD_KINDS)[number]['id']

export interface CustomField {
  id: Id
  name: string
  kind: FieldKind
  /** Choice lists only. */
  options?: string[]
  /** Numbers only, e.g. "km/h". */
  unit?: string
}

export interface EntryRef {
  type: EntityType
  id: Id
}

export type FieldValue = string | number | boolean | EntryRef | EntryRef[] | null

export interface CustomRecord {
  id: Id
  name: string
  image: string | null
  values: Record<Id, FieldValue>
}

export interface CustomListDoc {
  /** What one entry is called, e.g. "vehicle". */
  one: string
  fields: CustomField[]
  items: CustomRecord[]
}

export const createCustomListDoc = (): CustomListDoc => ({ one: 'entry', fields: [{ id: newId(), name: 'Description', kind: 'long' }], items: [] })
export const newField = (kind: FieldKind = 'text'): CustomField => ({ id: newId(), name: 'New field', kind, ...(kind === 'choice' ? { options: [] } : {}) })
export const newRecord = (name: string): CustomRecord => ({ id: newId(), name, image: null, values: {} })

/** A value as it should look when the field's kind changed: never throws away text by accident. */
export function coerce(kind: FieldKind, v: FieldValue | undefined): FieldValue {
  if (v === undefined || v === null) return null
  switch (kind) {
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) ? n : null
    }
    case 'yesno':
      return typeof v === 'boolean' ? v : v === 'true' || v === 1
    case 'entry':
      return Array.isArray(v) ? (v[0] ?? null) : typeof v === 'object' ? v : null
    case 'entries':
      return Array.isArray(v) ? v : typeof v === 'object' ? [v] : []
    default:
      return typeof v === 'object' ? null : String(v)
  }
}

/** Change a field's kind and convert every entry's value to it. */
export function changeKind(d: CustomListDoc, fieldId: Id, kind: FieldKind): CustomListDoc {
  return {
    ...d,
    fields: d.fields.map((f) => (f.id === fieldId ? { ...f, kind, ...(kind === 'choice' && !f.options ? { options: [] } : {}) } : f)),
    items: d.items.map((r) => (fieldId in r.values ? { ...r, values: { ...r.values, [fieldId]: coerce(kind, r.values[fieldId]) } } : r)),
  }
}
