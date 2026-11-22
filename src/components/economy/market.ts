import { newId, type Id } from '@/core/model'

/**
 * Markets (0.35): goods traded between places with their own prices, stock
 * and supply and demand, a ship that carries them, and recipes that turn
 * goods into other goods. For space trading, towns, factories.
 */

export interface Good {
  id: Id
  name: string
  /** Price at a place with 100%, at normal stock. */
  base: number
}

/** A good at one place. */
export interface Slot {
  id: Id
  goodId: Id
  /** Percent of the good's base price when stock is normal. */
  price: number
  /** Normal stock; you can't buy more than is in stock. */
  stock: number
  /** Units per hour that come back towards normal stock (after buying, and away after selling). */
  refill: number
  /** How much the price moves, in percent, when 10% of the normal stock is bought or sold. */
  react: number
}

export interface Place {
  id: Id
  name: string
  slots: Slot[]
}

export interface Leg {
  id: Id
  a: Id
  b: Id
  minutes: number
}

export interface Recipe {
  id: Id
  name: string
  inputs: { goodId: Id; amount: number }[]
  outputs: { goodId: Id; amount: number }[]
  minutes: number
  /** Where it can be made; null = anywhere. */
  placeId: Id | null
}

export interface Market {
  goods: Good[]
  places: Place[]
  legs: Leg[]
  recipes: Recipe[]
  /** Units the ship carries. */
  cargo: number
  /** Fuel and fees for one flight. */
  tripCost: number
  /** Minutes to land, buy or sell, and take off. */
  dockMinutes: number
  /** Sales tax, percent. */
  fee: number
}

export const emptyMarket = (): Market => ({ goods: [], places: [], legs: [], recipes: [], cargo: 100, tripCost: 0, dockMinutes: 5, fee: 0 })
export const newSlot = (goodId: Id): Slot => ({ id: newId(), goodId, price: 100, stock: 500, refill: 50, react: 5 })

/** Price of one unit at a stock level: dearer when stock is low, cheaper when it is high. Never below 10% of base. */
export function unitPrice(g: Good, s: Slot, cur: number): number {
  const off = s.stock > 0 ? (s.stock - cur) / s.stock : 0
  return Math.max(0.1, (s.price / 100) * (1 + (s.react / 100) * off * 10)) * g.base
}

/** shortcut: prices are worked out in 20 chunks per trade, which is plenty for planning; use per unit if someone needs exact cents. */
const CHUNKS = 20

/** Buys up to `units` (as stock allows); returns units, money paid and the new stock. */
export function buy(g: Good, s: Slot, cur: number, units: number): { units: number; cost: number; stock: number } {
  const n = Math.max(0, Math.min(units, cur))
  let cost = 0
  let stock = cur
  for (let i = 0; i < CHUNKS; i++) {
    const part = n / CHUNKS
    cost += part * unitPrice(g, s, stock - part / 2)
    stock -= part
  }
  return { units: n, cost, stock }
}

/** Sells `units`; returns money (before tax) and the new stock. */
export function sell(g: Good, s: Slot, cur: number, units: number): { money: number; stock: number } {
  let money = 0
  let stock = cur
  for (let i = 0; i < CHUNKS; i++) {
    const part = units / CHUNKS
    money += part * unitPrice(g, s, stock + part / 2)
    stock += part
  }
  return { money, stock }
}

export const travel = (m: Market, a: Id, b: Id) => m.legs.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))?.minutes ?? null

export interface Route {
  key: string
  goodId: Id
  from: Id
  to: Id
  units: number
  buyPrice: number
  sellPrice: number
  /** Profit of one round trip: there full, back empty (after tax and both flights). */
  profit: number
  /** Profit per hour, counting the flight back empty. */
  perHour: number
  minutes: number
}

/** Every good bought at one place and sold at another, best per hour first. */
export function routes(m: Market): Route[] {
  const out: Route[] = []
  for (const g of m.goods)
    for (const A of m.places)
      for (const B of m.places) {
        if (A === B) continue
        const sa = A.slots.find((s) => s.goodId === g.id)
        const sb = B.slots.find((s) => s.goodId === g.id)
        const mins = travel(m, A.id, B.id)
        if (!sa || !sb || mins === null) continue
        const r = trip(m, g, sa, sb, sa.stock, sb.stock)
        if (r.units <= 0) continue
        const minutes = 2 * mins + 2 * m.dockMinutes
        const profit = r.profit - m.tripCost
        out.push({ key: `${g.id}|${A.id}|${B.id}`, goodId: g.id, from: A.id, to: B.id, units: r.units, buyPrice: r.cost / r.units, sellPrice: r.money / r.units, profit, perHour: profit / (Math.max(1, minutes) / 60), minutes })
      }
  return out.sort((a, b) => b.perHour - a.perHour)
}

/** One trip: fill the ship (stock allowing), sell everything. Profit counts tax and one flight's cost (the way back costs one more). */
function trip(m: Market, g: Good, sa: Slot, sb: Slot, curA: number, curB: number) {
  const b = buy(g, sa, curA, m.cargo)
  const s = sell(g, sb, curB, b.units)
  const money = s.money * (1 - m.fee / 100)
  return { units: b.units, cost: b.cost, money, profit: money - b.cost - m.tripCost, stockA: b.stock, stockB: s.stock }
}

/**
 * Flying the same route again and again for `hours`: prices react to every trade and recover
 * by the refill rate between trips. Shows when a route stops paying.
 */
export function repeatRoute(m: Market, r: Pick<Route, 'goodId' | 'from' | 'to' | 'minutes'>, hours: number): { hours: number[]; profit: number[]; total: number; stopsAt: number | null } {
  const g = m.goods.find((x) => x.id === r.goodId)
  const sa = m.places.find((p) => p.id === r.from)?.slots.find((s) => s.goodId === r.goodId)
  const sb = m.places.find((p) => p.id === r.to)?.slots.find((s) => s.goodId === r.goodId)
  const res = { hours: [] as number[], profit: [] as number[], total: 0, stopsAt: null as number | null }
  if (!g || !sa || !sb) return res
  const step = Math.max(1, r.minutes) / 60
  let curA = sa.stock
  let curB = sb.stock
  const back = (cur: number, s: Slot) => (cur < s.stock ? Math.min(s.stock, cur + s.refill * step) : Math.max(s.stock, cur - s.refill * step))
  for (let t = step; t <= hours + 1e-9 && res.hours.length < 2000; t += step) {
    const x = trip(m, g, sa, sb, curA, curB)
    const profit = x.profit - m.tripCost
    res.hours.push(Math.round(t * 100) / 100)
    res.profit.push(Math.round(profit))
    res.total += profit
    if (profit <= 0 && res.stopsAt === null) res.stopsAt = Math.round(t * 10) / 10
    curA = back(x.stockA, sa)
    curB = back(x.stockB, sb)
  }
  return res
}

export interface Craft {
  recipeId: Id
  placeId: Id | null
  valueIn: number
  valueOut: number
  perCraft: number
  perHour: number
  /** Goods with no price at that place (valued at base price). */
  guessed: string[]
}

/** Is making it worth it? Value out minus value in, per place it can be made, at today's prices there. */
export function crafting(m: Market): Craft[] {
  const out: Craft[] = []
  for (const r of m.recipes) {
    const places = r.placeId ? m.places.filter((p) => p.id === r.placeId) : m.places.length ? m.places : [null]
    for (const p of places) {
      const guessed: string[] = []
      const value = (goodId: Id, amount: number) => {
        const g = m.goods.find((x) => x.id === goodId)
        if (!g) return 0
        const s = p?.slots.find((x) => x.goodId === goodId)
        if (!s) guessed.push(g.name)
        return amount * (s ? unitPrice(g, s, s.stock) : g.base)
      }
      const valueIn = r.inputs.reduce((a, i) => a + value(i.goodId, i.amount), 0)
      const valueOut = r.outputs.reduce((a, o) => a + value(o.goodId, o.amount), 0)
      const perCraft = valueOut - valueIn
      out.push({ recipeId: r.id, placeId: p?.id ?? null, valueIn, valueOut, perCraft, perHour: perCraft / (Math.max(0.1, r.minutes) / 60), guessed })
    }
  }
  return out.sort((a, b) => b.perHour - a.perHour)
}

/** A small made-up space economy: four stations, six goods, a refinery, a starter ship. */
export function spaceExample(): Market {
  const g = (name: string, base: number): Good => ({ id: newId(), name, base })
  const ore = g('Iron ore', 20)
  const iron = g('Refined iron', 75)
  const fuel = g('Fuel', 40)
  const food = g('Food', 30)
  const meds = g('Medicine', 150)
  const chips = g('Electronics', 300)
  const s = (good: Good, price: number, stock: number, refill: number, react = 5): Slot => ({ ...newSlot(good.id), price, stock, refill, react })
  const mine: Place = { id: newId(), name: 'Mining outpost', slots: [s(ore, 60, 3000, 400), s(food, 150, 200, 20), s(meds, 140, 50, 5), s(fuel, 90, 800, 80)] }
  const refinery: Place = { id: newId(), name: 'Refinery station', slots: [s(ore, 110, 1000, 150), s(iron, 85, 600, 60), s(fuel, 80, 1500, 150), s(food, 120, 300, 30)] }
  const hub: Place = { id: newId(), name: 'Trade hub', slots: [s(iron, 130, 1500, 120, 3), s(chips, 90, 400, 40), s(meds, 100, 300, 30), s(food, 100, 1000, 100), s(fuel, 110, 1000, 100)] }
  const farm: Place = { id: newId(), name: 'Farm moon', slots: [s(food, 55, 4000, 500), s(meds, 160, 100, 10), s(chips, 140, 100, 8)] }
  const leg = (a: Place, b: Place, minutes: number): Leg => ({ id: newId(), a: a.id, b: b.id, minutes })
  return {
    goods: [ore, iron, fuel, food, meds, chips],
    places: [mine, refinery, hub, farm],
    legs: [leg(mine, refinery, 6), leg(refinery, hub, 8), leg(mine, hub, 12), leg(hub, farm, 10), leg(farm, mine, 15)],
    recipes: [{ id: newId(), name: 'Refine iron', inputs: [{ goodId: ore.id, amount: 3 }], outputs: [{ goodId: iron.id, amount: 1 }], minutes: 2, placeId: refinery.id }],
    cargo: 120,
    tripCost: 150,
    dockMinutes: 3,
    fee: 2,
  }
}
