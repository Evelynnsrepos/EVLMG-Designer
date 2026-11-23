import { describe, expect, it } from 'vitest'
import { buy, crafting, emptyMarket, newSlot, repeatRoute, routes, sell, spaceExample, unitPrice, type Market } from './market'

const two = (): Market => {
  const m = emptyMarket()
  const g = { id: 'g', name: 'Ore', base: 10 }
  m.goods = [g]
  m.places = [
    { id: 'a', name: 'A', slots: [{ ...newSlot('g'), price: 50, stock: 1000, refill: 0, react: 5 }] },
    { id: 'b', name: 'B', slots: [{ ...newSlot('g'), price: 150, stock: 1000, refill: 0, react: 5 }] },
  ]
  m.legs = [{ id: 'l', a: 'a', b: 'b', minutes: 25 }]
  m.dockMinutes = 5
  m.cargo = 100
  return m
}

describe('markets', () => {
  it('prices rise when stock is bought and fall when sold', () => {
    const m = two()
    const [g] = m.goods
    const s = m.places[0].slots[0]
    expect(unitPrice(g, s, 1000)).toBe(5)
    expect(unitPrice(g, s, 900)).toBeCloseTo(5.25)
    const b = buy(g, s, 1000, 100)
    expect(b.stock).toBeCloseTo(900)
    expect(b.cost).toBeGreaterThan(500)
    expect(b.cost).toBeLessThan(525)
    expect(sell(g, s, 1000, 100).money).toBeLessThan(500)
    expect(buy(g, s, 30, 100).units).toBe(30)
  })

  it('finds the route, and repeating it without refill wears it out', () => {
    const m = two()
    const [best] = routes(m)
    expect(best.from).toBe('a')
    expect(best.minutes).toBe(60)
    expect(best.perHour).toBeCloseTo(best.profit)
    expect(best.profit).toBeGreaterThan(900)
    const rep = repeatRoute(m, best, 40)
    expect(rep.profit[0]).toBeGreaterThan(rep.profit[rep.profit.length - 1])
    expect(rep.stopsAt).not.toBeNull()
    const refilled = { ...m, places: m.places.map((p) => ({ ...p, slots: p.slots.map((s) => ({ ...s, refill: 1000 })) })) }
    expect(repeatRoute(refilled, best, 40).stopsAt).toBeNull()
  })

  it('crafting value and the example', () => {
    const ex = spaceExample()
    const c = crafting(ex)
    expect(c).toHaveLength(1)
    expect(c[0].perCraft).toBeCloseTo(c[0].valueOut - c[0].valueIn)
    expect(routes(ex).length).toBeGreaterThan(3)
    expect(routes(ex)[0].perHour).toBeGreaterThan(0)
  })
})
