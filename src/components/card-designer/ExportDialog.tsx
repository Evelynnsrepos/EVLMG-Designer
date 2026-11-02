import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { isTauri } from '@/core/fs'
import type { Id } from '@/core/model'
import { NumberInput } from '@/shared/calculators'
import { confirmDialog } from '@/shared/dialogs'
import { MM_PER_INCH, mmToPx, PAGE_SIZES, sheetLayout } from '@/shared/print'
import { Modal } from '@/shared/ui'
import { exportBleed, exportSettings, homePaper, nearestShopSize, PHOTO_SIZES, PRINT_SHOPS, shopById, shopSize } from './exportFormats'
import { cardPainter, foldPair, gameSide, preflight, printSide, runExport, type Paint, type Warning } from './exporting'
import { expandCopies, SAFE_MM, type Card, type CardDoc, type ExportSettings } from './model'
import { allNodes, cardLabel, TEXT, type Update } from './ui'

type Target = ExportSettings['target']

const TARGETS: { id: Target; name: string; hint: string }[] = [
  { id: 'home', name: 'Print at home', hint: 'Pages full of cards with crop marks' },
  { id: 'shop', name: 'Print shop', hint: 'The files a print shop asks for' },
  { id: 'photo', name: 'Photo station (janky)', hint: 'JPG photos for a photo kiosk, when nothing else works' },
  { id: 'tts', name: 'Tabletop Simulator', hint: 'A deck to play with online' },
  { id: 'godot', name: 'Godot', hint: 'Card pictures and data for your game' },
  { id: 'data', name: 'Data', hint: 'The deck as JSON or a spreadsheet' },
]

export const targetLabel = (s: ExportSettings) => {
  const t = TARGETS.find((x) => x.id === s.target)!.name
  if (s.target === 'home') return `${t} (${s.homeFormat.toUpperCase()})`
  if (s.target === 'shop') return `${t}: ${shopById(s.shop).name}`
  if (s.target === 'data') return `${t} (${s.data.toUpperCase()})`
  return t
}

/** The cards an export takes: all, the open one, or the picked ones. */
export function exportCards(s: ExportSettings, cards: Card[], currentId: Id | null): Card[] {
  if (s.cards === 'this') return cards.filter((c) => c.id === currentId)
  if (s.cards === 'picked') return cards.filter((c) => s.picked.includes(c.id))
  return cards
}

const isPrint = (t: Target) => t === 'home' || t === 'shop' || t === 'photo'

/** Ask before slow 600 DPI exports. */
export const confirmBig = async (s: ExportSettings) =>
  !isPrint(s.target) || s.target === 'photo' || s.dpi < 600 || (s.target === 'shop' && shopById(s.shop).sizes.length > 0) || (await confirmDialog({ title: 'Export at 600 DPI?', message: 'Very sharp, but slow and big files. 300 DPI is what most printers need.', confirmLabel: 'Export' }))

/**
 * The export window: where the deck goes (home printer, print shop, Tabletop Simulator, Godot, data), a preview of
 * exactly what the file gets, and the bleed added on export. Nothing here changes the design; the choices are kept
 * with the deck.
 */
export function ExportDialog({ d, title, cards, root, currentId, update, onClose }: { d: CardDoc; title: string; cards: Card[]; root: string | null; currentId: Id | null; update: Update; onClose(): void }) {
  const [s, setS] = useState(() => exportSettings(d))
  const set = (patch: Partial<ExportSettings>) => {
    const next = { ...s, ...patch }
    setS(next)
    update((x) => ({ ...x, exportSettings: next }), { undoable: false })
  }
  const chosen = exportCards(s, cards, currentId)
  const [shownId, setShownId] = useState<Id | null>(currentId ?? cards[0]?.id ?? null)
  const shown = chosen.find((c) => c.id === shownId) ?? chosen[0]
  const [side, setSide] = useState<'front' | 'back'>('front')
  const [lines, setLines] = useState(true)
  const [painter, setPainter] = useState<{ paint: Paint; resolve: (p: string) => string } | null>(null)
  const [preview, setPreview] = useState<{ url: string; empty: boolean; w: number; h: number } | null>(null)
  const [warnings, setWarnings] = useState<Warning[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasFoil = allNodes(d).some((n) => n.foil)
  const bleed = exportBleed(d, s)
  const shop = shopById(s.shop)
  const exact = s.target === 'shop' && shop.sizes.length ? shopSize(shop, { w: d.widthMm, h: d.heightMm }) : null
  const noShopSize = s.target === 'shop' && shop.sizes.length > 0 && !exact

  useEffect(() => {
    let live = true
    void cardPainter(d, cards, root).then((p) => live && setPainter(p))
    return () => void (live = false)
  }, [d, cards, root])

  useEffect(() => {
    if (!painter || !isPrint(s.target)) return setWarnings([])
    let live = true
    void preflight(d, chosen, painter.resolve).then((w) => live && setWarnings(w))
    return () => void (live = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check when the cards or target change, not on every setting
  }, [painter, d, s.target, s.cards, s.picked])

  // The preview is drawn the way the file is, at a small size.
  useEffect(() => {
    if (!painter || !shown) return setPreview(null)
    const t = setTimeout(() => {
      try {
        const print = isPrint(s.target)
        const dpi = Math.min(150, (420 * MM_PER_INCH) / (d.heightMm + 2 * bleed.totalMm))
        const fold = s.target === 'photo' && s.photoBacks === 'fold'
        const pic = fold
          ? foldPair(printSide(painter.paint, d, s, shown, 'front', dpi), printSide(painter.paint, d, s, shown, 'back', dpi), mmToPx(bleed.totalMm, dpi))
          : print
            ? printSide(painter.paint, d, s, shown, side, dpi)
            : s.target === 'godot' ? gameSide(painter.paint, d, s, shown, side) : painter.paint(shown, side, dpi)
        const c = document.createElement('canvas')
        c.width = pic.width
        c.height = pic.height
        const g = c.getContext('2d')!
        g.drawImage(pic, 0, 0)
        let empty = false
        if (print) {
          const b = mmToPx(bleed.totalMm, dpi)
          const px = g.getImageData(0, 0, c.width, c.height).data
          for (let y = 0; y < c.height && !empty; y++) for (let x = 0; x < c.width; x++) if ((x < b || y < b || x >= c.width - b || y >= c.height - b) && px[(y * c.width + x) * 4 + 3] < 250) { empty = true; break }
          if (lines) {
            const k = dpi / MM_PER_INCH
            const box = (inset: number, colour: string, dash: number[]) => {
              g.strokeStyle = colour
              g.setLineDash(dash)
              g.lineWidth = 1.5
              g.strokeRect(inset * k, inset * k, c.width - 2 * inset * k, c.height - 2 * inset * k)
            }
            if (Math.abs(bleed.addedMm) > 0.01) box(bleed.addedMm, '#e5484d', [6, 4])
            box(bleed.totalMm, '#1c1d22', [])
            box(bleed.totalMm + SAFE_MM, '#3b82f6', [4, 4])
            if (fold) {
              g.strokeStyle = '#1c1d22'
              g.setLineDash([3, 3])
              g.beginPath()
              g.moveTo(c.width / 2, 0)
              g.lineTo(c.width / 2, c.height)
              g.stroke()
            }
          }
        }
        setPreview({ url: c.toDataURL(), empty, w: pic.width, h: pic.height })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }, 150)
    return () => clearTimeout(t)
  }, [painter, d, s, shown, side, lines, bleed.totalMm, bleed.addedMm])

  const go = async (mask: boolean) => {
    if (!(await confirmBig(s))) return
    setBusy(mask ? 'foil masks' : targetLabel(s))
    setError(null)
    try {
      await runExport({ d, title, cards: chosen, root }, s, mask)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const step = (by: number) => {
    const i = chosen.findIndex((c) => c.id === shown?.id)
    const next = chosen[(i + by + chosen.length) % chosen.length]
    if (next) setShownId(next.id)
  }

  const info = useMemo(() => {
    const deckSize = expandCopies(chosen).length
    if (s.target === 'home' || s.target === 'photo') {
      const photo = s.target === 'photo'
      const l = sheetLayout(homePaper(s), { w: (photo && s.photoBacks === 'fold' ? 2 : 1) * d.widthMm, h: d.heightMm }, bleed.totalMm)
      if (!l.slots.length) return photo ? 'The card is bigger than the photo: pick a bigger photo size.' : 'The card is bigger than the paper.'
      const pages = Math.ceil(deckSize / l.slots.length) * ((photo ? s.photoBacks === 'photos' : s.backs) ? 2 : 1)
      if (s.target === 'photo') return `${l.slots.length} card${l.slots.length === 1 ? '' : 's'} per photo, ${pages} photo${pages === 1 ? '' : 's'} for ${deckSize} card${deckSize === 1 ? '' : 's'}.`
      return `${l.slots.length} cards per page (${l.page.w > l.page.h ? 'landscape' : 'portrait'}), ${pages} page${pages === 1 ? '' : 's'} for ${deckSize} card${deckSize === 1 ? '' : 's'}.`
    }
    if (s.target === 'shop') {
      if (exact) return `${exact.name} card, ${exact.w} × ${exact.h} in: every side is ${exact.width} × ${exact.height} px at 300 DPI.`
      const w = d.widthMm + 2 * bleed.totalMm
      const h = d.heightMm + 2 * bleed.totalMm
      return `Every side is ${round(w)} × ${round(h)} mm (${mmToPx(w, s.dpi)} × ${mmToPx(h, s.dpi)} px at ${s.dpi} DPI), ${deckSize} cards.`
    }
    if (s.target === 'godot' && preview) return `Every picture is ${preview.w} × ${preview.h} px, without bleed.`
    return `${deckSize} cards.`
  }, [s, d, chosen, bleed.totalMm, exact, preview])

  const row = (label: string, control: React.ReactNode) => (
    <label className="cd-row">
      <span className="cd-label">{label}</span>
      {control}
    </label>
  )
  const check = (label: string, on: boolean, change: (v: boolean) => void, hint?: string) => (
    <label className="cd-row" title={hint}>
      <input type="checkbox" checked={on} onChange={(e) => change(e.target.checked)} />
      {label}
    </label>
  )
  const dpiSelect = row(
    'Resolution',
    <select className="input" value={s.dpi} onChange={(e) => set({ dpi: Number(e.target.value) })}>
      <option value={150}>150 DPI (draft)</option>
      <option value={300}>300 DPI (print)</option>
      <option value={600}>600 DPI</option>
    </select>,
  )
  const lossless = check('Lossless pictures (sharper small text, bigger file)', s.lossless, (v) => set({ lossless: v }))

  const bleedSection = (
    <fieldset className="cd-export-bleed">
      <legend>Bleed</legend>
      <p className="cd-muted">
        The card's own bleed is {round(bleed.cardMm)} mm (Card size). The export adds bleed around it and never changes the card.
      </p>
      {s.target !== 'shop' || shop.id === 'other' ? (
        row(
          'Added',
          <>
            <NumberInput className="input cd-num" step={0.5} min={-d.bleedMm} value={s.addBleedMm} aria-label="Bleed added on export in millimetres" onChange={(v) => set({ addBleedMm: Math.max(-d.bleedMm, v) })} />
            mm
          </>,
        )
      ) : (
        <p className="cd-row">
          Added: {round(bleed.addedMm)} mm (set by {shop.name})
        </p>
      )}
      <p className="cd-row">
        <strong>Total bleed: {round(bleed.totalMm)} mm</strong>
      </p>
      {bleed.addedMm < -0.001 ? <p className="cd-muted">Less than the card's bleed: the export cuts the card's bleed down. To really make the bleed smaller, change it under Card size.</p> : null}
      {bleed.addedMm > 0.001
        ? row(
            'Fill it',
            <>
              <select className="input" value={s.fill} onChange={(e) => set({ fill: e.target.value as ExportSettings['fill'] })} title="How the added bleed is filled">
                <option value="edge">Stretch the edge</option>
                <option value="mirror">Mirror the edge</option>
                <option value="scale">Scale the art (not the text)</option>
                <option value="colour">One colour</option>
              </select>
              {s.fill === 'colour' ? <input type="color" value={s.fillColour} aria-label="Bleed colour" onChange={(e) => set({ fillColour: e.target.value })} /> : null}
            </>,
          )
        : null}
    </fieldset>
  )

  const settings = () => {
    switch (s.target) {
      case 'home':
        return (
          <>
            {row(
              'Paper',
              <select className="input" value={s.paper} onChange={(e) => set({ paper: e.target.value })}>
                {PAGE_SIZES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="custom">Custom size</option>
              </select>,
            )}
            {s.paper === 'custom' ? (
              <div className="cd-row">
                <NumberInput className="input cd-num" min={50} value={s.paperW} aria-label="Paper width in millimetres" onChange={(v) => set({ paperW: v })} />×
                <NumberInput className="input cd-num" min={50} value={s.paperH} aria-label="Paper height in millimetres" onChange={(v) => set({ paperH: v })} />
                mm
              </div>
            ) : null}
            {row(
              'File',
              <select className="input" value={s.homeFormat} onChange={(e) => set({ homeFormat: e.target.value as 'pdf' | 'png' })}>
                <option value="pdf">PDF</option>
                <option value="png">PNG pictures</option>
              </select>,
            )}
            {dpiSelect}
            {check('Backs on every other page (double-sided)', s.backs, (v) => set({ backs: v }))}
            {s.backs ? (
              <div className="cd-row" title="If your printer prints the back side a little off, move the backs by that much (right and down are positive)">
                <span className="cd-label">Move backs</span>
                →<NumberInput className="input cd-num" step={0.5} value={s.backX} aria-label="Move backs right in millimetres" onChange={(v) => set({ backX: v })} />
                ↓<NumberInput className="input cd-num" step={0.5} value={s.backY} aria-label="Move backs down in millimetres" onChange={(v) => set({ backY: v })} />
                mm
              </div>
            ) : null}
            {s.homeFormat === 'pdf' ? lossless : null}
            <p className="cd-muted">{TEXT.exportHint}</p>
            {bleedSection}
          </>
        )
      case 'photo':
        return (
          <>
            <p className="cd-janky">{TEXT.photoHint}</p>
            {row(
              'Photo size',
              <select className="input" value={s.photo} onChange={(e) => set({ photo: e.target.value })}>
                {PHOTO_SIZES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>,
            )}
            {row(
              'Backs',
              <select className="input" value={s.photoBacks} onChange={(e) => set({ photoBacks: e.target.value as ExportSettings['photoBacks'] })}>
                <option value="fold">Next to the front: fold in the middle</option>
                <option value="photos">On extra photos: cut and glue on</option>
                <option value="none">No backs</option>
              </select>,
            )}
            <div className="cd-row" title="Print one photo, measure a card between the crop marks and type its width here; the next export scales to make up for it. 0 = as designed.">
              <span className="cd-label">Measured width</span>
              <NumberInput className="input cd-num" min={0} step={0.1} value={s.photoMeasuredMm} aria-label="Measured card width in millimetres" onChange={(v) => set({ photoMeasuredMm: Math.max(0, v) })} />
              mm (should be {round(d.widthMm)}; 0 = not measured yet)
            </div>
            {bleedSection}
          </>
        )
      case 'shop':
        return (
          <>
            {row(
              'Print shop',
              <select className="input" value={s.shop} onChange={(e) => set({ shop: e.target.value })}>
                {PRINT_SHOPS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>,
            )}
            <p className="cd-muted">{shop.hint}</p>
            {noShopSize ? <NoShopSize d={d} shopId={shop.id} /> : null}
            {shop.id === 'other'
              ? row(
                  'File',
                  <select className="input" value={s.shopFormat} onChange={(e) => set({ shopFormat: e.target.value as 'pdf' | 'png' })}>
                    <option value="pdf">PDF, one card per page</option>
                    <option value="png">PNG for every card side (ZIP)</option>
                  </select>,
                )
              : null}
            {shop.sizes.length ? null : dpiSelect}
            {(shop.id === 'other' ? s.shopFormat : shop.format) === 'pdf' ? (
              <>
                {check('Backs (each front is followed by its back)', s.backs, (v) => set({ backs: v }))}
                {lossless}
              </>
            ) : null}
            {bleedSection}
          </>
        )
      case 'tts':
        return (
          <>
            {isTauri()
              ? row(
                  'Make',
                  <select className="input" value={s.tts} onChange={(e) => set({ tts: e.target.value as 'ready' | 'zip' })}>
                    <option value="ready">Ready deck (this computer)</option>
                    <option value="zip">Card sheets (ZIP, for online games)</option>
                  </select>,
                )
              : null}
            <p className="cd-muted">{TEXT.ttsHint}</p>
          </>
        )
      case 'godot':
        return (
          <>
            {row(
              'Width',
              <>
                <NumberInput className="input cd-num" min={32} max={4096} step={16} value={s.godotWidth} aria-label="Card width in pixels" onChange={(v) => set({ godotWidth: Math.round(Math.min(4096, Math.max(32, v))) })} />
                px
              </>,
            )}
            {row(
              'Make',
              <select className="input" value={s.godotSheet ? 'sheet' : 'pictures'} onChange={(e) => set({ godotSheet: e.target.value === 'sheet' })}>
                <option value="pictures">A PNG for every card</option>
                <option value="sheet">One sprite sheet + a .tres per card</option>
              </select>,
            )}
            {check('Round corners (see-through)', s.godotRound, (v) => set({ godotRound: v }), 'Uses the Corner size from Card size')}
            {check('Leave out the text (your game draws it from deck.json)', s.godotNoText, (v) => set({ godotNoText: v }))}
            {row('Godot folder', <input className="input" value={s.godotFolder} onChange={(e) => set({ godotFolder: e.target.value })} aria-label="Folder in your Godot project" />)}
            <p className="cd-muted">{TEXT.godotHint}</p>
          </>
        )
      case 'data':
        return row(
          'File',
          <select className="input" value={s.data} onChange={(e) => set({ data: e.target.value as 'json' | 'csv' })}>
            <option value="json">Deck JSON</option>
            <option value="csv">Spreadsheet (CSV)</option>
          </select>,
        )
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="cd-export">
        <header className="cd-export-head">
          <h3>Export “{title}”</h3>
          <button className="btn btn-icon" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <nav className="cd-export-targets" aria-label="Where to">
          {TARGETS.map((t) => (
            <button key={t.id} className={`cd-export-target${s.target === t.id ? ' is-on' : ''}`} aria-pressed={s.target === t.id} onClick={() => set({ target: t.id })}>
              <strong>{t.name}</strong>
              <span className="cd-muted">{t.hint}</span>
            </button>
          ))}
          <div className="cd-export-cards">
              {row(
                'Cards',
                <select className="input" value={s.cards} onChange={(e) => set({ cards: e.target.value as ExportSettings['cards'], picked: s.picked.length ? s.picked : currentId ? [currentId] : [] })}>
                  <option value="all">All cards</option>
                  <option value="this">This card</option>
                  <option value="picked">Pick cards</option>
                </select>,
              )}
              {s.cards === 'picked' ? (
                <ul className="cd-export-picks">
                  {cards.map((c) => (
                    <li key={c.id}>
                      <label>
                        <input type="checkbox" checked={s.picked.includes(c.id)} onChange={(e) => set({ picked: e.target.checked ? [...s.picked, c.id] : s.picked.filter((p) => p !== c.id) })} />
                        {cardLabel(d, c)}
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
          </div>
        </nav>
        <section className="cd-export-preview" aria-label="Preview">
          {s.target === 'data' ? (
            <p className="cd-muted">{s.data === 'json' ? 'Every card with its field values, colours, variant and copies, for game engines and other tools.' : 'One row per card: change it in a spreadsheet program and fill the cards from it again.'}</p>
          ) : preview && shown ? (
            <img src={preview.url} alt={`Preview of ${cardLabel(d, shown)}, ${side}`} />
          ) : (
            <p className="cd-muted">{chosen.length ? 'Drawing the preview…' : 'No cards picked.'}</p>
          )}
          {s.target !== 'data' && shown ? (
            <div className="cd-row cd-export-nav">
              <button className="btn btn-icon" aria-label="Previous card" onClick={() => step(-1)}>
                <ChevronLeft size={16} />
              </button>
              <span>{cardLabel(d, shown)}</span>
              <button className="btn btn-icon" aria-label="Next card" onClick={() => step(1)}>
                <ChevronRight size={16} />
              </button>
              <button className={`btn${side === 'front' ? ' is-on' : ''}`} onClick={() => setSide('front')}>
                Front
              </button>
              <button className={`btn${side === 'back' ? ' is-on' : ''}`} onClick={() => setSide('back')}>
                Back
              </button>
            </div>
          ) : null}
          {isPrint(s.target) ? check('Show the cut line (black), safe line (blue) and the card\'s own bleed (red)', lines, setLines) : null}
          <p className="cd-muted">{info}</p>
          {isPrint(s.target) && preview?.empty ? <p className="cd-warning">This side has empty spots in the bleed: they print white. Let the art reach the bleed, or turn on Fill empty bleed under Card size.</p> : null}
          {warnings.map((w) => (
            <p key={w.text} className="cd-warning">
              {w.text}:{' '}
              {w.cards.slice(0, 8).map((c, i) => (
                <span key={c.id}>
                  {i ? ', ' : ''}
                  <button className="cd-link" onClick={() => setShownId(c.id)}>
                    {cardLabel(d, c)}
                  </button>
                </span>
              ))}
              {w.cards.length > 8 ? ` and ${w.cards.length - 8} more` : ''}
            </p>
          ))}
        </section>
        <section className="cd-export-settings cd-panel" aria-label="Settings">
          {settings()}
        </section>
        <footer className="cd-export-foot">
          {busy ? (
            <span className="cd-muted" role="status">
              Exporting {busy}…
            </span>
          ) : null}
          {error ? (
            <span className="cd-error" role="alert">
              {error}
            </span>
          ) : null}
          {hasFoil && isPrint(s.target) && s.target !== 'photo' ? (
            <button className="btn" disabled={!!busy || noShopSize || !chosen.length} title="Black where the foil goes, laid out like the print export. Print shops use it as the foil layer." onClick={() => void go(true)}>
              Foil masks…
            </button>
          ) : null}
          <button className="btn btn-primary" disabled={!!busy || noShopSize || !chosen.length} onClick={() => void go(false)}>
            Export…
          </button>
        </footer>
      </div>
    </Modal>
  )
}

const round = (v: number) => Math.round(v * 100) / 100

function NoShopSize({ d, shopId }: { d: CardDoc; shopId: string }) {
  const shop = shopById(shopId)
  const near = nearestShopSize(shop, { w: d.widthMm, h: d.heightMm })
  return (
    <p className="cd-error" role="alert">
      {shop.name} has no {round(d.widthMm)} × {round(d.heightMm)} mm card. Nearest: {near.name} ({near.w} × {near.h} in, {round(near.w * MM_PER_INCH)} × {round(near.h * MM_PER_INCH)} mm). Change the card size, or pick a PDF preset.
    </p>
  )
}
