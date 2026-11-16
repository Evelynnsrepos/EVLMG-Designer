# Shared rich text editor (W1)

TipTap editor used by the Writer (8.6) and the Wiki (8.2, WK-4, WK-6). Import everything from `@/shared/richtext`.

## Use it

```tsx
import { emptyRichText, RichTextEditor, type RichTextDoc } from '@/shared/richtext'

const doc = useDocument<{ body: RichTextDoc }>('writer', documentId!, () => ({ body: emptyRichText() }))
if (!doc.data) return null
return <RichTextEditor value={doc.data.body} onChange={(body) => doc.update((d) => ({ ...d, body }), { undoable: false })} />
```

- **Undo/redo** lives inside the editor (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, toolbar buttons). Save with `{ undoable: false }`
  and do not bind your own Ctrl+Z on the editor. If `value` changes from outside, the editor shows the new value.
- **Toolbar**: normal text, H1 to H3, bold, italic, underline, bulleted and numbered lists, quote, image, `[[` link, find and replace (Ctrl+F), Fix my text, undo, redo.
  With `extraFormats` (Writer): crossed out, highlight, checklist, callout, remove formatting, and the insert menu
  (`inserts.tsx`: one list for the + button, the `/` menu and `InsertList`, each entry with the Markdown to type).
  Markdown shortcuts work too (`# `, `- `, `1. `, `> `, `**bold**`). Pass `toolbar={false}` for small fields, `editable={false}` to read only.
- **Stored format**: TipTap JSON. Prose is under `text` keys, so the project word counter counts it; links store only `kind` and `id`.

## `[[` links

Typing `[[` opens a search menu (arrows, Enter or Tab to pick, Esc to close; Esc does not toggle Layout Mode).
Typing a full `[[Exact Name]]` also becomes a link. Backspace right after a link turns it back into `[[Name` to pick again.
Links show the target's current name, so renames update everywhere; a deleted target shows a red "missing link".

By default links cover the project's entities, and clicking one opens its list. Add your own targets with a `RefProvider`:

```ts
const entities = useEntityRefProvider()
const articles: RefProvider = {
  search: (q) => rankRefItems(index.articles.map((a) => ({ kind: 'article', id: a.id, label: a.title, hint: 'Article' })), q),
  resolve: (t) => ...,                      // undefined when the article is gone
  open: (t) => selectArticle(t.id),
  create: async (title) => ({ kind: 'article', id: newArticle(title), label: title }), // adds "Create ..." to the menu
}
<RichTextEditor refs={combineRefProviders(articles, entities)} ... />
```

## Helpers (no DOM needed)

| Function | Use |
|---|---|
| `extractRefs(doc)` | every link target once: backlinks ("Mentioned in") and the connection map |
| `countRichTextWords(doc, resolve)` | live word count in the Writer header |
| `richTextToMarkdown(doc, resolve)` / `richTextToPlainText(doc, resolve)` | exports; links become `[[Name]]` / `Name` |
| `isRichTextEmpty(doc)`, `normalizeRichText(value)`, `emptyRichText()` | empty checks, safe loading of old or plain-string values |

`resolve` is `(target) => provider.resolve(target)?.label`.

## Images

`pickImage` returns `{ src, alt }`; on its own the editor asks for a path or URL.
To store images in the project (F2), use `useProjectImages(body)`: its picker copies the file into `assets/images/`
and its `resolveImageSrc` shows it. Mount the editor once `ready` is true (stored paths are resolved first).

```tsx
const images = useProjectImages(doc.data?.body)
if (!doc.data || !images.ready) return null
<RichTextEditor pickImage={images.pickImage} resolveImageSrc={images.resolveImageSrc} ... />
```

Missing or broken images show the pink/black placeholder.
