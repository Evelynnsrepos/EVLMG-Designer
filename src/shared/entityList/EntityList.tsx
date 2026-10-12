import { ArrowDownAZ, ArrowUpZA, LayoutGrid, Plus, Redo2, Search, Table2, Tags, Trash2, Undo2, X, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { categoryAppliesTo, type Category, type EntityBase, type EntityOf, type EntityType, type Id, type StatBlock } from '@/core/model'
import { useProjectStore } from '@/core/state'
import { AssetImage } from '@/shared/AssetImage'
import { PixelSprite } from '@/shared/pixel/PixelSprite'
import {
  CategoryManager,
  CategoryValueInput,
  distinctValues,
  EMPTY_FILTER,
  formatValue,
  isUsedFor,
  NumberInput,
  type CategoryFilter,
} from '@/shared/categories'
import { confirmDialog } from '@/shared/dialogs'
import { confirmEntityDelete } from '@/shared/entityDelete'
import type { EntityActions } from './actions'
import { isTyping } from './dom'
import { reportShownEntity, takeEntityFocus, useEntityNavigation } from './navigation'
import { DEFAULT_QUERY, queryEntities, rangeBetween, type EntityQuery, type SortKey, type StatFilter } from './query'
import './entityList.css'
import { entityLook, frameStyle, StyleBadge, fieldLines, ratingText, StyleMark, styleOf } from '../categories/styles'

/** User-visible words for one list; `one`/`many` are lower case ("character", "characters"). */
export interface ListText {
  one: string
  many: string
  emptyBody: string
  /** Name given to a freshly added entity. */
  newName: string
}

/** What a detail page gets from the list around it. */
export interface DetailContext {
  allIds: Id[]
  /** True right after "Add": the name field takes focus. */
  autoFocusName: boolean
  onBack(): void
  onDelete(): void
  /** Select and open another entity of the same type (e.g. after Duplicate). */
  onSelect(id: Id): void
  onManageCategories(): void
}

/** An extra table column, e.g. Level or HP on the Enemy List. */
export interface ExtraColumn<E> {
  id: string
  label: string
  render(entity: E): ReactNode
  /** Clicking the header sorts by this key. */
  sortKey?: SortKey
}

export interface EntityListProps<T extends EntityType> {
  type: T
  active: boolean
  actions: EntityActions<T>
  text: ListText
  icon: LucideIcon
  renderDetail(entity: EntityOf<T>, ctx: DetailContext): ReactNode
  /** A short line under the name on cards, e.g. "Lv 3–5". */
  cardMeta?(entity: EntityOf<T>): string
  columns?: ExtraColumn<EntityOf<T>>[]
  /** Numbers to sort and filter by (EN-7). Enables the stat filter. */
  stats?(entity: EntityOf<T>): StatBlock
  searchText?(entity: EntityOf<T>): string[]
}

type ViewMode = 'grid' | 'table'
interface Prefs {
  mode: ViewMode
  sort: SortKey
  desc: boolean
}

const DEFAULT_PREFS: Prefs = { mode: 'grid', sort: 'name', desc: false }

// View preferences are a per-computer convenience, not project data.
function loadPrefs(type: EntityType): Prefs {
  try {
    const raw = localStorage.getItem(`egd.${type}-list.prefs`)
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) }
  } catch {
    // Storage unavailable: use defaults.
  }
  return DEFAULT_PREFS
}
function savePrefs(type: EntityType, p: Prefs) {
  try {
    localStorage.setItem(`egd.${type}-list.prefs`, JSON.stringify(p))
  } catch {
    // Not important enough to report.
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)


const STAT_PREFIX = 'stat:'

/**
 * A complete entity list (spec 8.11–8.13, shaped like the Item List 8.4): cards or
 * table, search, filter by category or stat, sort, multi-select with bulk category
 * changes, undo/redo, and a detail page rendered by the owning component.
 */
export function EntityList<T extends EntityType>({ type, active, actions, text, icon: Icon, renderDetail, cardMeta, columns = [], stats, searchText }: EntityListProps<T>) {
  const list = useProjectStore((s) => s.entities[type]) as EntityOf<T>[]
  const categories = useProjectStore((s) => s.categories)
  actions.useVersion()

  const [prefs, setPrefsState] = useState(() => loadPrefs(type))
  const setPrefs = (patch: Partial<Prefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      savePrefs(type, next)
      return next
    })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<CategoryFilter | null>(null)
  const [statFilter, setStatFilter] = useState<StatFilter | null>(null)
  const [selected, setSelected] = useState<Id[]>([])
  const [focusId, setFocusId] = useState<Id | null>(null)
  const [anchorId, setAnchorId] = useState<Id | null>(null)
  const [managing, setManaging] = useState(false)
  const [justAdded, setJustAdded] = useState<Id | null>(null)

  const clearFilters = () => {
    setSearch('')
    setFilter(null)
    setStatFilter(null)
  }

  // Another component asked to show one of ours ("Lives in Ironhold" -> Ironhold).
  // The request may arrive before this panel mounts, so check once on mount, then on every change.
  useEffect(() => {
    const take = () => {
      const req = takeEntityFocus(type)
      if (!req) return
      setSearch('')
      setFilter(null)
      setStatFilter(null)
      setSelected([req.id])
      setAnchorId(req.id)
      setFocusId(req.id)
    }
    take()
    return useEntityNavigation.subscribe((s) => s.focus?.type === type && take())
  }, [type])

  useEffect(() => reportShownEntity(type, focusId), [type, focusId])
  useEffect(() => () => reportShownEntity(type, null), [type])

  const shownCategories = useMemo(() => categories.filter((c) => isUsedFor(c, type)), [categories, type])
  const statNames = useMemo(() => {
    if (!stats) return []
    const names = new Set<string>()
    for (const e of list) Object.keys(stats(e)).forEach((n) => names.add(n))
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [list, stats])

  const query: EntityQuery = { ...DEFAULT_QUERY, search, filter, stat: statFilter, sort: prefs.sort, desc: prefs.desc }
  // Ignore a sort or filter on a category or stat that no longer exists.
  if (query.sort.startsWith('cat:') && !shownCategories.some((c) => `cat:${c.id}` === query.sort)) query.sort = 'name'
  if (query.sort.startsWith(STAT_PREFIX) && !statNames.includes(query.sort.slice(STAT_PREFIX.length))) query.sort = 'name'
  if (filter && !shownCategories.some((c) => c.id === filter.categoryId)) query.filter = null
  if (statFilter && !statNames.includes(statFilter.stat)) query.stat = null
  const visible = queryEntities(list, type, categories, query, { stats, searchText })
  const allIds = useMemo(() => list.map((e) => e.id), [list])
  const liveSelected = selected.filter((id) => allIds.includes(id))
  const focus = list.find((e) => e.id === focusId) ?? null

  const select = (id: Id, e?: MouseEvent | KeyboardEvent) => {
    if (e && (e.ctrlKey || e.metaKey)) {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
      setAnchorId(id)
      return
    }
    if (e?.shiftKey && anchorId) {
      setSelected(rangeBetween(visible.map((x) => x.id), anchorId, id))
      return
    }
    setSelected([id])
    setAnchorId(id)
    setFocusId(id)
  }
  const toggle = (id: Id) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
    setAnchorId(id)
  }
  const open = (id: Id) => {
    setSelected([id])
    setFocusId(id)
  }

  const onAdd = () => {
    const entity = actions.add(text.newName)
    clearFilters()
    open(entity.id)
    setJustAdded(entity.id)
  }

  const onDelete = useCallback(
    async (ids: Id[]) => {
      if (!ids.length) return
      const ok =
        ids.length === 1
          ? await confirmEntityDelete(type, ids[0])
          : await confirmDialog({
              title: `Delete ${ids.length} ${text.many}?`,
              message: `Places that use them will show them as missing. You can undo with Ctrl+Z.`,
              confirmLabel: 'Delete',
              danger: true,
            })
      if (!ok) return
      actions.remove(ids)
      setSelected([])
      setFocusId((f) => (f && ids.includes(f) ? null : f))
    },
    [type, text.many, actions],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!active) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (mod && key === 'z' && !e.shiftKey) {
      e.preventDefault()
      actions.undo()
      return
    }
    if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault()
      actions.redo()
      return
    }
    if (isTyping(e.target) || managing) return
    if (e.key === 'Delete' && liveSelected.length) {
      e.preventDefault()
      void onDelete(liveSelected)
    } else if (mod && key === 'a') {
      e.preventDefault()
      setSelected(visible.map((x) => x.id))
    } else if (e.key === 'Escape' && (liveSelected.length > 1 || focus)) {
      e.preventDefault() // ED-7: we used Esc, so the shell skips Layout Mode
      setSelected([])
      setFocusId(null)
    }
  }

  const hasFilters = search !== '' || query.filter !== null || query.stat !== null
  const filterCategory = query.filter ? shownCategories.find((c) => c.id === query.filter!.categoryId) : undefined
  const filterValue = query.stat ? `${STAT_PREFIX}${query.stat.stat}` : (query.filter?.categoryId ?? '')

  const ctx = (entity: EntityOf<T>): DetailContext => ({
    allIds,
    autoFocusName: entity.id === justAdded,
    onBack: () => setFocusId(null),
    onDelete: () => void onDelete([entity.id]),
    onSelect: open,
    onManageCategories: () => setManaging(true),
  })

  return (
    <div className={`elist${focus ? ' has-detail' : ''}`} onKeyDown={onKeyDown}>
      <div className="elist-main">
        <div className="elist-toolbar" role="toolbar" aria-label={`${cap(text.one)} List`}>
          <button className="btn btn-primary" onClick={onAdd}>
            <Plus size={15} /> Add {text.one}
          </button>
          <label className="elist-search">
            <Search size={14} aria-hidden />
            <input
              className="input"
              type="search"
              placeholder={`Search ${text.many}`}
              aria-label={`Search ${text.many}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            className="input elist-select"
            aria-label="Filter"
            value={filterValue}
            onChange={(e) => {
              const v = e.target.value
              setFilter(null)
              setStatFilter(null)
              if (v.startsWith(STAT_PREFIX)) setStatFilter({ stat: v.slice(STAT_PREFIX.length), min: null, max: null })
              else if (v) setFilter({ categoryId: v, value: null })
            }}
          >
            <option value="">All {text.many}</option>
            {shownCategories.length > 0 && (
              <optgroup label="Categories">
                {shownCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
            {statNames.length > 0 && (
              <optgroup label="Stats">
                {statNames.map((n) => (
                  <option key={n} value={`${STAT_PREFIX}${n}`}>
                    {n}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {filterCategory && (
            <select
              className="input elist-select"
              aria-label={`${filterCategory.name} value`}
              value={query.filter!.value ?? ''}
              onChange={(e) => setFilter({ categoryId: filterCategory.id, value: e.target.value || null })}
            >
              <option value="">Any value</option>
              {distinctValues(filterCategory, type, list).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
              <option value={EMPTY_FILTER}>(empty)</option>
            </select>
          )}
          {query.stat && (
            <span className="elist-range">
              <NumberInput
                className="input elist-num"
                ariaLabel={`${query.stat.stat} at least`}
                value={query.stat.min}
                onChange={(min) => setStatFilter({ ...query.stat!, min })}
              />
              <span aria-hidden>to</span>
              <NumberInput
                className="input elist-num"
                ariaLabel={`${query.stat.stat} at most`}
                value={query.stat.max}
                onChange={(max) => setStatFilter({ ...query.stat!, max })}
              />
            </span>
          )}
          <span className="elist-toolbar-gap" />
          <select className="input elist-select" aria-label="Sort by" value={query.sort} onChange={(e) => setPrefs({ sort: e.target.value as SortKey })}>
            <option value="name">Name</option>
            <option value="createdAt">Date added</option>
            <option value="updatedAt">Last changed</option>
            {shownCategories.length > 0 && (
              <optgroup label="Categories">
                {shownCategories.map((c) => (
                  <option key={c.id} value={`cat:${c.id}`}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
            {statNames.length > 0 && (
              <optgroup label="Stats">
                {statNames.map((n) => (
                  <option key={n} value={`${STAT_PREFIX}${n}`}>
                    {n}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button
            className="icon-btn"
            title={prefs.desc ? 'Descending' : 'Ascending'}
            aria-label={prefs.desc ? 'Sort descending' : 'Sort ascending'}
            onClick={() => setPrefs({ desc: !prefs.desc })}
          >
            {prefs.desc ? <ArrowUpZA size={16} /> : <ArrowDownAZ size={16} />}
          </button>
          <div className="elist-segmented" role="group" aria-label="View">
            <button className={`icon-btn${prefs.mode === 'grid' ? ' on' : ''}`} title="Cards" aria-label="Cards" aria-pressed={prefs.mode === 'grid'} onClick={() => setPrefs({ mode: 'grid' })}>
              <LayoutGrid size={15} />
            </button>
            <button className={`icon-btn${prefs.mode === 'table' ? ' on' : ''}`} title="Table" aria-label="Table" aria-pressed={prefs.mode === 'table'} onClick={() => setPrefs({ mode: 'table' })}>
              <Table2 size={15} />
            </button>
          </div>
          <button className="btn" onClick={() => setManaging(true)}>
            <Tags size={15} /> Categories
          </button>
          <button className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!actions.canUndo()} onClick={actions.undo}>
            <Undo2 size={15} />
          </button>
          <button className="icon-btn" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!actions.canRedo()} onClick={actions.redo}>
            <Redo2 size={15} />
          </button>
        </div>

        {liveSelected.length > 1 && (
          <div className="elist-bulk" role="region" aria-label={`Selected ${text.many}`}>
            <strong>{liveSelected.length} selected</strong>
            <select
              className="input elist-select"
              aria-label="Add category to selected"
              value=""
              onChange={(e) => e.target.value && actions.addCategoryTo(e.target.value, liveSelected)}
            >
              <option value="">Add category…</option>
              {categories
                .filter((c) => liveSelected.some((id) => !categoryAppliesTo(c, type, id)))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <select
              className="input elist-select"
              aria-label="Remove category from selected"
              value=""
              onChange={(e) => e.target.value && actions.removeCategoryFrom(e.target.value, liveSelected)}
            >
              <option value="">Remove category…</option>
              {categories
                .filter((c) => liveSelected.some((id) => categoryAppliesTo(c, type, id)))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <button className="btn btn-ghost elist-danger" onClick={() => void onDelete(liveSelected)}>
              <Trash2 size={14} /> Delete
            </button>
            <button className="icon-btn" title="Clear selection" aria-label="Clear selection" onClick={() => setSelected([])}>
              <X size={15} />
            </button>
          </div>
        )}

        <div className="elist-content">
          {list.length === 0 ? (
            <div className="elist-empty">
              <Icon size={40} strokeWidth={1.4} />
              <h3>No {text.many} yet</h3>
              <div>{text.emptyBody}</div>
              <button className="btn btn-primary" onClick={onAdd}>
                <Plus size={15} /> Add {text.one}
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="elist-empty">
              <div>No {text.many} match.</div>
              {hasFilters && (
                <button className="btn" onClick={clearFilters}>
                  Clear search and filter
                </button>
              )}
            </div>
          ) : prefs.mode === 'grid' ? (
            <Grid type={type} text={text} entities={visible} selected={liveSelected} focusId={focusId} onSelect={select} onToggle={toggle} cardMeta={cardMeta} />
          ) : (
            <Table
              type={type}
              text={text}
              entities={visible}
              selected={liveSelected}
              focusId={focusId}
              onSelect={select}
              onToggle={toggle}
              onSetSelected={setSelected}
              columns={columns}
              actions={actions}
              sort={query.sort}
              desc={prefs.desc}
              onSort={(sort) => setPrefs(sort === query.sort ? { desc: !prefs.desc } : { sort, desc: false })}
            />
          )}
        </div>
      </div>

      {focus && <div className="elist-detail-host" key={focus.id}>{renderDetail(focus, ctx(focus))}</div>}

      {managing && <CategoryManager type={type} categories={categories} onChange={actions.applyCategoryChange} onClose={() => setManaging(false)} />}
    </div>
  )
}

interface ViewProps<T extends EntityType> {
  type: T
  text: ListText
  entities: EntityOf<T>[]
  selected: Id[]
  focusId: Id | null
  onSelect(id: Id, e?: MouseEvent | KeyboardEvent): void
  onToggle(id: Id): void
}

const untitled = (text: ListText) => `Untitled ${text.one}`

/** Card grid. Shows up to three filled-in category values per card. */
function Grid<T extends EntityType>({ type, text, entities, selected, focusId, onSelect, onToggle, cardMeta }: ViewProps<T> & { cardMeta?(e: EntityOf<T>): string }) {
  const categories = useProjectStore((s) => s.categories)
  return (
    <div className="elist-grid" role="listbox" aria-multiselectable="true" aria-label={cap(text.many)}>
      {entities.map((entity) => {
        const chips = categories
          .filter((c) => categoryAppliesTo(c, type, entity.id))
          .map((c) => ({ c, v: formatValue(c, entity.categories[c.id]) }))
          .filter((x) => x.v)
          .slice(0, 3)
        const isSelected = selected.includes(entity.id)
        const meta = cardMeta?.(entity)
        // v0.6: rarity (or another styled category) frames the card and its picture.
        const look = entityLook(categories, type, entity)
        return (
          <div
            key={entity.id}
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
            className={`elist-card${isSelected ? ' selected' : ''}${entity.id === focusId ? ' focused' : ''}${look && look.style.border !== 'none' ? ' styled' : ''}`}
            style={frameStyle(look?.style)}
            onClick={(e) => onSelect(entity.id, e)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(entity.id, e)
              }
            }}
          >
            <input
              type="checkbox"
              className="elist-check"
              aria-label={`Select ${entity.name}`}
              checked={isSelected}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggle(entity.id)}
            />
            {entity.sprite ? <PixelSprite sprite={entity.sprite} size={72} /> : <AssetImage path={entity.image} alt={entity.name} size={72} />}
            <div className="elist-card-name" title={entity.name} style={look ? { color: look.style.color } : undefined}>
              {entity.name || untitled(text)}
            </div>
            {meta && <div className="elist-card-meta">{meta}</div>}
            {chips.length > 0 && (
              <div className="elist-chips">
                {chips.map(({ c, v }) => {
                  const style = styleOf(c, entity.categories[c.id])
                  return style ? (
                    <span key={c.id} title={[`${c.name}: ${v}`, ...fieldLines(c, style).map((f) => `${f.label}: ${f.value}`)].join(String.fromCharCode(10))}>
                      <StyleBadge style={style} label={v} small rating={ratingText(c, style)} />
                    </span>
                  ) : (
                    <span key={c.id} className="elist-chip" title={`${c.name}: ${v}`}>
                      {v}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Table with inline editing of category values. Click a header to sort. */
function Table<T extends EntityType>({
  type,
  text,
  entities,
  selected,
  focusId,
  onSelect,
  onToggle,
  onSetSelected,
  columns,
  actions,
  sort,
  desc,
  onSort,
}: ViewProps<T> & {
  onSetSelected(ids: Id[]): void
  columns: ExtraColumn<EntityOf<T>>[]
  actions: EntityActions<T>
  sort: SortKey
  desc: boolean
  onSort(s: SortKey): void
}) {
  const categories = useProjectStore((s) => s.categories)
  const catColumns = categories.filter((c) => isUsedFor(c, type))
  const allSelected = entities.length > 0 && entities.every((e) => selected.includes(e.id))
  const header = (key: SortKey | undefined, label: string, id: string) => (
    <th key={id} aria-sort={key && sort === key ? (desc ? 'descending' : 'ascending') : 'none'}>
      {key ? (
        <button className="elist-th" onClick={() => onSort(key)}>
          {label}
          {sort === key && <span aria-hidden>{desc ? ' ▾' : ' ▴'}</span>}
        </button>
      ) : (
        label
      )}
    </th>
  )
  return (
    <div className="elist-table-wrap">
      <table className="elist-table">
        <thead>
          <tr>
            <th className="elist-col-check">
              <input
                type="checkbox"
                aria-label={`Select all shown ${text.many}`}
                checked={allSelected}
                onChange={() => onSetSelected(allSelected ? [] : entities.map((e) => e.id))}
              />
            </th>
            <th className="elist-col-image" aria-label="Image" />
            {header('name', 'Name', 'name')}
            {columns.map((c) => header(c.sortKey, c.label, `x:${c.id}`))}
            {catColumns.map((c) => header(`cat:${c.id}`, c.name, c.id))}
          </tr>
        </thead>
        <tbody>
          {entities.map((entity) => {
            const isSelected = selected.includes(entity.id)
            return (
              <tr
                key={entity.id}
                className={`${isSelected ? 'selected' : ''}${entity.id === focusId ? ' focused' : ''}`}
                onClick={(e) => !isTyping(e.target) && onSelect(entity.id, e)}
              >
                <td className="elist-col-check">
                  <input
                    type="checkbox"
                    aria-label={`Select ${entity.name}`}
                    checked={isSelected}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggle(entity.id)}
                  />
                </td>
                <td className="elist-col-image">
                  {entity.sprite ? <PixelSprite sprite={entity.sprite} size={26} animate={false} /> : <AssetImage path={entity.image} alt={entity.name} size={26} />}
                </td>
                <td className="elist-col-name">
                  <TableName categories={categories} type={type} entity={entity} label={entity.name || untitled(text)} onClick={(e) => onSelect(entity.id, e)} />
                </td>
                {columns.map((c) => (
                  <td key={c.id}>{c.render(entity)}</td>
                ))}
                {catColumns.map((c) => (
                  <td key={c.id}>
                    {categoryAppliesTo(c, type, entity.id) ? (
                      <CategoryValueInput
                        category={c}
                        ariaLabel={`${entity.name} ${c.name}`}
                        value={entity.categories[c.id]}
                        onChange={(v) => actions.setCategoryValue(entity.id, c.id, v)}
                      />
                    ) : (
                      <span className="elist-muted" title={`Not on this ${text.one}`}>
                        —
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Name cell: colored and marked by the entity's rarity (v0.6). */
function TableName({ categories, type, entity, label, onClick }: { categories: Category[]; type: EntityType; entity: EntityBase; label: string; onClick: (e: React.MouseEvent) => void }) {
  const look = entityLook(categories, type, entity)
  return (
    <button className="elist-link" onClick={onClick} style={look ? { color: look.style.color } : undefined} title={look ? `${look.category.name}: ${look.value}` : undefined}>
      {look && <StyleMark style={look.style} />} {label}
    </button>
  )
}
