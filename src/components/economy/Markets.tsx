import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { newId, type Id } from '@/core/model'
import { LineChart, NumberInput } from '@/shared/calculators'
import { crafting, emptyMarket, newSlot, repeatRoute, routes, spaceExample, type Good, type Market, type Place, type Recipe, type Slot } from './market'
import { newSource, type EconomyDoc } from './model'

const fmt = (n: number) => Math.round(n).toLocaleString()

/** 0.35: the Markets tab: goods, places, travel, recipes, and what pays. */
export function Markets({ d, set, toMoney }: { d: EconomyDoc; set(fn: (d: EconomyDoc) => EconomyDoc): void; toMoney(): void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const m = d.market
  if (!m)
    return (
      <div className="eco-body">
        <p>
          Markets plan a trading economy: goods with prices that differ from place to place, stock that runs out when players buy a lot and comes back over time, a ship (or cart) that carries a load, travel times, and recipes that turn
          goods into better goods. It shows the best trade routes, how long a route keeps paying, and whether crafting is worth it.
        </p>
        <div className="ld-inline">
          <button className="btn btn-primary" onClick={() => set((x) => ({ ...x, market: spaceExample() }))}>
            Add space trading example
          </button>
          <button className="btn btn-ghost" onClick={() => set((x) => ({ ...x, market: emptyMarket() }))}>
            Start empty
          </button>
        </div>
      </div>
    )

  const edit = (fn: (m: Market) => Market) => set((x) => ({ ...x, market: fn(x.market ?? emptyMarket()) }))
  const good = (id: Id) => m.goods.find((g) => g.id === id)?.name ?? '?'
  const place = (id: Id | null) => m.places.find((p) => p.id === id)?.name ?? '?'
  const editGood = (id: Id, p: Partial<Good>) => edit((x) => ({ ...x, goods: x.goods.map((g) => (g.id === id ? { ...g, ...p } : g)) }))
  const editPlace = (id: Id, p: Partial<Place>) => edit((x) => ({ ...x, places: x.places.map((o) => (o.id === id ? { ...o, ...p } : o)) }))
  const editSlot = (pl: Place, id: Id, p: Partial<Slot>) => editPlace(pl.id, { slots: pl.slots.map((s) => (s.id === id ? { ...s, ...p } : s)) })
  const editRecipe = (id: Id, p: Partial<Recipe>) => edit((x) => ({ ...x, recipes: x.recipes.map((r) => (r.id === id ? { ...r, ...p } : r)) }))
  const goodSelect = (value: Id, onChange: (v: Id) => void, choices = m.goods) => (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Good">
      {choices.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  )
  const placeSelect = (value: Id | null, onChange: (v: Id | null) => void, none?: string) => (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label="Place">
      {none && <option value="">{none}</option>}
      {m.places.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )

  const all = routes(m)
  const route = all.find((r) => r.key === picked) ?? all[0]
  const rep = route ? repeatRoute(m, route, d.hours) : null
  const crafts = crafting(m)
  const addToMoney = () => {
    if (!route || !rep || !d.currencies[0]) return
    set((x) => ({ ...x, sources: [...x.sources, { ...newSource(x.currencies[0].id), name: `Trading ${good(route.goodId)}: ${place(route.from)} to ${place(route.to)}`, perHour: Math.round(rep.total / Math.max(1, d.hours)) }] }))
    toMoney()
  }
  const ioRows = (r: Recipe, key: 'inputs' | 'outputs') => (
    <span className="ld-inline">
      {r[key].map((io, i) => (
        <span key={i} className="eco-io">
          <NumberInput value={io.amount} min={0} onChange={(amount) => editRecipe(r.id, { [key]: r[key].map((o, j) => (j === i ? { ...o, amount } : o)) })} aria-label="Amount" />×
          {goodSelect(io.goodId, (goodId) => editRecipe(r.id, { [key]: r[key].map((o, j) => (j === i ? { ...o, goodId } : o)) }))}
          <button className="icon-btn" aria-label="Remove" onClick={() => editRecipe(r.id, { [key]: r[key].filter((_, j) => j !== i) })}>
            <X size={11} />
          </button>
        </span>
      ))}
      {m.goods.length > 0 && (
        <button className="icon-btn" aria-label={key === 'inputs' ? 'Add input' : 'Add output'} onClick={() => editRecipe(r.id, { [key]: [...r[key], { goodId: m.goods[0].id, amount: 1 }] })}>
          <Plus size={12} />
        </button>
      )}
    </span>
  )

  return (
    <div className="eco-body">
      <section>
        <h3>What pays</h3>
        {all.length === 0 ? (
          <p className="muted">Add goods, give two places a price for the same good, and a travel time between them. Then the best trade routes show up here.</p>
        ) : (
          <>
            <table className="calc-table eco-table">
              <thead>
                <tr>
                  <th>Good</th>
                  <th>Buy at</th>
                  <th>Sell at</th>
                  <th title="As much as the ship carries and the stock allows">Carry</th>
                  <th>Buy for (each)</th>
                  <th>Sell for (each)</th>
                  <th title="There full, back empty, after tax and both flights">Profit per round trip</th>
                  <th>Per hour</th>
                </tr>
              </thead>
              <tbody>
                {all.slice(0, 8).map((r) => (
                  <tr key={r.key} className={r === route ? 'eco-picked' : undefined} onClick={() => setPicked(r.key)} style={{ cursor: 'pointer' }}>
                    <td>{good(r.goodId)}</td>
                    <td>{place(r.from)}</td>
                    <td>{place(r.to)}</td>
                    <td>{fmt(r.units)}</td>
                    <td>{r.buyPrice.toFixed(1)}</td>
                    <td>{r.sellPrice.toFixed(1)}</td>
                    <td className={r.profit < 0 ? 'eco-bad' : undefined}>{fmt(r.profit)}</td>
                    <td className={r.perHour < 0 ? 'eco-bad' : undefined}>
                      <strong>{fmt(r.perHour)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {route && rep && (
              <>
                <h4>
                  Flying {good(route.goodId)} from {place(route.from)} to {place(route.to)} again and again for {d.hours} hours
                </h4>
                <LineChart xs={rep.hours} series={[{ name: 'Profit per round trip', values: rep.profit }]} xLabel="Hours played" />
                <p>
                  {rep.stopsAt === null ? 'This route keeps paying: stock comes back fast enough.' : <span className="eco-bad">This route stops paying after about {rep.stopsAt} hours, because buying and selling moved the prices.</span>} In total{' '}
                  {fmt(rep.total)}, about {fmt(rep.total / Math.max(1, d.hours))} per hour.{' '}
                  {d.currencies[0] && (
                    <button className="btn btn-ghost" onClick={addToMoney} title="Adds this route as an income source on the Money tab, so it plays together with the rest of the economy">
                      Add as income on the Money tab
                    </button>
                  )}
                </p>
              </>
            )}
          </>
        )}
        {crafts.length > 0 && (
          <>
            <h4>Is crafting worth it?</h4>
            <table className="calc-table eco-table">
              <thead>
                <tr>
                  <th>Recipe</th>
                  <th>At</th>
                  <th>Value in</th>
                  <th>Value out</th>
                  <th>Gain each</th>
                  <th>Per hour</th>
                </tr>
              </thead>
              <tbody>
                {crafts.map((c) => (
                  <tr key={`${c.recipeId}|${c.placeId}`} title={c.guessed.length ? `No price there for ${c.guessed.join(', ')}: counted at base price` : undefined}>
                    <td>{m.recipes.find((r) => r.id === c.recipeId)?.name}</td>
                    <td>
                      {c.placeId ? place(c.placeId) : 'base prices'}
                      {c.guessed.length ? ' *' : ''}
                    </td>
                    <td>{fmt(c.valueIn)}</td>
                    <td>{fmt(c.valueOut)}</td>
                    <td className={c.perCraft < 0 ? 'eco-bad' : undefined}>{fmt(c.perCraft)}</td>
                    <td className={c.perHour < 0 ? 'eco-bad' : undefined}>
                      <strong>{fmt(c.perHour)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section>
        <h3>Ship</h3>
        <div className="ld-inline">
          <span className="muted">carries</span>
          <NumberInput value={m.cargo} min={1} onChange={(cargo) => edit((x) => ({ ...x, cargo }))} />
          <span className="muted">units, each flight costs</span>
          <NumberInput value={m.tripCost} min={0} onChange={(tripCost) => edit((x) => ({ ...x, tripCost }))} />
          <span className="muted">, docking takes</span>
          <NumberInput value={m.dockMinutes} min={0} onChange={(dockMinutes) => edit((x) => ({ ...x, dockMinutes }))} />
          <span className="muted">minutes, sales tax</span>
          <NumberInput value={m.fee} min={0} max={100} onChange={(fee) => edit((x) => ({ ...x, fee }))} />%
        </div>
      </section>

      <section>
        <h3>Goods</h3>
        {m.goods.map((g) => (
          <div key={g.id} className="ld-inline">
            <input className="input" value={g.name} onChange={(e) => editGood(g.id, { name: e.target.value })} aria-label="Good" />
            <span className="muted">base price</span>
            <NumberInput value={g.base} min={0} onChange={(base) => editGood(g.id, { base })} />
            <button className="icon-btn" aria-label="Remove good" onClick={() => edit((x) => ({ ...x, goods: x.goods.filter((o) => o.id !== g.id), places: x.places.map((p) => ({ ...p, slots: p.slots.filter((s) => s.goodId !== g.id) })), recipes: x.recipes.map((r) => ({ ...r, inputs: r.inputs.filter((i) => i.goodId !== g.id), outputs: r.outputs.filter((o) => o.goodId !== g.id) })) }))}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost eco-add" onClick={() => edit((x) => ({ ...x, goods: [...x.goods, { id: newId(), name: 'New good', base: 10 }] }))}>
          <Plus size={14} /> Add good
        </button>
      </section>

      <section>
        <h3>Places</h3>
        <p className="muted">
          Price: percent of the base price when stock is normal. Stock: what is there normally. Refill: units per hour that come back. Reacts: how much the price moves when players buy or sell 10% of the stock.
        </p>
        {m.places.map((p) => (
          <div key={p.id} className="eco-meter">
            <div className="ld-inline">
              <input className="input" value={p.name} onChange={(e) => editPlace(p.id, { name: e.target.value })} aria-label="Place" />
              <button className="icon-btn" aria-label="Remove place" onClick={() => edit((x) => ({ ...x, places: x.places.filter((o) => o.id !== p.id), legs: x.legs.filter((l) => l.a !== p.id && l.b !== p.id), recipes: x.recipes.map((r) => (r.placeId === p.id ? { ...r, placeId: null } : r)) }))}>
                <X size={13} />
              </button>
            </div>
            {p.slots.length > 0 && (
              <table className="calc-table eco-table">
                <thead>
                  <tr>
                    <th>Good</th>
                    <th>Price %</th>
                    <th>Stock</th>
                    <th>Refill / h</th>
                    <th>Reacts %</th>
                    <th>Price now</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.slots.map((s) => {
                    const g = m.goods.find((x) => x.id === s.goodId)
                    return (
                      <tr key={s.id}>
                        <td>{goodSelect(s.goodId, (goodId) => editSlot(p, s.id, { goodId }))}</td>
                        <td>
                          <NumberInput value={s.price} min={0} onChange={(price) => editSlot(p, s.id, { price })} />
                        </td>
                        <td>
                          <NumberInput value={s.stock} min={0} onChange={(stock) => editSlot(p, s.id, { stock })} />
                        </td>
                        <td>
                          <NumberInput value={s.refill} min={0} onChange={(refill) => editSlot(p, s.id, { refill })} />
                        </td>
                        <td>
                          <NumberInput value={s.react} min={0} onChange={(react) => editSlot(p, s.id, { react })} />
                        </td>
                        <td>{g ? ((s.price / 100) * g.base).toFixed(1) : ''}</td>
                        <td>
                          <button className="icon-btn" aria-label="Remove good here" onClick={() => editPlace(p.id, { slots: p.slots.filter((o) => o.id !== s.id) })}>
                            <X size={12} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {m.goods.some((g) => !p.slots.some((s) => s.goodId === g.id)) && (
              <select className="input" value="" onChange={(e) => e.target.value && editPlace(p.id, { slots: [...p.slots, newSlot(e.target.value)] })} aria-label="Trade a good here">
                <option value="">+ Trade a good here…</option>
                {m.goods
                  .filter((g) => !p.slots.some((s) => s.goodId === g.id))
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
        ))}
        <button className="btn btn-ghost eco-add" onClick={() => edit((x) => ({ ...x, places: [...x.places, { id: newId(), name: 'New place', slots: [] }] }))}>
          <Plus size={14} /> Add place
        </button>
      </section>

      <section>
        <h3>Travel times</h3>
        {m.legs.map((l) => (
          <div key={l.id} className="ld-inline">
            {placeSelect(l.a, (a) => a && edit((x) => ({ ...x, legs: x.legs.map((o) => (o.id === l.id ? { ...o, a } : o)) })))}
            <span className="muted">to</span>
            {placeSelect(l.b, (b) => b && edit((x) => ({ ...x, legs: x.legs.map((o) => (o.id === l.id ? { ...o, b } : o)) })))}
            <NumberInput value={l.minutes} min={0} onChange={(minutes) => edit((x) => ({ ...x, legs: x.legs.map((o) => (o.id === l.id ? { ...o, minutes } : o)) }))} />
            <span className="muted">minutes, both ways</span>
            <button className="icon-btn" aria-label="Remove travel time" onClick={() => edit((x) => ({ ...x, legs: x.legs.filter((o) => o.id !== l.id) }))}>
              <X size={13} />
            </button>
          </div>
        ))}
        {m.places.length > 1 && (
          <button className="btn btn-ghost eco-add" onClick={() => edit((x) => ({ ...x, legs: [...x.legs, { id: newId(), a: x.places[0].id, b: x.places[1].id, minutes: 10 }] }))}>
            <Plus size={14} /> Add travel time
          </button>
        )}
      </section>

      <section>
        <h3>Recipes: refining, crafting, factories</h3>
        {m.recipes.map((r) => (
          <div key={r.id} className="ld-inline eco-recipe">
            <input className="input" value={r.name} onChange={(e) => editRecipe(r.id, { name: e.target.value })} aria-label="Recipe" />
            {ioRows(r, 'inputs')}
            <span className="muted">makes</span>
            {ioRows(r, 'outputs')}
            <span className="muted">in</span>
            <NumberInput value={r.minutes} min={0} onChange={(minutes) => editRecipe(r.id, { minutes })} />
            <span className="muted">min at</span>
            {placeSelect(r.placeId, (placeId) => editRecipe(r.id, { placeId }), 'anywhere')}
            <button className="icon-btn" aria-label="Remove recipe" onClick={() => edit((x) => ({ ...x, recipes: x.recipes.filter((o) => o.id !== r.id) }))}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost eco-add" onClick={() => edit((x) => ({ ...x, recipes: [...x.recipes, { id: newId(), name: 'New recipe', inputs: [], outputs: [], minutes: 5, placeId: null }] }))}>
          <Plus size={14} /> Add recipe
        </button>
      </section>
    </div>
  )
}
