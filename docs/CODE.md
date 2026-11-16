# Code Studio (experimental)

How Code Studio (`src/components/code/`, Rust side `src-tauri/src/code.rs`) is put together. The plan with all
later steps is `plans/code-editor-plan.md` in the project's shared folder.

## What is where

| File | What |
|---|---|
| `model.ts` | The workspace document (`CodeDoc`), this computer's settings (`localStorage` key `egd-code`: Godot path, Combo mode, game folder per workspace), file URIs, links in engine output |
| `editor.ts` | CodeMirror 6 setup: theme on the app's CSS variables, colours, the design-data helpers |
| `gdscript.ts` | Our own small GDScript grammar (colours and indenting only) |
| `godot.ts` | Link to Godot: find it, start it, language server client |
| `designData.ts` | Ids from the engine export (`Egd.find`, `Egd.tool`, `tr`): completion, checks, hover, jump |
| `combo.ts` | Combo mode (typing effect), written from scratch |
| `View.tsx` | The tool: folder tree, tabs, one editor that swaps file states, output console |

## Rules

- **Code is never copied into the project.** The document only stores the folder and the open tabs.
- **Undo:** every file has its own undo history (CodeMirror), kept while its tab is open. A file reloaded from disk
  is an ordinary change, so Ctrl+Z brings the old text back.
- **Saving:** Ctrl+S, when the window loses focus, when a tab closes and before the game runs. Not on a timer, so
  a running game does not reload half-typed code.
- **Starting programs:** `code.rs` only starts a program whose file name contains "godot", and the path comes from
  this computer's settings, never from a project file. A shared project cannot make a computer run something.
  The language server connection only goes to 127.0.0.1.
- **Hover text** from the language server is cleaned (`sanitizeHtml`) before it is shown.
- **No AI.** Completion comes from Godot's language server and the project's own data.

## Godot

- Language server: Godot's editor listens on port 6005 when it is open. Otherwise the tool starts
  `godot --headless --editor --lsp-port 6008 --path <game>` and connects to that.
- Run: `godot --path <game> [res://scene.tscn]`; output lines are streamed to the console.

## Mobile app

New tool type `code` and document `CodeDoc`: all fields are plain and optional for readers, so projects keep
opening both ways. Phones and tablets have no Godot: `canRun()` is false there, so the tool is an editor only
(no language server, no Run). After the desktop release, bump the mobile submodule and add a `code` document to
the compat fixture.

## Not built yet

Find in files, search everywhere, minimap, split view, new/rename/delete file, the external-editor flag
(`--code file:line`), offline docs, scene and `res://` awareness, `[[links]]` and TODO → Tasks, debugger, git
marks, snippets, other engines.
