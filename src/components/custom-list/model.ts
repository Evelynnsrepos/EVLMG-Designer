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

/** 0.28: ready-made lists for studio paperwork. Each makes fields (with choices) and, where it helps, starting entries. */
export const TEMPLATES: { id: string; label: string; one: string; fields: { name: string; kind: FieldKind; options?: string[] }[]; items?: { name: string; values: Record<string, string | boolean> }[] }[] = [
  {
    id: 'controls',
    label: 'Controls & input',
    one: 'action',
    fields: [
      { name: 'Keyboard & mouse', kind: 'text' },
      { name: 'Gamepad', kind: 'text' },
      { name: 'Touch', kind: 'text' },
      { name: 'Context', kind: 'choice', options: ['Gameplay', 'Menus', 'Vehicle', 'Dialogue'] },
      { name: 'Can be remapped', kind: 'yesno' },
      { name: 'Hold or press', kind: 'choice', options: ['Press', 'Hold', 'Toggle'] },
    ],
    items: [
      { name: 'Move', values: { 'Keyboard & mouse': 'WASD', Gamepad: 'Left stick', Context: 'Gameplay', 'Can be remapped': true, 'Hold or press': 'Hold' } },
      { name: 'Jump', values: { 'Keyboard & mouse': 'Space', Gamepad: 'A / Cross', Context: 'Gameplay', 'Can be remapped': true, 'Hold or press': 'Press' } },
      { name: 'Interact', values: { 'Keyboard & mouse': 'E', Gamepad: 'X / Square', Context: 'Gameplay', 'Can be remapped': true, 'Hold or press': 'Press' } },
      { name: 'Pause', values: { 'Keyboard & mouse': 'Esc', Gamepad: 'Start / Options', Context: 'Menus', 'Can be remapped': false, 'Hold or press': 'Press' } },
    ],
  },
  {
    id: 'accessibility',
    label: 'Accessibility checklist',
    one: 'check',
    fields: [
      { name: 'Area', kind: 'choice', options: ['Motor', 'Vision', 'Hearing', 'Cognitive', 'General'] },
      { name: 'Status', kind: 'choice', options: ['Not started', 'Planned', 'Done', 'Not needed'] },
      { name: 'Notes', kind: 'long' },
    ],
    items: [
      ['Every control can be remapped', 'Motor'],
      ['No action needs fast repeated presses, or there is a hold alternative', 'Motor'],
      ['Subtitles on by default, with speaker names and a size choice', 'Hearing'],
      ['Important sounds also have a visual cue', 'Hearing'],
      ['Text size can be changed and stays readable on a TV across the room', 'Vision'],
      ['Nothing relies on colour alone (colour-blind safe)', 'Vision'],
      ['Screen shake, flashing and motion blur can be turned off', 'Vision'],
      ['Difficulty options or an assist mode', 'Cognitive'],
      ['Objective reminder and a way to see the controls at any time', 'Cognitive'],
      ['Game can be paused anywhere, including cutscenes', 'General'],
    ].map(([name, area]) => ({ name, values: { Area: area, Status: 'Not started' } })),
  },
  {
    id: 'glossary',
    label: 'Glossary',
    one: 'term',
    fields: [
      { name: 'Meaning', kind: 'long' },
      { name: 'Do not translate', kind: 'yesno' },
      { name: 'Note for translators', kind: 'text' },
    ],
  },
  {
    id: 'risks',
    label: 'Risk register',
    one: 'risk',
    fields: [
      { name: 'Likelihood', kind: 'choice', options: ['Low', 'Medium', 'High'] },
      { name: 'Impact', kind: 'choice', options: ['Low', 'Medium', 'High'] },
      { name: 'Owner', kind: 'text' },
      { name: 'What we do about it', kind: 'long' },
      { name: 'Status', kind: 'choice', options: ['Open', 'Watching', 'Closed'] },
    ],
  },
]

/** A list made from a template, with fresh ids. */
export function fromTemplate(id: string): CustomListDoc {
  const t = TEMPLATES.find((x) => x.id === id)!
  const fields: CustomField[] = t.fields.map((f) => ({ ...newField(f.kind), name: f.name, ...(f.options ? { options: f.options } : {}) }))
  const byName = new Map(fields.map((f) => [f.name, f.id]))
  return { one: t.one, fields, items: (t.items ?? []).map((it) => ({ ...newRecord(it.name), values: Object.fromEntries(Object.entries(it.values).map(([k, v]) => [byName.get(k)!, v])) })) }
}
