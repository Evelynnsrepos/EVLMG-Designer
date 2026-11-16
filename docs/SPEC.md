# Evelopment Games Designer: Product Spec

> Version 0.2 (draft), 2026-10-01 (updated with Evelynn's first answers)
> Source: `Evelopment Games Designer.txt` (Evelynn's original design notes, kept unchanged next to this file)
> Status: ready for building, apart from the items in **Section 13.2: Still Open**. Anything marked **[Default]** is a choice made to fill a gap in the original notes. Each one can be changed without touching the rest of the vision, and most of them are repeated as questions at the end.

---

## 0. How to Read This Spec (for humans and coding agents)

- **Original intent wins.** Every feature here comes from Evelynn's notes. When a section says **[Default]**, the notes did not say, and a sensible choice was picked so work can continue. Do not treat a [Default] as a requirement if Evelynn says otherwise.
- **IDs.** Requirements are numbered (`PM-1`, `ED-3`, `TL-2`, ...) so issues, commits and tests can reference them.
- **Acceptance criteria** ("AC") under each component describe what must be true for that component to count as done.
- **Build in the order given in Section 12.** The shared foundations (project storage, editor shell, entity system) come first because every component depends on them.

---

## 1. Product Summary

**Evelopment Games Designer** is a free, all-in-one desktop tool for designing games. A designer keeps an entire game's design in one project: story, lore wiki, characters, towns, items, maps, timelines, mood and brainstorm boards, and balancing calculators. The tools live side by side in a tiling editor and share data with each other, so an item created in the Item List can show up in the Wiki, and a level-up curve from the Level Calculator can feed the Resource Calculator.

### 1.1 Goals
1. One program for the whole design process, so designers stop juggling a dozen separate apps.
2. Completely free and open source (GPL-3.0), published on GitHub.
3. Components that know about each other (shared items, characters, towns, categories).
4. A calm, non-intrusive interface: the content is the focus, window chrome stays out of the way.
5. Never lose work: everything auto-saves.

### 1.2 Non-Goals (for version 1)
- It is not a game engine. It does not run or build games.
- No accounts, cloud sync or real-time multiplayer editing. **[Default]** (see Q1)
- No AI generation features. **[Default]**

### 1.3 Target Users
Solo and small-team game designers, writers and worldbuilders, especially people designing RPGs, gacha games and strategy games (the notes reference Genshin Impact style reactions and armor-based strategy games).

---

## 2. Platform and Technical Defaults

**Decided by Evelynn (2026-10-01):** the app must run on **Windows and Linux**; the technical choice is left to the builder. The decision below is final for v1 unless Evelynn changes it.

| Topic | Decision | Reason |
|---|---|---|
| App type | Desktop app, offline-first. **Required targets: Windows 10/11 (x64) and Linux (x64).** macOS added 2026-10-02 (unsigned universal .dmg built by GitHub Actions). | Designers work on large local projects with images and audio; Evelynn wants Windows and Linux. |
| Stack | **Tauri 2 + TypeScript + React**, canvas work with **Konva** (or plain HTML Canvas), rich text with **TipTap** | Free and open source, one codebase for Windows and Linux, small installers (a few MB vs ~100 MB for Electron), well known to coding agents. |
| Packaging | Windows: `.msi` and `.exe` (NSIS) installers. Linux: **AppImage** (runs on any distro) plus `.deb`. Built automatically by GitHub Actions on every release. | Covers the common ways people install on both systems. |
| Platform rules | Use Tauri's path APIs for all file paths (never hard-code `\` or `/`). Treat file names as case-sensitive (Linux) and avoid characters Windows forbids (`<>:"/\|?*`) when creating folders from project names. Test every release on both Windows and Linux. | Avoids the usual cross-platform bugs. |
| Storage | Each project is a normal folder on disk with JSON files plus an `assets/` folder | Easy to back up, readable, works with Git. |
| License | GPL-3.0 | Decided by Evelynn (2026-10-02): open source; changed versions must stay open source. Replaces PolyForm Strict. |
| Language | English UI, text stored so it can be translated later | |

### 2.1 Project Folder Layout [Default]
```
MyGame/
  project.json            # name, description, enabled components, layout, stats
  entities/
    items.json
    characters.json
    towns.json
    enemies.json
    categories.json       # shared custom categories / associations
  components/
    timeline/<id>.json
    story/<id>.json
    writer/<id>.json      # rich text documents
    moodboard/<id>.json
    brainstorm/<id>.json
    map/<id>.json
    wiki/articles/<id>.json
    calculators/<id>.json
  assets/
    images/
    audio/
```
- All IDs are UUIDs. All files include a `schemaVersion` so future versions can migrate old projects.
- Images and audio are copied into `assets/` when added, so a project folder is self-contained.

---

## 3. Core Concepts (shared by everything)

### 3.1 Project
A named container for one game's design. Has a name (required), a short description (optional), a set of enabled components, and saved editor layout.

### 3.2 Component
One of the design tools (Timeline, Wiki, Item List, ...). A component **type** can have several **documents** where that makes sense (for example several timelines, several moodboards). **[Default]** List-style components (Item List, Character List, Town List, Wiki) have exactly one per project because they are the project's shared database. (Q5)

### 3.3 Entities
Items, Characters, Towns and Enemies are **entities**: records that live once in the project and can be referenced from any component (Wiki, Map, Story nodes, Timeline events, Resource Calculator).
- Referencing works by ID, so renaming a character updates everywhere it appears.
- Deleting an entity that is referenced elsewhere asks for confirmation and lists where it is used.

### 3.4 Custom Categories ("custom cats") and Associations
From the notes: once a custom category is created it can be used everywhere.
- A **category** has a name, a type (dropdown of options, free text, number, yes/no) and, for dropdowns, a list of options.
- Categories are stored once per project in `categories.json`.
- Built-in categories ship with the app: Items have *Rarity*, *Value*, *State of Repair*; Characters have *Family*, *Nation*, *Clan*, *Race*; Towns and map cities have *Nation*, *Race*, *Religion*; Enemies have *Faction*, *Race*, *Region*, *Element*.
- **[Default]** Categories are shared across all entity types: a "Nation" category created for characters is also available for towns, enemies and map cities. (Q6)

### 3.5 Auto-Save
- Every change is saved automatically, shortly after editing stops (about 1 second) and immediately when a component is closed (as the notes require) or the app is closed.
- **[Default]** Undo/redo (Ctrl+Z / Ctrl+Y) inside every component, per component.
- **[Default]** A rolling backup of each project is kept (the last 10, plus one per day for a week and one per week for a month) so a bad edit or a crash can be recovered.

---

## 4. Section 1: Project Launcher (Project Management)

On startup the user sees the launcher, a list of their game projects.

| ID | Requirement |
|---|---|
| PM-1 | The launcher shows every project the user has created as a card (or row). |
| PM-2 | Each card shows the project **name** and, if set, its **short description**. |
| PM-3 | Each card shows a **size counter**: total **words** and total **images** in the project. |
| PM-4 | A **New Project** button opens the New Project screen (Section 5). |
| PM-5 | Clicking a card opens the project in the editor (Section 7). |
| PM-6 [Default] | Projects are sorted by last opened, newest first. |
| PM-7 [Default] | Each card has a small menu: Rename, Edit description, Show in folder, Delete (with confirmation). |
| PM-8 [Default] | An **Open existing folder** button lets the user open a project folder that was copied from somewhere else (e.g. downloaded from GitHub). |

**Word count** counts words in all text the user wrote: writer documents, wiki articles, story nodes, timeline events, notes on entities, sticky notes. **Image count** counts files in `assets/images/`.

**AC:** Starting the app with 3 existing projects shows 3 cards with correct names, descriptions, word and image counts. Adding a 100-word wiki article and reopening the launcher raises the word count by 100.

---

## 5. Section 2: Creating a New Project

The launcher view is replaced by a short creation flow.

| ID | Requirement |
|---|---|
| NP-1 | Step 1: a text input for the project **name** (required, cannot be empty). |
| NP-2 | Step 2: a text input for an optional **short description**. |
| NP-3 | Step 3: a checklist of all components so the user can **pre-select** which ones the project needs. |
| NP-4 [Default] | Components not selected can still be added later from the sidebar, so this choice is never final. |
| NP-5 [Default] | A **Back** button on each step and a **Cancel** button that returns to the launcher. |
| NP-6 [Default] | After the last step the project folder is created and opened in the editor. The default save location is the user's Documents folder (`Documents/Evelopment Games Designer/<Project Name>/` on Windows, `~/Documents/Evelopment Games Designer/<Project Name>/` on Linux), changeable on this screen. |

**AC:** Creating a project named "Test" with only Wiki and Item List selected creates the folder, opens the editor, and shows those two components in the sidebar.

---

## 6. Section 3: Components Overview

Once a project is open there is an **always visible sidebar on the left** listing the components (the tools for game design).

| # | Component | Type | Spec section |
|---|---|---|---|
| 1 | Timeline Creator (branched) | Canvas | 8.1 |
| 2 | Wiki Creator | Document database | 8.2 |
| 3 | Damage Number Calculator | Calculator | 8.3 |
| 4 | Item List | Entity list | 8.4 |
| 5 | Story Branch Writer | Node canvas | 8.5 |
| 6 | Regular Writer | Rich text document | 8.6 |
| 7 | Moodboard | Canvas | 8.7 |
| 8 | Brainstorm Board | Canvas | 8.8 |
| 9 | Level Number Calculator | Calculator | 8.3 |
| 10 | Resource Calculator | Calculator | 8.9 |
| 11 | Map Creator | Canvas | 8.10 |
| 12 | Character List | Entity list | 8.11 |
| 13 | Town List | Entity list | 8.12 |
| 14 | Enemy List | Entity list | 8.13 |

| ID | Requirement |
|---|---|
| SB-1 | The sidebar is always visible while a project is open. |
| SB-2 | It shows each enabled component with an icon and name. |
| SB-3 | A component is opened by clicking it or by **dragging it into the editor area** (see Section 7). |
| SB-4 [Default] | For components that can have several documents (Timeline, Moodboard, Brainstorm, Story, Writer, Map, Calculators), the sidebar entry expands to show its documents and a "+ New" button. |
| SB-5 [Default] | The sidebar can be narrowed to icons only, but never hidden completely. |
| SB-6 [Default] | A "+ Add component" button at the bottom enables components that were not pre-selected. |
| SB-7 [Default] | A "Back to projects" button at the top returns to the launcher (everything is saved first). |

---

## 7. Section 4: The Editor (Tiling Workspace)

| ID | Requirement |
|---|---|
| ED-1 | When a project opens, one component opens with it. **[Default]** It reopens the layout from the last session; for a brand-new project, the first selected component opens. |
| ED-2 | Dragging a component from the sidebar into the editor opens it in **split view**. |
| ED-3 | **Auto-tiling:** open components automatically arrange to fill the space with no overlaps and no gaps. Where the user drops a component (left, right, top or bottom half of an existing one) decides where the new split goes. |
| ED-4 | Each component has its own **"fake" window decoration**: a slim header that is as non-intrusive as possible. **[Default]** It shows the component name and fades to very low opacity until hovered. |
| ED-5 | Pressing **Esc** enters **Layout Mode**: a **giant X** appears on every open component, along with **arrows** to move it. |
| ED-6 | In Layout Mode, clicking the X closes that component. Clicking an arrow swaps the component with its neighbour in that direction. |
| ED-7 [Default] | Pressing Esc again, or clicking empty space, leaves Layout Mode. Esc only enters Layout Mode when no tool inside a component is using Esc (for example, cancelling a half-drawn shape takes priority). (Q7) |
| ED-8 | When a component is closed it is **auto-saved**. |
| ED-9 [Default] | Split borders can be dragged to resize. The layout is saved per project. |
| ED-10 [Default] | Opening the same document twice is not allowed; trying to do so focuses the open one. |

**AC:** With a Wiki open, dragging the Item List onto the right half of it gives a 50/50 split. Pressing Esc shows an X and arrows on both. Clicking the X on the Wiki closes it, saves it, and the Item List expands to fill the editor.

---

## 8. Section 5: Component Details

### 8.1 Timeline Creator (branched)

| ID | Requirement |
|---|---|
| TL-1 | The user may enter a **start year** and **end year**. Both are **optional**. |
| TL-2 | The timeline is shown as a **line**. Clicking anywhere on the line adds an **event** at that point. |
| TL-3 | An event has **text** and always has the option to add an **image**. |
| TL-4 | A **toolbar below** the timeline holds the tools. |
| TL-5 | The shortcut **B** switches to **Branch mode**. In Branch mode the user adds **branches** for **alternative timelines**: clicking a point on a line starts a new line that splits off from there. |
| TL-6 [Default] | Pressing B again (or choosing another tool) returns to the normal Event tool. |
| TL-7 [Default] | Branches can have a name and color, and can branch again (branches of branches). |
| TL-8 [Default] | If start and end years are set, event positions show a year (whole years, may be negative for "BC" style dates). If not set, events are simply ordered along the line with no dates. (Q8) |
| TL-9 [Default] | Events can be dragged along their line, edited, and deleted. Events can link to entities (characters, towns, items) and wiki articles. |
| TL-10 [Default] | Pan with middle mouse or space+drag, zoom with the scroll wheel. |

**AC:** With no years set, the user clicks the line three times and gets three events in order. Pressing B and clicking the middle event's position creates a branch line that can hold its own events.

### 8.2 Wiki Creator

| ID | Requirement |
|---|---|
| WK-1 | A basic wiki the user populates with **articles**. |
| WK-2 | Pressing **New Article** offers the option to **pull from** the **Item List**, **Character List** or **Town List** (and the **Enemy List**), so an entity becomes an article quickly. A blank article is also possible. |
| WK-3 | An article pulled from an entity stays linked to it: its fields (image, categories, associations) are shown in an info box at the top of the article. **[Default]** Changes to the entity show up in the article. |
| WK-4 | Articles can **mention** each other and entities. **[Default]** Typing `[[` opens a search to insert a link. |
| WK-5 | A **connection map** (graph view, like Obsidian) shows articles as dots and mentions as lines between them. Clicking a dot opens that article. |
| WK-6 [Default] | Articles use the same rich text editor as the Regular Writer (headings, bold, italic, lists, images). |
| WK-7 [Default] | The wiki has a searchable article list, and each article shows "Mentioned in" (backlinks) at the bottom. |

**AC:** Creating a new article from the character "Aria" fills its info box with Aria's data. Writing `[[Ironhold]]` in it links to the Ironhold article, and the connection map shows a line between them.

### 8.3 Calculators (Damage Number Calculator, Level Number Calculator)

All calculators use **formulas commonly found in games**. When opened, a calculator displays a **constant collection of mathematical formulas commonly used in game design**, grouped by **type of game**.

| ID | Requirement |
|---|---|
| CA-1 | On opening, the calculator shows its built-in formula library, grouped by game type. |
| CA-2 | Picking a formula shows input fields for its variables and the result, updated live as values change. |
| CA-3 [Default] | Each formula shows its written-out form (e.g. `Damage = ATK × Multiplier × (1 − DEF%)`) and a one-line explanation. |
| CA-4 [Default] | The user can save a configured formula with their game's numbers as a named **preset** in the project (e.g. "Sword basic attack"). Presets are what other components (Resource Calculator) read from. |
| CA-5 [Default] | The user can write **custom formulas** using a safe expression language (`+ − × ÷ ^`, `min`, `max`, `floor`, `round`, variables). No arbitrary code execution. |
| CA-6 [Default] | A preset can be shown as a **table or chart** across a range (e.g. damage at levels 1 to 90). |

**Damage Number Calculator: built-in formula groups (minimum)**
- **Elemental reactions** (games like Genshin Impact): amplifying reactions (multiplier on damage, boosted by a mastery stat) and transformative reactions (damage based on level and mastery, not attack).
- **Raw damage with armor** (strategy and fighting games): flat reduction (`ATK − DEF`), percentage reduction (`DEF / (DEF + K)`), armor penetration.
- **Critical hits**: crit rate, crit damage, expected average damage.
- **Damage over time** and **multi-hit**.
- **Resistances and weaknesses** (type or element multipliers).

**Level Number Calculator** (confirmed by Evelynn 2026-10-01: XP curves, stat growth, **and how much damage can be dealt at each level**).

| ID | Requirement |
|---|---|
| LV-1 | **XP curves:** linear, polynomial (`base × level^exponent`), exponential, and custom formulas. |
| LV-2 | **XP tables:** XP needed per level and total XP needed to reach any level. |
| LV-3 | **Stat growth per level:** flat and percentage growth for any stat (ATK, DEF, HP, mastery, custom stats). Stats can come from a character, enemy or item, or be typed in. |
| LV-4 | **Damage per level:** pick a Damage Calculator formula (or preset) and the calculator shows **how much damage can be dealt at every level**, using the stats grown in LV-3. |
| LV-5 | Damage per level can be shown against a target: a fixed DEF/resistance value, or an **enemy from the Enemy List** (8.13) at a chosen level, so the designer sees e.g. "hits needed to defeat this enemy" per level. |
| LV-6 | Results show as a table and a line chart across a level range (e.g. 1 to 90), with optional **level-up cost** columns (materials per level). |
| LV-7 | Level-up data and costs saved here (as presets) are what the Resource Calculator uses. |

**AC:** Opening the Damage Calculator shows the formula groups. Selecting "Percentage armor" with ATK 100, DEF 50, K 100 shows 66.67 damage.

**AC (Level):** With ATK growing from 100 at level 1 by +10 per level and the "Percentage armor" formula against DEF 50, K 100, the damage-per-level table shows 66.67 at level 1 and 73.33 at level 2, and the chart shows a rising line.

### 8.4 Item List

| ID | Requirement |
|---|---|
| IT-1 | An **Add Item** button creates a new item. |
| IT-2 | An item's image is either a chosen **image** or the **pink and black checkerboard placeholder** (the classic "missing texture"). |
| IT-3 | Items have fields such as **Rarity**, **Value**, **State of Repair**. |
| IT-4 | The user can create **custom categories** (Section 3.4). Each is selected via dropdown. |
| IT-5 | A custom category can apply to **all items** or **only selected items**. |
| IT-6 | Once a custom category is created it can be **used everywhere** in the project. |
| IT-7 [Default] | Items also have a name (required) and a free-text description. |
| IT-8 [Default] | The list can be shown as a grid of cards or as a table, and can be sorted, filtered by any category, and searched. |
| IT-9 [Default] | Items can hold numbers used by calculators (e.g. upgrade cost, stats). Each item shows a read-only **"Dropped by"** list of enemies whose drop tables include it (8.13). |

**AC:** Adding an item with no image shows the pink/black placeholder. Creating a category "Element" with options Fire/Water/Earth and applying it to two selected items shows the dropdown on those two items only. The "Element" category is then offered when creating a category on a character.

### 8.5 Story Branch Writer

A **mind-map style** writer for branching stories.

**Nodes**
| ID | Requirement |
|---|---|
| SW-1 | A node has **upper text** (title or heading) and **lower text** (body). **[Default]** interpretation of "some text up ahead and some lower text". |
| SW-2 | Any node can have an **image** and a **link**. **[Default]** The link can point to a web address, another node, a wiki article or an entity. |
| SW-3 | Whenever a **new branch** is created, the user is offered a **selection of colors** for the new node. |

**Tools**
| ID | Requirement |
|---|---|
| SW-4 | **Create tool:** clicking empty space makes a node. After (optionally) typing text, clicking somewhere else makes a **new node connected to the previous one**. |
| SW-5 | **Making a choice (branch):** clicking an **old node** with the Create tool sets it as the **last node**. The next click in empty space makes a new node connected to that last-clicked node. This is how a story splits into choices. |
| SW-6 | **Sever tool:** clicking a connection between two nodes unlinks them. |
| SW-7 | **Connect tool:** clicking one node then another links them. |
| SW-8 [Default] | A **Select tool** to move, edit and delete nodes. Pan and zoom like the Timeline. |
| SW-9 [Default] | The current "last node" is highlighted so the user always knows where the next node will attach. |
| SW-10 [Default] | Connections have a direction (arrow from earlier node to later node). |
| SW-11 [Default] | Keyboard shortcuts: V Select, C Create, S Sever, L Connect (link). (Q9) |

**AC:** With the Create tool, clicking three times makes nodes A→B→C. Clicking A then clicking empty space makes D connected to A, so A has two branches (B and D). The color picker appears when D is created. Using Sever on A→B removes that link; using Connect from D to C adds D→C.

### 8.6 Regular Writer

Not described beyond its name. **[Default]**:
- A plain rich-text document editor for design docs, scripts, dialogue and notes.
- Headings, bold, italic, underline, lists, quotes, images, links to wiki articles and entities (same `[[` linking as the Wiki).
- Live word count shown in the component header; feeds the project word counter.
- Several documents per project, listed under the component in the sidebar.
- Export to Markdown and plain text.

### 8.7 Moodboard

| ID | Requirement |
|---|---|
| MB-1 | The user can put **images** on a free mind-map-style canvas. |
| MB-2 | The user can make **cutouts** of images, either with **basic shapes** (rectangle, ellipse, polygon) or **drawn freehand with the mouse** (lasso). |
| MB-3 | The user can **write text** on the board. |
| MB-4 | The user can draw **basic shapes** with the mouse: straight lines, rectangles, and so on. **[Default]** also ellipses, arrows and freehand pen. |
| MB-5 | A **layers panel on the side** lists all images and drawings. The user can **manage layers at any time** (reorder, hide, rename, delete). |
| MB-6 | When drawing or writing on top of images there is an **always-on-top** option. When enabled, new drawings and text are placed on a layer that stays above all images, even when images are added or moved later. (Confirmed by Evelynn.) |
| MB-7 [Default] | Images can be added by file picker, drag and drop from the computer, or paste from clipboard. |
| MB-8 [Default] | Images can be moved, scaled, rotated. Cutouts are non-destructive (the original image is kept and the cutout can be edited later). |

**AC:** Dropping an image onto the board adds it and a layer entry. Using the lasso to cut out a shape hides everything outside it. With always-on-top on, a line drawn over the image stays above it after the image is dragged.

### 8.8 Brainstorm Board

| ID | Requirement |
|---|---|
| BB-1 | The user can **draw** on the board. |
| BB-2 | **Sticky notes** can be added. ("sticky nodes" in the notes, read as sticky notes.) |
| BB-3 | **Basic shapes** can be drawn. |
| BB-4 | **Images** and **music or voice clips** can be put on the board. Audio shows as a small player card. **[Default]** recording a voice clip directly from the microphone is supported too. (Q10) |
| BB-5 | **Pins** can be placed on the board and **connected with string** (detective-board style lines between pins). |
| BB-6 | **Area tool:** the user selects an area of the board; it is shown highlighted in a chosen **color** and can be given a **name**. The color and name can be **changed afterwards**. |
| BB-7 [Default] | Pins can be attached to sticky notes, images and clips so the string moves with them. |
| BB-8 [Default] | Areas are rectangles by default; freehand areas are a later addition. Items inside an area move with it when the area is dragged. |

**AC:** Placing two pins and connecting them shows a string between them that follows when a pin is moved. Marking an area, naming it "Act 1" and choosing red shows a red labelled region; renaming it to "Prologue" and changing to blue updates it.

### 8.9 Resource Calculator

| ID | Requirement |
|---|---|
| RC-1 | Uses **item-specific level-up data** and **enemy drop-rate data** from the other calculators and lists. |
| RC-2 | Calculates **how much time a player has to spend** to get certain resources. |
| RC-3 | Calculates **how many resources a player needs** for a goal (e.g. level a weapon from 1 to 90). |
| RC-4 | It is **interconnected with the other calculators**: changing a preset in the Level Calculator updates the Resource Calculator results. |
| RC-5 [Default] | Input: a goal (target level of an item or character, or an amount of a resource). Sources: drop rates per enemy or activity, time per run, daily limits (e.g. stamina/energy). Output: total resources needed, expected runs, expected time (hours and days). |
| RC-6 | **Drop rates come from the Enemy List** (8.13, decided by Evelynn). Non-enemy sources (chests, quests, shops, daily rewards) go in a small "Other sources" table inside the calculator. |
| RC-7 | The user picks a resource (an item) and the calculator finds every enemy and source that drops it, so the designer can compare "fastest way to farm". |

**AC:** Given a Level Calculator preset that needs 400 Ore from level 1 to 20, and an enemy in the Enemy List that drops 2 Ore at 50% chance with a 1-minute defeat time, the calculator shows 400 kills and about 6 h 40 min.

### 8.10 Map Creator

| ID | Requirement |
|---|---|
| MP-1 | A basic map maker on a **"blank" map** (empty canvas). |
| MP-2 | **Markers** can be placed to make **cities** and **streets**. **[Default]** streets are drawn as lines between points. |
| MP-3 | **Stamps** show terrain: **trees**, **shoreline**, **plainland** and others. **[Default]** also mountains, water, desert, swamp, hills. |
| MP-4 | When a city is created the user can mark its **associations**: nation, race, religion and so forth (shared categories, Section 3.4). |
| MP-5 | Creating a city on the map also creates (or links to) an entry in the **Town List**, so towns and map cities are the same entity. (Confirmed by Evelynn.) |
| MP-6 [Default] | Pan and zoom; labels for cities; an optional background image (e.g. a hand-drawn sketch to trace). |
| MP-7 [Default] | Export the map as a PNG. |

**AC:** Placing a city marker named "Ironhold" and setting Nation = "Dwarven Kingdom" shows the label on the map and creates Ironhold in the Town List with the same nation.

### 8.11 Character List

| ID | Requirement |
|---|---|
| CH-1 | The user can create **characters**. |
| CH-2 | Characters can be given **associations** like **family**, **nation**, **clan**, **race** and so on. |
| CH-3 | **Custom associations** can be added and are **accessible on every character page** if needed. |
| CH-4 [Default] | A character has a name (required), portrait (or placeholder), short description and notes. |
| CH-5 [Default] | Associations to other characters (e.g. family: "Mother of Aria") link to that character. |
| CH-6 [Default] | Grid and table views, sorting, filtering by association, search. "Create wiki article" button. |

### 8.12 Town List

Not described beyond its name. **[Default]** mirrors the Character List:
- Towns have a name, image, description and associations (nation, race, religion and custom categories).
- Each town can be shown on a Map (MP-5) and pulled into the Wiki (WK-2).
- Characters can be linked to a town (e.g. "Lives in").

### 8.13 Enemy List

Added by Evelynn (2026-10-01), **inspired by the Character List**. It is the home of enemy stats and drop rates that the calculators use.

| ID | Requirement |
|---|---|
| EN-1 | The user can create **enemies**, with name (required), image (or pink/black placeholder), short description and notes, like characters. |
| EN-2 | Enemies have **associations** like the Character List (e.g. faction, race, region, element) using the shared categories (3.4); custom ones can be added and used on every enemy page. |
| EN-3 | Enemies have **combat stats**: level (or level range), HP, ATK, DEF, resistances/weaknesses, plus any custom stat. **[Default]** Stats can grow per level using the same growth settings as the Level Calculator (LV-3). |
| EN-4 | Each enemy has a **drop table**: rows of *item (from the Item List)*, *amount* (fixed or min–max), *drop chance %*. |
| EN-5 | Each enemy has an optional **time to defeat** (seconds) and **respawn/limit** info (e.g. "boss, once per week"), used by the Resource Calculator. |
| EN-6 | Enemies can be linked to **towns and map locations** where they appear ("Found in"). |
| EN-7 | Grid and table views, sorting, filtering by association or stat, search, and a "Create wiki article" button (WK-2). |
| EN-8 | Enemies are used as targets in the Damage and Level Calculators (LV-5) and as drop sources in the Resource Calculator (RC-6). |

**AC:** Creating the enemy "Cave Golem" with DEF 50 and a drop row "Ore, 2, 50%" makes Cave Golem appear in Ore's "Dropped by" list, appear as a target in the Level Calculator, and appear as a source when Ore is picked in the Resource Calculator.

---

## 9. Cross-Component Connections (summary)

| From | To | What flows |
|---|---|---|
| Item, Character, Town, Enemy Lists | Wiki | New article from entity; info box stays in sync |
| Map Creator | Town List | City markers are towns |
| Level Number Calculator | Resource Calculator | Level-up costs |
| Damage Calculator | Level Number Calculator | Damage formula used for damage per level |
| Enemy List | Level and Damage Calculators | Enemy stats as targets |
| Enemy List (drop tables) | Resource Calculator, Item List | Drop rates, time to defeat; "Dropped by" on items |
| Categories | Items, Characters, Towns, Enemies, Map cities | Shared custom categories/associations |
| Any text field | Wiki and entities | `[[` links and mentions |
| Timeline events, Story nodes | Entities, Wiki | Optional links |

---

## 10. Interaction and Visual Design Principles

1. **Non-intrusive chrome.** Window decorations, toolbars and panels are slim and quiet; content takes the space.
2. **Consistent tools.** All canvas components (Timeline, Story, Moodboard, Brainstorm, Map) share the same pan/zoom, select, delete and undo behaviour.
3. **Toolbars.** Canvas tools sit in a toolbar (the notes put the Timeline toolbar below; **[Default]** all canvas components use a bottom toolbar for consistency).
4. **Keyboard first where it helps.** Single-letter shortcuts switch tools (B = Branch in the Timeline is from the notes; the rest are defaults). Shortcuts only apply to the focused component.
5. **[Default]** Light and dark themes, dark by default.
6. **Placeholder art** is the pink/black checkerboard everywhere an image is missing.

---

## 11. Non-Functional Requirements [Default]

- **Performance:** projects with 5,000 entities, 1,000 wiki articles and 500 images open in under 3 seconds on a mid-range laptop. Canvases stay smooth (60 fps) with 500 objects.
- **Reliability:** no data loss on crash; saves are written to a temp file then renamed.
- **Offline:** works fully without internet.
- **Accessibility:** all actions possible by keyboard; sufficient color contrast; colors never the only way information is shown (area and branch names are always visible).
- **Privacy:** no telemetry.
- **Cross-platform:** every feature works identically on Windows and Linux. CI runs the test suite on both.
- **Open source hygiene:** README with screenshots, CONTRIBUTING guide, issue templates, automated builds for Windows and Linux on GitHub Actions.

---

## 12. Build Plan (suggested order for agents)

1. **Foundation:** app shell, project folder format, launcher (Section 4), new project flow (Section 5), auto-save and undo.
2. **Editor shell:** sidebar, tiling workspace, drag-to-split, fake window decorations, Esc Layout Mode (Sections 6 and 7).
3. **Entity system:** Item List, Character List, Town List, Enemy List, shared categories (8.4, 8.11, 8.12, 8.13, 3.4).
4. **Writing:** Regular Writer, Wiki with `[[` links, pull-from-entity, connection map (8.6, 8.2).
5. **Shared canvas engine:** pan/zoom, select, layers, shapes, text, images.
6. **Canvas components:** Story Branch Writer, Timeline, Brainstorm Board, Moodboard, Map Creator (8.5, 8.1, 8.8, 8.7, 8.10).
7. **Calculators:** formula engine and library, Damage, Level, then Resource Calculator (8.3, 8.9).
8. **Polish and release:** themes, word/image counters, export, installers, GitHub release.

Each step should end with a working, usable app, so the tool is useful long before it is complete.

---

## 13. Decisions and Open Questions

### 13.1 Decided (2026-10-01)
| Topic | Decision |
|---|---|
| Platform | Runs on **Windows and Linux**; builder chose Tauri 2 + TypeScript + React (Section 2). |
| Level Number Calculator | XP curves, stat growth, **and damage dealt per level** (LV-1 to LV-7). |
| Drop rates | New **Enemy List** component inspired by the Character List holds enemy stats and drop tables (8.13). |
| Map cities | A city on the map is automatically a Town List entry (MP-5). |
| Moodboard always-on-top | Drawings and text stay above images (MB-6). |

### 13.2 Still Open
The current [Default] is in brackets; one-word answers are fine. None of these block starting the build.

1. **Sharing:** is v1 single-user on one computer, or do you want sharing/teamwork? [Single-user; projects are folders you can share via GitHub]
2. ~~**License** for the GitHub release?~~ Decided: GPL-3.0 (2026-10-02, replacing PolyForm Strict).
3. **Name:** is "Evelopment Games Designer" the final name for the app and repository?
4. **Town List and Regular Writer:** anything specific you want beyond the defaults in 8.12 and 8.6?
5. **Multiple documents:** can a project have several timelines, moodboards, maps, etc.? [Yes for canvases and writer docs; one shared Item/Character/Town/Enemy List and one Wiki]
6. **Shared categories:** should a custom category made for items also be offered for characters, towns and enemies? [Yes, shared everywhere]
7. **Esc key:** should Esc always open Layout Mode, even while drawing or typing? [Only when no tool is using Esc]
8. **Timeline years:** whole years only, or months/days and custom calendars (fantasy eras)? [Whole years, negative allowed]
9. **Story writer shortcuts:** any keys you want for Create, Sever and Connect? [C, S, L]
10. **Brainstorm audio:** import files only, or also record voice clips in the app? [Both]
11. **Starting component:** when a project opens, restore your last layout or always open one specific component? [Restore last layout]
12. **Export:** which exports matter most? (Wiki to website/Markdown, map to PNG, lists to spreadsheet/CSV, whole project to PDF) [Markdown, PNG, CSV in v1]
13. **Anything missing** from the component list you want in v1 (e.g. Quest List, Dialogue Editor, Skill Tree)?