import { Bold, Italic } from 'lucide-react'
import { useState } from 'react'
import type { Id } from '@/core/model'
import { updateNodes } from '@/shared/canvas'
import { cssFamily, systemFonts } from '@/shared/fontList'
import { NumberInput } from '@/shared/calculators'
import { bleedMmToPx, bleedPxToMm } from '@/shared/print'
import { CARD_SIZES, resizeDesign, setBleed, type Card, type CardDoc, type CardImageNode, type CardNode, type CardTextNode, type SlotKeys } from './model'
import { confirmBig, ExportDialog, exportCards, targetLabel } from './ExportDialog'
import { exportSettings, logExport } from './exportFormats'
import { cardPainter, runExport } from './exporting'
import { SendMenu } from '@/shell/editor/SendMenu'
import { TEXT, type OnScene, type Update } from './ui'

/** Colour of a node for the Style panel's pickers. */
export const colorOf = (n: CardNode, key: 'fillColor' | 'strokeColor' | 'textColor') => ((n as unknown as Record<string, string | undefined>)[key] ?? '#000000').slice(0, 7)
const slotKey = { fillColor: 'fillSlotId', strokeColor: 'strokeSlotId', textColor: 'textSlotId' } as const

export function StylePanel({ d, selected, onScene }: { d: CardDoc; selected: CardNode[]; onScene: OnScene }) {
  if (!selected.length) return <p className="cd-muted cd-panel">{TEXT.noSelection}</p>
  const ids = selected.map((n) => n.id)
  const patch = (fn: (n: CardNode) => CardNode) => onScene((s) => updateNodes(s, ids, fn))
  const texts = selected.filter((n): n is CardTextNode => n.kind === 'card-text')
  const shapes: CardNode[] = selected.filter((n) => n.kind === 'rect' || n.kind === 'ellipse' || n.kind === 'line')
  const pictures = selected.filter((n): n is CardImageNode => n.kind === 'card-image')
  const t = texts[0]

  const colorRow = (label: string, key: 'fillColor' | 'strokeColor' | 'textColor', nodes: CardNode[]) => {
    const first = nodes[0] as CardNode & SlotKeys & { textSlotId?: Id }
    const slot = first[slotKey[key]]
    return (
      <div className="cd-row">
        <span className="cd-label">{label}</span>
        <select
          className="input"
          value={slot ?? ''}
          aria-label={`${label} colour slot`}
          onChange={(e) => {
            const id = e.target.value || undefined
            const color = d.slots.find((s) => s.id === id)?.color
            patch((n) => (nodes.includes(n) ? { ...n, [slotKey[key]]: id, ...(color ? { [key]: color } : {}) } : n))
          }}
        >
          <option value="">{TEXT.fixed}</option>
          {d.slots.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {slot ? null : (
          <input type="color" aria-label={`${label} colour`} value={colorOf(first, key)} onChange={(e) => patch((n) => (nodes.includes(n) ? { ...n, [key]: e.target.value } : n))} />
        )}
      </div>
    )
  }

  const foil = selected.every((n) => n.foil)
  return (
    <div className="cd-panel">
      <label className="cd-row" title="Printed in shiny foil. Shows a shine here; export the foil mask for the print shop.">
        <input type="checkbox" checked={foil} onChange={() => patch((n) => ({ ...n, foil: !foil || undefined }))} />
        Foil
      </label>
      {t ? (
        <>
          <h4>Text</h4>
          <select className="input" value={t.fontFamily} aria-label="Font" style={{ fontFamily: cssFamily(t.fontFamily) }} onChange={(e) => patch((n) => (n.kind === 'card-text' ? { ...n, fontFamily: e.target.value } : n))}>
            {[...new Set([t.fontFamily, ...systemFonts()])].map((f) => (
              <option key={f} value={f} style={{ fontFamily: cssFamily(f) }}>
                {f}
              </option>
            ))}
          </select>
          <div className="cd-row">
            <input className="input cd-num" type="number" min={4} aria-label="Font size" value={Math.round(t.fontSize)} onChange={(e) => patch((n) => (n.kind === 'card-text' ? { ...n, fontSize: Math.max(4, Number(e.target.value) || 4) } : n))} />
            <button className={'btn btn-ghost' + (t.bold ? ' is-on' : '')} aria-pressed={!!t.bold} title="Bold" onClick={() => patch((n) => (n.kind === 'card-text' ? { ...n, bold: !t.bold || undefined } : n))}>
              <Bold size={14} />
            </button>
            <button className={'btn btn-ghost' + (t.italic ? ' is-on' : '')} aria-pressed={!!t.italic} title="Italic" onClick={() => patch((n) => (n.kind === 'card-text' ? { ...n, italic: !t.italic || undefined } : n))}>
              <Italic size={14} />
            </button>
            <select className="input" value={t.align ?? 'left'} aria-label="Align" onChange={(e) => patch((n) => (n.kind === 'card-text' ? { ...n, align: e.target.value as CardTextNode['align'] } : n))}>
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </div>
          {colorRow('Text', 'textColor', texts)}
          <p className="cd-muted">Long text shrinks to fit its box. Drag the box handles to change its size. Type :sword:, :heart:, :mana: and other icon names (listed in the Deck tab) to put icons in the text.</p>
        </>
      ) : null}
      {shapes.length ? (
        <>
          <h4>Shape</h4>
          {shapes.some((n) => n.kind !== 'line') ? colorRow('Fill', 'fillColor', shapes.filter((n) => n.kind !== 'line')) : null}
          {colorRow('Outline', 'strokeColor', shapes)}
          <label className="cd-row">
            <span className="cd-label">Outline width</span>
            <input className="input cd-num" type="number" min={0} value={(shapes[0] as { strokeWidth?: number }).strokeWidth ?? 2} onChange={(e) => patch((n) => (shapes.includes(n) ? { ...n, strokeWidth: Math.max(0, Number(e.target.value) || 0) } : n))} />
          </label>
        </>
      ) : null}
      {pictures.length ? (
        <>
          <h4>Picture field</h4>
          <select className="input" value={pictures[0].fieldId} aria-label="Picture field" onChange={(e) => patch((n) => (n.kind === 'card-image' ? { ...n, fieldId: e.target.value } : n))}>
            {d.fields
              .filter((f) => f.kind === 'image')
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </>
      ) : null}
    </div>
  )
}

/** The bleed typed in mm or in pixels (counted at 300 DPI); it's always stored in mm. */
export function BleedInput({ mm, unit = 'mm', onChange }: { mm: number; unit?: 'mm' | 'px'; onChange(mm: number, unit: 'mm' | 'px'): void }) {
  const px = unit === 'px'
  return (
    <>
      <NumberInput
        className="input cd-num"
        min={0}
        step={px ? 1 : 0.5}
        aria-label={`Bleed in ${px ? 'pixels' : 'millimetres'}`}
        value={px ? bleedMmToPx(mm) : Math.round(mm * 1000) / 1000}
        onChange={(n) => {
          const v = Math.max(0, n)
          onChange(px ? bleedPxToMm(v) : v, unit)
        }}
      />
      <select className="input cd-num" value={unit} aria-label="Bleed unit" title="Pixels are counted at 300 DPI, the print resolution" onChange={(e) => onChange(mm, e.target.value as 'mm' | 'px')}>
        <option value="mm">mm</option>
        <option value="px">px</option>
      </select>
    </>
  )
}

export function CardPanel({ d, update }: { d: CardDoc; update: Update }) {
  const preset = CARD_SIZES.find((s) => s.w === d.widthMm && s.h === d.heightMm)?.id ?? ''
  const num = (label: string, value: number, set: (v: number) => void, min = 0) => (
    <label className="cd-row">
      <span className="cd-label">{label}</span>
      <NumberInput className="input cd-num" min={min} step={0.5} value={value} onChange={(v) => set(Math.max(min, v))} />
      mm
    </label>
  )
  return (
    <div className="cd-panel">
      <select
        className="input"
        value={preset}
        aria-label="Card size"
        onChange={(e) => {
          const s = CARD_SIZES.find((x) => x.id === e.target.value)
          if (s) update((x) => resizeDesign(x, s.w, s.h))
        }}
      >
        <option value="">Custom</option>
        {CARD_SIZES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {num('Width', d.widthMm, (v) => update((x) => resizeDesign(x, v, x.heightMm)), 10)}
      {num('Height', d.heightMm, (v) => update((x) => resizeDesign(x, x.widthMm, v)), 10)}
      <div className="cd-row">
        <span className="cd-label">Bleed</span>
        <BleedInput mm={d.bleedMm} unit={d.bleedUnit} onChange={(mm, unit) => update((x) => ({ ...(x.bleedScales ? { ...x, bleedMm: mm } : setBleed(x, mm)), bleedUnit: unit }))} />
      </div>
      <label className="cd-row" title="Off: the bleed prints exactly what you design there (draw or place art out to the red dashed line)">
        <input type="checkbox" checked={d.bleedStretch !== false} onChange={(e) => update((x) => ({ ...x, bleedStretch: e.target.checked }))} />
        Fill empty bleed from the card's edge
      </label>
      <label className="cd-row" title="On: the outermost pixels of the card (at the cut line) are stretched over the whole bleed in every print export, even where you placed art in the bleed">
        <input type="checkbox" checked={!!d.bleedEdge} onChange={(e) => update((x) => ({ ...x, bleedEdge: e.target.checked || undefined }))} />
        Stretch the card's edge over the whole bleed
      </label>
      <label className="cd-row" title="On: when you change the bleed, exports scale your art evenly so it still covers the bleed line. Text stays where you put it and the design in the editor never changes; turn it off to go back.">
        <input
          type="checkbox"
          checked={!!d.bleedScales}
          onChange={(e) =>
            update((x) =>
              e.target.checked
                ? { ...x, bleedScales: true, bleedScaleFromMm: x.bleedMm }
                : // Off: grow the background from the bleed the design was made for, like a normal bleed change.
                  { ...setBleed({ ...x, bleedMm: x.bleedScaleFromMm ?? x.bleedMm }, x.bleedMm), bleedScales: false, bleedScaleFromMm: undefined },
            )
          }
        />
        Scale the art with the bleed (exports only)
      </label>
      {num('Corner', d.cornerMm, (v) => update((x) => ({ ...x, cornerMm: v })))}
      <p className="cd-muted">
        Changing the size scales the whole design. The solid line is where the card is cut. Art should reach the red dashed bleed line, so no white edge shows if the cut is a little off; every print export adds the bleed around the card (pixels count at 300 DPI). Keep text inside the blue safe line.
      </p>
    </div>
  )
}

/** The Export section: opens the export window, or repeats the last export with its saved choices. */
export function ExportPanel({ d, deckId, title, cards, root, currentId, update }: { d: CardDoc; deckId: Id; title: string; cards: Card[]; root: string | null; currentId: Id | null; update: Update }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const s = exportSettings(d)
  const again = async () => {
    if (!(await confirmBig(s))) return
    setBusy(true)
    setError(null)
    try {
      const chosen = exportCards(s, cards, currentId)
      if (await runExport({ d, title, cards: chosen, root }, s)) update((x) => logExport(x, s, chosen.length), { undoable: false })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  // v0.26: the shown card's front as a picture, for the Asset Pool, Moodboard and the other Send to targets.
  const card = cards.find((c) => c.id === currentId) ?? cards[0]
  const nameField = d.fields.find((f) => f.name.toLowerCase() === 'name') ?? d.fields.find((f) => f.kind !== 'image')
  const cardTitle = (card && nameField && card.values[nameField.id]?.trim()) || title
  const cardPicture = async () => {
    if (!card) return null
    const { paint } = await cardPainter(d, [card], root)
    return new Promise<Blob | null>((res) => paint(card, 'front', 300).toBlob(res, 'image/png'))
  }
  return (
    <div className="cd-panel">
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Export…
      </button>
      {card ? <SendMenu title={cardTitle} picture={cardPicture} label="Send this card to…" /> : null}
      {d.exportSettings ? (
        <button className="btn" disabled={busy} title="Export again with the same choices" onClick={() => void again()}>
          {busy ? 'Exporting…' : `Again: ${targetLabel(s)}`}
        </button>
      ) : null}
      <p className="cd-muted">Print at home, print shops, Tabletop Simulator, Godot or data, with a preview and the bleed added on export.</p>
      {error ? (
        <p className="cd-error" role="alert">
          {error}
        </p>
      ) : null}
      {open ? <ExportDialog d={d} deckId={deckId} title={title} cards={cards} root={root} currentId={currentId} update={update} onClose={() => setOpen(false)} /> : null}
    </div>
  )
}
