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

/** 0.28: starting points for studio specs; headings plus the questions each part should answer. */
export const SPEC_TEMPLATES: { id: string; label: string; html: string }[] = [
  {
    id: 'feature',
    label: 'Feature spec',
    html: '<h1>Feature name</h1><h2>Goal</h2><p>What should the player feel or be able to do? Which pillar does it serve?</p><h2>How it works</h2><p>Step by step, from the player’s side.</p><h2>Rules and numbers</h2><p>Link entries with [[Name]] so names stay up to date.</p><h2>Edge cases</h2><ul><li><p>What if the player…</p></li></ul><h2>Art, sound and UI needs</h2><ul><li><p></p></li></ul><h2>Done when</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Testable result</p></li></ul><h2>Open questions</h2><p></p>',
  },
  {
    id: 'level',
    label: 'Level brief',
    html: '<h1>Level name</h1><h2>Purpose</h2><p>What does this level teach or test? Where is it in the pacing?</p><h2>Player arrives with</h2><p>Abilities, items, story knowledge.</p><h2>Beats</h2><ol><li><p>Opening</p></li><li><p>Challenge</p></li><li><p>Twist</p></li><li><p>Climax and reward</p></li></ol><h2>Enemies and encounters</h2><p></p><h2>Secrets and rewards</h2><p></p><h2>Mood and references</h2><p></p>',
  },
  {
    id: 'onepager',
    label: 'One-page game overview',
    html: '<h1>Game title</h1><p><strong>Genre:</strong> · <strong>Platforms:</strong> · <strong>Players:</strong> · <strong>Target audience:</strong></p><h2>Pitch</h2><p>One or two sentences.</p><h2>Core loop</h2><p></p><h2>What makes it special</h2><ul><li><p></p></li></ul><h2>Comparable games</h2><p></p><h2>Scope and team</h2><p></p>',
  },
  {
    id: 'postmortem',
    label: 'Postmortem',
    html: '<h1>Postmortem: project or milestone</h1><h2>What we set out to do</h2><p></p><h2>What went well</h2><ul><li><p></p></li></ul><h2>What went wrong</h2><ul><li><p></p></li></ul><h2>What we change next time</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>',
  },
]
