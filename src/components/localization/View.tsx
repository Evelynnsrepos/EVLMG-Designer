import { Check, Download, Plus, ScanText, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { saveTextFile } from '@/core/export'
import type { Entity } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { loadDocumentNow, useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { promptDialog } from '@/shared/dialogs'
import '@/shared/listDetail/listDetail.css'
import { createLocDoc, exportCSV, importCSV, markTranslated, merge, needsUpdate, newString, progress, slug, type Found, type LocDoc, type LocString } from './model'
import './localization.css'

/** Localization string table (v0.10). */
export default function View({ active }: PanelProps) {
  const doc = useDocument<LocDoc>('localization', 'localization', createLocDoc)
  useUndoRedoKeys(doc, active)
  const root = useProjectStore((s) => s.root)
  const entities = useProjectStore((s) => s.entities)
  const documents = useProjectStore((s) => s.meta?.documents ?? [])
  const [filter, setFilter] = useState('')
  const [missing, setMissing] = useState<string>('')
  const [message, setMessage] = useState('')
  const file = useRef<HTMLInputElement>(null)
  if (!doc.data) return null
  const d = doc.data
  const set = (fn: (d: LocDoc) => LocDoc) => doc.update(fn)
  const edit = (id: string, patch: Partial<LocString>) => set((x) => ({ ...x, items: x.items.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const p = progress(d)
  const q = filter.trim().toLowerCase()
  const stale = (s: LocString) => d.languages.some((l) => needsUpdate(d, s, l))
  const staleCount = d.items.filter(stale).length
  const rows = d.items.filter(
    (s) => (!q || `${s.key} ${s.context} ${Object.values(s.values).join(' ')}`.toLowerCase().includes(q)) && (missing === '*stale' ? stale(s) : !missing || !s.values[missing]?.trim()),
  )

  /** Every player-facing text of the project: names and descriptions, quests, dialogue. */
  const collect = async () => {
    if (!root) return
    const found: Found[] = []
    // Same names get _2, _3… so every entry keeps its own key.
    const used = new Map<string, number>()
    const unique = (base: string) => {
      const n = (used.get(base) ?? 0) + 1
      used.set(base, n)
      return n === 1 ? base : `${base}_${n}`
    }
    for (const [type, list] of Object.entries(entities) as [string, Entity[]][]) {
      for (const e of list) {
        const k = unique(`${type}.${slug(e.name)}`)
        found.push({ ref: `${type}:${e.id}.name`, key: `${k}.name`, context: `${type} name`, text: e.name }, { ref: `${type}:${e.id}.description`, key: `${k}.description`, context: `${type} description`, text: e.description })
      }
    }
    {
      const quests = await loadDocumentNow<{ quests?: { id: string; name: string; summary: string; objectives: { id: string; text: string }[] }[] }>(root, 'quests', 'quests', () => ({ quests: [] }))
      for (const qu of quests?.quests ?? []) {
        const k = unique(`quest.${slug(qu.name)}`)
        found.push({ ref: `quest:${qu.id}.name`, key: `${k}.name`, context: 'Quest name', text: qu.name }, { ref: `quest:${qu.id}.summary`, key: `${k}.summary`, context: 'Quest summary', text: qu.summary })
        qu.objectives.forEach((o, i) => found.push({ ref: `quest:${qu.id}.objective:${o.id}`, key: `${k}.objective_${i + 1}`, context: 'Quest objective', text: o.text }))
      }
    }
    for (const dd of documents.filter((x) => x.type === 'dialogue')) {
      const dl = await loadDocumentNow<{ lines?: { id: string; speakerName: string; text: string; choices: { id: string; text: string }[] }[] }>(root, 'dialogue', dd.id, () => ({ lines: [] }))
      const k = unique(`dialogue.${slug(dd.title)}`)
      ;(dl?.lines ?? []).forEach((l, i) => {
        found.push({ ref: `dialogue:${dd.id}:${l.id}`, key: `${k}.line_${i + 1}`, context: `Dialogue "${dd.title}"${l.speakerName ? `, ${l.speakerName}` : ''}`, text: l.text })
        l.choices.forEach((c, j) => found.push({ ref: `dialogue:${dd.id}:${l.id}:choice:${c.id}`, key: `${k}.line_${i + 1}.choice_${j + 1}`, context: `Choice in "${dd.title}"`, text: c.text }))
      })
    }
    const r = merge(d, found)
    set(() => r.doc)
    setMessage(`Collected ${r.added} new and ${r.updated} changed texts.${r.updated ? ' Translations of changed texts are marked "needs update".' : ''}`)
  }

  return (
    <div className="lc">
      <div className="ld-toolbar">
        <button className="btn btn-primary" onClick={() => void collect()} title="Names and descriptions, quests and dialogue lines">
          <ScanText size={14} /> Collect texts from the project
        </button>
        <button className="btn" onClick={() => set((x) => ({ ...x, items: [...x.items, newString(`text.${x.items.length + 1}`)] }))}>
          <Plus size={14} /> Add
        </button>
        <input className="input" style={{ width: 180 }} placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select className="input" style={{ width: 'auto' }} value={missing} onChange={(e) => setMissing(e.target.value)}>
          <option value="">All texts</option>
          {d.languages.map((l) => (
            <option key={l} value={l}>
              Missing in {l}
            </option>
          ))}
          <option value="*stale">Needs update ({staleCount})</option>
        </select>
        <button className="btn btn-ghost" onClick={() => void saveTextFile({ title: 'Export strings', defaultName: 'strings.csv', text: exportCSV(d), filter: { name: 'CSV', extensions: ['csv'] } })}>
          <Download size={14} /> CSV
        </button>
        <button className="btn btn-ghost" onClick={() => file.current?.click()}>
          <Upload size={14} /> Import CSV
        </button>
        <input
          ref={file}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) {
              const text = await f.text()
              set((x) => importCSV(x, text))
              setMessage(`Imported ${f.name}.`)
            }
          }}
        />
        {message && <span className="muted">{message}</span>}
      </div>
      <div className="lc-langs">
        {d.languages.map((l, i) => (
          <span key={l} className="lc-lang">
            <strong>{l}</strong>
            {i === 0 ? <em>source</em> : <span className="lc-progress"><span style={{ width: `${Math.round(p[l] * 100)}%` }} /></span>}
            {i > 0 && `${Math.round(p[l] * 100)}%`}
            {i > 0 && (
              <button className="icon-btn" aria-label={`Remove ${l}`} onClick={() => set((x) => ({ ...x, languages: x.languages.filter((o) => o !== l) }))}>
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        <button
          className="btn btn-ghost"
          onClick={async () => {
            const code = (await promptDialog('Language code (e.g. fr, ja, pt-BR)', ''))?.trim()
            if (code && !d.languages.includes(code)) set((x) => ({ ...x, languages: [...x.languages, code] }))
          }}
        >
          <Plus size={14} /> Language
        </button>
      </div>
      <div className="lc-table-wrap">
        {d.items.length === 0 ? (
          <p className="muted lc-empty">No texts yet. Collect texts from the project gathers names, descriptions, quests and dialogue lines, or add them by hand.</p>
        ) : (
          <table className="lc-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Context</th>
                {d.languages.map((l) => (
                  <th key={l}>{l}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input className="lc-key" value={s.key} onChange={(e) => edit(s.id, { key: e.target.value })} />
                  </td>
                  <td>
                    <input className="lc-ctx" value={s.context} onChange={(e) => edit(s.id, { context: e.target.value })} />
                  </td>
                  {d.languages.map((l) => (
                    <td key={l} className={!s.values[l]?.trim() ? 'lc-missing' : needsUpdate(d, s, l) ? 'lc-stale' : ''} title={needsUpdate(d, s, l) ? `The ${d.languages[0]} text changed after this was translated. It was: "${s.base?.[l]}"` : undefined}>
                      <textarea
                        rows={1}
                        value={s.values[l] ?? ''}
                        onChange={(e) => {
                          const next = { ...s, values: { ...s.values, [l]: e.target.value } }
                          // Typing a translation means it matches today's source; typing the source leaves the rest as they were.
                          set((x) => ({ ...x, items: x.items.map((o) => (o.id === s.id ? (l === d.languages[0] ? next : markTranslated(x, next, [l])) : o)) }))
                        }}
                      />
                      {needsUpdate(d, s, l) && (
                        <button className="icon-btn lc-ok" aria-label="Still right" title="The translation is still right" onClick={() => set((x) => ({ ...x, items: x.items.map((o) => (o.id === s.id ? markTranslated(x, o, [l]) : o)) }))}>
                          <Check size={12} />
                        </button>
                      )}
                    </td>
                  ))}
                  <td>
                    <button className="icon-btn" aria-label="Delete text" onClick={() => set((x) => ({ ...x, items: x.items.filter((o) => o.id !== s.id) }))}>
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
