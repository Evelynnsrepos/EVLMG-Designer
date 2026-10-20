import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Id } from '@/core/model'
import { collabNames, useDocument } from '@/core/state'
import { emptyRichText, extractRefs, RichTextEditor, useProjectImages, type RefProvider, type RichTextDoc } from '@/shared/richtext'
import type { WikiArticleDoc, WikiArticleMeta } from '@/shared/wiki'
import { InfoBox } from './InfoBox'
import { sameLinks, toWikiLinks } from './model'

const UI = {
  titleLabel: 'Article title',
  titlePlaceholder: 'Untitled article',
  delete: 'Delete article',
  mentionedIn: 'Mentioned in',
  noMentions: 'No other article mentions this one yet.',
  loading: 'Loading…',
  placeholder: 'Write the article… Type [[ to mention another article, a character, a town, an item or an enemy.',
}

const createArticleDoc = (): WikiArticleDoc => ({ body: emptyRichText() })

export interface ArticleProps {
  meta: WikiArticleMeta
  title: string
  refs: RefProvider
  mentionedIn: { id: Id; title: string }[]
  onRename(title: string): void
  onLinksChange(links: WikiArticleMeta['links']): void
  onDelete(): void
  onOpen(id: Id): void
}

/** One wiki article: title, info box for pulled articles (WK-3), rich text body (WK-6) and "Mentioned in" (WK-7). */
export function Article({ meta, title, refs, mentionedIn, onRename, onLinksChange, onDelete, onOpen }: ArticleProps) {
  const doc = useDocument<WikiArticleDoc>('wiki', meta.id, createArticleDoc)
  const body = doc.data?.body as RichTextDoc | undefined
  const images = useProjectImages(body)

  if (!doc.data || !images.ready) return <div className="wiki-empty">{UI.loading}</div>

  const onChange = (next: RichTextDoc) => {
    doc.update((d) => ({ ...d, body: next }), { undoable: false })
    const links = toWikiLinks(extractRefs(next))
    if (!sameLinks(links, meta.links)) onLinksChange(links)
  }

  return (
    <article className="wiki-article">
      <div className="wiki-article-head">
        <TitleInput key={meta.id} value={title} onCommit={onRename} />
        <button className="icon-btn" title={UI.delete} aria-label={UI.delete} onClick={onDelete}>
          <Trash2 size={15} />
        </button>
      </div>
      <div className={meta.source ? 'wiki-article-body has-infobox' : 'wiki-article-body'}>
        {meta.source && <InfoBox kind={meta.source.kind} entityId={meta.source.entityId} />}
        <RichTextEditor
          key={meta.id}
          value={body}
          onChange={onChange}
          liveTextName={collabNames.text(collabNames.document('wiki', meta.id), 'body')}
          refs={refs}
          pickImage={images.pickImage}
          importImages={images.importImages}
          resolveImageSrc={images.resolveImageSrc}
          placeholder={UI.placeholder}
          className="wiki-editor"
        />
      </div>
      <footer className="wiki-backlinks">
        <h4>{UI.mentionedIn}</h4>
        {mentionedIn.length === 0 ? (
          <div className="wiki-muted">{UI.noMentions}</div>
        ) : (
          <ul>
            {mentionedIn.map((a) => (
              <li key={a.id}>
                <button className="wiki-link-btn" onClick={() => onOpen(a.id)}>
                  {a.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </footer>
    </article>
  )
}

function TitleInput({ value, onCommit }: { value: string; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    setPrev(value)
    setDraft(value)
  }
  return (
    <input
      className="wiki-title"
      value={draft}
      aria-label={UI.titleLabel}
      placeholder={UI.titlePlaceholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onCommit(draft.trim())}
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
