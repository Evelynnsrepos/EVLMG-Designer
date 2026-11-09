import { useState } from 'react'
import { importAssetFromBlob } from '@/core/assets'
import { safeFileName, saveBinaryFile, saveTextFile } from '@/core/export'
import { postIntent } from '@/core/state'
import { PAGE_SIZES } from '@/shared/print'
import { canEncodeVideo } from '@/shared/sketch/files/io'
import { Modal } from '@/shared/ui'
import { openComponent } from '@/shell/editor/actions'
import { animaticVideo, picturesZip, pitchSlides, prepare, scriptMarkdown, SHEET_KINDS, sheetsPdf, shotListCsv, type SheetKind } from './exporting'
import { fpsOf, type StoryboardDoc } from './model'

type Kind = 'pdf' | 'video' | 'pitch' | 'csv' | 'script' | 'pictures'

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: 'pdf', label: 'Print / PDF', hint: 'Storyboard sheets to print, share with the team or put in a pitch.' },
  { id: 'video', label: 'Animatic video', hint: 'The board played with its timing, as a video file (WebM) or GIF. Upload it, or put it in your video editor under the real sound.' },
  { id: 'pitch', label: 'Pitch Deck', hint: 'One slide per cut with its picture, what happens and the dialogue, added to the Pitch Deck.' },
  { id: 'csv', label: 'Shot list (CSV)', hint: 'Every panel as a row: scene, cut, timing, camera, text, status. Opens in the Spreadsheet, Excel or LibreOffice.' },
  { id: 'script', label: 'Script (Markdown)', hint: 'A readable shooting script: scenes, cuts, camera, action and dialogue.' },
  { id: 'pictures', label: 'Pictures (ZIP)', hint: 'Every panel as a PNG named by scene and cut (S01_C003_B.png), for an editor or animation app.' },
]

const PAPERS = PAGE_SIZES.filter((p) => p.id === 'a4' || p.id === 'letter' || p.id === 'a3')

const UI = {
  title: 'Export the storyboard',
  layout: 'Layout',
  paper: 'Paper',
  format: 'Format',
  subtitles: 'Dialogue as subtitles',
  burnIn: 'Scene, cut and timecode in the corner (for review copies)',
  noVideo: 'This system can’t make video files here, so the animatic is saved as a GIF.',
  noSound: 'The video has no sound yet. Put it in a video editor with your sound, or use Play animatic to watch it with sound.',
  export: 'Export',
  cancel: 'Close',
  working: (done: number, total: number) => `Getting the panels ready… ${done} / ${total}`,
  encoding: (done: number, total: number) => `Making the video… ${done} / ${total}`,
  saved: 'Saved.',
  sent: (n: number) => `Added ${n} slide${n === 1 ? '' : 's'} to the Pitch Deck.`,
  failed: (e: string) => `That didn’t work: ${e}`,
}

export function ExportDialog({ root, doc, title, onClose }: { root: string; doc: StoryboardDoc; title: string; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('pdf')
  const [sheet, setSheet] = useState<SheetKind>('columns')
  const [paper, setPaper] = useState('a4')
  const [format, setFormat] = useState<'webm' | 'gif'>('webm')
  const [subtitles, setSubtitles] = useState(true)
  const [burnIn, setBurnIn] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fps = fpsOf(doc)
  const name = safeFileName(title, 'Storyboard')

  const run = async () => {
    setBusy(true)
    try {
      const items = await prepare(root, doc, (d, t) => setNote(UI.working(d, t)))
      let ok = true
      if (kind === 'pdf') {
        const p = PAPERS.find((x) => x.id === paper) ?? PAPERS[0]
        const bytes = await sheetsPdf(items, doc, { kind: sheet, paper: { w: p.w, h: p.h }, title, fps })
        ok = await saveBinaryFile({ title: UI.title, defaultName: `${name}.pdf`, bytes, filter: { name: 'PDF', extensions: ['pdf'] } })
      } else if (kind === 'video') {
        const file = await animaticVideo(items, doc, { format, subtitles, burnIn, fps }, (d) => setNote(UI.encoding(d, items.length)))
        ok = await saveBinaryFile({ title: UI.title, defaultName: `${name}.${file.ext}`, bytes: file.bytes, filter: file.filter })
      } else if (kind === 'csv') {
        ok = await saveTextFile({ title: UI.title, defaultName: `${name} shot list.csv`, text: shotListCsv(items, fps), filter: { name: 'CSV', extensions: ['csv'] } })
      } else if (kind === 'script') {
        ok = await saveTextFile({ title: UI.title, defaultName: `${name} script.md`, text: scriptMarkdown(items, title, fps), filter: { name: 'Markdown', extensions: ['md'] } })
      } else if (kind === 'pictures') {
        ok = await saveBinaryFile({ title: UI.title, defaultName: `${name} panels.zip`, bytes: await picturesZip(items), filter: { name: 'ZIP', extensions: ['zip'] } })
      } else {
        const slides = []
        for (const s of pitchSlides(items, doc)) {
          // Own copies: a drawing's picture file is replaced whenever it is drawn on.
          const blob = s.picture && (await new Promise<Blob | null>((r) => s.picture!.toBlob(r, 'image/png')))
          const asset = blob ? await importAssetFromBlob(root, blob, 'image', `${s.title}.png`) : null
          slides.push({ title: s.title, text: s.text, image: asset?.path ?? null })
        }
        postIntent('pitch', { action: 'add-slides', slides })
        openComponent('pitch')
        setNote(UI.sent(slides.length))
        return
      }
      setNote(ok ? UI.saved : null)
    } catch (e) {
      setNote(UI.failed(e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="sb-pick sb-export">
        <h3>{UI.title}</h3>
        <div className="sb-export-kinds">
          {KINDS.map((k) => (
            <button key={k.id} className={`sb-export-kind${kind === k.id ? ' on' : ''}`} onClick={() => setKind(k.id)}>
              <strong>{k.label}</strong>
              <span className="muted">{k.hint}</span>
            </button>
          ))}
        </div>
        {kind === 'pdf' && (
          <div className="sb-two">
            <label className="ld-field">
              <span>{UI.layout}</span>
              <select className="input" value={sheet} onChange={(e) => setSheet(e.target.value as SheetKind)}>
                {SHEET_KINDS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ld-field">
              <span>{UI.paper}</span>
              <select className="input" value={paper} onChange={(e) => setPaper(e.target.value)}>
                {PAPERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted sb-small">{SHEET_KINDS.find((s) => s.id === sheet)?.hint}</span>
          </div>
        )}
        {kind === 'video' && (
          <>
            <label className="ld-field">
              <span>{UI.format}</span>
              <select className="input" value={format} onChange={(e) => setFormat(e.target.value as 'webm' | 'gif')}>
                <option value="webm">WebM video</option>
                <option value="gif">GIF</option>
              </select>
            </label>
            <label className="sb-check">
              <input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} /> {UI.subtitles}
            </label>
            <label className="sb-check">
              <input type="checkbox" checked={burnIn} onChange={(e) => setBurnIn(e.target.checked)} /> {UI.burnIn}
            </label>
            {format === 'webm' && !canEncodeVideo() && <p className="sb-warn">{UI.noVideo}</p>}
            <p className="muted sb-small">{UI.noSound}</p>
          </>
        )}
        {note && <p className="sb-note">{note}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {UI.cancel}
          </button>
          <button className="btn btn-primary" disabled={busy || !doc.frames.length} onClick={() => void run()}>
            {UI.export}
          </button>
        </div>
      </div>
    </Modal>
  )
}
