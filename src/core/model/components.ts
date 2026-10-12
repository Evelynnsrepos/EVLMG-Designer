/**
 * The component types from spec section 6, plus later additions (cosmos: v0.3). This list is the contract
 * between the shell and the feature modules in `src/components/<type>/`.
 * Adding a new component type means adding it here AND creating its folder.
 */
export const COMPONENT_TYPES = [
  'timeline',
  'wiki',
  'damage-calculator',
  'item-list',
  'story-writer',
  'writer',
  'moodboard',
  'brainstorm',
  'level-calculator',
  'resource-calculator',
  'map',
  'character-list',
  'town-list',
  'enemy-list',
  'cosmos',
  'sketch',
  'design-language',
  'asset-pool',
  'wave-planner',
  'quests',
  'dialogue',
  'gacha',
  'reviews',
  'spreadsheet',
  'principles',
  'gameplay-loop',
  'skill-tree',
  'abilities',
  'crafting',
  'factions',
  'family-tree',
  'level-layout',
  'achievements',
  'names',
  'calendar',
  'economy',
  'combat',
  'balance',
  'vision',
  'scope',
  'tasks',
  'history',
  'playtests',
  'pacing',
  'pitch',
  'localization',
  'storyboard',
  'ui-flow',
  'ask',
  'texture-paint',
  'pixel-art',
] as const

export type BuiltInComponentType = (typeof COMPONENT_TYPES)[number]

/** Tools added by plugins (v0.4): `plugin.<plugin id>`. A dot, not a colon, so it is a valid folder name everywhere. */
export type PluginComponentType = `plugin.${string}`

export type ComponentType = BuiltInComponentType | PluginComponentType

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/

export function isPluginComponentType(value: unknown): value is PluginComponentType {
  return typeof value === 'string' && value.startsWith('plugin.') && PLUGIN_ID_PATTERN.test(value.slice('plugin.'.length))
}

export function isBuiltInComponentType(value: unknown): value is BuiltInComponentType {
  return typeof value === 'string' && (COMPONENT_TYPES as readonly string[]).includes(value)
}

export function isComponentType(value: unknown): value is ComponentType {
  return isBuiltInComponentType(value) || isPluginComponentType(value)
}
