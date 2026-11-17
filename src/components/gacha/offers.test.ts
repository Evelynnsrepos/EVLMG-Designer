import { describe, expect, it } from 'vitest'
import { createOffers, newOfferEntry, simulateOffers } from './offers'

describe('offers mode', () => {
  it('3 of 10 equal entries: each shows in about 30% of offers', () => {
    const entries = Array.from({ length: 10 }, (_, i) => newOfferEntry(`C${i}`, 1))
    const r = simulateOffers({ entries, shown: 3, rounds: 1, targetId: entries[0].id, takenLeaves: false }, 20000)
    for (const e of entries) expect(r.perOffer[e.id]).toBeCloseTo(0.3, 1)
    expect(r.seenBy[0]).toBeCloseTo(0.3, 1)
  })

  it('more rounds, more chances; the rare one is rarer', () => {
    const o = createOffers()
    const r = simulateOffers(o, 4000)
    expect(r.seenBy.at(-1)!).toBeGreaterThan(r.seenBy[0])
    const legendary = o.entries.at(-1)!.id
    expect(r.perOffer[legendary]).toBeLessThan(r.perOffer[o.entries[0].id])
    expect(r.avgFirst).not.toBeNull()
  })
})
