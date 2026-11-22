import { newId, type Id } from '@/core/model'
import type { Condition as FlagCondition } from '@/shared/flags'

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
  // ---- v0.35 (all optional) ----
  /** Id the game and the store use, e.g. ACH_SLIME_BANE. */
  apiName?: string
  /** What players see before it unlocks (hidden ones show this instead). */
  lockedDescription?: string
  /** Other achievements that must be done first. */
  needs?: Id[]
  /** Needs every other achievement (in its group) first, e.g. a top trophy. */
  needsAllOthers?: boolean
  /** Game-state conditions on project flags, e.g. slimes_defeated >= 100. */
  when?: FlagCondition[]
  /** All conditions, or any one of them. */
  match?: 'all' | 'any'
  /** Show a progress bar from the first number condition. */
  showProgress?: boolean
  /** One of the settings' grades. */
  grade?: string
  groupId?: Id | null
  /** Tree with tabs: the achievement it hangs under (none = a tab of its own) and its frame. */
  parentId?: Id | null
  frame?: string
  /** Hour of play when most players should earn it. */
  hour?: number | null
  /** Values for the settings' own fields, by field id. */
  custom?: Record<Id, string | number | boolean>
}

export interface CustomField {
  id: Id
  name: string
  type: 'text' | 'number' | 'choice' | 'check'
  /** Choices for type choice. */
  options: string[]
}

export interface AchievementGroup {
  id: Id
  name: string
  /** Point budget of this group, 0 = none. */
  budget: number
}

/** How the list is set up for the target platforms; everything is optional. */
export interface AchievementSettings {
  /** What points are called, e.g. Points, Gamerscore. */
  pointsName: string
  /** Point budget of the base game, 0 = none. */
  budget: number
  /** Grades from lowest to highest, e.g. Bronze, Silver, Gold, Platinum. */
  grades: string[]
  /** The highest grade is given once and needs all others. */
  topGradeNeedsAll: boolean
  /** Every achievement needs an API name. */
  needApiName: boolean
  /** Achievements hang under a parent; each one without a parent is a tab. */
  tree: boolean
  /** Frame styles for the tree, e.g. Task, Goal, Challenge. */
  frames: string[]
  groups: AchievementGroup[]
  fields: CustomField[]
  /** Folder name used by the data pack export. */
  namespace: string
}

export interface AchievementsDoc {
  items: Achievement[]
  settings?: AchievementSettings
}

export const defaultSettings = (): AchievementSettings => ({
  pointsName: 'Points',
  budget: 0,
  grades: [],
  topGradeNeedsAll: false,
  needApiName: false,
  tree: false,
  frames: [],
  groups: [],
  fields: [],
  namespace: 'my_game',
})

export const settingsOf = (d: AchievementsDoc | undefined): AchievementSettings => ({ ...defaultSettings(), ...d?.settings })

/** Ready-made setups: each turns on what a platform asks for; they can be combined and changed after. */
export const SETUPS: { id: string; label: string; note: string; apply(s: AchievementSettings): AchievementSettings }[] = [
  {
    id: 'steam',
    label: 'Steam',
    note: 'API names; progress bars come from a number flag.',
    apply: (s) => ({ ...s, needApiName: true }),
  },
  {
    id: 'xbox',
    label: 'Xbox',
    note: 'Gamerscore with a 1000 budget for the base game.',
    apply: (s) => ({ ...s, needApiName: true, pointsName: 'Gamerscore', budget: 1000 }),
  },
  {
    id: 'playstation',
    label: 'PlayStation',
    note: 'Bronze, Silver, Gold and one Platinum that needs all others.',
    apply: (s) => ({ ...s, needApiName: true, grades: ['Bronze', 'Silver', 'Gold', 'Platinum'], topGradeNeedsAll: true }),
  },
  {
    id: 'tree',
    label: 'Tree with tabs',
    note: 'Each achievement hangs under a parent and has a frame; adds Icon id and Trigger fields; exports a data pack.',
    apply: (s) => ({
      ...s,
      tree: true,
      frames: s.frames.length ? s.frames : ['Task', 'Goal', 'Challenge'],
      fields: [...s.fields, ...['Icon id', 'Trigger'].filter((n) => !s.fields.some((f) => f.name === n)).map((name) => newField(name))],
    }),
  },
]

export const newField = (name = 'New field', type: CustomField['type'] = 'text'): CustomField => ({ id: newId(), name, type, options: [] })
export const newGroup = (name = 'New group'): AchievementGroup => ({ id: newId(), name, budget: 0 })

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

/** Achievements an achievement waits for: its needs and its parent. */
export const before = (a: Achievement) => [...(a.needs ?? []), ...(a.parentId ? [a.parentId] : [])]

/** Would `id` waiting for `other` make a loop? */
export function wouldLoop(list: Achievement[], id: Id, other: Id): boolean {
  const seen = new Set<Id>()
  const stack = [other]
  while (stack.length) {
    const x = stack.pop()!
    if (x === id) return true
    if (seen.has(x)) continue
    seen.add(x)
    const a = list.find((o) => o.id === x)
    if (a) stack.push(...before(a))
  }
  return false
}

/** Remove an achievement and every link to it. */
export function removeAchievement(list: Achievement[], id: Id): Achievement[] {
  return list
    .filter((a) => a.id !== id)
    .map((a) => (a.needs?.includes(id) || a.parentId === id ? { ...a, needs: a.needs?.filter((n) => n !== id), parentId: a.parentId === id ? null : a.parentId } : a))
}

/** A suggested API name from the title: "Slime Bane" -> ACH_SLIME_BANE. */
export const suggestApiName = (name: string) => 'ACH_' + (name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'NEW')

/** Points per group (null = base game). */
export function pointsByGroup(list: Achievement[]): Map<Id | null, number> {
  const m = new Map<Id | null, number>()
  for (const a of list) m.set(a.groupId ?? null, (m.get(a.groupId ?? null) ?? 0) + a.points)
  return m
}

/** Things to fix before the list fits the settings, as short sentences. */
export function checks(list: Achievement[], s: AchievementSettings): string[] {
  const out: string[] = []
  const names = (xs: Achievement[]) => xs.map((a) => a.name).slice(0, 3).join(', ') + (xs.length > 3 ? ` and ${xs.length - 3} more` : '')
  if (!list.length) return out
  const noDesc = list.filter((a) => !a.description.trim())
  if (noDesc.length) out.push(`No description yet: ${names(noDesc)}.`)
  if (s.needApiName) {
    const missing = list.filter((a) => !a.apiName?.trim())
    if (missing.length) out.push(`No API name yet: ${names(missing)}.`)
    const bad = list.filter((a) => a.apiName && !/^[A-Za-z0-9_]+$/.test(a.apiName))
    if (bad.length) out.push(`API names may only use letters, numbers and _: ${names(bad)}.`)
    const seen = new Map<string, number>()
    for (const a of list) if (a.apiName) seen.set(a.apiName, (seen.get(a.apiName) ?? 0) + 1)
    const dup = [...seen].filter(([, n]) => n > 1).map(([k]) => k)
    if (dup.length) out.push(`API names used twice: ${dup.join(', ')}.`)
  }
  const pts = pointsByGroup(list)
  const budgets: [Id | null, string, number][] = [[null, 'The base game', s.budget], ...s.groups.map((g): [Id | null, string, number] => [g.id, g.name, g.budget])]
  for (const [id, label, budget] of budgets) {
    const have = pts.get(id) ?? 0
    if (budget > 0 && have !== budget) out.push(`${label} has ${have} of ${budget} ${s.pointsName.toLowerCase()} (${have > budget ? `${have - budget} too many` : `${budget - have} left to give`}).`)
  }
  if (s.grades.length) {
    const noGrade = list.filter((a) => !a.grade || !s.grades.includes(a.grade))
    if (noGrade.length) out.push(`No grade yet: ${names(noGrade)}.`)
    if (s.topGradeNeedsAll) {
      const top = s.grades[s.grades.length - 1]
      const tops = list.filter((a) => a.grade === top)
      for (const g of [null, ...s.groups.map((x) => x.id)]) {
        const n = tops.filter((a) => (a.groupId ?? null) === g).length
        if (n > 1) out.push(`Only one ${top} per group; ${s.groups.find((x) => x.id === g)?.name ?? 'the base game'} has ${n}.`)
      }
      const loose = tops.filter((a) => !a.needsAllOthers)
      if (loose.length) out.push(`${top} should need all other achievements: ${names(loose)}.`)
    }
  }
  const counters = list.filter((a) => a.showProgress && !a.when?.length)
  if (counters.length) out.push(`A progress bar needs a number condition under When: ${names(counters)}.`)
  if (s.tree) {
    const noFrame = list.filter((a) => s.frames.length && !a.frame)
    if (noFrame.length) out.push(`No frame yet: ${names(noFrame)}.`)
  }
  for (const f of s.fields) {
    if (f.type === 'check') continue
    const empty = list.filter((a) => a.custom?.[f.id] === undefined || a.custom[f.id] === '')
    if (empty.length && empty.length < list.length) out.push(`${f.name} is empty on: ${names(empty)}.`)
  }
  return out
}

/** One row per achievement, every setting's field included. */
export function toRows(list: Achievement[], s: AchievementSettings, describe: (a: Achievement) => string): string[][] {
  const name = (id: Id) => list.find((a) => a.id === id)?.apiName || list.find((a) => a.id === id)?.name || ''
  const group = (id?: Id | null) => s.groups.find((g) => g.id === id)?.name ?? ''
  return [
    ['API name', 'Title', 'Description', 'Locked description', 'Hidden', s.pointsName, 'Grade', 'Group', 'Category', 'Unlocks', 'In words', 'Needs first', 'Parent', 'Frame', 'Hour', 'Expected %', 'Reward', ...s.fields.map((f) => f.name)],
    ...list.map((a) => [
      a.apiName ?? '',
      a.name,
      a.description,
      a.lockedDescription ?? '',
      a.hidden ? 'yes' : 'no',
      String(a.points),
      a.grade ?? '',
      group(a.groupId),
      a.kind,
      describe(a),
      a.unlock,
      [...(a.needsAllOthers ? ['all others'] : []), ...(a.needs ?? []).map(name)].join('; '),
      a.parentId ? name(a.parentId) : '',
      a.frame ?? '',
      a.hour == null ? '' : String(a.hour),
      String(a.expectedPercent),
      a.reward,
      ...s.fields.map((f) => String(a.custom?.[f.id] ?? '')),
    ]),
  ]
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'achievement'

/**
 * Data pack for tree-with-tabs games (path -> JSON text): one file per
 * achievement with parent, frame and display text, read by games that load
 * advancements from data/<namespace>/advancement/. Icon and trigger come from
 * the fields named "Icon id" and "Trigger".
 */
export function treePack(list: Achievement[], s: AchievementSettings): Record<string, string> {
  const ns = slug(s.namespace)
  const field = (a: Achievement, n: string) => {
    const f = s.fields.find((x) => x.name.toLowerCase() === n)
    const v = f ? a.custom?.[f.id] : undefined
    return typeof v === 'string' && v.trim() ? v.trim() : undefined
  }
  const paths = new Map<Id, string>()
  const used = new Set<string>()
  for (const a of list) {
    let p = slug(a.apiName || a.name)
    while (used.has(p)) p += '_2'
    used.add(p)
    paths.set(a.id, p)
  }
  const files: Record<string, string> = { 'pack.mcmeta': JSON.stringify({ pack: { pack_format: 48, description: 'Achievements' } }, null, 2) }
  for (const a of list) {
    const parent = a.parentId && paths.has(a.parentId) ? a.parentId : null
    const adv = {
      ...(parent ? { parent: `${ns}:${paths.get(parent)}` } : {}),
      display: {
        icon: { id: field(a, 'icon id') ?? 'minecraft:book' },
        title: a.name,
        description: a.description,
        frame: (a.frame ?? 'task').toLowerCase(),
        show_toast: true,
        announce_to_chat: true,
        hidden: a.hidden,
        ...(parent ? {} : { background: 'minecraft:textures/gui/advancements/backgrounds/stone.png' }),
      },
      criteria: { done: { trigger: field(a, 'trigger') ?? 'minecraft:impossible' } },
    }
    files[`data/${ns}/advancement/${paths.get(a.id)}.json`] = JSON.stringify(adv, null, 2)
  }
  return files
}
