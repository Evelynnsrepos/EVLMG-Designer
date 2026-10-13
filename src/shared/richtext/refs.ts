import { useMemo } from 'react'
import { ENTITY_TYPES, type Category, type ComponentType, type Entity, type EntityType } from '@/core/model'
import { allEntities, useProjectStore } from '@/core/state'
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
})

/** `[[` links to a whole tool (`tool`, id = its type) or one of its documents (`doc`, id = the document): jump points in text (v0.18). */
export const TOOL_KIND = 'tool'
export const DOC_KIND = 'doc'

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
  return useMemo<RefProvider>(() => {
    const all = allEntities(entities).map((e) => toItem(e, categories))
    const tools: RefItem[] = (meta?.enabledComponents ?? []).map((t) => ({ kind: TOOL_KIND, id: t, label: getManifest(t)?.name ?? t, hint: 'Tool' }))
    const docs: RefItem[] = (meta?.documents ?? []).map((d) => ({ kind: DOC_KIND, id: d.id, label: d.title, hint: getManifest(d.type)?.name ?? d.type }))
    const places = withPlaces ? [...tools, ...docs] : []
    return {
      search: (query) => rankRefItems([...all, ...places], query),
      resolve: (target) => {
        if (target.kind === TOOL_KIND || target.kind === DOC_KIND) return places.find((p) => p.kind === target.kind && p.id === target.id)
        if (!isEntityType(target.kind)) return undefined
        const hit = (entities[target.kind] as Entity[]).find((e) => e.id === target.id)
        return hit && toItem(hit, categories)
      },
      open: (target) => {
        if (target.kind === TOOL_KIND) return jumpTo({ kind: 'document', type: target.id as ComponentType, documentId: null })
        const doc = target.kind === DOC_KIND && meta?.documents.find((d) => d.id === target.id)
        if (doc) return jumpTo({ kind: 'document', type: doc.type, documentId: doc.id })
        if (open) open(target)
        else if (isEntityType(target.kind)) openEntity(target.kind, target.id)
      },
    }
  }, [entities, categories, meta, open, withPlaces])
}
