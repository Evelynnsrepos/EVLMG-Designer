import type { Editor } from '@tiptap/core'
import { Download, Highlighter, Info, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { saveTextFile } from '@/core/export'
import type { PanelProps } from '@/core/registry'
import { collabNames, useDocument, useProjectStore } from '@/core/state'
import { useHotwheel } from '@/shared/hotwheel'
import {
  combineRefProviders,
  findRefByLabel,
  countRichTextWords,
  RichTextEditor,
  useEntityRefProvider,
  useProjectImages,
  type LabelResolver,
  type RefProvider,
  type RichTextDoc,
} from '@/shared/richtext'
import { useArticleRefProvider } from '@/shared/wiki'
import { importTextFiles } from './importFiles'
import { createWriterDoc, EXPORT_FORMATS, exportDocument, type ExportFormat, type WriterDoc } from './document'
import './writer.css'

const UI = {
  titlePlaceholder: 'Untitled document',
  titleLabel: 'Document title',
  words: (n: number) => (n === 1 ? '1 word' : `${n.toLocaleString()} words`),
  export: 'Export',
  exportTitle: (f: string) => `Export as ${f}`,
  syntax: 'Markdown Syntax',
  syntaxTitle: 'Format by typing symbols (==highlight==, > [!note], - [ ], #tag, ^[footnote]…) and turn pasted Markdown into formatting. Only for this document.',
  import: 'Import',
  importTitle: 'Import Markdown files as new documents',
  callout: 'Insert callout',
  highlight: 'Highlight',
  missing: 'This document no longer exists.',
  loading: 'Loading…',
}

/** Regular Writer (spec 8.6): one rich text document per panel, live word count, Markdown and text export. */
export default function View({ documentId }: PanelProps) {
  const ref = useProjectStore((s) => s.meta?.documents.find((d) => d.id === documentId))
  const doc = useDocument<WriterDoc>('writer', documentId ?? 'missing', createWriterDoc)
  const images = useProjectImages(doc.data?.body)

  const articles = useArticleRefProvider()
  const entities = useEntityRefProvider()
  // Articles first, so a typed `[[Ironhold]]` prefers the Ironhold article over the town of the same name.
  const refs = useMemo(() => combineRefProviders(articles, entities), [articles, entities])
  const resolve = useMemo<LabelResolver>(() => (t) => refs.resolve(t)?.label, [refs])
  const [editor, setEditor] = useState<Editor | null>(null)
  const syntaxOn = !!doc.data?.markdownSyntax
  const toggleSyntax = () => doc.update((d) => ({ ...d, markdownSyntax: !d.markdownSyntax }))

  useHotwheel(() => [
    { id: 'writer-callout', label: UI.callout, icon: Info, run: () => editor?.chain().focus().wrapIn('callout').run() },
    { id: 'writer-highlight', label: UI.highlight, icon: Highlighter, run: () => editor?.chain().focus().toggleMark('highlight').run() },
    { id: 'writer-syntax', label: UI.syntax, on: syntaxOn, run: toggleSyntax },
  ])

  if (!documentId || !ref) return <div className="writer-empty">{UI.missing}</div>
  if (!doc.data || !images.ready) return <div className="writer-empty">{UI.loading}</div>

  const body = doc.data.body
  const setBody = (next: RichTextDoc) => doc.update((d) => ({ ...d, body: next }), { undoable: false })

  const runExport = async (format: ExportFormat) => {
    const out = exportDocument(ref.title, body, format, resolve)
    const f = EXPORT_FORMATS[format]
    await saveTextFile({
      title: UI.exportTitle(f.filterName),
      defaultName: out.name,
      text: out.text,
      filter: { name: f.filterName, extensions: [f.extension] },
    })
  }

  return (
    <div className="writer">
      <header className="writer-header">
        <TitleInput
          value={ref.title}
          onCommit={(title) => useProjectStore.getState().renameDocument(documentId, title.trim() || UI.titlePlaceholder)}
        />
        <WordCount body={body} resolve={resolve} />
        <label className="writer-syntax" title={UI.syntaxTitle}>
          <input type="checkbox" checked={syntaxOn} onChange={toggleSyntax} />
          {UI.syntax}
        </label>
        <ImportButton refs={refs} />
        <ExportMenu onExport={runExport} />
      </header>
      <div className="writer-page">
        <RichTextEditor
          key={documentId}
          value={body}
          onChange={setBody}
          liveTextName={collabNames.text(collabNames.document('writer', documentId), 'body')}
          refs={refs}
          pickImage={images.pickImage}
          importImages={images.importImages}
          resolveImageSrc={images.resolveImageSrc}
          onEditor={setEditor}
          extraFormats
          markdownSyntax={syntaxOn}
        />
      </div>
    </div>
  )
}

/**
 * Each Markdown file becomes a new Writer document with Markdown Syntax on. `[[Name]]` links to a
 * record or document with that name, including the other files of the same import.
 */
function ImportButton({ refs }: { refs: RefProvider }) {
  const input = useRef<HTMLInputElement>(null)
  const importFiles = (files: FileList) => importTextFiles([...files], (label) => findRefByLabel(refs, label))
  return (
    <>
      <button className="btn btn-ghost writer-export-btn" title={UI.importTitle} onClick={() => input.current?.click()}>
        <Upload size={14} /> {UI.import}
      </button>
      <input
        ref={input}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        multiple
        hidden
        onChange={(e) => e.target.files && void importFiles(e.target.files).finally(() => (e.target.value = ''))}
      />
    </>
  )
}

/** Title field: edits locally, renames the document (and its sidebar entry) on blur or Enter. */
function TitleInput({ value, onCommit }: { value: string; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    setPrev(value)
    setDraft(value)
  }
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <input
      className="writer-title"
      value={draft}
      placeholder={UI.titlePlaceholder}
      aria-label={UI.titleLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          e.preventDefault()
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/** Live word count; recounted a moment after typing stops so long documents stay smooth. */
function WordCount({ body, resolve }: { body: RichTextDoc; resolve: LabelResolver }) {
  const [count, setCount] = useState(() => countRichTextWords(body, resolve))
  useEffect(() => {
    const t = setTimeout(() => setCount(countRichTextWords(body, resolve)), 250)
    return () => clearTimeout(t)
  }, [body, resolve])
  return <span className="writer-words">{UI.words(count)}</span>
}

function ExportMenu({ onExport }: { onExport: (format: ExportFormat) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div
      className="writer-export"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault()
          setOpen(false)
        }
      }}
    >
      <button className="btn btn-ghost writer-export-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Download size={14} /> {UI.export}
      </button>
      {open && (
        <div className="writer-menu" role="menu">
          {(Object.keys(EXPORT_FORMATS) as ExportFormat[]).map((f) => (
            <button
              key={f}
              role="menuitem"
              className="writer-menu-item"
              onClick={() => {
                setOpen(false)
                void onExport(f)
              }}
            >
              {EXPORT_FORMATS[f].label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
