import { Camera, MessageCircle, Play } from 'lucide-react'
import type { ComponentType } from '@/core/model'

/** In-app user guide. Ships with the app, no network. Plain strings so they can be translated later. */

export interface GuideTopic {
  title: string
  /** Paragraphs. */
  body: string[]
  tips?: string[]
}

export const BASICS: Record<string, GuideTopic> = {
  start: {
    title: 'Getting started',
    body: [
      'Every game you design is a project. Click New Project on the start screen, give it a name and pick the tools you want. You can add more tools later.',
      'A project is a normal folder in Documents/Evelopment Games Designer, full of readable JSON files and an assets folder for images and audio. Back it up like any other folder.',
      'Inside a project, the sidebar on the left lists your tools. Click one to show only that tool; Shift-click to open it next to the ones already open. Tools that hold several documents (boards, maps, timelines…) list them underneath; right-click one to rename it. The search field above the list finds tools and documents; the star next to a tool keeps it at the top, and you can drag tools up and down to order them. Right-click a tool to give it a colour or put it in a folder; drag tools onto a folder to add them, click a folder to fold it, and right-click it to rename, colour or remove it.',
    ],
    tips: ['Questions or ideas? Join the Evelopment Games Discord, linked at the bottom of this list.', 'Press F1 anywhere to open this guide.', 'Use the Projects button at the top of the sidebar to go back to the start screen.'],
  },
  workspace: {
    title: 'Workspace and Layout Mode',
    body: [
      'You can open several tools side by side. Shift-click a tool in the sidebar, or drag a tool or document from the sidebar onto an open panel to split the screen, and drag the dividers to resize.',
      'Press Esc to enter Layout Mode. Every panel shows big buttons to close it or move it around, and you can drag a panel with the mouse: drop it on the middle of another panel to swap them, or on an edge to put it on that side; a highlight shows where it will end up. The round button on the line between two panels switches them between side by side and stacked. It stays on until you press Esc again.',
      'Single-letter shortcuts only work in the panel you clicked last, so typing in one tool never triggers another.',
    ],
    tips: ['Collapse the sidebar with the button at its bottom to get more room.', 'On drawing canvases, the Size and Smoothing sliders appear in the bottom toolbar while the pen is selected. More smoothing irons out shaky lines.'],
  },
  tools: {
    title: 'Adding and closing tools',
    body: [
      'Add tool at the bottom of the sidebar is always there. Click it to add any tool your project does not have yet.',
      'Right-click a tool in the sidebar and choose Close tool. Hide removes it from the sidebar but keeps everything you made in it. Delete contents removes the tool and everything in it; the red button has to be pressed twice, and this cannot be undone.',
      'If you add a hidden tool again, the app asks whether to bring its contents back or delete them and start empty (again with the red button pressed twice).',
    ],
  },
  saving: {
    title: 'Saving, undo and backups',
    body: [
      'There is no Save button. Everything saves about a second after you change it, and again when you close the app.',
      'Every tool has its own undo and redo: Ctrl+Z and Ctrl+Y (Cmd on a Mac).',
      'The app keeps rolling backups of your last 10 saves. On the start screen, open a project card menu (…) and choose Restore a backup.',
      'To back up a whole project or send it to someone, open its card menu (…) and choose Export as zip. Import zip on the start screen brings it back as a new project.',
    ],
  },
  spelling: {
    title: 'Spell check and the AI helper',
    body: [
      'Text editors underline misspelled words in English and German. Click an underlined word for a card with up to 3 fixes, Dismiss and Add to dictionary.',
      'Names of your items, characters, towns and enemies are always counted as correct, so your made-up names are not flagged.',
      'Settings (bottom of the sidebar, or the gear on the start screen) turns spell check on or off, picks the languages and lists your own words.',
      'The AI helper is optional. Download it in Settings: Small (1.1 GB, fast), Better (2.5 GB, catches more) or Best (4.7 GB, the most careful, needs about 6 GB of free memory). It runs on your computer and checks grammar as you write: wrong words for the sentence, verb forms, missing commas. Its suggestions get a blue underline. Click one for a card with what is wrong and up to 3 fixes, or Dismiss it. Spell check and the AI helper work in the Writer, the Wiki and the description and notes boxes. The AI helper checks the paragraphs around where you are writing first, and looks at the sentences around a mistake for its suggestions.',
    ],
  },
  plugins: {
    title: 'Plugins',
    body: [
      'Plugins add new tools made by other people. Open Settings, paste the link of a plugin on GitHub and press Install, or use Install from zip.',
      'Only install plugins you trust. A plugin is a program with full access to your computer, and in projects you share with others it can change things your teammates do not expect.',
      'An installed plugin appears in Add tool like any other tool. Remove it in Settings; what you made with it stays in your project.',
    ],
  },
  links: {
    title: 'Links and categories',
    body: [
      'Type [[ in the Wiki, Writer, Story Branch Writer or Timeline to link to an article, item, character, town or enemy. Links follow renames.',
      'Custom categories such as Element or Faction are created once and shared by the Item, Character, Town and Enemy lists.',
      'Rarities: click Rarities at the bottom of the sidebar. Rarity comes ready from Common to Legendary; change names, colors, borders (or switch them off), icons or your own pictures, and a rating as 1 to 5 stars or a number.',
      'Add more systems next to Rarity, like Tier or Quality, each on the lists you choose, and give a system your own fields (drop rate, sell price…) to fill in per rarity. Rarities show on cards, in tables, on pages, in the wiki and in [[links]].',
      'Before you delete something, the app shows every place it is used, so nothing breaks silently.',
    ],
  },
  together: {
    title: 'Working together',
    body: [
      'Several people can edit one project at the same time, each on their own computer, on Windows, Mac or Linux. There is no account: the computers connect directly, or through a server if your team runs one (see the end of this page).',
      'To invite someone, open the project and click Work together at the bottom of the sidebar. Enter your name, pick a color and click Share project. Copy the invite code and send it to your teammate.',
      'Your teammate clicks Join project on their start screen, pastes the code and picks a folder. You are asked to let them in. After that, the project is copied to their computer and changes show up for both of you within a moment.',
      'You see where the others are: colored dots in the sidebar show who is in which tool, canvases show their pointer and what they selected, and in the Writer and Wiki you type in the same text live and see their cursor.',
      'Everyone keeps a full copy. If you work offline, your changes are saved as usual and merge automatically the next time you are both online. Undo only takes back your own changes.',
      'Each person keeps their own panel layout and sidebar. The tools, documents and everything in them are shared, except drawings from Draw: those stay on each computer. Pictures made from them, like stickers on a Moodboard, are shared.',
      'The person who shared the project is the host. When the host closes the project or stops sharing, everyone else is disconnected and asked whether to keep their copy as a normal project or delete it.',
      'Only the host can remove people. Everyone else can Leave project, keeping or deleting their copy.',
      'Privacy: computers connect directly, so the people you work with can see your IP address. When a direct connection is not possible, the encrypted traffic goes through public relay servers run by n0, a US company (the makers of iroh). The project contents stay end-to-end encrypted on the way.',
      'Working through a server: an Evelopment Games Designer Server keeps a copy of the project, so people can join and catch up even when nobody else is online. Each person gets their own connect code (it starts with EGS1-) from the server\'s admin page. A code can be for editing or view only.',
      'To join a project on a server, click Join project on the start screen and paste your connect code. To put the open project on a server, open Work together, click Or work through a server, paste a connect code and click Move to server. People you shared with directly then need their own connect code.',
      'With a server, the Work together window shows the server\'s name and who is online now. Only the server\'s admin can remove people or close the project. The project is stored on that server, so whoever runs it can read it: only use servers you trust.',
      'A server can offer plugins. Click Review to see each one with the usual plugin warning; nothing installs by itself, and a plugin that changes on the server asks again.',
    ],
    tips: [
      'Without a server, the project has to be open on at least one computer that is already in it when someone joins or catches up.',
      'Making a new invite code stops older codes from working. Removing someone from the list stops their computer from connecting; they keep their copy.',
    ],
  },
  search: {
    title: 'Search (Ctrl+K) and the Design Book',
    body: [
      'Press Ctrl+K (Cmd+K on a Mac) anywhere in a project to search tools, documents, items, characters, towns, enemies, wiki articles and commands like Settings. Enter opens the result alone, Shift+Enter opens it next to the open tools.',
      'Every item, character, town and enemy page shows Jump to at the top (the things it points at, like the items an enemy drops) and Used in further down (every place in the project that mentions it). Click one to go there. The arrows under the project name, or Alt+Left and Alt+Right, take you back and forward through your jumps.',
      'Link to… at the end of the Jump to bar links the entry to anything: another entry, a document or a tool. The link shows in the other side’s Used in too. Remove a link with its ×.',
      'Design Book at the bottom of the sidebar turns your project into one game design document with a cover, contents, images and info boxes. Pick the parts and entries to include, then save it as a web page or print it; choose Save as PDF as the printer for a PDF.',
    ],
  },
  engines: {
    title: 'Export to a game engine',
    body: [
      'Engine export at the bottom of the sidebar (or Ctrl+K) writes your items, characters, towns and enemies (with stats, categories and pictures), quests, dialogue and translations into your game project.',
      'Godot 4 gets the data and an autoload script: add egd/egd_data.gd as an Autoload named Egd and use Egd.items or Egd.find("items", "fire_sword"). Unity gets the data in Resources and C# classes with EgdData.Load(). Unreal gets DataTable CSVs to import with a matching struct. Plain JSON works with anything.',
      'Export again whenever something changes; the files are overwritten. A README_EGD.md in the folder explains the files.',
    ],
  },
  look: {
    title: 'Project look (theming)',
    body: [
      'Each project can have its own look. Click Project look at the bottom of the sidebar.',
      'Accent changes buttons and highlights. Background recolors every panel; text switches between light and dark automatically so it stays readable.',
      'Wallpaper puts an image behind the whole editor. Once one is set you can blur, dim and tint it, change its contrast, and lower Panel opacity to let it shine through.',
      'Default resets one color, Reset all removes the project theme. The light/dark switch on the start screen still sets the base theme for every project.',
      'The small T in a tool’s header picks the font that tool shows its text in, for this project. Boards like the Brainstorm Board use it too.',
    ],
  },
}

export const TOOL_GUIDE: Record<ComponentType, GuideTopic> = {
  'item-list': {
    title: 'Item List',
    body: [
      'Every item in your game in one table: image, rarity, value, stats and your own custom categories.',
      'Click New item to create one, then fill in its details. Each item shows which enemies drop it, taken from the Enemy List.',
    ],
    tips: ['Items can be linked with [[links]] and turned into a Wiki article with a live info box.'],
  },
  'character-list': {
    title: 'Character List',
    body: [
      'Characters with portraits, family, nation, clan, race and links to other characters.',
      'Relations are stored by reference, so renaming a character updates it everywhere.',
    ],
  },
  'town-list': {
    title: 'Town List',
    body: [
      'Towns with nation, race, religion and links.',
      'Cities you place in the Map Creator are towns from this list, so a town and its map city are always the same thing.',
    ],
  },
  'enemy-list': {
    title: 'Enemy List',
    body: [
      'Enemies with combat stats, growth per level, resistances, drop tables and where they are found.',
      'Drop tables point at items from the Item List. The Level and Resource Calculators can use your enemies directly.',
    ],
  },
  wiki: {
    title: 'Wiki',
    body: [
      'Your lore wiki. Write articles and link them with [[Article name]].',
      'You can make an article from any item, character, town or enemy; it gets an info box that always shows the current data.',
      'Each article lists its backlinks, and the connection map shows how everything links together.',
    ],
  },
  writer: {
    title: 'Writer',
    body: [
      'Rich text documents for design docs, scripts and dialogue, with headings, lists, images and [[links]].',
      'The word count updates as you type, and you can export a document as Markdown or plain text.',
      'Pick a font and a size for selected text (or for what you type next) in the toolbar.',
      'Click an image for its bar: left, center, right, or with the text flowing around it on the left or right, and 25 to 100% of the text width. Drag the blue corner to size it freely.',
    ],
  },
  'story-writer': {
    title: 'Story Branch Writer',
    body: [
      'A mind-map for branching stories. Create nodes, branch them, connect them to each other and sever connections.',
      'Like every canvas tool it has a bottom toolbar; hover a button to see its shortcut letter.',
    ],
    tips: ['Pan with the middle mouse button or Space+drag, zoom with the mouse wheel.'],
  },
  timeline: {
    title: 'Timeline',
    body: [
      'Timelines with optional years and events that can hold images.',
      'Press B to start a branch for an alternative history. Pressing a tool shortcut again returns to the select tool.',
      'To make the timeline longer, use the stretch buttons in the toolbar or drag the round handle at the end of the line. Events keep their place in time; branches get longer the same way.',
      'With eras in Calendar & Eras, the years show as era years, like 305 FA.',
    ],
    tips: ['Pan with the middle mouse button or Space+drag, zoom with the mouse wheel.'],
  },
  moodboard: {
    title: 'Moodboard',
    body: [
      'Collect images, cutouts, text and shapes. Cutouts can be shapes or a freehand lasso.',
      'The layers panel (button in the bottom toolbar) lets you reorder everything, and an always-on-top layer keeps your drawings above the images.',
      'The brush button opens your drawings from the Draw tool. Click one to place it as a sticker; transparent parts stay see-through. Double-click to edit it in Draw.',
    ],
    tips: ['Drop image files straight onto the board.', 'Design Language works exactly the same way, for pinning down the look of your game.'],
  },
  brainstorm: {
    title: 'Brainstorm Board',
    body: [
      'A free board for ideas: drawing, sticky notes, shapes, images, audio clips and voice recordings.',
      'Pin notes and connect pins with string, and group things in named, colored areas.',
    ],
    tips: ['Hover a toolbar button to see its shortcut letter.'],
  },
  map: {
    title: 'Map Creator',
    body: [
      'Draw maps with cities, streets and terrain stamps such as mountains, forests, water and deserts.',
      'Every city is a town from the Town List. Export the finished map as a PNG.',
      'Zones (Z) mark areas, like the land of a faction: click the corners, double-click or press Enter to close the shape. Pick a faction and the zone takes its name and color. Link the zone to characters, towns, documents and more, and click a link to go there.',
    ],
  },
  cosmos: {
    title: 'Cosmos Creator',
    body: [
      'Mark out where everything is in the universe you are creating: universes, galaxies, nebulae, star clusters, solar systems, stars, black holes, planets, moons, asteroid belts, comets and stations.',
      'The list on the left shows everything nested inside each other. Drag an entry onto another to move it inside, or onto the empty space below to move it to the top level.',
      'The middle is an isometric view. At the top level, and inside universes, nebulae and star clusters, everything is drawn as a node graph: lines connect each body to what is inside it.',
      'Double-click a galaxy or a solar system to see its orbits. Moons circle their planets. Click to select, double-click to look inside, and use the breadcrumb or the up arrow to go back out.',
      'Add places a new body where you are looking; it picks a sensible kind (planets in a solar system, moons around a planet) and you can choose another in the drop-down. Give each body a name, a color, a picture of your own and notes on the right.',
    ],
    tips: ['Each cosmos is its own document, so you can keep several (for example one per game or era).', 'Ctrl+Z undoes, including deletes.'],
  },
  sketch: {
    title: 'Draw',
    body: [
      'Draw and paint with pressure brushes, layers and a full set of pro painting tools. Pick a canvas size (up to 8K) when you start a new drawing; Canvas (top bar) resizes, crops, flips and turns it later and shows how many strokes and minutes went into it.',
      'Pen: pressure and tilt work with drawing tablets, the eraser end of the pen erases, and the pen buttons can do any action. Pen and keys (top bar) sets your pressure curve, smoothing, motion filtering, every keyboard shortcut, pen buttons and touch gestures, and has a tablet test page.',
      'QuickMenu: press Q (or a pen button) for a round menu of six actions you choose. Turn and mirror the view with , and . and Shift+H; this only changes the view, not the picture.',
      'Each brush has its own smoothing and stabilization. To use your own value for every brush, tick Smoothing, Stabilization or Tether in the side panel (unticked they show the setting of each brush). The tether pulls the brush behind the pen on a string you see while drawing. Press Shift+? (or Shortcuts in the corner of the canvas) for a list of every shortcut.',
      'The layers can float over the canvas: use the button in the layers header, drag them anywhere (they snap to the window edges), or hide them with the Layers button in the top bar. A brush with Height (Brush Studio, Rendering) paints thick, raised 3D paint; with the Smudge tool a brush can blur instead of smear.',
      'Under the colour wheel are your recent colours and a palette: + adds the current colour, the folder button makes a new palette, right-click a colour to remove it.',
      'Brushes: about 120 brushes in 14 sets, each fully editable in the Brush Studio (stroke, taper, shape, grain, rendering, wet mix, color dynamics, pressure and tilt curves, dual brush and more), with a drawing pad to try them. Import and export brushes as .egdbrush, and import .abr, .brush and .brushset files. Smudge (S) blends paint.',
      'Colors: disc, classic, harmony, value (HSB, RGB, hex) and palettes, with a second color and recent colors. Drag the color onto the canvas to fill an area (drag sideways while holding to change how far it spreads).',
      'Layers: 26 blend modes, groups, layer masks, clipping masks, alpha lock, lock, a reference layer for fills, hide from export, merge, and drag a layer out of the list to save it as PNG. Text layers stay editable (T); fonts can be imported.',
      'Selections: automatic (magic wand), freehand, polygon, rectangle and ellipse, with add, remove, invert, feather, save and load. The Move tool transforms: freeform, uniform, distort and warp, with snapping.',
      'Adjustment layers (the sliders button in the Layers header): hue, saturation and brightness, colour balance, curves or a gradient map that change everything below them and can be changed or removed any time. Clip one to a layer to change only that layer. Layers can clip to a group too, and clipped layers fade and hide with their base. The tick-list button picks several layers with a pen or finger (or Ctrl-click, Shift-click).',
      'The flip buttons in the top bar mirror the whole picture; Shift-click flips only the active layer. While transforming, drag just outside a corner to turn; snapping to the edges and middle can be switched on in the transform bar.',
      'Adjustments: hue, color balance, curves, gradient map, blurs, noise, sharpen, bloom, glitch, halftone and chromatic aberration, on the whole layer or painted in with the pen. Liquify pushes and twirls pixels; Clone (Alt-click a source) copies them.',
      'Drawing guides: grid, isometric, perspective and symmetry (including radial). Drawing Assist makes strokes on a layer follow the guide.',
      'QuickShape: draw a rough line, circle, rectangle or triangle and keep holding at the end. It snaps to a clean shape; Edit shape lets you drag its points, and Shift gives a perfect one.',
      'Animation and pages: turn on Animation to treat each top-level layer as a frame with onion skin and playback, or Pages for a sketchbook. Send frames or pages to the Storyboard.',
      'Time-lapse records your drawing as you go and can be replayed or exported as video. Import and export PSD (with layers), PNG, JPEG, TIFF, GIF and WebM, or use Send to… to put the picture on a Moodboard, a Design Language board or into the Asset Pool.',
      'Every drawing stays in the project. Wherever you can add a picture (an entry, the Writer, the Pitch Deck, the Storyboard and more), a window first shows your drawings to pick from; Choose a file… opens the file picker as before.',
    ],
    tips: ['Space or the middle mouse button pans, the mouse wheel zooms, 0 fits the canvas into view.', 'Undo goes back 250 steps. Everything saves by itself a moment after you stop drawing.'],
  },
  'design-language': {
    title: 'Design Language',
    body: [
      'Pin down the look of your game: style references, color swatches, shapes and examples of what fits and what does not.',
      'It works exactly like a Moodboard: add images, cut them out, draw, write notes, and use layers.',
      'The brush button opens your drawings from the Draw tool; click one to place it as a sticker. Pictures sent from Draw land here too.',
    ],
  },
  'asset-pool': {
    title: 'Asset Pool',
    body: [
      'Track every asset the game still needs: icons, sprites, 3D models, animations, sounds, music, UI and effects.',
      'Add many… makes one asset for every item, character, town or enemy that does not have one of that kind yet, or one per line of a pasted checklist.',
      'Click the status to move an asset from Needed to In progress, Review and Done; the bar at the top shows how much is done.',
      'Select an asset to add notes and pictures. Assets made from an item or character keep its name when you rename it, and Open jumps to it.',
    ],
    tips: ['Send a drawing from the Draw tool to the Asset Pool: it is attached to the selected asset, or becomes a new one.'],
  },
  'damage-calculator': {
    title: 'Damage Calculator',
    body: [
      'A library of damage formulas grouped by game type: elemental reactions, armor, crits, damage over time, resistances and more.',
      'Pick a formula, enter values and see the result, or write your own formulas. Each preset is its own document.',
    ],
  },
  'level-calculator': {
    title: 'Level Calculator',
    body: [
      'Design XP curves and stat growth, and see damage per level against a fixed defense or an enemy from your Enemy List.',
    ],
  },
  'resource-calculator': {
    title: 'Resource Calculator',
    body: [
      'Work out how many resources and how much play time a goal takes, using level-up costs and enemy drop rates.',
    ],
  },
  'wave-planner': {
    title: 'Wave Planner',
    body: [
      'Plan the waves of a wave or tower-defense mode. Set the number of waves, how long each one lasts and how fast enemy health grows: by a percent, a flat amount or by the level growth set on each enemy.',
      'Add enemies from the Enemy List or as custom enemies, with how many come in the first wave, how many more each wave, and from which to which wave. "Every 5 waves" makes a boss wave.',
      'The chart and the wave-by-wave table show total health, the damage per second needed to clear each wave in time, and the expected drops.',
      'Pick weapons from the Item List to see up to which wave each one is strong enough.',
    ],
  },
  quests: {
    title: 'Quest Designer',
    body: [
      'Write quests with a type (main, side, daily, event), a quest giver, a place, a level, objectives and rewards in XP, gold and items.',
      'Objectives point at your characters, enemies, items and towns: talk to, defeat, collect, go to, or anything else in your own words.',
      'Requires links quests into chains. Quest chains shows them as a graph, and the app stops you from making a loop. Each quest also shows what the whole chain up to it gives.',
      'Flags are game-state values like met_the_king or reputation. A quest can start only if a flag has a value and set flags when it is done. The Dialogue Editor uses the same flags.',
    ],
  },
  dialogue: {
    title: 'Dialogue Editor',
    body: [
      'A conversation is a set of lines, shown as a graph. Each line has a speaker (a character or any name) and what is said, then either goes on to the next line, ends, or offers the player choices.',
      'Lines and choices can depend on flags (only said if, only offered if) and change flags when said or picked. Lines that nothing leads to are marked.',
      'Play runs through the conversation like the player would, showing the flags as they change.',
      'Export saves the conversation as JSON, Yarn Spinner or Ink, ready for your engine.',
    ],
  },
  gacha: {
    title: 'Gacha & Loot Simulator',
    body: [
      'Banner: set the tiers and their rates (or use the project rarities), hard and soft pity, the featured chance and the guarantee after losing a 50/50, and how many featured copies you want.',
      'The simulator plays thousands of players and shows the average pulls, how many pulls 50, 90 and 99% of players need, what that costs, and a chart of players done by pull.',
      'Chest / drop table: list what can drop, either one entry picked by weight or each entry with its own chance, or load an enemy drop table. Mark one entry as the target to see its chance per opening and how many openings a 50, 90 or 99% chance takes.',
    ],
  },
  spreadsheet: {
    title: 'Spreadsheet',
    body: [
      'Works like Excel. Click a cell and type; start with = for a formula, like =SUM(A1:A10) or =IF(B2>100, "rich", "poor"). Hundreds of Excel functions work, including VLOOKUP, SUMIF, ROUND, DATE and TEXT.',
      'While writing a formula, click or drag over cells to put their address in, even on another sheet. Sheets reference each other with Sheet2!A1. Add sheets with the + at the bottom; double-click a tab to rename it, right-click to move or delete it.',
      'Drag the small square at the corner of the selection to fill: numbers and dates continue their step, "Wave 1" becomes "Wave 2", month and weekday names keep going, and formulas move their cell references along. Double-click it to fill down as far as the column next to it goes. Ctrl+D and Ctrl+R fill down and right.',
      'The toolbar sets bold, italic, underline, text and fill colors, alignment, number formats (number, percent, currency, date, text) with decimals, and borders with a thickness and color. Right-click a row or column header to insert or delete; drag a header edge to resize; right-click a selection to sort it.',
      'Damage Calculator results can live in a cell: drag a Damage Calculator preset from the sidebar onto a cell, or use Calculator in the toolbar. The cell shows =CALC("Preset name"). The panel that opens lets you take any calculator input from a cell, so the sheet can run the formula for every row.',
    ],
    tips: ['Copy and paste work with other programs too; pasted text with tabs fills several cells.', 'Select numbers to see their sum, average and count at the bottom right.'],
  },
  principles: {
    title: 'Writing Principles',
    body: [
      'A collection of rules for good stories and game writing, ready to use: show, don’t tell; setup and payoff; information theory; save the player from themselves; and more, each with what it means and often an example.',
      'Story structures such as the Hero’s Journey, the three-act structure, the story circle, Save the Cat, Kishōtenketsu, the seven-point structure and Freytag’s pyramid are listed as numbered steps.',
      'Make it yours: add principles and categories, edit or delete any entry, star the ones that matter for your game, and sort by your own order, A to Z or starred first. Deleted built-in entries can be brought back with Restore.',
    ],
  },
  'gameplay-loop': {
    title: 'Gameplay Loop',
    body: [
      'Map the loop your players repeat, like explore, fight, loot, upgrade. Each step sits on a circular timeline; the arrows show the direction the loop runs.',
      'Click a step to flesh it out: its type (action, challenge, reward, progression, social, rest), its segment color, what the player does, what it gives them, how many minutes it takes and notes. Move steps earlier or later around the circle.',
      'Turn on Size steps by time to make the circle a real timeline: each step takes up as much of the circle as it takes time in the game.',
      'Simulate shows how the loop plays out over time: add resources like gold, XP or potions, enter what each step gains or spends, and play the loop as many times as you like. A chart shows every resource per loop, goals tell you after how many loops and minutes they are reached, and you are warned when a resource runs out because the loop spends more than it gains.',
      'Add branches to a step for ideas, variants or open questions, and branch off branches for more detail. Make several documents for different loops, like a core loop, a session loop and a long-term loop.',
    ],
    tips: ['Scroll to zoom and drag the empty space to move around.'],
  },
  'skill-tree': {
    title: 'Skill Tree',
    body: [
      'Build skill and talent trees. Each skill has a type (active or passive), an effect, a max rank, a cost in points per rank, and can need other skills first or a number of points spent in the tree.',
      'The tree is drawn as a graph from your "Needs first" links. Click a skill to edit it; the app stops you from making a loop.',
      'Plan a build tests the tree like a player: set the points at the start, per level and the level, then click skills and add or take back ranks. The planner explains why a rank is not possible yet.',
    ],
  },
  abilities: {
    title: 'Abilities & Spells',
    body: [
      'List the abilities and spells of your game: type (attack, spell, heal, buff, passive, utility), element, range, cost, cooldown, cast time, a picture and who can use them.',
      'Give an ability its number with a formula from the library or one of your Damage Calculator presets, and change any input just for this ability. The page shows the value, the value per second (by cooldown or cast time) and per point of cost.',
      'Compare all in a table lists every ability side by side; click a column to sort, for example by damage per second, to spot the ones that are too strong.',
    ],
  },
  crafting: {
    title: 'Crafting & Recipes',
    body: [
      'Write down how things are made: what goes in (items from the Item List or any name), what comes out, the station and the time it takes.',
      'Each recipe shows its crafting tree: the ingredients, the recipes that make those, and so on down to raw materials that no recipe makes.',
      'Enter how many you want to make to see the total raw materials and crafting time, with crafts rounded up like in a game (a smelt that gives 2 bars runs twice for 3 bars). Recipes that go in a circle are pointed out.',
    ],
  },
  factions: {
    title: 'Factions',
    body: [
      'Make the factions of your world with a color, leader, members, towns, a description and their goals.',
      'The relations matrix shows how every faction feels about every other one, from at war to allied, colored red to green. Pick a level in any cell, or use the sliders on a faction page for finer steps.',
      'With Same both ways on, a relation is mutual. Turn it off when feelings differ, like a kingdom that trusts a guild that secretly hates it.',
    ],
  },
  'family-tree': {
    title: 'Family Tree',
    body: [
      'Show how your characters are related. Add characters from the Character List, then click someone to add their parents, children and partners. Generations line up in rows with partners side by side and children under their parents.',
      'Every link can carry a note like adopted, married or divorced. Double-click a character, or use Open character page, to jump to their entry. The app stops you from making someone their own ancestor.',
    ],
  },
  'level-layout': {
    title: 'Level Layout',
    body: [
      'Sketch levels and dungeons on a grid. Pick a tile on the left (floor, wall, door, water, lava, stairs, start, exit, enemy, boss, chest, key, trap, NPC) and paint with the brush.',
      'Room draws a whole room as you drag: floor inside, walls around, and doors you already placed stay. Fill floods an area, Erase clears tiles, and right-click with Fill empties an area.',
      'Note pins a numbered note on the map for puzzles, secrets or ambushes; the notes are listed on the right. The palette counts how many enemies, chests and so on the level has. Export saves the level as a PNG.',
      'Tilesets: Add a tileset image (a drawing from Draw works too) and set the size of one tile. Click a tile and paint, fill or erase with it, like in Godot. Plan tiles like enemies and chests show on top of the picture tiles.',
      'Godot scene saves the picture tiles as a Godot 4 TileMap scene with its TileSet into your Godot project (egd/levels/), ready to open.',
    ],
  },
  achievements: {
    title: 'Achievements',
    body: [
      'List your achievements with a type, a picture, what players see, how it unlocks, the reward and points. Progress achievements get a number of steps, like 100 slimes.',
      'Mark achievements as hidden until unlocked, and set how many players you expect to get each one, so you can balance easy and rare ones.',
      'The toolbar adds up the points and warns when you go over 1000, the usual budget for a full game on consoles.',
    ],
  },
  names: {
    title: 'Names & Languages',
    body: [
      'Each document is a language. Pick a preset (Elvish, Dwarvish, Orcish, Japanese-like, Norse-like, Latin) or set the sounds yourself: consonants, vowels, syllable shapes like CV or CVC, how many syllables, endings and letter pairs to avoid.',
      'Generate makes a batch of names that sound like they belong together. Click a name to keep it.',
      'Real-world styles: search the list (German, Polish, Canadian, Japanese and about 50 more) and Generate mixes real first and family names of that style. Tick New names to get made-up names that sound like it instead.',
      'The dictionary holds the words of your language; the dice makes one up for you. Translate turns any text into the language: dictionary words use your word, every other word gets a made-up word that stays the same every time.',
    ],
  },
  calendar: {
    title: 'Calendar & Eras',
    body: [
      'Give your world its own calendar: months with any number of days, your own weekday names and which weekday year 1 starts on. It starts with a ten-month example to change.',
      'Eras are named ages like the First Age or the Age of Ash. Each era counts its own years from 1 and starts at a year on your timelines. With Show era years on timelines on, the Timeline labels years as 305 FA instead of 305.',
      'The month view shows any month of any year with its weekdays, and the date calculator tells you which date and weekday it is a number of days later.',
    ],
  },
  economy: {
    title: 'Economy Simulator',
    body: [
      'Model the money of your game. Add currencies like gold or gems, sources where they come from (quests, selling loot) with an amount per hour that can grow over time, and sinks where they go: steady costs, costs every few hours, or one-time purchases like a mount.',
      'The simulation plays the hours you choose and charts each currency. It shows what was earned and spent, when one-time purchases become affordable, and when the player cannot pay for something.',
      'If players spend less than half of what they earn, the money piles up and loses its meaning; the simulator warns you so you can add sinks or lower income.',
    ],
  },
  combat: {
    title: 'Combat Simulator',
    body: [
      'Put two teams against each other. Each fighter has HP, attack, defense, attacks per second, crit chance and crit damage, and a count for groups like 5 slimes. Fighters can be taken from the Enemy List; stats named HP, ATK, DEF and SPD are read automatically.',
      'Damage uses a formula from the damage library with the attacker ATK and the target DEF, plus a random spread. Fighters attack the weakest enemy left.',
      'Simulate runs hundreds or thousands of fights and shows how often each side wins, how much HP the winners keep, how long fights take, the damage of every fighter and an example fight blow by blow.',
    ],
  },
  balance: {
    title: 'Balance Dashboard',
    body: [
      'A live look at the numbers in your Item and Enemy Lists; there is nothing to fill in.',
      'Numbers that stick out compares every stat with the other items or enemies of the same rarity and lists the ones far from the typical value, too high in red and too low in blue. Click the arrow to open the entry.',
      'Difficulty curve charts the average of an enemy stat per level and points out levels where it jumps or drops much more than usual. Gaps lists entries without numbers and enemies that drop nothing.',
    ],
  },
  vision: {
    title: 'Vision & Pillars',
    body: [
      'The one page that says what your game is: the elevator pitch, the vision, the player fantasy, genre, platforms, audience and what makes it special.',
      'Design pillars are three to five rules every feature must serve. For each pillar, write why it matters, what it means and what it rules out. When you are unsure about an idea, check which pillar it supports.',
      'Add references (games, films, books and what you take from each) and anti-goals: things you decided against so nobody adds them later.',
    ],
  },
  scope: {
    title: 'Scope Planner',
    body: [
      'Sort every feature by priority: must have, should have, could have, won’t have (now) and cut. Drag cards between the columns or reorder them; click a card to edit it.',
      'Each feature has an effort in days, a status and the design pillar it serves (from Vision & Pillars). Enter the days until release: the planner adds up must and should and tells you when they do not fit, so you know what to move or cut.',
    ],
  },
  tasks: {
    title: 'Task Board',
    body: [
      'Keep the work on your game in four columns: to do, doing, review and done. Drag tasks between columns and click one to give it a person, a due date, a priority and notes.',
      'Give tasks a picture and your own categories (like Art, Code or Sound) with colors, and filter the board by category. Columns and categories lets you rename, recolor, add, reorder and remove columns and categories.',
      'Link a task to what it is about: type a name to find items, characters, towns, enemies, wiki articles or any document, and click the link later to jump there. Filter the board by title or person.',
    ],
  },
  history: {
    title: 'History',
    body: [
      'Every time you change an item, character, town or enemy, the app keeps a version. Edits within two minutes count as one version; the last 40 versions of each entry are kept.',
      'Pick an entry to compare any two versions (or a version with now): every changed field, number and category is listed with the old and the new value. Restore brings an old version back, and you can undo that in its list.',
      'History stays on your computer; it is not shared when working together.',
    ],
  },
  playtests: {
    title: 'Playtests',
    body: [
      'Log every playtest: date, tester, build, minutes played, scores from 1 to 10 for fun, difficulty (5 means just right) and clarity, notes and quotes.',
      'Add findings to a session with a severity (blocker, major, minor, idea) and where in the game it happened; tick them off when fixed.',
      'The overview shows the scores per build, so you see if changes helped, and every open finding with the worst first and the areas with the most problems.',
    ],
  },
  pacing: {
    title: 'Pacing Graph',
    body: [
      'Plan the player journey as beats: moments like the opening, an ambush or the first boss, each with a kind, a time, how the player should feel and notes.',
      'Every beat has a value from 0 to 10 on each curve: intensity and story stakes to start with, and add your own like difficulty. Drag the points up and down on the graph, or use the sliders.',
      'The graph warns about long flat stretches, where players may get bored, and about high peaks right after each other with no breather between.',
    ],
  },
  pitch: {
    title: 'Pitch Deck',
    body: [
      'Make slides to pitch your game. Build from project starts a deck with a title slide, your vision, selling points and design pillars (from Vision & Pillars) and slides of characters and items with their pictures.',
      'Each slide has a layout: title, text, picture and text, design pillars, or a selection of items, characters, towns or enemies. Drag slides in the list to change the order, or use the arrows.',
      'Present shows the deck full screen. Click or use the arrow keys, space or Enter to move on, and Esc to stop.',
    ],
  },
  localization: {
    title: 'Localization',
    body: [
      'A table of every text players see, by key, with a column per language. The first language is the source; add more with + Language, and the bar shows how much of each is translated.',
      'Collect texts from the project fills the table with the names and descriptions of items, characters, towns and enemies, quest names, summaries and objectives, and every dialogue line and choice. Run it again after changes: new texts are added and changed source texts updated, translations stay.',
      'Show only what is missing in a language, and export the table as CSV for translators or your engine; Import CSV brings their work back.',
    ],
  },
  storyboard: {
    title: 'Storyboard',
    body: [
      'Plan cutscenes frame by frame. Each frame has a picture (a sketch, a screenshot, anything), a shot like wide or close-up, a camera move, how many seconds it lasts, what happens, the dialogue and the sound.',
      'Add, duplicate and reorder frames in the strip. Play animatic shows the frames one after another for their seconds with the dialogue as subtitles, so you can feel the timing of the scene.',
    ],
  },
  'ui-flow': {
    title: 'UI Flow',
    body: [
      'Mock up your menus and screens. Pick a size (phone, tablet, desktop or console, popup) and click with the Screen tool to place a screen; double-click it to name it.',
      'Place widgets with the Widget tool: buttons, toggles, sliders, text fields, lists, picture placeholders, tabs and bars; double-click to change their text. Resize anything with its handles.',
      'Join screens with arrows to show where each button leads, add notes and comments, and drag everything around like on the other boards.',
    ],
  },
  ask: {
    title: 'Ask Your Project',
    body: [
      'Look things up in your own world, like Who rules Ashvale? or What do we know about the Moon Gem?. The AI helper reads the entries that fit the question (items, characters, towns, enemies, wiki articles, writing, quests, dialogue and timelines), answers only from them and names what it used; click a source to open it.',
      'Check an entry looks for contradictions between one entry and the rest of the project, like a character who is dead in one article and alive in another.',
      'Everything is local: the AI helper runs on this computer, nothing leaves your PC, it works offline and no training data is collected. Your ideas stay your ideas: it does not write stories, scenes, dialogue, names or ideas for you, and turns such requests away. It is optional, like the grammar check: download the AI helper in Settings, then turn on Show the Ask your project tool there; until then it does not appear in Add tool.',
    ],
  },
  reviews: {
    title: 'Reviews',
    body: [
      'Every tool window and every item, character, town and enemy has a small Review button. Give it a status (Idea, Draft, In review, Approved, Final) or write a comment.',
      'On the Brainstorm Board, Moodboard, Design Language and Map, the Comment tool in the bottom toolbar pins a comment to a spot: click to drop a pin and write, click a pin to read and answer.',
      'The Reviews tool shows everything with a status or comments as a board. Needs review only shows what is waiting for review or has open comments. Click a card to read and answer the comments, or Open to jump there.',
      'Resolve a comment when it is done; resolved comments are hidden until you show them. When working together, everyone sees the same statuses and comments.',
    ],
  },
}

/** Where to find the developer, Evelopment Games. */
export const COMMUNITY_LINKS = [
  { label: 'Discord', url: 'https://discord.gg/AGfaBwNKfN', icon: MessageCircle },
  { label: 'YouTube', url: 'https://www.youtube.com/@EvelopmentGames', icon: Play },
  { label: 'Instagram', url: 'https://www.instagram.com/evelopmentgames/', icon: Camera },
]
