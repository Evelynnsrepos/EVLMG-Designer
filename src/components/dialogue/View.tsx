import { Download, Flag as FlagIcon, Play, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Character, Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { AssetImage } from '@/shared/AssetImage'
import { confirmDialog } from '@/shared/dialogs'
import { saveTextFile, safeFileName } from '@/core/export'
import { applyChange, ChangesEditor, checkCondition, ConditionsEditor, FlagsEditor, useFlags, type Flag } from '@/shared/flags'
import { FlowGraph } from '@/shared/graph'
import { Modal } from '@/shared/ui'
import { actorScript, createDialogueDoc, exportInk, exportJson, exportYarn, newChoice, newLine, unreachable, type Choice, type DialogueDoc, type Line } from './model'
import './dialogue.css'

const T = {
  addLine: 'New line',
  start: 'Start here',
  isStart: 'Start',
  play: 'Play',
  export: 'Export',
  flags: 'Flags',
  empty: 'A conversation is a set of lines. Make the first one with New line; add choices to branch.',
  speaker: 'Speaker',
  narrator: 'Not a character:',
  text: 'What is said',
  next: 'Then',
  end: 'End of the conversation',
  choices: 'Player choices',
  addChoice: 'Add choice',
  choiceText: 'Choice text',
  goesTo: 'goes to',
  newTarget: 'New line…',
  onlyIf: 'Only said if',
  onSay: 'When said, set',
  choiceIf: 'Only offered if',
  choiceSet: 'When picked, set',
  deleteLine: 'Delete line',
  unreachable: 'Nothing leads here',
  restart: 'Start over',
  close: 'Close',
  continue: 'Continue',
  theEnd: 'The conversation ended.',
  flagState: 'Flags now',
}

const shortText = (t: string) => (t.length > 40 ? `${t.slice(0, 39)}…` : t)

/** Dialogue Editor (v0.7). */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<DialogueDoc>('dialogue', documentId!, createDialogueDoc)
  useUndoRedoKeys(doc, active)
  const characters = useProjectStore((s) => s.entities.character) as Character[]
  const title = useProjectStore((s) => s.meta?.documents.find((x) => x.id === documentId)?.title ?? 'Dialogue')
  const { flags } = useFlags()
  const [selectedId, setSelectedId] = useState<Id | null>(null)
  const [playing, setPlaying] = useState(false)
  const [showFlags, setShowFlags] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const d = doc.data
  const lost = useMemo(() => (d ? unreachable(d) : new Set<Id>()), [d])
  if (!d) return null

  const speakerOf = (l: Line) => (l.speakerId ? characters.find((c) => c.id === l.speakerId)?.name || '(deleted)' : l.speakerName || 'Narrator')
  const edit = (id: Id, patch: Partial<Line>) => doc.update((x) => ({ ...x, lines: x.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  const addLine = (after?: { lineId: Id; choiceId?: Id }) => {
    const prev = after ? d.lines.find((l) => l.id === after.lineId) : undefined
    // Alternate speakers: answering a character defaults to the player and back.
    const line = newLine(prev?.speakerId ? null : (characters[0]?.id ?? null))
    if (prev?.speakerId) line.speakerName = 'Player'
    doc.update((x) => ({
      startId: x.startId ?? line.id,
      lines: [
        ...x.lines.map((l) => {
          if (!after || l.id !== after.lineId) return l
          if (after.choiceId) return { ...l, choices: l.choices.map((c) => (c.id === after.choiceId ? { ...c, to: line.id } : c)) }
          return { ...l, next: line.id }
        }),
        line,
      ],
    }))
    setSelectedId(line.id)
  }
  const remove = async (l: Line) => {
    if (!(await confirmDialog({ title: T.deleteLine, message: 'Links to this line end the conversation instead. You can undo with Ctrl+Z.', confirmLabel: 'Delete', danger: true }))) return
    doc.update((x) => ({
      startId: x.startId === l.id ? (x.lines.find((y) => y.id !== l.id)?.id ?? null) : x.startId,
      lines: x.lines
        .filter((y) => y.id !== l.id)
        .map((y) => ({ ...y, next: y.next === l.id ? null : y.next, choices: y.choices.map((c) => (c.to === l.id ? { ...c, to: null } : c)) })),
    }))
    setSelectedId(null)
  }
  const line = d.lines.find((l) => l.id === selectedId) ?? null

  const exportAs = async (kind: 'json' | 'yarn' | 'ink' | 'script') => {
    setExportOpen(false)
    if (kind === 'script') {
      await saveTextFile({ title: 'Export actor script', defaultName: `${safeFileName(title)}-actor-script.csv`, text: actorScript(d, title, speakerOf), filter: { name: 'CSV', extensions: ['csv'] } })
      return
    }
    const text = kind === 'json' ? exportJson(d, flags, speakerOf) : kind === 'yarn' ? exportYarn(d, flags, speakerOf) : exportInk(d, flags, speakerOf)
    const ext = { json: 'json', yarn: 'yarn', ink: 'ink' }[kind]
    await saveTextFile({ title: `Export as ${kind}`, defaultName: `${safeFileName(title)}.${ext}`, text, filter: { name: kind.toUpperCase(), extensions: [ext] } })
  }

  return (
    <div className="dlg">
      <div className="dlg-toolbar">
        <button className="btn btn-primary" onClick={() => addLine()}>
          <Plus size={14} /> {T.addLine}
        </button>
        <button className="btn" disabled={!d.startId} onClick={() => setPlaying(true)}>
          <Play size={14} /> {T.play}
        </button>
        <span className="dlg-export">
          <button className="btn" disabled={d.lines.length === 0} onClick={() => setExportOpen(!exportOpen)}>
            <Download size={14} /> {T.export}
          </button>
          {exportOpen && (
            <div className="menu" style={{ top: '100%', left: 0 }} onMouseLeave={() => setExportOpen(false)}>
              <button onClick={() => void exportAs('json')}>JSON (for your own game code)</button>
              <button onClick={() => void exportAs('yarn')}>Yarn Spinner (Unity, Godot)</button>
              <button onClick={() => void exportAs('ink')}>Ink (inkle)</button>
              <button onClick={() => void exportAs('script')}>Actor script for voice recording (CSV)</button>
            </div>
          )}
        </span>
        <button className={`btn btn-ghost${showFlags ? ' is-active' : ''}`} onClick={() => setShowFlags(!showFlags)}>
          <FlagIcon size={14} /> {T.flags}
        </button>
      </div>
      <div className="dlg-body">
        <div className="dlg-graph">
          {showFlags ? (
            <FlagsEditor />
          ) : d.lines.length === 0 ? (
            <p className="muted">{T.empty}</p>
          ) : (
            <FlowGraph
              starts={d.startId ? [d.startId] : undefined}
              nodes={d.lines.map((l) => ({
                id: l.id,
                label: `${l.id === d.startId ? '▶ ' : ''}${speakerOf(l)}`,
                sub: shortText(l.text) || '…',
                muted: lost.has(l.id),
                color: l.speakerId ? '#3e8ef7' : undefined,
              }))}
              edges={d.lines.flatMap((l) => [
                ...(l.choices.length === 0 && l.next ? [{ from: l.id, to: l.next }] : []),
                ...l.choices.filter((c) => c.to).map((c) => ({ from: l.id, to: c.to!, label: c.text })),
              ])}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </div>
        {line && (
          <LineEditor
            line={line}
            doc={d}
            characters={characters}
            isStart={d.startId === line.id}
            unreachable={lost.has(line.id)}
            speakerOf={speakerOf}
            onEdit={(patch) => edit(line.id, patch)}
            onStart={() => doc.update((x) => ({ ...x, startId: line.id }))}
            onRemove={() => void remove(line)}
            onSelect={setSelectedId}
            onAddLine={(choiceId) => addLine({ lineId: line.id, choiceId })}
          />
        )}
      </div>
      {playing && d.startId && <PlayThrough doc={d} flags={flags} characters={characters} speakerOf={speakerOf} onClose={() => setPlaying(false)} />}
    </div>
  )
}

function LineSelect({ doc, value, exclude, speakerOf, onChange, onNew }: { doc: DialogueDoc; value: Id | null; exclude?: Id; speakerOf: (l: Line) => string; onChange: (id: Id | null) => void; onNew: () => void }) {
  return (
    <select
      className="input"
      value={value ?? ''}
      onChange={(e) => (e.target.value === '__new' ? onNew() : onChange(e.target.value || null))}
    >
      <option value="">{T.end}</option>
      {doc.lines
        .filter((l) => l.id !== exclude)
        .map((l) => (
          <option key={l.id} value={l.id}>
            {speakerOf(l)}: {shortText(l.text) || '…'}
          </option>
        ))}
      <option value="__new">{T.newTarget}</option>
    </select>
  )
}

function LineEditor(p: {
  line: Line
  doc: DialogueDoc
  characters: Character[]
  isStart: boolean
  unreachable: boolean
  speakerOf: (l: Line) => string
  onEdit: (patch: Partial<Line>) => void
  onStart: () => void
  onRemove: () => void
  onSelect: (id: Id) => void
  onAddLine: (choiceId?: Id) => void
}) {
  const { line, onEdit } = p
  const setChoice = (id: Id, patch: Partial<Choice>) => onEdit({ choices: line.choices.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  const speaker = p.characters.find((c) => c.id === line.speakerId)
  return (
    <aside className="dlg-editor">
      <div className="dlg-editor-head">
        {speaker && <AssetImage path={speaker.image} alt={speaker.name} size={40} />}
        <select className="input" value={line.speakerId ?? ''} onChange={(e) => onEdit({ speakerId: e.target.value || null })}>
          <option value="">{T.narrator}</option>
          {p.characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || 'Untitled'}
            </option>
          ))}
        </select>
        {!line.speakerId && <input className="input" value={line.speakerName} placeholder="Narrator, Player…" onChange={(e) => onEdit({ speakerName: e.target.value })} />}
        <span style={{ flex: 1 }} />
        {p.isStart ? (
          <span className="dlg-badge">{T.isStart}</span>
        ) : (
          <button className="btn btn-ghost" onClick={p.onStart}>
            {T.start}
          </button>
        )}
        <button className="icon-btn" title={T.deleteLine} onClick={p.onRemove}>
          <Trash2 size={15} />
        </button>
      </div>
      {p.unreachable && <p className="dlg-warn">{T.unreachable}</p>}
      <textarea className="input dlg-text" placeholder={T.text} value={line.text} autoFocus onChange={(e) => onEdit({ text: e.target.value })} />
      <div className="ld-inline">
        <input className="input" style={{ flex: 2 }} placeholder="Voice direction (whispered, out of breath…)" value={line.direction ?? ''} onChange={(e) => onEdit({ direction: e.target.value })} />
        <input className="input" style={{ flex: 1 }} placeholder="Voice file (automatic)" title="Name of the recording; empty = conversation, line number and speaker" value={line.voiceFile ?? ''} onChange={(e) => onEdit({ voiceFile: e.target.value })} />
      </div>

      <section className="dlg-section">
        <h4>{T.choices}</h4>
        {line.choices.map((c) => (
          <div key={c.id} className="dlg-choice">
            <div className="dlg-row">
              <input className="input dlg-choice-text" placeholder={T.choiceText} value={c.text} onChange={(e) => setChoice(c.id, { text: e.target.value })} />
              <span className="muted">{T.goesTo}</span>
              <LineSelect doc={p.doc} value={c.to} exclude={line.id} speakerOf={p.speakerOf} onChange={(to) => setChoice(c.id, { to })} onNew={() => p.onAddLine(c.id)} />
              {c.to && (
                <button className="btn btn-ghost" onClick={() => p.onSelect(c.to!)}>
                  →
                </button>
              )}
              <button className="icon-btn" title="Remove choice" onClick={() => onEdit({ choices: line.choices.filter((x) => x.id !== c.id) })}>
                <X size={13} />
              </button>
            </div>
            <ConditionsEditor label={T.choiceIf} value={c.conditions} onChange={(conditions) => setChoice(c.id, { conditions })} />
            <ChangesEditor label={T.choiceSet} value={c.changes} onChange={(changes) => setChoice(c.id, { changes })} />
          </div>
        ))}
        <button className="btn btn-ghost dlg-add" onClick={() => onEdit({ choices: [...line.choices, newChoice()] })}>
          <Plus size={13} /> {T.addChoice}
        </button>
      </section>

      {line.choices.length === 0 && (
        <section className="dlg-section">
          <h4>{T.next}</h4>
          <div className="dlg-row">
            <LineSelect doc={p.doc} value={line.next} exclude={line.id} speakerOf={p.speakerOf} onChange={(next) => onEdit({ next })} onNew={() => p.onAddLine()} />
            {line.next && (
              <button className="btn btn-ghost" onClick={() => p.onSelect(line.next!)}>
                →
              </button>
            )}
          </div>
        </section>
      )}

      <section className="dlg-section">
        <ConditionsEditor label={T.onlyIf} value={line.conditions} onChange={(conditions) => onEdit({ conditions })} />
        <ChangesEditor label={T.onSay} value={line.changes} onChange={(changes) => onEdit({ changes })} />
      </section>
    </aside>
  )
}

/** Play the conversation like a player would, with the flags changing as you go. */
function PlayThrough({ doc, flags, characters, speakerOf, onClose }: { doc: DialogueDoc; flags: Flag[]; characters: Character[]; speakerOf: (l: Line) => string; onClose: () => void }) {
  const initial = () => Object.fromEntries(flags.map((f) => [f.id, f.initial]))
  const [state, setState] = useState<Record<Id, number>>(initial)
  const [currentId, setCurrentId] = useState<Id | null>(() => doc.startId)
  const [log, setLog] = useState<{ speaker: string; text: string; choice?: boolean }[]>([])
  const byId = new Map(doc.lines.map((l) => [l.id, l]))

  // Skip lines whose conditions fail, applying each said line's changes once (when arriving).
  const enter = (id: Id | null, st: Record<Id, number>, guard = 0): { id: Id | null; st: Record<Id, number> } => {
    if (!id || guard > 200) return { id: null, st }
    const l = byId.get(id)
    if (!l) return { id: null, st }
    if (!l.conditions.every((c) => checkCondition(c, st))) return enter(l.next, st, guard + 1)
    return { id, st: l.changes.reduce((s, c) => applyChange(c, s), st) }
  }
  const [started, setStarted] = useState(false)
  if (!started) {
    const first = enter(doc.startId, state)
    setStarted(true)
    setCurrentId(first.id)
    setState(first.st)
  }
  const line = currentId ? byId.get(currentId) : undefined
  const choices = line ? line.choices.filter((c) => c.conditions.every((x) => checkCondition(x, state))) : []
  const go = (to: Id | null, st: Record<Id, number>, said?: string) => {
    if (line) setLog((l) => [...l, { speaker: speakerOf(line), text: line.text }, ...(said ? [{ speaker: 'You', text: said, choice: true }] : [])])
    const next = enter(to, st)
    setCurrentId(next.id)
    setState(next.st)
  }
  const portrait = line?.speakerId ? characters.find((c) => c.id === line.speakerId) : undefined
  return (
    <Modal onClose={onClose}>
      <div className="dlg-play">
        <div className="dlg-play-log">
          {log.map((x, i) => (
            <p key={i} className={x.choice ? 'dlg-play-choice' : ''}>
              <strong>{x.speaker}:</strong> {x.text}
            </p>
          ))}
        </div>
        {line ? (
          <div className="dlg-play-now">
            {portrait && <AssetImage path={portrait.image} alt={portrait.name} size={64} />}
            <div>
              <strong>{speakerOf(line)}</strong>
              <p>{line.text}</p>
              <div className="dlg-play-choices">
                {line.choices.length === 0 ? (
                  <button className="btn btn-primary" onClick={() => go(line.next, state)}>
                    {T.continue}
                  </button>
                ) : (
                  choices.map((c) => (
                    <button key={c.id} className="btn" onClick={() => go(c.to, c.changes.reduce((s, x) => applyChange(x, s), state), c.text)}>
                      {c.text || '…'}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="muted">{T.theEnd}</p>
        )}
        {flags.length > 0 && (
          <p className="muted dlg-play-flags">
            {T.flagState}: {flags.map((f) => `${f.name} = ${f.kind === 'bool' ? (state[f.id] ? 'yes' : 'no') : (state[f.id] ?? 0)}`).join(', ')}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="btn"
            onClick={() => {
              setLog([])
              const first = enter(doc.startId, initial())
              setCurrentId(first.id)
              setState(first.st)
            }}
          >
            {T.restart}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            {T.close}
          </button>
        </div>
      </div>
    </Modal>
  )
}
