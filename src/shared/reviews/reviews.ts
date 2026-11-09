import { useCallback } from 'react'
import { newId, type ComponentType, type EntityType, type Id } from '@/core/model'
import { useDocument } from '@/core/state'

/**
 * Review status and comments (v0.7): every entity and document can carry a
 * status (Idea → Final) and a comment thread. All of it lives in one document
 * of the Reviews tool so it syncs when working together.
 */

export const STATUSES = ['idea', 'draft', 'review', 'approved', 'final'] as const
export type ReviewStatus = (typeof STATUSES)[number]

export const STATUS_LABEL: Record<ReviewStatus, string> = { idea: 'Idea', draft: 'Draft', review: 'In review', approved: 'Approved', final: 'Final' }
export const STATUS_COLOR: Record<ReviewStatus, string> = { idea: '#9aa0a6', draft: '#3e8ef7', review: '#f08c00', approved: '#2f9e44', final: '#9c36b5' }

export type ReviewTarget =
  | { kind: 'entity'; type: EntityType; id: Id }
  | { kind: 'doc'; type: ComponentType; id: Id | null }
  /** A comment pin on a canvas: `doc` is the board's document (null for single-document tools). */
  | { kind: 'pin'; type: ComponentType; doc: Id | null; id: Id }

export interface ReviewComment {
  id: Id
  author: string
  color: string
  text: string
  at: string
  resolved: boolean
}

export interface ReviewEntry {
  target: ReviewTarget
  status: ReviewStatus | null
  comments: ReviewComment[]
  updatedAt: string
  /** 0.28: who approved (or made final) and a fingerprint of the content then, to see later changes. */
  signoff?: { by: string; at: string; hash: string | null }
}

/** Approved and Final are sign-offs: they remember who and what. */
export const isSignoff = (s: ReviewStatus | null) => s === 'approved' || s === 'final'

/** A short fingerprint of any JSON value (FNV-1a), to tell whether it changed since a sign-off. */
export function contentHash(value: unknown): string {
  const text = JSON.stringify(value) ?? ''
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

/** True when the signed-off content is known to have changed since (unknown content = false). */
export const changedSinceSignoff = (e: ReviewEntry | undefined, current: unknown) =>
  !!e?.signoff?.hash && isSignoff(e.status) && current !== undefined && contentHash(current) !== e.signoff.hash

export interface ReviewsDoc {
  entries: Record<string, ReviewEntry>
}

export const REVIEWS_DOC = { type: 'reviews' as const, id: 'reviews' }

/** Stable key per target; single-document tools use their type as id. */
export const reviewKey = (t: ReviewTarget) =>
  t.kind === 'entity' ? `entity:${t.type}:${t.id}` : t.kind === 'pin' ? `pin:${t.type}:${t.doc ?? t.type}:${t.id}` : `doc:${t.type}:${t.id ?? t.type}`

export const openComments = (e: ReviewEntry | undefined) => e?.comments.filter((c) => !c.resolved).length ?? 0

/** Needs attention: waiting for review, or someone left an open comment. */
export const needsReview = (e: ReviewEntry) => e.status === 'review' || openComments(e) > 0

export function useReviews() {
  const doc = useDocument<ReviewsDoc>(REVIEWS_DOC.type, REVIEWS_DOC.id, () => ({ entries: {} }))
  const entries = doc.data?.entries ?? {}
  const change = useCallback(
    (target: ReviewTarget, fn: (e: ReviewEntry) => ReviewEntry) =>
      doc.update((d) => {
        const key = reviewKey(target)
        const prev = d?.entries?.[key] ?? { target, status: null, comments: [], updatedAt: '' }
        const next = { ...fn(prev), updatedAt: new Date().toISOString() }
        const all = { ...d?.entries }
        if (next.status === null && next.comments.length === 0) delete all[key]
        else all[key] = next
        return { entries: all }
      }),
    [doc],
  )
  /** `by` and `content` record a sign-off for Approved and Final; any other status drops it. */
  const setStatus = useCallback(
    (t: ReviewTarget, status: ReviewStatus | null, by?: string, content?: unknown) =>
      change(t, (e) => {
        const { signoff: _old, ...rest } = e
        return isSignoff(status) ? { ...rest, status, signoff: { by: by || 'Me', at: new Date().toISOString(), hash: content === undefined ? null : contentHash(content) } } : { ...rest, status }
      }),
    [change],
  )
  const addComment = useCallback(
    (t: ReviewTarget, text: string, author: { name: string; color: string }) =>
      change(t, (e) => ({ ...e, comments: [...e.comments, { id: newId(), author: author.name || 'Me', color: author.color, text, at: new Date().toISOString(), resolved: false }] })),
    [change],
  )
  const updateComment = useCallback(
    (t: ReviewTarget, id: Id, patch: Partial<ReviewComment>) => change(t, (e) => ({ ...e, comments: e.comments.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
    [change],
  )
  const removeComment = useCallback((t: ReviewTarget, id: Id) => change(t, (e) => ({ ...e, comments: e.comments.filter((c) => c.id !== id) })), [change])
  return { entries, get: (t: ReviewTarget) => entries[reviewKey(t)], setStatus, addComment, updateComment, removeComment, loaded: !!doc.data }
}
