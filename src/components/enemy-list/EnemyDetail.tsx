import { Clock, ExternalLink, MapPin, Package, Plus, Shield, Swords, TrendingUp, X } from 'lucide-react'
import { useState } from 'react'
import type { DropRow, Enemy, StatGrowth } from '@/core/model'
import { useProjectStore } from '@/core/state'
import { BehaviourSection } from '@/components/behaviour/BehaviourSection'
import { NumberInput } from '@/shared/categories'
import { DetailFrame, EntityPicker, enemyStatsAtLevel, formatStat, Section, StatsEditor, type DetailContext, type ListText } from '@/shared/entityList'
import { enemyActions as actions, goTo, newDropRow, openWiki } from './actions'
import { dropItemName, elementSuggestions, expectedPerDefeat, nextKey, normalizeDrop, renameKey, resistanceLabel } from './drops'

export function EnemyDetail({ enemy, ctx, text }: { enemy: Enemy; ctx: DetailContext; text: ListText }) {
  const update = (patch: Partial<Enemy>, group: string | null = null) => actions.update(enemy.id, patch, group)
  return (
    <DetailFrame type="enemy" entity={enemy} actions={actions} ctx={ctx} text={text} onOpenWiki={() => openWiki('enemy', enemy.id)}>
      <CombatSection enemy={enemy} update={update} />
      <ResistanceSection enemy={enemy} update={update} />
      <DropSection enemy={enemy} update={update} />
      <TimeSection enemy={enemy} update={update} />
      <FoundInSection enemy={enemy} update={update} />
      <BehaviourSection type="enemy" id={enemy.id} />
    </DetailFrame>
  )
}

type Update = (patch: Partial<Enemy>, group?: string | null) => void

/** Level range, stats at level 1 and growth per level (EN-3). */
function CombatSection({ enemy, update }: { enemy: Enemy; update: Update }) {
  const allEnemies = useProjectStore((s) => s.entities.enemy)
  const items = useProjectStore((s) => s.entities.item)
  const suggestions = [...new Set(['HP', 'ATK', 'DEF', 'SPD', 'MP', ...allEnemies.flatMap((e) => Object.keys(e.stats ?? {})), ...items.flatMap((i) => Object.keys(i.stats ?? {}))])]
  const stats = enemy.stats ?? {}
  const growth = enemy.growth ?? []
  const [previewLevel, setPreviewLevel] = useState<number | null>(null)
  const level = previewLevel ?? enemy.levelMax

  const setLevels = (min: number | null, max: number | null) => {
    const lo = Math.max(1, Math.round(min ?? enemy.levelMin))
    const hi = Math.max(lo, Math.round(max ?? enemy.levelMax))
    update({ levelMin: lo, levelMax: hi }, `level:${enemy.id}`)
  }
  const setStats = (next: Enemy['stats'], group?: string) => {
    // Keep growth rows pointing at renamed stats, drop rows for removed ones.
    const before = Object.keys(stats)
    const after = Object.keys(next)
    const renamed = before.length === after.length ? before.map((k, i) => [k, after[i]] as const).filter(([a, b]) => a !== b) : []
    let nextGrowth = growth
    if (renamed.length === 1) nextGrowth = growth.map((g) => (g.stat === renamed[0][0] ? { ...g, stat: renamed[0][1] } : g))
    else if (after.length < before.length) nextGrowth = growth.filter((g) => after.includes(g.stat))
    update(nextGrowth === growth ? { stats: next } : { stats: next, growth: nextGrowth }, group ?? null)
  }
  const setGrowth = (next: StatGrowth[], group?: string) => update({ growth: next }, group ?? null)
  const freeStat = Object.keys(stats).find((s) => !growth.some((g) => g.stat === s))
  const atLevel = enemyStatsAtLevel(enemy, level)

  return (
    <>
      <Section label="Level" icon={<Swords size={13} aria-hidden />}>
        <div className="enemy-inline">
          <NumberInput ariaLabel="Lowest level" className="input cat-input enemy-num" value={enemy.levelMin} onChange={(v) => v !== null && setLevels(v, Math.max(v, enemy.levelMax))} />
          <span className="elist-muted">to</span>
          <NumberInput ariaLabel="Highest level" className="input cat-input enemy-num" value={enemy.levelMax} onChange={(v) => v !== null && setLevels(Math.min(enemy.levelMin, v), v)} />
        </div>
      </Section>

      <Section label="Stats at level 1">
        <StatsEditor
          stats={stats}
          onChange={setStats}
          suggestions={suggestions}
          idPrefix={`enemy-${enemy.id}`}
          hint="HP, ATK, DEF or any custom stat. The calculators use these."
        />
      </Section>

      <Section label="Growth per level" icon={<TrendingUp size={13} aria-hidden />}>
        <div className="elist-rows">
          {growth.length === 0 && <div className="elist-muted">Stats stay the same at every level. Add growth to make them rise.</div>}
          {growth.map((g, i) => (
            <div className="elist-row enemy-growth-row" key={`${g.stat}:${i}`}>
              <select
                className="input cat-input"
                aria-label="Stat that grows"
                value={g.stat}
                onChange={(e) => setGrowth(growth.map((x, j) => (j === i ? { ...x, stat: e.target.value } : x)))}
              >
                {!Object.hasOwn(stats, g.stat) && <option value={g.stat}>{g.stat} (missing)</option>}
                {Object.keys(stats)
                  .filter((s) => s === g.stat || !growth.some((x) => x.stat === s))
                  .map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
              </select>
              <NumberInput
                ariaLabel={`${g.stat} growth per level`}
                value={g.perLevel}
                onChange={(v) => v !== null && setGrowth(growth.map((x, j) => (j === i ? { ...x, perLevel: v } : x)), `growth:${enemy.id}:${i}`)}
              />
              <select
                className="input cat-input"
                aria-label={`${g.stat} growth kind`}
                value={g.mode}
                onChange={(e) => setGrowth(growth.map((x, j) => (j === i ? { ...x, mode: e.target.value as StatGrowth['mode'] } : x)))}
              >
                <option value="flat">+ per level</option>
                <option value="percent">% per level</option>
              </select>
              <button className="icon-btn" title="Remove growth" aria-label={`Remove ${g.stat} growth`} onClick={() => setGrowth(growth.filter((_, j) => j !== i))}>
                <X size={14} />
              </button>
            </div>
          ))}
          {freeStat && (
            <button className="btn btn-ghost elist-add-row" onClick={() => setGrowth([...growth, { stat: freeStat, mode: 'flat', perLevel: 0 }])}>
              <Plus size={14} /> Add growth
            </button>
          )}
          {Object.keys(stats).length > 0 && (
            <div className="enemy-preview">
              <label className="enemy-inline">
                <span className="elist-muted">At level</span>
                <NumberInput ariaLabel="Preview level" className="input cat-input enemy-num" value={level} onChange={(v) => setPreviewLevel(v === null ? null : Math.max(1, Math.round(v)))} />
              </label>
              <div className="enemy-preview-stats">
                {Object.entries(atLevel).map(([k, v]) => (
                  <span key={k} className="elist-chip">
                    {k} {formatStat(v)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>
    </>
  )
}

/** Damage multipliers per element or type: 1 normal, 2 weak, 0.5 resists, 0 immune (EN-3). */
function ResistanceSection({ enemy, update }: { enemy: Enemy; update: Update }) {
  const categories = useProjectStore((s) => s.categories)
  const enemies = useProjectStore((s) => s.entities.enemy)
  const resistances = enemy.resistances ?? {}
  const suggestions = elementSuggestions(categories, enemies).filter((n) => !Object.hasOwn(resistances, n))
  const listId = `enemy-elements-${enemy.id}`
  const set = (next: Record<string, number>, group?: string) => update({ resistances: next }, group ?? null)
  return (
    <Section label="Resistances and weaknesses" icon={<Shield size={13} aria-hidden />}>
      <div className="elist-rows">
        <div className="elist-muted">Damage multiplier: 2 = weak (double damage), 0.5 = resists, 0 = immune.</div>
        {Object.entries(resistances).map(([name, mult]) => (
          <ResistanceRow key={`${enemy.id}:${name}`} name={name} mult={mult} resistances={resistances} listId={listId} onChange={set} groupPrefix={`res:${enemy.id}`} />
        ))}
        <datalist id={listId}>
          {suggestions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <button className="btn btn-ghost elist-add-row" onClick={() => set({ ...resistances, [nextKey(resistances, suggestions[0] ?? 'Fire')]: 1 })}>
          <Plus size={14} /> Add resistance
        </button>
      </div>
    </Section>
  )
}

function ResistanceRow({
  name,
  mult,
  resistances,
  listId,
  onChange,
  groupPrefix,
}: {
  name: string
  mult: number
  resistances: Record<string, number>
  listId: string
  onChange(next: Record<string, number>, group?: string): void
  groupPrefix: string
}) {
  const [draft, setDraft] = useState(name)
  const commit = () => {
    const next = renameKey(resistances, name, draft)
    if (next && next !== resistances) onChange(next)
    else setDraft(name)
  }
  return (
    <div className="elist-row enemy-res-row">
      <input
        className="input cat-input"
        aria-label="Element or damage type"
        list={listId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      <NumberInput ariaLabel={`${name} multiplier`} value={mult} onChange={(v) => v !== null && onChange({ ...resistances, [name]: v }, `${groupPrefix}:${name}`)} />
      <span className={`enemy-res-tag enemy-res-${resistanceLabel(mult).toLowerCase()}`}>{resistanceLabel(mult)}</span>
      <button
        className="icon-btn"
        title={`Remove ${name}`}
        aria-label={`Remove ${name}`}
        onClick={() => {
          const { [name]: _removed, ...rest } = resistances
          onChange(rest)
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}

/** Drop table: item from the Item List, amount (fixed or min–max), chance % (EN-4). */
function DropSection({ enemy, update }: { enemy: Enemy; update: Update }) {
  const items = useProjectStore((s) => s.entities.item)
  const rows = enemy.dropTable ?? []
  const set = (next: DropRow[], group?: string) => update({ dropTable: next }, group ?? null)
  const patch = (id: string, p: Partial<DropRow>, group?: string) => set(rows.map((r) => (r.id === id ? normalizeDrop({ ...r, ...p }) : r)), group)
  return (
    <Section label="Drop table" icon={<Package size={13} aria-hidden />}>
      <div className="elist-rows">
        {rows.length === 0 && (
          <div className="elist-muted">{items.length ? 'Nothing drops yet.' : 'Nothing drops yet. Add items in the Item List first, then pick them here.'}</div>
        )}
        {rows.length > 0 && (
          <div className="elist-row enemy-drop-row enemy-drop-head" aria-hidden>
            <span>Item</span>
            <span>Min</span>
            <span>Max</span>
            <span>Chance %</span>
            <span />
            <span />
          </div>
        )}
        {rows.map((row) => {
          const name = dropItemName(row, items)
          const exists = items.some((i) => i.id === row.itemId)
          return (
            <div className="elist-row enemy-drop-row" key={row.id} title={`About ${formatStat(expectedPerDefeat(row))} per defeat`}>
              <EntityPicker
                types={['item']}
                value={{ type: 'item', id: row.itemId }}
                ariaLabel="Dropped item"
                placeholder="Choose item…"
                onChange={(t) => patch(row.id, { itemId: t.id })}
              />
              <NumberInput ariaLabel={`${name} amount at least`} value={row.amountMin} onChange={(v) => v !== null && patch(row.id, { amountMin: v, amountMax: Math.max(v, row.amountMax) }, `drop:${row.id}:min`)} />
              <NumberInput ariaLabel={`${name} amount at most`} value={row.amountMax} onChange={(v) => v !== null && patch(row.id, { amountMax: v }, `drop:${row.id}:max`)} />
              <NumberInput ariaLabel={`${name} drop chance percent`} value={row.chancePercent} onChange={(v) => v !== null && patch(row.id, { chancePercent: v }, `drop:${row.id}:chance`)} />
              <button className="icon-btn" title={exists ? `Open ${name}` : 'Nothing to open'} aria-label={exists ? `Open ${name}` : 'Nothing to open'} disabled={!exists} onClick={() => goTo('item', row.itemId)}>
                <ExternalLink size={14} />
              </button>
              <button className="icon-btn" title="Remove drop" aria-label={`Remove ${name} drop`} onClick={() => set(rows.filter((r) => r.id !== row.id))}>
                <X size={14} />
              </button>
            </div>
          )
        })}
        <button className="btn btn-ghost elist-add-row" onClick={() => set([...rows, newDropRow(items.length === 1 ? items[0].id : '')])}>
          <Plus size={14} /> Add drop
        </button>
      </div>
    </Section>
  )
}

/** Time to defeat and respawn/limit info for the Resource Calculator (EN-5). */
function TimeSection({ enemy, update }: { enemy: Enemy; update: Update }) {
  return (
    <Section label="Farming" icon={<Clock size={13} aria-hidden />}>
      <div className="cat-field">
        <label htmlFor={`enemy-ttd-${enemy.id}`}>Time to defeat (s)</label>
        <NumberInput id={`enemy-ttd-${enemy.id}`} value={enemy.timeToDefeatSeconds} onChange={(v) => update({ timeToDefeatSeconds: v === null ? null : Math.max(0, v) }, `ttd:${enemy.id}`)} />
        <span />
      </div>
      <div className="cat-field">
        <label htmlFor={`enemy-respawn-${enemy.id}`}>Respawn / limit</label>
        <input
          id={`enemy-respawn-${enemy.id}`}
          className="input cat-input"
          placeholder="e.g. boss, once per week"
          value={enemy.respawnNote ?? ''}
          onChange={(e) => update({ respawnNote: e.target.value }, `respawn:${enemy.id}`)}
        />
        <span />
      </div>
    </Section>
  )
}

/** Towns where the enemy appears (EN-6). Map locations join once the Map Creator exists. */
function FoundInSection({ enemy, update }: { enemy: Enemy; update: Update }) {
  const towns = useProjectStore((s) => s.entities.town)
  const foundIn = enemy.foundIn ?? []
  return (
    <Section label="Found in" icon={<MapPin size={13} aria-hidden />}>
      <div className="elist-rows">
        {foundIn.length === 0 && <div className="elist-muted">{towns.length ? 'Not placed anywhere yet.' : 'Add towns in the Town List, then pick where this enemy appears.'}</div>}
        {foundIn.length > 0 && (
          <div className="enemy-chips">
            {foundIn.map((id) => {
              const town = towns.find((t) => t.id === id)
              return (
                <span key={id} className={`enemy-town${town ? '' : ' missing'}`}>
                  {town ? (
                    <button className="elist-link" onClick={() => goTo('town', id)}>
                      {town.name || 'Untitled town'}
                    </button>
                  ) : (
                    'Missing town'
                  )}
                  <button className="icon-btn" title="Remove" aria-label={`Remove ${town?.name ?? 'missing town'}`} onClick={() => update({ foundIn: foundIn.filter((x) => x !== id) })}>
                    <X size={12} />
                  </button>
                </span>
              )
            })}
          </div>
        )}
        {towns.some((t) => !foundIn.includes(t.id)) && (
          <EntityPicker
            types={['town']}
            value={null}
            exclude={foundIn}
            ariaLabel="Add a town where this enemy appears"
            placeholder="Add town…"
            onChange={(t) => update({ foundIn: [...foundIn, t.id] })}
          />
        )}
      </div>
    </Section>
  )
}
