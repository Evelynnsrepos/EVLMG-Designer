import { Check, MessageSquare, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useCollab } from '@/core/collab'
import { Modal } from '@/shared/ui'
import { peekDocument, useProjectStore } from '@/core/state'
import { changedSinceSignoff, isSignoff, openComments, STATUS_COLOR, STATUS_LABEL, STATUSES, useReviews, type ReviewTarget } from './reviews'
import { usePinThread } from './commentTool'
import './reviews.css'

/** Status chips and the comment thread of one entity or document. */
export function ReviewThread({ target }: { target: ReviewTarget }) {
  const reviews = useReviews()
  const profile = useCollab((s) => s.profile)
  const entry = reviews.get(target)
  const [text, setText] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const comments = (entry?.comments ?? []).filter((c) => showResolved || !c.resolved)
  const resolvedCount = (entry?.comments.length ?? 0) - openComments(entry)
  const current = useTargetContent(target)
  const changed = changedSinceSignoff(entry, current)
  const send = () => {
    if (!text.trim()) return
    reviews.addComment(target, text.trim(), profile)
    setText('')
  }

  return (
    <div className="review-thread">
      <div className="review-statuses" role="radiogroup" aria-label="Status">
        {STATUSES.map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={entry?.status === s}
            className={`review-status${entry?.status === s ? ' on' : ''}`}
            style={{ '--status': STATUS_COLOR[s] } as React.CSSProperties}
            onClick={() => reviews.setStatus(target, entry?.status === s ? null : s, profile.name, current)}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {entry?.signoff && isSignoff(entry.status) && (
        <p className={`review-signoff${changed ? ' changed' : ''}`}>
          {STATUS_LABEL[entry.status!]} by {entry.signoff.by} on {new Date(entry.signoff.at).toLocaleDateString()}
          {changed && (
            <>
              {' '}· <strong>changed since</strong>.{' '}
              <button className="btn btn-ghost" onClick={() => reviews.setStatus(target, entry.status, profile.name, current)}>
                Approve again
              </button>
            </>
          )}
        </p>
      )}

      <div className="review-comments">
        {comments.length === 0 && <p className="review-empty">No comments yet.</p>}
        {comments.map((c) => (
          <div key={c.id} className={`review-comment${c.resolved ? ' resolved' : ''}`}>
            <div className="review-comment-head">
              <span className="review-dot" style={{ background: c.color }} />
              <strong>{c.author}</strong>
              <span className="review-time">{new Date(c.at).toLocaleString()}</span>
              <span style={{ flex: 1 }} />
              <button
                className="icon-btn"
                title={c.resolved ? 'Reopen' : 'Resolve'}
                aria-label={c.resolved ? 'Reopen' : 'Resolve'}
                onClick={() => reviews.updateComment(target, c.id, { resolved: !c.resolved })}
              >
                {c.resolved ? <RotateCcw size={13} /> : <Check size={13} />}
              </button>
              <button className="icon-btn" title="Delete" aria-label="Delete comment" onClick={() => reviews.removeComment(target, c.id)}>
                <Trash2 size={13} />
              </button>
            </div>
            <div className="review-text">{c.text}</div>
          </div>
        ))}
        {resolvedCount > 0 && (
          <button className="btn btn-ghost review-toggle" onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? 'Hide' : 'Show'} {resolvedCount} resolved
          </button>
        )}
      </div>

      <div className="review-new">
        <textarea
          className="input"
          rows={2}
          placeholder="Write a comment… (Ctrl+Enter sends)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send()
          }}
        />
        <button className="btn btn-primary" disabled={!text.trim()} onClick={send}>
          Comment
        </button>
      </div>
    </div>
  )
}

/** Small pill with the status and open comment count; opens the thread. */
export function ReviewButton({ target, title }: { target: ReviewTarget; title: string }) {
  const entry = useReviews().get(target)
  const [open, setOpen] = useState(false)
  const count = openComments(entry)
  const status = entry?.status
  return (
    <>
      <button
        className={`review-pill${status || count ? ' set' : ''}`}
        title="Review status and comments"
        style={status ? ({ '--status': STATUS_COLOR[status] } as React.CSSProperties) : undefined}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        {status && <span className="review-dot" style={{ background: STATUS_COLOR[status] }} />}
        {status ? STATUS_LABEL[status] : !count && 'Review'}
        {count > 0 && (
          <span className="review-count">
            <MessageSquare size={11} /> {count}
          </span>
        )}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h3 className="review-title">{title}</h3>
          <ReviewThread target={target} />
          <div className="modal-actions">
            <button className="btn" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

/** Mounted once in the editor: the comment thread of the clicked pin. */
export function PinThreadHost() {
  const target = usePinThread((s) => s.target)
  if (!target) return null
  const close = () => usePinThread.setState({ target: null })
  return (
    <Modal onClose={close}>
      <h3 className="review-title">Comment</h3>
      <ReviewThread target={target} />
      <div className="modal-actions">
        <button className="btn" onClick={close}>
          Close
        </button>
      </div>
    </Modal>
  )
}

/** The reviewed thing's current content, when it is at hand (entries always, documents once loaded). */
function useTargetContent(t: ReviewTarget): unknown {
  const root = useProjectStore((s) => s.root)
  const entities = useProjectStore((s) => s.entities)
  if (t.kind === 'entity') {
    const e = (entities[t.type] as { id: string }[]).find((x) => x.id === t.id)
    if (!e) return undefined
    // Edit times change on every save; the content is what was approved.
    const { updatedAt: _u, ...content } = e as { updatedAt?: string }
    return content
  }
  if (t.kind === 'doc' && root) return peekDocument(root, t.type, t.id ?? t.type)
  return undefined
}
