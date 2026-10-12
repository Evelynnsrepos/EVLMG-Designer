import { ArrowLeft, BookOpen, Copy, ExternalLink, ImageOff, ImagePlus, Plus, Trash2, X } from 'lucide-react'
import { useState, type DragEvent, type ReactNode } from 'react'
import { dragHasFiles, importAssetsFromDataTransfer, pickAndImportAssets } from '@/core/assets'
import { newId, type Entity, type EntityLink, type EntityOf, type EntityType, type Id, type StatBlock } from '@/core/model'
import { useProjectStore } from '@/core/state'
import { AssetImage } from '@/shared/AssetImage'
import { PixelSprite, SpritePicker } from '@/shared/pixel/PixelSprite'
import { CategoryFields, NumberInput } from '@/shared/categories'
import { ReviewButton } from '@/shared/reviews'
import type { EntityActions } from './actions'
import type { DetailContext, ListText } from './EntityList'
import { JumpBar, UsedIn } from './JumpBar'
import { TYPE_LABEL, TYPE_PLURAL } from './links'
import { nextStatName, renameStat } from './query'
import { entityLook, frameStyle } from '../categories/styles'
import { ProofTextarea } from '@/shared/spell'

/** A labelled block on a detail page. */
export function Section({ label, htmlFor, icon, children }: { label: string; htmlFor?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="elist-section">
      {htmlFor ? (
        <label className="elist-label" htmlFor={htmlFor}>
          {icon}
          {label}
        </label>
      ) : (
        <div className="elist-label">
          {icon}
          {label}
        </div>
      )}
      {children}
    </section>
  )
}

export interface DetailFrameProps<T extends EntityType> {
  type: T
  entity: EntityOf<T>
  actions: EntityActions<T>
  ctx: DetailContext
  text: ListText
  /** Label above the category fields, e.g. "Associations". */
  categoriesLabel?: string
  /** "Create wiki article" (CH-6, EN-7); hidden without it. */
  onOpenWiki?(): void
  /** Component-specific sections, shown between categories and notes. */
  children?: ReactNode
}

/**
 * The common page of one entity: image, name (required), description,
 * categories/associations, the component's own sections, then notes.
 */
export function DetailFrame<T extends EntityType>({ type, entity, actions, ctx, text, categoriesLabel = 'Associations', onOpenWiki, children }: DetailFrameProps<T>) {
  const categories = useProjectStore((s) => s.categories)
  const nameEmpty = entity.name.trim() === ''
  const look = entityLook(useProjectStore((st) => st.categories), type, entity)
  const fallback = `Untitled ${text.one}`
  const update = (patch: Partial<Entity>, group: string | null = null) => actions.update(entity.id, patch as Partial<EntityOf<T>>, group)

  return (
    <aside className="elist-detail" aria-label={`${TYPE_LABEL[type]} ${entity.name}`}>
      <div className="elist-detail-top">
        <button className="icon-btn" title="Back to list" aria-label="Back to list" onClick={ctx.onBack}>
          <ArrowLeft size={16} />
        </button>
        <span style={{ flex: 1 }} />
        <ReviewButton target={{ kind: 'entity', type, id: entity.id }} title={entity.name || fallback} />
        {onOpenWiki && (
          <button className="btn btn-ghost elist-wiki" title="Create a wiki article about this" onClick={onOpenWiki}>
            <BookOpen size={14} /> Create wiki article
          </button>
        )}
        <button
          className="icon-btn"
          title="Duplicate"
          aria-label="Duplicate"
          onClick={() => {
            const copy = actions.duplicate(entity.id)
            if (copy) ctx.onSelect(copy.id)
          }}
        >
          <Copy size={15} />
        </button>
        <button className="icon-btn elist-danger" title="Delete" aria-label="Delete" onClick={ctx.onDelete}>
          <Trash2 size={15} />
        </button>
      </div>

      <JumpBar type={type} entity={entity} onConnect={(connections) => update({ connections })} />

      <div className="elist-detail-head">
        <div className="elist-detail-frame" style={frameStyle(look?.style)}>
          {entity.sprite ? <PixelSprite sprite={entity.sprite} size={120} /> : <ImagePicker path={entity.image} alt={entity.name} onChange={(image) => update({ image })} />}
          <SpritePicker sprite={entity.sprite} onChange={(sprite) => update({ sprite })} />
        </div>
        <div className="elist-detail-name">
          <label className="elist-label" htmlFor={`elist-name-${entity.id}`}>
            Name
          </label>
          <input
            id={`elist-name-${entity.id}`}
            className={`input elist-name-input${nameEmpty ? ' invalid' : ''}`}
            value={entity.name}
            aria-invalid={nameEmpty}
            autoFocus={ctx.autoFocusName}
            onFocus={(e) => ctx.autoFocusName && e.target.select()}
            onChange={(e) => update({ name: e.target.value }, `name:${entity.id}`)}
            onBlur={() => nameEmpty && update({ name: fallback }, `name:${entity.id}`)}
          />
          {nameEmpty && <div className="elist-error">A {text.one} needs a name.</div>}
        </div>
      </div>

      <Section label="Description" htmlFor={`elist-desc-${entity.id}`}>
        <ProofTextarea
          id={`elist-desc-${entity.id}`}
          className="input elist-textarea"
          rows={3}
          value={entity.description}
          onChange={(e) => update({ description: e.target.value }, `description:${entity.id}`)}
        />
      </Section>

      <Section label={categoriesLabel}>
        <CategoryFields
          type={type}
          entity={entity}
          allIds={ctx.allIds}
          categories={categories}
          onValueChange={(categoryId, value) => actions.setCategoryValue(entity.id, categoryId, value)}
          onCategoriesChange={actions.setCategories}
          onManage={ctx.onManageCategories}
        />
      </Section>

      {children}

      <Section label="Used in">
        <UsedIn id={entity.id} />
      </Section>

      <Section label="Notes" htmlFor={`elist-notes-${entity.id}`}>
        <ProofTextarea
          id={`elist-notes-${entity.id}`}
          className="input elist-textarea"
          rows={4}
          value={entity.notes}
          onChange={(e) => update({ notes: e.target.value }, `notes:${entity.id}`)}
        />
      </Section>
    </aside>
  )
}

/** Image or checkerboard placeholder, with choose/remove buttons; also accepts a dropped image file. */
export function ImagePicker({ path, alt, onChange }: { path: string | null; alt: string; onChange(path: string | null): void }) {
  const root = useProjectStore((s) => s.root)
  const [over, setOver] = useState(false)
  const choose = async () => {
    if (!root) return
    const [asset] = await pickAndImportAssets(root, 'image', 'Choose an image')
    if (asset) onChange(asset.path)
  }
  const onDrop = async (e: DragEvent) => {
    setOver(false)
    if (!root || !dragHasFiles(e.dataTransfer)) return
    e.preventDefault()
    const [asset] = await importAssetsFromDataTransfer(root, e.dataTransfer, 'image')
    if (asset) onChange(asset.path)
  }
  return (
    <div
      className={`elist-detail-image${over ? ' over' : ''}`}
      onDragOver={(e) => {
        if (!dragHasFiles(e.dataTransfer)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <AssetImage path={path} alt={alt} size={96} />
      <div className="elist-image-actions">
        <button className="icon-btn" title="Choose image (or drop one here)" aria-label="Choose image" onClick={() => void choose()}>
          <ImagePlus size={15} />
        </button>
        {path && (
          <button className="icon-btn" title="Remove image" aria-label="Remove image" onClick={() => onChange(null)}>
            <ImageOff size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

/** Named numbers (stats) with rename, value and remove; new names come from `suggestions`. */
export function StatsEditor({
  stats,
  onChange,
  suggestions,
  idPrefix,
  hint,
  addLabel = 'Add stat',
}: {
  stats: StatBlock
  onChange(next: StatBlock, group?: string): void
  suggestions: string[]
  idPrefix: string
  hint?: string
  addLabel?: string
}) {
  const listId = `${idPrefix}-stat-names`
  return (
    <div className="elist-rows">
      {hint && <div className="elist-muted">{hint}</div>}
      {Object.entries(stats).map(([name, value]) => (
        <StatRow key={`${idPrefix}:${name}`} stats={stats} name={name} value={value} listId={listId} onChange={onChange} groupPrefix={idPrefix} />
      ))}
      <datalist id={listId}>
        {suggestions
          .filter((n) => !Object.hasOwn(stats, n))
          .map((n) => (
            <option key={n} value={n} />
          ))}
      </datalist>
      <button className="btn btn-ghost elist-add-row" onClick={() => onChange({ ...stats, [nextStatName(stats)]: 0 })}>
        <Plus size={14} /> {addLabel}
      </button>
    </div>
  )
}

function StatRow({
  stats,
  name,
  value,
  listId,
  onChange,
  groupPrefix,
}: {
  stats: StatBlock
  name: string
  value: number
  listId: string
  onChange(next: StatBlock, group?: string): void
  groupPrefix: string
}) {
  const [draft, setDraft] = useState(name)
  const commit = () => {
    const next = renameStat(stats, name, draft)
    if (next && next !== stats) onChange(next)
    else setDraft(name)
  }
  return (
    <div className="elist-row elist-stat">
      <input
        className="input cat-input"
        aria-label="Stat name"
        list={listId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      <NumberInput ariaLabel={`${name} value`} value={value} onChange={(v) => v !== null && onChange({ ...stats, [name]: v }, `${groupPrefix}:stat:${name}`)} />
      <button
        className="icon-btn"
        title={`Remove ${name}`}
        aria-label={`Remove ${name}`}
        onClick={() => {
          const { [name]: _removed, ...rest } = stats
          onChange(rest)
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}

const refKey = (type: EntityType, id: Id) => `${type}:${id}`

/** A <select> of entities of the given types, grouped by type. Value is `type:id` or ''. */
export function EntityPicker({
  types,
  value,
  onChange,
  exclude = [],
  ariaLabel,
  placeholder = 'Choose…',
}: {
  types: EntityType[]
  value: { type: EntityType; id: Id } | null
  onChange(next: { type: EntityType; id: Id }): void
  exclude?: Id[]
  ariaLabel: string
  placeholder?: string
}) {
  const entities = useProjectStore((s) => s.entities)
  const current = value && value.id ? refKey(value.type, value.id) : ''
  const exists = !value?.id || (entities[value.type] as Entity[]).some((e) => e.id === value.id)
  return (
    <select
      className="input cat-input"
      aria-label={ariaLabel}
      value={current}
      onChange={(e) => {
        const v = e.target.value
        const i = v.indexOf(':')
        if (i > 0) onChange({ type: v.slice(0, i) as EntityType, id: v.slice(i + 1) })
      }}
    >
      {!current && <option value="">{placeholder}</option>}
      {!exists && value && <option value={current}>(missing {TYPE_LABEL[value.type].toLowerCase()})</option>}
      {types.map((t) => {
        const list = (entities[t] as Entity[]).filter((e) => !exclude.includes(e.id) || refKey(t, e.id) === current)
        if (!list.length) return null
        const options = [...list]
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
          .map((e) => (
            <option key={e.id} value={refKey(t, e.id)}>
              {e.name || `Untitled ${TYPE_LABEL[t].toLowerCase()}`}
            </option>
          ))
        return types.length > 1 ? (
          <optgroup key={t} label={TYPE_PLURAL[t]}>
            {options}
          </optgroup>
        ) : (
          options
        )
      })}
    </select>
  )
}

/**
 * Links from this entity to others, e.g. "Mother of" Aria or "Lives in" Ironhold (CH-5, 8.12).
 * Targets are stored by id, so renames show everywhere.
 */
export function LinksEditor({
  selfId,
  links,
  onChange,
  targetTypes,
  suggestions,
  onNavigate,
}: {
  selfId: Id
  links: EntityLink[]
  onChange(next: EntityLink[], group?: string): void
  targetTypes: EntityType[]
  suggestions: string[]
  onNavigate(type: EntityType, id: Id): void
}) {
  const entities = useProjectStore((s) => s.entities)
  const listId = `elist-link-labels-${selfId}`
  const replace = (id: Id, patch: Partial<EntityLink>, group?: string) => onChange(links.map((l) => (l.id === id ? { ...l, ...patch } : l)), group)
  return (
    <div className="elist-rows">
      {links.length === 0 && <div className="elist-muted">No links yet. Link family, friends, rivals or where they live.</div>}
      {links.map((link) => {
        const target = link.targetId ? (entities[link.targetType] as Entity[]).find((e) => e.id === link.targetId) : undefined
        return (
          <div className="elist-row elist-link-row" key={link.id}>
            <input
              className="input cat-input"
              aria-label="Link label"
              placeholder="e.g. Mother of"
              list={listId}
              value={link.label}
              onChange={(e) => replace(link.id, { label: e.target.value }, `link:${link.id}`)}
            />
            <EntityPicker
              types={targetTypes}
              value={{ type: link.targetType, id: link.targetId }}
              exclude={[selfId]}
              ariaLabel={`${link.label || 'Link'} target`}
              onChange={(t) => replace(link.id, { targetType: t.type, targetId: t.id })}
            />
            <button
              className="icon-btn"
              title={target ? `Open ${target.name}` : 'Nothing to open'}
              aria-label={target ? `Open ${target.name}` : 'Nothing to open'}
              disabled={!target}
              onClick={() => target && onNavigate(link.targetType, link.targetId)}
            >
              <ExternalLink size={14} />
            </button>
            <button className="icon-btn" title="Remove link" aria-label="Remove link" onClick={() => onChange(links.filter((l) => l.id !== link.id))}>
              <X size={14} />
            </button>
          </div>
        )
      })}
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <button
        className="btn btn-ghost elist-add-row"
        onClick={() => onChange([...links, { id: newId(), label: '', targetType: targetTypes[0], targetId: '' }])}
      >
        <Plus size={14} /> Add link
      </button>
    </div>
  )
}

/** One entity mentioned on another's page, e.g. a backlink or "Enemies found here". */
export interface EntityRef {
  key: string
  type: EntityType
  id: Id
  name: string
  /** Shown before the name, e.g. the link label. */
  before?: string
  /** Shown after the name, muted. */
  after?: string
}

/** A read-only list of other entities with a click-through to each. */
export function EntityRefList({ refs, empty, onNavigate }: { refs: EntityRef[]; empty: string; onNavigate(type: EntityType, id: Id): void }) {
  if (refs.length === 0) return <div className="elist-muted">{empty}</div>
  return (
    <ul className="elist-refs">
      {refs.map((r) => (
        <li key={r.key}>
          <span>
            <button className="elist-link" onClick={() => onNavigate(r.type, r.id)}>
              {r.name || `Untitled ${TYPE_LABEL[r.type].toLowerCase()}`}
            </button>
            {r.before && <span className="elist-muted"> {r.before}</span>}
          </span>
          {r.after && <span className="elist-muted">{r.after}</span>}
        </li>
      ))}
    </ul>
  )
}
