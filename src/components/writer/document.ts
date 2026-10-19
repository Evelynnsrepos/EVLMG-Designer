import { useSettings } from '@/core/state'
import { safeFileName } from '@/core/export'
import { normalizeRichText, richTextToMarkdown, richTextToPlainText, type LabelResolver, type RichTextDoc } from '@/shared/richtext'

/** A Writer document (spec 8.6), stored at `components/writer/<id>.json`. The title lives in the project's document list. */
export interface WriterDoc {
  body: RichTextDoc
  /** 0.19 "Markdown Syntax" switch for this document; missing (older documents) = off. */
  markdownSyntax?: boolean
}

export const createWriterDoc = (): WriterDoc => ({
  body: { type: 'doc', content: [{ type: 'paragraph' }] },
  markdownSyntax: useSettings.getState().writerMarkdownSyntax,
})

export type ExportFormat = 'markdown' | 'text'

export const EXPORT_FORMATS: Record<ExportFormat, { label: string; extension: string; filterName: string }> = {
  markdown: { label: 'Markdown (.md)', extension: 'md', filterName: 'Markdown' },
  text: { label: 'Plain text (.txt)', extension: 'txt', filterName: 'Text' },
}

/** File name and contents for an export. Markdown gets the title as a top heading unless the document starts with one. */
export function exportDocument(title: string, body: unknown, format: ExportFormat, resolve: LabelResolver) {
  const doc = normalizeRichText(body)
  const name = `${safeFileName(title, 'Untitled document')}.${EXPORT_FORMATS[format].extension}`
  if (format === 'text') return { name, text: richTextToPlainText(doc, resolve) }
  const md = richTextToMarkdown(doc, resolve)
  const startsWithHeading = doc.content?.[0]?.type === 'heading'
  return { name, text: startsWithHeading || !title.trim() ? md : `# ${title.trim()}\n\n${md}` }
}
