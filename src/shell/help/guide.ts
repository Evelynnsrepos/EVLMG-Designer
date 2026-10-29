import { Camera, Code, Coffee, Globe, MessageCircle, Play } from 'lucide-react'
import type { ComponentType } from '@/core/model'
import { GIT_LEARN_LINKS, GIT_SETUP_STEPS } from '../gitsync/setupSteps'

/** In-app user guide. Ships with the app, no network. Plain strings so they can be translated later. */

export interface GuideTopic {
  title: string
  /** Paragraphs. */
  body: string[]
  tips?: string[]
}

export const BASICS: Record<string, GuideTopic> = {
  basics: {
    title: 'The basics: Esc and Shift-click',
    body: [
      'Two moves do most of the work in Eve.Lopment Games Designer: Shift-click and Esc.',
      '## Shift-click: open side by side',
      'Click a tool in the sidebar to show only that tool. Shift-click a tool, or a document under it, to open it next to the tools that are already open. To pick the side yourself, drag a tool or document from the sidebar onto an open panel. Drag the dividers between panels to resize them.',
      'Shift works the same way in other places: Shift+Enter in the Ctrl+K search opens the result next to the open tools, Shift-click picks several layers in Draw, and Shift-click on Draw\'s flip buttons flips only the active layer.',
      '## Esc: Layout Mode',
      'Press Esc to turn Layout Mode on. Every panel shows big buttons: the X closes it (everything is saved), the arrows swap it with its neighbour, and you can drag a panel onto another one to move it there. Press Esc again to keep working.',
      'When a menu, a window or the tour is open, Esc closes that first and leaves Layout Mode alone.',
      '## The buttons in every tool\'s header',
      'From left to right: the keyboard shows this tool\'s shortcuts and how to link things; the size button makes the whole tool bigger or smaller (handy with a pen or a graphics tablet); the T picks the font the tool uses; the crossing arrows are jump points; Review collects feedback; the X closes the tool.',
      '## Keys only work where you are',
      'Single-letter shortcuts only work in the tool you clicked last, so typing in one tool never triggers another. Inside a text field, keys just type.',
    ],
    tips: ['Press F1 anywhere to open this guide, and the keyboard button in a tool\'s header for its shortcuts.'],
  },
  shortcuts: {
    title: 'Shortcuts cheat sheet',
    body: [
      'Every shortcut in the app, with its default key and your own when you changed it. Change them in Settings, under Keyboard shortcuts (the button below takes you there).',
      'Single-letter keys only work in the tool you clicked last, so typing in one tool never triggers another. Inside a text field, keys type as usual.',
    ],
  },
  hotwheel: {
    title: 'The Hotwheel',
    body: [
      'The Hotwheel is a round menu that opens right where your pointer or pen is. Hold Q, move towards a slice and let go: it runs. Or tap Q and click a slice. Let go on the centre, or press Esc, to close it without doing anything.',
      'You don\'t have to hit a slice exactly: the direction counts. A short move picks from the inner ring, a longer one in the same direction from the outer ring, so after a while you can use it without looking.',
      '## Two rings',
      'The inner ring is the same in every tool: close the tool, its size, add a jump point, Layout Mode, undo and redo, and search. Choose other program actions in Settings, under Hotwheel (back and forward, this tool\'s shortcuts or guide page, Settings).',
      'The outer ring belongs to the tool you are in: up to ten of its actions, like Pencil, Fill and Pencil size in Pixel Art, or Sticky note, Pen and Jump point on a board. Change it with the keyboard button in the tool\'s header, under Hotwheel. Draw keeps its own profiles in Pen and keys settings.',
      'Some slices have two halves, like Undo | Redo or smaller | bigger: point at the left or right half. Shift-click a slice to keep the wheel open for the next action.',
      '## Pens and tablets',
      'In Settings, under Hotwheel, the wheel can also open with the pen\'s side button, by holding the right mouse button, or with the middle mouse button (that one also pans in canvas tools, so it is off unless you turn it on). Size makes it bigger for large tablets, and it grows with the tool\'s own size.',
      'Q only opens the wheel when you are not typing; in a text field it types a Q. Change the key in Settings, under Keyboard shortcuts.',
    ],
    tips: ['Plugins can put their own actions on the wheel (see docs/PLUGINS.md).'],
  },
  course: {
    title: 'Crash course: the whole program',
    body: [
      'Everything you need to find your way, in ten minutes. Each part has its own page under Topics for the details.',
      '## 1. Projects',
      'Every game you design is a project: New Project on the start screen, a name, and the tools you want (you can add more later). A project is a normal folder of readable files in Documents/Evelopment Games Designer.',
      'There is no Save button: everything saves about a second after you change it. Ctrl+Z and Ctrl+Y undo and redo in every tool, and the last 10 saves are kept as backups (project card menu …, Restore a backup).',
      '## 2. The sidebar: keep your tools organised',
      'The sidebar lists your tools. Tools that hold several documents (boards, drawings, levels, maps…) list them underneath: + New makes another one, right-click renames or deletes it.',
      'Search tools and documents, at the top, filters the list as you type. The star next to a tool keeps it at the top. Drag tools up and down to put them in your order.',
      'Right-click a tool to give it a colour or put it into a folder. Drag tools onto a folder to add them, click a folder to fold it, right-click it to rename, recolour or remove it. Show less hides the tools further down when the list gets long.',
      'Add tool at the bottom adds any tool. Right-click a tool to Hide it (its contents are kept) or to delete its contents.',
      '## 3. The Hotwheel',
      'Hold Q anywhere for a round menu under your pointer: program actions on the inner ring, the current tool\'s actions on the outer ring. Point and let go. See The Hotwheel for pens, tablets and changing the slices.',
      '## 4. Several tools at once',
      'Shift-click a tool to open it next to the others, drag tools onto panels to split the screen, and press Esc for Layout Mode to move and close panels (see The basics).',
      '## 5. Link things with text',
      'Type [[ in any text: the Writer, the Wiki, the Story Branch Writer, the Timeline, Tasks and every other rich text field. A list opens with your wiki articles, items, characters, towns, enemies, tools and documents. Keep typing to search, then click one or press Enter.',
      'The link shows the current name, so it keeps working when you rename the target. Click it to go there. The link button in the text toolbar starts a link too, and typing the whole name, like [[Ironhold]], links it when that name exists.',
      '## 6. Jump points',
      'The crossing-arrows button in every tool\'s header links that tool to any other tool, document or entry: Add a jump point…, then pick where it goes. The same list shows what points back here. On boards, the jump tool (J) places a jump point right on the board; double-click it to go there. Alt+Left and Alt+Right take you back and forward.',
      '## 7. Items, characters, towns and enemies',
      'The four lists share categories (like Element or Faction) and rarities. Every entry page shows Jump to (the things it points at) and Used in (every place that mentions it). Link to… links it to anything. Before you delete something, the app shows where it is used.',
      '## 8. Find anything',
      'Ctrl+K searches tools, documents, entries, wiki articles and commands. Enter opens the result, Shift+Enter opens it next to the open tools.',
      '## 9. Make it yours',
      'Project look (bottom of the sidebar) changes the accent, the background and a wallpaper. In each tool\'s header, the T picks its font and the size button makes it bigger for a pen or graphics tablet. Settings changes every shortcut.',
      '## 10. Share and ship',
      'Design Book turns the project into one game design document (web page or PDF). Engine export writes your data into Godot, Unity or Unreal. Work together lets several people edit one project at the same time.',
    ],
    tips: ['Every tool has its own page under Tools in detail, with its shortcuts. Search for a tool or a word there.'],
  },
  start: {
    title: 'Getting started',
    body: [
      'Every game you design is a project. Click New Project on the start screen, give it a name and pick the tools you want. You can add more tools later.',
      'Folders keep the start screen tidy: New folder (next to the search box) makes one, for example Games, YouTube videos or Writing. Drag a project onto a folder or use Move to … in its menu (…); a project is in one folder at a time. Click a folder\'s name to open or close it, and use its menu to rename or delete it (its projects stay). Recent projects shows the ones you opened last.',
      'A project is a normal folder in Documents/Evelopment Games Designer, full of readable JSON files and an assets folder for images and audio. Back it up like any other folder.',
      'Inside a project, the sidebar on the left lists your tools. Click one to show only that tool; Shift-click to open it next to the ones already open. Tools that hold several documents (boards, maps, timelines…) list them underneath; right-click one to rename it. The search field above the list finds tools and documents; the star next to a tool keeps it at the top, and you can drag tools up and down to order them. Right-click a tool to give it a colour or put it in a folder; drag tools onto a folder to add them, click a folder to fold it, and right-click it to rename, colour or remove it.',
    ],
    tips: ['Lots of projects? The search box on the start screen finds one by its name or description.', 'Questions or ideas? Join the Evelopment Games Discord, linked at the bottom of this list.', 'Press F1 anywhere to open this guide.', 'Use the Projects button at the top of the sidebar to go back to the start screen.'],
  },
  pixel: {
    title: 'Pixel art crash course',
    body: [
      'New to pixel art? Add the Pixel Art tool, pick Sprite and a small size: 16 × 16 or 32 × 32 is plenty for a character. Small canvases are faster to draw and easier to keep clean.',
      '1. Pick a few colours first. The starter palette works, or load a ready-made one (Colours panel, Palette). Fewer colours make a cleaner picture; order each ramp from dark to light so the Shade brush can step through it.',
      '2. Draw the outline with the pencil at size 1. Clean lines is on, so freehand lines lose the doubled corner pixels. Shift with the Line tool keeps clean angles.',
      '3. Fill the shapes with Fill (G), then shade: the Shade brush (S) makes a pixel one palette step lighter (left click) or darker (right click). Dither (the slider) mixes two colours in a checker pattern for soft shading.',
      '4. Animate: Copy the frame, change it a little, and turn on Onion skin to see the frames around it. Give each frame a duration, name runs of frames with Tags (idle, walk) and press Enter to play. Preview shows the loop while you draw.',
      '5. Use it: Files exports a PNG (scaled up with sharp pixels), a GIF, a sprite sheet or Godot SpriteFrames. Or pick the file under Sprite on a character, enemy or item page to see it play there.',
    ],
    tips: ['Ctrl+wheel zooms, Alt-click picks a colour, X swaps the two colours, [ and ] change the pencil size.', 'Tracing a sketch? In Draw, Send to Pixel Art puts it here as a reference layer that is never exported.'],
  },
  sprites: {
    title: 'Sprites across your project',
    body: [
      'A Pixel Art file can show up all over the project. On a character, enemy, town or item page, and on abilities and achievements, the Sprite box picks a Pixel Art file and the tag that plays (like idle). It then plays on the card and the page instead of the picture.',
      'Pixel Art can also send things on: a frame or the map to the Moodboard, Design Language, Asset Pool or Storyboard; the whole animation to the Storyboard with its timing; and the palette to Design Language as colour swatches. From Draw, Send to Pixel Art turns a sketch into a tracing layer.',
      'For the game itself, Files → Godot SpriteFrames saves the frames and one animation per tag into your Godot project (egd/sprites/), ready for an AnimatedSprite2D. Sprite sheets with JSON work for other engines.',
      'Small textures (64 to 256 px) in Texture Paint show hard pixels on the model, for a pixel-art look in 3D.',
    ],
  },
  levels: {
    title: 'From tiles to a Godot level',
    body: [
      '1. Make the tiles: in Pixel Art pick Tileset and map, choose a tile size (8, 16 or 32 px) and draw the tiles on the grid. Already have a tileset picture? Add it in Level Layout instead. Have a finished map picture? Open a map picture rebuilds its tiles.',
      '2. Paint a map right in Pixel Art (Tab switches to the map), or send the tileset to Level Layout: Files → Use in Level Layout puts it in the project\'s tile library and keeps it up to date as you draw. Every level in the project can use it.',
      '3. In Level Layout, paint with the tiles on layers: ground below, fences and fountains above. Pick several tiles to paint them as a stamp, drag a stamp to repeat it for fences and paths, or use Scatter for rocks and flowers that do not repeat. Select and move shifts whole parts of the level.',
      '4. Mark where nothing can walk: tick blocks movement on fence and wall tiles, or paint cells with the Blocked brush. Isometric levels use diamond cells for 32 × 16 tiles.',
      '5. Godot scene saves the level into your Godot project (egd/levels/) as a TileMap with one layer per layer, collision on blocked tiles and a static body for hand-blocked cells. Open it in Godot and it is ready to walk around in.',
    ],
    tips: ['Tiles look blurry? Keep Sharp pixel art on in Settings.', 'Seams between tiles in the engine? Save the tileset with extruded edges (Pixel Art, Files) and set margin 1, spacing 2 there.'],
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
      'The AI helper is optional and only for spell checking and searching. Download it in Settings: Small (1.1 GB, fast), Better (2.5 GB, catches more) or Best (4.7 GB, the most careful, needs about 6 GB of free memory). It runs on your computer and checks grammar as you write: wrong words for the sentence, verb forms, missing commas. Its suggestions get a blue underline. Click one for a card with what is wrong and up to 3 fixes, or Dismiss it. Spell check and the AI helper work in the Writer, the Wiki and the description and notes boxes. The AI helper checks the paragraphs around where you are writing first, and looks at the sentences around a mistake for its suggestions.',
    ],
  },
  settings: {
    title: 'Settings and your own presets',
    body: [
      'Settings opens from the gear on the start screen or at the bottom of the sidebar. Its tabs are General, Writing, Keys & Hotwheel, Project presets, Git and Plugins. The search box next to the tabs looks through all of them at once, so you can type "spell" or "pixel" instead of hunting.',
      '## Your own project presets',
      'When you make a new project, the last step lists presets like RPG or Worldbuilding. Pick your tools and click Save as preset… to keep them as your own preset. It shows up next to the built-in ones from then on, with a dashed border. The search box on that step finds presets and tools by name.',
      'In Settings, Project presets you can rename a preset, change its tools, add first tasks for the task board (one per line) or delete it. Projects made with a preset stay as they are.',
      '## Git: other hosts and your own server',
      'Git sync works with GitLab, Gitea, Forgejo, Codeberg and your own server too. Settings, Git has a step-by-step list for them, and Check a repository address tells you if Git on this computer can reach a repository and if it is private.',
      'You can also set the branch for new repositories, the commit message ({date} becomes the date and time) and Extra Git settings: one key=value per line, added to every Git command, like http.sslVerify=false for your own server with a self-made certificate.',
      'Git sync only uses private repositories, on every host: before it sends anything it checks that the repository can not be read without a login. A project can allow a public repository in its own Git sync window, after a red warning.',
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
  jumps: {
    title: 'Jump points: connect everything',
    body: [
      'A jump point takes you from one place in your project to another with one click: from a mood board to a drawing, from the gameplay loop to a writing principle, from a level to a character, and back.',
      'Every tool has a jump points button in its header, next to Review (the little crossing arrows). Click it, then Add a jump point…, and pick where it goes in the window: any tool, any document (a drawing, a board, a level, a document in the Writer) or any entry (a character, an item, a town, an enemy). Type to search.',
      'On boards (Moodboard, Design Language, Brainstorm, Map, Story, Timeline, UI Flow) the jump point is also a tool (J): click the board where it should sit and pick its target; a purple chip appears. Double-click the chip, or click it with the jump tool, to go there. Move it like any other note.',
      'Drag a jump point out of the list into a tool: onto a board it becomes a jump point chip there, into any text (Writer, Wiki, descriptions) it becomes a [[link, and onto an entry\'s Jump to bar it becomes a link. Grab it by the dots at its left; a click opens it as before, and the X at the end of the row removes it.',
      'Pointing here: the same button lists every jump point elsewhere that points at this tool or document, so you can always go back. A character, item, town or enemy shows jump points that point at it in its Jump to bar.',
      'Back and forward (Alt+Left, Alt+Right, or the arrows at the top of the sidebar) retrace your jumps.',
    ],
    tips: ['In any text, [[ links to a tool or document too: a jump point right in your writing (see Links and categories).'],
  },
  links: {
    title: 'Links and categories',
    body: [
      'Type [[ in the Wiki, Writer, Story Branch Writer, Timeline, Tasks or any other text to link to an article, item, character, town, enemy, tool or document. Links follow renames; click one to go there.',
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
  gitsync: {
    title: 'Git sync (one person, several computers)',
    body: [
      'Keep a project in your own Git repository. Good for moving it between your own computers, or keeping its history on GitHub.',
      'You need two free things: Git on your computer and a place for the repository, like a GitHub account. Never used Git? Follow the steps below once; they take about 10 minutes.',
      '## Set it up, step by step',
      ...GIT_SETUP_STEPS.map((step, i) => `${i + 1}. ${step}`),
      '## What happens then',
      'When the project opens, it gets the latest version from Git.',
      'When you leave the project, it saves to Git in the background, so you can go on working. Closing the app waits until that is done.',
      'Sync to Git and Sync from Git (in the Git sync window, or in a project\'s menu on the start screen) do it right away. The Git mark next to a project\'s name on the start screen shows whether it is saved to Git; red means the last try failed (hover it to see why).',
      '## On another computer',
      'Click Import from Git on the start screen. If Git on this computer is logged in to GitHub, it connects by itself and lists your projects on GitHub; no address needed. Pick one, or Import all to download every project that is not on this computer yet. Without a GitHub login you can paste any repository address. Downloaded projects stay synced.',
      'Older setups kept all projects in one repository. Import from Git still puts every project in such a repository on the start screen, and Give each project its own repository in the Git sync window moves them to one repository each. The old repository stays as it is, as a backup.',
      '## Changed in two places?',
      'If you changed the project on two computers without syncing in between, Git sync asks which version to keep. It never mixes them.',
      'Use the Git version: this computer\'s version is saved as a backup first (Restore a backup… in the project\'s menu on the start screen).',
      'Keep this computer\'s version: it replaces the one in the repository.',
      '## Private only',
      'Git saving only uses private repositories. To show a project to the world, open Advanced in its Git sync window and allow a public repository. You confirm a red warning and type the project\'s name, and the project gets a red Public mark on the start screen. Turn it off to go back to private only.',
      '## Shared projects',
      'Git sync is for one person only. Two people syncing one project through Git can overwrite each other\'s work. To work together, use Work together or a server.',
      'A shared project can still get a Git backup: one person turns it on, and their computer saves everyone\'s merged work to Git when they close the project. It never takes anything from Git. The others see Git backup by that person in Work together.',
      '## Something went wrong?',
      'Git needs you to log in: do step 3 again on this computer.',
      'Install Git to use this: Git is missing or the app can\'t find it. Do step 1, then restart the app.',
      'The repository has newer changes: click Sync from Git in the Git sync window.',
      'Could not reach the repository: check your internet, and the address if you used your own.',
      '## Learn more',
      ...GIT_LEARN_LINKS,
    ],
    tips: ['Files over 100 MB stop the sync, because GitHub refuses them. Files over 50 MB get a warning.', 'Your old backups and the sharing settings never go into the repository.'],
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
  typing: {
    title: 'Typing shortcuts (Markdown Syntax)',
    body: [
      'Format by typing symbols. Turn on Markdown Syntax in a Writer document\'s header. Each document has its own switch.',
      'These always work, switch on or off: # Heading (up to ###), **bold**, *italic*, ~~strike~~, `code`, - list, 1. list, > quote.',
      '## With Markdown Syntax on',
      '==text== highlights it.',
      '#### to ###### make smaller headings.',
      '- [ ] makes a checklist. - [x] makes a ticked one.',
      '> [!note] makes a callout box. Also tip, info, warning, danger, bug, example, question, quote. Add a minus, > [!tip]-, to make it fold shut.',
      '%%text%% is a note to yourself. It is greyed out and left out of the word count and exports.',
      '#tag becomes a tag chip.',
      '^[text] or [^1] adds a footnote. Click its number to write or change the note.',
      '[text](https://…) makes a web link. ![name](path) adds a picture.',
      '[[Name|other text]] links to Name but shows other text.',
      '![[Name]] adds a jump card to a document, article or entry. ![[picture.png]] adds a picture.',
      '## Paste and import',
      'Pasted Markdown text turns into formatting. Ctrl+Shift+V pastes it as plain text.',
      'Import in the Writer header turns .md files into new documents. [[Links]] between the imported files work right away.',
      'Export as Markdown writes the same symbols back, so other Markdown note apps can read your documents.',
    ],
    tips: ['Not into symbols? The toolbar has buttons for highlight, checklist and callout too.', 'Settings, Writer: start every new document with Markdown Syntax on.'],
  },
}

export const TOOL_GUIDE: Record<ComponentType, GuideTopic> = {
  'item-list': {
    title: 'Item List',
    body: [
      'Every item in your game in one table: image, rarity, value, stats and your own custom categories.',
      'Click New item to create one, then fill in its details. Each item shows which enemies drop it, taken from the Enemy List.',
      'Sprite (on the page, under the picture) picks a Pixel Art file and the tag that plays; it plays on the card and the page instead of the picture',
    ],
    tips: ['Items can be linked with [[links]] and turned into a Wiki article with a live info box.'],
  },
  'character-list': {
    title: 'Character List',
    body: [
      'Characters with portraits, family, nation, clan, race and links to other characters.',
      'Relations are stored by reference, so renaming a character updates it everywhere.',
      'Sprite (on the page, under the picture) picks a Pixel Art file and the tag that plays; it plays on the card and the page instead of the picture',
    ],
  },
  'town-list': {
    title: 'Town List',
    body: [
      'Towns with nation, race, religion and links.',
      'Cities you place in the Map Creator are towns from this list, so a town and its map city are always the same thing.',
      'Sprite (on the page, under the picture) picks a Pixel Art file and the tag that plays; it plays on the card and the page instead of the picture',
    ],
  },
  'enemy-list': {
    title: 'Enemy List',
    body: [
      'Enemies with combat stats, growth per level, resistances, drop tables and where they are found.',
      'Drop tables point at items from the Item List. The Level and Resource Calculators can use your enemies directly.',
      'Sprite (on the page, under the picture) picks a Pixel Art file and the tag that plays; it plays on the card and the page instead of the picture',
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
      'The word count updates as you type, and you can export a document as Markdown or plain text. Import turns Markdown files into new documents; you can also drag .txt and .md files from your file manager into the app.',
      'Turn on Markdown Syntax in the header to format by typing symbols, like ==highlight==, - [ ] checklists or > [!note] callouts. Pasted Markdown turns into formatting too. See Typing shortcuts in the guide for the full list.',
      'The toolbar also has highlight, checklist and callout buttons. Click a callout\'s title to rename it.',
      'Pick a font and a size for selected text (or for what you type next) in the toolbar.',
      'Click an image for its bar: left, center, right, or with the text flowing around it on the left or right, and 25 to 100% of the text width. Drag the blue corner to size it freely.',
    ],
  },
  'story-writer': {
    title: 'Story Branch Writer',
    body: [
      'A mind-map for branching stories. Create nodes, branch them, connect them to each other and sever connections.',
      'Each node has a bold title and its story text below a thin line. Double-click a node (a new one opens by itself) to type both right on it. Enter in the title jumps to the story text, Shift+Tab or Up at its start goes back to the title, and Esc or clicking away finishes. The Details panel (Select tool) has the same text plus a picture and a link.',
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
      'The pen (P) draws freehand; the eraser (E) removes drawn lines you drag over.',
      'The layers panel (button in the bottom toolbar) lets you reorder everything, and an always-on-top layer keeps your drawings above the images.',
      'The brush button opens your drawings from the Draw tool. Click one to place it as a sticker; transparent parts stay see-through. Double-click to edit it in Draw.',
      'The palette button after the colour swatches picks any colour with the colour wheel, and keeps your recent and saved colours. The jump tool (J) places a jump point on the board (see Jump points)',
    ],
    tips: ['Drop image files straight onto the board.', 'Design Language works exactly the same way, for pinning down the look of your game.'],
  },
  brainstorm: {
    title: 'Brainstorm Board',
    body: [
      'A free board for ideas: drawing, sticky notes, shapes, images, audio clips and voice recordings.',
      'Pin notes and connect pins with string, and group things in named, colored areas.',
      'The palette button after the colour swatches picks any colour with the colour wheel, and keeps your recent and saved colours. The jump tool (J) places a jump point on the board (see Jump points)',
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
      'Hotwheel: hold Q (or press the pen button set to it) for the round menu. Draw\'s outer ring holds up to ten actions you choose, like brush size, undo and redo, turning the view and your tools; make profiles such as Sketching and Inking in Pen and keys settings, Hotwheel. Turn and mirror the view with , and . and Shift+H; this only changes the view, not the picture.',
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
      'Send to → Pixel Art puts the drawing into the open Pixel Art file as a tracing layer, scaled to fit, to draw pixel art over it',
      'Merge down, flattening a group and deleting layers are one undo step each: Ctrl+Z brings the layers and their pixels back',
    ],
    tips: ['Space or the middle mouse button pans, the mouse wheel zooms, 0 fits the canvas into view.', 'Undo goes back 250 steps. Everything saves by itself a moment after you stop drawing.'],
  },
  'design-language': {
    title: 'Design Language',
    body: [
      'Pin down the look of your game: style references, color swatches, shapes and examples of what fits and what does not.',
      'It works exactly like a Moodboard: add images, cut them out, draw, write notes, and use layers.',
      'The brush button opens your drawings from the Draw tool; click one to place it as a sticker. Pictures sent from Draw land here too.',
      'From Pixel Art, Files → Send the palette to Design Language adds the palette here as colour swatches',
      'The palette button after the colour swatches picks any colour with the colour wheel, and keeps your recent and saved colours. The jump tool (J) places a jump point on the board (see Jump points)',
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
      'Sprite picks an animated icon from a Pixel Art file (and the tag that plays); it shows instead of the picture',
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
      'Select and move (the dashed square) drags a rectangle over the level; drag inside it to move the tiles of the current layer in it (other layers, plan tiles, blocked cells and notes stay put). Delete empties that layer there and Esc lets go. Fill floods an area, Erase clears tiles, and right-click with Fill empties an area. Brush sets how many cells Paint, Erase and Blocked cover at once.',
      'Zoom goes from 10 % to 800 %. Isometric turns the level into diamond cells twice as wide as high, for 32 × 16 tiles; the Godot scene then uses Godot\'s isometric tiles.',
      'Note pins a numbered note on the map for puzzles, secrets or ambushes; the notes are listed on the right. The palette counts how many enemies, chests and so on the level has. Export saves the level as a PNG.',
      'Tilesets live in the panel at the bottom, like in Godot, and every level in the project can use them. Add opens a window that shows the picture cut into tiles: pick a common tile size (or 32 × 16 for isometric tiles) or type your own width and height, and set margin and spacing for pictures with gaps; red shows pixels no tile covers, which are left out. Whole picture is one tile keeps a single object (a tree, a house) at its own size. Pick several pictures at once to add one tileset from each with the same settings. Black is see-through makes pure black pixels transparent, for tilesets drawn on black. Grid opens the window again, and Replace swaps in a new version of the picture while names, folders, blocking tiles and painted levels stay.',
      'Click a tile to paint with it, or drag over several tiles to paint them as one stamp. Fill repeats a stamp across the area. Search the tilesets, sort them, and give them a folder and a colour to keep big collections tidy. The button at the top right of the panel pops it out so it floats over the level; drag it by its title and resize it from the corner.',
      'A see-through preview under the mouse shows what a click puts down: the stamp\'s tiles, the plan tile\'s colour, or the outline of what Erase, Blocked and Scatter cover. Faint cells are blocked and are left alone. Snap sets how stamps and brushes line up: Cell puts them on the cell under the mouse; Stamp grid only lets them land on a grid as big as themselves, so the pieces always line up, even across separate strokes.',
      'Drag with a stamp to repeat it: a new copy goes down each time the mouse has moved a whole stamp further, side by side with no overlap, for fences, walls and paths. Hold Shift while dragging to keep any brush on a straight line, across or down.',
      'Scatter (the sparkles, R) spreads details at random, like rocks in a field or different stones in a path. Make a scatter set with + on the right, then click tiles in the tileset panel to add them; drag over several tiles to add them as one group (a boulder of 2 × 2 tiles) that always goes down whole. Each detail\'s slider sets how often it shows up compared to the others; the scissors split a group back into single tiles. Scatter sets are saved with the tilesets, so every level can use them.',
      'Scatter settings: Amount is how much of the area gets a detail, Spacing the smallest gap between two details, and Clumping goes from evenly spread to little patches. Only on keeps details on tiles of the layers below, or on the tile you start on (start on the path to put stones only on the path). Paint with the brush, or switch to Fill area and click to scatter over a whole connected area; In selection scatters over a Select and move rectangle. Re-roll does the last scatter again with a new random layout and the set\'s current settings. Right-click with the brush takes the set\'s details out again. Scatter only paints on the picked layer, so a Details layer above the ground is a good home.',
      'Layers (on the right) stack picture tiles: put fences, fountains and other see-through things on a layer above the ground. Picture tiles go on the picked layer; hide a layer with the eye, and Erase clears the picked layer before plan tiles. Plan tiles like enemies and chests show on top of everything.',
      'Godot scene saves the picture tiles as a Godot 4 TileMap scene with its TileSet into your Godot project (egd/levels/), one TileMap layer per layer, ready to open.',
      'Blocked (the crossed-out circle) marks cells where nothing can walk, shown in red; click a blocked cell or right-click to clear. Pick tiles in a tileset and tick blocks movement for fences, walls and houses: every place you paint them is blocked. The Godot scene gives those tiles collision and adds the hand-blocked cells as a static body.',
      'Painting on a blocked cell leaves it alone and lights up the blocked cells with a hint. Blocking only tells Godot where players cannot walk, so tick Paint over blocked to paint there anyway; Erase always works.',
      'Pixel art tiles stay sharp, with whole screen pixels per tile pixel. For painted or photo tilesets, turn off Sharp pixel art in Settings to smooth them instead.',
    ],
    tips: ['Shortcuts: B paint, M select and move, G fill, E erase, N note, X blocked. Change them in Settings.'],
  },
  'pixel-art': {
    title: 'Pixel Art',
    body: [
      'Make sprites, small animations, icons and tilesets where every pixel lands exactly where you put it. Pick Sprite or Tileset and map on the start screen, choose a size, or open a .ase, .aseprite or PNG file. Open a sprite sheet cuts a sheet into frames by the frame size you give it. Animated GIF and APNG files open with all their frames, and picking several pictures at once makes them frames (in name order).',
      'Tools: Pencil (square or round, 1–16 px), Eraser, Line, Rectangle, Ellipse, Fill and Eyedropper (or Alt-click). Clean lines drops the doubled corner pixels from 1 px lines. Shift keeps lines at clean angles and makes squares and circles. Right-click paints with the second colour.',
      'More tools: Curve (drag a line, then drag again to bend it), Lasso fill (draw around an area), Spray, Dithered gradient (from the main to the second colour, in the direction you drag) and Text in any font, drawn with hard pixels. Ink changes how colour goes down: Lock alpha paints only where there are pixels, Replace colour only over the colour you started on, Colour only keeps how see-through each pixel is. Pressure lets a pen set the pencil size. Use as brush (with a selection) makes the pencil stamp those pixels.',
      'Dither paints only part of the pixels in an even checker pattern, for soft shading and gradients. The mirror buttons draw both sides at once. Seamless repeats the picture around itself and wraps your strokes over the edges, for textures that tile.',
      'The Shade brush steps a pixel one palette colour lighter (left click) or darker (right click), so order your palette from dark to light.',
      'Selecting: the rectangle, lasso and magic wand (one exact colour) select pixels; Shift adds to the selection and Ctrl takes away. Drawing then only changes the selected pixels. Move drags the selection (or the whole layer), and the arrow keys move it by one pixel (Shift: one tile). Ctrl+C, Ctrl+X and Ctrl+V copy, cut and paste, Delete clears, Ctrl+A selects everything and Esc lets go. The panel on the right flips, turns a quarter, rotates by any angle without blur, scales with hard pixels, outlines in the main colour, or shifts by half with wrap-around to check that a tile repeats without seams. All frames applies these to every frame of the layer.',
      'Palette: click a swatch for the main colour, right-click for the second, and double-click to change the swatch: every pixel in that colour changes with it. Ramp adds shades of the main colour from dark to light, with cooler shadows and warmer lights. Open and Save read and write .gpl, .pal and .hex palettes. Colours can be Palette only (every colour you paint snaps to the palette) or Grays. Load a ready-made palette, take the palette From picture, or Reduce to palette to move every pixel to its closest palette colour (with dither for smooth shades). Variants try other colours on the whole animation without changing it, like enemy or team colours.',
      'Layers have show, lock, opacity and order. The timeline below holds the frames: each frame has its own duration (ms, with fps shown), Copy duplicates a frame, and Onion skin shows the frames before and after. Tags name a run of frames (idle, walk, attack) with forward, reverse or ping-pong looping; pick one next to Play to loop it. Preview loops the animation next to the palette at 1×, 2× or 4× while you draw. Link makes a frame that shares its pixels with the one before (drawing on either changes both); Unlink gives it its own copy. Shift-click frames to pick several: delete, duration and Reverse then work on all of them. Onion skin can show up to 4 frames each way, tinted red before and blue after. Layers can blend as Multiply, Screen or Add, and a Reference layer is for tracing and never exported. Pixels sets wide or tall pixels for old-console looks.',
      'Tilesets: the Tiles view is the tileset picture with its tile grid. Tab (or the Map button) switches to the map, where you place tiles from the tile picture on the left (drag over several to place a block), fill, remove or pick tiles, on several map layers. Drawing pixels on the map with the pencil changes that tile everywhere it is used. The mirror and turn buttons place tiles mirrored or turned (also in Level Layout and its Godot export). Random tiles places one of the picked tiles at random in every cell. Draw new tiles lets you draw freely on the map: every cell you change becomes a tile, identical ones are reused, and the tileset grows when it is full. The Tiles view numbers the tiles, shades the ones no map uses and shows the tile you drew on repeated 3 × 3; on the map, the picked tile is outlined wherever it is used. Open a map picture on the start screen cuts a finished map into a tileset and its map.',
      'Files: PNG (any frame, scaled up 1–10× with sharp pixels), GIF, a sprite sheet with JSON data, and Godot SpriteFrames (one animation per tag, ready for an AnimatedSprite2D). Tilesets: Use in Level Layout puts the tileset into the shared tile library and keeps it up to date as you draw; Send the map to Level Layout turns the map into a level, which exports to Godot. In Level Layout, Edit in Pixel Art opens a tileset here. Files can also send the frame (or the map) to the Moodboard, Design Language, Asset Pool or Storyboard, send the whole animation to the Storyboard with its timing, send the palette to Design Language, save the tileset with extruded edges, or the map as CSV or JSON. The sprite sheet can be a grid, one row or a row per tag, with a gap between frames. In Draw, Send to Pixel Art adds the drawing here as a tracing layer.',
      'Sprites on entries: on a character, enemy, town or item page, an ability or an achievement, pick a Pixel Art file (and the tag that plays) under Sprite. It plays instead of the picture.',
    ],
    tips: ['Shortcuts: B pencil, E eraser, L line, U rectangle, O ellipse, G fill, I eyedropper, S shade, M select, Q lasso, W magic wand, V move, C curve, F lasso fill, D gradient, A spray, T text, X swap colours, [ and ] size, comma and period for frames, Enter to play, Tab for tiles and map. Change them in Settings.'],
  },
  'card-designer': {
    title: 'Card Designer',
    body: [
      'Design the front and back of a card, fill a whole deck, and print it or export images and JSON. Each document is one deck with one card design. A new deck first asks for the card size (poker, bridge, tarot, mini, euro, square, business card, token or your own in mm), then starts as a card with a background, picture, frame and text, ready to change.',
      'The left side is your deck: Colours, Fields and the list of cards. The middle shows one card. The right side holds the layers, with Style, Card size and Export below them.',
      'Cards: every card uses the same design and fills in its own values. The list shows each card’s number, a small picture and its name; type in Search cards to find one. + Card adds a card and opens it. Switch cards with the list, the card menu above the canvas (it has a search box too), the arrows next to it or Page Up / Page Down. Front / Back switches sides.',
      'Fields: the shown card’s name, stats, rules and picture, ready to type. Open a field with its arrow to rename it, change its type (Text, Number for stats like Summon cost, Attack, Defense and Health, or Picture), delete it, or apply the shown card’s value to all cards at once. {Name} in a text box shows the value of the field Name. Or pick a Spreadsheet under the card list: row 1 names the fields, every row below is a card, Copies and Variant columns set those; formulas show their results.',
      'Colours: the card background for the front and the back, colour slots like Background, Frame and Accent, and the colour wheel from Draw for the slot you click. Change a slot and every card changes. The chain next to a slot links it to the deck (✓ all); click it to give only the shown card its own colour (this card). Variant picks other colours for the shown card, like one per faction or rarity; Edit variants sets them up.',
      'Layers: click a layer to work on it: Select, the selection box, Ctrl+A, the arrow keys, Delete and recolouring only reach the active layer. Lock a layer and nothing on it can be changed. Alt+click an item on another layer to jump there. Each layer shows a small picture; the pencil renames it. Everything that is on every card shows in the accent colour. The chain on a layer takes it off every card: each card then gets its own copy of what is on it, to change for itself. The chain on an item keeps it on the shown card only, or puts it back on every card (its layer goes on every card too). Every text box also has a T button: lit, its text goes with it to every card that has the box; switch it off and the shown card keeps its text while the box goes empty on the other cards, ready for their own text. Switch it on again and every card gets the shown card’s text. + Add under each layer puts a text box, a new text or number field with its box, a picture field, an image or a shape on that layer. Fields follow the layers: type {Power} in any text box and a Power field appears. The no-entry button turns a layer off on the shown card only. The sparkle makes everything on a layer foil.',
      'Text (T): click on the card and type. Long text shrinks to fit its box. The Style section sets the font (fantasy, comic, sci-fi, retro and easy-to-read fonts come with the app), size, bold, italic, alignment and colour. Type :sword:, :shield:, :heart:, :mana:, :fire: or any name under Icons in text to put an icon in the text; + Own icon adds your own picture.',
      'Pictures: the image button under the card imports a picture that is the same on every card, at its own shape; you can also drop image files onto the card. The frame button adds a picture field: an empty frame that shows each card’s own picture. Right-click a picture (on the card or in the layers) to replace it or to fit it to the whole card (bleed), the cut line or the safe line. The magnet turns on snapping: moved and resized items snap to the bleed, cut and safe lines and the centre of the card. + Text, + Number and + Picture in Fields add the field and put its box on the active layer.',
      'Foil: tick Foil in Style for one item, or use the sparkle on a layer. Foil shows with a shine; Export gives Foil mask sheets (PDF), black where the foil goes, for print shops.',
      'Card size: change the size and the whole design scales along. The red dashed line is the bleed: let background art reach it so no white edge shows after cutting. Keep text inside the blue safe line.',
      'The bar under the card: Select, Text, Shapes (rectangle, ellipse and line in one menu), a picture field that shows each card’s own picture, and a fixed image that is the same on every card. Pan with Space+drag. The X on the layers hides them; Show layers brings them back. The Hotwheel has the previous and next card, Front / Back, + Card, Text, Rectangle, Foil for the selection and Lock layer.',
      'Export: Print sheets as PDF or PNG fit as many cards as possible on A4, A3, A5, Letter or Legal paper, with crop marks, bleed and backs on every other page for double-sided printing (flip on the long edge). Print at actual size. Deck image puts every card into one PNG, 10 per row. Card images + JSON saves a PNG of every card side plus deck.json; Deck JSON saves only the data, for game engines.',
    ],
    tips: ['Shortcuts: V select, H pan, R rectangle, O ellipse, L line, T text, Alt+click to switch layers, Page Up / Page Down for the previous or next card. Draw has card sizes with cut and safe guide lines too.'],
  },
  achievements: {
    title: 'Achievements',
    body: [
      'List your achievements with a type, a picture, what players see, how it unlocks, the reward and points. Progress achievements get a number of steps, like 100 slimes.',
      'Mark achievements as hidden until unlocked, and set how many players you expect to get each one, so you can balance easy and rare ones.',
      'The toolbar adds up the points and warns when you go over 1000, the usual budget for a full game on consoles.',
      'Sprite picks an animated icon from a Pixel Art file (and the tag that plays); it shows instead of the picture',
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
      'From Pixel Art, Files → Send the animation to Storyboard adds every frame (or the picked tag) as frames here, with their timing',
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
  'texture-paint': {
    title: 'Texture Paint (experimental)',
    body: [
      'Texture Paint is experimental: it can be slow with big models or textures, some model files may not load right, and it may still change. A warning says so each time it opens.',
      'Paint 3D models. Pick a model (GLB works best; OBJ and FBX too) and a texture size. The model is on the left, its texture on the right, and both update as you paint.',
      'Paint on the model with the left button: the brush lands on the texture spot under the pointer. Drag next to the model or with the right button to turn it, the middle button to move, the wheel to zoom. A stroke that crosses a seam continues on the other side of the seam on the texture.',
      'The right side is a full Draw canvas: every brush, layers, blend modes, adjustment layers, selections and undo. A model that brings its own texture starts with it as a layer.',
      'UV layout adds the model’s UV layout as a locked guide layer that is left out of exports, so you can see where each part of the model sits on the texture.',
      'Export the texture like any drawing (PNG and more), or GLB to save the model with its painted texture, ready for Godot, Unity or Unreal.',
      'Small textures (64, 128 or 256 px) are shown with hard pixels on the model, for pixel-art 3D',
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
  { label: 'Source code', url: 'https://github.com/Evelynnsrepos/EVLMG-Designer', icon: Code },
  { label: 'Website', url: 'http://onee.page/evelopmentgames', icon: Globe },
  { label: 'Support on Ko-fi', url: 'https://ko-fi.com/evelynnevlmg', icon: Coffee },
]
