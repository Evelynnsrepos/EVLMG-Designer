import { ENTITY_TYPES, type Category, type Entity, type EntityType } from '@/core/model'
import type { CustomListDoc } from '@/components/custom-list/model'
import type { LookupEntry } from './engine'

/** What STAT() can read: every entry's stats, categories (by name) and level range, and every Custom List entry's fields. */
export function lookupEntries(entities: Record<EntityType, Entity[]>, categories: Category[], lists: { title: string; doc: CustomListDoc }[]): LookupEntry[] {
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
      out.push({ kind: t, name: e.name, fields })
    }
  for (const { title, doc } of lists)
    for (const r of doc.items) {
      const fields: LookupEntry['fields'] = {}
      for (const f of doc.fields) {
        const v = r.values[f.id]
        if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') fields[f.name] = v
      }
      out.push({ kind: title, name: r.name, fields })
    }
  return out
}
