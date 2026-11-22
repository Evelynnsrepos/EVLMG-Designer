import { Plus, Rocket, X } from 'lucide-react'
import { useState } from 'react'
import { newId, type Id } from '@/core/model'
import { LineChart, NumberInput } from '@/shared/calculators'
import { localized } from '@/shared/i18n'
import { crafting, emptyMarket, newSlot, repeatRoute, routes, spaceExample, type Good, type Market, type Place, type Recipe, type Slot } from './market'
import { newSource, type EconomyDoc } from './model'

const UI = localized(
  {
    intro:
      'Markets plan a trading economy: goods with prices that differ from place to place, stock that runs out when players buy a lot and comes back over time, a ship (or cart) that carries a load, travel times, and recipes that turn goods into better goods. It shows the best trade routes, how long a route keeps paying, and whether crafting is worth it.',
    example: 'Add space trading example',
    empty: 'Start empty',
    whatPays: 'What pays',
    noRoutes: 'Add goods, give two places a price for the same good, and a travel time between them. Then the best trade routes show up here.',
    good: 'Good',
    buyAt: 'Buy at',
    sellAt: 'Sell at',
    carry: 'Carry',
    carryTip: 'As much as the ship carries and the stock allows',
    buyFor: 'Buy for (each)',
    sellFor: 'Sell for (each)',
    profitTrip: 'Profit per round trip',
    profitTripTip: 'There full, back empty, after tax and both flights',
    perHour: 'Per hour',
    perHourTip: 'For the first trip, before prices move',
    pickRoute: 'Click a route to see what happens when players fly it again and again.',
    again: (good: string, from: string, to: string, h: number) => `Flying ${good} from ${from} to ${to} again and again for ${h} hours`,
    profitSeries: 'Profit per round trip',
    hoursPlayed: 'Hours played',
    keepsPaying: 'This route keeps paying: stock comes back fast enough.',
    stops: (h: number) => `This route stops paying after about ${h} hours, because buying and selling moved the prices.`,
    total: (t: string, ph: string) => `In total ${t}, about ${ph} per hour.`,
    toMoney: 'Add as income on the Money tab',
    toMoneyTip: 'Adds this route as an income source on the Money tab, so it plays together with the rest of the economy',
    trading: (good: string, from: string, to: string) => `Trading ${good}: ${from} to ${to}`,
    crafting: 'Is crafting worth it?',
    recipe: 'Recipe',
    at: 'At',
    valueIn: 'Value in',
    valueOut: 'Value out',
    gain: 'Gain each',
    basePrices: 'base prices',
    guessed: (names: string) => `No price there for ${names}: counted at base price`,
    ship: 'Ship',
    carries: 'Carries (units)',
    flightCost: 'Each flight costs',
    docking: 'Docking (minutes)',
    tax: 'Sales tax %',
    goods: 'Goods',
    basePrice: 'Base price',
    removeGood: 'Remove good',
    addGood: 'Add good',
    newGood: 'New good',
    places: 'Places',
    placesHelp:
      'Price: percent of the base price when stock is normal. Stock: what is there normally. Refill: units per hour that come back. Reacts: how much the price moves when players buy or sell 10% of the stock.',
    place: 'Place',
    removePlace: 'Remove place',
    price: 'Price %',
    stock: 'Stock',
    refill: 'Refill / h',
    reacts: 'Reacts %',
    priceNow: 'Price now',
    removeHere: 'Remove good here',
    tradeHere: '+ Trade a good here…',
    addPlace: 'Add place',
    newPlace: 'New place',
    travel: 'Travel times',
    to: 'to',
    minutesBoth: 'minutes, both ways',
    removeTravel: 'Remove travel time',
    addTravel: 'Add travel time',
    recipes: 'Recipes: refining, crafting, factories',
    makes: 'makes',
    in: 'in',
    minAt: 'min at',
    anywhere: 'anywhere',
    removeRecipe: 'Remove recipe',
    addRecipe: 'Add recipe',
    newRecipe: 'New recipe',
    amount: 'Amount',
    remove: 'Remove',
    addInput: 'Add input',
    addOutput: 'Add output',
  },
  {
    intro:
      'Märkte planen eine Handelswirtschaft: Waren mit Preisen, die von Ort zu Ort anders sind, Vorrat, der ausgeht, wenn Spieler viel kaufen, und mit der Zeit zurückkommt, ein Schiff (oder Karren) mit Ladung, Reisezeiten und Rezepte, die Waren zu besseren Waren machen. Es zeigt die besten Handelsrouten, wie lange sich eine Route lohnt und ob Herstellen sich rechnet.',
    example: 'Weltraumhandel als Beispiel',
    empty: 'Leer anfangen',
    whatPays: 'Was sich lohnt',
    noRoutes: 'Füge Waren hinzu, gib zwei Orten einen Preis für dieselbe Ware und eine Reisezeit dazwischen. Dann erscheinen hier die besten Handelsrouten.',
    good: 'Ware',
    buyAt: 'Kaufen in',
    sellAt: 'Verkaufen in',
    carry: 'Ladung',
    carryTip: 'So viel, wie das Schiff trägt und der Vorrat hergibt',
    buyFor: 'Kauf (Stück)',
    sellFor: 'Verkauf (Stück)',
    profitTrip: 'Gewinn pro Hin und Zurück',
    profitTripTip: 'Hin voll, zurück leer, nach Steuer und beiden Flügen',
    perHour: 'Pro Stunde',
    perHourTip: 'Für die erste Fahrt, bevor sich die Preise bewegen',
    pickRoute: 'Klick auf eine Route, um zu sehen, was passiert, wenn Spieler sie immer wieder fliegen.',
    again: (good: string, from: string, to: string, h: number) => `${good} von ${from} nach ${to}, immer wieder, ${h} Stunden lang`,
    profitSeries: 'Gewinn pro Hin und Zurück',
    hoursPlayed: 'Gespielte Stunden',
    keepsPaying: 'Diese Route lohnt sich weiter: Der Vorrat kommt schnell genug zurück.',
    stops: (h: number) => `Diese Route lohnt sich nach etwa ${h} Stunden nicht mehr, weil Kaufen und Verkaufen die Preise verschoben haben.`,
    total: (t: string, ph: string) => `Insgesamt ${t}, etwa ${ph} pro Stunde.`,
    toMoney: 'Als Einnahme in Geld übernehmen',
    toMoneyTip: 'Fügt diese Route als Einnahmequelle im Geld-Tab hinzu, damit sie mit dem Rest der Wirtschaft zusammenspielt',
    trading: (good: string, from: string, to: string) => `Handel mit ${good}: ${from} nach ${to}`,
    crafting: 'Lohnt sich Herstellen?',
    recipe: 'Rezept',
    at: 'In',
    valueIn: 'Wert rein',
    valueOut: 'Wert raus',
    gain: 'Gewinn je Stück',
    basePrices: 'Grundpreise',
    guessed: (names: string) => `Dort kein Preis für ${names}: mit Grundpreis gerechnet`,
    ship: 'Schiff',
    carries: 'Trägt (Stück)',
    flightCost: 'Jeder Flug kostet',
    docking: 'Andocken (Minuten)',
    tax: 'Verkaufssteuer %',
    goods: 'Waren',
    basePrice: 'Grundpreis',
    removeGood: 'Ware entfernen',
    addGood: 'Ware hinzufügen',
    newGood: 'Neue Ware',
    places: 'Orte',
    placesHelp:
      'Preis: Prozent vom Grundpreis bei normalem Vorrat. Vorrat: was normalerweise da ist. Nachschub: Stück pro Stunde, die zurückkommen. Reagiert: wie stark sich der Preis bewegt, wenn Spieler 10% des Vorrats kaufen oder verkaufen.',
    place: 'Ort',
    removePlace: 'Ort entfernen',
    price: 'Preis %',
    stock: 'Vorrat',
    refill: 'Nachschub / h',
    reacts: 'Reagiert %',
    priceNow: 'Preis jetzt',
    removeHere: 'Ware hier entfernen',
    tradeHere: '+ Hier eine Ware handeln…',
    addPlace: 'Ort hinzufügen',
    newPlace: 'Neuer Ort',
    travel: 'Reisezeiten',
    to: 'nach',
    minutesBoth: 'Minuten, in beide Richtungen',
    removeTravel: 'Reisezeit entfernen',
    addTravel: 'Reisezeit hinzufügen',
    recipes: 'Rezepte: Veredeln, Herstellen, Fabriken',
    makes: 'ergibt',
    in: 'in',
    minAt: 'Min. in',
    anywhere: 'überall',
    removeRecipe: 'Rezept entfernen',
    addRecipe: 'Rezept hinzufügen',
    newRecipe: 'Neues Rezept',
    amount: 'Menge',
    remove: 'Entfernen',
    addInput: 'Zutat hinzufügen',
    addOutput: 'Ergebnis hinzufügen',
  },
)

const fmt = (n: number) => Math.round(n).toLocaleString()

/** 0.35: the Markets tab: goods, places, travel, recipes, and what pays. */
export function Markets({ d, set, toMoney }: { d: EconomyDoc; set(fn: (d: EconomyDoc) => EconomyDoc): void; toMoney(): void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const m = d.market
  if (!m)
    return (
      <div className="eco-body">
        <section className="eco-empty">
          <Rocket size={28} />
          <p>{UI.intro}</p>
          <div className="ld-inline">
            <button className="btn btn-primary" onClick={() => set((x) => ({ ...x, market: spaceExample() }))}>
              {UI.example}
            </button>
            <button className="btn" onClick={() => set((x) => ({ ...x, market: emptyMarket() }))}>
              {UI.empty}
            </button>
          </div>
        </section>
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
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={UI.good}>
      {choices.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  )
  const placeSelect = (value: Id | null, onChange: (v: Id | null) => void, none?: string) => (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label={UI.place}>
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
    set((x) => ({ ...x, sources: [...x.sources, { ...newSource(x.currencies[0].id), name: UI.trading(good(route.goodId), place(route.from), place(route.to)), perHour: Math.round(rep.total / Math.max(1, d.hours)) }] }))
    toMoney()
  }
  const ioRows = (r: Recipe, key: 'inputs' | 'outputs') => (
    <span className="ld-inline">
      {r[key].map((io, i) => (
        <span key={i} className="eco-io">
          <NumberInput value={io.amount} min={0} onChange={(amount) => editRecipe(r.id, { [key]: r[key].map((o, j) => (j === i ? { ...o, amount } : o)) })} aria-label={UI.amount} />×
          {goodSelect(io.goodId, (goodId) => editRecipe(r.id, { [key]: r[key].map((o, j) => (j === i ? { ...o, goodId } : o)) }))}
          <button className="icon-btn" aria-label={UI.remove} onClick={() => editRecipe(r.id, { [key]: r[key].filter((_, j) => j !== i) })}>
            <X size={11} />
          </button>
        </span>
      ))}
      {m.goods.length > 0 && (
        <button className="icon-btn" aria-label={key === 'inputs' ? UI.addInput : UI.addOutput} onClick={() => editRecipe(r.id, { [key]: [...r[key], { goodId: m.goods[0].id, amount: 1 }] })}>
          <Plus size={12} />
        </button>
      )}
    </span>
  )

  return (
    <div className="eco-body eco-markets">
      <section>
        <h3>{UI.whatPays}</h3>
        {all.length === 0 ? (
          <p className="muted">{UI.noRoutes}</p>
        ) : (
          <>
            <p className="muted">{UI.pickRoute}</p>
            <div className="eco-scroll">
              <table className="calc-table eco-table eco-routes">
                <thead>
                  <tr>
                    <th>{UI.good}</th>
                    <th>{UI.buyAt}</th>
                    <th>{UI.sellAt}</th>
                    <th title={UI.carryTip}>{UI.carry}</th>
                    <th>{UI.buyFor}</th>
                    <th>{UI.sellFor}</th>
                    <th title={UI.profitTripTip}>{UI.profitTrip}</th>
                    <th title={UI.perHourTip}>{UI.perHour}</th>
                  </tr>
                </thead>
                <tbody>
                  {all.slice(0, 8).map((r) => (
                    <tr key={r.key} className={r === route ? 'eco-picked' : undefined} onClick={() => setPicked(r.key)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setPicked(r.key)}>
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
            </div>
            {route && rep && (
              <div className="eco-sub">
                <h4>{UI.again(good(route.goodId), place(route.from), place(route.to), d.hours)}</h4>
                <LineChart xs={rep.hours} series={[{ name: UI.profitSeries, values: rep.profit }]} xLabel={UI.hoursPlayed} />
                <p>
                  {rep.stopsAt === null ? UI.keepsPaying : <span className="eco-bad">{UI.stops(rep.stopsAt)}</span>} {UI.total(fmt(rep.total), fmt(rep.total / Math.max(1, d.hours)))}
                </p>
                {d.currencies[0] && (
                  <button className="btn eco-add" onClick={addToMoney} title={UI.toMoneyTip}>
                    <Plus size={14} /> {UI.toMoney}
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {crafts.length > 0 && (
          <div className="eco-sub">
            <h4>{UI.crafting}</h4>
            <div className="eco-scroll">
              <table className="calc-table eco-table">
                <thead>
                  <tr>
                    <th>{UI.recipe}</th>
                    <th>{UI.at}</th>
                    <th>{UI.valueIn}</th>
                    <th>{UI.valueOut}</th>
                    <th>{UI.gain}</th>
                    <th>{UI.perHour}</th>
                  </tr>
                </thead>
                <tbody>
                  {crafts.map((c) => (
                    <tr key={`${c.recipeId}|${c.placeId}`} title={c.guessed.length ? UI.guessed(c.guessed.join(', ')) : undefined}>
                      <td>{m.recipes.find((r) => r.id === c.recipeId)?.name}</td>
                      <td>
                        {c.placeId ? place(c.placeId) : UI.basePrices}
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
            </div>
          </div>
        )}
      </section>

      <div className="eco-twocol">
        <section>
          <h3>{UI.ship}</h3>
          <div className="eco-fields">
            <label className="ld-field">
              <span>{UI.carries}</span>
              <NumberInput value={m.cargo} min={1} onChange={(cargo) => edit((x) => ({ ...x, cargo }))} />
            </label>
            <label className="ld-field">
              <span>{UI.flightCost}</span>
              <NumberInput value={m.tripCost} min={0} onChange={(tripCost) => edit((x) => ({ ...x, tripCost }))} />
            </label>
            <label className="ld-field">
              <span>{UI.docking}</span>
              <NumberInput value={m.dockMinutes} min={0} onChange={(dockMinutes) => edit((x) => ({ ...x, dockMinutes }))} />
            </label>
            <label className="ld-field">
              <span>{UI.tax}</span>
              <NumberInput value={m.fee} min={0} max={100} onChange={(fee) => edit((x) => ({ ...x, fee }))} />
            </label>
          </div>
        </section>

        <section>
          <h3>{UI.goods}</h3>
          <div className="eco-goods">
            {m.goods.map((g) => (
              <div key={g.id} className="eco-good">
                <input className="input" value={g.name} onChange={(e) => editGood(g.id, { name: e.target.value })} aria-label={UI.good} />
                <NumberInput value={g.base} min={0} onChange={(base) => editGood(g.id, { base })} aria-label={UI.basePrice} />
                <button
                  className="icon-btn"
                  aria-label={UI.removeGood}
                  onClick={() =>
                    edit((x) => ({
                      ...x,
                      goods: x.goods.filter((o) => o.id !== g.id),
                      places: x.places.map((p) => ({ ...p, slots: p.slots.filter((s) => s.goodId !== g.id) })),
                      recipes: x.recipes.map((r) => ({ ...r, inputs: r.inputs.filter((i) => i.goodId !== g.id), outputs: r.outputs.filter((o) => o.goodId !== g.id) })),
                    }))
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost eco-add" onClick={() => edit((x) => ({ ...x, goods: [...x.goods, { id: newId(), name: UI.newGood, base: 10 }] }))}>
            <Plus size={14} /> {UI.addGood}
          </button>
        </section>
      </div>

      <section>
        <h3>{UI.places}</h3>
        <p className="muted">{UI.placesHelp}</p>
        <div className="eco-places">
          {m.places.map((p) => (
            <div key={p.id} className="eco-place">
              <div className="ld-inline">
                <input className="input eco-placename" value={p.name} onChange={(e) => editPlace(p.id, { name: e.target.value })} aria-label={UI.place} />
                <button className="icon-btn" aria-label={UI.removePlace} onClick={() => edit((x) => ({ ...x, places: x.places.filter((o) => o.id !== p.id), legs: x.legs.filter((l) => l.a !== p.id && l.b !== p.id), recipes: x.recipes.map((r) => (r.placeId === p.id ? { ...r, placeId: null } : r)) }))}>
                  <X size={13} />
                </button>
              </div>
              {p.slots.length > 0 && (
                <div className="eco-scroll">
                  <table className="calc-table eco-table eco-slots">
                    <thead>
                      <tr>
                        <th>{UI.good}</th>
                        <th>{UI.price}</th>
                        <th>{UI.stock}</th>
                        <th>{UI.refill}</th>
                        <th>{UI.reacts}</th>
                        <th>{UI.priceNow}</th>
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
                              <NumberInput value={s.price} min={0} onChange={(price) => editSlot(p, s.id, { price })} aria-label={UI.price} />
                            </td>
                            <td>
                              <NumberInput value={s.stock} min={0} onChange={(stock) => editSlot(p, s.id, { stock })} aria-label={UI.stock} />
                            </td>
                            <td>
                              <NumberInput value={s.refill} min={0} onChange={(refill) => editSlot(p, s.id, { refill })} aria-label={UI.refill} />
                            </td>
                            <td>
                              <NumberInput value={s.react} min={0} onChange={(react) => editSlot(p, s.id, { react })} aria-label={UI.reacts} />
                            </td>
                            <td>{g ? ((s.price / 100) * g.base).toFixed(1) : ''}</td>
                            <td>
                              <button className="icon-btn" aria-label={UI.removeHere} onClick={() => editPlace(p.id, { slots: p.slots.filter((o) => o.id !== s.id) })}>
                                <X size={12} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {m.goods.some((g) => !p.slots.some((s) => s.goodId === g.id)) && (
                <select className="input eco-tradehere" value="" onChange={(e) => e.target.value && editPlace(p.id, { slots: [...p.slots, newSlot(e.target.value)] })} aria-label={UI.tradeHere}>
                  <option value="">{UI.tradeHere}</option>
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
        </div>
        <button className="btn btn-ghost eco-add" onClick={() => edit((x) => ({ ...x, places: [...x.places, { id: newId(), name: UI.newPlace, slots: [] }] }))}>
          <Plus size={14} /> {UI.addPlace}
        </button>
      </section>

      <div className="eco-twocol">
        <section>
          <h3>{UI.travel}</h3>
          {m.legs.map((l) => (
            <div key={l.id} className="ld-inline eco-leg">
              {placeSelect(l.a, (a) => a && edit((x) => ({ ...x, legs: x.legs.map((o) => (o.id === l.id ? { ...o, a } : o)) })))}
              <span className="muted">{UI.to}</span>
              {placeSelect(l.b, (b) => b && edit((x) => ({ ...x, legs: x.legs.map((o) => (o.id === l.id ? { ...o, b } : o)) })))}
              <NumberInput value={l.minutes} min={0} onChange={(minutes) => edit((x) => ({ ...x, legs: x.legs.map((o) => (o.id === l.id ? { ...o, minutes } : o)) }))} />
              <span className="muted">{UI.minutesBoth}</span>
              <button className="icon-btn" aria-label={UI.removeTravel} onClick={() => edit((x) => ({ ...x, legs: x.legs.filter((o) => o.id !== l.id) }))}>
                <X size={13} />
              </button>
            </div>
          ))}
          {m.places.length > 1 && (
            <button className="btn btn-ghost eco-add" onClick={() => edit((x) => ({ ...x, legs: [...x.legs, { id: newId(), a: x.places[0].id, b: x.places[1].id, minutes: 10 }] }))}>
              <Plus size={14} /> {UI.addTravel}
            </button>
          )}
        </section>

        <section>
          <h3>{UI.recipes}</h3>
          {m.recipes.map((r) => (
            <div key={r.id} className="eco-recipe">
              <div className="ld-inline">
                <input className="input" value={r.name} onChange={(e) => editRecipe(r.id, { name: e.target.value })} aria-label={UI.recipe} />
                <button className="icon-btn" aria-label={UI.removeRecipe} onClick={() => edit((x) => ({ ...x, recipes: x.recipes.filter((o) => o.id !== r.id) }))}>
                  <X size={13} />
                </button>
              </div>
              <div className="ld-inline">
                {ioRows(r, 'inputs')}
                <span className="muted">{UI.makes}</span>
                {ioRows(r, 'outputs')}
              </div>
              <div className="ld-inline">
                <span className="muted">{UI.in}</span>
                <NumberInput value={r.minutes} min={0} onChange={(minutes) => editRecipe(r.id, { minutes })} />
                <span className="muted">{UI.minAt}</span>
                {placeSelect(r.placeId, (placeId) => editRecipe(r.id, { placeId }), UI.anywhere)}
              </div>
            </div>
          ))}
          <button className="btn btn-ghost eco-add" onClick={() => edit((x) => ({ ...x, recipes: [...x.recipes, { id: newId(), name: UI.newRecipe, inputs: [], outputs: [], minutes: 5, placeId: null }] }))}>
            <Plus size={14} /> {UI.addRecipe}
          </button>
        </section>
      </div>
    </div>
  )
}
