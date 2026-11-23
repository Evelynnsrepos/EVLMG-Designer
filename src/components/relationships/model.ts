import { newId, type Id, type LinkTarget } from '@/core/model'

/**
 * Relationships (missing tools phase 2, review fixes 0.35): a bond between the player (or anyone) and a character
 * or faction. Ranks above and below zero with the points each needs, gifts with your own moods, what every rank
 * unlocks and needs, when they are free, and how many days (or missions, turns…) a player needs per rank.
 */

export interface MoodDef {
  id: string
  label: string
  points: number
  color: string
}

/** The first moods; files from before 0.35 only have their points (`moodPoints`). */
export const MOODS: readonly MoodDef[] = [
  { id: 'love', label: 'Loves', points: 50, color: '#c2255c' },
  { id: 'like', label: 'Likes', points: 25, color: '#2f9e44' },
  { id: 'neutral', label: 'Neutral', points: 10, color: '#868e96' },
  { id: 'dislike', label: 'Dislikes', points: -10, color: '#f08c00' },
  { id: 'hate', label: 'Hates', points: -30, color: '#e03131' },
]
export type Mood = string

export const BOND_KINDS = ['Friend', 'Romance', 'Rival', 'Follower', 'Mentor', 'Reputation', 'Trust'] as const

export interface RankCurve {
  /** flat: every rank costs `base`; linear: base + step per rank; growing: base × (1 + step%) per rank; custom: typed per rank. */
  mode: 'flat' | 'linear' | 'growing' | 'custom'
  base: number
  step: number
  custom: number[]
}

/** A line on a rank: what it unlocks, or what it needs before a player can reach it. */
export interface RankLine {
  id: Id
  rank: number
  text: string
  target: LinkTarget | null
}

export interface Bond {
  id: Id
  /** The other side: a character from the Character List or a faction from Factions (ids are unique); null until picked. */
  characterId: Id | null
  /** Who feels it: null or missing = the player, else a character or faction id. */
  fromId?: Id | null
  /** Friend, Romance, Rival… or the person's own word. */
  bondKind: string
  /** Ranks above zero. */
  ranks: number
  /** Ranks below zero (0 = the bond can't go negative). The same curve counts down. */
  minRanks?: number
  /** Own names per rank number, e.g. { "-2": "Hated", "5": "Best friends" }. */
  rankNames?: Record<string, string>
  curve: RankCurve
  /** Points lost per time unit (a day, mission…), 0 = none. */
  decay?: number
  /** Most points a player can earn per time unit, 0 = no limit. */
  cap?: number
  /** This bond's own points for an action, by action id (else the action's points). */
  actionPoints?: Record<Id, number>
  gifts: { itemId: Id; mood: Mood }[]
  unlocks: RankLine[]
  /** What a player needs before reaching a rank (a quest, a story point, a flag…). */
  gates?: RankLine[]
  /** Bonds in the same group shut each other out: only one can go past `groupRank`. */
  group?: string
  groupRank?: number
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
  /** How often a player does it per time unit, for the plan. */
  perDay: number
}

export interface RelationshipsDoc {
  items: Bond[]
  actions: BondAction[]
  /** 0.35: own gift moods. Missing in older files: MOODS with `moodPoints`. */
  moods?: MoodDef[]
  /** Points per mood id; kept in step with `moods` so older apps still read them. */
  moodPoints: Record<string, number>
  /** Gifts a player gives one character per time unit, for the plan. */
  giftsPerDay: number
  /** The time unit the plan counts in, e.g. day / days, mission / missions. Missing = day. */
  unit?: string
  units?: string
}

export const RELATIONSHIPS_DOC = { type: 'relationships' as const, id: 'relationships' }

export const createRelationshipsDoc = (): RelationshipsDoc => ({
  items: [],
  actions: [
    { id: newId(), name: 'Talk', points: 10, perDay: 1 },
    { id: newId(), name: 'Hang out', points: 40, perDay: 0.2 },
    { id: newId(), name: 'Finish their quest', points: 100, perDay: 0.05 },
  ],
  moods: MOODS.map((m) => ({ ...m })),
  moodPoints: Object.fromEntries(MOODS.map((m) => [m.id, m.points])),
  giftsPerDay: 1,
})

export const newBond = (characterId: Id | null = null): Bond => ({
  id: newId(),
  characterId,
  fromId: null,
  bondKind: 'Friend',
  ranks: 10,
  minRanks: 0,
  curve: { mode: 'growing', base: 100, step: 15, custom: [] },
  decay: 0,
  cap: 0,
  gifts: [],
  unlocks: [{ id: newId(), rank: 1, text: 'Calls you by your name', target: null }],
  gates: [],
  free: [],
  flagId: null,
  notes: '',
})

/** The moods of a document, also for files from before 0.35. */
export const moodsOf = (d: Pick<RelationshipsDoc, 'moods' | 'moodPoints'>): MoodDef[] => d.moods ?? MOODS.map((m) => ({ ...m, points: d.moodPoints[m.id] ?? m.points }))

/** Writes moods and keeps `moodPoints` in step. */
export const withMoods = <D extends RelationshipsDoc>(d: D, moods: MoodDef[]): D => ({ ...d, moods, moodPoints: Object.fromEntries(moods.map((m) => [m.id, m.points])) })

/** Points to go from rank r-1 to rank r (r from 1); below zero the same curve counts down, so rank -r costs the same as r. */
export function rankCost(c: RankCurve, r: number): number {
  const i = Math.max(1, Math.abs(r)) - 1
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

/** Every rank from the lowest to the top with its points (negative below zero); rank 0 is the start. */
export function rankLadder(b: Pick<Bond, 'curve' | 'ranks' | 'minRanks'>): { rank: number; cost: number; total: number }[] {
  const up = rankTotals(b).map((total, i) => ({ rank: i + 1, cost: rankCost(b.curve, i + 1), total }))
  const down = rankTotals({ curve: b.curve, ranks: Math.max(0, b.minRanks ?? 0) }).map((t, i) => ({ rank: -(i + 1), cost: rankCost(b.curve, i + 1), total: -t }))
  return [...down.reverse(), { rank: 0, cost: 0, total: 0 }, ...up]
}

/** An action's points for this bond. */
export const actionPoints = (b: Pick<Bond, 'actionPoints'>, a: BondAction) => b.actionPoints?.[a.id] ?? a.points

/** Points a player gets per time unit: every action at its rate plus the gifts (each the best mood this bond has, neutral if none), up to the cap, minus decay. */
export function pointsPerDay(b: Bond, d: RelationshipsDoc): number {
  const moods = moodsOf(d)
  const actions = d.actions.reduce((a, x) => a + actionPoints(b, x) * Math.max(0, x.perDay), 0)
  const neutral = moods.find((m) => m.id === 'neutral')?.points ?? 0
  const best = b.gifts.length ? Math.max(...b.gifts.map((g) => moods.find((m) => m.id === g.mood)?.points ?? 0)) : neutral
  const gain = actions + Math.max(0, best) * Math.max(0, d.giftsPerDay)
  const capped = b.cap && b.cap > 0 ? Math.min(gain, b.cap) : gain
  return capped - Math.max(0, b.decay ?? 0)
}

/** Time units to reach each rank above zero at that pace (Infinity when a player gains nothing). */
export function daysPerRank(b: Bond, d: RelationshipsDoc): number[] {
  const per = pointsPerDay(b, d)
  return rankTotals(b).map((t) => (per > 0 ? Math.ceil(t / per) : Infinity))
}

/** Puts unlocks and gates back inside the bond's ranks after the ranks change, so none go missing. */
export function clampLines(b: Pick<Bond, 'ranks' | 'minRanks' | 'unlocks' | 'gates'>): Pick<Bond, 'unlocks' | 'gates'> {
  const lo = -Math.max(0, b.minRanks ?? 0)
  const fix = (l: RankLine) => {
    const r = Math.min(b.ranks, Math.max(lo, Math.round(l.rank)))
    return { ...l, rank: r === 0 ? (l.rank < 0 && lo < 0 ? -1 : 1) : r }
  }
  return { unlocks: b.unlocks.map(fix), gates: (b.gates ?? []).map(fix) }
}

/** The flag name for a bond: bond_<other side>, or bond_<from>_<other side> when someone other than the player feels it. */
export const bondFlagText = (to: string | null, from: string | null) => `bond ${from ? `${from} ` : ''}${to || 'new'}`

/** Other bonds in the same group. */
export const groupMates = (b: Bond, all: Bond[]) => (b.group?.trim() ? all.filter((x) => x.id !== b.id && x.group?.trim() === b.group!.trim()) : [])
