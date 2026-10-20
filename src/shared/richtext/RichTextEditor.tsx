import type { Editor } from '@tiptap/core'
import { isChangeOrigin } from '@tiptap/extension-collaboration'
import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Info,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Redo2,
  TextQuote,
  Underline,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useCollab } from '@/core/collab'
import { promptDialog } from '../dialogs'
import { ProofCard, SpellCheck, type ProofHit } from '../spell'
import '../spell/spell.css'
import { liveTextExtensions, openLiveText } from './collab'
import { normalizeRichText } from './doc'
import { ImageFiles, RichImage, type ImageImporter } from './imageExtension'
import { FontMark } from './fontExtension'
import { FONT_SIZES } from './styles'
import { allLocalFonts, GENERIC_FONTS, systemFonts } from '../fontList'
import { RefCard, RefExtension } from './refExtension'
import { syntaxExtensions } from './syntaxExtensions'
import { useEntityRefProvider } from './refs'
import type { ImagePicker, RefProvider, RichTextDoc } from './types'
import './richtext.css'

export interface RichTextEditorProps {
  /** The stored document. Changing it from outside (e.g. after `doc.undo()`) replaces the editor content. */
  value: RichTextDoc | null | undefined
  /** Called on every edit with the new document. Save it with `doc.update(() => next, { undoable: false })`. */
  onChange?: (next: RichTextDoc) => void
  /** Where `[[` links come from. Defaults to the project's entities. */
  refs?: RefProvider
  /** Ask the user for an image. Defaults to a prompt for a path or URL until the asset helper (F2) exists. */
  pickImage?: ImagePicker
  /** Turn a stored image path into a displayable URL (e.g. Tauri `convertFileSrc`). */
  resolveImageSrc?: (src: string) => string
  /** Copy dropped or pasted image files into the project. Without it they are left to the browser. */
  importImages?: ImageImporter
  editable?: boolean
  placeholder?: string
  /** Hide the formatting toolbar, e.g. for small inline fields. */
  toolbar?: boolean
  autoFocus?: boolean
  className?: string
  /** Gives advanced consumers the TipTap editor (exports, custom commands). */
  onEditor?: (editor: Editor | null) => void
  /**
   * In a shared project, teammates type in this text live, with carets.
   * Pass `collabNames.text(collabNames.document(type, id), field)`. The
   * editor keeps calling `onChange` so the JSON stays saved as before.
   */
  liveTextName?: string
  /** Writer (0.19): highlight, checklist and callout buttons. */
  extraFormats?: boolean
  /** Writer's "Markdown Syntax" switch (0.19): more typing shortcuts and Markdown paste. */
  markdownSyntax?: boolean
}

const UI = {
  placeholder: 'Start writing… Type [[ to link an article, entry, tool or document.',
  imagePrompt: 'Image path or URL',
  bold: 'Bold (Ctrl+B)',
  italic: 'Italic (Ctrl+I)',
  underline: 'Underline (Ctrl+U)',
  paragraph: 'Normal text',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  bullet: 'Bulleted list',
  ordered: 'Numbered list',
  quote: 'Quote',
  highlight: 'Highlight (Ctrl+Shift+H)',
  checklist: 'Checklist',
  callout: 'Callout box',
  image: 'Insert image',
  link: 'Link an article, entry, tool or document ([[): a jump point in your text',
  undo: 'Undo (Ctrl+Z)',
  redo: 'Redo (Ctrl+Y)',
  font: 'Font',
  defaultFont: 'Default font',
  moreFonts: 'All installed fonts…',
  size: 'Text size (pt)',
  defaultSize: 'Size',
  toolbar: 'Formatting',
}

const defaultPickImage: ImagePicker = async () => {
  const src = (await promptDialog(UI.imagePrompt))?.trim()
  return src ? { src } : null
}

interface LiveProps {
  provider: RefProvider
  resolveImageSrc?: (src: string) => string
  importImages?: ImageImporter
  onChange?: (next: RichTextDoc) => void
  placeholder: string
  syntax: boolean
}

/** After a teammate's edit, save the merged text once things are quiet. */
const SETTLE_MS = 800

function buildExtensions(live: RefObject<LiveProps>, onMisspelling: (hit: ProofHit) => void, shared = false) {
  return [
    StarterKit.configure({
      heading: false,
      link: { openOnClick: false, autolink: true },
      // Shared text has its own undo that only takes back your own typing.
      ...(shared ? { undoRedo: false as const } : {}),
    }),
    Placeholder.configure({ placeholder: () => live.current.placeholder }),
    RichImage.configure({ getResolveSrc: () => live.current.resolveImageSrc }),
    ImageFiles.configure({ getImporter: () => live.current.importImages }),
    FontMark,
    RefExtension.configure({ getProvider: () => live.current.provider, syntax: () => live.current.syntax }),
    RefCard.configure({ getProvider: () => live.current.provider }),
    ...syntaxExtensions(
      () => live.current.syntax,
      () => live.current.provider,
    ),
    SpellCheck.configure({ onMisspelling }),
  ]
}

/**
 * The shared rich text editor (spec 8.6, WK-4, WK-6): headings, bold, italic,
 * underline, lists, quotes, images and `[[` links. Used by the Writer and the Wiki.
 * Undo/redo is handled inside the editor (Ctrl+Z / Ctrl+Y), so callers save with
 * `{ undoable: false }` and do not bind their own Ctrl+Z on top of it.
 */
export function RichTextEditor({
  value,
  onChange,
  refs,
  pickImage = defaultPickImage,
  resolveImageSrc,
  importImages,
  editable = true,
  placeholder = UI.placeholder,
  toolbar = true,
  autoFocus = false,
  className,
  onEditor,
  liveTextName,
  extraFormats = false,
  markdownSyntax = false,
}: RichTextEditorProps) {
  const entityRefs = useEntityRefProvider()
  const provider = refs ?? entityRefs

  // Extensions are built once (rebuilding would reset the content); they read the latest props through `live`.
  const [misspelling, setMisspelling] = useState<ProofHit | null>(null)
  const live = useRef<LiveProps>({ provider, resolveImageSrc, importImages, onChange, placeholder, syntax: markdownSyntax })
  useEffect(() => {
    live.current = { provider, resolveImageSrc, importImages, onChange, placeholder, syntax: markdownSyntax }
  })
  const lastEmitted = useRef<RichTextDoc | null>(null)
  // The extensions only read `live` inside editor callbacks, never during render.
  // oxlint-disable-next-line react/refs
  const [localExtensions] = useState(() => buildExtensions(live, setMisspelling))

  // Shared projects: the editor is rebuilt on the live text when sharing starts or stops.
  const shared = useCollab((s) => s.shared)
  const liveText = useMemo(
    // Seeded from the value at that moment; afterwards the live text is the truth.
    // oxlint-disable-next-line react/refs
    () => (shared && liveTextName ? openLiveText(liveTextName, normalizeRichText(value), buildExtensions(live, setMisspelling, true)) : null),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [shared, liveTextName],
  )
  const extensions = useMemo(
    // oxlint-disable-next-line react/refs
    () => (liveText ? [...buildExtensions(live, setMisspelling, true), ...liveTextExtensions(liveText)] : localExtensions),
    [liveText, localExtensions],
  )
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (settleTimer.current && clearTimeout(settleTimer.current)), [])

  const editor = useEditor(
    {
      extensions,
      content: liveText ? undefined : normalizeRichText(value),
      editable,
      autofocus: autoFocus ? 'end' : false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      onUpdate: ({ editor, transaction }) => {
        const emit = () => {
          if (editor.isDestroyed) return
          const next = editor.getJSON()
          lastEmitted.current = next
          live.current.onChange?.(next)
        }
        if (settleTimer.current) clearTimeout(settleTimer.current)
        settleTimer.current = null
        // A teammate's typing: they save it themselves, we save the merged result once quiet.
        if (isChangeOrigin(transaction)) settleTimer.current = setTimeout(emit, SETTLE_MS)
        else emit()
      },
    },
    [extensions],
  )

  // Outside changes (document undo, another panel showing the same doc) replace the content.
  // Live text is kept in sync by the collaboration extension instead.
  useEffect(() => {
    // A hidden panel coming back re-runs effects; the editor may be gone by then.
    if (!editor || editor.isDestroyed || liveText || value === lastEmitted.current) return
    lastEmitted.current = value ?? null
    editor.commands.setContent(normalizeRichText(value), { emitUpdate: false })
  }, [editor, value, liveText])

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editable, false)
  }, [editor, editable])

  // Renamed or deleted records: repaint every link with its current name.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.storage.ref.repaint.forEach((paint) => paint())
  }, [editor, provider])

  useEffect(() => {
    onEditor?.(editor)
    return () => onEditor?.(null)
  }, [editor, onEditor])

  const insertImage = async () => {
    const picked = await pickImage()
    if (!picked || !editor) return
    editor.chain().focus().setImage({ src: picked.src, alt: picked.alt }).run()
    // Keep writing after the picture, instead of typing over it while it is selected.
    if (editor.state.selection.empty === false) editor.commands.setTextSelection(editor.state.selection.to)
  }

  return (
    <div className={['richtext', className].filter(Boolean).join(' ')}>
      {toolbar && editable && <Toolbar editor={editor} onImage={insertImage} extraFormats={extraFormats} />}
      <EditorContent editor={editor} className="richtext-content" />
      {misspelling && editor && editable && (
        <ProofCard
          hit={misspelling}
          replace={(from, to, text) => editor.chain().focus().insertContentAt({ from, to }, text).run()}
          onClose={() => setMisspelling(null)}
        />
      )}
    </div>
  )
}

function Toolbar({ editor, onImage, extraFormats }: { editor: Editor; onImage: () => void; extraFormats: boolean }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      paragraph: e.isActive('paragraph'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      highlight: e.isActive('highlight'),
      checklist: e.isActive('taskList'),
      callout: e.isActive('callout'),
      family: (e.getAttributes('font').family as string | null) ?? '',
      size: (e.getAttributes('font').size as number | null) ?? 0,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
  const chain = () => editor.chain().focus()

  const button = (Icon: LucideIcon, label: string, run: () => void, active = false, disabled = false) => (
    <button
      type="button"
      className={active ? 'icon-btn richtext-tool is-active' : 'icon-btn richtext-tool'}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // mousedown keeps the selection in the editor
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Icon size={16} />
    </button>
  )

  return (
    <div className="richtext-toolbar" role="toolbar" aria-label={UI.toolbar}>
      {button(Pilcrow, UI.paragraph, () => chain().setParagraph().run(), state.paragraph)}
      {button(Heading1, UI.h1, () => chain().toggleHeading({ level: 1 }).run(), state.h1)}
      {button(Heading2, UI.h2, () => chain().toggleHeading({ level: 2 }).run(), state.h2)}
      {button(Heading3, UI.h3, () => chain().toggleHeading({ level: 3 }).run(), state.h3)}
      <span className="richtext-toolbar-sep" />
      <FontControls editor={editor} family={state.family} size={state.size} />
      <span className="richtext-toolbar-sep" />
      {button(Bold, UI.bold, () => chain().toggleBold().run(), state.bold)}
      {button(Italic, UI.italic, () => chain().toggleItalic().run(), state.italic)}
      {button(Underline, UI.underline, () => chain().toggleUnderline().run(), state.underline)}
      {extraFormats && button(Highlighter, UI.highlight, () => chain().toggleMark('highlight').run(), state.highlight)}
      <span className="richtext-toolbar-sep" />
      {button(List, UI.bullet, () => chain().toggleBulletList().run(), state.bullet)}
      {button(ListOrdered, UI.ordered, () => chain().toggleOrderedList().run(), state.ordered)}
      {extraFormats && button(ListChecks, UI.checklist, () => chain().toggleTaskList().run(), state.checklist)}
      {button(TextQuote, UI.quote, () => chain().toggleBlockquote().run(), state.quote)}
      {extraFormats && button(Info, UI.callout, () => (state.callout ? chain().lift('callout') : chain().wrapIn('callout')).run(), state.callout)}
      <span className="richtext-toolbar-sep" />
      {button(ImagePlus, UI.image, onImage)}
      {button(Link2, UI.link, () => chain().insertContent('[[').run())}
      <span className="richtext-toolbar-spacer" />
      {button(Undo2, UI.undo, () => chain().undo().run(), false, !state.canUndo)}
      {button(Redo2, UI.redo, () => chain().redo().run(), false, !state.canRedo)}
    </div>
  )
}

/** Font and size for the selected text, or for what you type next. */
function FontControls({ editor, family, size }: { editor: Editor; family: string; size: number }) {
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
        onChange={(e) => (e.target.value === ' more' ? void allLocalFonts().then(setLocal) : apply({ family: e.target.value || null }))}
      >
        <option value="">{UI.defaultFont}</option>
        {families.map((f) => (
          <option key={f} value={f} style={{ fontFamily: f }}>
            {f}
          </option>
        ))}
        {!local.length && <option value={' more'}>{UI.moreFonts}</option>}
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
