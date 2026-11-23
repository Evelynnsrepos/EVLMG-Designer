import { ArrowDown, ArrowUp, Box, Group as GroupIcon, Link2, MousePointer2, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Arrow, Group, Rect, Text } from 'react-konva'
import { newId, type Entity, type Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { createAbilitiesDoc, type AbilitiesDoc, type Ability } from '@/components/abilities/model'
import { NumberInput } from '@/shared/calculators'
import { useEditSession } from '@/shared/calculators/editSession'
import { useFlags } from '@/shared/flags'
import { useLang } from '@/shared/i18n'
import { Field, useItems } from '@/shared/listDetail'
import {
  addNodes,
  BUILTIN_NODE_TYPES,
  CanvasEditor,
  connectorPoints,
  deleteNodes,
  getNode,
  handTool,
  noteTool,
  sceneBinding,
  selectTool,
  startMarquee,
  startMove,
  translateNodes,
  updateNode,
  useCanvasState,
  type CanvasTool,
  type NodeType,
} from '@/shared/canvas'
import { commentTool } from '@/shared/reviews'
import {
  applyEnter,
  checkGraph,
  COMPARE_OPS,
  CONDITION_KINDS,
  condsOf,
  createBehaviourDoc,
  describeLink,
  evalLink,
  initialValues,
  isGroup,
  isLink,
  isState,
  link,
  linksFrom,
  minutesOf,
  newGroup,
  newState,
  onDay,
  outgoing,
  reorder,
  resolveTarget,
  shiftBlock,
  STATE_H,
  STATE_W,
  statesIn,
  statesOf,
  type BehaviourDoc,
  type BehaviourItem,
  type CompareOp,
  type Condition,
  type DescribeCtx,
  type GroupNode,
  type LinkNode,
  type RoutineBlock,
  type StateNode,
} from './model'
import { UI, WORDS } from './ui'
import './behaviour.css'

/** Arrows sit a little to their own side, so A → B and B → A don't cover each other; the label goes on that side too. */
const linkType = (order: (l: LinkNode) => number | null): NodeType<LinkNode> => ({
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
    const k = order(n)
    const label = (k !== null ? `${k}. ` : '') + (n.label ?? '')
    return (
      <>
        <Arrow points={pts} stroke={stroke} fill={stroke} strokeWidth={2} pointerLength={10} pointerWidth={10} hitStrokeWidth={14} lineCap="round" dash={isGroup(ctx.getNode(n.fromId)) ? [10, 6] : undefined} />
        {label ? (
          Math.abs(nx) > Math.abs(ny) ? (
            <Text x={nx > 0 ? mid.x : mid.x - 180} y={mid.y - 6} width={180} align={nx > 0 ? 'left' : 'right'} text={label} fontSize={12} fontFamily={ctx.theme.font} fill={ctx.theme.textMuted} />
          ) : (
            <Text x={mid.x - 90} y={mid.y - (ny < 0 ? 16 : 0)} width={180} align="center" text={label} fontSize={12} fontFamily={ctx.theme.font} fill={ctx.theme.textMuted} />
          )
        ) : null}
      </>
    )
  },
})

const groupType: NodeType<GroupNode> = {
  label: 'Group',
  render: (n, ctx) => (
    <Group>
      <Rect width={n.width} height={n.height} cornerRadius={18} fill={ctx.theme.accent} opacity={0.08} />
      <Rect width={n.width} height={n.height} cornerRadius={18} stroke={ctx.theme.accent} strokeWidth={2} dash={[12, 8]} />
      <Text text={n.title} x={16} y={12} width={Math.max(20, n.width - 32)} fontSize={15} fontStyle="bold" fill={ctx.theme.accent} fontFamily={ctx.theme.font} ellipsis wrap="none" />
    </Group>
  ),
  bounds: (n) => ({ x: 0, y: 0, width: n.width, height: n.height }),
  resize: (n, sx, sy) => ({ ...n, width: Math.max(STATE_W + 40, n.width * sx), height: Math.max(STATE_H + 60, n.height * sy) }),
  rotatable: false,
  memo: false,
}

type Typing = ReturnType<typeof useEditSession<BehaviourDoc>>

/** Behaviour Designer (missing tools phase 5). */
export default function View({ documentId, active }: PanelProps) {
  useLang()
  const doc = useDocument<BehaviourDoc>('behaviour', documentId!, createBehaviourDoc)
  const typing = useEditSession(doc)
  const canvas = useCanvasState()
  const flags = useFlags()
  const abilities = useItems<Ability, AbilitiesDoc>('abilities', 'abilities', createAbilitiesDoc).items
  const enemies = useProjectStore((s) => s.entities.enemy) as Entity[]
  const characters = useProjectStore((s) => s.entities.character) as Entity[]
  const [tab, setTab] = useState<'states' | 'routine' | 'setup'>('states')
  const [trying, setTrying] = useState<{ at: Id; values: Record<Id, number> } | null>(null)
  const pending = useRef<Id | null>(null)
  const [pendingShown, setPendingShown] = useState<Id | null>(null)
  // The canvas has its own undo keys; the other pages need these.
  useUndoRedoKeys(doc, active && tab !== 'states')
  const d = doc.data
  const scene = d?.scene
  const graph = useMemo(() => (scene ? checkGraph(scene) : { unreachable: [], deadEnds: [], startId: null }), [scene])
  const flagName = (id: Id) => flags.flags.find((f) => f.id === id)?.name ?? UI.deletedFlag
  const varName = (id: Id) => d?.vars?.find((v) => v.id === id)?.name ?? '?'
  const dctx: DescribeCtx = { words: WORDS, flagName, varName, kinds: d?.kinds, distance: d?.distanceUnit }
  const tryAt = trying && scene && statesOf(scene).some((s) => s.id === trying.at) ? trying : null

  const stateType = useMemo<NodeType<StateNode>>(
    () => ({
      label: 'State',
      render: (n, ctx) => {
        const lit = tryAt?.at === n.id
        const muted = graph.unreachable.includes(n.id)
        const dead = graph.deadEnds.includes(n.id)
        const picking = pendingShown === n.id
        return (
          <Group>
            <Rect
              width={STATE_W}
              height={STATE_H}
              cornerRadius={12}
              fill={lit ? ctx.theme.accent : (n.fillColor ?? ctx.theme.bgElevated)}
              stroke={picking ? ctx.theme.focus : n.start ? ctx.theme.accent : dead ? ctx.theme.danger : muted ? ctx.theme.textMuted : ctx.theme.border}
              strokeWidth={picking || n.start ? 4 : dead ? 3 : 2}
              dash={muted ? [8, 6] : undefined}
              shadowColor={ctx.theme.focus}
              shadowBlur={picking ? 14 : 0}
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
    [tryAt?.at, graph, pendingShown],
  )
  const nodeTypes = useMemo(() => {
    // Number the arrows of a state that has more than one, so the order they are checked in shows on the canvas.
    const order = (l: LinkNode) => {
      if (!scene) return null
      const sibs = linksFrom(scene, l.fromId)
      return sibs.length > 1 ? sibs.findIndex((x) => x.id === l.id) + 1 : null
    }
    return { ...BUILTIN_NODE_TYPES, 'bh-state': stateType, 'bh-group': groupType, connector: linkType(order) }
  }, [stateType, scene])

  const tools = useMemo<CanvasTool<BehaviourItem>[]>(() => {
    const isEnd = (n: BehaviourItem | undefined) => isState(n) || isGroup(n)
    /** The select tool, but dragging a group takes everything inside along. */
    const select: CanvasTool<BehaviourItem> = {
      ...selectTool,
      icon: MousePointer2,
      pointerDown(e, api) {
        if (e.button !== 0) return
        const hit = e.targetId ? getNode(api.scene, e.targetId) : undefined
        if (!isGroup(hit) || e.shift || e.mod || e.clickCount === 2) return e.targetId ? startMove(e, api, e.targetId) : startMarquee(e, api)
        api.select([hit.id])
        const within = (id: Id) => {
          const b = api.getWorldBounds(id)
          if (!b) return false
          const cx = b.x + b.width / 2
          const cy = b.y + b.height / 2
          return cx >= hit.x && cx <= hit.x + hit.width && cy >= hit.y && cy <= hit.y + hit.height
        }
        const ids = [hit.id, ...api.scene.nodes.filter((n) => n.id !== hit.id && !isLink(n) && within(n.id)).map((n) => n.id)]
        const start = e.world
        let moved = false
        return {
          move(m) {
            moved = true
            api.preview((s) => translateNodes(s, ids, m.world.x - start.x, m.world.y - start.y, isLink))
          },
          up() {
            if (moved) api.commitPreview()
          },
          cancel() {
            api.preview(null)
          },
        }
      },
    }
    const stateTool: CanvasTool<BehaviourItem> = {
      id: 'state',
      label: UI.toolState,
      icon: Box,
      shortcut: 'S',
      cursor: 'crosshair',
      pointerDown(e, api) {
        if (e.button !== 0) return
        const hit = e.targetId ? getNode(api.scene, e.targetId) : undefined
        if (isState(hit)) return startMove(e, api, hit.id)
        const n = newState(api.activeLayerId, e.world.x - STATE_W / 2, e.world.y - STATE_H / 2, UI.newState)
        if (!statesOf(api.scene).length) n.start = true
        api.update((s) => addNodes(s, [n]))
        api.select([n.id])
      },
    }
    const groupTool: CanvasTool<BehaviourItem> = {
      id: 'group',
      label: UI.toolGroup,
      icon: GroupIcon,
      shortcut: 'G',
      cursor: 'crosshair',
      pointerDown(e, api) {
        if (e.button !== 0) return
        const g = newGroup(api.activeLayerId, e.world.x - 240, e.world.y - 40, 480, 300, UI.newGroup)
        // Groups go first, so they are drawn behind the states.
        api.update((s) => ({ ...s, nodes: [g, ...s.nodes] }))
        api.select([g.id])
      },
    }
    const linkTool: CanvasTool<BehaviourItem> = {
      id: 'link',
      label: UI.toolArrow,
      icon: Link2,
      shortcut: 'L',
      cursor: 'crosshair',
      pointerDown(e, api) {
        if (e.button !== 0) return
        const hit = e.targetId ? getNode(api.scene, e.targetId) : undefined
        if (!hit || !isEnd(hit)) {
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
        const l = link(api.scene, hit.layerId, from, hit.id, [])
        l.label = WORDS.always
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
    return [select, handTool, stateTool, groupTool, linkTool, noteTool(), commentTool('behaviour', documentId ?? null)]
  }, [documentId])

  if (!d) return null
  const set = (fn: (d: BehaviourDoc) => BehaviourDoc) => doc.update(fn)
  const sel = canvas.selection.length === 1 ? getNode(d.scene, canvas.selection[0]) : undefined
  /** Arrow labels follow renamed variables, own condition types and the distance unit. */
  const relabel = (x: BehaviourDoc): BehaviourDoc => {
    const ctx: DescribeCtx = { ...dctx, kinds: x.kinds, distance: x.distanceUnit, varName: (id) => x.vars?.find((v) => v.id === id)?.name ?? '?' }
    return { ...x, scene: { ...x.scene, nodes: x.scene.nodes.map((n) => (isLink(n) && (n.conds || n.cond) ? { ...n, label: describeLink(n, ctx) } : n)) } }
  }
  const editState = (id: Id, p: Partial<StateNode>, live = false) => (live ? typing.change : set)((x) => ({ ...x, scene: updateNode(x.scene, id, (n) => (isState(n) ? { ...n, ...p } : n)) }))
  const editGroup = (id: Id, p: Partial<GroupNode>, live = false) => (live ? typing.change : set)((x) => ({ ...x, scene: updateNode(x.scene, id, (n) => (isGroup(n) ? { ...n, ...p } : n)) }))
  const editLink = (id: Id, p: Partial<LinkNode>, live = false) =>
    (live ? typing.change : set)((x) => relabel({ ...x, scene: updateNode(x.scene, id, (n) => (isLink(n) ? { ...n, ...p, ...(p.conds ? { cond: p.conds[0] } : {}) } : n)) }))
  const nameOf = (id: Id) => (d.scene.nodes.find((s) => s.id === id) as StateNode | GroupNode | undefined)?.title ?? '?'
  const userName = (u: BehaviourDoc['users'][number]) => (u.type === 'enemy' ? enemies : characters).find((e) => e.id === u.id)?.name || UI.deleted
  const stateById = (id: Id) => statesOf(d.scene).find((s) => s.id === id)
  const go = (l: LinkNode) => {
    const to = resolveTarget(d.scene, l.toId)
    if (to) setTrying((t) => ({ at: to, values: applyEnter(stateById(to), t?.values ?? initialValues(d)) }))
  }
  const begin = () => graph.startId && setTrying({ at: graph.startId, values: applyEnter(stateById(graph.startId), initialValues(d)) })
  const move = (fromId: Id, i: number, by: -1 | 1) => set((x) => ({ ...x, scene: reorder(x.scene, fromId, i, by) }))
  const remove = (id: Id) => (set((x) => ({ ...x, scene: deleteNodes(x.scene, [id]) })), canvas.setSelection([]))

  return (
    <div className="bh">
      <div className="bh-top">
        {(['states', 'routine', 'setup'] as const).map((t) => (
          <button key={t} className={`btn btn-ghost${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
            {UI[t]}
          </button>
        ))}
        <span className="bh-users">
          {UI.usedBy}
          {d.users.map((u) => (
            <button key={u.type + u.id} className="btn btn-ghost" title={UI.remove} onClick={() => set((x) => ({ ...x, users: x.users.filter((y) => !(y.type === u.type && y.id === u.id)) }))}>
              {userName(u)} ×
            </button>
          ))}
          <select
            className="input"
            value=""
            onChange={(e) => {
              const [type, id] = e.target.value.split(':') as ['enemy' | 'character', Id]
              if (id && !d.users.some((u) => u.type === type && u.id === id)) set((x) => ({ ...x, users: [...x.users, { type, id }] }))
            }}
          >
            <option value="">{UI.addUser}</option>
            {enemies.length > 0 && (
              <optgroup label={UI.enemies}>
                {enemies.map((e) => (
                  <option key={e.id} value={`enemy:${e.id}`}>
                    {e.name || UI.untitled}
                  </option>
                ))}
              </optgroup>
            )}
            {characters.length > 0 && (
              <optgroup label={UI.characters}>
                {characters.map((e) => (
                  <option key={e.id} value={`character:${e.id}`}>
                    {e.name || UI.untitled}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </span>
      </div>

      {tab === 'routine' ? (
        <Routine d={d} set={set} typing={typing} />
      ) : tab === 'setup' ? (
        <Setup d={d} set={(fn) => set((x) => relabel(fn(x)))} begin={typing.begin} end={typing.end} change={(fn) => typing.change((x) => relabel(fn(x)))} />
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
              ariaLabel={UI.states}
              onNodeDoubleClick={(id, api) => {
                const n = api.scene.nodes.find((x) => x.id === id)
                if (n && !isState(n) && !isLink(n) && !isGroup(n) && api.nodeTypes[n.kind]?.textEdit) api.editText(id)
              }}
            />
            {statesOf(d.scene).length === 0 && <div className="bh-hint">{UI.emptyHint}</div>}
            {pendingShown && <div className="bh-pending">{UI.pendingHint}</div>}
          </div>
          <aside className="bh-side">
            <section>
              <strong>
                <Play size={13} /> {UI.tryIt}
              </strong>
              {!tryAt ? (
                <button className="btn btn-primary" disabled={!graph.startId} onClick={begin}>
                  {UI.startAt(graph.startId ? nameOf(graph.startId) : '…')}
                </button>
              ) : (
                <>
                  <p>
                    {UI.now} <b>{nameOf(tryAt.at)}</b>
                  </p>
                  {(d.vars ?? []).length > 0 && (
                    <p className="bh-vals">
                      {(d.vars ?? []).map((v) => (
                        <span key={v.id} className="bh-chip">
                          {v.name} = {tryAt.values[v.id] ?? 0}
                        </span>
                      ))}
                    </p>
                  )}
                  {outgoing(d.scene, tryAt.at).length === 0 && <p className="muted">{UI.noWayOut}</p>}
                  {outgoing(d.scene, tryAt.at).map((l) => {
                    const r = evalLink(l, tryAt.values)
                    return (
                      <button key={l.id} className={`btn btn-ghost bh-go${r === false ? ' off' : ''}`} onClick={() => go(l)} title={isGroup(getNode(d.scene, l.fromId)) ? UI.fromGroup(nameOf(l.fromId)) : undefined}>
                        {describeLink(l, dctx)} → {nameOf(l.toId)}
                        {r === true && <em className="bh-true"> · {UI.trueNow}</em>}
                        {r === false && <em> · {UI.falseNow}</em>}
                      </button>
                    )
                  })}
                  <span className="ld-inline">
                    <button className="btn btn-ghost" onClick={begin}>
                      <RotateCcw size={13} /> {UI.restart}
                    </button>
                    <button className="btn btn-ghost" onClick={() => setTrying(null)}>
                      {UI.stop}
                    </button>
                  </span>
                </>
              )}
            </section>

            {(graph.unreachable.length > 0 || graph.deadEnds.length > 0) && (
              <section className="bh-warn">
                {graph.unreachable.length > 0 && <p>{UI.never(graph.unreachable.map(nameOf).join(', '))}</p>}
                {graph.deadEnds.length > 0 && <p>{UI.deadEnds(graph.deadEnds.map(nameOf).join(', '))}</p>}
              </section>
            )}

            {isState(sel) && (
              <StatePanel
                key={sel.id}
                st={sel}
                d={d}
                abilities={abilities}
                typing={typing}
                edit={editState}
                dctx={dctx}
                nameOf={nameOf}
                move={move}
                setStart={(on) => set((x) => ({ ...x, scene: { ...x.scene, nodes: x.scene.nodes.map((n) => (isState(n) ? { ...n, start: n.id === sel.id ? on : false } : n)) } }))}
                onDelete={() => remove(sel.id)}
              />
            )}

            {isGroup(sel) && (
              <section key={sel.id}>
                <Field label={UI.group}>
                  <input className="input" value={sel.title} onFocus={typing.begin} onBlur={typing.end} onChange={(e) => editGroup(sel.id, { title: e.target.value }, true)} />
                </Field>
                <p className="muted">{UI.groupStates(statesIn(d.scene, sel).length)}</p>
                <Field label={UI.entry}>
                  <select className="input" value={sel.entryId ?? ''} onChange={(e) => editGroup(sel.id, { entryId: e.target.value || null })}>
                    <option value="">{UI.topLeft}</option>
                    {statesIn(d.scene, sel).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <ArrowOrder fromId={sel.id} list={linksFrom(d.scene, sel.id)} dctx={dctx} nameOf={nameOf} move={move} />
                <p className="muted">{UI.groupHelp}</p>
                <button className="btn btn-danger" onClick={() => remove(sel.id)}>
                  <Trash2 size={14} /> {UI.deleteGroup}
                </button>
              </section>
            )}

            {isLink(sel) && (isState(getNode(d.scene, sel.fromId)) || isGroup(getNode(d.scene, sel.fromId))) && (
              <LinkPanel key={sel.id} l={sel} d={d} from={nameOf(sel.fromId)} to={nameOf(sel.toId)} flags={flags.flags} typing={typing} onChange={(p, live) => editLink(sel.id, p, live)} onDelete={() => remove(sel.id)} />
            )}
            {!sel && <p className="muted">{UI.pickHint}</p>}
          </aside>
        </div>
      )}
    </div>
  )
}

function ArrowOrder({ fromId, list, dctx, nameOf, move }: { fromId: Id; list: LinkNode[]; dctx: DescribeCtx; nameOf(id: Id): string; move(fromId: Id, i: number, by: -1 | 1): void }) {
  if (list.length < 2) return null
  return (
    <div className="bh-order">
      <span className="muted">{UI.outOrder}</span>
      <ul>
        {list.map((l, i) => (
          <li key={l.id}>
            <span>
              {i + 1}. {describeLink(l, dctx)} → {nameOf(l.toId)}
            </span>
            <button className="icon-btn" aria-label={UI.earlier} title={UI.earlier} disabled={i === 0} onClick={() => move(fromId, i, -1)}>
              <ArrowUp size={13} />
            </button>
            <button className="icon-btn" aria-label={UI.later} title={UI.later} disabled={i === list.length - 1} onClick={() => move(fromId, i, 1)}>
              <ArrowDown size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatePanel({
  st,
  d,
  abilities,
  typing,
  edit,
  dctx,
  nameOf,
  move,
  setStart,
  onDelete,
}: {
  st: StateNode
  d: BehaviourDoc
  abilities: Ability[]
  typing: Typing
  edit(id: Id, p: Partial<StateNode>, live?: boolean): void
  dctx: DescribeCtx
  nameOf(id: Id): string
  move(fromId: Id, i: number, by: -1 | 1): void
  setStart(on: boolean): void
  onDelete(): void
}) {
  const vars = d.vars ?? []
  const changes = st.onEnter ?? []
  const setChanges = (onEnter: StateNode['onEnter']) => edit(st.id, { onEnter })
  return (
    <section>
      <Field label={UI.state}>
        <input className="input" value={st.title} onFocus={typing.begin} onBlur={typing.end} onChange={(e) => edit(st.id, { title: e.target.value }, true)} />
      </Field>
      <Field label={UI.does}>
        <textarea className="input" rows={3} value={st.does} onFocus={typing.begin} onBlur={typing.end} onChange={(e) => edit(st.id, { does: e.target.value }, true)} />
      </Field>
      <Field label={UI.speed}>
        <NumberInput value={st.speed ?? 0} min={0} onChange={(speed) => edit(st.id, { speed: speed || null })} />
      </Field>
      <Field label={UI.ability}>
        <select className="input" value={st.abilityId ?? ''} onChange={(e) => edit(st.id, { abilityId: e.target.value || null })}>
          <option value="">{UI.none}</option>
          {abilities.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      {(d.fields ?? []).map((f) => (
        <Field key={f.id} label={f.name}>
          {f.kind === 'number' ? (
            <NumberInput value={Number(st.values?.[f.id] ?? 0)} onChange={(v) => edit(st.id, { values: { ...st.values, [f.id]: v } })} />
          ) : (
            <input className="input" value={String(st.values?.[f.id] ?? '')} onFocus={typing.begin} onBlur={typing.end} onChange={(e) => edit(st.id, { values: { ...st.values, [f.id]: e.target.value } }, true)} />
          )}
        </Field>
      ))}
      {vars.length > 0 && (
        <div className="bh-order">
          <span className="muted">{UI.onEnter}</span>
          {changes.map((c, i) => (
            <div key={i} className="ld-inline">
              <select className="input" value={c.varId} aria-label={UI.variable} onChange={(e) => setChanges(changes.map((x, j) => (j === i ? { ...x, varId: e.target.value } : x)))}>
                {vars.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <select className="input" value={c.op} onChange={(e) => setChanges(changes.map((x, j) => (j === i ? { ...x, op: e.target.value as 'set' | 'add' } : x)))}>
                <option value="add">{UI.addVar}</option>
                <option value="set">{UI.setVar}</option>
              </select>
              <NumberInput value={c.value} aria-label={UI.number} onChange={(value) => setChanges(changes.map((x, j) => (j === i ? { ...x, value } : x)))} />
              <button className="icon-btn" aria-label={UI.remove} onClick={() => setChanges(changes.filter((_, j) => j !== i))}>
                <X size={13} />
              </button>
            </div>
          ))}
          <button className="btn btn-ghost" onClick={() => setChanges([...changes, { varId: vars[0].id, op: 'add', value: 1 }])}>
            <Plus size={14} /> {UI.addChange}
          </button>
        </div>
      )}
      <ArrowOrder fromId={st.id} list={linksFrom(d.scene, st.id)} dctx={dctx} nameOf={nameOf} move={move} />
      <label className="ld-inline">
        <input type="checkbox" checked={!!st.start} onChange={(e) => setStart(e.target.checked)} />
        {UI.startsHere}
      </label>
      <button className="btn btn-danger" onClick={onDelete}>
        <Trash2 size={14} /> {UI.deleteState}
      </button>
    </section>
  )
}

function LinkPanel({
  l,
  d,
  from,
  to,
  flags,
  typing,
  onChange,
  onDelete,
}: {
  l: LinkNode
  d: BehaviourDoc
  from: string
  to: string
  flags: { id: Id; name: string }[]
  typing: Typing
  onChange(p: Partial<LinkNode>, live?: boolean): void
  onDelete(): void
}) {
  const conds = condsOf(l)
  const setConds = (cs: Condition[], live = false) => onChange({ conds: cs }, live)
  const edit = (i: number, p: Partial<Condition>, live = false) => setConds(conds.map((c, j) => (j === i ? { ...c, ...p } : c)), live)
  const vars = d.vars ?? []
  const unitOf = (c: Condition): string => {
    const own = d.kinds?.find((k) => k.id === c.mode)
    if (own) return own.unit
    const u = CONDITION_KINDS.find((k) => k.id === c.mode)?.unit ?? ''
    return u === 'dist' ? d.distanceUnit || 'm' : u === 's' ? UI.seconds : u === 'hour' ? UI.hour : u
  }
  return (
    <section>
      <strong>
        {from} → {to}
      </strong>
      {conds.length > 1 && (
        <Field label={UI.when}>
          <select className="input" value={l.join ?? 'all'} onChange={(e) => onChange({ join: e.target.value as 'all' | 'any' })}>
            <option value="all">{UI.all}</option>
            <option value="any">{UI.any}</option>
          </select>
        </Field>
      )}
      {conds.length === 0 && <p className="muted">{UI.noConds}</p>}
      {conds.map((c, i) => (
        <div key={i} className="bh-cond">
          <div className="ld-inline">
            <label className="ld-inline bh-not">
              <input type="checkbox" checked={!!c.not} onChange={(e) => edit(i, { not: e.target.checked })} />
              {UI.not}
            </label>
            <select className="input" value={c.mode} aria-label={UI.when} onChange={(e) => edit(i, { mode: e.target.value })}>
              {CONDITION_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {UI.kinds[k.id]}
                </option>
              ))}
              {(d.kinds ?? []).length > 0 && (
                <optgroup label={UI.ownKinds}>
                  {(d.kinds ?? []).map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button className="icon-btn" aria-label={UI.remove} onClick={() => setConds(conds.filter((_, j) => j !== i))}>
              <X size={13} />
            </button>
          </div>
          {c.mode === 'var' &&
            (vars.length ? (
              <div className="ld-inline">
                <select className="input" value={c.varId ?? ''} aria-label={UI.variable} onChange={(e) => edit(i, { varId: e.target.value || null })}>
                  <option value="">{UI.pickVar}</option>
                  {vars.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <select className="input bh-op" value={c.op ?? '>='} aria-label={UI.when} onChange={(e) => edit(i, { op: e.target.value as CompareOp })}>
                  {COMPARE_OPS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
                <NumberInput value={c.value} aria-label={UI.number} onChange={(value) => edit(i, { value })} />
              </div>
            ) : (
              <p className="muted">{UI.noVars}</p>
            ))}
          {c.mode !== 'var' && unitOf(c) && (
            <Field label={unitOf(c)}>
              <NumberInput value={c.value} min={0} onChange={(value) => edit(i, { value })} />
            </Field>
          )}
          {c.mode === 'flag' && (
            <Field label={UI.flag}>
              <select className="input" value={c.flagId ?? ''} onChange={(e) => edit(i, { flagId: e.target.value || null })}>
                <option value="">{UI.pickFlag}</option>
                {flags.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {c.mode === 'custom' && (
            <Field label={UI.inWords}>
              <input className="input" value={c.text} placeholder={UI.inWordsPh} onFocus={typing.begin} onBlur={typing.end} onChange={(e) => edit(i, { text: e.target.value }, true)} />
            </Field>
          )}
        </div>
      ))}
      <button className="btn btn-ghost" onClick={() => setConds([...conds, { mode: 'custom', value: 0, text: '' }])}>
        <Plus size={14} /> {UI.addCond}
      </button>
      <button className="btn btn-danger" onClick={onDelete}>
        <Trash2 size={14} /> {UI.deleteArrow}
      </button>
    </section>
  )
}

function Setup({ d, set, begin, end, change }: { d: BehaviourDoc; set(fn: (d: BehaviourDoc) => BehaviourDoc): void; begin(): void; end(): void; change(fn: (d: BehaviourDoc) => BehaviourDoc): void }) {
  const live = { onFocus: begin, onBlur: end }
  const vars = d.vars ?? []
  const fields = d.fields ?? []
  const kinds = d.kinds ?? []
  return (
    <div className="bh-setup">
      <section className="bh-card">
        <h3>{UI.vars}</h3>
        <p className="muted">{UI.varsHelp}</p>
        {vars.map((v) => (
          <div key={v.id} className="ld-inline">
            <input className="input" aria-label={UI.varName} value={v.name} {...live} onChange={(e) => change((x) => ({ ...x, vars: (x.vars ?? []).map((y) => (y.id === v.id ? { ...y, name: e.target.value } : y)) }))} />
            <span className="muted">{UI.initial}</span>
            <NumberInput value={v.initial} aria-label={UI.initial} onChange={(initial) => set((x) => ({ ...x, vars: (x.vars ?? []).map((y) => (y.id === v.id ? { ...y, initial } : y)) }))} />
            <button className="icon-btn" aria-label={UI.remove} onClick={() => set((x) => ({ ...x, vars: (x.vars ?? []).filter((y) => y.id !== v.id) }))}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => set((x) => ({ ...x, vars: [...(x.vars ?? []), { id: newId(), name: `variable_${(x.vars ?? []).length + 1}`, initial: 0 }] }))}>
          <Plus size={14} /> {UI.addVariable}
        </button>
      </section>

      <section className="bh-card">
        <h3>{UI.fields}</h3>
        <p className="muted">{UI.fieldsHelp}</p>
        {fields.map((f) => (
          <div key={f.id} className="ld-inline">
            <input className="input" aria-label={UI.fieldName} value={f.name} {...live} onChange={(e) => change((x) => ({ ...x, fields: (x.fields ?? []).map((y) => (y.id === f.id ? { ...y, name: e.target.value } : y)) }))} />
            <select className="input" value={f.kind} onChange={(e) => set((x) => ({ ...x, fields: (x.fields ?? []).map((y) => (y.id === f.id ? { ...y, kind: e.target.value as 'number' | 'text' } : y)) }))}>
              <option value="number">{UI.kindNumber}</option>
              <option value="text">{UI.kindText}</option>
            </select>
            <button className="icon-btn" aria-label={UI.remove} onClick={() => set((x) => ({ ...x, fields: (x.fields ?? []).filter((y) => y.id !== f.id) }))}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => set((x) => ({ ...x, fields: [...(x.fields ?? []), { id: newId(), name: `${UI.fieldName} ${(x.fields ?? []).length + 1}`, kind: 'text' }] }))}>
          <Plus size={14} /> {UI.addField}
        </button>
      </section>

      <section className="bh-card">
        <h3>{UI.ownKinds}</h3>
        <p className="muted">{UI.ownKindsHelp}</p>
        {kinds.map((k) => (
          <div key={k.id} className="ld-inline">
            <input className="input" aria-label={UI.kindLabel} value={k.label} {...live} onChange={(e) => change((x) => ({ ...x, kinds: (x.kinds ?? []).map((y) => (y.id === k.id ? { ...y, label: e.target.value } : y)) }))} />
            <input className="input bh-unit" aria-label={UI.unit} placeholder={UI.unit} value={k.unit} {...live} onChange={(e) => change((x) => ({ ...x, kinds: (x.kinds ?? []).map((y) => (y.id === k.id ? { ...y, unit: e.target.value } : y)) }))} />
            <button className="icon-btn" aria-label={UI.remove} onClick={() => set((x) => ({ ...x, kinds: (x.kinds ?? []).filter((y) => y.id !== k.id) }))}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => set((x) => ({ ...x, kinds: [...(x.kinds ?? []), { id: newId(), label: `${UI.kindLabel} ${(x.kinds ?? []).length + 1}`, unit: '' }] }))}>
          <Plus size={14} /> {UI.addKind}
        </button>
      </section>

      <section className="bh-card">
        <h3>{UI.distance}</h3>
        <p className="muted">{UI.distanceHelp}</p>
        <input className="input bh-unit" aria-label={UI.distance} value={d.distanceUnit ?? 'm'} {...live} onChange={(e) => change((x) => ({ ...x, distanceUnit: e.target.value }))} />
      </section>
    </div>
  )
}

const blockColor = (i: number) => `color-mix(in srgb, var(--accent) ${[70, 45, 85, 55, 35, 62][i % 6]}%, var(--bg-elevated))`

function Routine({ d, set, typing }: { d: BehaviourDoc; set(fn: (d: BehaviourDoc) => BehaviourDoc): void; typing: Typing }) {
  const [day, setDay] = useState<number | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: Id; mode: 'move' | 'end'; x0: number; orig: RoutineBlock } | null>(null)
  const blocks = [...d.routine].filter((b) => onDay(b, day)).sort((a, b) => minutesOf(a.from) - minutesOf(b.from))
  const states = statesOf(d.scene)
  const edit = (id: Id, p: Partial<RoutineBlock>, live = false) => (live ? typing.change : set)((x) => ({ ...x, routine: x.routine.map((r) => (r.id === id ? { ...r, ...p } : r)) }))
  const pct = (t: string) => `${(Math.min(1440, Math.max(0, minutesOf(t) || 0)) / 1440) * 100}%`
  const down = (e: ReactPointerEvent, b: RoutineBlock, mode: 'move' | 'end') => {
    if (e.button !== 0) return
    e.stopPropagation()
    strip.current?.setPointerCapture(e.pointerId)
    drag.current = { id: b.id, mode, x0: e.clientX, orig: b }
    typing.begin()
  }
  const moveDrag = (e: ReactPointerEvent) => {
    const g = drag.current
    const w = strip.current?.clientWidth
    if (!g || !w) return
    const next = shiftBlock(g.orig, ((e.clientX - g.x0) / w) * 1440, g.mode)
    typing.change((x) => ({ ...x, routine: x.routine.map((r) => (r.id === g.id ? next : r)) }))
  }
  const up = () => {
    if (!drag.current) return
    drag.current = null
    typing.end()
  }
  const hasDay = (b: RoutineBlock, k: number) => !b.days?.length || b.days.includes(k)
  const toggleDay = (b: RoutineBlock, k: number) => {
    const have = b.days?.length ? b.days : [0, 1, 2, 3, 4, 5, 6]
    const next = have.includes(k) ? have.filter((x) => x !== k) : [...have, k].sort()
    // All seven (or none) = every day, stored as no list.
    edit(b.id, { days: next.length === 7 || next.length === 0 ? undefined : next })
  }
  const example = (): RoutineBlock[] => [
    { id: newId(), from: '07:00', to: '09:00', place: UI.exHome, does: UI.exBreakfast },
    { id: newId(), from: '09:00', to: '17:00', place: UI.exWork, does: UI.exWorking, days: [0, 1, 2, 3, 4] },
    { id: newId(), from: '17:00', to: '22:00', place: UI.exPlaza, does: UI.exChat },
    { id: newId(), from: '22:00', to: '07:00', place: UI.exHome, does: UI.exSleep },
  ]
  return (
    <div className="bh-routine">
      <p className="muted">{UI.routineHelp}</p>
      <div className="ld-inline bh-days" role="group" aria-label={UI.showDay}>
        <button className={`btn btn-ghost${day === null ? ' on' : ''}`} onClick={() => setDay(null)}>
          {UI.everyDay}
        </button>
        {UI.days.map((n, k) => (
          <button key={k} className={`btn btn-ghost${day === k ? ' on' : ''}`} onClick={() => setDay(k)}>
            {n}
          </button>
        ))}
      </div>
      <div className="bh-strip" ref={strip} onPointerMove={moveDrag} onPointerUp={up} onPointerCancel={up}>
        {Array.from({ length: 25 }, (_, h) => (
          <span key={h} className="bh-hour" style={{ left: `${(h / 24) * 100}%` }}>
            {h % 3 === 0 ? h : ''}
          </span>
        ))}
        {blocks.flatMap((b, i) => {
          const s = minutesOf(b.from)
          const e = minutesOf(b.to)
          const parts = e > s ? [[b.from, b.to]] : [[b.from, '24:00'], ['00:00', b.to]]
          const st = states.find((x) => x.id === b.stateId)
          return parts.map(([f, t], k) => (
            <div
              key={b.id + k}
              className="bh-block"
              style={{ left: pct(f), width: `calc(${pct(t)} - ${pct(f)})`, background: blockColor(i) }}
              title={`${b.from}–${b.to} ${b.place}: ${b.does}${st ? ` (${st.title})` : ''}`}
              onPointerDown={(ev) => down(ev, b, 'move')}
            >
              <span>{b.place}</span>
              {k === parts.length - 1 && <span className="bh-block-end" onPointerDown={(ev) => down(ev, b, 'end')} />}
            </div>
          ))
        })}
      </div>
      <table className="calc-table bh-table">
        <thead>
          <tr>
            <th>{UI.from}</th>
            <th>{UI.to}</th>
            <th>{UI.where}</th>
            <th>{UI.doesWhat}</th>
            <th>{UI.inState}</th>
            <th>{UI.onDays}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <tr key={b.id}>
              <td>
                <input className="input" type="time" value={b.from} onChange={(e) => edit(b.id, { from: e.target.value })} aria-label={UI.from} />
              </td>
              <td>
                <input className="input" type="time" value={b.to} onChange={(e) => edit(b.id, { to: e.target.value })} aria-label={UI.to} />
              </td>
              <td>
                <input className="input" placeholder={UI.where} value={b.place} onFocus={typing.begin} onBlur={typing.end} onChange={(e) => edit(b.id, { place: e.target.value }, true)} />
              </td>
              <td>
                <input className="input" placeholder={UI.doesWhat} value={b.does} onFocus={typing.begin} onBlur={typing.end} onChange={(e) => edit(b.id, { does: e.target.value }, true)} />
              </td>
              <td>
                <select className="input" value={b.stateId ?? ''} aria-label={UI.inState} onChange={(e) => edit(b.id, { stateId: e.target.value || null })}>
                  <option value="">{UI.none}</option>
                  {states.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </td>
              <td className="bh-daycells">
                {UI.days.map((n, k) => (
                  <button key={k} className={`bh-day${hasDay(b, k) ? ' on' : ''}`} aria-pressed={hasDay(b, k)} onClick={() => toggleDay(b, k)}>
                    {n}
                  </button>
                ))}
              </td>
              <td>
                <button className="icon-btn" aria-label={UI.remove} onClick={() => set((x) => ({ ...x, routine: x.routine.filter((r) => r.id !== b.id) }))}>
                  <X size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ld-inline">
        <button
          className="btn btn-ghost"
          onClick={() => set((x) => ({ ...x, routine: [...x.routine, { id: newId(), from: blocks.at(-1)?.to || '08:00', to: '12:00', place: UI.exShop, does: UI.exCounter, ...(day !== null ? { days: [day] } : {}) }] }))}
        >
          <Plus size={14} /> {UI.block}
        </button>
        {d.routine.length === 0 && (
          <button className="btn btn-ghost" onClick={() => set((x) => ({ ...x, routine: example() }))}>
            {UI.exampleDay}
          </button>
        )}
      </div>
    </div>
  )
}
