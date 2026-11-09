import { describe, expect, it } from 'vitest'
import { createEconomyDoc, simulateEconomy, type EconomyDoc } from './model'

describe('economy', () => {
  it('earns, spends and buys one-time items when affordable', () => {
    const d: EconomyDoc = {
      currencies: [{ id: 'g', name: 'Gold', start: 0 }],
      sources: [{ id: 's', name: 'Work', currencyId: 'g', perHour: 100, growth: 0, fromHour: 0 }],
      sinks: [
        { id: 'r', name: 'Rent', currencyId: 'g', cost: 50, kind: 'every', hours: 1, fromHour: 0 },
        { id: 'h', name: 'Horse', currencyId: 'g', cost: 200, kind: 'once', hours: 1, fromHour: 0 },
      ],
      hours: 6,
    }
    const r = simulateEconomy(d)
    expect(r.earned.g).toBeCloseTo(600)
    expect(r.spent.g).toBeCloseTo(6 * 50 + 200)
    expect(r.bought.h).toBe(3.5)
    expect(r.balance.g[r.balance.g.length - 1]).toBe(100)
    expect(r.shortfalls).toEqual([])
  })

  it('reports sinks the player cannot pay', () => {
    const d = createEconomyDoc()
    const r = simulateEconomy({ ...d, sources: [], currencies: [{ ...d.currencies[0], start: 0 }] })
    expect(r.shortfalls.length).toBeGreaterThan(0)
  })
})

describe('economy profiles and quest gold (0.28)', () => {
  it('turns hours into days per player type and spreads quest gold over the hours', async () => {
    const { daysFor, questGoldSource } = await import('./model')
    expect(daysFor(10, { id: 'c', name: 'Casual', hoursPerDay: 0.5 })).toBe(20)
    expect(daysFor(0, { id: 'c', name: 'Core', hoursPerDay: 4 })).toBe(1)
    const s = questGoldSource([{ rewardGold: 100 }, { rewardGold: 50 }], { hours: 10 }, 'gold')
    expect(s).toMatchObject({ currencyId: 'gold', perHour: 15, name: 'Quest rewards (2 quests)' })
  })
})
