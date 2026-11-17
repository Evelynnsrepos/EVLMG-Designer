import { ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'
import { abilityStats, createAbilitiesDoc, type AbilitiesDoc, type Ability } from '@/components/abilities/model'
import { createCustomListDoc, type CustomListDoc } from '@/components/custom-list/model'
import { useDamagePresets } from '@/shared/calculators'
import { useItems } from '@/shared/listDetail'
import type { Enemy, Entity, EntityType, Item } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocumentsOfType, useProjectStore } from '@/core/state'
import { LineChart } from '@/shared/calculators'
import { entityLook } from '@/shared/categories'
import { openEntity } from '@/shared/entityList'
import { formatNumber } from '@/shared/formulas'
import { localized, useLang } from '@/shared/i18n'
import '@/shared/listDetail/listDetail.css'
import { openComponent } from '@/shell/editor/actions'
import { CoverageBars, StripChart } from './Charts'
import { curve, outliers, strips, type Point } from './model'
import './balance.css'

const UI = localized(
  {
    items: 'Items',
    enemies: 'Enemies',
    abilities: 'Abilities',
    stickOut: 'Stick out',
    stickTitle: 'Numbers that stick out',
    stickHelp: 'Each dot is one entry, each row a rarity or kind. The bar is the typical value of that row. Big red dots are much higher than the rest of their row, big accent dots much lower. Click a dot to open it.',
    stat: 'Number',
    nOut: (n: number) => ` (${n} stick out)`,
    nothing: 'Nothing sticks out in this number. (A row needs at least four entries before it is compared.)',
    table: (n: number) => `All numbers that stick out, as a table (${n})`,
    entry: 'Entry',
    value: 'Value',
    typical: 'Typical in its group',
    open: 'Open',
    example: 'Example',
    noNumbers: 'This is what your chart will look like. Give your items or enemies numbers (like Damage or HP) and it fills in.',
    openItems: 'Open Item List',
    openEnemies: 'Open Enemy List',
    curveTitle: 'Difficulty curve',
    curveHelp: (stat: string) => `How ${stat} grows with the enemy level: the average, the strongest and the weakest enemy of each level.`,
    noCurve: 'This is what your curve will look like. Give at least two enemies a level and numbers to see yours.',
    avg: (stat: string) => `Average ${stat}`,
    max: 'Strongest',
    min: 'Weakest',
    level: 'Enemy level',
    smooth: 'The curve grows smoothly.',
    spike: (lvl: number, stat: string, up: boolean, pct: number) => `Level ${lvl}: ${stat} ${up ? 'jumps up' : 'drops'} by ${pct}% compared with the level before.`,
    gapsTitle: 'Gaps',
    itemsNumbers: 'Items with numbers',
    enemiesNumbers: 'Enemies with numbers',
    enemiesDrops: 'Enemies that drop something',
    missingNumbers: (n: number, names: string) => `${n} have no numbers yet: ${names}.`,
    missingDrops: (n: number, names: string) => `${n} enemies drop nothing: ${names}.`,
    allGood: 'Everything has numbers and every enemy drops something.',
  },
  {
    items: 'Items',
    enemies: 'Gegner',
    abilities: 'Fähigkeiten',
    stickOut: 'Fallen auf',
    stickTitle: 'Zahlen, die auffallen',
    stickHelp: 'Jeder Punkt ist ein Eintrag, jede Zeile eine Seltenheit oder Art. Der Strich ist der typische Wert der Zeile. Große rote Punkte sind viel höher als der Rest ihrer Zeile, große farbige Punkte viel niedriger. Klick auf einen Punkt öffnet ihn.',
    stat: 'Zahl',
    nOut: (n: number) => ` (${n} fallen auf)`,
    nothing: 'Bei dieser Zahl fällt nichts auf. (Eine Zeile braucht mindestens vier Einträge für den Vergleich.)',
    table: (n: number) => `Alle auffälligen Zahlen als Tabelle (${n})`,
    entry: 'Eintrag',
    value: 'Wert',
    typical: 'Typisch in der Gruppe',
    open: 'Öffnen',
    example: 'Beispiel',
    noNumbers: 'So wird dein Diagramm aussehen. Gib deinen Items oder Gegnern Zahlen (zum Beispiel Schaden oder HP), dann füllt es sich.',
    openItems: 'Item-Liste öffnen',
    openEnemies: 'Gegner-Liste öffnen',
    curveTitle: 'Schwierigkeitskurve',
    curveHelp: (stat: string) => `Wie ${stat} mit dem Gegner-Level wächst: der Durchschnitt, der stärkste und der schwächste Gegner jedes Levels.`,
    noCurve: 'So wird deine Kurve aussehen. Gib mindestens zwei Gegnern ein Level und Zahlen, dann siehst du deine.',
    avg: (stat: string) => `${stat} im Schnitt`,
    max: 'Stärkster',
    min: 'Schwächster',
    level: 'Gegner-Level',
    smooth: 'Die Kurve wächst gleichmäßig.',
    spike: (lvl: number, stat: string, up: boolean, pct: number) => `Level ${lvl}: ${stat} ${up ? 'springt' : 'fällt'} um ${pct}% im Vergleich zum Level davor.`,
    gapsTitle: 'Lücken',
    itemsNumbers: 'Items mit Zahlen',
    enemiesNumbers: 'Gegner mit Zahlen',
    enemiesDrops: 'Gegner, die etwas fallen lassen',
    missingNumbers: (n: number, names: string) => `${n} haben noch keine Zahlen: ${names}.`,
    missingDrops: (n: number, names: string) => `${n} Gegner lassen nichts fallen: ${names}.`,
    allGood: 'Alles hat Zahlen und jeder Gegner lässt etwas fallen.',
  },
)

type NumberSet = { key: string; label: string; type: EntityType | string; points: Point[]; colors: Record<string, string> }

// Made-up numbers for the "Example" previews, so an empty project still shows what the charts do.
const SAMPLE_ROWS = strips([
  ...[12, 14, 11, 13, 15, 12].map((v, i) => ({ id: `c${i}`, name: 'Sword', value: v, group: 'Common' })),
  ...[20, 22, 19, 21, 46].map((v, i) => ({ id: `r${i}`, name: 'Axe', value: v, group: 'Rare' })),
  ...[34, 36, 33, 35].map((v, i) => ({ id: `e${i}`, name: 'Bow', value: v, group: 'Epic' })),
])
const SAMPLE_COLORS = { Common: '#9aa0a6', Rare: '#3e8ef7', Epic: '#a855f7' }
const SAMPLE_CURVE = { xs: [1, 2, 3, 4, 5, 6, 7, 8], avg: [100, 112, 125, 140, 210, 176, 197, 220], max: [110, 125, 140, 160, 260, 195, 215, 245], min: [90, 100, 112, 124, 170, 160, 180, 200] }

/** Balance dashboard (v0.10, charts 0.35): outliers in item and enemy numbers, and the enemy difficulty curve. */
export default function View(_props: PanelProps) {
  useLang()
  const entities = useProjectStore((s) => s.entities)
  const categories = useProjectStore((s) => s.categories)
  const items = entities.item as Item[]
  const enemies = entities.enemy as Enemy[]
  const [stat, setStat] = useState('')
  const [set, setSet] = useState('')
  // 0.28: abilities and Custom List numbers are checked too.
  const abilities = useItems<Ability, AbilitiesDoc>('abilities', 'abilities', createAbilitiesDoc).items
  const presets = useDamagePresets()
  const lists = useCustomLists()

  const enemyStats = useMemo(() => [...new Set(enemies.flatMap((e) => Object.keys(e.stats)))].sort(), [enemies])
  const chosen = stat && enemyStats.includes(stat) ? stat : (enemyStats[0] ?? '')

  /** Every group of numbers that is compared: one per item stat, enemy stat, ability number and Custom List number field. */
  const sets = useMemo(() => {
    const out: NumberSet[] = []
    for (const [type, list] of [
      ['item', items],
      ['enemy', enemies],
    ] as const) {
      const stats = [...new Set(list.flatMap((e) => Object.keys(e.stats)))].sort()
      const colors: Record<string, string> = {}
      const group = (e: Entity) => {
        const look = entityLook(categories, type, e)
        const g = look?.value ?? 'all'
        if (look?.style.color) colors[g] = look.style.color
        return g
      }
      for (const s of stats) {
        const points = list.filter((e) => typeof e.stats[s] === 'number').map((e) => ({ id: e.id, name: e.name || 'Untitled', value: e.stats[s], group: group(e) }))
        out.push({ key: `${type}:${s}`, label: `${type === 'item' ? UI.items : UI.enemies}: ${s}`, type, points, colors })
      }
    }
    const numbers = abilities.map((a) => ({ a, n: abilityStats(a, presets) }))
    for (const [label, get] of [
      ['Damage per second', (x: (typeof numbers)[number]) => x.n.perSecond],
      ['Value per cost', (x: (typeof numbers)[number]) => x.n.perCost],
    ] as const) {
      const points = numbers.flatMap((x) => (get(x) === null ? [] : [{ id: x.a.id, name: x.a.name || 'Untitled', value: get(x)!, group: x.a.kind }]))
      out.push({ key: `ability:${label}`, label: `${UI.abilities}: ${label}`, type: 'ability', points, colors: {} })
    }
    for (const l of lists)
      for (const f of l.doc.fields.filter((f) => f.kind === 'number')) {
        const points = l.doc.items.flatMap((r) => (typeof r.values[f.id] === 'number' ? [{ id: r.id, name: r.name, value: r.values[f.id] as number, group: l.title }] : []))
        out.push({ key: `${l.title}:${f.id}`, label: `${l.title}: ${f.name}`, type: l.title, points, colors: {} })
      }
    return out.filter((x) => x.points.length > 0)
  }, [items, enemies, categories, abilities, presets, lists])

  const flagged = useMemo(() => sets.flatMap((x) => outliers(x.points).map((o) => ({ ...o, stat: x.label, type: x.type, key: x.key }))).sort((a, b) => b.score - a.score), [sets])
  const outCount = (key: string) => flagged.filter((f) => f.key === key).length
  // Default: the number with the biggest outlier, else the one with the most entries.
  const shown = sets.find((x) => x.key === set) ?? sets.find((x) => x.key === flagged[0]?.key) ?? [...sets].sort((a, b) => b.points.length - a.points.length)[0]
  const rows = useMemo(() => (shown ? strips(shown.points) : []), [shown])

  const c = useMemo(() => curve(enemies.filter((e) => typeof e.stats[chosen] === 'number').map((e) => ({ id: e.id, name: e.name, value: e.stats[chosen], group: 'all', level: e.levelMin }))), [enemies, chosen])
  const noStats = [...items.filter((i) => !Object.keys(i.stats).length), ...enemies.filter((e) => !Object.keys(e.stats).length)]
  const noDrops = enemies.filter((e) => !e.dropTable.length)
  const names = (list: Entity[]) => `${list.slice(0, 8).map((e) => e.name || 'Untitled').join(', ')}${list.length > 8 ? '…' : ''}`

  const openButtons = (
    <div className="bal-cta">
      <button className="btn" onClick={() => openComponent('item-list')}>
        {UI.openItems}
      </button>
      <button className="btn" onClick={() => openComponent('enemy-list')}>
        {UI.openEnemies}
      </button>
    </div>
  )

  return (
    <div className="bal">
      <div className="bal-tiles">
        <div className="bal-tile">
          <b>{items.length}</b>
          <span>{UI.items}</span>
        </div>
        <div className="bal-tile">
          <b>{enemies.length}</b>
          <span>{UI.enemies}</span>
        </div>
        <div className="bal-tile">
          <b>{abilities.length}</b>
          <span>{UI.abilities}</span>
        </div>
        <div className={`bal-tile ${flagged.length ? 'is-warn' : ''}`}>
          <b>{flagged.length}</b>
          <span>{UI.stickOut}</span>
        </div>
      </div>

      <section>
        <h3 className="ld-inline">
          {UI.stickTitle}
          {sets.length > 0 && (
            <select className="input" aria-label={UI.stat} value={shown?.key} onChange={(e) => setSet(e.target.value)}>
              {sets.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                  {outCount(x.key) ? UI.nOut(outCount(x.key)) : ''}
                </option>
              ))}
            </select>
          )}
        </h3>
        {shown ? (
          <>
            <p className="muted">{UI.stickHelp}</p>
            <StripChart rows={rows} colors={shown.colors} label={shown.label} onOpen={shown.type === 'item' || shown.type === 'enemy' ? (id) => openEntity(shown.type as EntityType, id) : undefined} />
            {outCount(shown.key) === 0 && <p>{UI.nothing}</p>}
          </>
        ) : (
          <div className="bal-sample">
            <div className="bal-sample-chart" aria-hidden>
              <StripChart rows={SAMPLE_ROWS} colors={SAMPLE_COLORS} label={UI.example} />
              <span className="bal-sample-badge">{UI.example}</span>
            </div>
            <p>{UI.noNumbers}</p>
            {openButtons}
          </div>
        )}
        {flagged.length > 0 && (
          <details className="bal-details">
            <summary>{UI.table(flagged.length)}</summary>
            <table className="calc-table bal-table">
              <thead>
                <tr>
                  <th>{UI.entry}</th>
                  <th>{UI.stat}</th>
                  <th>{UI.value}</th>
                  <th>{UI.typical}</th>
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
                      {formatNumber(o.typical)} <span className="muted">({o.group})</span>
                    </td>
                    <td>
                      {(o.type === 'item' || o.type === 'enemy') && (
                        <button className="icon-btn" title={UI.open} aria-label={UI.open} onClick={() => openEntity(o.type as EntityType, o.id)}>
                          <ExternalLink size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </section>

      <section>
        <h3 className="ld-inline">
          {UI.curveTitle}
          {enemyStats.length > 0 && (
            <select className="input" aria-label={UI.stat} value={chosen} onChange={(e) => setStat(e.target.value)}>
              {enemyStats.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
        </h3>
        {c.levels.length < 2 ? (
          <div className="bal-sample">
            <div className="bal-sample-chart" aria-hidden>
              <LineChart xs={SAMPLE_CURVE.xs} series={[{ name: UI.avg('HP'), values: SAMPLE_CURVE.avg }, { name: UI.max, values: SAMPLE_CURVE.max }, { name: UI.min, values: SAMPLE_CURVE.min }]} xLabel={UI.level} />
              <span className="bal-sample-badge">{UI.example}</span>
            </div>
            <p>{UI.noCurve}</p>
            <div className="bal-cta">
              <button className="btn" onClick={() => openComponent('enemy-list')}>
                {UI.openEnemies}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="muted">{UI.curveHelp(chosen)}</p>
            <LineChart
              xs={c.levels}
              // Strongest/weakest only when some level has more than one enemy; else they sit on the average line.
              series={c.max.some((m, i) => m !== c.min[i]) ? [{ name: UI.avg(chosen), values: c.avg }, { name: UI.max, values: c.max }, { name: UI.min, values: c.min }] : [{ name: UI.avg(chosen), values: c.avg }]}
              xLabel={UI.level}
            />
            {c.spikes.length === 0 ? (
              <p>{UI.smooth}</p>
            ) : (
              c.spikes.map((s) => (
                <p key={s.level} className={s.change > 0 ? 'bal-high' : 'bal-low'}>
                  {UI.spike(s.level, chosen, s.change > 0, Math.round(Math.abs(s.change) * 100))}
                </p>
              ))
            )}
          </>
        )}
      </section>

      <section>
        <h3>{UI.gapsTitle}</h3>
        <CoverageBars
          rows={[
            { label: UI.itemsNumbers, have: items.length - items.filter((i) => !Object.keys(i.stats).length).length, total: items.length },
            { label: UI.enemiesNumbers, have: enemies.length - enemies.filter((e) => !Object.keys(e.stats).length).length, total: enemies.length },
            { label: UI.enemiesDrops, have: enemies.length - noDrops.length, total: enemies.length },
          ]}
        />
        {noStats.length > 0 && <p className="muted">{UI.missingNumbers(noStats.length, names(noStats))}</p>}
        {noDrops.length > 0 && <p className="muted">{UI.missingDrops(noDrops.length, names(noDrops))}</p>}
        {noStats.length === 0 && noDrops.length === 0 && items.length + enemies.length > 0 && <p>{UI.allGood}</p>}
      </section>
    </div>
  )
}

/** Every Custom List of the project, loaded (0.28). */
function useCustomLists() {
  const lists = useDocumentsOfType<CustomListDoc>('custom-list', createCustomListDoc)
  return useMemo(() => lists.map((l) => ({ title: l.title, doc: l.data })), [lists])
}
