import { ENTITY_TYPES, type Id } from '@/core/model'
import { loadDocumentNow, updateDocument, useProjectStore } from '@/core/state'
import { DOC_KIND, markdownToRichText, normalizeRichText, type FindRef } from '@/shared/richtext'
import { createWriterDoc, type WriterDoc } from './document'

export const IMPORTABLE = /\.(md|markdown|txt)$/i

/**
 * Each file becomes a new Writer document: Markdown files with the Markdown Syntax switch on, text files as
 * plain lines. `[[Name]]` links to a record or document with that name, including the other files of the
 * same import. Returns the new document ids.
 */
/** Exact-name match against the project's documents and entries, for imports outside the Writer. */
const projectFindRef: FindRef = (label) => {
  const { meta, entities } = useProjectStore.getState()
  const name = label.toLowerCase()
  const doc = meta?.documents.find((d) => d.title.toLowerCase() === name)
  if (doc) return { kind: DOC_KIND, id: doc.id }
  for (const kind of ENTITY_TYPES) {
    const hit = entities[kind].find((e) => e.name.toLowerCase() === name)
    if (hit) return { kind, id: hit.id }
  }
}

export async function importTextFiles(files: File[], findRef: FindRef = projectFindRef): Promise<Id[]> {
  const { root, addDocument, enableComponent } = useProjectStore.getState()
  if (!root || !files.length) return []
  enableComponent('writer')
  const made = files.map((f) => addDocument('writer', f.name.replace(IMPORTABLE, '') || 'Untitled'))
  const byTitle = new Map(made.map((d) => [d.title.toLowerCase(), { kind: DOC_KIND, id: d.id }]))
  const find: FindRef = (label) => findRef(label) ?? byTitle.get(label.toLowerCase())
  for (const [i, file] of files.entries()) {
    const text = await file.text()
    const markdown = !/\.txt$/i.test(file.name)
    const body = markdown ? markdownToRichText(text, find) : normalizeRichText(text)
    await loadDocumentNow(root, 'writer', made[i].id, createWriterDoc)
    updateDocument<WriterDoc>(root, 'writer', made[i].id, () => ({ body, markdownSyntax: markdown }), { undoable: false })
  }
  return made.map((d) => d.id)
}
