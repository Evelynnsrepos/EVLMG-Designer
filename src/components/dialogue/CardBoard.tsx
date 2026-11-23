import { CornerDownRight, Play, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Character, Id } from '@/core/model'
import { ProofTextarea } from '@/shared/spell'
import { cardColumns, newChoice, type Choice, type DialogueDoc, type Line, type LinkFrom } from './model'

const C = {
  then: 'Then',
  end: 'End',
  nextLine: 'Next line',
  addChoice: 'Choice',
  choiceText: 'What the player picks',
  newFromChoice: 'New line for this choice',
  drag: 'Drag onto a card to connect, or onto empty space for a new line',
  unlink: 'End the conversation here instead',
  details: 'Conditions, flags and voice (side panel)',
  remove: 'Delete line',
  start: 'Start',
  makeStart: 'Start here',
  lost: 'Nothing leads here',
  text: 'What is said… (Ctrl+Enter: next line)',
  narrator: 'Not a character:',
  hint: 'Type in a card. Ctrl+Enter or + Next line adds the answer. Drag a round handle onto another card to connect.',
}

const portKey = (f: LinkFrom) => (f.choiceId ? `${f.lineId}:${f.choiceId}` : f.lineId)

interface Arrow {
  key: string
  d: string
  back: boolean
}

/** Dialogue cards (her ask 2026-11-22): every line is a card you type in; arrows and + buttons connect them. */
export function CardBoard(p: {
  doc: DialogueDoc
  characters: Character[]
  lost: Set<Id>
  selectedId: Id | null
  focusId: Id | null
  onFocused(): void
  speakerOf(l: Line): string
  onSelect(id: Id): void
  onEdit(id: Id, patch: Partial<Line>): void
  onAdd(from?: LinkFrom): void
  onLink(from: LinkFrom, to: Id | null): void
  onStart(id: Id): void
  onRemove(l: Line): void
  onDetails(id: Id): void
}) {
  const { doc } = p
  const cols = useMemo(() => cardColumns(doc), [doc])
  const byId = useMemo(() => new Map(doc.lines.map((l) => [l.id, l])), [doc])
  const wrap = useRef<HTMLDivElement>(null)
  const [arrows, setArrows] = useState<Arrow[]>([])
  const [drag, setDrag] = useState<{ from: LinkFrom; x1: number; y1: number; x2: number; y2: number } | null>(null)

  const local = (r: DOMRect) => {
    const w = wrap.current!.getBoundingClientRect()
    return { x: r.left - w.left, y: r.top - w.top, w: r.width, h: r.height }
  }

  // Arrows are measured from the cards on screen, so cards may be any height.
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => {
      const next: Arrow[] = []
      for (const l of doc.lines) {
        const links: [LinkFrom, Id | null][] = l.choices.length ? l.choices.map((c) => [{ lineId: l.id, choiceId: c.id }, c.to]) : [[{ lineId: l.id }, l.next]]
        for (const [from, to] of links) {
          const port = to && el.querySelector(`[data-port="${portKey(from)}"]`)
          const card = to && el.querySelector(`[data-card="${to}"]`)
          if (!port || !card) continue
          const a = local(port.getBoundingClientRect())
          const b = local(card.getBoundingClientRect())
          const x1 = a.x + a.w / 2
          const y1 = a.y + a.h / 2
          const back = b.x <= x1
          const x2 = b.x
          const y2 = b.y + 22
          const bend = back ? 80 : Math.max(30, (x2 - x1) / 2)
          next.push({ key: portKey(from), back, d: `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}` })
        }
      }
      setArrows((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.querySelectorAll('[data-card]').forEach((c) => ro.observe(c))
    return () => ro.disconnect()
  })

  const startDrag = (e: React.PointerEvent, from: LinkFrom) => {
    if (e.button !== 0) return
    e.preventDefault()
    const a = local((e.currentTarget as HTMLElement).getBoundingClientRect())
    const x1 = a.x + a.w / 2
    const y1 = a.y + a.h / 2
    const w = () => wrap.current!.getBoundingClientRect()
    const move = (m: PointerEvent) => setDrag({ from, x1, y1, x2: m.clientX - w().left, y2: m.clientY - w().top })
    const up = (u: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      const moved = Math.hypot(u.clientX - w().left - x1, u.clientY - w().top - y1) > 12
      if (!moved) return
      const target = document.elementFromPoint(u.clientX, u.clientY)?.closest<HTMLElement>('[data-card]')?.dataset.card
      if (target && target !== from.lineId) p.onLink(from, target)
      else if (!target && wrap.current?.contains(document.elementFromPoint(u.clientX, u.clientY))) p.onAdd(from)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const Port = ({ from, to }: { from: LinkFrom; to: Id | null }) => (
    <span className="dlg-port-row">
      {to ? (
        <button className="dlg-target" title={C.unlink} onClick={() => p.onLink(from, null)}>
          → {shortName(p.speakerOf(byId.get(to)!), byId.get(to)!.text)} <X size={11} />
        </button>
      ) : (
        <span className="muted dlg-end">{C.end}</span>
      )}
      <span className={'dlg-port' + (to ? ' on' : '')} data-port={portKey(from)} title={C.drag} onPointerDown={(e) => startDrag(e, from)} />
    </span>
  )

  return (
    <div className="dlg-cards-scroll">
      <p className="muted dlg-cards-hint">{C.hint}</p>
      <div className="dlg-cards" ref={wrap}>
        <svg className="dlg-arrows" aria-hidden>
          <defs>
            <marker id="dlg-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" />
            </marker>
          </defs>
          {arrows.map((a) => (
            <path key={a.key} d={a.d} className={'dlg-arrow' + (a.back ? ' back' : '')} markerEnd="url(#dlg-arrowhead)" />
          ))}
          {drag && <path d={`M${drag.x1},${drag.y1} L${drag.x2},${drag.y2}`} className="dlg-arrow drafting" />}
        </svg>
        {cols.map((col, i) => (
          <div key={i} className="dlg-col">
            {col.map((id) => {
              const l = byId.get(id)!
              return (
                <LineCard
                  key={id}
                  line={l}
                  {...p}
                  isStart={doc.startId === id}
                  isLost={p.lost.has(id)}
                  selected={p.selectedId === id}
                  autoFocus={p.focusId === id}
                  setChoice={(cid, patch) => p.onEdit(id, { choices: l.choices.map((c) => (c.id === cid ? { ...c, ...patch } : c)) })}
                  Port={Port}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

const shortName = (speaker: string, text: string) => {
  const t = text.trim() || '…'
  return `${speaker}: ${t.length > 18 ? `${t.slice(0, 17)}…` : t}`
}

function LineCard(p: {
  line: Line
  characters: Character[]
  isStart: boolean
  isLost: boolean
  selected: boolean
  autoFocus: boolean
  onFocused(): void
  onSelect(id: Id): void
  onEdit(id: Id, patch: Partial<Line>): void
  onAdd(from?: LinkFrom): void
  onStart(id: Id): void
  onRemove(l: Line): void
  onDetails(id: Id): void
  setChoice(id: Id, patch: Partial<Choice>): void
  Port: (x: { from: LinkFrom; to: Id | null }) => React.ReactNode
}) {
  const { line, Port } = p
  const text = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (!p.autoFocus) return
    text.current?.focus()
    text.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    p.onFocused()
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only when asked to focus
  }, [p.autoFocus])
  const speakerColor = line.speakerId ? 'var(--accent)' : 'var(--border)'
  const flagged = line.conditions.length + line.changes.length + line.choices.reduce((n, c) => n + c.conditions.length + c.changes.length, 0)

  return (
    <div
      className={'dlg-card' + (p.selected ? ' selected' : '') + (p.isLost ? ' lost' : '')}
      data-card={line.id}
      style={{ ['--dlg-speaker' as string]: speakerColor }}
      onFocusCapture={() => p.onSelect(line.id)}
      onPointerDown={() => p.onSelect(line.id)}
    >
      <div className="dlg-card-head">
        <select className="input" aria-label="Speaker" value={line.speakerId ?? ''} onChange={(e) => p.onEdit(line.id, { speakerId: e.target.value || null })}>
          <option value="">{C.narrator}</option>
          {p.characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || 'Untitled'}
            </option>
          ))}
        </select>
        {!line.speakerId && <input className="input" aria-label="Speaker name" value={line.speakerName} placeholder="Narrator, Player…" onChange={(e) => p.onEdit(line.id, { speakerName: e.target.value })} />}
        <span style={{ flex: 1 }} />
        {p.isStart ? (
          <span className="dlg-badge">{C.start}</span>
        ) : (
          <button className="icon-btn" title={C.makeStart} aria-label={C.makeStart} onClick={() => p.onStart(line.id)}>
            <Play size={13} />
          </button>
        )}
        <button className={'icon-btn' + (flagged ? ' is-active' : '')} title={C.details} aria-label={C.details} onClick={() => p.onDetails(line.id)}>
          <SlidersHorizontal size={14} />
          {flagged > 0 && <span className="dlg-count">{flagged}</span>}
        </button>
        <button className="icon-btn" title={C.remove} aria-label={C.remove} onClick={() => p.onRemove(line)}>
          <Trash2 size={14} />
        </button>
      </div>
      {p.isLost && <p className="dlg-warn">{C.lost}</p>}
      <ProofTextarea
        ref={text}
        className="input dlg-card-text"
        rows={2}
        placeholder={C.text}
        value={line.text}
        onChange={(e) => p.onEdit(line.id, { text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            // With choices, Ctrl+Enter writes the line for the first choice that has none yet.
            const open = line.choices.find((c) => !c.to)
            if (!line.choices.length && !line.next) p.onAdd({ lineId: line.id })
            else if (open) p.onAdd({ lineId: line.id, choiceId: open.id })
          }
        }}
      />
      {line.choices.length === 0 ? (
        <div className="dlg-card-out">
          <span className="muted">{C.then}</span>
          {!line.next && (
            <button className="btn btn-ghost dlg-mini" onClick={() => p.onAdd({ lineId: line.id })}>
              <Plus size={12} /> {C.nextLine}
            </button>
          )}
          <Port from={{ lineId: line.id }} to={line.next} />
        </div>
      ) : (
        line.choices.map((c) => (
          <div key={c.id} className="dlg-card-out dlg-card-choice">
            <CornerDownRight size={13} className="muted" />
            <input
              className="input"
              placeholder={C.choiceText}
              value={c.text}
              onChange={(e) => p.setChoice(c.id, { text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !c.to) {
                  e.preventDefault()
                  p.onAdd({ lineId: line.id, choiceId: c.id })
                }
              }}
            />
            {!c.to && (
              <button className="icon-btn" title={C.newFromChoice} aria-label={C.newFromChoice} onClick={() => p.onAdd({ lineId: line.id, choiceId: c.id })}>
                <Plus size={13} />
              </button>
            )}
            <button className="icon-btn" title="Remove choice" aria-label="Remove choice" onClick={() => p.onEdit(line.id, { choices: line.choices.filter((x) => x.id !== c.id) })}>
              <X size={12} />
            </button>
            <Port from={{ lineId: line.id, choiceId: c.id }} to={c.to} />
          </div>
        ))
      )}
      <button
        className="btn btn-ghost dlg-mini dlg-add-choice"
        onClick={() => {
          // The first choice keeps where "Then" pointed, so turning a line into a choice loses nothing.
          const first = line.choices.length === 0 && line.next ? { ...newChoice(), to: line.next } : newChoice()
          p.onEdit(line.id, { choices: [...line.choices, first] })
        }}
      >
        <Plus size={12} /> {C.addChoice}
      </button>
    </div>
  )
}
