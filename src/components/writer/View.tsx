import type { Editor } from '@tiptap/core'
import { CircleHelp, Copy, Download, FileCode2, FileText, GitCompareArrows, Highlighter, Info, ListTree, MessagesSquare, PanelsTopLeft, Sheet, Upload } from 'lucide-react'
import { useEditorState } from '@tiptap/react'
import { newDocument } from '@/shell/editor/actions'
import { listRemarks } from '@/shared/richtext/review'
import { ReviewPanel } from './ReviewPanel'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { saveBinaryFile, saveTextFile } from '@/core/export'
import { loadDocxImages, richTextToDocx } from './docx'
import { printHtml } from '@/shared/print'
import type { PanelProps } from '@/core/registry'
import { collabNames, useDocument, useProjectStore, useSettings } from '@/core/state'
import { useHotwheel } from '@/shared/hotwheel'
import {
  combineRefProviders,
  findRefByLabel,
  countRichTextWords,
  InsertList,
  markdownToRichText,
  richTextToPlainText,
  RichTextEditor,
  useEntityRefProvider,
  useProjectImages,
  type LabelResolver,
  type RefProvider,
  type RichTextDoc,
} from '@/shared/richtext'
import { ToolButton, type RibbonTab } from '@/shared/richtext/ribbon'
import { ProofTextarea } from '@/shared/spell'
import { useArticleRefProvider } from '@/shared/wiki'
import { importTextFiles } from './importFiles'
import { createWriterDoc, EXPORT_FORMATS, SPEC_TEMPLATES, TRACK_CHANGES_DEFAULT, exportDocument, printPage, type ExportFormat, type WriterDoc, type WriterPage } from './document'
import './writer.css'

const UI = {
  titlePlaceholder: 'Untitled document',
  titleLabel: 'Document title',
  words: (n: number) => (n === 1 ? '1 word' : `${n.toLocaleString()} words`),
  minutes: (n: number) => `${n} min read`,
  stats: (chars: number) => `${chars.toLocaleString()} characters. Reading time at 200 words a minute.`,
  outline: 'Outline',
  outlineTitle: 'Outline: your headings, click one to jump there',
  outlineEmpty: 'No headings yet. Headings you add show up here, so you can jump around a long text.',
  help: 'Markdown help',
  helpTitle: 'Markdown help: everything you can insert, and what to type for it',
  helpOn: 'Click a row to insert it, or type what is shown on the right.',
  helpOff: 'Click a row to insert it. The greyed-out ones can only be typed with the Markdown Syntax switch on.',
  view: 'View',
  markdown: 'Markdown',
  paper: 'Page look: the text on a sheet of paper',
  source: 'Edit as Markdown: the whole text as plain Markdown. Fonts, colours and alignment are not kept when you change it there.',
  sourceDone: 'Back to normal view',
  sourceNote: 'Editing the Markdown. Fonts, colours and alignment come back plain if you change text here.',
  html: 'Web page (.html): opens in other word processors and browsers',
  size: 'Text size',
  spacing: 'Line spacing',
  width: 'Page width',
  copy: 'Copy as Markdown',
  copied: 'Copied',
  export: 'Export',
  pdf: 'PDF (print dialog)…',
  htmlLabel: 'Web page (.html)',
  docx: 'Document (.docx): opens in other word processors, with headers, page numbers and tables',
  docxLabel: 'Document (.docx)',
  exportTitle: (f: string) => `Export as ${f}`,
  syntax: 'Markdown Syntax',
  syntaxTitle: 'Format by typing symbols (==highlight==, > [!note], - [ ], #tag, ^[footnote]…) and turn pasted Markdown into formatting. Only for this document.',
  import: 'Import',
  importTitle: 'Import Markdown files as new documents',
  callout: 'Insert callout',
  highlight: 'Highlight',
  review: 'Comments and changes',
  reviewTitle: 'Comments and tracked changes, on the side',
  track: 'Track changes',
  trackTitle: 'While on, what you type shows as added and what you delete stays crossed out, until you accept or reject it. Only for this document.',
  headerFooter: 'Header & footer',
  headerFooterTitle: 'Text at the top and bottom of every printed page, and page numbers',
  header: 'Header (top of every page)',
  footer: 'Footer (bottom of every page)',
  numbers: 'Page numbers',
  spreadsheet: 'Lots of numbers or sums? A spreadsheet calculates them for you. Opens a new Spreadsheet next to this.',
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
  const view = useSettings((s) => s.writerView)
  const setView = (patch: Partial<typeof view>) => useSettings.getState().update({ writerView: { ...view, ...patch } })
  const side = (which: 'outline' | 'help' | 'review') => setView({ side: view.side === which ? '' : which })
  // A new comment waits for its text on the side, so open the side panel for it.
  const newRemark = useEditorState({ editor, selector: ({ editor: e }) => !!e && listRemarks(e.state.doc).some((r) => !r.attrs.text) })
  useEffect(() => {
    if (newRemark && view.side !== 'review') setView({ side: 'review' })
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [newRemark])
  const toggleSyntax = () => doc.update((d) => ({ ...d, markdownSyntax: !d.markdownSyntax }))
  /** The Markdown being edited in "Edit as Markdown", or null in the normal view. */
  const [source, setSource] = useState<{ start: string; text: string } | null>(null)

  useHotwheel(() => [
    { id: 'writer-callout', label: UI.callout, icon: Info, run: () => editor?.chain().focus().wrapIn('callout').run() },
    { id: 'writer-highlight', label: UI.highlight, icon: Highlighter, run: () => editor?.chain().focus().toggleMark('highlight').run() },
    { id: 'writer-syntax', label: UI.syntax, on: syntaxOn, run: toggleSyntax },
  ])

  if (!documentId || !ref) return <div className="writer-empty">{UI.missing}</div>
  if (!doc.data || !images.ready) return <div className="writer-empty">{UI.loading}</div>

  const body = doc.data.body
  const setBody = (next: RichTextDoc) => doc.update((d) => ({ ...d, body: next }), { undoable: false })

  const track = doc.data.trackChanges ?? TRACK_CHANGES_DEFAULT
  const page: WriterPage = doc.data.page ?? {}
  const setPage = (patch: Partial<WriterPage>) => doc.update((d) => ({ ...d, page: { ...d.page, ...patch } }))
  const ribbonExtras = {
    insert: <PageSetup page={page} setPage={setPage} />,
    review: (
      <>
        <label className="writer-syntax" title={UI.trackTitle}>
          <input type="checkbox" checked={track} onChange={() => doc.update((d) => ({ ...d, trackChanges: !track }))} />
          <GitCompareArrows size={15} /> {UI.track}
        </label>
        <ToolButton icon={MessagesSquare} label={UI.reviewTitle} run={() => side('review')} active={view.side === 'review'} text="Show comments" />
      </>
    ),
    table: <ToolButton icon={Sheet} label={UI.spreadsheet} run={() => newDocument('spreadsheet')} text="Spreadsheet" />,
  }
  const markdown = () => exportDocument('', body, 'markdown', resolve).text
  const closeSource = () => {
    // Untouched Markdown leaves the text as it was, formatting and all.
    if (source && editor && source.text !== source.start) editor.commands.setContent(markdownToRichText(source.text, (label) => findRefByLabel(refs, label)), { emitUpdate: true })
    setSource(null)
  }
  const ribbonTabs: RibbonTab[] = [
    {
      id: 'view',
      label: UI.view,
      content: (
        <>
          <ToolButton icon={ListTree} label={UI.outlineTitle} run={() => side('outline')} active={view.side === 'outline'} text={UI.outline} />
          <ToolButton icon={FileText} label={UI.paper} run={() => setView({ paper: !view.paper })} active={!!view.paper} text="Page" />
          <span className="richtext-toolbar-sep" />
          <ViewRows view={view} setView={setView} />
        </>
      ),
    },
    {
      id: 'markdown',
      label: UI.markdown,
      content: (
        <>
          <label className="writer-syntax" title={UI.syntaxTitle}>
            <input type="checkbox" checked={syntaxOn} onChange={toggleSyntax} />
            {UI.syntax}
          </label>
          <span className="richtext-toolbar-sep" />
          <ToolButton icon={CircleHelp} label={UI.helpTitle} run={() => side('help')} active={view.side === 'help'} text={UI.help} />
          <ToolButton icon={FileCode2} label={UI.source} run={() => (source ? closeSource() : setSource({ start: markdown(), text: markdown() }))} active={!!source} text="Edit as Markdown" />
          <ToolButton icon={Copy} label={UI.copy} run={() => void navigator.clipboard.writeText(exportDocument(ref.title, body, 'markdown', resolve).text)} text="Copy" />
        </>
      ),
    },
  ]

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
        {editor && editor.isEmpty && (
          <select className="input" style={{ width: 'auto' }} value="" aria-label="Start from a template" onChange={(e) => e.target.value && editor.commands.setContent(SPEC_TEMPLATES.find((t) => t.id === e.target.value)!.html, { emitUpdate: true })}>
            <option value="">Start from a template…</option>
            {SPEC_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        )}
        <ImportButton refs={refs} />
        <ExportMenu
          onExport={runExport}
          onPdf={() => editor && printHtml(printPage(ref.title, editor.view.dom.innerHTML, page))}
          onHtml={() =>
            editor &&
            void saveTextFile({ title: UI.html, defaultName: exportDocument(ref.title, body, 'text', resolve).name.replace(/\.txt$/, '.html'), text: printPage(ref.title, editor.view.dom.innerHTML, page), filter: { name: 'Web page', extensions: ['html'] } })
          }
          onDocx={async () => {
            const name = exportDocument(ref.title, body, 'text', resolve).name.replace(/\.txt$/, '.docx')
            const imgs = await loadDocxImages(body, images.resolveImageSrc ?? ((s) => s))
            await saveBinaryFile({ title: UI.docx, defaultName: name, bytes: richTextToDocx(ref.title, body, page, resolve, imgs), filter: { name: 'Document', extensions: ['docx'] } })
          }}
          onCopy={() => navigator.clipboard.writeText(exportDocument(ref.title, body, 'markdown', resolve).text)} />
      </header>
      <div className="writer-body">
      <div className={view.paper ? 'writer-page is-paper' : 'writer-page'} style={{ '--writer-header': JSON.stringify(page.header ?? ''), '--writer-footer': JSON.stringify(page.footer ?? ''),  '--writer-size': `${view.size}px`, '--writer-spacing': view.spacing, '--writer-width': view.width ? `${view.width}px` : 'none' } as CSSProperties}>
        {source && (
          <div className="writer-source">
            <p className="muted">
              {UI.sourceNote}{' '}
              <button className="btn" onClick={closeSource}>
                {UI.sourceDone}
              </button>
            </p>
            <ProofTextarea className="input writer-source-text" value={source.text} spellCheck={false} onChange={(e) => setSource({ ...source, text: e.target.value })} aria-label={UI.markdown} />
          </div>
        )}
        <RichTextEditor
          className={source ? 'is-hidden' : undefined}
          ribbonTabs={ribbonTabs}
          ribbonExtras={ribbonExtras}
          trackChanges={track}
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
      {view.side && editor && (
        <aside className="writer-side" aria-label={view.side === 'outline' ? UI.outline : view.side === 'review' ? UI.review : UI.help}>
          <h3>{view.side === 'outline' ? UI.outline : view.side === 'review' ? UI.review : UI.help}</h3>
          {view.side === 'review' ? (
            <ReviewPanel editor={editor} />
          ) : view.side === 'outline' ? (
            <Outline body={body} editor={editor} />
          ) : (
            <>
              <p className="muted">{syntaxOn ? UI.helpOn : UI.helpOff}</p>
              <InsertList editor={editor} syntax={syntaxOn} />
            </>
          )}
        </aside>
      )}
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

/** Live word count and reading time; recounted a moment after typing stops so long documents stay smooth. */
function WordCount({ body, resolve }: { body: RichTextDoc; resolve: LabelResolver }) {
  const stats = () => ({ words: countRichTextWords(body, resolve), chars: richTextToPlainText(body, resolve).length })
  const [count, setCount] = useState(stats)
  useEffect(() => {
    const t = setTimeout(() => setCount(stats()), 250)
    return () => clearTimeout(t)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [body, resolve])
  return (
    <span className="writer-words" title={UI.stats(count.chars)}>
      {UI.words(count.words)} · {UI.minutes(Math.max(1, Math.round(count.words / 200)))}
    </span>
  )
}

/** The top-level headings as a clickable list. */
function Outline({ body, editor }: { body: RichTextDoc; editor: Editor }) {
  const text = (n: RichTextDoc): string => n.text ?? (n.content ?? []).map(text).join('')
  const headings = (body.content ?? []).filter((n) => n.type === 'heading')
  const jump = (index: number) => {
    let i = -1
    editor.state.doc.forEach((node, pos) => {
      if (node.type.name === 'heading' && ++i === index) editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run()
    })
  }
  if (!headings.length) return <p className="muted">{UI.outlineEmpty}</p>
  return (
    <nav className="writer-outline">
      {headings.map((h, i) => (
        <button key={i} className="writer-outline-item" style={{ paddingLeft: 8 + 14 * (((h.attrs?.level as number) ?? 1) - 1) }} onClick={() => jump(i)}>
          {text(h) || '…'}
        </button>
      ))}
    </nav>
  )
}

const SIZES: [string, number][] = [['S', 14], ['M', 15], ['L', 18], ['XL', 21]]
const SPACINGS: [string, number][] = [['Tight', 1.4], ['Normal', 1.6], ['Wide', 1.9], ['Extra wide', 2.3]]
const WIDTHS: [string, number][] = [['Narrow', 600], ['Normal', 760], ['Wide', 1000], ['Full', 0]]

type WriterView = ReturnType<typeof useSettings.getState>['writerView']

/** Header, footer and page numbers for printing and .docx, kept with the document. */
function PageSetup({ page, setPage }: { page: WriterPage; setPage: (patch: Partial<WriterPage>) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return (
    <span className="richtext-pop" ref={root}>
      <ToolButton icon={PanelsTopLeft} label={UI.headerFooterTitle} run={() => setOpen((o) => !o)} active={open} text={UI.headerFooter} />
      {open && (
        <div className="richtext-pop-menu writer-page-setup" onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            // Esc closes this box only, not the tool layout mode.
            e.stopPropagation()
            setOpen(false)
          }}>
          <label>
            {UI.header}
            <input className="input" value={page.header ?? ''} onChange={(e) => setPage({ header: e.target.value })} autoFocus />
          </label>
          <label>
            {UI.footer}
            <input className="input" value={page.footer ?? ''} onChange={(e) => setPage({ footer: e.target.value })} />
          </label>
          <label className="writer-syntax">
            <input type="checkbox" checked={!!page.numbers} onChange={(e) => setPage({ numbers: e.target.checked })} />
            {UI.numbers}
          </label>
        </div>
      )}
    </span>
  )
}

/** Reading comfort for every Writer document on this computer: text size, line spacing, page width. */
function ViewRows({ view, setView }: { view: WriterView; setView: (patch: Partial<WriterView>) => void }) {
  const row = (label: string, field: 'size' | 'spacing' | 'width', options: [string, number][]) => (
    <span className="richtext-ribbon-row" role="group" aria-label={label}>
      {label}
      {options.map(([name, value]) => (
        <button key={name} className={view[field] === value ? 'btn is-active' : 'btn'} aria-pressed={view[field] === value} onMouseDown={(e) => e.preventDefault()} onClick={() => setView({ [field]: value })}>
          {name}
        </button>
      ))}
    </span>
  )
  return (
    <>
      {row(UI.size, 'size', SIZES)}
      {row(UI.spacing, 'spacing', SPACINGS)}
      {row(UI.width, 'width', WIDTHS)}
    </>
  )
}

function ExportMenu({ onExport, onPdf, onHtml, onDocx, onCopy }: { onExport: (format: ExportFormat) => Promise<void>; onPdf: () => void; onHtml: () => void; onDocx: () => Promise<void>; onCopy: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
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
          <button
            role="menuitem"
            className="writer-menu-item"
            onClick={() => {
              setOpen(false)
              onPdf()
            }}
          >
            {UI.pdf}
          </button>
          <button
            role="menuitem"
            className="writer-menu-item"
            title={UI.html}
            onClick={() => {
              setOpen(false)
              onHtml()
            }}
          >
            {UI.htmlLabel}
          </button>
          <button
            role="menuitem"
            className="writer-menu-item"
            title={UI.docx}
            onClick={() => {
              setOpen(false)
              void onDocx()
            }}
          >
            {UI.docxLabel}
          </button>
          <button role="menuitem" className="writer-menu-item" onClick={() => void onCopy().then(() => setCopied(true))}>
            {copied ? UI.copied : UI.copy}
          </button>
        </div>
      )}
    </div>
  )
}
