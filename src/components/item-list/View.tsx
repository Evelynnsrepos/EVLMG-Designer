import { ArrowDownAZ, ArrowUpZA, LayoutGrid, Package, Plus, Redo2, Search, Table2, Tags, Trash2, Undo2, X } from 'lucide-react'
import { PixelSprite } from '@/shared/pixel/PixelSprite'
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { categoryAppliesTo, type Id, type Item } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useProjectStore } from '@/core/state'
import {
  CategoryManager,
  CategoryValueInput,
  distinctValues,
  EMPTY_FILTER,
  formatValue,
  isUsedFor,
  type CategoryFilter,
} from '@/shared/categories'
import { entityLook, frameStyle, StyleBadge, fieldLines, ratingText, StyleMark, styleOf } from '@/shared/categories'
import { confirmDialog } from '@/shared/dialogs'
import { AssetImage } from '@/shared/AssetImage'
import { confirmEntityDelete } from '@/shared/entityDelete'
import { reportShownEntity, takeEntityFocus, useEntityNavigation } from '@/shared/entityList'
import {
  addCategoryToItems,
  addItem,
  applyCategoryChange,
  canRedo,
  canUndo,
  deleteItems,
  redo,
  removeCategoryFromItems,
  setCategoryValue,
  undo,
  useItemHistoryVersion,
} from './actions'
import { ItemDetail } from './ItemDetail'
import { DEFAULT_QUERY, droppedBy, queryItems, rangeBetween, type ItemQuery, type SortKey } from './query'
import './item-list.css'

const T = {
  addItem: 'Add item',
  search: 'Search items',
  filterAll: 'All items',
  anyValue: 'Any value',
  emptyValue: '(empty)',
  sortName: 'Name',
  sortCreated: 'Date added',
  sortUpdated: 'Last changed',
  grid: 'Cards',
  table: 'Table',
  categories: 'Categories',
  undo: 'Undo (Ctrl+Z)',
  redo: 'Redo (Ctrl+Y)',
  emptyTitle: 'No items yet',
  emptyBody: 'Add your first item: weapons, potions, quest objects, anything.',
  noMatch: 'No items match.',
  clearFilters: 'Clear search and filter',
  selected: (n: number) => `${n} selected`,
  addCategory: 'Add category…',
  removeCategory: 'Remove category…',
  deleteSelected: 'Delete',
  clearSelection: 'Clear selection',
  notShown: 'Not on this item',
}

type ViewMode = 'grid' | 'table'
interface Prefs {
  mode: ViewMode
  sort: SortKey
  desc: boolean
}

// View preferences are a per-computer convenience, not project data.
const PREFS_KEY = 'egd.item-list.prefs'
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) return { mode: 'grid', sort: 'name', desc: false, ...(JSON.parse(raw) as Partial<Prefs>) }
  } catch {
    // Storage unavailable: use defaults.
  }
  return { mode: 'grid', sort: 'name', desc: false }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    // Not important enough to report.
  }
}

const isTyping = (target: EventTarget) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]')

/** Item List (spec 8.4): every item in the game, with shared categories. */
export default function View({ active }: PanelProps) {
  const items = useProjectStore((s) => s.entities.item)
  const enemies = useProjectStore((s) => s.entities.enemy)
  const categories = useProjectStore((s) => s.categories)
  useItemHistoryVersion((s) => s.version)

  const [prefs, setPrefsState] = useState(loadPrefs)
  const setPrefs = (patch: Partial<Prefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<CategoryFilter | null>(null)
  const [selected, setSelected] = useState<Id[]>([])
  const [focusId, setFocusId] = useState<Id | null>(null)
  const [anchorId, setAnchorId] = useState<Id | null>(null)
  const [managing, setManaging] = useState(false)
  // A new item's name field gets focus so the user can type the name straight away.
  const [justAdded, setJustAdded] = useState<Id | null>(null)

  // Another tool asked to show one of our items ("Dropped by", wiki info box, [[link]]).
  // The request may arrive before this panel mounts, so check once on mount, then on every change.
  useEffect(() => {
    const take = () => {
      const req = takeEntityFocus('item')
      if (!req) return
      setSearch('')
      setFilter(null)
      setSelected([req.id])
      setAnchorId(req.id)
      setFocusId(req.id)
    }
    take()
    return useEntityNavigation.subscribe((s) => s.focus?.type === 'item' && take())
  }, [])

  useEffect(() => reportShownEntity('item', focusId), [focusId])
  useEffect(() => () => reportShownEntity('item', null), [])

  const itemCategories = useMemo(() => categories.filter((c) => isUsedFor(c, 'item')), [categories])
  const query: ItemQuery = { ...DEFAULT_QUERY, search, filter, sort: prefs.sort, desc: prefs.desc }
  // Ignore a sort or filter on a category that no longer exists.
  if (query.sort.startsWith('cat:') && !categories.some((c) => `cat:${c.id}` === query.sort)) query.sort = 'name'
  if (filter && !itemCategories.some((c) => c.id === filter.categoryId)) query.filter = null
  const visible = queryItems(items, categories, query)
  const allIds = useMemo(() => items.map((i) => i.id), [items])
  const liveSelected = selected.filter((id) => allIds.includes(id))
  const focus = items.find((i) => i.id === focusId) ?? null
  const statNames = useMemo(() => {
    const names = new Set<string>()
    for (const i of items) Object.keys(i.stats).forEach((n) => names.add(n))
    for (const e of enemies) Object.keys(e.stats).forEach((n) => names.add(n))
    return [...names].sort()
  }, [items, enemies])

  const select = (id: Id, e?: MouseEvent | KeyboardEvent) => {
    if (e && (e.ctrlKey || e.metaKey)) {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
      setAnchorId(id)
      return
    }
    if (e?.shiftKey && anchorId) {
      setSelected(rangeBetween(visible.map((i) => i.id), anchorId, id))
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

  const onAdd = () => {
    const item = addItem()
    setSearch('')
    setFilter(null)
    setSelected([item.id])
    setFocusId(item.id)
    setJustAdded(item.id)
  }

  const onDelete = useCallback(
    async (ids: Id[]) => {
      if (!ids.length) return
      // One item: list every place it is used (spec 3.3), not just drop tables.
      if (ids.length === 1) {
        if (!(await confirmEntityDelete('item', ids[0]))) return
        deleteItems(ids)
        setSelected([])
        if (focusId === ids[0]) setFocusId(null)
        return
      }
      const names = ids.map((id) => items.find((i) => i.id === id)?.name ?? '').filter(Boolean)
      const users = [...new Set(ids.flatMap((id) => droppedBy(id, enemies).map((d) => d.enemyName || 'Unnamed enemy')))]
      const what = ids.length === 1 ? `"${names[0]}"` : `${ids.length} items`
      const ok = await confirmDialog({
        title: `Delete ${what}?`,
        message: users.length
          ? `Used in the drop tables of: ${users.join(', ')}.\nThose rows will show a missing item. You can undo with Ctrl+Z.`
          : 'You can undo with Ctrl+Z.',
        confirmLabel: 'Delete',
        danger: true,
      })
      if (!ok) return
      deleteItems(ids)
      setSelected([])
      if (focusId && ids.includes(focusId)) setFocusId(null)
    },
    [items, enemies, focusId],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!active) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (mod && key === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
      return
    }
    if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault()
      redo()
      return
    }
    if (isTyping(e.target) || managing) return
    if (e.key === 'Delete' && liveSelected.length) {
      e.preventDefault()
      void onDelete(liveSelected)
    } else if (mod && key === 'a') {
      e.preventDefault()
      setSelected(visible.map((i) => i.id))
    } else if (e.key === 'Escape' && (liveSelected.length > 1 || focus)) {
      e.preventDefault() // ED-7: we used Esc, so the shell skips Layout Mode
      setSelected([])
      setFocusId(null)
    }
  }

  const hasFilters = search !== '' || query.filter !== null
  const filterCategory = query.filter ? itemCategories.find((c) => c.id === query.filter!.categoryId) : undefined

  return (
    <div className={`item-list${focus ? ' has-detail' : ''}`} onKeyDown={onKeyDown}>
      <div className="item-main">
        <div className="item-toolbar" role="toolbar" aria-label="Item List">
          <button className="btn btn-primary" onClick={onAdd}>
            <Plus size={15} /> {T.addItem}
          </button>
          <label className="item-search">
            <Search size={14} aria-hidden />
            <input className="input" type="search" placeholder={T.search} aria-label={T.search} value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select
            className="input item-select"
            aria-label="Filter by category"
            value={query.filter?.categoryId ?? ''}
            onChange={(e) => setFilter(e.target.value ? { categoryId: e.target.value, value: null } : null)}
          >
            <option value="">{T.filterAll}</option>
            {itemCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {filterCategory && (
            <select
              className="input item-select"
              aria-label={`${filterCategory.name} value`}
              value={query.filter!.value ?? ''}
              onChange={(e) => setFilter({ categoryId: filterCategory.id, value: e.target.value || null })}
            >
              <option value="">{T.anyValue}</option>
              {distinctValues(filterCategory, 'item', items).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
              <option value={EMPTY_FILTER}>{T.emptyValue}</option>
            </select>
          )}
          <span className="item-toolbar-gap" />
          <select className="input item-select" aria-label="Sort by" value={query.sort} onChange={(e) => setPrefs({ sort: e.target.value as SortKey })}>
            <option value="name">{T.sortName}</option>
            <option value="createdAt">{T.sortCreated}</option>
            <option value="updatedAt">{T.sortUpdated}</option>
            {itemCategories.map((c) => (
              <option key={c.id} value={`cat:${c.id}`}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            title={prefs.desc ? 'Descending' : 'Ascending'}
            aria-label={prefs.desc ? 'Sort descending' : 'Sort ascending'}
            onClick={() => setPrefs({ desc: !prefs.desc })}
          >
            {prefs.desc ? <ArrowUpZA size={16} /> : <ArrowDownAZ size={16} />}
          </button>
          <div className="item-segmented" role="group" aria-label="View">
            <button className={`icon-btn${prefs.mode === 'grid' ? ' on' : ''}`} title={T.grid} aria-label={T.grid} aria-pressed={prefs.mode === 'grid'} onClick={() => setPrefs({ mode: 'grid' })}>
              <LayoutGrid size={15} />
            </button>
            <button className={`icon-btn${prefs.mode === 'table' ? ' on' : ''}`} title={T.table} aria-label={T.table} aria-pressed={prefs.mode === 'table'} onClick={() => setPrefs({ mode: 'table' })}>
              <Table2 size={15} />
            </button>
          </div>
          <button className="btn" onClick={() => setManaging(true)}>
            <Tags size={15} /> {T.categories}
          </button>
          <button className="icon-btn" title={T.undo} aria-label={T.undo} disabled={!canUndo()} onClick={undo}>
            <Undo2 size={15} />
          </button>
          <button className="icon-btn" title={T.redo} aria-label={T.redo} disabled={!canRedo()} onClick={redo}>
            <Redo2 size={15} />
          </button>
        </div>

        {liveSelected.length > 1 && (
          <div className="item-bulk" role="region" aria-label="Selected items">
            <strong>{T.selected(liveSelected.length)}</strong>
            <select
              className="input item-select"
              aria-label={T.addCategory}
              value=""
              onChange={(e) => e.target.value && addCategoryToItems(e.target.value, liveSelected)}
            >
              <option value="">{T.addCategory}</option>
              {categories
                .filter((c) => liveSelected.some((id) => !categoryAppliesTo(c, 'item', id)))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <select
              className="input item-select"
              aria-label={T.removeCategory}
              value=""
              onChange={(e) => e.target.value && removeCategoryFromItems(e.target.value, liveSelected)}
            >
              <option value="">{T.removeCategory}</option>
              {categories
                .filter((c) => liveSelected.some((id) => categoryAppliesTo(c, 'item', id)))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <button className="btn btn-ghost item-danger" onClick={() => void onDelete(liveSelected)}>
              <Trash2 size={14} /> {T.deleteSelected}
            </button>
            <button className="icon-btn" title={T.clearSelection} aria-label={T.clearSelection} onClick={() => setSelected([])}>
              <X size={15} />
            </button>
          </div>
        )}

        <div className="item-content">
          {items.length === 0 ? (
            <div className="item-empty">
              <Package size={40} strokeWidth={1.4} />
              <h3>{T.emptyTitle}</h3>
              <div>{T.emptyBody}</div>
              <button className="btn btn-primary" onClick={onAdd}>
                <Plus size={15} /> {T.addItem}
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="item-empty">
              <div>{T.noMatch}</div>
              {hasFilters && (
                <button
                  className="btn"
                  onClick={() => {
                    setSearch('')
                    setFilter(null)
                  }}
                >
                  {T.clearFilters}
                </button>
              )}
            </div>
          ) : prefs.mode === 'grid' ? (
            <ItemGrid items={visible} selected={liveSelected} focusId={focusId} onSelect={select} onToggle={toggle} onSetSelected={setSelected} />
          ) : (
            <ItemTable
              items={visible}
              selected={liveSelected}
              focusId={focusId}
              onSelect={select}
              onToggle={toggle}
              onSetSelected={setSelected}
              sort={query.sort}
              desc={prefs.desc}
              onSort={(sort) => setPrefs(sort === query.sort ? { desc: !prefs.desc } : { sort, desc: false })}
            />
          )}
        </div>
      </div>

      {focus && (
        <ItemDetail
          key={focus.id}
          item={focus}
          categories={categories}
          allIds={allIds}
          enemies={enemies}
          statNames={statNames}
          autoFocusName={focus.id === justAdded}
          onBack={() => setFocusId(null)}
          onDelete={() => void onDelete([focus.id])}
          onSelect={(id) => {
            setSelected([id])
            setFocusId(id)
          }}
          onManageCategories={() => setManaging(true)}
        />
      )}

      {managing && <CategoryManager type="item" categories={categories} onChange={applyCategoryChange} onClose={() => setManaging(false)} />}
    </div>
  )
}

interface ListProps {
  items: Item[]
  selected: Id[]
  focusId: Id | null
  onSelect: (id: Id, e?: MouseEvent | KeyboardEvent) => void
  onToggle: (id: Id) => void
  onSetSelected: (ids: Id[]) => void
}

/** Card grid (IT-8). Shows up to three filled-in category values per card. */
function ItemGrid({ items, selected, focusId, onSelect, onToggle }: ListProps) {
  const categories = useProjectStore((s) => s.categories)
  return (
    <div className="item-grid" role="listbox" aria-multiselectable="true" aria-label="Items">
      {items.map((item) => {
        const chips = categories
          .filter((c) => categoryAppliesTo(c, 'item', item.id))
          .map((c) => ({ c, v: formatValue(c, item.categories[c.id]) }))
          .filter((x) => x.v)
          .slice(0, 3)
        const isSelected = selected.includes(item.id)
        // v0.6: the rarity frames the card.
        const look = entityLook(categories, 'item', item)
        return (
          <div
            key={item.id}
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
            className={`item-card${isSelected ? ' selected' : ''}${item.id === focusId ? ' focused' : ''}`}
            style={frameStyle(look?.style)}
            onClick={(e) => onSelect(item.id, e)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(item.id, e)
              }
            }}
          >
            <input
              type="checkbox"
              className="item-check"
              aria-label={`Select ${item.name}`}
              checked={isSelected}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggle(item.id)}
            />
            {item.sprite ? <PixelSprite sprite={item.sprite} size={72} /> : <AssetImage path={item.image} alt={item.name} size={72} />}
            <div className="item-card-name" title={item.name} style={look ? { color: look.style.color } : undefined}>
              {item.name || 'Untitled item'}
            </div>
            {chips.length > 0 && (
              <div className="item-chips">
                {chips.map(({ c, v }) => {
                  const style = styleOf(c, item.categories[c.id])
                  return style ? (
                    <span key={c.id} title={[`${c.name}: ${v}`, ...fieldLines(c, style).map((f) => `${f.label}: ${f.value}`)].join(String.fromCharCode(10))}>
                      <StyleBadge style={style} label={v} small rating={ratingText(c, style)} />
                    </span>
                  ) : (
                    <span key={c.id} className="item-chip" title={`${c.name}: ${v}`}>
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

/** Table view with inline editing of category values (IT-8). Click a header to sort. */
function ItemTable({ items, selected, focusId, onSelect, onToggle, onSetSelected, sort, desc, onSort }: ListProps & { sort: SortKey; desc: boolean; onSort: (s: SortKey) => void }) {
  const categories = useProjectStore((s) => s.categories)
  const columns = categories.filter((c) => isUsedFor(c, 'item'))
  const allSelected = items.length > 0 && items.every((i) => selected.includes(i.id))
  const header = (key: SortKey, label: string) => (
    <th aria-sort={sort === key ? (desc ? 'descending' : 'ascending') : 'none'}>
      <button className="item-th" onClick={() => onSort(key)}>
        {label}
        {sort === key && <span aria-hidden>{desc ? ' ▾' : ' ▴'}</span>}
      </button>
    </th>
  )
  return (
    <div className="item-table-wrap">
      <table className="item-table">
        <thead>
          <tr>
            <th className="item-col-check">
              <input
                type="checkbox"
                aria-label="Select all shown items"
                checked={allSelected}
                onChange={() => onSetSelected(allSelected ? [] : items.map((i) => i.id))}
              />
            </th>
            <th className="item-col-image" aria-label="Image" />
            {header('name', 'Name')}
            {columns.map((c) => (
              <th key={c.id} aria-sort={sort === `cat:${c.id}` ? (desc ? 'descending' : 'ascending') : 'none'}>
                <button className="item-th" onClick={() => onSort(`cat:${c.id}`)}>
                  {c.name}
                  {sort === `cat:${c.id}` && <span aria-hidden>{desc ? ' ▾' : ' ▴'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isSelected = selected.includes(item.id)
            return (
              <tr
                key={item.id}
                className={`${isSelected ? 'selected' : ''}${item.id === focusId ? ' focused' : ''}`}
                onClick={(e) => !isTyping(e.target) && onSelect(item.id, e)}
              >
                <td className="item-col-check">
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.name}`}
                    checked={isSelected}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggle(item.id)}
                  />
                </td>
                <td className="item-col-image">
                  {item.sprite ? <PixelSprite sprite={item.sprite} size={26} animate={false} /> : <AssetImage path={item.image} alt={item.name} size={26} />}
                </td>
                <td className="item-col-name">
                  <ItemName item={item} onClick={(e) => onSelect(item.id, e)} />
                </td>
                {columns.map((c) => (
                  <td key={c.id}>
                    {categoryAppliesTo(c, 'item', item.id) ? (
                      <CategoryValueInput category={c} ariaLabel={`${item.name} ${c.name}`} value={item.categories[c.id]} onChange={(v) => setCategoryValue(item.id, c.id, v)} />
                    ) : (
                      <span className="item-muted" title={T.notShown}>
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

/** Name cell, colored and marked by rarity (v0.6). */
function ItemName({ item, onClick }: { item: Item; onClick: (e: MouseEvent) => void }) {
  const look = entityLook(useProjectStore((s) => s.categories), 'item', item)
  return (
    <button className="item-link" onClick={onClick} style={look ? { color: look.style.color } : undefined}>
      {look && <StyleMark style={look.style} />} {item.name || 'Untitled item'}
    </button>
  )
}
