import { useEffect, useMemo, useRef, useState } from 'react'
import { pickAndImportAssets } from '@/core/assets'
import type { AssetPath, Id } from '@/core/model'
import { useDocument, useProjectStore } from '@/core/state'
import { parseCSV } from '@/shared/csv'
import { Modal } from '@/shared/ui'
import type { CardDoc, SheetLike } from './model'
import { applyImport, guessTargets, missingPictures, ownTextBoxes, pictureKey, sheetRows, type ImportResult, type Target } from './sheetImport'
import { evaluatedSheet } from './sheetValues'
import type { Update } from './ui'

const KINDS = { text: 'text', number: 'number', choice: 'choice list', image: 'picture' } as const

/** Fill cards from a CSV file or a project Spreadsheet: pick the source, map the columns, fill. */
export function ImportDialog({ d, cardId, update, onClose }: { d: CardDoc; cardId: Id | null; update: Update; onClose(): void }) {
  const root = useProjectStore((s) => s.root)
  const spreadsheets = (useProjectStore((s) => s.meta?.documents) ?? []).filter((x) => x.type === 'spreadsheet')
  const [source, setSource] = useState('')
  const [rows, setRows] = useState<string[][] | null>(null)
  const [targets, setTargets] = useState<Target[]>([])
  const [pictures, setPictures] = useState(new Map<string, AssetPath>())
  const [done, setDone] = useState<ImportResult | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const boxes = useMemo(() => ownTextBoxes(d, cardId), [d, cardId])

  const load = (r: string[][]) => {
    setRows(r)
    setTargets(guessTargets(d, r))
  }
  const missing = rows ? missingPictures(d, rows, targets, pictures) : []
  const nameField = d.fields.find((f) => f.kind === 'text')
  const pickPictures = async () => {
    if (!root) return
    const got = await pickAndImportAssets(root, 'image', 'Choose the pictures the sheet names')
    setPictures((p) => new Map([...p, ...got.map((a): [string, AssetPath] => [pictureKey(a.name), a.path])]))
  }
  const fill = () => {
    if (!rows) return
    const r = applyImport(d, rows, targets, cardId, pictures)
    update(() => r.doc)
    setDone(r)
  }

  if (done)
    return (
      <Modal onClose={onClose}>
        <h3>Cards filled</h3>
        <p>
          {done.updated} {done.updated === 1 ? 'card' : 'cards'} updated, {done.added} new. Ctrl+Z undoes it.
        </p>
        {done.newFields.length ? <p className="cd-muted">New fields: {done.newFields.join(', ')}. Type {`{${done.newFields[0]}}`} into a text box to show one on the cards.</p> : null}
        {done.problems.length ? (
          <div className="cd-import-problems" role="alert">
            <p className="cd-error">Not filled ({done.problems.length}):</p>
            <ul>
              {done.problems.slice(0, 30).map((p, i) => (
                <li key={i}>{p}</li>
              ))}
              {done.problems.length > 30 ? <li>…and {done.problems.length - 30} more</li> : null}
            </ul>
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="btn btn-primary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </Modal>
    )

  return (
    <Modal onClose={onClose}>
      <h3>Fill cards from a spreadsheet</h3>
      <p className="cd-muted">
        Each row is a card, row 1 names the columns. Rows with the {nameField?.name ?? 'name'} of a card update that card, other rows become new cards laid out like the open one. Empty cells keep what the card has.
      </p>
      <label className="cd-row">
        <span className="cd-label">From</span>
        <select
          className="input"
          value={source}
          onChange={(e) => {
            setSource(e.target.value)
            setRows(null)
            if (e.target.value === 'file') file.current?.click()
          }}
        >
          <option value="">Choose…</option>
          <option value="file">A CSV file (Excel, LibreOffice, Google Sheets: save or download as CSV)</option>
          {spreadsheets.map((s) => (
            <option key={s.id} value={s.id}>
              Spreadsheet: {s.title}
            </option>
          ))}
        </select>
      </label>
      <input
        ref={file}
        type="file"
        hidden
        accept=".csv,.tsv,.txt,text/csv"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) load(parseCSV(await f.text()))
        }}
      />
      {source === 'file' && !rows ? (
        <button className="btn" onClick={() => file.current?.click()}>
          Choose a CSV file
        </button>
      ) : null}
      {source && source !== 'file' ? <WorkbookRows key={source} documentId={source} onRows={load} /> : null}
      {rows && rows.length < 2 ? <p className="cd-error">This sheet has no rows under the column names.</p> : null}
      {rows && rows.length >= 2 ? (
        <>
          <div className="cd-table-wrap">
            <table className="cd-table cd-import-map">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>First row</th>
                  <th>Goes to</th>
                </tr>
              </thead>
              <tbody>
                {rows[0].map((h, c) => (
                  <tr key={c}>
                    <td>{h || `Column ${c + 1}`}</td>
                    <td className="cd-muted">{rows[1][c] ?? ''}</td>
                    <td>
                      <select className="input" value={targets[c]} aria-label={`Where ${h || `column ${c + 1}`} goes`} onChange={(e) => setTargets(targets.map((t, i) => (i === c ? e.target.value : t)))}>
                        <option value="skip">Skip</option>
                        <optgroup label="Fields">
                          {d.fields.map((f) => (
                            <option key={f.id} value={`field:${f.id}`}>
                              {f.name}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label={`New field “${h || `Column ${c + 1}`}”`}>
                          {Object.entries(KINDS).map(([k, label]) => (
                            <option key={k} value={`new:${k}`}>
                              New {label} field
                            </option>
                          ))}
                        </optgroup>
                        {boxes.length ? (
                          <optgroup label="Boxes with each card’s own text (become this field)">
                            {boxes.map((b) => (
                              <option key={b.key} value={`box:${b.key}`}>
                                {b.label}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                        <option value="copies">Copies</option>
                        {d.variants.length ? <option value="variant">Colour variant</option> : null}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {targets.some((t) => t.startsWith('box:')) ? <p className="cd-muted">A text box picked here shows the column on every card from now on. Cards not in the sheet keep their text as the field’s value.</p> : null}
          {nameField && !targets.includes(`field:${nameField.id}`) ? <p className="cd-muted">No column goes to {nameField.name}, so every row makes a new card.</p> : null}
          {missing.length ? (
            <div className="cd-row">
              <span className="cd-muted">
                {missing.length} {missing.length === 1 ? 'picture is' : 'pictures are'} not in the project yet ({missing.slice(0, 3).join(', ')}
                {missing.length > 3 ? '…' : ''}).
              </span>
              <button className="btn" onClick={() => void pickPictures()}>
                Pick pictures…
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!rows || rows.length < 2} onClick={fill}>
          Fill {rows ? Math.max(0, rows.slice(1).filter((r) => r.some((v) => v?.trim())).length) : ''} cards
        </button>
      </div>
    </Modal>
  )
}

/** A project Spreadsheet's sheet as rows (formulas as their results), with a sheet picker when it has several. */
function WorkbookRows({ documentId, onRows }: { documentId: Id; onRows(rows: string[][]): void }) {
  const wb = useDocument<{ sheets: SheetLike[] }>('spreadsheet', documentId, () => ({ sheets: [] })).data
  const [sheetId, setSheetId] = useState('')
  const sheet = wb?.sheets.find((s) => s.id === sheetId) ?? wb?.sheets[0]
  useEffect(() => {
    if (wb && sheet) onRows(sheetRows(evaluatedSheet(wb.sheets, sheet)))
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- read once per picked sheet, not on every edit
  }, [!!wb, sheet?.id])
  if (!wb || wb.sheets.length < 2) return null
  return (
    <label className="cd-row">
      <span className="cd-label">Sheet</span>
      <select className="input" value={sheet?.id} onChange={(e) => setSheetId(e.target.value)}>
        {wb.sheets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  )
}
