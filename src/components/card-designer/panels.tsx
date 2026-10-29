import { Bold, Italic } from 'lucide-react'
import { zipSync } from 'fflate'
import { useState } from 'react'
import { assetUrl } from '@/core/assets'
import { saveBinaryFile, saveTextFile, safeFileName } from '@/core/export'
import type { Id } from '@/core/model'
import { updateNodes } from '@/shared/canvas'
import { confirmDialog } from '@/shared/dialogs'
import { cssFamily, systemFonts } from '@/shared/fontList'
import { canvasBytes, drawSheets, PAGE_SIZES, sheetLayout, sheetsToPdf } from '@/shared/print'
import { CARD_SIZES, composeScene, deckJson, expandCopies, resizeDesign, slotColors, ttsSheets, type Card, type CardDoc, type CardImageNode, type CardNode, type CardTextNode, type SlotKeys } from './model'
import { cardNodeTypes } from './nodeTypes'
import { loadSceneFonts, preloadImages, renderCard } from './render'
import { allNodes, cardLabel, ownIcons, TEXT, type OnScene, type Update } from './ui'

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


export function CardPanel({ d, update }: { d: CardDoc; update: Update }) {
  const preset = CARD_SIZES.find((s) => s.w === d.widthMm && s.h === d.heightMm)?.id ?? ''
  const num = (label: string, value: number, set: (v: number) => void, min = 0) => (
    <label className="cd-row">
      <span className="cd-label">{label}</span>
      <input className="input cd-num" type="number" min={min} step={0.5} value={value} onChange={(e) => set(Math.max(min, Number(e.target.value) || 0))} />
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
      {num('Bleed', d.bleedMm, (v) => update((x) => ({ ...x, bleedMm: v })))}
      {num('Corner', d.cornerMm, (v) => update((x) => ({ ...x, cornerMm: v })))}
      <p className="cd-muted">
        Changing the size scales the whole design. The solid line is where the card is cut. Art should reach the red dashed bleed line, so no white edge shows if the cut is a little off. Keep text inside the blue safe line.
      </p>
    </div>
  )
}

/** Foil masks go to print shops black on white. */
function onWhite(src: HTMLCanvasElement) {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(src, 0, 0)
  return c
}

export function ExportPanel({ d, title, cards, root }: { d: CardDoc; title: string; cards: Card[]; root: string | null }) {
  const [paper, setPaper] = useState('a4')
  const [dpi, setDpi] = useState(300)
  const [backs, setBacks] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = safeFileName(title)

  /** Draw every card (each card once, by id), fronts and backs. */
  const renderAll = async (withBleed: boolean, res: number, mask = false) => {
    await loadSceneFonts([d.front, d.back, { layers: [], nodes: allNodes(d) }])
    const imageFields = d.fields.filter((f) => f.kind === 'image').map((f) => f.id)
    const paths = [
      ...cards.flatMap((c) => imageFields.map((f) => c.values[f] ?? '')),
      ...allNodes(d).flatMap((n) => (n.kind === 'image' ? [n.src] : [])),
      ...(d.icons ?? []).map((i) => i.src),
    ]
    const resolve = await preloadImages(paths, (p) => (root ? assetUrl(root, p) : Promise.resolve(null)))
    const fronts = new Map<Id, HTMLCanvasElement>()
    const backsMap = new Map<Id, HTMLCanvasElement>()
    for (const c of cards) {
      const types = cardNodeTypes({ colors: slotColors(d, c.variantId, c.id), fields: d.fields, values: c.values, print: true, icons: ownIcons(d), mask })
      fronts.set(c.id, renderCard(d, composeScene(d, 'front', c.id), types, resolve, res, withBleed))
      backsMap.set(c.id, renderCard(d, composeScene(d, 'back', c.id), types, resolve, res, withBleed))
    }
    return { fronts, backs: backsMap }
  }

  const run = (label: string, job: () => Promise<unknown>) => async () => {
    setBusy(label)
    setError(null)
    try {
      await job()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const hasFoil = allNodes(d).some((n) => n.foil)

  const sheets = async (mask = false) => {
    const page = PAGE_SIZES.find((p) => p.id === paper)!
    const layout = sheetLayout(page, { w: d.widthMm, h: d.heightMm }, d.bleedMm)
    if (!layout.slots.length) throw new Error('The card is bigger than the paper.')
    const r = await renderAll(true, dpi, mask)
    const deck = expandCopies(cards)
    return { layout, pages: drawSheets(layout, deck.map((c) => r.fronts.get(c.id)!), dpi, d.bleedMm, backs ? deck.map((c) => r.backs.get(c.id)!) : undefined) }
  }

  const pdf = run('Print sheets (PDF)', async () => {
    const { layout, pages } = await sheets()
    await saveBinaryFile({ title: 'Export print sheets', defaultName: `${name} print.pdf`, bytes: await sheetsToPdf(layout, pages), filter: { name: 'PDF', extensions: ['pdf'] } })
  })
  const foilPdf = run('Foil mask sheets', async () => {
    const { layout, pages } = await sheets(true)
    await saveBinaryFile({ title: 'Export foil mask sheets', defaultName: `${name} foil mask.pdf`, bytes: await sheetsToPdf(layout, pages), filter: { name: 'PDF', extensions: ['pdf'] } })
  })
  const png = run('Print sheets (PNG)', async () => {
    const { pages } = await sheets()
    if (pages.length === 1) return saveBinaryFile({ title: 'Export print sheet', defaultName: `${name} print.png`, bytes: await canvasBytes(pages[0]), filter: { name: 'PNG', extensions: ['png'] } })
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < pages.length; i++) files[`page ${String(i + 1).padStart(2, '0')}.png`] = await canvasBytes(pages[i])
    await saveBinaryFile({ title: 'Export print sheets', defaultName: `${name} print pages.zip`, bytes: zipSync(files, { level: 0 }), filter: { name: 'Zip', extensions: ['zip'] } })
  })
  const deckImage = run('Deck image', async () => {
    const r = await renderAll(false, Math.min(dpi, 200))
    const deck = expandCopies(cards).map((c) => r.fronts.get(c.id)!)
    if (!deck.length) throw new Error('The deck has no cards.')
    // One picture of the whole deck, 10 cards per row (the grid tabletop simulators read).
    const cols = Math.min(10, deck.length)
    const rows = Math.ceil(deck.length / cols)
    const out = document.createElement('canvas')
    out.width = cols * deck[0].width
    out.height = rows * deck[0].height
    const g = out.getContext('2d')!
    deck.forEach((c, i) => g.drawImage(c, (i % cols) * c.width, Math.floor(i / cols) * c.height))
    await saveBinaryFile({ title: 'Export deck image', defaultName: `${name} deck.png`, bytes: await canvasBytes(out), filter: { name: 'PNG', extensions: ['png'] } })
  })
  const zip = run('Card images + JSON', async () => {
    const r = await renderAll(false, dpi)
    const files: Record<string, Uint8Array> = {}
    const images = new Map<Id, string>()
    const used = new Set<string>()
    for (const c of cards) {
      let base = safeFileName(cardLabel(d, c), 'card')
      for (let n = 2; used.has(base); n++) base = `${safeFileName(cardLabel(d, c), 'card')} ${n}`
      used.add(base)
      images.set(c.id, `cards/${base}.png`)
      files[`cards/${base}.png`] = await canvasBytes(r.fronts.get(c.id)!)
      files[`cards/${base} back.png`] = await canvasBytes(r.backs.get(c.id)!)
    }
    if (hasFoil) {
      const m = await renderAll(false, dpi, true)
      for (const c of cards) {
        const base = images.get(c.id)!.replace(/\.png$/, '')
        files[`${base} foil.png`] = await canvasBytes(onWhite(m.fronts.get(c.id)!))
        files[`${base} back foil.png`] = await canvasBytes(onWhite(m.backs.get(c.id)!))
      }
    }
    files['deck.json'] = new TextEncoder().encode(JSON.stringify(deckJson(title, d, cards, images), null, 2))
    await saveBinaryFile({ title: 'Export cards', defaultName: `${name} cards.zip`, bytes: zipSync(files, { level: 0 }), filter: { name: 'Zip', extensions: ['zip'] } })
  })
  const tts = run('Tabletop Simulator', async () => {
    const deck = expandCopies(cards)
    const plan = ttsSheets(deck.length)
    if (!plan.length) throw new Error('The deck has no cards.')
    // Keep each sheet within 4096 px, the size Tabletop Simulator loads quickly.
    const res = Math.min(200, Math.floor((4096 * 25.4) / Math.max(...plan.map((p) => Math.max(p.cols * d.widthMm, p.rows * d.heightMm)))))
    const r = await renderAll(false, res)
    const backSides = deck.map((c) => r.backs.get(c.id)!)
    const uniqueBacks = new Set(cards.map((c) => r.backs.get(c.id)!.toDataURL())).size > 1
    const files: Record<string, Uint8Array> = {}
    const sheet = (sides: HTMLCanvasElement[], cols: number, rows: number) => {
      const out = document.createElement('canvas')
      out.width = cols * sides[0].width
      out.height = rows * sides[0].height
      const g = out.getContext('2d')!
      sides.forEach((c, i) => g.drawImage(c, (i % cols) * c.width, Math.floor(i / cols) * c.height))
      // The last cell is what Tabletop Simulator shows for a hidden card.
      g.drawImage(backSides[0], (cols - 1) * backSides[0].width, (rows - 1) * backSides[0].height)
      return canvasBytes(out)
    }
    let start = 0
    for (const [i, p] of plan.entries()) {
      const part = plan.length > 1 ? ` ${i + 1}` : ''
      const grid = `${p.cols}x${p.rows} - ${p.count} cards`
      files[`${name} faces${part} - ${grid}.png`] = await sheet(deck.slice(start, start + p.count).map((c) => r.fronts.get(c.id)!), p.cols, p.rows)
      if (uniqueBacks) files[`${name} backs${part} - ${grid}.png`] = await sheet(backSides.slice(start, start + p.count), p.cols, p.rows)
      start += p.count
    }
    if (!uniqueBacks) files[`${name} back.png`] = await canvasBytes(backSides[0])
    await saveBinaryFile({ title: 'Export for Tabletop Simulator', defaultName: `${name} Tabletop Simulator.zip`, bytes: zipSync(files, { level: 0 }), filter: { name: 'Zip', extensions: ['zip'] } })
  })
  const json = run('Deck JSON', () => saveTextFile({ title: 'Export deck', defaultName: `${name}.json`, text: JSON.stringify(deckJson(title, d, cards), null, 2), filter: { name: 'JSON', extensions: ['json'] } }))

  const confirmBig = async (job: () => Promise<void>) => {
    if (dpi < 600 || (await confirmDialog({ title: 'Export at 600 DPI?', message: 'Very sharp, but slow and big files. 300 DPI is what most printers need.', confirmLabel: 'Export' }))) await job()
  }

  return (
    <div className="cd-panel">
      <label className="cd-row">
        <span className="cd-label">Paper</span>
        <select className="input" value={paper} onChange={(e) => setPaper(e.target.value)}>
          {PAGE_SIZES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="cd-row">
        <span className="cd-label">Resolution</span>
        <select className="input" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
          <option value={150}>150 DPI (draft)</option>
          <option value={300}>300 DPI (print)</option>
          <option value={600}>600 DPI</option>
        </select>
      </label>
      <label className="cd-row">
        <input type="checkbox" checked={backs} onChange={(e) => setBacks(e.target.checked)} />
        Backs on every other page (double-sided)
      </label>
      <p className="cd-muted">{TEXT.exportHint}</p>
      <button className="btn btn-primary" disabled={!!busy} onClick={() => void confirmBig(pdf)}>
        Print sheets (PDF)
      </button>
      <button className="btn" disabled={!!busy} onClick={() => void confirmBig(png)}>
        Print sheets (PNG)
      </button>
      {hasFoil ? (
        <>
          <button className="btn" disabled={!!busy} onClick={() => void confirmBig(foilPdf)}>
            Foil mask sheets (PDF)
          </button>
          <p className="cd-muted">Black where the foil goes, laid out like the print sheets. Print shops use it as the foil layer.</p>
        </>
      ) : null}
      <h4>Images and data</h4>
      <button className="btn" disabled={!!busy} onClick={() => void deckImage()}>
        Deck image (all cards in one PNG)
      </button>
      <button className="btn" disabled={!!busy} onClick={() => void confirmBig(zip)}>
        Card images + JSON (ZIP)
      </button>
      <button className="btn" disabled={!!busy} onClick={() => void json()}>
        Deck JSON
      </button>
      <button className="btn" disabled={!!busy} onClick={() => void tts()}>
        Tabletop Simulator (ZIP)
      </button>
      <p className="cd-muted">{TEXT.ttsHint}</p>
      {busy ? <p className="cd-muted" role="status">Exporting {busy}…</p> : null}
      {error ? (
        <p className="cd-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

