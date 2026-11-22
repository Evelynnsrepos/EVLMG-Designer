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
  // ---- v0.35 platform overhaul (all optional) ----
  /** Steam API name / Xbox and PlayStation id, e.g. ACH_SLIME_BANE. */
  apiName?: string
  /** What players see before it unlocks (hidden ones show this instead). */
  lockedDescription?: string
  /** How it unlocks: one moment, a counter reaching the goal, or other achievements done. */
  unlockType?: UnlockType
  /** The stat the counter reads (Steam stat name), e.g. slimes_defeated. */
  stat?: string
  /** Achievements that must be unlocked first (the first one is the Minecraft parent). */
  requires?: Id[]
  /** PlayStation trophy grade. */
  trophy?: TrophyGrade
  /** Minecraft frame and icon item, e.g. minecraft:diamond_sword. */
  frame?: McFrame
  mcIcon?: string
  /** Minecraft trigger, e.g. minecraft:inventory_changed (empty = given by a command). */
  mcTrigger?: string
}

export type UnlockType = 'event' | 'counter' | 'all' | 'any'
export const UNLOCK_TYPES: { id: UnlockType; label: string }[] = [
  { id: 'event', label: 'When something happens' },
  { id: 'counter', label: 'When a counter reaches the goal' },
  { id: 'all', label: 'When all of the achievements below are done' },
  { id: 'any', label: 'When any of the achievements below is done' },
]
export type TrophyGrade = 'bronze' | 'silver' | 'gold' | 'platinum'
export const TROPHY_GRADES: { id: TrophyGrade; label: string; color: string }[] = [
  { id: 'bronze', label: 'Bronze', color: '#b0703a' },
  { id: 'silver', label: 'Silver', color: '#a7b0ba' },
  { id: 'gold', label: 'Gold', color: '#e0b000' },
  { id: 'platinum', label: 'Platinum', color: '#7fb8d9' },
]
export type McFrame = 'task' | 'goal' | 'challenge'
export const MC_FRAMES: { id: McFrame; label: string }[] = [
  { id: 'task', label: 'Task (square)' },
  { id: 'goal', label: 'Goal (rounded)' },
  { id: 'challenge', label: 'Challenge (spiky)' },
]

export type Platform = 'steam' | 'xbox' | 'playstation' | 'minecraft'
export const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'steam', label: 'Steam' },
  { id: 'xbox', label: 'Xbox' },
  { id: 'playstation', label: 'PlayStation' },
  { id: 'minecraft', label: 'Minecraft' },
]

export interface AchievementsDoc {
  items: Achievement[]
  /** v0.35: platforms to check the list against. */
  platforms?: Platform[]
  /** Minecraft datapack namespace, e.g. my_game. */
  mcNamespace?: string
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

/** Would `id` needing `other` make a loop? */
export function wouldLoop(list: Achievement[], id: Id, other: Id): boolean {
  const seen = new Set<Id>()
  const stack = [other]
  while (stack.length) {
    const x = stack.pop()!
    if (x === id) return true
    if (seen.has(x)) continue
    seen.add(x)
    stack.push(...(list.find((a) => a.id === x)?.requires ?? []))
  }
  return false
}

/** A suggested API name from the title: "Slime Bane" -> ACH_SLIME_BANE. */
export const suggestApiName = (name: string) => 'ACH_' + (name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'NEW')

/** Things to fix before the list fits a platform's rules, as short sentences. */
export function platformChecks(list: Achievement[], platforms: Platform[]): { platform: Platform; text: string }[] {
  const out: { platform: Platform; text: string }[] = []
  const say = (platform: Platform, text: string) => out.push({ platform, text })
  const names = (xs: Achievement[]) => xs.map((a) => a.name).slice(0, 3).join(', ') + (xs.length > 3 ? ` and ${xs.length - 3} more` : '')
  if (platforms.includes('steam') || platforms.includes('xbox') || platforms.includes('playstation')) {
    const p: Platform = platforms.includes('steam') ? 'steam' : platforms.includes('xbox') ? 'xbox' : 'playstation'
    const missing = list.filter((a) => !a.apiName?.trim())
    if (missing.length) say(p, `No API name yet: ${names(missing)}.`)
    const bad = list.filter((a) => a.apiName && !/^[A-Za-z0-9_]+$/.test(a.apiName))
    if (bad.length) say(p, `API names may only use letters, numbers and _: ${names(bad)}.`)
    const seen = new Map<string, number>()
    for (const a of list) if (a.apiName) seen.set(a.apiName, (seen.get(a.apiName) ?? 0) + 1)
    const dup = [...seen].filter(([, n]) => n > 1).map(([k]) => k)
    if (dup.length) say(p, `API names used twice: ${dup.join(', ')}.`)
    const noDesc = list.filter((a) => !a.description.trim())
    if (noDesc.length) say(p, `No description yet: ${names(noDesc)}.`)
  }
  if (platforms.includes('steam')) {
    const counters = list.filter((a) => (a.unlockType === 'counter' || a.goal > 1) && !a.stat?.trim())
    if (counters.length) say('steam', `Progress achievements need a stat name to show a progress bar: ${names(counters)}.`)
  }
  if (platforms.includes('xbox')) {
    const total = list.reduce((s, a) => s + a.points, 0)
    if (total > OVER_BUDGET) say('xbox', `Gamerscore is ${total}; a full game usually has ${OVER_BUDGET} at launch.`)
    else if (total < OVER_BUDGET) say('xbox', `Gamerscore is ${total} of the usual ${OVER_BUDGET} for a full game.`)
  }
  if (platforms.includes('playstation')) {
    const noGrade = list.filter((a) => !a.trophy)
    if (noGrade.length) say('playstation', `No trophy grade yet: ${names(noGrade)}.`)
    const plats = list.filter((a) => a.trophy === 'platinum')
    if (plats.length > 1) say('playstation', `Only one platinum trophy is allowed, you have ${plats.length}.`)
    if (plats.length === 1 && plats[0].unlockType !== 'all') say('playstation', `The platinum trophy should unlock when all other trophies are done (How it unlocks: all of).`)
  }
  if (platforms.includes('minecraft')) {
    const roots = list.filter((a) => !a.requires?.length)
    if (roots.length > 1) say('minecraft', `Each Minecraft tab has one root; these have no parent: ${names(roots)}. Each root becomes its own tab.`)
    const noIcon = list.filter((a) => !a.mcIcon?.trim())
    if (noIcon.length) say('minecraft', `No icon item yet (like minecraft:diamond): ${names(noIcon)}.`)
  }
  return out
}

/** One row per achievement for Steam, Xbox or PlayStation sheets. */
export function toRows(list: Achievement[]): string[][] {
  const name = (id: Id) => list.find((a) => a.id === id)?.apiName || list.find((a) => a.id === id)?.name || ''
  return [
    ['API name', 'Title', 'Description', 'Locked description', 'Hidden', 'Points', 'Trophy', 'How it unlocks', 'Unlock rule', 'Stat', 'Goal', 'Needs first', 'Expected %', 'Reward'],
    ...list.map((a) => [
      a.apiName ?? '',
      a.name,
      a.description,
      a.lockedDescription ?? '',
      a.hidden ? 'yes' : 'no',
      String(a.points),
      a.trophy ?? '',
      a.unlockType ?? 'event',
      a.unlock,
      a.stat ?? '',
      String(a.goal),
      (a.requires ?? []).map(name).join('; '),
      String(a.expectedPercent),
      a.reward,
    ]),
  ]
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'advancement'

/**
 * Minecraft datapack files (path -> JSON text): one advancement per
 * achievement, the first prerequisite is its parent. Made for 1.21 (folder
 * `advancement`, icon `id`); older versions use `advancements` and `item`.
 */
export function minecraftPack(list: Achievement[], namespace = 'my_game'): Record<string, string> {
  const ns = slug(namespace)
  const paths = new Map<Id, string>()
  const used = new Set<string>()
  for (const a of list) {
    let p = slug(a.apiName || a.name)
    while (used.has(p)) p += '_2'
    used.add(p)
    paths.set(a.id, p)
  }
  const files: Record<string, string> = {
    'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 'Advancements from EVLMG Designer' } }, null, 2),
  }
  for (const a of list) {
    const parent = a.requires?.find((r) => paths.has(r))
    const adv = {
      ...(parent ? { parent: `${ns}:${paths.get(parent)}` } : {}),
      display: {
        icon: { id: a.mcIcon?.trim() || 'minecraft:book' },
        title: a.name,
        description: a.description,
        frame: a.frame ?? 'task',
        show_toast: true,
        announce_to_chat: true,
        hidden: a.hidden,
        ...(parent ? {} : { background: 'minecraft:textures/gui/advancements/backgrounds/stone.png' }),
      },
      criteria: { done: { trigger: a.mcTrigger?.trim() || 'minecraft:impossible' } },
    }
    files[`data/${ns}/advancement/${paths.get(a.id)}.json`] = JSON.stringify(adv, null, 2)
  }
  return files
}
