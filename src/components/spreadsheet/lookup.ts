import { ENTITY_TYPES, type Category, type Entity, type EntityType } from '@/core/model'
import type { CustomListDoc } from '@/components/custom-list/model'
import type { LookupEntry } from './engine'

/** What STAT() can read: every entry's stats, categories (by name) and level range, and every Custom List entry's fields. */
export function lookupEntries(entities: Record<EntityType, Entity[]>, categories: Category[], lists: { title: string; doc: CustomListDoc; id?: string }[]): LookupEntry[] {
  const out: LookupEntry[] = []
  for (const t of ENTITY_TYPES)
    for (const e of entities[t] as Entity[]) {
      const fields: LookupEntry['fields'] = { Description: e.description }
      for (const [id, v] of Object.entries(e.categories)) {
        const c = categories.find((x) => x.id === id)
        if (c && v !== null) fields[c.name] = v
      }
      if (e.type === 'enemy') Object.assign(fields, { 'Level min': e.levelMin, 'Level max': e.levelMax })
      if ('stats' in e) Object.assign(fields, e.stats)
      out.push({ kind: t, name: e.name, fields, src: { entity: t, id: e.id } })
    }
  for (const { title, doc, id } of lists)
    for (const r of doc.items) {
      const fields: LookupEntry['fields'] = {}
      for (const f of doc.fields) {
        const v = r.values[f.id]
        if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') fields[f.name] = v
      }
      out.push({ kind: title, name: r.name, fields, ...(id ? { src: { list: id, id: r.id } } : {}) })
    }
  return out
}

/** A STAT() formula's arguments, or null for any other cell. */
export function parseStat(formula: string): { name: string; field: string; kind?: string } | null {
  const m = /^=\s*STAT\(\s*"([^"]*)"\s*[,;]\s*"([^"]*)"\s*(?:[,;]\s*"([^"]*)"\s*)?\)\s*$/i.exec(formula)
  return m ? { name: m[1], field: m[2], ...(m[3] ? { kind: m[3] } : {}) } : null
}

export type WriteBack =
  | { entity: EntityType; id: string; patch: { stats: Record<string, number> } | { levelMin: number } | { levelMax: number } | { description: string } }
  | { list: string; id: string; fieldName: string; value: number | string | boolean }

/**
 * 0.28: typing a value over a STAT() cell changes the entry itself. Null when it can't (unknown or ambiguous entry,
 * categories, or text typed into a number): then the cell is simply overwritten as before.
 */
export function statWriteBack(entries: LookupEntry[], formula: string, typed: string): WriteBack | null {
  const call = parseStat(formula)
  if (!call || typed.startsWith('=')) return null
  const n = call.name.trim().toLowerCase()
  const k = call.kind?.trim().toLowerCase()
  const hits = entries.filter((e) => e.name.trim().toLowerCase() === n && (!k || e.kind.toLowerCase() === k))
  if (hits.length !== 1 || !hits[0].src) return null
  const e = hits[0]
  const src = e.src!
  const f = call.field.trim().toLowerCase()
  const kindFields = entries.filter((x) => x.kind === e.kind).flatMap((x) => Object.entries(x.fields))
  const known = [...Object.entries(e.fields), ...kindFields].find(([x]) => x.toLowerCase() === f)
  if (!known) return null
  const [field, sample] = known
  const num = Number(typed.trim().replace(',', '.'))
  const asNumber = typed.trim() !== '' && Number.isFinite(num) ? num : null
  if ('entity' in src) {
    if (field === 'Description') return { entity: src.entity, id: src.id, patch: { description: typed } }
    if (asNumber === null) return null
    if (field === 'Level min') return { entity: src.entity, id: src.id, patch: { levelMin: asNumber } }
    if (field === 'Level max') return { entity: src.entity, id: src.id, patch: { levelMax: asNumber } }
    if (src.entity !== 'item' && src.entity !== 'enemy') return null
    // Categories are names of options, not free values: only stats beyond this point.
    if (typeof sample !== 'number') return null
    return { entity: src.entity, id: src.id, patch: { stats: { [field]: asNumber } } }
  }
  if (typeof sample === 'number') return asNumber === null ? null : { list: src.list, id: src.id, fieldName: field, value: asNumber }
  if (typeof sample === 'boolean') return { list: src.list, id: src.id, fieldName: field, value: /^(yes|true|1|ja|x)$/i.test(typed.trim()) }
  return { list: src.list, id: src.id, fieldName: field, value: typed }
}
