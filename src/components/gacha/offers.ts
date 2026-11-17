import { newId, type Id } from '@/core/model'
import { rng } from './logic'

/**
 * Offers mode (missing tools phase 6a): "show N, pick 1" draws like a
 * roguelite shop, level-up choices or a card draft. Answers how likely the
 * player is to see the thing they want by a given round.
 */

export interface OfferEntry {
  id: Id
  /** From the Item List; null = `name`. */
  itemId: Id | null
  name: string
  weight: number
}

export interface Offers {
  entries: OfferEntry[]
  /** Choices shown per offer. */
  shown: number
  /** Offers per run (shops, level-ups). */
  rounds: number
  targetId: Id | null
  /** What the player takes leaves the pool for the rest of the run. */
  takenLeaves: boolean
}

export const newOfferEntry = (name = 'Card', weight = 10): OfferEntry => ({ id: newId(), itemId: null, name, weight })

export function createOffers(): Offers {
  const entries = [
    ...['Common A', 'Common B', 'Common C', 'Common D', 'Common E'].map((n) => newOfferEntry(n, 20)),
    ...['Uncommon A', 'Uncommon B', 'Uncommon C'].map((n) => newOfferEntry(n, 8)),
    newOfferEntry('Rare joker', 3),
    newOfferEntry('Legendary joker', 0.5),
  ]
  return { entries, shown: 2, rounds: 8, targetId: entries[8].id, takenLeaves: false }
}

export interface OffersResult {
  /** Share of runs that saw the target by each round (index 0 = round 1). */
  seenBy: number[]
  /** Share of offers each entry appears in, over all rounds. */
  perOffer: Record<Id, number>
  /** Average round the target first shows up, among runs that saw it; null = never. */
  avgFirst: number | null
}

/** Weighted pick of `n` different entries. */
function draw(pool: OfferEntry[], n: number, random: () => number): OfferEntry[] {
  const left = pool.filter((e) => e.weight > 0)
  const out: OfferEntry[] = []
  while (out.length < n && left.length) {
    let r = random() * left.reduce((a, e) => a + e.weight, 0)
    const i = left.findIndex((e) => (r -= e.weight) < 0)
    out.push(left.splice(i < 0 ? left.length - 1 : i, 1)[0])
  }
  return out
}

/** The player takes the target when it shows up, otherwise a random choice. */
export function simulateOffers(o: Offers, runs = 5000, seed = 1): OffersResult {
  const random = rng(seed)
  const rounds = Math.max(1, Math.min(200, Math.round(o.rounds)))
  const seen = new Array(rounds).fill(0)
  const counts: Record<Id, number> = Object.fromEntries(o.entries.map((e) => [e.id, 0]))
  let firstSum = 0
  let firstRuns = 0
  for (let run = 0; run < runs; run++) {
    let pool = o.entries
    let first = -1
    for (let r = 0; r < rounds; r++) {
      const offer = draw(pool, Math.max(1, Math.round(o.shown)), random)
      for (const e of offer) counts[e.id]++
      const hit = offer.find((e) => e.id === o.targetId)
      if (hit && first < 0) first = r
      const taken = hit ?? offer[Math.floor(random() * offer.length)]
      if (o.takenLeaves && taken) pool = pool.filter((e) => e.id !== taken.id)
    }
    if (first >= 0) {
      for (let r = first; r < rounds; r++) seen[r]++
      firstSum += first + 1
      firstRuns++
    }
  }
  return {
    seenBy: seen.map((n) => n / runs),
    perOffer: Object.fromEntries(Object.entries(counts).map(([id, n]) => [id, n / (runs * rounds)])),
    avgFirst: firstRuns ? firstSum / firstRuns : null,
  }
}
