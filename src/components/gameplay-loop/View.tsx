import { ArrowLeft, ArrowRight, GitBranch, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useUndoRedoKeys } from '@/core/state'
import { NumberInput, PresetHeader } from '@/shared/calculators'
import { ProofTextarea } from '@/shared/spell'
import {
  arcs,
  createLoopDoc,
  nodeColor,
  moveNode,
  newBranch,
  newNode,
  NODE_KINDS,
  normalizeLoop,
  removeBranch,
  removeNode,
  totalMinutes,
  type Branch,
  type LoopDoc,
  type LoopNode,
  type NodeKind,
} from './model'
import { SimPanel } from './SimPanel'
import './gameplay-loop.css'
import { zoomOf } from '@/shared/zoom'

const R = 190
const RING = 26
const CARD_W = 170
const CARD_H = 46
const FIRST_GAP = 120
const STEP_GAP = 175

interface Placed {
  b: Branch
  x: number
  y: number
  angle: number
  from: { x: number; y: number }
}

const polar = (r: number, a: number) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r })
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Lay branches out like a fan around their step, children further out than their parent. */
function placeBranches(d: LoopDoc, spans: Map<Id, { mid: number; span: number }>): Placed[] {
  const out: Placed[] = []
  const place = (list: Branch[], center: number, spread: number, radius: number, from: (b: Branch) => { x: number; y: number }) => {
    list.forEach((b, i) => {
      const angle = center + (i - (list.length - 1) / 2) * spread
      const p = polar(radius, angle)
      out.push({ b, x: p.x, y: p.y, angle, from: from(b) })
      const kids = d.branches.filter((k) => k.parentId === b.id)
      if (kids.length) place(kids, angle, Math.max(Math.min(spread, 0.5) * 0.7, (CARD_W + 16) / (radius + STEP_GAP)), radius + STEP_GAP, () => p)
    })
  }
  for (const n of d.nodes) {
    const s = spans.get(n.id)
    if (!s) continue
    const top = d.branches.filter((b) => b.nodeId === n.id && !b.parentId)
    const radius = R + RING / 2 + FIRST_GAP
    // Far enough apart that neighbouring cards never overlap.
    const spread = Math.max((CARD_W + 16) / radius, Math.min(0.42, s.span / Math.max(1, top.length)))
    place(top, s.mid, spread, radius, () => polar(R + RING / 2 + 26, s.mid))
  }
  return out
}

function arcPath(r: number, a0: number, a1: number) {
  const p0 = polar(r, a0)
  const p1 = polar(r, a1)
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`
}

/** Gameplay Loop (v0.9): a loop as a circular timeline with notes branching off each step. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<LoopDoc>('gameplay-loop', documentId!, createLoopDoc)
  useUndoRedoKeys(doc, active)
  const [sel, setSel] = useState<{ kind: 'node' | 'branch'; id: Id } | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [mode, setMode] = useState<'loop' | 'sim'>('loop')
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  if (!doc.data) return null
  const d = normalizeLoop(doc.data)
  const set = (fn: (d: LoopDoc) => LoopDoc) => doc.update((x) => fn(normalizeLoop(x)))
  const editNode = (id: Id, patch: Partial<LoopNode>) => set((x) => ({ ...x, nodes: x.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))
  const editBranch = (id: Id, patch: Partial<Branch>) => set((x) => ({ ...x, branches: x.branches.map((b) => (b.id === id ? { ...b, ...patch } : b)) }))

  const layout = arcs(d)
  const spans = new Map(layout.map((a) => [a.id, { mid: a.mid, span: a.end - a.start }]))
  const placed = placeBranches(d, spans)
  // Fit the view to what is drawn.
  const pad = 30
  const xs = [-(R + RING + pad), R + RING + pad, ...placed.flatMap((p) => [p.x - CARD_W / 2 - pad, p.x + CARD_W / 2 + pad])]
  const ys = [-(R + RING + pad), R + RING + pad, ...placed.flatMap((p) => [p.y - CARD_H / 2 - pad, p.y + CARD_H / 2 + pad])]
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
  const node = sel?.kind === 'node' ? d.nodes.find((n) => n.id === sel.id) : undefined
  const branch = sel?.kind === 'branch' ? d.branches.find((b) => b.id === sel.id) : undefined
  const total = totalMinutes(d)

  const addStep = () => {
    const n = newNode()
    set((x) => {
      const at = node ? x.nodes.findIndex((o) => o.id === node.id) + 1 : x.nodes.length
      const nodes = [...x.nodes]
      nodes.splice(at, 0, n)
      return { ...x, nodes }
    })
    setSel({ kind: 'node', id: n.id })
  }
  const addBranch = (nodeId: Id, parentId: Id | null) => {
    const b = newBranch(nodeId, parentId)
    set((x) => ({ ...x, branches: [...x.branches, b] }))
    setSel({ kind: 'branch', id: b.id })
  }

  return (
    <div className="gl">
      <div className="gl-head">
        <PresetHeader documentId={documentId!} kind="Gameplay loop" undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
      </div>
      <div className="gl-toolbar">
        <div className="calc-segmented" role="tablist">
          <button className={mode === 'loop' ? 'on' : ''} onClick={() => setMode('loop')}>
            Loop
          </button>
          <button className={mode === 'sim' ? 'on' : ''} onClick={() => setMode('sim')}>
            Simulate
          </button>
        </div>
        <button className="btn btn-primary" onClick={addStep}>
          <Plus size={14} /> {node ? 'Add step after this' : 'Add step'}
        </button>
        <label className="gl-check">
          <input type="checkbox" checked={d.timed} onChange={(e) => set((x) => ({ ...x, timed: e.target.checked }))} />
          Size steps by time
        </label>
        <span className="gl-total">
          {d.nodes.length} steps · one loop takes about {total} min
        </span>
      </div>
      {mode === 'sim' ? (
        <SimPanel d={d} set={set} />
      ) : (
      <div className="gl-body">
        <svg
          className="gl-canvas"
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          onWheel={(e) => setView((v) => ({ ...v, k: Math.min(3, Math.max(0.4, v.k * (e.deltaY < 0 ? 1.1 : 0.9))) }))}
          onMouseDown={(e) => {
            if (e.target !== e.currentTarget) return
            pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
            setSel(null)
          }}
          onMouseMove={(e) => {
            const p = pan.current
            if (!p) return
            const scale = Math.max(box.w / e.currentTarget.clientWidth, box.h / e.currentTarget.clientHeight) / view.k / zoomOf(e.currentTarget)
            setView((v) => ({ ...v, x: p.vx + (e.clientX - p.x) * scale, y: p.vy + (e.clientY - p.y) * scale }))
          }}
          onMouseUp={() => (pan.current = null)}
          onMouseLeave={() => (pan.current = null)}
        >
          <defs>
            <marker id="gl-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--text-muted)" />
            </marker>
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <circle r={R} className="gl-track" strokeWidth={RING} />
            {layout.map((a, i) => {
              const n = d.nodes[i]
              const gap = Math.min(0.06, (a.end - a.start) / 6)
              return (
                <g key={n.id} className={`gl-arc${sel?.id === n.id ? ' on' : ''}`} onMouseDown={() => setSel({ kind: 'node', id: n.id })}>
                  <path d={arcPath(R, a.start + gap, a.end - gap)} stroke={nodeColor(n)} strokeWidth={RING} fill="none" />
                  <path d={arcPath(R + RING, a.start + gap, a.end - gap)} stroke="var(--text-muted)" strokeWidth={1.5} fill="none" markerEnd="url(#gl-arrow)" opacity={0.6} />
                </g>
              )
            })}
            {layout.map((a, i) => {
              const n = d.nodes[i]
              const p = polar(R, a.mid)
              const label = polar(R - RING - 26, a.mid)
              return (
                <g key={`n${n.id}`} className="gl-node" onMouseDown={() => setSel({ kind: 'node', id: n.id })}>
                  <circle cx={p.x} cy={p.y} r={20} fill="var(--bg-elevated)" stroke={nodeColor(n)} strokeWidth={sel?.id === n.id ? 5 : 3} />
                  <text x={p.x} y={p.y} className="gl-num">
                    {i + 1}
                  </text>
                  <text x={label.x} y={label.y} className="gl-label" textAnchor={Math.abs(Math.cos(a.mid)) < 0.3 ? 'middle' : Math.cos(a.mid) > 0 ? 'end' : 'start'}>
                    {cut(n.title || 'Untitled', 18)}
                  </text>
                  {d.timed && (
                    <text x={label.x} y={label.y + 20} className="gl-sub" textAnchor={Math.abs(Math.cos(a.mid)) < 0.3 ? 'middle' : Math.cos(a.mid) > 0 ? 'end' : 'start'}>
                      {n.minutes} min
                    </text>
                  )}
                </g>
              )
            })}
            {placed.map((p) => (
              <line key={`l${p.b.id}`} x1={p.from.x} y1={p.from.y} x2={p.x} y2={p.y} className="gl-branchline" />
            ))}
            {placed.map((p) => {
              const on = sel?.id === p.b.id
              return (
                <g key={p.b.id} className="gl-card" transform={`translate(${p.x - CARD_W / 2} ${p.y - CARD_H / 2})`} onMouseDown={() => setSel({ kind: 'branch', id: p.b.id })}>
                  <rect width={CARD_W} height={CARD_H} rx={8} className={on ? 'on' : ''} />
                  <text x={10} y={19} className="gl-cardtitle">
                    {cut(p.b.title || 'Untitled', 22)}
                  </text>
                  <text x={10} y={36} className="gl-sub">
                    {cut(p.b.notes.replace(/\s+/g, ' '), 27)}
                  </text>
                </g>
              )
            })}
            <text y={-6} className="gl-center">
              {d.nodes.length ? 'Gameplay loop' : 'Add the first step'}
            </text>
            <text y={16} className="gl-sub" textAnchor="middle">
              {total} min per loop
            </text>
          </g>
        </svg>

        {node && (
          <aside className="gl-side">
            <div className="gl-side-head">
              <input className="input gl-title" value={node.title} onChange={(e) => editNode(node.id, { title: e.target.value })} aria-label="Step name" />
            </div>
            <label className="gl-field">
              Type
              <select className="input" value={node.kind} onChange={(e) => editNode(node.id, { kind: e.target.value as NodeKind })}>
                {NODE_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="gl-field">
              Segment color
              <div className="gl-colors">
                <input type="color" aria-label="Segment color" value={nodeColor(node)} onChange={(e) => editNode(node.id, { color: e.target.value })} />
                {node.color && (
                  <button className="btn btn-ghost" onClick={() => editNode(node.id, { color: undefined })}>
                    Use the type color
                  </button>
                )}
              </div>
            </div>
            <label className="gl-field">
              What the player does
              <ProofTextarea className="input" rows={2} value={node.does} onChange={(e) => editNode(node.id, { does: e.target.value })} />
            </label>
            <label className="gl-field">
              What it gives them
              <ProofTextarea className="input" rows={2} value={node.gives} onChange={(e) => editNode(node.id, { gives: e.target.value })} />
            </label>
            <label className="gl-field">
              Minutes it takes
              <NumberInput value={node.minutes} min={0} onChange={(v) => editNode(node.id, { minutes: Math.max(0, v) })} />
            </label>
            <label className="gl-field">
              Notes
              <ProofTextarea className="input" rows={4} value={node.notes} onChange={(e) => editNode(node.id, { notes: e.target.value })} />
            </label>
            <div className="gl-actions">
              <button className="btn" onClick={() => addBranch(node.id, null)}>
                <GitBranch size={14} /> Add branch
              </button>
              <button className="icon-btn" title="Move earlier" aria-label="Move earlier" onClick={() => set((x) => moveNode(x, node.id, -1))}>
                <ArrowLeft size={15} />
              </button>
              <button className="icon-btn" title="Move later" aria-label="Move later" onClick={() => set((x) => moveNode(x, node.id, 1))}>
                <ArrowRight size={15} />
              </button>
              <button
                className="icon-btn gl-danger"
                title="Delete step"
                aria-label="Delete step"
                onClick={() => {
                  set((x) => removeNode(x, node.id))
                  setSel(null)
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </aside>
        )}
        {branch && (
          <aside className="gl-side">
            <div className="gl-side-head">
              <input className="input gl-title" value={branch.title} onChange={(e) => editBranch(branch.id, { title: e.target.value })} aria-label="Branch name" />
            </div>
            <span className="muted gl-from">on {d.nodes.find((n) => n.id === branch.nodeId)?.title}</span>
            <label className="gl-field">
              Notes
              <ProofTextarea className="input" rows={8} value={branch.notes} onChange={(e) => editBranch(branch.id, { notes: e.target.value })} />
            </label>
            <div className="gl-actions">
              <button className="btn" onClick={() => addBranch(branch.nodeId, branch.id)}>
                <GitBranch size={14} /> Branch off this
              </button>
              <button
                className="icon-btn gl-danger"
                title="Delete branch"
                aria-label="Delete branch"
                onClick={() => {
                  set((x) => removeBranch(x, branch.id))
                  setSel(null)
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </aside>
        )}
      </div>
      )}
    </div>
  )
}
