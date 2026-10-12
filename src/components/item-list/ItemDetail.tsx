import { ArrowLeft, BookOpen, Copy, Plus, Skull, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Category, Enemy, Id, Item } from '@/core/model'
import { CategoryFields, entityLook, frameStyle, NumberInput } from '@/shared/categories'
import { ImagePicker, JumpBar, openEntity, UsedIn } from '@/shared/entityList'
import { openWikiArticleForEntity } from '@/shared/wiki'
import { duplicateItem, setCategories, setCategoryValue, updateItem } from './actions'
import { droppedBy, formatDrop, nextStatName, renameStat } from './query'
import { ProofTextarea } from '@/shared/spell'
import { PixelSprite, SpritePicker } from '@/shared/pixel/PixelSprite'
import { ReviewButton } from '@/shared/reviews'

const T = {
  back: 'Back to list',
  name: 'Name',
  nameRequired: 'An item needs a name.',
  description: 'Description',
  notes: 'Notes',
  categories: 'Categories',
  stats: 'Numbers',
  statsHint: 'Named numbers the calculators can use, e.g. upgrade cost or attack.',
  addStat: 'Add number',
  droppedBy: 'Dropped by',
  droppedByEmpty: 'No enemy drops this item yet. Add it to a drop table in the Enemy List.',
  wiki: 'Open or create wiki article',
  duplicate: 'Duplicate',
  delete: 'Delete',
  fallbackName: 'Untitled item',
}

export function ItemDetail({
  item,
  categories,
  allIds,
  enemies,
  statNames,
  autoFocusName = false,
  onBack,
  onDelete,
  onSelect,
  onManageCategories,
}: {
  item: Item
  categories: Category[]
  allIds: Id[]
  enemies: Enemy[]
  /** Stat names used anywhere in the project, offered as suggestions. */
  statNames: string[]
  autoFocusName?: boolean
  onBack: () => void
  onDelete: () => void
  onSelect: (id: Id) => void
  onManageCategories: () => void
}) {
  const drops = useMemo(() => droppedBy(item.id, enemies), [item.id, enemies])
  const nameEmpty = item.name.trim() === ''

  return (
    <aside className="item-detail" aria-label={`Item ${item.name}`}>
      <div className="item-detail-top">
        <button className="icon-btn item-detail-back" title={T.back} aria-label={T.back} onClick={onBack}>
          <ArrowLeft size={16} />
        </button>
        <span style={{ flex: 1 }} />
        <ReviewButton target={{ kind: 'entity', type: 'item', id: item.id }} title={item.name || 'Untitled item'} />
        <button
          className="icon-btn"
          title={T.duplicate}
          aria-label={T.duplicate}
          onClick={() => {
            const copy = duplicateItem(item.id)
            if (copy) onSelect(copy.id)
          }}
        >
          <Copy size={15} />
        </button>
        <button className="icon-btn" title={T.wiki} aria-label={T.wiki} onClick={() => openWikiArticleForEntity('item', item.id)}>
          <BookOpen size={15} />
        </button>
        <button className="icon-btn item-danger" title={T.delete} aria-label={T.delete} onClick={onDelete}>
          <Trash2 size={15} />
        </button>
      </div>

      <JumpBar type="item" entity={item} onConnect={(connections) => updateItem(item.id, { connections })} />

      <div className="item-detail-head">
        <div className="item-detail-image" style={frameStyle(entityLook(categories, 'item', item)?.style)}>
          {item.sprite ? <PixelSprite sprite={item.sprite} size={120} /> : <ImagePicker path={item.image} alt={item.name} onChange={(image) => updateItem(item.id, { image })} />}
          <SpritePicker sprite={item.sprite} onChange={(sprite) => updateItem(item.id, { sprite })} />
        </div>
        <div className="item-detail-name">
          <label className="item-label" htmlFor={`item-name-${item.id}`}>
            {T.name}
          </label>
          <input
            id={`item-name-${item.id}`}
            className={`input item-name-input${nameEmpty ? ' invalid' : ''}`}
            value={item.name}
            aria-invalid={nameEmpty}
            autoFocus={autoFocusName}
            onFocus={(e) => autoFocusName && e.target.select()}
            onChange={(e) => updateItem(item.id, { name: e.target.value }, `name:${item.id}`)}
            onBlur={() => nameEmpty && updateItem(item.id, { name: T.fallbackName }, `name:${item.id}`)}
          />
          {nameEmpty && <div className="item-error">{T.nameRequired}</div>}
        </div>
      </div>

      <section className="item-section">
        <label className="item-label" htmlFor={`item-desc-${item.id}`}>
          {T.description}
        </label>
        <ProofTextarea
          id={`item-desc-${item.id}`}
          className="input item-textarea"
          rows={3}
          value={item.description}
          onChange={(e) => updateItem(item.id, { description: e.target.value }, `description:${item.id}`)}
        />
      </section>

      <section className="item-section">
        <div className="item-label">{T.categories}</div>
        <CategoryFields
          type="item"
          entity={item}
          allIds={allIds}
          categories={categories}
          onValueChange={(categoryId, value) => setCategoryValue(item.id, categoryId, value)}
          onCategoriesChange={setCategories}
          onManage={onManageCategories}
        />
      </section>

      <section className="item-section">
        <div className="item-label">{T.stats}</div>
        <StatsEditor item={item} statNames={statNames} />
      </section>

      <section className="item-section">
        <div className="item-label">
          <Skull size={13} aria-hidden /> {T.droppedBy}
        </div>
        {drops.length === 0 ? (
          <div className="item-muted">{T.droppedByEmpty}</div>
        ) : (
          <ul className="item-drops">
            {drops.map((d, i) => (
              <li key={`${d.enemyId}-${i}`}>
                <button className="item-link" onClick={() => openEntity('enemy', d.enemyId)}>
                  {d.enemyName || 'Unnamed enemy'}
                </button>
                <span className="item-muted">{formatDrop(d)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="item-section">
        <div className="item-label">Used in</div>
        <UsedIn id={item.id} />
      </section>

      <section className="item-section">
        <label className="item-label" htmlFor={`item-notes-${item.id}`}>
          {T.notes}
        </label>
        <ProofTextarea
          id={`item-notes-${item.id}`}
          className="input item-textarea"
          rows={4}
          value={item.notes}
          onChange={(e) => updateItem(item.id, { notes: e.target.value }, `notes:${item.id}`)}
        />
      </section>
    </aside>
  )
}

/** Named numbers for calculators (IT-9). Keys keep their order; renames commit on blur or Enter. */
function StatsEditor({ item, statNames }: { item: Item; statNames: string[] }) {
  const entries = Object.entries(item.stats)
  const listId = `item-stat-names-${item.id}`
  return (
    <div className="item-stats">
      <div className="item-muted">{T.statsHint}</div>
      {entries.map(([name, value]) => (
        <StatRow key={`${item.id}:${name}`} item={item} name={name} value={value} listId={listId} />
      ))}
      <datalist id={listId}>
        {statNames
          .filter((n) => !Object.hasOwn(item.stats, n))
          .map((n) => (
            <option key={n} value={n} />
          ))}
      </datalist>
      <button
        className="btn btn-ghost item-add-stat"
        onClick={() => updateItem(item.id, { stats: { ...item.stats, [nextStatName(item.stats)]: 0 } })}
      >
        <Plus size={14} /> {T.addStat}
      </button>
    </div>
  )
}

function StatRow({ item, name, value, listId }: { item: Item; name: string; value: number; listId: string }) {
  const [draft, setDraft] = useState(name)
  const commit = () => {
    const next = renameStat(item.stats, name, draft)
    if (next && next !== item.stats) updateItem(item.id, { stats: next })
    else setDraft(name)
  }
  return (
    <div className="item-stat">
      <input
        className="input cat-input"
        aria-label="Number name"
        list={listId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      <NumberInput
        ariaLabel={`${name} value`}
        value={value}
        onChange={(v) => v !== null && updateItem(item.id, { stats: { ...item.stats, [name]: v } }, `stat:${item.id}:${name}`)}
      />
      <button
        className="icon-btn"
        title={`Remove ${name}`}
        aria-label={`Remove ${name}`}
        onClick={() => {
          const { [name]: _removed, ...rest } = item.stats
          updateItem(item.id, { stats: rest })
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}
