import { describe, expect, it } from 'vitest'
import { createEconomyDoc, newSink, newSource, simulateEconomy, type EconomyDoc } from './model'

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

describe('meters (missing tools phase 3)', () => {
  it('falls, reaches a level, and actions refill', async () => {
    const { simulateMeters, simulateEconomy, createEconomyDoc } = await import('./model')
    const food = { id: 'f', name: 'Food', start: 100, max: 100, perHour: -5, offline: false, thresholds: [{ id: 's', below: 20, name: 'Starving', effectId: null, meterId: 'h', perHour: -10 }] }
    const health = { id: 'h', name: 'Health', start: 100, max: 100, perHour: 0, offline: false, thresholds: [] }
    const base = { ...createEconomyDoc(), hours: 24, meters: [food, health], meterActions: [] }
    const r = simulateMeters(base)
    expect(r.firstBelow.s).toBe(16.25) // 100 - 5h: just below 20 after 16 h
    expect(r.values.h.at(-1)).toBeLessThan(100)
    expect(r.values.h[Math.round(16 / 0.25)]).toBe(100) // health only falls once starving
    const fed = simulateMeters({ ...base, meterActions: [{ id: 'e', name: 'Eat', meterId: 'f', amount: 40, every: 4, costCurrencyId: null, cost: 0 }] })
    expect(fed.firstBelow.s).toBeNull()
    // a paid action shows up as spending on the Money tab
    const gold = base.currencies[0].id
    const paid = simulateEconomy({ ...base, sinks: [], meterActions: [{ id: 'e', name: 'Eat', meterId: 'f', amount: 40, every: 4, costCurrencyId: gold, cost: 10 }] })
    expect(paid.spent[gold]).toBe(60)
    expect(simulateMeters(createEconomyDoc()).times.length).toBeGreaterThan(1)
  })
})

describe('economy formulas (0.35)', () => {
  it('source and sink amounts can be formulas of t and n', () => {
    const base = createEconomyDoc()
    const gold = base.currencies[0]
    const d = { ...base, hours: 10, currencies: [{ ...gold, start: 0 }], sources: [{ ...newSource(gold.id), formula: 'if(t > 5, 200, 100)' }], sinks: [{ ...newSink(gold.id), hours: 1, formula: '10 * (n + 1)' }] }
    const r = simulateEconomy(d)
    expect(r.earned[gold.id]).toBeCloseTo(100 * 5 + 200 * 5, 0)
    expect(r.spent[gold.id]).toBe(10 + 20 + 30 + 40 + 50 + 60 + 70 + 80 + 90 + 100)
    const bad = simulateEconomy({ ...d, sources: [{ ...newSource(gold.id), formula: 'x * 2' }] })
    expect(Object.values(bad.formulaErrors)[0]).toContain('Unknown name x')
  })
})

describe('meter simulator fixes', () => {
  const base = () => ({ ...createEconomyDoc(), hours: 24 })
  const m = (p: object) => ({ id: 'a', name: 'Tank', start: 100, max: 100, perHour: -10, offline: false, thresholds: [], ...p })

  it('formulas read t, v, max and other meters by name; bad names are reported', async () => {
    const { simulateMeters } = await import('./model')
    const stress = m({ id: 's', name: 'Body Stress', start: 50, perHour: 0 })
    const mood = m({ id: 'm', name: 'Mood', formula: '-0.1 * Body_Stress' })
    const r = simulateMeters({ ...base(), hours: 1, meters: [mood, stress] })
    expect(r.values.m.at(-1)).toBeCloseTo(95)
    expect(simulateMeters({ ...base(), meters: [m({ formula: 'x + 1' })] }).formulaErrors.a).toContain('Unknown name x')
  })

  it('levels can be above, empty and full', async () => {
    const { simulateMeters } = await import('./model')
    const t = (when: string, below = 0) => ({ id: when, below, name: when, when, effectId: null, meterId: null, perHour: 0 })
    const r = simulateMeters({ ...base(), meters: [m({ thresholds: [t('above', 90), t('empty'), t('full')] })] })
    expect(r.firstBelow.full).toBe(0)
    expect(r.firstBelow.above).toBe(0)
    expect(r.firstBelow.empty).toBe(10)
  })

  it('actions can fire when needed, are charged when they fire, and odd intervals snap to quarter hours', async () => {
    const { simulateMeters, simulateEconomy } = await import('./model')
    const d = base()
    const gold = d.currencies[0].id
    const refuel = { id: 'r', name: 'Refuel', meterId: 'a', amount: 50, every: 0.25, when: 'below' as const, at: 20, costCurrencyId: gold, cost: 1 }
    const doc = { ...d, sources: [], sinks: [], meters: [m({})], meterActions: [refuel] }
    const r = simulateMeters(doc)
    expect(Math.min(...r.values.a)).toBeGreaterThanOrEqual(17)
    expect(r.fired.r.length).toBeGreaterThan(2)
    expect(simulateEconomy(doc).spent[gold]).toBe(r.fired.r.length)
    const odd = simulateMeters({ ...doc, meterActions: [{ ...refuel, when: undefined, every: 0.3, cost: 0 }] })
    expect(odd.fired.r.length).toBe(24 / 0.25)
  })

  it('offline meters change between sessions of the chosen player type', async () => {
    const { simulateMeters } = await import('./model')
    const energy = m({ start: 0, max: 1000, perHour: 1, offline: true })
    const doc = { ...base(), hours: 2, meters: [energy], meterProfileId: 'core' } // core plays 4 h a day
    expect(simulateMeters(doc).values.a.at(-1)).toBe(2)
    const casual = simulateMeters({ ...doc, meterProfileId: 'casual' }) // 0.5 h, then 23.5 h offline, four times
    expect(casual.values.a.at(-1)).toBe(2 + 4 * 23.5)
  })

  it('examples use no names from other games and work', async () => {
    const { simulateMeters, moodExample, fuelExample, refillExample, survivalExample } = await import('./model')
    for (const e of [moodExample(), fuelExample('g'), refillExample(), survivalExample()]) expect(simulateMeters({ ...base(), ...e }).times.length).toBe(97)
  })
})
