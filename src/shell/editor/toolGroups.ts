import type { ComponentType } from '@/core/model'

/** Add tool's groups (pro fixes step 8), in menu order. Tools not listed (plugins) go under More. */
export const TOOL_GROUPS = [
  { id: 'plan', name: 'Plan & manage' },
  { id: 'write', name: 'Story & writing' },
  { id: 'world', name: 'World & characters' },
  { id: 'art', name: 'Art & look' },
  { id: 'levels', name: 'Levels & gameplay' },
  { id: 'numbers', name: 'Numbers & balance' },
  { id: 'more', name: 'More' },
] as const

export type ToolGroupId = (typeof TOOL_GROUPS)[number]['id']

/** Group and a short "use it when" line per built-in tool. */
export const TOOL_INFO: Partial<Record<ComponentType, { group: ToolGroupId; useWhen: string }>> = {
  vision: { group: 'plan', useWhen: 'pinning down what your game is about' },
  scope: { group: 'plan', useWhen: 'deciding what makes it into the game' },
  tasks: { group: 'plan', useWhen: 'tracking who does what' },
  'live-ops': { group: 'plan', useWhen: 'updates, events, banners and a battle pass after launch' },
  playtests: { group: 'plan', useWhen: 'collecting what testers said' },
  reviews: { group: 'plan', useWhen: 'leaving comments for your team' },
  pitch: { group: 'plan', useWhen: 'presenting your game to others' },
  history: { group: 'plan', useWhen: 'seeing what changed and when' },
  localization: { group: 'plan', useWhen: 'translating your game’s texts' },
  ask: { group: 'plan', useWhen: 'looking things up in your notes' },
  'custom-list': { group: 'plan', useWhen: 'any list the other tools don’t cover' },
  writer: { group: 'write', useWhen: 'writing documents and notes' },
  'story-writer': { group: 'write', useWhen: 'branching story scenes' },
  dialogue: { group: 'write', useWhen: 'conversations with choices' },
  quests: { group: 'write', useWhen: 'quests, steps and rewards' },
  principles: { group: 'write', useWhen: 'keeping your writing rules in one place' },
  timeline: { group: 'write', useWhen: 'events in your world’s history' },
  storyboard: { group: 'write', useWhen: 'cutscenes and trailers shot by shot' },
  pacing: { group: 'write', useWhen: 'how tense or calm each part feels' },
  wiki: { group: 'world', useWhen: 'an encyclopedia of your world' },
  'character-list': { group: 'world', useWhen: 'your cast and their details' },
  'town-list': { group: 'world', useWhen: 'places and what is in them' },
  'enemy-list': { group: 'world', useWhen: 'enemies, stats and drops' },
  'item-list': { group: 'world', useWhen: 'items, weapons and gear' },
  factions: { group: 'world', useWhen: 'groups and how they feel about each other' },
  'family-tree': { group: 'world', useWhen: 'who is related to whom' },
  relationships: { group: 'world', useWhen: 'friendship and romance ranks, gifts and unlocks' },
  names: { group: 'world', useWhen: 'made-up names and languages' },
  calendar: { group: 'world', useWhen: 'your world’s calendar and eras' },
  cosmos: { group: 'world', useWhen: 'planets, stars and space' },
  map: { group: 'world', useWhen: 'drawing world maps' },
  brainstorm: { group: 'world', useWhen: 'sticky notes and loose ideas' },
  moodboard: { group: 'art', useWhen: 'collecting reference pictures' },
  'design-language': { group: 'art', useWhen: 'shapes and colours your game uses' },
  sketch: { group: 'art', useWhen: 'painting and sketching' },
  'pixel-art': { group: 'art', useWhen: 'sprites, tiles and animations' },
  vector: { group: 'art', useWhen: 'icons and UI shapes that scale' },
  'texture-paint': { group: 'art', useWhen: 'painting on 3D models' },
  material: { group: 'art', useWhen: 'textures for 3D surfaces' },
  'card-designer': { group: 'art', useWhen: 'card games, print and play' },
  'asset-pool': { group: 'art', useWhen: 'all your pictures and sounds in one place' },
  'ui-flow': { group: 'art', useWhen: 'screens and menus and how they connect' },
  'level-layout': { group: 'levels', useWhen: 'building levels from tiles' },
  'gameplay-loop': { group: 'levels', useWhen: 'what the player does again and again' },
  'skill-tree': { group: 'levels', useWhen: 'skills that unlock each other' },
  abilities: { group: 'levels', useWhen: 'spells and abilities' },
  'status-effects': { group: 'levels', useWhen: 'burn, freeze, stun and element reactions' },
  crafting: { group: 'levels', useWhen: 'recipes and what they make' },
  achievements: { group: 'levels', useWhen: 'achievements and trophies' },
  'wave-planner': { group: 'levels', useWhen: 'enemy waves over time' },
  code: { group: 'levels', useWhen: 'writing Godot scripts' },
  'damage-calculator': { group: 'numbers', useWhen: 'how much a hit does' },
  'level-calculator': { group: 'numbers', useWhen: 'experience and levels' },
  'resource-calculator': { group: 'numbers', useWhen: 'how much of each resource you need' },
  economy: { group: 'numbers', useWhen: 'money and resources flowing in and out' },
  combat: { group: 'numbers', useWhen: 'simulating fights' },
  gacha: { group: 'numbers', useWhen: 'drop rates and pulls' },
  balance: { group: 'numbers', useWhen: 'all your numbers side by side' },
  spreadsheet: { group: 'numbers', useWhen: 'tables with formulas' },
}

/**
 * Look-alike tools hidden from Add tool. Projects that have them keep them, with all their data;
 * the menu points to the tool to use instead when someone searches for them.
 */
export const MOVED_TOOLS: Partial<Record<ComponentType, string>> = {
  'story-writer': 'Dialogue Editor and Quests',
  'design-language': 'Moodboard',
  'resource-calculator': 'Economy Simulator',
}

export const toolGroup = (type: ComponentType): ToolGroupId => TOOL_INFO[type]?.group ?? 'more'
