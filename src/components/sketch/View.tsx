import { Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore } from '@/core/state'
import { CANVAS_PRESETS, createSketchDoc, SketchEditor, type SketchDoc } from '@/shared/sketch'
import { CARD_SIZES, mmToPx } from '@/shared/print'
import { useInputSettings } from '@/shared/sketch/inputSettings'
import { promptDialog } from '@/shared/dialogs'
import { IMAGE_TARGETS, sendImageTo } from '@/shell/editor/actions'
import './sketch-tool.css'

const UI = {
  newTitle: 'New drawing',
  newHint: 'Pick a canvas size. You can draw with a mouse or a pen tablet; pen pressure changes the line.',
  width: 'Width',
  height: 'Height',
  start: 'Start drawing',
  savePreset: 'Save this size',
  presetName: 'Name for this canvas size',
  removePreset: 'Remove this size',
  mine: 'My sizes',
  cards: 'Card sizes (300 DPI, 3 mm bleed; the guide lines show the cut and the safe area)',
  cardGuides: 'Card guide lines',
  send: 'Send to…',
  sent: (to: string) => `Sent to ${to}`,
}

/** A sketch document; `started` is false until the canvas size is chosen. */
interface SketchToolDoc extends SketchDoc {
  started: boolean
}

const createDoc = (): SketchToolDoc => ({ ...createSketchDoc(), started: false })

/** Sketch (v0.5): a drawing tool with pressure brushes, layers, selection and mirror. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<SketchToolDoc>('sketch', documentId!, createDoc)
  const title = useProjectStore((s) => s.meta?.documents.find((d) => d.id === documentId)?.title ?? 'Draw')
  if (!doc.data) return null
  if (!doc.data.started) return <SizePicker onStart={(width, height, cardGuides) => doc.update((d) => ({ ...d, ...createSketchDoc(width, height), cardGuides, started: true }))} />
  const guides = doc.data.cardGuides
  return (
    <SketchEditor
      panel={
        guides && (
          <label className="sketch-row">
            <input type="checkbox" checked={guides.visible !== false} onChange={(e) => doc.update((d) => ({ ...d, cardGuides: { ...guides, visible: e.target.checked } }))} />
            {UI.cardGuides}
          </label>
        )
      }
      doc={doc.data}
      update={(fn) => doc.update((d) => ({ ...d, ...fn(d) }), { undoable: false })}
      active={active}
      title={title}
      actions={(flatten) => <SendMenu title={title} flatten={flatten} />}
    />
  )
}

/** Card canvases at print resolution, bleed included. */
const CARD_DPI = 300
const CARD_BLEED_MM = 3
const cardPx = (mm: number) => mmToPx(mm + 2 * CARD_BLEED_MM, CARD_DPI)
const CARD_GUIDES = { bleed: mmToPx(CARD_BLEED_MM, CARD_DPI), safe: mmToPx(3, CARD_DPI), corner: mmToPx(3, CARD_DPI) }

function SizePicker({ onStart }: { onStart: (w: number, h: number, cardGuides?: SketchDoc['cardGuides']) => void }) {
  const [w, setW] = useState(1920)
  const [h, setH] = useState(1080)
  const [isCard, setIsCard] = useState(false)
  const clamp = (v: number) => Math.max(16, Math.min(8192, Math.round(v) || 16))
  const mine = useInputSettings((s) => s.canvasPresets)
  useEffect(() => {
    void useInputSettings.getState().load()
  }, [])
  const savePreset = async () => {
    const name = (await promptDialog(UI.presetName, `${clamp(w)} × ${clamp(h)}`))?.trim()
    if (!name) return
    const list = useInputSettings.getState().canvasPresets.filter((c) => c.name !== name)
    useInputSettings.getState().update({ canvasPresets: [...list, { name, width: clamp(w), height: clamp(h) }] })
  }
  return (
    <div className="sketch-start">
      <h2>{UI.newTitle}</h2>
      <p className="muted">{UI.newHint}</p>
      <div className="sketch-start-presets">
        {CANVAS_PRESETS.map((p) => (
          <button
            key={p.label}
            className={`btn${p.width === w && p.height === h ? ' btn-primary' : ''}`}
            onClick={() => {
              setW(p.width)
              setH(p.height)
              setIsCard(false)
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="muted sketch-start-mine">{UI.cards}</p>
      <div className="sketch-start-presets">
        {CARD_SIZES.map((c) => (
          <button
            key={c.id}
            className={`btn${isCard && cardPx(c.w) === w && cardPx(c.h) === h ? ' btn-primary' : ''}`}
            onClick={() => {
              setW(cardPx(c.w))
              setH(cardPx(c.h))
              setIsCard(true)
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
      {mine.length > 0 && (
        <>
          <p className="muted sketch-start-mine">{UI.mine}</p>
          <div className="sketch-start-presets">
            {mine.map((p) => (
              <span key={p.name} className="sketch-start-preset">
                <button
                  className={`btn${p.width === w && p.height === h ? ' btn-primary' : ''}`}
                  onClick={() => {
                    setW(p.width)
                    setH(p.height)
                    setIsCard(false)
                  }}
                >
                  {p.name} <span className="muted">{p.width} × {p.height}</span>
                </button>
                <button
                  className="icon-btn"
                  title={UI.removePreset}
                  onClick={() => useInputSettings.getState().update({ canvasPresets: mine.filter((x) => x.name !== p.name) })}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        </>
      )}
      <div className="sketch-start-size">
        <label>
          {UI.width}
          <input className="input" type="number" min={16} max={8192} value={w} onChange={(e) => setW(Number(e.target.value))} />
        </label>
        ×
        <label>
          {UI.height}
          <input className="input" type="number" min={16} max={8192} value={h} onChange={(e) => setH(Number(e.target.value))} />
        </label>
        <button className="btn" onClick={() => void savePreset()}>
          {UI.savePreset}
        </button>
      </div>
      <button className="btn btn-primary" onClick={() => onStart(clamp(w), clamp(h), isCard ? CARD_GUIDES : undefined)}>
        {UI.start}
      </button>
    </div>
  )
}

function SendMenu({ title, flatten }: { title: string; flatten: () => Promise<Blob> }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  return (
    <span className="sketch-send">
      <button className="btn btn-ghost sketch-send-btn" title={UI.send} onClick={() => setOpen(!open)}>
        <Send size={15} /> {UI.send}
      </button>
      {open && (
        <div className="menu" style={{ top: '100%', left: 0 }} onMouseLeave={() => setOpen(false)}>
          {IMAGE_TARGETS.map((t) => (
            <button
              key={t.type}
              onClick={async () => {
                setOpen(false)
                await sendImageTo(t.type, await flatten(), title)
                setNote(UI.sent(t.label))
                setTimeout(() => setNote(null), 3000)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {note && <span className="sketch-send-note">{note}</span>}
    </span>
  )
}
