import { ChevronDown, ChevronRight, Copy, Search, Trash } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { pickAndImportAssets } from '@/core/assets'
import { newId, type Id } from '@/core/model'
import { useDocument, useProjectStore } from '@/core/state'
import { promptDialog } from '@/shared/dialogs'
import { BUILTIN_ICONS } from './icons'
import { cardsFromSheet, renameFieldInScene, type Card, type CardDoc, type Field, type SheetLike } from './model'
import { evaluatedSheet } from './sheetValues'
import { addCard, cardLabel, TEXT, type Update } from './ui'

/** Card names are cut here in lists, so long names don't push the rest of the row away. */
const NAME_MAX = 24
const short = (s: string) => (s.length > NAME_MAX ? s.slice(0, NAME_MAX - 1) + '…' : s)
const matches = (d: CardDoc, c: Card, q: string) => !q || Object.values(c.values).some((v) => v.toLowerCase().includes(q)) || cardLabel(d, c).toLowerCase().includes(q)

/**
 * Fields (0.24): every field with the shown card's value. Open a field to rename it, change its type,
 * delete it or put the shown card's value on every card at once.
 */
export function FieldsSection({ d, card, update }: { d: CardDoc; card: Card | null; update: Update }) {
  const [open, setOpen] = useState<Id | null>(null)
  const root = useProjectStore((s) => s.root)
  const linked = !!d.sheet
  const setValue = (fieldId: Id, v: string) => card && update((x) => ({ ...x, cards: x.cards.map((c) => (c.id === card.id ? { ...c, values: { ...c.values, [fieldId]: v } } : c)) }))
  const pickImage = async (f: Field) => {
    if (!root) return
    const [a] = await pickAndImportAssets(root, 'image')
    if (a) setValue(f.id, a.path)
  }
  const renameField = (f: Field, name: string) =>
    update((x) => ({
      ...x,
      fields: x.fields.map((y) => (y.id === f.id ? { ...y, name } : y)),
      front: renameFieldInScene(x.front, f.name, name),
      back: renameFieldInScene(x.back, f.name, name),
    }))
  const toAll = (f: Field) => {
    const v = card?.values[f.id] ?? ''
    update((x) => ({ ...x, cards: x.cards.map((c) => ({ ...c, values: { ...c.values, [f.id]: v } })) }))
  }
  const addField = (kind: Field['kind'], name: string) => update((x) => ({ ...x, fields: [...x.fields, { id: newId(), name: `${name} ${x.fields.length + 1}`, kind }] }))

  return (
    <div className="cd-panel">
      {linked ? <p className="cd-muted">Values come from the linked Spreadsheet. {TEXT.sheetHint}</p> : null}
      {d.fields.map((f) => {
        const isOpen = open === f.id
        const v = card?.values[f.id] ?? ''
        return (
          <div key={f.id} className="cd-field">
            <div className="cd-row">
              <button className="btn btn-ghost cd-expand" aria-expanded={isOpen} title={isOpen ? 'Close' : 'Field settings and apply to all cards'} onClick={() => setOpen(isOpen ? null : f.id)}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <span className="cd-field-name" title={f.name}>
                {f.name}
              </span>
              {f.kind === 'image' ? (
                <button className="btn cd-field-value" disabled={linked || !card} title={v || 'Pick a picture'} onClick={() => void pickImage(f)}>
                  {v ? '🖼 ' + v.split('/').pop() : '+ Picture'}
                </button>
              ) : (
                <input
                  className={'input cd-field-value' + (f.kind === 'number' ? ' cd-num' : '')}
                  type={f.kind === 'number' && !linked ? 'number' : 'text'}
                  readOnly={linked}
                  disabled={!card}
                  value={v}
                  aria-label={f.name}
                  onChange={(e) => setValue(f.id, e.target.value)}
                />
              )}
            </div>
            {isOpen ? (
              <div className="cd-field-more">
                <div className="cd-row">
                  <input className="input" value={f.name} aria-label="Field name" onChange={(e) => renameField(f, e.target.value)} />
                  <select className="input cd-kind" value={f.kind} aria-label="Field type" onChange={(e) => update((x) => ({ ...x, fields: x.fields.map((y) => (y.id === f.id ? { ...y, kind: e.target.value as Field['kind'] } : y)) }))}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="image">Picture</option>
                  </select>
                  <button className="btn btn-ghost" title="Delete field" aria-label="Delete field" onClick={() => update((x) => ({ ...x, fields: x.fields.filter((y) => y.id !== f.id) }))}>
                    <Trash size={14} />
                  </button>
                </div>
                <button className="btn" disabled={linked || !card} title="Puts this card’s value into the same field of every card" onClick={() => toAll(f)}>
                  Apply “{short(f.kind === 'image' ? v.split('/').pop() || '' : v) || 'empty'}” to all cards
                </button>
              </div>
            ) : null}
          </div>
        )
      })}
      <div className="cd-row cd-wrap">
        <button className="btn" onClick={() => addField('text', 'Field')}>
          + Text
        </button>
        <button className="btn" onClick={() => addField('number', 'Stat')}>
          + Number
        </button>
        <button className="btn" onClick={() => addField('image', 'Picture')}>
          + Picture
        </button>
      </div>
      <details className="cd-details">
        <summary>Icons in text</summary>
        <Icons d={d} update={update} />
      </details>
    </div>
  )
}

function Icons({ d, update }: { d: CardDoc; update: Update }) {
  const root = useProjectStore((s) => s.root)
  const addIcon = async () => {
    if (!root) return
    const [a] = await pickAndImportAssets(root, 'image')
    if (!a) return
    const name = (await promptDialog('Icon name (type it as :name: in text)', a.name.replace(/\.[^.]+$/, '')))?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
    if (name) update((x) => ({ ...x, icons: [...(x.icons ?? []).filter((i) => i.name !== name), { id: newId(), name, src: a.path }] }))
  }
  return (
    <>
      <p className="cd-muted">Type :name: in any text to show an icon in the text colour. Click a name to copy it.</p>
      <div className="cd-icons">
        {Object.keys(BUILTIN_ICONS).map((name) => (
          <button key={name} className="cd-icon-chip" title={`Copy :${name}:`} onClick={() => void navigator.clipboard?.writeText(`:${name}:`)}>
            :{name}:
          </button>
        ))}
        {(d.icons ?? []).map((i) => (
          <span key={i.id} className="cd-icon-chip">
            :{i.name}:
            <button className="btn btn-ghost" title="Delete icon" aria-label={`Delete icon ${i.name}`} onClick={() => update((x) => ({ ...x, icons: (x.icons ?? []).filter((y) => y.id !== i.id) }))}>
              <Trash size={12} />
            </button>
          </span>
        ))}
      </div>
      <button className="btn" onClick={() => void addIcon()}>
        + Own icon (picture)
      </button>
    </>
  )
}

/** The deck's cards, always visible: number, small picture, short name and copies. */
export function CardList({ d, cards, currentId, onPick, update, previews }: { d: CardDoc; cards: Card[]; currentId: Id | null; onPick(id: Id): void; update: Update; previews: Map<Id, string> }) {
  const [q, setQ] = useState('')
  const spreadsheets = (useProjectStore((s) => s.meta?.documents) ?? []).filter((x) => x.type === 'spreadsheet')
  const linked = !!d.sheet
  const query = q.trim().toLowerCase()
  const total = cards.reduce((n, c) => n + Math.max(0, c.copies), 0)
  return (
    <div className="cd-panel cd-cards">
      <div className="cd-row">
        <Search size={14} aria-hidden />
        <input className="input" value={q} placeholder="Search cards" aria-label="Search cards" onChange={(e) => setQ(e.target.value)} />
        <button className="btn" disabled={linked} title={linked ? 'Cards come from the linked Spreadsheet: add a row there' : 'Add a card and open it'} onClick={() => onPick(addCard(d, update))}>
          + Card
        </button>
      </div>
      <ol className="cd-card-list" aria-label={`Cards, ${total} to print`}>
        {cards.map((c, i) =>
          matches(d, c, query) ? (
            <li key={c.id} className={'cd-card-item' + (c.id === currentId ? ' is-on' : '')} onClick={() => onPick(c.id)}>
              <span className="cd-card-no">{i + 1}</span>
              {previews.get(c.id) ? <img className="cd-card-thumb" src={previews.get(c.id)} alt="" /> : <span className="cd-card-thumb" />}
              <span className="cd-card-name" title={cardLabel(d, c)}>
                {short(cardLabel(d, c))}
              </span>
              <input
                className="input cd-copies"
                type="number"
                min={0}
                readOnly={linked}
                value={c.copies}
                title="Copies to print"
                aria-label="Copies"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => update((x) => ({ ...x, cards: x.cards.map((y) => (y.id === c.id ? { ...y, copies: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : y)) }))}
              />
              {linked ? null : (
                <span className="cd-card-actions">
                  <button
                    className="btn btn-ghost"
                    title="Duplicate card"
                    aria-label="Duplicate card"
                    onClick={(e) => {
                      e.stopPropagation()
                      const id = newId()
                      update((x) => ({ ...x, cards: x.cards.flatMap((y) => (y.id === c.id ? [y, { ...y, id }] : [y])), overrides: x.overrides?.[c.id] ? { ...x.overrides, [id]: x.overrides[c.id] } : x.overrides }))
                      onPick(id)
                    }}
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    className="btn btn-ghost"
                    title="Delete card"
                    aria-label="Delete card"
                    onClick={(e) => {
                      e.stopPropagation()
                      update((x) => {
                        const { [c.id]: _, ...overrides } = x.overrides ?? {}
                        return { ...x, cards: x.cards.filter((y) => y.id !== c.id), overrides }
                      })
                    }}
                  >
                    <Trash size={13} />
                  </button>
                </span>
              )}
            </li>
          ) : null,
        )}
      </ol>
      <p className="cd-muted">{total} {total === 1 ? 'card' : 'cards'} to print.</p>
      <label className="cd-row">
        <span className="cd-label">Cards from</span>
        <select className="input" value={d.sheet?.documentId ?? ''} onChange={(e) => update((x) => ({ ...x, sheet: e.target.value ? { documentId: e.target.value, sheetId: '' } : undefined }))}>
          <option value="">This list</option>
          {spreadsheets.map((s) => (
            <option key={s.id} value={s.id}>
              Spreadsheet: {s.title}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

/** The card shown on the canvas: a button that opens a searchable list. */
export function CardPicker({ d, cards, current, onPick }: { d: CardDoc; cards: Card[]; current: Card | null; onPick(id: Id): void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])
  const query = q.trim().toLowerCase()
  const found = useMemo(() => cards.map((c, i) => [c, i] as const).filter(([c]) => matches(d, c, query)), [cards, d, query])
  const pick = (id: Id) => {
    onPick(id)
    setOpen(false)
    setQ('')
  }
  return (
    <span className="cd-picker">
      <button className="btn cd-picker-btn" aria-haspopup="listbox" aria-expanded={open} title="Pick the card to show" onClick={() => setOpen(!open)}>
        {current ? `${cards.indexOf(current) + 1}. ${short(cardLabel(d, current))}` : 'No cards'}
        <ChevronDown size={14} />
      </button>
      {open ? (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="cd-picker-pop">
            <input
              ref={input}
              className="input"
              value={q}
              placeholder="Search cards"
              aria-label="Search cards"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false)
                if (e.key === 'Enter' && found[0]) pick(found[0][0].id)
              }}
            />
            <ul role="listbox" className="cd-picker-list">
              {found.map(([c, i]) => (
                <li key={c.id} role="option" aria-selected={c.id === current?.id} className={c.id === current?.id ? 'is-on' : ''} onClick={() => pick(c.id)}>
                  {i + 1}. {short(cardLabel(d, c))}
                </li>
              ))}
              {found.length ? null : <li className="cd-muted">No card matches</li>}
            </ul>
          </div>
        </>
      ) : null}
    </span>
  )
}

/** Reads a linked Spreadsheet sheet and hands its rows up as cards. Mounted only while a sheet is linked. */
export function LinkedSheet({ link, fields, variants, onCards }: { link: NonNullable<CardDoc['sheet']>; fields: Field[]; variants: CardDoc['variants']; onCards(c: Card[] | null): void }) {
  const wb = useDocument<{ sheets: SheetLike[] }>('spreadsheet', link.documentId, () => ({ sheets: [] })).data
  const sheet = wb?.sheets.find((s) => s.id === link.sheetId) ?? wb?.sheets[0]
  const cards = useMemo(() => (sheet && wb ? cardsFromSheet(evaluatedSheet(wb.sheets, sheet), fields, variants) : null), [wb, sheet, fields, variants])
  useEffect(() => {
    onCards(cards)
    return () => onCards(null)
  }, [cards, onCards])
  return null
}
