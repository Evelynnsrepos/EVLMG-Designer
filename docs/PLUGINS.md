# Plugins

Plugins add new tools to Eve.Lopment Games Designer. A plugin tool shows up in **Add tool** like a built-in one,
can have several documents, and its data is saved in the project like everything else.

Start from the example plugin, [**Dice Roller**](https://github.com/Evelynnsrepos/EVLMG-Designer-Example-Plugin). It is about 60 lines and needs no build step.

> **Plugins are programs.** A plugin runs inside the app with the same rights as the app: it can read, change and
> delete any file on the computer. Nobody reviews plugins. In shared (peer-to-peer) projects a plugin can change
> data in ways teammates don't expect, and teammates without the plugin can't open its tool.
> The app shows this warning before every install. Only install plugins you trust.

## Installing

**Settings → Plugins**:

- Paste a GitHub link (`https://github.com/name/repo`) and press **Install**. The app downloads the first `.zip`
  of the repo's latest release, or the default branch if there are no releases.
- **Install from zip…** for a local zip (handy while you build one).

Installing the same `id` again updates the plugin. **Remove** deletes the plugin but keeps what people made with it
in their projects; it comes back when the plugin is installed again.

Plugins live in the app data folder under `plugins/<id>/`.

**From a server (0.8).** A project on an Evelopment server can offer plugins its admin installed there. The app shows
"<server> offers plugins" with a **Review** button; each plugin goes through the same warning (with a note that the server's
admin chose it). Nothing installs by itself, and a plugin that changed on the server asks again.

## Files

```
plugin.json   required
index.js      required (or the file named in "main")
style.css     optional (named in "style")
```

`plugin.json`:

```json
{
  "id": "dice-roller",
  "name": "Dice Roller",
  "version": "1.0.0",
  "description": "Shown in Add tool.",
  "apiVersion": 1,
  "main": "index.js",
  "style": "style.css"
}
```

- `id`: lowercase letters, digits and dashes. It must never change; projects store data under it.
- `apiVersion`: must be `1`. If a future app changes the API, it raises this number and old plugins show a clear error
  instead of breaking.

## The module

`index.js` is **one ES module** (bundle it if you use several files or npm packages, and do not bundle React).
Its default export is called once when the app starts, with the plugin API, and returns the tool's `View`:

```js
export default function plugin(egd) {
  const h = egd.React.createElement
  function View({ documentId, active }) {
    const doc = egd.useDocument('plugin.my-id', documentId, () => ({ notes: [] }))
    if (!doc.data) return null
    return h('div', null, `${doc.data.notes.length} notes`)
  }
  return { View }
}
```

With a bundler (Vite, esbuild) you can write JSX: set the JSX factory to `egd.React.createElement` or pass React in,
and mark `react` as external.

### `View` props

| Prop | |
|---|---|
| `documentId` | The open document. Plugin tools always have several documents per project. |
| `active` | True when this panel has keyboard focus. Only handle single-key shortcuts while it is true. |
| `panel` | The panel record (id, type, documentId). |

### API (`egd`)

| Name | What it does |
|---|---|
| `apiVersion` | `1`. |
| `React` | The app's React. Use it; never load a second copy. |
| `useDocument(type, id, createDefault)` | Load and save a document. `type` is `plugin.<your id>`. Returns `{ data, update(fn, { undoable }), undo(), redo() }`. Saves after 1 s, writes are atomic, undo is per document. |
| `useProjectStore` | The project: `meta`, `entities.item` / `character` / `town` / `enemy`, `categories`, and actions like `addEntity`, `updateEntity`. Read-only use is safest. |
| `openComponent(type, documentId?)` | Open another tool next to this one. |
| `confirmDialog({ title, message, confirmLabel, danger })` | Yes/no dialog, resolves to a boolean. |
| `promptDialog(title, initial)` | Text prompt, resolves to a string or null. |
| `RichTextEditor` | The app's rich text editor with spell check and `[[` links: `h(egd.RichTextEditor, { value, onChange })`. |
| `newId()` | A new unique id. |
| `useHotwheel(() => actions)` | (0.18) Put your tool's actions on the Hotwheel's outer ring (hold Q). Call it in your `View`; see below. |
| `addHotwheelAction(action)` | (0.18) Add a program-wide action that people can put on the inner ring (Settings → Hotwheel). Returns a function that removes it. |
| `openHotwheel({ x, y }?)` | (0.18) Open the Hotwheel, e.g. from your own button. |

Only additions are made to API version 1; nothing is renamed or removed.

### Hotwheel actions (0.18)

The Hotwheel is the round menu that opens when people hold Q. Its outer ring belongs to the tool in focus.
Give it your tool's actions; the function is called each time the wheel opens, so the actions can use current state:

```js
function View({ documentId }) {
  const doc = egd.useDocument('plugin.dice-roller', documentId, () => ({ rolls: [] }))
  egd.useHotwheel(() => [
    { id: 'roll', label: 'Roll', run: () => roll() },
    { id: 'size', label: 'Dice', halves: [{ label: 'Fewer', run: () => fewer() }, { label: 'More', run: () => more() }] },
    { id: 'sound', label: 'Sound', on: soundOn, run: () => toggleSound() },
  ])
  // ...
}
```

An action is `{ id, label, run(shift), icon?, halves?, on? }`:

- `id`: stable; people's own ring layouts store it.
- `run(shift)`: what it does. `shift` is true when Shift was held.
- `halves`: two actions in one slice (left and right half), like Undo | Redo or smaller | bigger. Use it instead of `run`.
- `on`: shows the slice as switched on (a toggle or the current tool).
- `icon`: a lucide-style React component, or an SVG string.

The first ten actions are the default ring; people can choose others in your tool's keyboard button (Hotwheel).
A tool that doesn't call `useHotwheel` gets its visible buttons on the ring instead.

## Rules for a good plugin

- **Data**: keep documents plain JSON. Give every list item a unique string `id`; peer-to-peer merging relies on it.
  Store ids, not copies of names.
- **Style**: use the app's CSS variables (`--bg`, `--text`, `--accent`, `--border`, `--danger`, …) so light and dark
  themes work, and prefix your classes with your plugin id.
- **Keyboard**: Esc toggles Layout Mode. If your tool uses Esc, call `event.preventDefault()`.
- **Files**: don't touch files outside your own documents. Use `useDocument`, not your own file access.
