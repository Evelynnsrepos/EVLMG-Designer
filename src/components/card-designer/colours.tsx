import { Link2, Trash, Unlink2 } from 'lucide-react'
import { useState } from 'react'
import { newId, type Id } from '@/core/model'
import type { Scene } from '@/shared/canvas'
import { ColorPanel } from '@/shared/sketch/ColorPanel'
import { MM, setOverride, slotColors, type Card, type CardDoc, type CardNode, type SlotKeys } from './model'
import { colorOf } from './panels'
import { sideScene, TEXT, type OnScene, type Side, type Update } from './ui'

/**
 * Colours (0.24), at the top of the left column: the card backgrounds, colour slots with a chain to unlink a
 * slot for the shown card only, the colour wheel for the picked slot, the card's variant and the variants list.
 */
export function ColoursSection({ d, card, update, onScene, activeLayerId, side }: { d: CardDoc; card: Card | null; update: Update; onScene: OnScene; activeLayerId: Id | undefined; side: Side }) {
  const [picked, setPicked] = useState<Id | null>(null)
  const colors = slotColors(d, card?.variantId, card?.id)
  const own = (card && d.overrides?.[card.id]?.colors) || {}
  const slot = d.slots.find((s) => s.id === picked)

  const setSlot = (id: Id, patch: Partial<CardDoc['slots'][number]>) => {
    update((x) => {
      const slots = x.slots.map((s) => (s.id === id ? { ...s, ...patch } : s))
      if (!patch.color) return { ...x, slots }
      // Keep the stored colours in step, so the template looks right everywhere it is shown.
      const recolor = (s: Scene<CardNode>) => ({ ...s, nodes: s.nodes.map((n) => applySlotColor(n, id, patch.color!)) })
      return { ...x, slots, front: recolor(x.front), back: recolor(x.back) }
    })
  }
  const setColor = (id: Id, color: string) => {
    if (card && own[id]) update((x) => setOverride(x, card.id, (o) => ({ ...o, colors: { ...o.colors, [id]: color } })))
    else setSlot(id, { color })
  }
  const toggleLink = (id: Id) => {
    if (!card) return
    update((x) =>
      setOverride(x, card.id, (o) => {
        const { [id]: was, ...rest } = o.colors ?? {}
        return { ...o, colors: was ? rest : { ...rest, [id]: colors.get(id)! } }
      }),
    )
  }

  return (
    <div className="cd-panel">
      <span className="cd-sub">Card background</span>
      {(['front', 'back'] as const).map((sd) => (
        <SideColor key={sd} d={d} side={sd} update={update} />
      ))}

      <span className="cd-sub">Colour slots</span>
      {d.slots.map((s) => {
        const linked = !own[s.id]
        return (
          <div key={s.id} className={'cd-row cd-slot' + (picked === s.id ? ' is-on' : '')}>
            <button className="cd-swatch" style={{ background: colors.get(s.id) }} title="Pick this colour" aria-label={`Pick ${s.name}`} aria-pressed={picked === s.id} onClick={() => setPicked(picked === s.id ? null : s.id)} />
            <input className="input" aria-label="Slot name" value={s.name} onChange={(e) => setSlot(s.id, { name: e.target.value })} />
            <button
              className={'btn btn-ghost cd-chain' + (linked ? '' : ' is-off')}
              disabled={!card}
              title={linked ? 'Linked: the same on every card. Click to give this card its own colour.' : 'This card has its own colour. Click to link it to the deck again.'}
              aria-label={linked ? 'Unlink for this card' : 'Link to all cards'}
              aria-pressed={!linked}
              onClick={() => toggleLink(s.id)}
            >
              {linked ? <Link2 size={14} /> : <Unlink2 size={14} />}
            </button>
            <span className={'cd-scope' + (linked ? ' is-all' : '')} title={linked ? 'Applies to all cards' : 'Only this card'}>
              {linked ? '✓ all' : 'this card'}
            </span>
            <button
              className="btn btn-ghost"
              title="Delete slot"
              aria-label="Delete slot"
              onClick={() => update((x) => ({ ...x, slots: x.slots.filter((y) => y.id !== s.id), front: dropSlot(x.front, s.id), back: dropSlot(x.back, s.id) }))}
            >
              <Trash size={14} />
            </button>
          </div>
        )
      })}
      {slot ? <ColorPanel color={colors.get(slot.id)!} setColor={(c) => setColor(slot.id, c)} swatches={d.slots.map((s) => s.color)} /> : null}
      <button className="btn" onClick={() => update((x) => ({ ...x, slots: [...x.slots, { id: newId(), name: `Colour ${x.slots.length + 1}`, color: '#888888' }] }))}>
        + Slot
      </button>

      <span className="cd-sub">Variant</span>
      <select
        className="input"
        disabled={!card || !!d.sheet}
        value={card?.variantId ?? ''}
        aria-label="Variant of this card"
        title={d.sheet ? 'Set by the Variant column of the Spreadsheet' : 'Other colours for some slots, e.g. one per faction or rarity'}
        onChange={(e) => card && update((x) => ({ ...x, cards: x.cards.map((c) => (c.id === card.id ? { ...c, variantId: e.target.value || undefined } : c)) }))}
      >
        <option value="">Base colours</option>
        {d.variants.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      <details className="cd-details">
        <summary>Edit variants ({d.variants.length})</summary>
        <Variants d={d} update={update} />
      </details>
      <details className="cd-details">
        <summary>Recolour a whole layer</summary>
        <RecolourLayer d={d} onScene={onScene} activeLayerId={activeLayerId} side={side} />
      </details>
    </div>
  )
}

function Variants({ d, update }: { d: CardDoc; update: Update }) {
  return (
    <>
      {d.variants.map((v) => (
        <div key={v.id} className="cd-variant">
          <div className="cd-row">
            <input className="input" aria-label="Variant name" value={v.name} onChange={(e) => update((x) => ({ ...x, variants: x.variants.map((y) => (y.id === v.id ? { ...y, name: e.target.value } : y)) }))} />
            <button className="btn btn-ghost" title="Delete variant" aria-label="Delete variant" onClick={() => update((x) => ({ ...x, variants: x.variants.filter((y) => y.id !== v.id), cards: x.cards.map((c) => (c.variantId === v.id ? { ...c, variantId: undefined } : c)) }))}>
              <Trash size={14} />
            </button>
          </div>
          {d.slots.map((s) => {
            const own = v.colors.find((c) => c.slotId === s.id)
            const set = (color: string | null) =>
              update((x) => ({
                ...x,
                variants: x.variants.map((y) => (y.id === v.id ? { ...y, colors: [...y.colors.filter((c) => c.slotId !== s.id), ...(color ? [{ slotId: s.id, color }] : [])] } : y)),
              }))
            return (
              <label key={s.id} className="cd-row cd-indent">
                <input type="checkbox" checked={!!own} onChange={(e) => set(e.target.checked ? s.color : null)} />
                <span className="cd-label">{s.name}</span>
                {own ? <input type="color" aria-label={`${s.name} in ${v.name}`} value={own.color} onChange={(e) => set(e.target.value)} /> : null}
              </label>
            )
          })}
        </div>
      ))}
      <button className="btn" onClick={() => update((x) => ({ ...x, variants: [...x.variants, { id: newId(), name: `Variant ${x.variants.length + 1}`, colors: [] }] }))}>
        + Variant
      </button>
    </>
  )
}

function RecolourLayer({ d, onScene, activeLayerId, side }: { d: CardDoc; onScene: OnScene; activeLayerId: Id | undefined; side: Side }) {
  const [layerSlot, setLayerSlot] = useState<Id | ''>('')
  const [layerColor, setLayerColor] = useState('#000000')
  const layer = sideScene(d, side).layers.find((l) => l.id === activeLayerId)
  const recolorLayer = () => {
    if (!layer || layer.locked) return
    const color = layerSlot ? d.slots.find((s) => s.id === layerSlot)!.color : layerColor
    const slot = layerSlot || undefined
    onScene((s) => ({
      ...s,
      nodes: s.nodes.map((n) => {
        if (n.layerId !== layer.id || n.locked) return n
        if (n.kind === 'card-text') return { ...n, textColor: color, textSlotId: slot }
        if (n.kind === 'line') return { ...n, strokeColor: color, strokeSlotId: slot }
        if (n.kind === 'rect' || n.kind === 'ellipse') return n.fillColor || n.fillSlotId ? { ...n, fillColor: color, fillSlotId: slot } : { ...n, strokeColor: color, strokeSlotId: slot }
        return n
      }),
    }))
  }
  return (
    <div className="cd-row">
      <select className="input" value={layerSlot} aria-label="Colour for the layer" onChange={(e) => setLayerSlot(e.target.value)}>
        <option value="">{TEXT.fixed}</option>
        {d.slots.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {layerSlot ? null : <input type="color" aria-label="Colour" value={layerColor} onChange={(e) => setLayerColor(e.target.value)} />}
      <button className="btn" disabled={!layer || layer.locked} title={layer?.locked ? 'This layer is locked' : `Recolour “${layer?.name ?? ''}”`} onClick={recolorLayer}>
        Apply
      </button>
    </div>
  )
}

/** The side's background: the shape named Background, else the first filled rectangle on the bottom layer. */
function backgroundOf(s: Scene<CardNode>) {
  return s.nodes.find((n) => n.name === 'Background' && n.kind === 'rect') ?? s.nodes.find((n) => n.layerId === s.layers[0]?.id && n.kind === 'rect' && n.fillColor)
}

function SideColor({ d, side, update }: { d: CardDoc; side: Side; update: Update }) {
  const bg = backgroundOf(sideScene(d, side)) as (CardNode & SlotKeys) | undefined
  const set = (patch: { fillColor?: string; fillSlotId?: Id }) =>
    update((x) => {
      const s = sideScene(x, side)
      const cur = backgroundOf(s)
      const b = x.bleedMm * MM
      const nodes = cur
        ? s.nodes.map((n) => (n === cur ? { ...n, ...patch } : n))
        : [{ id: newId(), kind: 'rect', layerId: s.layers[0].id, x: -b, y: -b, width: x.widthMm * MM + 2 * b, height: x.heightMm * MM + 2 * b, strokeWidth: 0, name: 'Background', ...patch } as CardNode, ...s.nodes]
      return { ...x, [side]: { ...s, nodes } }
    })
  const label = side === 'front' ? 'Front' : 'Back'
  return (
    <div className="cd-row">
      <span className="cd-label">{label}</span>
      <select
        className="input"
        value={bg?.fillSlotId ?? ''}
        aria-label={`${label} background colour slot`}
        onChange={(e) => {
          const slot = d.slots.find((x) => x.id === e.target.value)
          set({ fillSlotId: slot?.id, ...(slot ? { fillColor: slot.color } : {}) })
        }}
      >
        <option value="">{TEXT.fixed}</option>
        {d.slots.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      {bg?.fillSlotId ? null : <input type="color" aria-label={`${label} background colour`} value={bg ? colorOf(bg, 'fillColor') : '#ffffff'} onChange={(e) => set({ fillColor: e.target.value, fillSlotId: undefined })} />}
    </div>
  )
}

function applySlotColor(n: CardNode, slotId: Id, color: string): CardNode {
  const c = n as CardNode & SlotKeys & { textSlotId?: Id }
  if (c.fillSlotId !== slotId && c.strokeSlotId !== slotId && c.textSlotId !== slotId) return n
  return {
    ...n,
    ...(c.fillSlotId === slotId ? { fillColor: color } : {}),
    ...(c.strokeSlotId === slotId ? { strokeColor: color } : {}),
    ...(c.textSlotId === slotId ? { textColor: color } : {}),
  }
}

/** A deleted slot leaves its last colour behind as a fixed colour. */
function dropSlot(s: Scene<CardNode>, slotId: Id): Scene<CardNode> {
  return {
    ...s,
    nodes: s.nodes.map((n) => {
      const c = n as CardNode & SlotKeys & { textSlotId?: Id }
      if (c.fillSlotId !== slotId && c.strokeSlotId !== slotId && c.textSlotId !== slotId) return n
      return { ...n, fillSlotId: c.fillSlotId === slotId ? undefined : c.fillSlotId, strokeSlotId: c.strokeSlotId === slotId ? undefined : c.strokeSlotId, textSlotId: c.textSlotId === slotId ? undefined : c.textSlotId }
    }),
  }
}

