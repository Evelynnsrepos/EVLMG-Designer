import { newId, type Id } from '@/core/model'

/**
 * Gacha & Loot Simulator (v0.7). Banners: pull rates per tier, hard and soft
 * pity, a 50/50 for the featured character with a guarantee after losing it,
 * and a pity for the second tier; thousands of simulated runs answer "how many
 * pulls (and how much money) for a 90% chance?". Loot: chests and drop tables,
 * either one weighted pick per opening or independent chances per entry.
 */

export interface Tier {
  id: Id
  name: string
  /** Base chance per pull, in percent. */
  rate: number
  color: string
}

export interface Banner {
  tiers: Tier[]
  /** The tier the player is after (the "5 star"). */
  topTierId: Id
  /** Pull number at which the top tier is guaranteed; null = no hard pity. */
  hardPity: number | null
  /** From this pull on, the top tier chance rises by `softPityStep` percent each pull; null = no soft pity. */
  softPityStart: number | null
  softPityStep: number
  /** Chance that a top-tier result is the featured one, in percent (50 = a 50/50). */
  featuredChance: number
  /** After losing the 50/50, the next top-tier result is the featured one. */
  guaranteeAfterLoss: boolean
  /** Guaranteed second tier at least every N pulls (the "4 star pity"); null = none. */
  secondPity: { tierId: Id; every: number } | null
  /** Featured copies wanted. */
  copies: number
  /** Pulls the player already has saved up toward pity (start state). */
  startPity: number
  costPerPull: number
  currency: string
}

export interface LootEntry {
  id: Id
  /** From the Item List; null = `name`. */
  itemId: Id | null
  name: string
  /** Weight (weighted mode) or chance in percent (independent mode). */
  value: number
  amountMin: number
  amountMax: number
}

export interface Loot {
  mode: 'weighted' | 'chance'
  entries: LootEntry[]
  /** Entry whose chances are worked out. */
  targetId: Id | null
  opens: number
}

export interface GachaDoc {
  /** 'offers' (missing tools 6a): older versions show these documents as a chest. */
  kind: 'banner' | 'loot' | 'offers'
  offers?: import('./offers').Offers
  banner: Banner
  loot: Loot
  runs: number
}

const tier = (name: string, rate: number, color: string): Tier => ({ id: newId(), name, rate, color })

export function createGachaDoc(): GachaDoc {
  const five = tier('5 star', 0.6, '#f5a623')
  const four = tier('4 star', 5.1, '#a855f7')
  const three = tier('3 star', 94.3, '#3e8ef7')
  return {
    kind: 'banner',
    banner: {
      tiers: [five, four, three],
      topTierId: five.id,
      hardPity: 90,
      softPityStart: 74,
      softPityStep: 6,
      featuredChance: 50,
      guaranteeAfterLoss: true,
      secondPity: { tierId: four.id, every: 10 },
      copies: 1,
      startPity: 0,
      costPerPull: 160,
      currency: 'gems',
    },
    loot: { mode: 'weighted', entries: [], targetId: null, opens: 100 },
    runs: 20000,
  }
}

export function normalizeGachaDoc(d: Partial<GachaDoc> | null | undefined): GachaDoc {
  const base = createGachaDoc()
  return { ...base, ...d, banner: { ...base.banner, ...d?.banner }, loot: { ...base.loot, ...d?.loot } }
}

/** Seeded random numbers so results stay the same while you look at them. */
export function rng(seed = 12345): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Top-tier chance (0..1) on the pull that is number `n` since the last top-tier result. */
export function topChance(b: Banner, n: number): number {
  const top = b.tiers.find((t) => t.id === b.topTierId)
  let p = (top?.rate ?? 0) / 100
  if (b.softPityStart !== null && n >= b.softPityStart) p += ((n - b.softPityStart + 1) * b.softPityStep) / 100
  if (b.hardPity !== null && n >= b.hardPity) p = 1
  return Math.min(1, Math.max(0, p))
}

export interface BannerResult {
  /** Pulls needed per run, sorted. */
  pulls: number[]
  average: number
  percentile(p: number): number
  /** Share of runs done within n pulls. */
  doneBy(n: number): number
  /** Top-tier results per 100 pulls on average (featured or not). */
  topPer100: number
  capped: boolean
}

const MAX_PULLS = 100000

export function simulateBanner(b: Banner, runs: number, seed = 1): BannerResult {
  const random = rng(seed)
  const pulls: number[] = []
  let tops = 0
  let total = 0
  let capped = false
  const second = b.secondPity ? b.tiers.find((t) => t.id === b.secondPity!.tierId) : undefined
  const n = Math.max(1, Math.min(200000, Math.floor(runs)))
  for (let r = 0; r < n; r++) {
    let sinceTop = Math.max(0, Math.floor(b.startPity))
    let sinceSecond = 0
    let guaranteed = false
    let copies = 0
    let count = 0
    while (copies < b.copies) {
      count++
      sinceTop++
      sinceSecond++
      if (count > MAX_PULLS) {
        capped = true
        break
      }
      if (random() < topChance(b, sinceTop)) {
        tops++
        sinceTop = 0
        sinceSecond = 0
        if (guaranteed || random() < b.featuredChance / 100) {
          copies++
          guaranteed = false
        } else if (b.guaranteeAfterLoss) guaranteed = true
      } else if (second && b.secondPity && sinceSecond >= b.secondPity.every) sinceSecond = 0
      else if (second && random() < second.rate / 100) sinceSecond = 0
    }
    total += count
    pulls.push(count)
  }
  pulls.sort((a, b2) => a - b2)
  const percentile = (p: number) => pulls[Math.min(pulls.length - 1, Math.max(0, Math.ceil((p / 100) * pulls.length) - 1))]
  const doneBy = (k: number) => {
    let lo = 0
    let hi = pulls.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pulls[mid] <= k) lo = mid + 1
      else hi = mid
    }
    return lo / pulls.length
  }
  return { pulls, average: total / pulls.length, percentile, doneBy, topPer100: (tops / Math.max(1, total)) * 100, capped }
}

export interface LootChance {
  /** Chance per opening to get the target at least once. */
  perOpen: number
  /** Expected amount of each entry per opening. */
  expected: { entry: LootEntry; amount: number }[]
  /** Openings needed for a 50 / 90 / 99% chance to get the target at least once. */
  opensFor(p: number): number
}

export function lootChances(loot: Loot): LootChance {
  const avg = (e: LootEntry) => (Math.max(0, e.amountMin) + Math.max(e.amountMin, e.amountMax)) / 2
  const sum = loot.entries.reduce((s, e) => s + Math.max(0, e.value), 0)
  const chanceOf = (e: LootEntry) => (loot.mode === 'weighted' ? (sum > 0 ? Math.max(0, e.value) / sum : 0) : Math.min(1, Math.max(0, e.value) / 100))
  const target = loot.entries.find((e) => e.id === loot.targetId)
  const perOpen = target ? chanceOf(target) : 0
  return {
    perOpen,
    expected: loot.entries.map((entry) => ({ entry, amount: chanceOf(entry) * avg(entry) })),
    opensFor: (p) => (perOpen <= 0 ? Infinity : perOpen >= 1 ? 1 : Math.ceil(Math.log(1 - p) / Math.log(1 - perOpen))),
  }
}

export const newLootEntry = (name = 'Item'): LootEntry => ({ id: newId(), itemId: null, name, value: 10, amountMin: 1, amountMax: 1 })
export const newTier = (name = 'Tier', rate = 1, color = '#9aa0a6') => tier(name, rate, color)
