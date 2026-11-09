import { useMemo } from 'react'
import { ENTITY_TYPES, newId, type Category, type ComponentType, type Entity, type EntityType } from '@/core/model'
import { allEntities, postIntent, useDocument, useDocumentsOfType, useProjectStore } from '@/core/state'
import { getManifest } from '@/core/registry'
import { jumpTo, openEntity } from '@/shared/entityList/navigation'
import type { RefItem, RefProvider, RefTarget } from './types'
import { entityLook } from '../categories/styles'

export const MAX_REF_RESULTS = 20

/** Names that start with the query first, then names containing it, each alphabetical. */
export function rankRefItems(items: RefItem[], query: string, limit = MAX_REF_RESULTS): RefItem[] {
  const q = query.trim().toLowerCase()
  const byLabel = (a: RefItem, b: RefItem) => a.label.localeCompare(b.label)
  if (!q) return [...items].sort(byLabel).slice(0, limit)
  const starts: RefItem[] = []
  const contains: RefItem[] = []
  for (const item of items) {
    const label = item.label.toLowerCase()
    if (label.startsWith(q)) starts.push(item)
    else if (label.includes(q)) contains.push(item)
  }
  return [...starts.sort(byLabel), ...contains.sort(byLabel)].slice(0, limit)
}

/** The item whose name equals `label` (case-insensitive), used when `[[Name]]` is typed out in full. */
export function findRefByLabel(provider: RefProvider, label: string): RefItem | undefined {
  const wanted = label.trim().toLowerCase()
  return provider.search(label).find((item) => item.label.trim().toLowerCase() === wanted)
}

/**
 * Merge several providers, e.g. entities plus wiki articles. Search results are
 * re-ranked together; open/resolve go to the first provider that knows the target;
 * create comes from the first provider that offers it.
 */
export function combineRefProviders(...providers: RefProvider[]): RefProvider {
  const creator = providers.find((p) => p.create)
  return {
    search: (query) => rankRefItems(providers.flatMap((p) => p.search(query)), query),
    resolve: (target) => {
      for (const p of providers) {
        const hit = p.resolve(target)
        if (hit) return hit
      }
      return undefined
    },
    open: (target) => providers.find((p) => p.open && p.resolve(target))?.open?.(target),
    create: creator?.create?.bind(creator),
    createLabel: creator?.createLabel?.bind(creator),
  }
}

const ENTITY_HINT: Record<EntityType, string> = { item: 'Item', character: 'Character', town: 'Town', enemy: 'Enemy' }

const isEntityType = (kind: string): kind is EntityType => (ENTITY_TYPES as readonly string[]).includes(kind)
const toItem = (e: Entity, categories: Category[] = []): RefItem => ({
  kind: e.type,
  id: e.id,
  label: e.name || 'Untitled',
  hint: ENTITY_HINT[e.type],
  color: entityLook(categories, e.type, e)?.style.color,
  details: [
    ...(e.type === 'enemy' ? [['Level', e.levelMin === e.levelMax ? `${e.levelMin}` : `${e.levelMin}–${e.levelMax}`] as [string, string]] : []),
    ...(e.type === 'item' || e.type === 'enemy' ? Object.entries(e.stats).map(([k, v]): [string, string] => [k, String(v)]) : []),
  ],
})

/** `[[` links to a whole tool (`tool`, id = its type) or one of its documents (`doc`, id = the document): jump points in text (v0.18). */
export const TOOL_KIND = 'tool'
export const DOC_KIND = 'doc'
/** 0.28: an entry of a Custom List: kind `custom:<list document id>`, id = the entry. */
export const CUSTOM_KIND = 'custom:'

interface CustomListLite {
  one: string
  fields: { id: string; name: string; kind: string; unit?: string }[]
  items: { id: string; name: string; values: Record<string, unknown> }[]
}

/** Values a card can show: numbers, short texts, choices and yes/no (links and pictures are left out). */
function customDetails(l: CustomListLite, values: Record<string, unknown>): [string, string][] {
  return l.fields.flatMap((f): [string, string][] => {
    const v = values[f.id]
    if (v === null || v === undefined || v === '') return []
    if (f.kind === 'number') return [[f.name, `${v}${f.unit ? ` ${f.unit}` : ''}`]]
    if (f.kind === 'yesno') return [[f.name, v ? 'yes' : 'no']]
    if (f.kind === 'text' || f.kind === 'choice') return [[f.name, String(v)]]
    return []
  })
}
// Same default as the Custom List tool's createCustomListDoc (shared code can't import tools).
const createCustomListLite = () => ({ one: 'entry', fields: [{ id: newId(), name: 'Description', kind: 'long' }], items: [] }) as CustomListLite
/** One Asset Pool entry (id = the entry); clicking it opens the Asset Pool on that entry. */
export const ASSET_KIND = 'asset'
const emptyPool = (): { entries: { id: string; name: string; kind: string }[] } => ({ entries: [] })

/**
 * Links to items, characters, towns and enemies of the open project (clicking one opens its list),
 * and, unless `places` is false, to every tool and document (clicking one jumps there).
 */
export function useEntityRefProvider(options?: { open?: (target: RefTarget) => void; places?: boolean }): RefProvider {
  const entities = useProjectStore((s) => s.entities)
  const categories = useProjectStore((s) => s.categories)
  const meta = useProjectStore((s) => s.meta)
  const open = options?.open
  const withPlaces = options?.places !== false
  const lists = useDocumentsOfType<CustomListLite>('custom-list', createCustomListLite)
  const pool = useDocument('asset-pool', 'pool', emptyPool).data
  return useMemo<RefProvider>(() => {
    const custom: RefItem[] = lists.flatMap((l) => l.data.items.map((r) => ({ kind: CUSTOM_KIND + l.id, id: r.id, label: r.name || 'Untitled', hint: l.title, details: customDetails(l.data, r.values) })))
    const assets: RefItem[] = meta?.enabledComponents.includes('asset-pool') ? (pool?.entries ?? []).map((a) => ({ kind: ASSET_KIND, id: a.id, label: a.name || 'Untitled', hint: `Asset (${a.kind})` })) : []
    const all = [...allEntities(entities).map((e) => toItem(e, categories)), ...assets, ...custom]
    const tools: RefItem[] = (meta?.enabledComponents ?? []).map((t) => ({ kind: TOOL_KIND, id: t, label: getManifest(t)?.name ?? t, hint: 'Tool' }))
    const docs: RefItem[] = (meta?.documents ?? []).map((d) => ({ kind: DOC_KIND, id: d.id, label: d.title, hint: getManifest(d.type)?.name ?? d.type }))
    const places = withPlaces ? [...tools, ...docs] : []
    return {
      search: (query) => rankRefItems([...all, ...places], query),
      resolve: (target) => {
        if (target.kind === TOOL_KIND || target.kind === DOC_KIND) return places.find((p) => p.kind === target.kind && p.id === target.id)
        if (target.kind.startsWith(CUSTOM_KIND)) return custom.find((c) => c.kind === target.kind && c.id === target.id)
        if (target.kind === ASSET_KIND) return assets.find((a) => a.id === target.id)
        if (!isEntityType(target.kind)) return undefined
        const hit = (entities[target.kind] as Entity[]).find((e) => e.id === target.id)
        return hit && toItem(hit, categories)
      },
      open: (target) => {
        if (target.kind === TOOL_KIND) return jumpTo({ kind: 'document', type: target.id as ComponentType, documentId: null })
        const doc = target.kind === DOC_KIND && meta?.documents.find((d) => d.id === target.id)
        if (doc) return jumpTo({ kind: 'document', type: doc.type, documentId: doc.id })
        if (target.kind.startsWith(CUSTOM_KIND)) {
          const documentId = target.kind.slice(CUSTOM_KIND.length)
          postIntent('custom-list', { action: 'select', documentId, entryId: target.id })
          return jumpTo({ kind: 'document', type: 'custom-list', documentId })
        }
        if (target.kind === ASSET_KIND) {
          postIntent('asset-pool', { action: 'select', id: target.id })
          return jumpTo({ kind: 'document', type: 'asset-pool', documentId: null })
        }
        if (open) open(target)
        else if (isEntityType(target.kind)) openEntity(target.kind, target.id)
      },
    }
  }, [entities, categories, meta, open, withPlaces, lists, pool])
}
