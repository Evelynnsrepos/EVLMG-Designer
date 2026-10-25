# AGENTS.md: how to work on Eve.Lopment Games Designer

This file is for coding agents (and humans) building the app. Read it fully before changing anything.
The product spec is [`docs/SPEC.md`](docs/SPEC.md); requirement IDs like `IT-2` or `ED-5` come from it.
Evelynn's original notes are in [`docs/original-notes.txt`](docs/original-notes.txt). Original intent wins over spec defaults.

## Stack

- **Tauri 2** desktop shell (Rust, `src-tauri/`), targets Windows, Linux and macOS (release installers built in CI by `.github/workflows/release.yml` on `v*` tags).
- **React 19 + TypeScript** (strict), built with **Vite**.
- **zustand** for state, **lucide-react** for icons, **vitest** for tests.
- Planned per spec: **Konva** for canvases, **TipTap** for rich text. Add them in the work package that first needs them.

## Commands

```bash
npm install          # once
npm run dev          # UI in a normal browser at http://localhost:5173 (localStorage-backed fake disk)
npm run tauri dev    # real desktop app (needs Rust; see README)
npm test             # vitest
npm run typecheck    # tsc
npm run lint         # oxlint
```

Before every commit: `npm run typecheck && npm run lint && npm test` must pass.

## Layout and ownership

```
src/
  core/                 SHARED FOUNDATION: change only in a dedicated, small commit (see "Shared files")
    model/              data types: entities, categories, project meta, layout, component type list
    fs/                 FileSystem interface + Tauri, browser and in-memory implementations
    project/            project folder IO, recent projects, word/image stats, schema versioning
    state/              zustand stores: projectStore (meta, entities, categories), documentStore (useDocument),
                        appStore (screen, layout mode, active panel), autosave, undo History
    registry.ts         ComponentManifest + automatic discovery of src/components/*/manifest.ts
  shell/                app chrome: launcher, new project wizard, sidebar, tiling workspace, theme
  shared/               reusable UI: Modal, PlaceholderImage, dialogs (confirmDialog/promptDialog), ComingSoon
  components/<type>/    ONE FOLDER PER FEATURE TOOL. A feature agent owns its folder exclusively.
    manifest.ts         name, icon, spec section, multiDocument, lazy View
    View.tsx            the component's root view (currently a placeholder)
    ...                 anything else the feature needs, kept inside this folder
docs/                   spec and original notes
src-tauri/              Rust shell, Tauri config, capabilities (fs, dialog, opener plugins)
```

### Rules that keep parallel work conflict-free

1. **Stay inside your folder.** A feature agent edits only `src/components/<its type>/` (plus its own tests there).
   The registry discovers manifests automatically, so you never edit a central list.
2. **Shared files are owned by the foundation.** `src/core/**`, `src/shell/**`, `src/shared/**`, `src/index.css`,
   `package.json`, `src-tauri/**`. If you need a change there:
   - Keep it additive (new optional field, new helper, new export). Never rename or change existing signatures.
   - Put it in its own small commit with a message starting `core:`, `shell:` or `shared:` so it is easy to review and rebase.
   - If two components need the same new helper, add it to `src/shared/` (UI) or `src/core/` (data), not to one component that the other imports.
3. **Never import from another component's folder.** Talk to other components only through `core` (entities, categories, documents) or `shell/editor/actions.ts` (e.g. `openComponent`).
4. **New dependencies** go in their own commit (`deps: add konva`). Do not upgrade unrelated packages.
5. **Canvas engine** (work package C1) lives in `src/shared/canvas/`. Canvas components must wait for it or coordinate with its owner.

## How a component works

```tsx
// src/components/timeline/View.tsx
import { useDocument } from '@/core/state'
import type { PanelProps } from '@/core/registry'

interface TimelineDoc { startYear: number | null; endYear: number | null; lines: Line[] }
const createDefault = (): TimelineDoc => ({ startYear: null, endYear: null, lines: [] })

export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument('timeline', documentId!, createDefault)
  if (!doc.data) return null                      // loading
  // change data: doc.update(d => ({ ...d, startYear: 100 }))   -> auto-saves after 1 s, undoable
  // drags in progress: doc.update(fn, { undoable: false }), then one undoable update on release
  // undo/redo: doc.undo(), doc.redo()  (bind Ctrl+Z / Ctrl+Y when `active`)
}
```

- **Multi-document components** (`multiDocument: true`) receive a `documentId`; the sidebar lists their documents.
  Data lives at `components/<type>/<documentId>.json`.
- **Single-document components** get `documentId === null`.
  - Entity lists (Item, Character, Town, Enemy) read and write entities through `useProjectStore`:
    `entities.item`, `addEntity('item')`, `updateEntity('item', id, patch)`, `removeEntity`, `categories`, `setCategories`.
  - The Wiki stores each article as its own document: `useDocument('wiki', articleId, ...)` → `components/wiki/<articleId>.json`.
    Keep an index document `useDocument('wiki', 'index', ...)` for the article list.
    (This deviates slightly from the spec's `wiki/articles/` folder; it is a [Default] and keeps one storage path.)
  - Calculators are multi-document; presets live at `components/<calculator type>/<id>.json`.
- **Document ids are UUIDs** (`newId()` from `@/core/model`). Only fixed well-known ids like `'index'` may be words.

### Data rules

- Every file is wrapped as `{ schemaVersion, data }` by `core/project/versioned.ts`. If you change a stored shape after it has shipped,
  bump `SCHEMA_VERSION` and add a migration in `versioned.ts` (core commit).
- Reference other records **by id only**, never copy their names (spec 3.3).
- **Word counting** (launcher PM-3) walks every string in your documents, except keys matching
  `id`, `*Id`, `*Ids`, `type`, `kind`, `tool`, `image`, `src`, `path`, `asset`, `color`, `*Color`, `mode`, `url`, `href`, `icon`, `createdAt`, `updatedAt`.
  Store non-prose strings under such keys so they are not counted. HTML tags are stripped.
- **Assets**: copy imported images into `assets/images/` and audio into `assets/audio/`, named `<uuid>.<ext>`, and store the relative path.
  (A shared asset helper is work package F2.)
- Never build paths with `/` or `\`. Use `getFs().join(...)` and the helpers in `core/project/paths.ts`.
- Never write files directly; use `writeVersioned`, `writeDocument`, or the stores. Writes are atomic (temp file + rename).

### Collaboration (shared projects)

Projects can be shared and edited live by several people (`src/core/collab/`, see [`docs/COLLABORATION.md`](docs/COLLABORATION.md)).
Components get this for free as long as they follow the data rules above and:
- Give every list item a unique string `id`. Lists with ids merge per item; other arrays are replaced whole.
- Change data only through the stores (`useDocument`, `useProjectStore`), never by writing files.
- Use `RichTextEditor` with `liveTextName={collabNames.text(collabNames.document(type, id), field)}` for prose, so teammates can type in it together.
- Canvas tools get teammates' pointers and selections from `CanvasEditor` automatically.
- Do not create documents with fixed ids on load unless needed (two offline teammates may both create one).

### UI rules (spec 10)

- Use the CSS variables in `src/index.css` (`--bg`, `--text`, `--accent`, ...). No hard-coded colors except user content colors.
  Both themes must work; dark is the default.
- Prefix CSS classes with your component type (`.timeline-toolbar`) and put the CSS file in your folder.
- Missing images use `<PlaceholderImage>` or `var(--placeholder)` (pink/black checkerboard).
- Canvas tools use a **bottom toolbar**, single-letter shortcuts, pan with middle mouse or space+drag, zoom with the wheel.
- **Keyboard**: only handle shortcuts when `active` is true. Attach handlers to your own root element, not `window`, unless guarded by `active`.
- **Esc**: the shell toggles Layout Mode on Esc. If your tool uses Esc (cancel a half-drawn shape, close a popup), call
  `event.preventDefault()` in your keydown handler and the shell will ignore it (ED-7).
- Confirmations and text prompts: `await confirmDialog({...})`, `await promptDialog(title, initial)` from `@/shared/dialogs`.
- Text visible to users is English but kept in plain string constants so it can be translated later.

### Releases

Every release gets `docs/releases/v<version>.md` (what's new, in plain words). The release workflow puts it on the
GitHub Releases page. Update the README feature list and the in-app user guide (`src/shell/help/guide.ts`) in the same release.

### Commits

- Small, focused commits, imperative subject (`Add drop table editor to Enemy List`), reference requirement IDs in the body.
- End commit messages with the co-author line your harness requires.
- Do not push or open pull requests unless asked.

## Work packages ready for parallel building

Each package is one agent. "Depends on" means wait for (or coordinate with) that package.

| ID | Package | Owns | Spec | Depends on |
|---|---|---|---|---|
| F1 | Rolling backups (last 10 saves), Ctrl+Z/Y wiring helper, crash-safe flush on window close in Tauri | `src/core/state`, `src-tauri` | 3.5, 11 | none |
| F2 | Asset import helper (pick/drop/paste image or audio → `assets/`, returns path; image URL resolver for Tauri `convertFileSrc`) | `src/core/assets/`, `src/shared/` | 2.1, MB-7 | none |
| F3 | Entity reference index ("where is this used?" before delete) | `src/core/references/` | 3.3 | none |
| E1 | Item List + category editor UI (shared by all lists, put category editor in `src/shared/categories/`) | `src/components/item-list`, `src/shared/categories` | 8.4, 3.4 | F2 nice to have |
| E2 | Character List | `src/components/character-list` | 8.11 | E1's category editor |
| E3 | Town List | `src/components/town-list` | 8.12 | E1's category editor |
| E4 | Enemy List (stats, growth, drop table, found in) | `src/components/enemy-list` | 8.13 | E1's category editor |
| W1 | Rich text editor (TipTap) with `[[` links, in `src/shared/richtext/` | `src/shared/richtext` | 8.6, WK-4 | none |
| W2 | Regular Writer (docs, word count, Markdown/text export) | `src/components/writer` | 8.6 | W1 |
| W3 | Wiki (articles, pull from entity, info box, backlinks, connection map) | `src/components/wiki` | 8.2 | W1 |
| C1 | Shared canvas engine (Konva): pan/zoom, select, move, delete, undo, bottom toolbar, layers model | `src/shared/canvas` | 10.2, 12.5 | none |
| C2 | Story Branch Writer | `src/components/story-writer` | 8.5 | C1 |
| C3 | Timeline Creator | `src/components/timeline` | 8.1 | C1 |
| C4 | Brainstorm Board | `src/components/brainstorm` | 8.8 | C1, F2 |
| C5 | Moodboard (cutouts, layers panel, always-on-top) | `src/components/moodboard` | 8.7 | C1, F2 |
| C6 | Map Creator (cities = towns, stamps, PNG export) | `src/components/map` | 8.10 | C1 |
| K1 | Formula engine (safe expression parser) + formula library, in `src/shared/formulas/` | `src/shared/formulas` | CA-1..CA-6 | none |
| K2 | Damage Calculator | `src/components/damage-calculator` | 8.3 | K1 |
| K3 | Level Calculator | `src/components/level-calculator` | 8.3 LV | K1, K2 presets |
| K4 | Resource Calculator | `src/components/resource-calculator` | 8.9 | K3, E4 |
| R1 | Release: app icons, GitHub Actions (test on Windows+Linux, build msi/nsis/AppImage/deb), README screenshots | `.github/`, `src-tauri/icons` | 2, 11 | none |

Packages with no dependency (F1, F2, F3, E1, W1, C1, K1, R1) can start at the same time.
