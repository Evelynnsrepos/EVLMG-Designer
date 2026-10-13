import { RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ENTITY_TYPES, type Entity, type EntityType, type Id } from '@/core/model'
import { collectIds, findReferences, type Reference } from '@/core/references'
import { getManifest } from '@/core/registry'
import { useProjectStore } from '@/core/state'
import { describeReference } from '@/shared/entityDelete'
import { TYPE_LABEL, TYPE_PLURAL } from './links'
import { jumpTo, type JumpTarget } from './navigation'

interface Chip {
  key: string
  label: string
  kind: string
  target: JumpTarget
  /** Made by hand with "Link to…", so it can be removed here. */
  own?: boolean
}

/** "dropTable.itemId" -> "drop table" */
const fieldLabel = (field: string) =>
  field
    .split('.')[0]
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()

export const targetKey = (t: JumpTarget) => (t.kind === 'entity' ? `e:${t.type}:${t.id}` : `d:${t.type}:${t.documentId ?? ''}`)

/** Display name of a link target, e.g. "Ironhold" or "Writer: Chapter 1". */
export function useTargetName(): (t: JumpTarget) => string {
  const entities = useProjectStore((s) => s.entities)
  const documents = useProjectStore((s) => s.meta?.documents)
  return (t) => {
    if (t.kind === 'entity') return (entities[t.type] as Entity[]).find((e) => e.id === t.id)?.name || `Missing ${TYPE_LABEL[t.type].toLowerCase()}`
    const tool = getManifest(t.type)?.name ?? t.type
    const title = documents?.find((d) => d.id === t.documentId)?.title
    return title ? `${tool}: ${title}` : tool
  }
}

/** A menu of everything you can link to: every entry, every document, and the tools with one page. */
export function LinkPicker({ exclude = [], onPick, label = 'Link to…' }: { exclude?: JumpTarget[]; onPick(t: JumpTarget): void; label?: string }) {
  const entities = useProjectStore((s) => s.entities)
  const meta = useProjectStore((s) => s.meta)
  const taken = new Set(exclude.map(targetKey))
  const groups = [
    ...ENTITY_TYPES.map((type) => ({
      group: TYPE_PLURAL[type],
      items: [...(entities[type] as Entity[])]
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map((e) => ({ label: e.name || 'Untitled', target: { kind: 'entity', type, id: e.id } as JumpTarget })),
    })),
    {
      group: 'Documents',
      items: (meta?.documents ?? []).map((d) => ({ label: `${getManifest(d.type)?.name ?? d.type}: ${d.title}`, target: { kind: 'document', type: d.type, documentId: d.id } as JumpTarget })),
    },
    {
      group: 'Tools',
      items: (meta?.enabledComponents ?? [])
        .filter((t) => !getManifest(t)?.multiDocument && !ENTITY_TYPES.some((e) => `${e}-list` === t))
        .map((t) => ({ label: getManifest(t)?.name ?? t, target: { kind: 'document', type: t, documentId: null } as JumpTarget })),
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => !taken.has(targetKey(i.target))) }))
    .filter((g) => g.items.length)
  const all = groups.flatMap((g) => g.items)
  return (
    <select
      className="input jump-picker"
      value=""
      aria-label={label}
      onChange={(e) => {
        const hit = all.find((i) => targetKey(i.target) === e.target.value)
        if (hit) onPick(hit.target)
      }}
    >
      <option value="">{label}</option>
      {groups.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.items.map((i) => (
            <option key={targetKey(i.target)} value={targetKey(i.target)}>
              {i.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/**
 * "Jump to": everything this entity points at (its town, the items it drops, its links), one click each,
 * plus links made by hand with "Link to…" (v0.12), which show up in the other side's "Used in" too.
 */
export function JumpBar({ type, entity, onConnect }: { type: EntityType; entity: Entity; onConnect?(connections: JumpTarget[]): void }) {
  const entities = useProjectStore((s) => s.entities)
  const documents = useProjectStore((s) => s.meta?.documents)
  const jumps = useProjectStore((s) => s.meta?.jumps)
  const nameOf = useTargetName()
  const own = useMemo(() => entity.connections ?? [], [entity.connections])
  const chips = useMemo(() => {
    const byId = new Map<Id, { type: EntityType; e: Entity }>()
    for (const type of ENTITY_TYPES) for (const e of entities[type] as Entity[]) byId.set(e.id.toLowerCase(), { type, e })
    const docs = new Map((documents ?? []).map((d) => [d.id.toLowerCase(), d]))
    const out: Chip[] = own.map((t) => ({ key: targetKey(t), label: nameOf(t), kind: 'linked by hand', target: t, own: true }))
    const seen = new Set(own.map((t) => (t.kind === 'entity' ? t.id : (t.documentId ?? '')).toLowerCase()))
    for (const [id, fields] of collectIds({ ...entity, connections: undefined })) {
      if (id === entity.id.toLowerCase() || seen.has(id)) continue
      const why = [...new Set([...fields].filter(Boolean).map(fieldLabel))].join(', ')
      const hit = byId.get(id)
      const doc = docs.get(id)
      if (hit) out.push({ key: id, label: hit.e.name || `Untitled ${TYPE_LABEL[hit.type].toLowerCase()}`, kind: why || TYPE_LABEL[hit.type], target: { kind: 'entity', type: hit.type, id: hit.e.id } })
      else if (doc) out.push({ key: id, label: doc.title, kind: why || (getManifest(doc.type)?.name ?? doc.type), target: { kind: 'document', type: doc.type, documentId: doc.id } })
    }
    // v0.17: jump points elsewhere that point at this entry.
    for (const j of jumps ?? []) if (j.to.kind === 'entity' && j.to.id === entity.id) out.push({ key: `j${j.id}`, label: nameOf(j.from), kind: 'a jump point there points here', target: j.from })
    return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- nameOf reads the same entities and documents
  }, [entity, entities, documents, own, jumps])

  if (chips.length === 0 && !onConnect) return null
  return (
    <nav className="jump-bar" aria-label="Jump to">
      <span className="elist-muted">Jump to</span>
      {chips.map((c) => (
        <span key={c.key} className={`jump-chip${c.own ? ' own' : ''}`}>
          <button title={`${c.label} (${c.kind})`} onClick={() => jumpTo(c.target)}>
            {c.label}
          </button>
          {c.own && onConnect && (
            <button className="jump-chip-x" title="Remove this link" aria-label={`Remove the link to ${c.label}`} onClick={() => onConnect(own.filter((t) => targetKey(t) !== c.key))}>
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      {onConnect && <LinkPicker exclude={[{ kind: 'entity', type, id: entity.id }, ...own]} onPick={(t) => onConnect([...own, t])} label="+ Link to…" />}
    </nav>
  )
}

const sourceTarget = (r: Reference): JumpTarget =>
  r.source.kind === 'entity'
    ? { kind: 'entity', type: r.source.entityType, id: r.source.entityId }
    : { kind: 'document', type: r.source.componentType, documentId: r.source.documentId }

/** "Used in": every place in the project that mentions this entity, from the same index the delete check uses. */
export function UsedIn({ id }: { id: Id }) {
  const [tick, setTick] = useState(0)
  const key = `${id}:${tick}`
  const [found, setFound] = useState<{ key: string; refs: Reference[] } | null>(null)
  const refs = found?.key === key ? found.refs : null
  useEffect(() => {
    let live = true
    // ponytail: scans the whole saved project per page open; cache the index if big projects feel slow.
    void findReferences(id).then((r) => live && setFound({ key, refs: r }))
    return () => {
      live = false
    }
  }, [id, key])

  return (
    <div className="elist-rows">
      {refs === null ? (
        <div className="elist-muted">Looking…</div>
      ) : refs.length === 0 ? (
        <div className="elist-muted">Not used anywhere else yet.</div>
      ) : (
        <ul className="elist-refs">
          {refs.map((r, i) => (
            <li key={i}>
              <button className="elist-link" onClick={() => jumpTo(sourceTarget(r))}>
                {describeReference(r)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn btn-ghost elist-add-row" onClick={() => setTick((t) => t + 1)}>
        <RefreshCw size={14} /> Refresh
      </button>
    </div>
  )
}
