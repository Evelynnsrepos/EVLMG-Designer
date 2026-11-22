import type { Editor } from '@tiptap/core'
import type { Mark } from '@tiptap/pm/model'
import { useEditorState } from '@tiptap/react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  CalendarDays,
  CaseSensitive,
  FileSymlink,
  Globe,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Info,
  Italic,
  MessageSquarePlus,
  Check,
  X,
  Merge,
  Split,
  Rows3,
  Columns3,
  Trash2,
  PanelTop,
  PaintBucket,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareOff,
  Minus,
  Omega,
  Paintbrush,
  Plus,
  Redo2,
  RemoveFormatting,
  Search,
  SeparatorHorizontal,
  SpellCheck2,
  SquareCode,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableOfContents,
  TextQuote,
  Underline,
  Undo2,
  Volume2,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { allLocalFonts, GENERIC_FONTS, systemFonts } from '../fontList'
import { guessLang } from '../spell/proof'
import { INSERTS, InsertList } from './inserts'
import { FONT_SIZES } from './styles'
import { addRemark, listChanges, resolveChanges } from './review'
import { changeSelectionCase, type CaseMode } from './wordExtensions'
import { useCollab } from '@/core/collab'

/** A tool's own buttons at the end of a built-in tab. */
export type RibbonExtras = Partial<Record<'home' | 'insert' | 'review' | 'table', ReactNode>>

/** An extra ribbon tab a tool adds (the Writer's View and Markdown tabs). */
export interface RibbonTab {
  id: string
  label: string
  content: ReactNode
}

const UI = {
  toolbar: 'Formatting',
  tabs: { home: 'Home', insert: 'Insert', review: 'Review', table: 'Table' },
  lineHeight: 'Line spacing for this paragraph',
  lineHeights: [['', 'Spacing'], ['1', '1.0'], ['1.15', '1.15'], ['1.5', '1.5'], ['2', '2.0'], ['2.5', '2.5']] as [string, string][],
  remark: 'Comment: select words, click, type your comment on the side',
  remarkHint: 'Comment: select some words first',
  accept: 'Accept all changes',
  reject: 'Reject all changes',
  rowAbove: 'Row above',
  rowBelow: 'Row below',
  colLeft: 'Column left',
  colRight: 'Column right',
  delRow: 'Delete row',
  delCol: 'Delete column',
  delTable: 'Delete table',
  merge: 'Merge the selected cells (select them with Shift+click or by dragging)',
  split: 'Split a merged cell',
  headerRow: 'Header row on / off',
  cellColor: 'Cell colour',
  noColor: 'No colour',
  undo: 'Undo (Ctrl+Z)',
  redo: 'Redo (Ctrl+Y)',
  style: 'Paragraph style',
  styles: { p: 'Normal text', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', code: 'Code block' },
  bold: 'Bold (Ctrl+B)',
  italic: 'Italic (Ctrl+I)',
  underline: 'Underline (Ctrl+U)',
  strike: 'Crossed out (Ctrl+Shift+S)',
  sup: 'Superscript, small and raised (Ctrl+.)',
  sub: 'Subscript, small and lowered (Ctrl+,)',
  caps: 'Small caps / Kapitälchen (Ctrl+Shift+K)',
  case: 'Change case',
  cases: { upper: 'UPPER CASE', lower: 'lower case', title: 'Title Case', sentence: 'Sentence case.' } as Record<CaseMode, string>,
  caseHint: 'Select some text first',
  color: 'Text colour',
  highlight: 'Highlight colour (Ctrl+Shift+H)',
  auto: 'Automatic',
  none: 'No highlight',
  more: 'More colours…',
  clear: 'Remove formatting',
  painter: 'Copy formatting: click, then select the text that should look the same',
  bullet: 'Bulleted list',
  ordered: 'Numbered list',
  checklist: 'Checklist',
  outdent: 'Less indent (Ctrl+[)',
  indent: 'More indent (Ctrl+])',
  left: 'Align left (Ctrl+Shift+L)',
  center: 'Centre (Ctrl+Shift+E)',
  right: 'Align right (Ctrl+Shift+R)',
  justify: 'Justify: straight edges on both sides (Ctrl+Shift+J)',
  quote: 'Quote',
  image: 'Picture',
  table: 'Table',
  divider: 'Divider line',
  pageBreak: 'Page break: start a new page when printed (Ctrl+Enter)',
  toc: 'Table of contents: lists your headings and updates itself',
  callout: 'Note box',
  codeBlock: 'Code block',
  footnote: 'Footnote',
  link: 'Link an entry or document ([[)',
  card: 'Jump card (![[)',
  web: 'Web link',
  date: 'Today’s date',
  symbol: 'Symbol or special letter',
  everything: 'Everything you can insert (or type / on a new line)',
  check: 'Fix my text: go through the underlined spots one by one',
  find: 'Find and replace (Ctrl+F)',
  read: 'Read aloud: the selected text, or the paragraph the caret is in',
  stop: 'Stop reading',
  comment: 'Hidden note: greyed text for yourself, left out of exports and the word count',
  selected: (words: number, chars: number) => `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}, ${chars.toLocaleString()} characters selected`,
  noSelection: 'Select text to count it',
  font: 'Font',
  defaultFont: 'Default font',
  moreFonts: 'All installed fonts…',
  size: 'Text size (pt)',
  defaultSize: 'Size',
}

/** Readable on both the light and the dark theme. */
const TEXT_COLORS = ['#d33a3a', '#e07b1f', '#c9a400', '#2f9e44', '#1c9a9a', '#2f6fdd', '#7048e8', '#c2255c', '#868e96', '#8b5a2b']
const HIGHLIGHTS = ['#fff3a3', '#ffd8a8', '#ffc9c9', '#d3f9d8', '#c5f6fa', '#d0ebff', '#e5dbff', '#f3d9fa']
const SYMBOLS = '— – … · • « » „ “ ” ‚ ‘ ’ © ® ™ § ¶ † ‡ ° ± × ÷ ≈ ≠ ≤ ≥ ∞ → ← ↑ ↓ ⇒ ↔ ★ ☆ ♥ ♦ ♣ ♠ ✓ ✗ € £ ¥ ¢ ½ ¼ ¾ ² ³ ä ö ü Ä Ö Ü ß é è ê à ç ñ ø å æ œ'.split(' ')

/** Closes a popover on a click outside it or on Escape. */
function usePopover() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  return { open, setOpen, root }
}

/** The Writer's tabbed toolbar: Home, Insert, Review, plus the tool's own tabs. */
export function Ribbon({
  editor,
  onImage,
  syntax,
  onFind,
  onCheck,
  tabs = [],
  extras = {},
}: {
  editor: Editor
  onImage: () => void
  syntax: boolean
  onFind: () => void
  onCheck: () => void
  tabs?: RibbonTab[]
  extras?: RibbonExtras
}) {
  const [picked, setTab] = useState('home')
  const inTable = useEditorState({ editor, selector: ({ editor: e }) => e.isActive('table') })
  // The Table tab only exists while the caret is in a table.
  const tab = picked === 'table' && !inTable ? 'home' : picked
  const all = [
    { id: 'home', label: UI.tabs.home },
    { id: 'insert', label: UI.tabs.insert },
    { id: 'review', label: UI.tabs.review },
    ...tabs,
    ...(inTable ? [{ id: 'table', label: UI.tabs.table }] : []),
  ]
  const own = tabs.find((t) => t.id === tab)
  return (
    <div className="richtext-ribbon">
      <div className="richtext-ribbon-tabs" role="tablist" aria-label={UI.toolbar}>
        {all.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} className={['richtext-ribbon-tab', tab === t.id && 'is-active', t.id === 'table' && 'is-context'].filter(Boolean).join(' ')} onMouseDown={(e) => e.preventDefault()} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <span className="richtext-toolbar-spacer" />
        <UndoRedo editor={editor} />
      </div>
      <div className="richtext-toolbar richtext-ribbon-body" role="toolbar" aria-label={all.find((t) => t.id === tab)?.label}>
        {tab === 'home' && <HomeTab editor={editor} />}
        {tab === 'insert' && <InsertTab editor={editor} onImage={onImage} syntax={syntax} />}
        {tab === 'review' && <ReviewTab editor={editor} onFind={onFind} onCheck={onCheck} />}
        {tab === 'table' && <TableTab editor={editor} />}
        {(tab === 'home' || tab === 'insert' || tab === 'review' || tab === 'table') && extras[tab] && (
          <>
            <Sep />
            {extras[tab]}
          </>
        )}
        {own?.content}
      </div>
    </div>
  )
}

export function ToolButton({ icon: Icon, label, run, active = false, disabled = false, text }: { icon: LucideIcon; label: string; run: () => void; active?: boolean; disabled?: boolean; text?: string }) {
  return (
    <button
      type="button"
      className={['icon-btn richtext-tool', active && 'is-active', text && 'has-text'].filter(Boolean).join(' ')}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // mousedown keeps the selection in the editor
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Icon size={16} />
      {text && <span>{text}</span>}
    </button>
  )
}

const Sep = () => <span className="richtext-toolbar-sep" />

function UndoRedo({ editor }: { editor: Editor }) {
  const s = useEditorState({ editor, selector: ({ editor: e }) => ({ undo: e.can().undo(), redo: e.can().redo() }) })
  return (
    <>
      <ToolButton icon={Undo2} label={UI.undo} run={() => editor.chain().focus().undo().run()} disabled={!s.undo} />
      <ToolButton icon={Redo2} label={UI.redo} run={() => editor.chain().focus().redo().run()} disabled={!s.redo} />
    </>
  )
}

function HomeTab({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive('codeBlock') ? 'code' : ([1, 2, 3, 4].find((l) => e.isActive('heading', { level: l })) ? `h${[1, 2, 3, 4].find((l) => e.isActive('heading', { level: l }))}` : 'p'),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      sup: e.isActive('superscript'),
      sub: e.isActive('subscript'),
      caps: e.isActive('smallCaps'),
      color: (e.getAttributes('textColor').color as string | null) ?? '',
      highlight: e.isActive('highlight') ? ((e.getAttributes('highlight').color as string | null) ?? 'var(--accent)') : '',
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      checklist: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      align: (e.getAttributes('paragraph').textAlign ?? e.getAttributes('heading').textAlign ?? 'left') as string,
      lineHeight: String(e.getAttributes('paragraph').lineHeight ?? e.getAttributes('heading').lineHeight ?? ''),
      family: (e.getAttributes('font').family as string | null) ?? '',
      size: (e.getAttributes('font').size as number | null) ?? 0,
      empty: e.state.selection.empty,
    }),
  })
  const chain = () => editor.chain().focus()
  const setStyle = (v: string) => {
    if (v === 'p') chain().setParagraph().run()
    else if (v === 'code') chain().toggleCodeBlock().run()
    else chain().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 }).run()
  }
  return (
    <>
      <select className="input richtext-style" title={UI.style} aria-label={UI.style} value={s.style} onChange={(e) => setStyle(e.target.value)}>
        {Object.entries(UI.styles).map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <FontControls editor={editor} family={s.family} size={s.size} />
      <Sep />
      <ToolButton icon={Bold} label={UI.bold} run={() => chain().toggleBold().run()} active={s.bold} />
      <ToolButton icon={Italic} label={UI.italic} run={() => chain().toggleItalic().run()} active={s.italic} />
      <ToolButton icon={Underline} label={UI.underline} run={() => chain().toggleUnderline().run()} active={s.underline} />
      <ToolButton icon={Strikethrough} label={UI.strike} run={() => chain().toggleStrike().run()} active={s.strike} />
      <ToolButton icon={Superscript} label={UI.sup} run={() => chain().toggleMark('superscript').run()} active={s.sup} />
      <ToolButton icon={Subscript} label={UI.sub} run={() => chain().toggleMark('subscript').run()} active={s.sub} />
      <button
        type="button"
        className={s.caps ? 'icon-btn richtext-tool richtext-caps is-active' : 'icon-btn richtext-tool richtext-caps'}
        title={UI.caps}
        aria-label={UI.caps}
        aria-pressed={s.caps}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => chain().toggleMark('smallCaps').run()}
      >
        Aᴀ
      </button>
      <CaseMenu editor={editor} disabled={s.empty} />
      <Sep />
      <ColorMenu
        icon={Baseline}
        label={UI.color}
        colors={TEXT_COLORS}
        current={s.color}
        resetLabel={UI.auto}
        onPick={(c) => (c ? chain().setMark('textColor', { color: c }).run() : chain().unsetMark('textColor').run())}
      />
      <ColorMenu
        icon={Highlighter}
        label={UI.highlight}
        colors={HIGHLIGHTS}
        current={s.highlight}
        resetLabel={UI.none}
        onPick={(c) => (c ? chain().setMark('highlight', { color: c }).run() : chain().unsetMark('highlight').run())}
      />
      <FormatPainter editor={editor} />
      <ToolButton icon={RemoveFormatting} label={UI.clear} run={() => chain().unsetAllMarks().clearNodes().run()} />
      <Sep />
      <ToolButton icon={List} label={UI.bullet} run={() => chain().toggleBulletList().run()} active={s.bullet} />
      <ToolButton icon={ListOrdered} label={UI.ordered} run={() => chain().toggleOrderedList().run()} active={s.ordered} />
      <ToolButton icon={ListChecks} label={UI.checklist} run={() => chain().toggleTaskList().run()} active={s.checklist} />
      <ToolButton icon={IndentDecrease} label={UI.outdent} run={() => chain().changeIndent(-1).run()} />
      <ToolButton icon={IndentIncrease} label={UI.indent} run={() => chain().changeIndent(1).run()} />
      <ToolButton icon={TextQuote} label={UI.quote} run={() => chain().toggleBlockquote().run()} active={s.quote} />
      <Sep />
      <ToolButton icon={AlignLeft} label={UI.left} run={() => chain().setTextAlign('left').run()} active={s.align === 'left'} />
      <ToolButton icon={AlignCenter} label={UI.center} run={() => chain().setTextAlign('center').run()} active={s.align === 'center'} />
      <ToolButton icon={AlignRight} label={UI.right} run={() => chain().setTextAlign('right').run()} active={s.align === 'right'} />
      <ToolButton icon={AlignJustify} label={UI.justify} run={() => chain().setTextAlign('justify').run()} active={s.align === 'justify'} />
      <select className="input richtext-style" title={UI.lineHeight} aria-label={UI.lineHeight} value={s.lineHeight} onChange={(e) => chain().setLineHeight(Number(e.target.value) || null).run()}>
        {UI.lineHeights.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </>
  )
}

function CaseMenu({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const { open, setOpen, root } = usePopover()
  return (
    <span className="richtext-pop" ref={root}>
      <ToolButton icon={CaseSensitive} label={disabled ? `${UI.case}: ${UI.caseHint}` : UI.case} run={() => setOpen((o) => !o)} active={open} disabled={disabled} />
      {open && (
        <div className="richtext-pop-menu">
          {(Object.keys(UI.cases) as CaseMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className="richtext-inserts-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                changeSelectionCase(editor, m)
                setOpen(false)
              }}
            >
              {UI.cases[m]}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

function ColorMenu({ icon, label, colors, current, resetLabel, onPick }: { icon: LucideIcon; label: string; colors: string[]; current: string; resetLabel: string; onPick: (color: string | null) => void }) {
  const { open, setOpen, root } = usePopover()
  const pick = (c: string | null) => {
    onPick(c)
    setOpen(false)
  }
  return (
    <span className="richtext-pop" ref={root}>
      <button
        type="button"
        className={open ? 'icon-btn richtext-tool richtext-color is-active' : 'icon-btn richtext-tool richtext-color'}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon icon={icon} />
        <span className="richtext-color-bar" style={{ background: current || 'currentColor', opacity: current ? 1 : 0.35 }} />
      </button>
      {open && (
        <div className="richtext-pop-menu richtext-colors" role="menu" aria-label={label}>
          <button type="button" className="richtext-inserts-item" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(null)}>
            {resetLabel}
          </button>
          <div className="richtext-swatches">
            {colors.map((c) => (
              <button key={c} type="button" className={c === current ? 'richtext-swatch is-active' : 'richtext-swatch'} style={{ background: c }} title={c} aria-label={c} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)} />
            ))}
          </div>
          <label className="richtext-inserts-item">
            {UI.more}
            <input type="color" value={current.startsWith('#') ? current : '#000000'} onChange={(e) => onPick(e.target.value)} />
          </label>
        </div>
      )}
    </span>
  )
}

const Icon = ({ icon: I }: { icon: LucideIcon }) => <I size={16} />

/** Copies the look of the text at the caret onto the next text you select. */
function FormatPainter({ editor }: { editor: Editor }) {
  const [marks, setMarks] = useState<readonly Mark[] | null>(null)
  useEffect(() => {
    if (!marks) return
    const dom = editor.view.dom
    const apply = () =>
      setTimeout(() => {
        const { from, to, empty } = editor.state.selection
        if (empty) return
        const tr = editor.state.tr
        // Links and [[ jump points stay: they are what the text is, not how it looks.
        for (const type of Object.values(editor.schema.marks)) if (type.name !== 'link' && type.name !== 'ref') tr.removeMark(from, to, type)
        for (const m of marks) tr.addMark(from, to, m)
        editor.view.dispatch(tr)
        setMarks(null)
      })
    dom.addEventListener('mouseup', apply)
    return () => dom.removeEventListener('mouseup', apply)
  }, [editor, marks])
  return (
    <ToolButton
      icon={Paintbrush}
      label={UI.painter}
      active={!!marks}
      run={() => setMarks((m) => (m ? null : (editor.state.storedMarks ?? editor.state.selection.$from.marks()).filter((x) => x.type.name !== 'link' && x.type.name !== 'ref')))}
    />
  )
}

function InsertTab({ editor, onImage, syntax }: { editor: Editor; onImage: () => void; syntax: boolean }) {
  const chain = () => editor.chain().focus()
  const run = (id: string) => () => INSERTS.find((i) => i.id === id)?.run(editor)
  const { open, setOpen, root } = usePopover()
  return (
    <>
      <ToolButton icon={ImagePlus} label={UI.image} run={onImage} text={UI.image} />
      <ToolButton icon={Table} label={UI.table} run={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} text={UI.table} />
      <ToolButton icon={TableOfContents} label={UI.toc} run={() => chain().setTableOfContents().run()} text="Contents" />
      <ToolButton icon={SeparatorHorizontal} label={UI.pageBreak} run={() => chain().setPageBreak().run()} text="Page break" />
      <Sep />
      <ToolButton icon={Minus} label={UI.divider} run={() => chain().setHorizontalRule().run()} />
      <ToolButton icon={Info} label={UI.callout} run={run('callout-note')} />
      <ToolButton icon={SquareCode} label={UI.codeBlock} run={() => chain().toggleCodeBlock().run()} />
      <ToolButton icon={Superscript} label={UI.footnote} run={run('footnote')} />
      <Sep />
      <ToolButton icon={Link2} label={UI.link} run={run('ref')} />
      <ToolButton icon={FileSymlink} label={UI.card} run={run('card')} />
      <ToolButton icon={Globe} label={UI.web} run={run('web')} />
      <Sep />
      <ToolButton icon={CalendarDays} label={UI.date} run={() => chain().insertContent(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })).run()} />
      <SymbolMenu editor={editor} />
      <span className="richtext-pop" ref={root}>
        <ToolButton icon={Plus} label={UI.everything} run={() => setOpen((o) => !o)} active={open} />
        {open && (
          <div className="richtext-insert-menu">
            <InsertList editor={editor} syntax={syntax} onDone={() => setOpen(false)} />
          </div>
        )}
      </span>
    </>
  )
}

function SymbolMenu({ editor }: { editor: Editor }) {
  const { open, setOpen, root } = usePopover()
  return (
    <span className="richtext-pop" ref={root}>
      <ToolButton icon={Omega} label={UI.symbol} run={() => setOpen((o) => !o)} active={open} />
      {open && (
        <div className="richtext-pop-menu richtext-symbols" role="menu" aria-label={UI.symbol}>
          {SYMBOLS.map((sym) => (
            <button key={sym} type="button" className="richtext-symbol" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().insertContent(sym).run()}>
              {sym}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

function ReviewTab({ editor, onFind, onCheck }: { editor: Editor; onFind: () => void; onCheck: () => void }) {
  const [reading, setReading] = useState(false)
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { from, to, empty } = e.state.selection
      const text = empty ? '' : e.state.doc.textBetween(from, to, ' ')
      return { comment: e.isActive('comment'), empty, changes: listChanges(e.state.doc).length, words: text.split(/\s+/).filter(Boolean).length, chars: text.length }
    },
  })
  const read = () => {
    if (reading) {
      speechSynthesis.cancel()
      setReading(false)
      return
    }
    const { from, to, empty, $from } = editor.state.selection
    const text = empty ? $from.parent.textContent : editor.state.doc.textBetween(from, to, ' ')
    if (!text.trim()) return
    const say = new SpeechSynthesisUtterance(text)
    say.lang = guessLang(text) === 'de' ? 'de-DE' : 'en-US'
    say.rate = 0.9
    say.onend = say.onerror = () => setReading(false)
    speechSynthesis.cancel()
    speechSynthesis.speak(say)
    setReading(true)
  }
  return (
    <>
      <ToolButton icon={SpellCheck2} label={UI.check} run={onCheck} text="Fix my text" />
      <ToolButton icon={Search} label={UI.find} run={onFind} text="Find" />
      {typeof speechSynthesis !== 'undefined' && <ToolButton icon={Volume2} label={reading ? UI.stop : UI.read} run={read} active={reading} text={reading ? 'Stop' : 'Read aloud'} />}
      <ToolButton icon={MessageSquarePlus} label={s.empty ? UI.remarkHint : UI.remark} run={() => addRemark(editor, (useCollab.getState().profile.name || 'You'))} disabled={s.empty} text="Comment" />
      <ToolButton icon={MessageSquareOff} label={UI.comment} run={() => editor.chain().focus().toggleMark('comment').run()} active={s.comment} text="Hidden note" />
      {s.changes > 0 && (
        <>
          <Sep />
          <ToolButton icon={Check} label={UI.accept} run={() => resolveChanges(editor, true)} text="Accept all" />
          <ToolButton icon={X} label={UI.reject} run={() => resolveChanges(editor, false)} text="Reject all" />
        </>
      )}
      <Sep />
      <span className="richtext-ribbon-note">{s.words ? UI.selected(s.words, s.chars) : UI.noSelection}</span>
    </>
  )
}

const CELL_COLORS = ['#f0efec', '#fbebeb', '#f9ece7', '#f9eeda', '#e5f4e4', '#e7f1fb', '#efedff', '#d0ebff']

function TableTab({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ merge: e.can().mergeCells(), split: e.can().splitCell(), bg: (e.getAttributes('tableCell').background ?? e.getAttributes('tableHeader').background ?? '') as string }),
  })
  const chain = () => editor.chain().focus()
  return (
    <>
      <ToolButton icon={Rows3} label={UI.rowAbove} run={() => chain().addRowBefore().run()} text="Row above" />
      <ToolButton icon={Rows3} label={UI.rowBelow} run={() => chain().addRowAfter().run()} text="Row below" />
      <ToolButton icon={Columns3} label={UI.colLeft} run={() => chain().addColumnBefore().run()} text="Column left" />
      <ToolButton icon={Columns3} label={UI.colRight} run={() => chain().addColumnAfter().run()} text="Column right" />
      <Sep />
      <ToolButton icon={Merge} label={UI.merge} run={() => chain().mergeCells().run()} disabled={!s.merge} />
      <ToolButton icon={Split} label={UI.split} run={() => chain().splitCell().run()} disabled={!s.split} />
      <ToolButton icon={PanelTop} label={UI.headerRow} run={() => chain().toggleHeaderRow().run()} />
      <ColorMenu icon={PaintBucket} label={UI.cellColor} colors={CELL_COLORS} current={s.bg} resetLabel={UI.noColor} onPick={(c) => chain().setCellAttribute('background', c).run()} />
      <Sep />
      <ToolButton icon={Trash2} label={UI.delRow} run={() => chain().deleteRow().run()} text="Row" />
      <ToolButton icon={Trash2} label={UI.delCol} run={() => chain().deleteColumn().run()} text="Column" />
      <ToolButton icon={Trash2} label={UI.delTable} run={() => chain().deleteTable().run()} text="Table" />
    </>
  )
}

/** Font and size for the selected text, or for what you type next. */
export function FontControls({ editor, family, size }: { editor: Editor; family: string; size: number }) {
  const [local, setLocal] = useState<string[]>([])
  const families = [...new Set([...GENERIC_FONTS, ...systemFonts(), ...local, ...(family ? [family] : [])])]
  const apply = (patch: { family?: string | null; size?: number | null }) => {
    const next = { family: family || null, size: size || null, ...patch }
    const chain = editor.chain().focus()
    if (!next.family && !next.size) chain.unsetMark('font').run()
    else chain.setMark('font', next).run()
  }
  return (
    <>
      <select
        className="input richtext-font"
        title={UI.font}
        aria-label={UI.font}
        value={family}
        onChange={(e) => (e.target.value === ' more' ? void allLocalFonts().then(setLocal) : apply({ family: e.target.value || null }))}
      >
        <option value="">{UI.defaultFont}</option>
        {families.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>
            {f}
          </option>
        ))}
        {!local.length && <option value={' more'}>{UI.moreFonts}</option>}
      </select>
      <select className="input richtext-size" title={UI.size} aria-label={UI.size} value={size || ''} onChange={(e) => apply({ size: Number(e.target.value) || null })}>
        <option value="">{UI.defaultSize}</option>
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </>
  )
}

