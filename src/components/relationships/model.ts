import { newId, type Id, type LinkTarget } from '@/core/model'

/**
 * Relationships (missing tools phase 2): friendship, romance or loyalty with
 * one character at a time. Ranks with the points they need, gifts each
 * character loves or hates, what every rank unlocks, when they are free, and
 * how many days a player needs to reach the top.
 */

export const MOODS = [
  { id: 'love', label: 'Loves', color: '#c2255c' },
  { id: 'like', label: 'Likes', color: '#2f9e44' },
  { id: 'neutral', label: 'Neutral', color: '#9aa0a6' },
  { id: 'dislike', label: 'Dislikes', color: '#f08c00' },
  { id: 'hate', label: 'Hates', color: '#e03131' },
] as const
export type Mood = (typeof MOODS)[number]['id']

export const BOND_KINDS = ['Friend', 'Romance', 'Rival', 'Follower', 'Mentor'] as const

export interface RankCurve {
  /** flat: every rank costs `base`; linear: base + step per rank; growing: base × (1 + step%) per rank; custom: typed per rank. */
  mode: 'flat' | 'linear' | 'growing' | 'custom'
  base: number
  step: number
  custom: number[]
}

export interface Bond {
  id: Id
  /** From the Character List; null until picked. */
  characterId: Id | null
  /** Friend, Romance, Rival… or the person's own word. */
  bondKind: string
  ranks: number
  curve: RankCurve
  gifts: { itemId: Id; mood: Mood }[]
  unlocks: { id: Id; rank: number; text: string; target: LinkTarget | null }[]
  /** When they can be met: weekday index (0 = first weekday) and times like 18:00. */
  free: { id: Id; day: number; from: string; to: string }[]
  /** A number flag (bond_<name>) the Dialogue Editor and Quests can check. */
  flagId?: Id | null
  notes: string
}

export interface BondAction {
  id: Id
  name: string
  points: number
  /** How often a player does it per in-game day, for the plan. */
  perDay: number
}

export interface RelationshipsDoc {
  items: Bond[]
  actions: BondAction[]
  moodPoints: Record<Mood, number>
  /** Gifts a player gives one character per day, for the plan. */
  giftsPerDay: number
}

export const RELATIONSHIPS_DOC = { type: 'relationships' as const, id: 'relationships' }

export const createRelationshipsDoc = (): RelationshipsDoc => ({
  items: [],
  actions: [
    { id: newId(), name: 'Talk', points: 10, perDay: 1 },
    { id: newId(), name: 'Hang out', points: 40, perDay: 0.2 },
    { id: newId(), name: 'Finish their quest', points: 100, perDay: 0.05 },
  ],
  moodPoints: { love: 50, like: 25, neutral: 10, dislike: -10, hate: -30 },
  giftsPerDay: 1,
})

export const newBond = (characterId: Id | null = null): Bond => ({
  id: newId(),
  characterId,
  bondKind: 'Friend',
  ranks: 10,
  curve: { mode: 'growing', base: 100, step: 15, custom: [] },
  gifts: [],
  unlocks: [{ id: newId(), rank: 1, text: 'Calls you by your name', target: null }],
  free: [],
  flagId: null,
  notes: '',
})

/** Points to go from rank r-1 to rank r (r from 1). */
export function rankCost(c: RankCurve, r: number): number {
  const i = Math.max(1, r) - 1
  switch (c.mode) {
    case 'flat':
      return Math.max(0, c.base)
    case 'linear':
      return Math.max(0, c.base + c.step * i)
    case 'growing':
      return Math.max(0, Math.round(c.base * Math.pow(1 + c.step / 100, i)))
    case 'custom':
      return Math.max(0, c.custom[i] ?? c.custom.at(-1) ?? c.base)
  }
}

/** Total points from rank 0 to each rank, index 0 = rank 1. */
export const rankTotals = (b: Pick<Bond, 'curve' | 'ranks'>): number[] => {
  let sum = 0
  return Array.from({ length: Math.max(0, b.ranks) }, (_, i) => (sum += rankCost(b.curve, i + 1)))
}

/** Points a player gets per in-game day: every action at its rate plus the gifts, each the best mood this character has (neutral if none set). */
export function pointsPerDay(b: Bond, d: RelationshipsDoc): number {
  const actions = d.actions.reduce((a, x) => a + x.points * Math.max(0, x.perDay), 0)
  const best = b.gifts.length ? Math.max(...b.gifts.map((g) => d.moodPoints[g.mood] ?? 0)) : d.moodPoints.neutral
  return actions + Math.max(0, best) * Math.max(0, d.giftsPerDay)
}

/** Days to reach each rank at that pace (Infinity when points per day is 0). */
export function daysPerRank(b: Bond, d: RelationshipsDoc): number[] {
  const per = pointsPerDay(b, d)
  return rankTotals(b).map((t) => (per > 0 ? Math.ceil(t / per) : Infinity))
}
