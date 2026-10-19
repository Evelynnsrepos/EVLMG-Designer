/**
 * Shared rich text editor (work package W1, spec 8.6, WK-4, WK-6). See README.md in this folder.
 *
 *   const doc = useDocument('writer', documentId!, () => ({ body: emptyRichText() }))
 *   <RichTextEditor value={doc.data.body} onChange={(body) => doc.update((d) => ({ ...d, body }), { undoable: false })} />
 */
export { RichTextEditor, type RichTextEditorProps } from './RichTextEditor'
export {
  countRichTextWords,
  emptyRichText,
  extractRefs,
  isRichTextEmpty,
  MISSING_REF_LABEL,
  normalizeRichText,
  richTextToHtml,
  richTextToMarkdown,
  escapeHtml,
  richTextToPlainText,
  type LabelResolver,
} from './doc'
export { combineRefProviders, DOC_KIND, findRefByLabel, rankRefItems, useEntityRefProvider } from './refs'
export type { ImagePicker, RefItem, RefProvider, RefTarget, RichTextDoc } from './types'
export { projectImagePaths, useProjectImages, type ProjectImages } from './projectImages'
export { markdownToRichText, type FindRef } from './markdown'
