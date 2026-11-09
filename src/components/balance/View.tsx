import { ExternalLink } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { abilityStats, createAbilitiesDoc, type AbilitiesDoc, type Ability } from '@/components/abilities/model'
import { createCustomListDoc, type CustomListDoc } from '@/components/custom-list/model'
import { useDamagePresets } from '@/shared/calculators'
import { useItems } from '@/shared/listDetail'
import type { Enemy, Entity, EntityType, Item } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { loadDocumentNow, useProjectStore } from '@/core/state'
import { LineChart } from '@/shared/calculators'
import { entityLook } from '@/shared/categories'
import { openEntity } from '@/shared/entityList'
import { formatNumber } from '@/shared/formulas'
import '@/shared/listDetail/listDetail.css'
import { curve, outliers, type Point } from './model'
import './balance.css'

/** Balance dashboard (v0.10): outliers in item and enemy numbers, and the enemy difficulty curve. */
export default function View(_props: PanelProps) {
  const entities = useProjectStore((s) => s.entities)
  const categories = useProjectStore((s) => s.categories)
  const items = entities.item as Item[]
  const enemies = entities.enemy as Enemy[]
  const [stat, setStat] = useState('')
  // 0.28: abilities and Custom List numbers are checked too.
  const abilities = useItems<Ability, AbilitiesDoc>('abilities', 'abilities', createAbilitiesDoc).items
  const presets = useDamagePresets()
  const lists = useCustomLists()

  const enemyStats = useMemo(() => [...new Set(enemies.flatMap((e) => Object.keys(e.stats)))].sort(), [enemies])
  const chosen = stat && enemyStats.includes(stat) ? stat : (enemyStats[0] ?? '')

  const flagged = useMemo(() => {
    const group = (type: EntityType, e: Entity) => entityLook(categories, type, e)?.value ?? 'all'
    const out: (Point & { score: number; typical: number; stat: string; type: EntityType | string })[] = []
    for (const [type, list] of [
      ['item', items],
      ['enemy', enemies],
    ] as const) {
      const stats = [...new Set(list.flatMap((e) => Object.keys(e.stats)))]
      for (const s of stats) {
        const points = list.filter((e) => typeof e.stats[s] === 'number').map((e) => ({ id: e.id, name: e.name || 'Untitled', value: e.stats[s], group: `${type}:${group(type, e)}` }))
        for (const o of outliers(points)) out.push({ ...o, stat: s, type })
      }
    }
    const numbers = abilities.map((a) => ({ a, n: abilityStats(a, presets) }))
    for (const [label, get] of [
      ['Damage per second', (x: (typeof numbers)[number]) => x.n.perSecond],
      ['Value per cost', (x: (typeof numbers)[number]) => x.n.perCost],
    ] as const) {
      const points = numbers.flatMap((x) => (get(x) === null ? [] : [{ id: x.a.id, name: x.a.name || 'Untitled', value: get(x)!, group: `ability:${x.a.kind}` }]))
      for (const o of outliers(points)) out.push({ ...o, stat: label, type: 'ability' })
    }
    for (const l of lists)
      for (const f of l.doc.fields.filter((f) => f.kind === 'number')) {
        const points = l.doc.items.flatMap((r) => (typeof r.values[f.id] === 'number' ? [{ id: r.id, name: r.name, value: r.values[f.id] as number, group: `${l.title}:${l.title}` }] : []))
        for (const o of outliers(points)) out.push({ ...o, stat: f.name, type: l.title })
      }
    return out.sort((a, b) => b.score - a.score)
  }, [items, enemies, categories, abilities, presets, lists])

  const c = useMemo(() => curve(enemies.filter((e) => typeof e.stats[chosen] === 'number').map((e) => ({ id: e.id, name: e.name, value: e.stats[chosen], group: 'all', level: e.levelMin }))), [enemies, chosen])
  const noStats = [...items.filter((i) => !Object.keys(i.stats).length), ...enemies.filter((e) => !Object.keys(e.stats).length)]
  const noDrops = enemies.filter((e) => !e.dropTable.length)

  return (
    <div className="bal">
      <section>
        <h3>Numbers that stick out</h3>
        <p className="muted">Each stat is compared with the other items or enemies of the same rarity, each ability's damage per second and value per cost with abilities of the same kind, and each Custom List number with the rest of its list. Values far from the typical one are listed, the most extreme first.</p>
        {flagged.length === 0 ? (
          <p>Nothing sticks out. (Groups need at least four entries with that stat.)</p>
        ) : (
          <table className="calc-table bal-table">
            <thead>
              <tr>
                <th>Entry</th>
                <th>Stat</th>
                <th>Value</th>
                <th>Typical in its group</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {flagged.slice(0, 50).map((o) => (
                <tr key={`${o.id}-${o.stat}`}>
                  <td>{o.name}</td>
                  <td>{o.stat}</td>
                  <td className={o.value > o.typical ? 'bal-high' : 'bal-low'}>{formatNumber(o.value)}</td>
                  <td>
                    {formatNumber(o.typical)} <span className="muted">({o.group.split(':')[1]})</span>
                  </td>
                  <td>
                    {(o.type === 'item' || o.type === 'enemy') && (
                      <button className="icon-btn" title="Open" aria-label="Open" onClick={() => openEntity(o.type as EntityType, o.id)}>
                        <ExternalLink size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3 className="ld-inline">
          Difficulty curve
          {enemyStats.length > 0 && (
            <select className="input" value={chosen} onChange={(e) => setStat(e.target.value)}>
              {enemyStats.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
        </h3>
        {c.levels.length < 2 ? (
          <p className="muted">Give enemies a level and numbers (under Numbers in the Enemy List) to see how {chosen || 'their stats'} grow.</p>
        ) : (
          <>
            <LineChart xs={c.levels} series={[{ name: `Average ${chosen}`, values: c.avg }]} xLabel="Enemy level" />
            {c.spikes.length === 0 ? (
              <p>The curve grows smoothly.</p>
            ) : (
              c.spikes.map((s) => (
                <p key={s.level} className={s.change > 0 ? 'bal-high' : 'bal-low'}>
                  Level {s.level}: {chosen} {s.change > 0 ? 'jumps up' : 'drops'} by {Math.round(Math.abs(s.change) * 100)}% compared with the level before.
                </p>
              ))
            )}
          </>
        )}
      </section>

      <section>
        <h3>Gaps</h3>
        <p>
          {items.length} items and {enemies.length} enemies. {noStats.length ? `${noStats.length} have no numbers yet: ${noStats.slice(0, 8).map((e) => e.name || 'Untitled').join(', ')}${noStats.length > 8 ? '…' : ''}.` : 'All have numbers.'}
        </p>
        <p>{noDrops.length ? `${noDrops.length} enemies drop nothing: ${noDrops.slice(0, 8).map((e) => e.name || 'Untitled').join(', ')}${noDrops.length > 8 ? '…' : ''}.` : 'Every enemy drops something.'}</p>
      </section>
    </div>
  )
}

/** Every Custom List of the project, loaded (0.28). */
function useCustomLists() {
  const root = useProjectStore((s) => s.root)
  const docs = useProjectStore((s) => s.meta?.documents)
  const [lists, setLists] = useState<{ title: string; doc: CustomListDoc }[]>([])
  useEffect(() => {
    if (!root || !docs) return
    let stale = false
    const refs = docs.filter((d) => d.type === 'custom-list')
    void Promise.all(refs.map(async (d) => ({ title: d.title, doc: await loadDocumentNow<CustomListDoc>(root, 'custom-list', d.id, createCustomListDoc) }))).then((l) => !stale && setLists(l))
    return () => {
      stale = true
    }
  }, [root, docs])
  return lists
}
