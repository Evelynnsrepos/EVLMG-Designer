import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { Check, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useCollab } from '@/core/collab'
import { listChanges, listRemarks, resolveChanges, updateRemark, type RemarkAttrs } from '@/shared/richtext/review'

const UI = {
  empty: 'No comments yet. Select some words and click Comment in the Review tab.',
  placeholder: 'Write your comment, then Enter',
  reply: 'Reply…',
  done: 'Done: remove the comment, the text stays',
  added: 'Added',
  removed: 'Removed',
  accept: 'Accept',
  reject: 'Reject',
  changes: 'Changes',
  comments: 'Comments',
}

const when = (at: number) => (at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/** Comments and tracked changes, next to the text. Click a card to jump to its words. */
export function ReviewPanel({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ remarks: listRemarks(e.state.doc), changes: listChanges(e.state.doc), at: e.state.selection.from }),
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  })
  const show = (from: number, to: number) => editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run()
  return (
    <div className="writer-review">
      {s.changes.length > 0 && (
        <>
          <h4>{UI.changes}</h4>
          {s.changes.map((c) => (
            <div key={`${c.from}-${c.kind}`} className={`writer-card is-${c.kind}`} onClick={() => show(c.from, c.to)}>
              <div className="writer-card-head">
                <strong>{c.kind === 'insertion' ? UI.added : UI.removed}</strong> {c.author}
                <span className="writer-card-tools">
                  <button className="icon-btn" title={UI.accept} aria-label={UI.accept} onClick={(e) => (e.stopPropagation(), resolveChanges(editor, true, c))}>
                    <Check size={15} />
                  </button>
                  <button className="icon-btn" title={UI.reject} aria-label={UI.reject} onClick={(e) => (e.stopPropagation(), resolveChanges(editor, false, c))}>
                    <X size={15} />
                  </button>
                </span>
              </div>
              <div className="writer-card-quote">{c.text}</div>
            </div>
          ))}
        </>
      )}
      <h4>{UI.comments}</h4>
      {!s.remarks.length && <p className="muted">{UI.empty}</p>}
      {s.remarks.map((r) => (
        <RemarkCard key={r.attrs.id} editor={editor} remark={r} active={s.at >= r.from && s.at <= r.to} onShow={() => show(r.from, r.to)} />
      ))}
    </div>
  )
}

function RemarkCard({ editor, remark, active, onShow }: { editor: Editor; remark: { attrs: RemarkAttrs; quote: string }; active: boolean; onShow: () => void }) {
  const a = remark.attrs
  const [draft, setDraft] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const fresh = !a.text
  useEffect(() => {
    if (fresh) box.current?.focus()
  }, [fresh])
  const me = () => (useCollab.getState().profile.name || 'You')
  const save = () => {
    const text = draft.trim()
    setDraft('')
    if (fresh) updateRemark(editor, a.id, text ? { text } : null)
    else if (text) updateRemark(editor, a.id, { replies: [...(a.replies ?? []), { author: me(), text, at: Date.now() }] })
  }
  return (
    <div className={active ? 'writer-card is-active' : 'writer-card'} onClick={onShow}>
      <div className="writer-card-quote">“{remark.quote}”</div>
      {!fresh && (
        <>
          <div className="writer-card-head">
            <strong>{a.author}</strong> <span className="muted">{when(a.at)}</span>
            <span className="writer-card-tools">
              <button className="icon-btn" title={UI.done} aria-label={UI.done} onClick={(e) => (e.stopPropagation(), updateRemark(editor, a.id, null))}>
                <Check size={15} />
              </button>
            </span>
          </div>
          <div className="writer-card-text">{a.text}</div>
          {(a.replies ?? []).map((r, i) => (
            <div key={i} className="writer-card-reply">
              <strong>{r.author}</strong> {r.text}
            </div>
          ))}
        </>
      )}
      <textarea
        ref={box}
        className="input writer-card-input"
        rows={fresh ? 2 : 1}
        value={draft}
        placeholder={fresh ? UI.placeholder : UI.reply}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            save()
          }
          // Esc on a new, empty comment takes it away again.
          if (e.key === 'Escape' && fresh && !draft.trim()) updateRemark(editor, a.id, null)
        }}
        onBlur={() => fresh && save()}
      />
    </div>
  )
}
