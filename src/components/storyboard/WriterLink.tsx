import { BookOpen, ExternalLink, Link2, Unlink } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Id } from '@/core/model'
import { loadDocumentNow, useDocument, useProjectStore } from '@/core/state'
import type { RichTextDoc } from '@/shared/richtext/types'
import { Modal } from '@/shared/ui'
import { openComponent } from '@/shell/editor/actions'
import { framesFromWriter, linkedText, writerSections, type Frame, type WriterLink, type WriterSection } from './model'

const UI = {
  link: 'Link to the Writer…',
  linkHint: 'Show a part of a Writer document (your script) next to this panel. It stays up to date when you change the text there.',
  open: 'Open in the Writer',
  unlink: 'Remove the link',
  whole: 'The whole document',
  start: 'Before the first heading',
  pickDoc: 'Which Writer document?',
  pickPart: 'Which part?',
  noDocs: 'There is no Writer document in this project yet. Make one in the Writer (your script), then link it here.',
  gone: 'The linked Writer document was deleted.',
  headingGone: (h: string) => `The heading “${h}” is not in the document any more. Link the panel again, or rename the heading back.`,
  empty: 'This part of the document is empty.',
  cancel: 'Cancel',
  back: 'Back',
  fromTitle: 'Make panels from a Writer script',
  fromHint: 'Every heading in the document becomes a scene. The panels link to their part of the script and show it next to the picture.',
  perHeading: 'One panel per heading',
  perParagraph: 'One panel per paragraph (the text goes into What happens)',
  make: (n: number) => `Make ${n} panel${n === 1 ? '' : 's'}`,
}

const emptyWriter = () => ({ body: { type: 'doc', content: [] } as RichTextDoc })

function useWriterDocs() {
  const docs = useProjectStore((s) => s.meta?.documents)
  return (docs ?? []).filter((d) => d.type === 'writer')
}

/** The live text of a linked part, read from the Writer document. */
function LiveText({ link }: { link: WriterLink }) {
  const doc = useDocument<{ body?: RichTextDoc }>('writer', link.documentId, emptyWriter)
  if (!doc.data) return null
  const text = linkedText(doc.data.body, link.section)
  if (text === null) return <p className="sb-warn">{UI.headingGone(link.section ?? '')}</p>
  return <div className="sb-script">{text || <span className="muted">{UI.empty}</span>}</div>
}

/** A panel's Writer link: the linked text, open, change and remove. */
export function WriterLinkBox({ link, onChange }: { link: WriterLink | undefined; onChange: (l: WriterLink | undefined) => void }) {
  const writers = useWriterDocs()
  const [picking, setPicking] = useState(false)
  const exists = link && writers.some((d) => d.id === link.documentId)
  const title = link && writers.find((d) => d.id === link.documentId)?.title
  return (
    <div className="sb-writer">
      {link ? (
        <>
          <div className="sb-writer-head">
            <BookOpen size={14} />
            <span className="sb-writer-title">
              {title ?? 'Writer'}
              {link.section !== null && ` › ${link.section}`}
            </span>
            {exists && (
              <button className="icon-btn" title={UI.open} aria-label={UI.open} onClick={() => openComponent('writer', link.documentId)}>
                <ExternalLink size={13} />
              </button>
            )}
            <button className="icon-btn" title={UI.link} aria-label={UI.link} onClick={() => setPicking(true)}>
              <Link2 size={13} />
            </button>
            <button className="icon-btn" title={UI.unlink} aria-label={UI.unlink} onClick={() => onChange(undefined)}>
              <Unlink size={13} />
            </button>
          </div>
          {exists ? <LiveText link={link} /> : <p className="sb-warn">{UI.gone}</p>}
        </>
      ) : (
        <button className="btn" title={UI.linkHint} onClick={() => setPicking(true)}>
          <BookOpen size={14} /> {UI.link}
        </button>
      )}
      {picking && (
        <WriterPicker
          onClose={() => setPicking(false)}
          onPick={(l) => {
            setPicking(false)
            onChange(l)
          }}
        />
      )}
    </div>
  )
}

/** Load a Writer document's sections. */
function useSections(id: Id | null) {
  const root = useProjectStore((s) => s.root)
  const [state, setState] = useState<{ id: Id; body: RichTextDoc | null } | null>(null)
  useEffect(() => {
    if (!root || !id) return
    let live = true
    void loadDocumentNow<{ body?: RichTextDoc } | null>(root, 'writer', id, () => null).then((d) => live && setState({ id, body: d?.body ?? null }))
    return () => {
      live = false
    }
  }, [root, id])
  return state && state.id === id ? state.body : undefined
}

function DocList({ onPick }: { onPick: (id: Id) => void }) {
  const writers = useWriterDocs()
  if (!writers.length) return <p className="muted">{UI.noDocs}</p>
  return (
    <div className="sb-pick-list">
      {writers.map((d) => (
        <button key={d.id} onClick={() => onPick(d.id)}>
          {d.title || 'Untitled document'}
        </button>
      ))}
    </div>
  )
}

const preview = (s: WriterSection) => (s.text.length > 90 ? `${s.text.slice(0, 90)}…` : s.text)

export function WriterPicker({ onPick, onClose }: { onPick: (l: WriterLink) => void; onClose: () => void }) {
  const [docId, setDocId] = useState<Id | null>(null)
  const body = useSections(docId)
  const sections = body === undefined ? null : writerSections(body)
  return (
    <Modal onClose={onClose}>
      <div className="sb-pick">
        <h3>{docId ? UI.pickPart : UI.pickDoc}</h3>
        {!docId ? (
          <DocList onPick={setDocId} />
        ) : (
          <div className="sb-pick-list">
            <button onClick={() => onPick({ documentId: docId, section: null })}>
              <strong>{UI.whole}</strong>
            </button>
            {sections?.map((s, i) =>
              s.heading === null ? null : (
                <button key={`${i}-${s.heading}`} onClick={() => onPick({ documentId: docId, section: s.heading })}>
                  <strong>{s.heading}</strong>
                  {s.text && <span className="muted">{preview(s)}</span>}
                </button>
              ),
            )}
          </div>
        )}
        <div className="modal-actions">
          {docId && (
            <button className="btn" onClick={() => setDocId(null)}>
              {UI.back}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {UI.cancel}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Make panels from a Writer document. */
export function FromWriterDialog({ onMake, onClose }: { onMake: (frames: Frame[]) => void; onClose: () => void }) {
  const [docId, setDocId] = useState<Id | null>(null)
  const [per, setPer] = useState<'heading' | 'paragraph'>('heading')
  const body = useSections(docId)
  const frames = docId && body !== undefined ? framesFromWriter(docId, body, per) : []
  return (
    <Modal onClose={onClose}>
      <div className="sb-pick">
        <h3>{UI.fromTitle}</h3>
        <p className="muted">{UI.fromHint}</p>
        {!docId ? (
          <DocList onPick={setDocId} />
        ) : (
          <>
            <label className="sb-radio">
              <input type="radio" checked={per === 'heading'} onChange={() => setPer('heading')} /> {UI.perHeading}
            </label>
            <label className="sb-radio">
              <input type="radio" checked={per === 'paragraph'} onChange={() => setPer('paragraph')} /> {UI.perParagraph}
            </label>
          </>
        )}
        <div className="modal-actions">
          {docId && (
            <button className="btn" onClick={() => setDocId(null)}>
              {UI.back}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {UI.cancel}
          </button>
          {docId && (
            <button className="btn btn-primary" disabled={!frames.length} onClick={() => onMake(frames)}>
              {UI.make(frames.length)}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
