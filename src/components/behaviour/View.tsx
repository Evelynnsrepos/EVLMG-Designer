import { Box, Link2, Play, Plus, Trash2, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Arrow, Group, Rect, Text } from 'react-konva'
import { newId, type Entity, type Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore } from '@/core/state'
import { createAbilitiesDoc, type AbilitiesDoc, type Ability } from '@/components/abilities/model'
import { NumberInput } from '@/shared/calculators'
import { useFlags } from '@/shared/flags'
import { Field, useItems } from '@/shared/listDetail'
import { addNodes, BUILTIN_NODE_TYPES, CanvasEditor, connectorPoints, deleteNodes, getNode, handTool, noteTool, sceneBinding, selectTool, startMove, updateNode, useCanvasState, type CanvasTool, type NodeType } from '@/shared/canvas'
import { commentTool } from '@/shared/reviews'
import { checkGraph, CONDITION_KINDS, describeCondition, isLink, isState, link, linksFrom, minutesOf, newState, STATE_W, STATE_H, statesOf, createBehaviourDoc, type BehaviourDoc, type BehaviourItem, type Condition, type ConditionKind, type LinkNode, type StateNode } from './model'
import './behaviour.css'

/** Arrows sit a little to their own side, so A → B and B → A don't cover each other; the label goes on that side too. */
const linkType: NodeType<LinkNode> = {
  ...BUILTIN_NODE_TYPES.connector,
  render: (n, ctx) => {
    const p = connectorPoints(n, ctx)
    if (!p) return null
    const len = Math.hypot(p[2] - p[0], p[3] - p[1]) || 1
    const nx = (-(p[3] - p[1]) / len) * 8
    const ny = ((p[2] - p[0]) / len) * 8
    const pts = [p[0] + nx, p[1] + ny, p[2] + nx, p[3] + ny]
    const stroke = n.strokeColor ?? ctx.theme.textMuted
    const mid = { x: (pts[0] + pts[2]) / 2 + nx * 1.6, y: (pts[1] + pts[3]) / 2 + ny * 1.6 }
    return (
      <>
        <Arrow points={pts} stroke={stroke} fill={stroke} strokeWidth={2} pointerLength={10} pointerWidth={10} hitStrokeWidth={14} lineCap="round" />
        {n.label ? (
          Math.abs(nx) > Math.abs(ny) ? (
            <Text x={nx > 0 ? mid.x : mid.x - 160} y={mid.y - 6} width={160} align={nx > 0 ? 'left' : 'right'} text={n.label} fontSize={12} fontFamily={ctx.theme.font} fill={ctx.theme.textMuted} />
          ) : (
            <Text x={mid.x - 80} y={mid.y - (ny < 0 ? 16 : 0)} width={160} align="center" text={n.label} fontSize={12} fontFamily={ctx.theme.font} fill={ctx.theme.textMuted} />
          )
        ) : null}
      </>
    )
  },
}

/** Behaviour Designer (missing tools phase 5). */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<BehaviourDoc>('behaviour', documentId!, createBehaviourDoc)
  const canvas = useCanvasState()
  const flags = useFlags()
  const abilities = useItems<Ability, AbilitiesDoc>('abilities', 'abilities', createAbilitiesDoc).items
  const enemies = useProjectStore((s) => s.entities.enemy) as Entity[]
  const characters = useProjectStore((s) => s.entities.character) as Entity[]
  const [tab, setTab] = useState<'states' | 'routine'>('states')
  const [trying, setTrying] = useState<Id | null>(null)
  const pending = useRef<Id | null>(null)
  const [, setPendingShown] = useState<Id | null>(null)
  const graph = doc.data ? checkGraph(doc.data.scene) : { unreachable: [], deadEnds: [], startId: null }
  const flagName = (id: Id) => flags.flags.find((f) => f.id === id)?.name ?? '(deleted flag)'

  const stateType = useMemo<NodeType<StateNode>>(
    () => ({
      label: 'State',
      render: (n, ctx) => {
        const lit = trying === n.id
        const muted = graph.unreachable.includes(n.id)
        return (
          <Group>
            <Rect
              width={STATE_W}
              height={STATE_H}
              cornerRadius={12}
              fill={lit ? ctx.theme.accent : (n.fillColor ?? ctx.theme.bgElevated)}
              stroke={n.start ? '#2f9e44' : muted ? ctx.theme.textMuted : ctx.theme.border}
              strokeWidth={n.start ? 4 : 2}
              dash={muted ? [8, 6] : undefined}
            />
            <Text text={(n.start ? '▶ ' : '') + n.title} x={12} y={10} width={STATE_W - 24} fontSize={16} fontStyle="bold" fill={lit ? '#fff' : ctx.theme.text} fontFamily={ctx.theme.font} ellipsis wrap="none" />
            <Text text={n.does} x={12} y={34} width={STATE_W - 24} height={STATE_H - 40} fontSize={12} fill={lit ? '#fff' : ctx.theme.textMuted} fontFamily={ctx.theme.font} ellipsis />
          </Group>
        )
      },
      bounds: () => ({ x: 0, y: 0, width: STATE_W, height: STATE_H }),
      transformable: false,
      memo: false,
    }),
    [trying, graph.unreachable],
  )
  const nodeTypes = useMemo(() => ({ ...BUILTIN_NODE_TYPES, 'bh-state': stateType, connector: linkType }), [stateType])

  const tools = useMemo<CanvasTool<BehaviourItem>[]>(() => {
    const stateTool: CanvasTool<BehaviourItem> = {
      id: 'state',
      label: 'State',
      icon: Box,
      shortcut: 'S',
      cursor: 'crosshair',
      pointerDown(e, api) {
        if (e.button !== 0) return
        const hit = e.targetId ? getNode(api.scene, e.targetId) : undefined
        if (isState(hit)) return startMove(e, api, hit.id)
        const n = newState(api.activeLayerId, e.world.x - STATE_W / 2, e.world.y - STATE_H / 2)
        if (!statesOf(api.scene).length) n.start = true
        api.update((s) => addNodes(s, [n]))
        api.select([n.id])
      },
    }
    const linkTool: CanvasTool<BehaviourItem> = {
      id: 'link',
      label: 'Arrow',
      icon: Link2,
      shortcut: 'L',
      cursor: 'crosshair',
      pointerDown(e, api) {
        if (e.button !== 0) return
        const hit = e.targetId ? getNode(api.scene, e.targetId) : undefined
        if (!isState(hit)) {
          pending.current = null
          setPendingShown(null)
          return
        }
        const from = pending.current
        if (!from || from === hit.id) {
          pending.current = hit.id
          setPendingShown(hit.id)
          api.select([hit.id])
          return
        }
        const l = link(hit.layerId, from, hit.id, { mode: 'custom', value: 0, text: '' })
        l.label = 'when?'
        api.update((s) => addNodes(s, [l]))
        api.select([l.id])
        pending.current = null
        setPendingShown(null)
      },
      deactivate() {
        pending.current = null
        setPendingShown(null)
      },
    }
    return [selectTool, handTool, stateTool, linkTool, noteTool(), commentTool('behaviour', documentId ?? null)]
  }, [documentId])

  if (!doc.data) return null
  const d = doc.data
  const set = (fn: (d: BehaviourDoc) => BehaviourDoc) => doc.update(fn)
  const sel = canvas.selection.length === 1 ? getNode(d.scene, canvas.selection[0]) : undefined
  const editState = (id: Id, p: Partial<StateNode>) => set((x) => ({ ...x, scene: updateNode(x.scene, id, (n) => (isState(n) ? { ...n, ...p } : n)) }))
  const editLink = (id: Id, cond: Condition) => set((x) => ({ ...x, scene: updateNode(x.scene, id, (n) => (isLink(n) ? { ...n, cond, label: describeCondition(cond, flagName) } : n)) }))
  const nameOf = (id: Id) => statesOf(d.scene).find((s) => s.id === id)?.title ?? '?'
  const userName = (u: BehaviourDoc['users'][number]) => (u.type === 'enemy' ? enemies : characters).find((e) => e.id === u.id)?.name || '(deleted)'
  const tryAt = trying && statesOf(d.scene).some((s) => s.id === trying) ? trying : null

  return (
    <div className="bh">
      <div className="bh-top">
        <button className={`btn btn-ghost${tab === 'states' ? ' on' : ''}`} onClick={() => setTab('states')}>
          States
        </button>
        <button className={`btn btn-ghost${tab === 'routine' ? ' on' : ''}`} onClick={() => setTab('routine')}>
          Daily routine
        </button>
        <span className="bh-users">
          Used by:
          {d.users.map((u) => (
            <button key={u.type + u.id} className="btn btn-ghost" title="Remove" onClick={() => set((x) => ({ ...x, users: x.users.filter((y) => !(y.type === u.type && y.id === u.id)) }))}>
              {userName(u)} ×
            </button>
          ))}
          <select
            className="input"
            value=""
            onChange={(e) => {
              const [type, id] = e.target.value.split(':') as ['enemy' | 'character', Id]
              if (id) set((x) => ({ ...x, users: [...x.users, { type, id }] }))
            }}
          >
            <option value="">Add an enemy or character…</option>
            {enemies.length > 0 && (
              <optgroup label="Enemies">
                {enemies.map((e) => (
                  <option key={e.id} value={`enemy:${e.id}`}>
                    {e.name || 'Untitled'}
                  </option>
                ))}
              </optgroup>
            )}
            {characters.length > 0 && (
              <optgroup label="Characters">
                {characters.map((e) => (
                  <option key={e.id} value={`character:${e.id}`}>
                    {e.name || 'Untitled'}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </span>
      </div>

      {tab === 'routine' ? (
        <Routine d={d} set={set} />
      ) : (
        <div className="bh-main">
          <div className="bh-canvas">
            <CanvasEditor<BehaviourItem>
              scene={d.scene}
              {...sceneBinding(doc)}
              active={active}
              tools={tools}
              nodeTypes={nodeTypes}
              canvas={canvas}
              ariaLabel="Behaviour"
              onNodeDoubleClick={(id, api) => {
                const n = api.scene.nodes.find((x) => x.id === id)
                if (n && !isState(n) && !isLink(n) && api.nodeTypes[n.kind]?.textEdit) api.editText(id)
              }}
            />
            {statesOf(d.scene).length === 0 && <div className="bh-hint">Click with the State tool (S) to place a state, then join two states with the Arrow tool (L): click the first, then the second.</div>}
          </div>
          <aside className="bh-side">
            <section>
              <strong>
                <Play size={13} /> Try it
              </strong>
              {!tryAt ? (
                <button className="btn btn-primary" disabled={!graph.startId} onClick={() => setTrying(graph.startId)}>
                  Start at {graph.startId ? nameOf(graph.startId) : '…'}
                </button>
              ) : (
                <>
                  <p>
                    Now: <b>{nameOf(tryAt)}</b>
                  </p>
                  {linksFrom(d.scene, tryAt).length === 0 && <p className="muted">No way out of this state.</p>}
                  {linksFrom(d.scene, tryAt).map((l) => (
                    <button key={l.id} className="btn btn-ghost bh-go" onClick={() => setTrying(l.toId)}>
                      {describeCondition(l.cond, flagName) || 'always'} → {nameOf(l.toId)}
                    </button>
                  ))}
                  <button className="btn btn-ghost" onClick={() => setTrying(null)}>
                    Stop
                  </button>
                </>
              )}
            </section>

            {(graph.unreachable.length > 0 || graph.deadEnds.length > 0) && (
              <section className="bh-warn">
                {graph.unreachable.length > 0 && <p>Never reached from the start: {graph.unreachable.map(nameOf).join(', ')} (dashed).</p>}
                {graph.deadEnds.length > 0 && <p>No way out: {graph.deadEnds.map(nameOf).join(', ')}.</p>}
              </section>
            )}

            {isState(sel) && (
              <section>
                <Field label="State">
                  <input className="input" value={sel.title} onChange={(e) => editState(sel.id, { title: e.target.value })} />
                </Field>
                <Field label="What it does">
                  <textarea className="input" rows={3} value={sel.does} onChange={(e) => editState(sel.id, { does: e.target.value })} />
                </Field>
                <Field label="Speed">
                  <NumberInput value={sel.speed ?? 0} min={0} onChange={(speed) => editState(sel.id, { speed: speed || null })} />
                </Field>
                <Field label="Uses ability">
                  <select className="input" value={sel.abilityId ?? ''} onChange={(e) => editState(sel.id, { abilityId: e.target.value || null })}>
                    <option value="">None</option>
                    {abilities.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="ld-inline">
                  <input
                    type="checkbox"
                    checked={!!sel.start}
                    onChange={(e) => set((x) => ({ ...x, scene: { ...x.scene, nodes: x.scene.nodes.map((n) => (isState(n) ? { ...n, start: n.id === sel.id ? e.target.checked : false } : n)) } }))}
                  />
                  Starts here
                </label>
                <button className="btn btn-danger" onClick={() => (set((x) => ({ ...x, scene: deleteNodes(x.scene, [sel.id]) })), canvas.setSelection([]))}>
                  <Trash2 size={14} /> Delete state
                </button>
              </section>
            )}

            {isLink(sel) && isState(getNode(d.scene, sel.fromId)) && (
              <LinkPanel l={sel} from={nameOf(sel.fromId)} to={nameOf(sel.toId)} flags={flags.flags} onChange={(c) => editLink(sel.id, c)} onDelete={() => (set((x) => ({ ...x, scene: deleteNodes(x.scene, [sel.id]) })), canvas.setSelection([]))} />
            )}
            {!sel && <p className="muted">Click a state or an arrow to edit it. S places a state, L draws an arrow.</p>}
          </aside>
        </div>
      )}
    </div>
  )
}

function LinkPanel({ l, from, to, flags, onChange, onDelete }: { l: LinkNode; from: string; to: string; flags: { id: Id; name: string }[]; onChange(c: Condition): void; onDelete(): void }) {
  const c: Condition = l.cond ?? { mode: 'custom', value: 0, text: '' }
  const kind = CONDITION_KINDS.find((k) => k.id === c.mode)!
  return (
    <section>
      <strong>
        {from} → {to}
      </strong>
      <Field label="When">
        <select className="input" value={c.mode} onChange={(e) => onChange({ ...c, mode: e.target.value as ConditionKind })}>
          {CONDITION_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      {kind.unit && (
        <Field label={kind.unit}>
          <NumberInput value={c.value} min={0} onChange={(value) => onChange({ ...c, value })} />
        </Field>
      )}
      {c.mode === 'flag' && (
        <Field label="Flag">
          <select className="input" value={c.flagId ?? ''} onChange={(e) => onChange({ ...c, flagId: e.target.value || null })}>
            <option value="">Pick a flag…</option>
            {flags.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {c.mode === 'custom' && (
        <Field label="In your words">
          <input className="input" value={c.text} placeholder="e.g. the alarm goes off" onChange={(e) => onChange({ ...c, text: e.target.value })} />
        </Field>
      )}
      <button className="btn btn-danger" onClick={onDelete}>
        <Trash2 size={14} /> Delete arrow
      </button>
    </section>
  )
}

function Routine({ d, set }: { d: BehaviourDoc; set(fn: (d: BehaviourDoc) => BehaviourDoc): void }) {
  const blocks = [...d.routine].sort((a, b) => minutesOf(a.from) - minutesOf(b.from))
  const edit = (id: Id, p: Partial<BehaviourDoc['routine'][number]>) => set((x) => ({ ...x, routine: x.routine.map((r) => (r.id === id ? { ...r, ...p } : r)) }))
  const pct = (t: string) => `${(Math.min(1440, Math.max(0, minutesOf(t) || 0)) / 1440) * 100}%`
  return (
    <div className="bh-routine">
      <p className="muted">Where this character is and what it does through a day. Blocks may go past midnight by ending earlier than they start.</p>
      <div className="bh-strip">
        {Array.from({ length: 25 }, (_, h) => (
          <span key={h} className="bh-hour" style={{ left: `${(h / 24) * 100}%` }}>
            {h % 3 === 0 ? h : ''}
          </span>
        ))}
        {blocks.flatMap((b, i) => {
          const s = minutesOf(b.from)
          const e = minutesOf(b.to)
          const parts = e > s ? [[b.from, b.to]] : [[b.from, '24:00'], ['00:00', b.to]]
          return parts.map(([f, t], k) => (
            <div key={b.id + k} className="bh-block" style={{ left: pct(f), width: `calc(${pct(t)} - ${pct(f)})`, background: `hsl(${(i * 67) % 360} 55% 45%)` }} title={`${b.from}–${b.to} ${b.place}: ${b.does}`}>
              {b.place}
            </div>
          ))
        })}
      </div>
      <table className="calc-table">
        <tbody>
          {blocks.map((b) => (
            <tr key={b.id}>
              <td>
                <input className="input" type="time" value={b.from} onChange={(e) => edit(b.id, { from: e.target.value })} aria-label="From" />
              </td>
              <td>
                <input className="input" type="time" value={b.to} onChange={(e) => edit(b.id, { to: e.target.value })} aria-label="To" />
              </td>
              <td>
                <input className="input" placeholder="Where" value={b.place} onChange={(e) => edit(b.id, { place: e.target.value })} />
              </td>
              <td>
                <input className="input" placeholder="Does what" value={b.does} onChange={(e) => edit(b.id, { does: e.target.value })} />
              </td>
              <td>
                <button className="icon-btn" aria-label="Remove" onClick={() => set((x) => ({ ...x, routine: x.routine.filter((r) => r.id !== b.id) }))}>
                  <X size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ld-inline">
        <button className="btn btn-ghost" onClick={() => set((x) => ({ ...x, routine: [...x.routine, { id: newId(), from: blocks.at(-1)?.to || '08:00', to: '12:00', place: 'Shop', does: 'Works at the counter' }] }))}>
          <Plus size={14} /> Block
        </button>
        {d.routine.length === 0 && (
          <button
            className="btn btn-ghost"
            onClick={() =>
              set((x) => ({
                ...x,
                routine: [
                  { id: newId(), from: '07:00', to: '09:00', place: 'Home', does: 'Breakfast' },
                  { id: newId(), from: '09:00', to: '17:00', place: 'Bakery', does: 'Sells bread' },
                  { id: newId(), from: '17:00', to: '22:00', place: 'Plaza', does: 'Chats with friends' },
                  { id: newId(), from: '22:00', to: '07:00', place: 'Home', does: 'Sleeps' },
                ],
              }))
            }
          >
            Add example day
          </button>
        )}
      </div>
    </div>
  )
}
