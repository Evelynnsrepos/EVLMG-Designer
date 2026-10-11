import { newId, type ComponentType } from '@/core/model'
import { loadDocumentNow, updateDocument } from '@/core/state'

/**
 * Project templates by genre (v0.10): which tools a new project starts with,
 * plus a vision page with the genre and suggested pillars, and a starter task list.
 */
export interface Template {
  id: string
  name: string
  description: string
  components: ComponentType[]
  genre: string
  pillars: [string, string][]
  tasks: string[]
}

const PLAN: ComponentType[] = ['vision', 'scope', 'tasks', 'writer', 'wiki']

export const TEMPLATES: Template[] = [
  {
    id: 'rpg',
    name: 'RPG',
    description: 'Characters, quests, dialogue, items with rarities, skills, crafting and a world.',
    components: [...PLAN, 'character-list', 'item-list', 'enemy-list', 'town-list', 'quests', 'dialogue', 'skill-tree', 'abilities', 'crafting', 'level-calculator', 'damage-calculator', 'map', 'factions', 'timeline', 'calendar'],
    genre: 'Role-playing game',
    pillars: [
      ['Choices shape the world', 'What the player decides changes places, people and endings.'],
      ['Every build is viable', 'Many ways to play, none of them a trap.'],
      ['A world worth exploring', 'Curiosity is always rewarded.'],
    ],
    tasks: ['Write the main story outline', 'Define the character classes', 'Draft the first quest chain', 'Set the level curve', 'Sketch the world map'],
  },
  {
    id: 'action',
    name: 'Action / platformer',
    description: 'Levels, enemies, abilities, pacing and playtests.',
    components: [...PLAN, 'level-layout', 'enemy-list', 'abilities', 'pacing', 'playtests', 'sketch', 'asset-pool'],
    genre: 'Action platformer',
    pillars: [
      ['Tight controls', 'The character does exactly what the player wants, instantly.'],
      ['Easy to learn, hard to master', 'Simple moves that combine into skillful play.'],
      ['Always moving forward', 'Short levels, quick restarts, no waiting.'],
    ],
    tasks: ['Prototype movement', 'Design the first level', 'List enemy types', 'Plan the pacing of world 1', 'Run a first playtest'],
  },
  {
    id: 'roguelike',
    name: 'Roguelike / roguelite',
    description: 'Runs, loot, enemies, combat and economy simulation, the core loop.',
    components: [...PLAN, 'gameplay-loop', 'item-list', 'enemy-list', 'abilities', 'gacha', 'combat', 'economy', 'balance', 'level-layout', 'playtests'],
    genre: 'Roguelike',
    pillars: [
      ['Every run is different', 'Random rooms, items and enemies combine in new ways.'],
      ['Death teaches', 'Players understand why they lost and want to try again.'],
      ['Meaningful progress', 'Even a failed run unlocks something.'],
    ],
    tasks: ['Define the run loop', 'List the item pool', 'Design 3 enemy types per biome', 'Simulate the meta economy', 'Balance the first boss'],
  },
  {
    id: 'strategy',
    name: 'Strategy / tower defense',
    description: 'Waves, units, economy, combat simulation and balance.',
    components: [...PLAN, 'wave-planner', 'enemy-list', 'item-list', 'economy', 'combat', 'balance', 'spreadsheet', 'damage-calculator', 'map'],
    genre: 'Strategy',
    pillars: [
      ['Every decision has a trade-off', 'No option is best in every situation.'],
      ['Readable at a glance', 'The player can see what is happening and why.'],
      ['Many paths to victory', 'Different strategies win.'],
    ],
    tasks: ['Plan the first 20 waves', 'Define unit roles', 'Model the economy', 'Balance damage with the combat simulator'],
  },
  {
    id: 'narrative',
    name: 'Visual novel / narrative',
    description: 'Story branches, dialogue, characters, writing principles and a family tree.',
    components: [...PLAN, 'story-writer', 'dialogue', 'character-list', 'family-tree', 'principles', 'timeline', 'pacing', 'names', 'storyboard', 'localization'],
    genre: 'Narrative adventure',
    pillars: [
      ['Characters you care about', 'Every main character wants something and changes.'],
      ['Choices with weight', 'Decisions are hard and their consequences visible.'],
      ['Show, don’t tell', 'Moments over exposition.'],
    ],
    tasks: ['Write the premise', 'Outline the main branches', 'Create the cast', 'Write the first scene', 'Plan the emotional pacing'],
  },
  {
    id: 'gacha',
    name: 'Gacha / live service',
    description: 'Characters, rarities, banners and pull rates, economy, achievements and events.',
    components: [...PLAN, 'character-list', 'item-list', 'gacha', 'economy', 'achievements', 'calendar', 'balance', 'abilities', 'level-calculator', 'resource-calculator'],
    genre: 'Gacha RPG',
    pillars: [
      ['Characters worth collecting', 'Every character has a story and a reason to play them.'],
      ['Fair to free players', 'Everything can be earned with time.'],
      ['Always something to look forward to', 'Events and updates on a clear schedule.'],
    ],
    tasks: ['Set the rarity tiers', 'Simulate the first banner', 'Model daily income', 'Plan the first event'],
  },
  {
    id: 'cozy',
    name: 'Cozy / farming',
    description: 'Crafting, items, the daily loop, a calendar with seasons and townsfolk.',
    components: [...PLAN, 'gameplay-loop', 'crafting', 'item-list', 'character-list', 'town-list', 'calendar', 'economy', 'achievements', 'moodboard'],
    genre: 'Cozy life sim',
    pillars: [
      ['No pressure', 'The player sets the pace; nothing is lost by waiting.'],
      ['Small daily joys', 'Every day has something nice to discover.'],
      ['A town that remembers', 'Neighbours react to what the player does.'],
    ],
    tasks: ['Define the daily loop', 'Plan the seasons', 'List crops and recipes', 'Write the townsfolk'],
  },
  // v0.13: projects that are not (only) a game.
  {
    id: 'story',
    name: 'Just write a story',
    description: 'Writing with characters, places, a timeline, names and a family tree, nothing else in the way.',
    components: ['writer', 'story-writer', 'wiki', 'character-list', 'town-list', 'timeline', 'family-tree', 'names', 'calendar', 'principles', 'brainstorm'],
    genre: 'Story',
    pillars: [],
    tasks: ['Write the first chapter', 'Introduce the main characters', 'Sketch the timeline'],
  },
  {
    id: 'art',
    name: 'Drawing and art',
    description: 'Draw, collect references on moodboards, keep a design language and an asset list.',
    components: ['sketch', 'moodboard', 'design-language', 'asset-pool', 'storyboard', 'brainstorm', 'tasks'],
    genre: 'Art',
    pillars: [],
    tasks: ['Collect references on a moodboard', 'Draw the first sketches', 'Decide the colour palette'],
  },
  {
    id: 'world',
    name: 'Worldbuilding',
    description: 'A whole world: wiki, maps, cosmos, timeline, calendar, factions, peoples and names.',
    components: ['wiki', 'map', 'cosmos', 'timeline', 'calendar', 'factions', 'names', 'town-list', 'character-list', 'family-tree', 'writer', 'brainstorm'],
    genre: 'Worldbuilding',
    pillars: [],
    tasks: ['Draw the first map', 'List the factions', 'Set up the calendar and eras'],
  },
  {
    id: 'levels',
    name: 'Level design',
    description: 'Level layouts with tilesets, maps, enemies and items, pacing and playtests.',
    components: [...PLAN, 'level-layout', 'map', 'enemy-list', 'item-list', 'pacing', 'playtests', 'sketch'],
    genre: 'Level design',
    pillars: [
      ['Readable spaces', 'Players always know where they can go.'],
      ['Teach, test, twist', 'Each level introduces an idea, tests it, then turns it around.'],
      ['Rewarded curiosity', 'Exploring off the main path pays off.'],
    ],
    tasks: ['Block out the first level', 'Add a tileset', 'Plan the pacing', 'Playtest the first level'],
  },
  {
    id: 'tabletop',
    name: 'Tabletop / pen and paper',
    description: 'Characters, monsters, items, maps, quests and the world for a campaign or a board game.',
    components: ['character-list', 'enemy-list', 'item-list', 'town-list', 'map', 'quests', 'wiki', 'factions', 'names', 'timeline', 'writer'],
    genre: 'Tabletop',
    pillars: [],
    tasks: ['Write the first session', 'Prepare the main villain', 'Draw the starting town'],
  },
  {
    id: 'pitch',
    name: 'Plan and pitch',
    description: 'Vision, pillars, scope, tasks, the core loop and a pitch deck, to plan a game before building it.',
    components: ['vision', 'scope', 'tasks', 'gameplay-loop', 'principles', 'pitch', 'moodboard', 'writer'],
    genre: '',
    pillars: [
      ['One clear hook', 'The idea fits in one sentence.'],
      ['Small enough to finish', 'Scope matches the time and team.'],
      ['Fun first', 'Prototype the core loop before anything else.'],
    ],
    tasks: ['Write the one-sentence pitch', 'Pick three pillars', 'Cut the scope to a first version', 'Build the pitch deck'],
  },
]

/** Fill the new project's vision page and task board from the template. */
export async function applyTemplate(root: string, t: Template) {
  const vision = t.pillars.length || t.genre ? await loadDocumentNow<Record<string, unknown>>(root, 'vision', 'vision', () => ({})) : null
  if (vision)
    updateDocument<Record<string, unknown>>(
      root,
      'vision',
      'vision',
      (d) => ({
        ...d,
        genre: t.genre,
        pillars: t.pillars.map(([title, why], i) => ({ id: newId(), title, why, yes: '', no: '', color: ['#f5a623', '#3e8ef7', '#2f9e44'][i % 3] })),
      }),
      { undoable: false },
    )
  await loadDocumentNow<{ items: unknown[] }>(root, 'tasks', 'tasks', () => ({ items: [] }))
  updateDocument<{ items: unknown[] }>(
    root,
    'tasks',
    'tasks',
    (d) => ({ ...d, items: [...(d.items ?? []), ...t.tasks.map((title) => ({ id: newId(), title, notes: '', column: 'todo', assignee: '', due: '', priority: 'Normal', links: [] }))] }),
    { undoable: false },
  )
}
