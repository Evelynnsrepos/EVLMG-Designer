import { newId, type Id } from '@/core/model'

/** Achievements (v0.10): what players can earn, how, and how rare it should be. */

export const ACHIEVEMENT_KINDS = [
  { id: 'story', label: 'Story', color: '#9c36b5' },
  { id: 'challenge', label: 'Challenge', color: '#e03131' },
  { id: 'collection', label: 'Collection', color: '#f5a623' },
  { id: 'exploration', label: 'Exploration', color: '#2f9e44' },
  { id: 'social', label: 'Social', color: '#c2255c' },
  { id: 'secret', label: 'Secret', color: '#495057' },
  { id: 'misc', label: 'Other', color: '#3e8ef7' },
] as const
export type AchievementKind = (typeof ACHIEVEMENT_KINDS)[number]['id']

export interface Achievement {
  id: Id
  name: string
  description: string
  kind: AchievementKind
  /** How it is unlocked, in words or as a condition, e.g. "defeat 100 slimes". */
  unlock: string
  /** Steps for progress achievements (e.g. 100); 1 = one-off. */
  goal: number
  points: number
  /** Hidden until unlocked. */
  hidden: boolean
  /** Share of players expected to get it, in percent. */
  expectedPercent: number
  /** What it gives (title, item…). */
  reward: string
  image: string | null
  /** v0.16: an icon from Pixel Art (and the tag that plays), shown instead of the picture. */
  sprite?: { doc: string; tag?: string } | null
}

export interface AchievementsDoc {
  items: Achievement[]
}

export const createAchievementsDoc = (): AchievementsDoc => ({ items: [] })
export const newAchievement = (): Achievement => ({
  id: newId(),
  name: 'New achievement',
  description: '',
  kind: 'challenge',
  unlock: '',
  goal: 1,
  points: 10,
  hidden: false,
  expectedPercent: 50,
  reward: '',
  image: null,
})

export const kindColor = (k: AchievementKind) => ACHIEVEMENT_KINDS.find((x) => x.id === k)?.color

/** Totals for the summary: points, how many are hidden, rarity spread. */
export function summary(list: Achievement[]) {
  const points = list.reduce((s, a) => s + a.points, 0)
  const rare = list.filter((a) => a.expectedPercent < 10).length
  const common = list.filter((a) => a.expectedPercent >= 50).length
  return { count: list.length, points, hidden: list.filter((a) => a.hidden).length, rare, common }
}

/** Platforms cap points (Xbox: 1000 for a full game); flag when over. */
export const OVER_BUDGET = 1000
