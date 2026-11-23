import { ImagePlus, Trash2, X } from 'lucide-react'
import { useRef } from 'react'
import { AssetImage } from '@/shared/AssetImage'
import { RefPicker } from '@/shared/links'
import type { RefProvider } from '@/shared/richtext'
import { BRANCH_COLORS, xOfYear, yearAt, type TimelineEvent, type TimelineItem, type TimelineLine, type YearAxis } from './model'
import { ProofTextarea } from '@/shared/spell'

const DETAILS_UI = {
  event: 'Event',
  branch: 'Branch',
  main: 'Main timeline',
  mainHint: 'Click the line to add events. Press B and click a point to branch off an alternative timeline. Drag the end handle to stretch the timeline.',
  year: 'Year',
  text: 'Text',
  image: 'Image',
  chooseImage: 'Choose image',
  removeImage: 'Remove image',
  links: 'Links',
  linkHint: 'Characters, towns, items...',
  missing: 'Missing link',
  removeLink: 'Remove link',
  name: 'Name',
  color: 'Color',
  deleteEvent: 'Delete event',
  deleteBranch: 'Delete branch',
  close: 'Close details',
}

type Patch = Partial<TimelineEvent> | Partial<TimelineLine>

export interface DetailsProps {
  item: TimelineItem
  axis: YearAxis | null
  refs: RefProvider
  /** Focus the main field (a new event's text, a new branch's name). */
  autoFocus: boolean
  onPatch(patch: Patch, options?: { undoable?: boolean }): void
  onPickImage(): void
  onDelete(): void
  onClose(): void
  /** Esc in the panel: hand the keyboard back to the canvas so tool keys work again. */
  onEscape(): void
}

/** Side panel for the selected event (TL-3, TL-9) or branch (TL-7). */
export function Details(p: DetailsProps) {
  // One undo step per field edit: the first keystroke records, the rest replace it.
  const editing = useRef(false)
  const typed = (patch: Patch) => {
    p.onPatch(patch, { undoable: !editing.current })
    editing.current = true
  }
  const field = { onFocus: () => (editing.current = false), onBlur: () => (editing.current = false) }

  const item = p.item
  const title = item.kind === 'tl-event' ? DETAILS_UI.event : item.main ? DETAILS_UI.main : DETAILS_UI.branch

  return (
    <aside className="timeline-details" aria-label={title} onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault() // keep Layout Mode closed (ED-7)
          p.onEscape()
        }
      }}
    >
      <header className="timeline-details-head">
        <span>{title}</span>
        <button className="icon-btn" title={DETAILS_UI.close} aria-label={DETAILS_UI.close} onClick={p.onClose}>
          <X size={15} />
        </button>
      </header>
      {item.kind === 'tl-event' ? <EventFields {...p} ev={item} typed={typed} field={field} /> : <LineFields {...p} line={item} typed={typed} field={field} />}
    </aside>
  )
}

interface FieldProps extends DetailsProps {
  typed(patch: Patch): void
  field: { onFocus(): void; onBlur(): void }
}

function EventFields({ ev, axis, refs, autoFocus, onPatch, onPickImage, onDelete, typed, field }: FieldProps & { ev: TimelineEvent }) {
  const year = axis ? yearAt(axis, ev.x) : null
  return (
    <>
      {ev.calendarEntryId && <p className="muted timeline-field">From the Calendar: change its date and title there. Image and links stay yours.</p>}
      {axis && year !== null && (
        <label className="timeline-field">
          <span>{DETAILS_UI.year}</span>
          <input
            className="input"
            type="number"
            step={1}
            value={year}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10)
              if (Number.isFinite(v)) typed({ x: xOfYear(axis, v) })
            }}
            {...field}
          />
        </label>
      )}
      <label className="timeline-field">
        <span>{DETAILS_UI.text}</span>
        <ProofTextarea className="input timeline-text" rows={5} value={ev.text} autoFocus={autoFocus} onChange={(e) => typed({ text: e.target.value })} {...field} />
      </label>
      <div className="timeline-field">
        <span>{DETAILS_UI.image}</span>
        {ev.src ? (
          <div className="timeline-row">
            <AssetImage path={ev.src} alt={ev.text || DETAILS_UI.event} size={56} />
            <button className="btn" onClick={onPickImage}>
              {DETAILS_UI.chooseImage}
            </button>
            <button className="icon-btn" title={DETAILS_UI.removeImage} aria-label={DETAILS_UI.removeImage} onClick={() => onPatch({ src: null })}>
              <Trash2 size={15} />
            </button>
          </div>
        ) : (
          <button className="btn" onClick={onPickImage}>
            <ImagePlus size={15} /> {DETAILS_UI.chooseImage}
          </button>
        )}
      </div>
      <div className="timeline-field">
        <span>{DETAILS_UI.links}</span>
        {ev.links.map((link) => {
          const hit = refs.resolve({ kind: link.kind, id: link.targetId })
          return (
            <div key={`${link.kind}:${link.targetId}`} className="timeline-row">
              {hit ? (
                <button className="btn timeline-chip" onClick={() => refs.open?.({ kind: link.kind, id: link.targetId })}>
                  {hit.label}
                  {hit.hint && <small>{hit.hint}</small>}
                </button>
              ) : (
                <span className="timeline-missing">{DETAILS_UI.missing}</span>
              )}
              <button
                className="icon-btn"
                title={DETAILS_UI.removeLink}
                aria-label={DETAILS_UI.removeLink}
                onClick={() => onPatch({ links: ev.links.filter((l) => l !== link) })}
              >
                <X size={15} />
              </button>
            </div>
          )
        })}
        <RefPicker
          provider={refs}
          placeholder={DETAILS_UI.linkHint}
          exclude={ev.links.map((l) => ({ kind: l.kind, id: l.targetId }))}
          onPick={(item) => onPatch({ links: [...ev.links, { kind: item.kind, targetId: item.id }] })}
        />
      </div>
      <button className="btn btn-danger timeline-delete" onClick={onDelete}>
        <Trash2 size={15} /> {DETAILS_UI.deleteEvent}
      </button>
    </>
  )
}

function LineFields({ line, autoFocus, onPatch, onDelete, typed, field }: FieldProps & { line: TimelineLine }) {
  if (line.main) return <p className="timeline-hint">{DETAILS_UI.mainHint}</p>
  return (
    <>
      <label className="timeline-field">
        <span>{DETAILS_UI.name}</span>
        <input className="input" value={line.name} autoFocus={autoFocus} onFocus={(e) => {
            field.onFocus()
            if (autoFocus) e.target.select()
          }} onChange={(e) => typed({ name: e.target.value })} onBlur={field.onBlur} />
      </label>
      <div className="timeline-field">
        <span>{DETAILS_UI.color}</span>
        <div className="timeline-swatches" role="radiogroup" aria-label={DETAILS_UI.color}>
          {BRANCH_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={c === line.lineColor}
              aria-label={c}
              className={'timeline-swatch' + (c === line.lineColor ? ' is-active' : '')}
              style={{ background: c }}
              onClick={() => onPatch({ lineColor: c })}
            />
          ))}
        </div>
      </div>
      <button className="btn btn-danger timeline-delete" onClick={onDelete}>
        <Trash2 size={15} /> {DETAILS_UI.deleteBranch}
      </button>
    </>
  )
}
