# Project file format

What is inside an EVLMG Designer project folder, for programmers who want to read or write it with their own tools, and for anyone changing the app. The TypeScript types named below are the source of truth; this page says where they are and which rules keep old files, shared projects and the mobile app working.

## Folder layout

| Path | What it holds | Type |
| --- | --- | --- |
| `project.json` | Name, enabled tools, the list of documents, sidebar, theme, jumps | `ProjectMeta` in [`core/model/project.ts`](../src/core/model/project.ts) |
| `entities/items.json`, `characters.json`, `towns.json`, `enemies.json` | The four entry lists | `Item`, `Character`, `Town`, `Enemy` in [`core/model/entities.ts`](../src/core/model/entities.ts) |
| `entities/categories.json` | Custom categories shared by the entry lists | `Category` in the same file |
| `components/<tool>/<document id>.json` | One document of a tool | see the table below |
| `assets/images/<uuid>.<ext>`, `assets/audio/<uuid>.<ext>` | Pictures and sounds, referenced by that path from any document | `AssetPath` |
| `collab/state.bin` | Shared projects only: the Yjs state ([COLLABORATION.md](COLLABORATION.md)) | |
| `.backups/` | Automatic backups | |

Every JSON file is wrapped as `{ "schemaVersion": 1, "data": … }` (`Versioned<T>`). Read `data`; refuse a `schemaVersion` higher than the one you know.

## Documents

A tool with **many** documents lists each one in `project.json` → `documents` (`{ id, type, title }`) and stores it at `components/<tool>/<id>.json`. A tool with **one** document stores it at `components/<tool>/<tool>.json`, with these exceptions: Asset Pool uses `pool`, the Wiki keeps `index` plus one file per article, the quest and dialogue flags live at `components/quests/flags.json`, and the four entry lists (Item, Character, Town, Enemy List) keep their data in `entities/`, not in `components/`.

Ids are random strings (`newId()` in [`core/model/ids.ts`](../src/core/model/ids.ts)) and never change, also when something is renamed. Link to things by id, never by name.

| Tool | Type | Documents | Shape defined in |
| --- | --- | --- | --- |
| Timeline | `timeline` | many | [`components/timeline/model.ts`](../src/components/timeline/model.ts) |
| Wiki | `wiki` | one | [`components/wiki/model.ts`](../src/components/wiki/model.ts) |
| Damage Calculator | `damage-calculator` | many | [`components/damage-calculator/logic.ts`](../src/components/damage-calculator/logic.ts) |
| Item List | `item-list` | one | [`components/item-list/View.tsx`](../src/components/item-list/View.tsx) |
| Story Branch Writer | `story-writer` | many | [`components/story-writer/model.ts`](../src/components/story-writer/model.ts) |
| Writer | `writer` | many | [`components/writer/View.tsx`](../src/components/writer/View.tsx) |
| Moodboard | `moodboard` | many | [`components/moodboard/View.tsx`](../src/components/moodboard/View.tsx) |
| Brainstorm Board | `brainstorm` | many | [`components/brainstorm/model.ts`](../src/components/brainstorm/model.ts) |
| Level Calculator | `level-calculator` | many | [`components/level-calculator/View.tsx`](../src/components/level-calculator/View.tsx) |
| Resource Calculator | `resource-calculator` | many | [`components/resource-calculator/logic.ts`](../src/components/resource-calculator/logic.ts) |
| Map Creator | `map` | many | [`components/map/model.ts`](../src/components/map/model.ts) |
| Character List | `character-list` | one | [`components/character-list/View.tsx`](../src/components/character-list/View.tsx) |
| Town List | `town-list` | one | [`components/town-list/View.tsx`](../src/components/town-list/View.tsx) |
| Enemy List | `enemy-list` | one | [`components/enemy-list/View.tsx`](../src/components/enemy-list/View.tsx) |
| Cosmos Creator | `cosmos` | many | [`components/cosmos/model.ts`](../src/components/cosmos/model.ts) |
| Draw | `sketch` | many | [`components/sketch/View.tsx`](../src/components/sketch/View.tsx) |
| Design Language | `design-language` | many | [`components/design-language/View.tsx`](../src/components/design-language/View.tsx) |
| Asset Pool | `asset-pool` | one | [`components/asset-pool/model.ts`](../src/components/asset-pool/model.ts) |
| Wave Planner | `wave-planner` | many | [`components/wave-planner/logic.ts`](../src/components/wave-planner/logic.ts) |
| Quest Designer | `quests` | one | [`components/quests/model.ts`](../src/components/quests/model.ts) |
| Dialogue Editor | `dialogue` | many | [`components/dialogue/model.ts`](../src/components/dialogue/model.ts) |
| Gacha & Loot Simulator | `gacha` | many | [`components/gacha/logic.ts`](../src/components/gacha/logic.ts) |
| Reviews | `reviews` | one | [`components/reviews/View.tsx`](../src/components/reviews/View.tsx) |
| Spreadsheet | `spreadsheet` | many | [`components/spreadsheet/model.ts`](../src/components/spreadsheet/model.ts) |
| Writing Principles | `principles` | one | [`components/principles/model.ts`](../src/components/principles/model.ts) |
| Gameplay Loop | `gameplay-loop` | many | [`components/gameplay-loop/model.ts`](../src/components/gameplay-loop/model.ts) |
| Skill Tree | `skill-tree` | many | [`components/skill-tree/model.ts`](../src/components/skill-tree/model.ts) |
| Abilities & Spells | `abilities` | one | [`components/abilities/model.ts`](../src/components/abilities/model.ts) |
| Crafting & Recipes | `crafting` | one | [`components/crafting/model.ts`](../src/components/crafting/model.ts) |
| Factions | `factions` | one | [`components/factions/model.ts`](../src/components/factions/model.ts) |
| Family Tree | `family-tree` | one | [`components/family-tree/model.ts`](../src/components/family-tree/model.ts) |
| Level Layout | `level-layout` | many | [`components/level-layout/model.ts`](../src/components/level-layout/model.ts) |
| Achievements | `achievements` | one | [`components/achievements/model.ts`](../src/components/achievements/model.ts) |
| Names & Languages | `names` | many | [`components/names/model.ts`](../src/components/names/model.ts) |
| Calendar & Eras | `calendar` | one | [`components/calendar/View.tsx`](../src/components/calendar/View.tsx) |
| Economy Simulator | `economy` | many | [`components/economy/model.ts`](../src/components/economy/model.ts) |
| Combat Simulator | `combat` | many | [`components/combat/model.ts`](../src/components/combat/model.ts) |
| Balance Dashboard | `balance` | one | [`components/balance/model.ts`](../src/components/balance/model.ts) |
| Vision & Pillars | `vision` | one | [`components/vision/View.tsx`](../src/components/vision/View.tsx) |
| Scope Planner | `scope` | one | [`components/scope/View.tsx`](../src/components/scope/View.tsx) |
| Task Board | `tasks` | one | [`components/tasks/View.tsx`](../src/components/tasks/View.tsx) |
| History | `history` | one | [`components/history/View.tsx`](../src/components/history/View.tsx) |
| Playtests | `playtests` | one | [`components/playtests/model.ts`](../src/components/playtests/model.ts) |
| Pacing Graph | `pacing` | many | [`components/pacing/model.ts`](../src/components/pacing/model.ts) |
| Pitch Deck | `pitch` | many | [`components/pitch/View.tsx`](../src/components/pitch/View.tsx) |
| Localization | `localization` | one | [`components/localization/model.ts`](../src/components/localization/model.ts) |
| Storyboard | `storyboard` | many | [`components/storyboard/View.tsx`](../src/components/storyboard/View.tsx) |
| UI Flow | `ui-flow` | many | [`components/ui-flow/View.tsx`](../src/components/ui-flow/View.tsx) |
| Ask Your Project | `ask` | one | [`components/ask/View.tsx`](../src/components/ask/View.tsx) |
| Texture Paint (experimental) | `texture-paint` | many | [`components/texture-paint/model.ts`](../src/components/texture-paint/model.ts) |
| Pixel Art | `pixel-art` | many | [`components/pixel-art/View.tsx`](../src/components/pixel-art/View.tsx); v0.29 shape layers: optional `layers[].vector` and `shapes` ("layerId:frameId" → `{ key, list }`, see [`shared/pixel/shapes.ts`](../src/shared/pixel/shapes.ts)); the cel PNG is always written too, so older versions show the pixels |
| Card Designer | `card-designer` | many | [`components/card-designer/model.ts`](../src/components/card-designer/model.ts) |
| Vector (experimental) | `vector` | many | [`components/vector/model.ts`](../src/components/vector/model.ts) |
| Custom List | `custom-list` | many | [`components/custom-list/model.ts`](../src/components/custom-list/model.ts) |

Plugin tools use the type `plugin.<plugin id>` and store their documents the same way ([PLUGINS.md](PLUGINS.md)).

## Rules for changing the format

1. **Add, don't change.** New fields are optional (`field?: …`) and the code works when they are missing. Old files, teammates on an older version and the mobile app (which reuses this code at a pinned version) must keep opening the project.
2. **Never rename or remove a field** without bumping `SCHEMA_VERSION` in [`core/model/project.ts`](../src/core/model/project.ts) and adding a migration in `migrate()` in [`core/project/versioned.ts`](../src/core/project/versioned.ts). Note the change in the mobile repository's docs too.
3. **Ids stay ids.** Translations, links, jumps, engine exports and shared editing all match by id.
4. **New tools** add their type to `COMPONENT_TYPES` in [`core/model/components.ts`](../src/core/model/components.ts), get a folder in `src/components/`, and a guide entry in `shell/help/guide.ts` (TypeScript reminds you).

## Reading a project from a script

`npm run export -- <project folder> <godot|unity|unreal|json> <output folder>` writes the engine export without opening the app ([`scripts/egd-export.ts`](../scripts/egd-export.ts)). It is also a small example of reading the files: unwrap `data`, read `project.json` for the document list, then each `components/<tool>/<id>.json`.
