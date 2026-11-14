// EXPERIMENTAL: Material Lab's Graph view, a node editor on the same Material Maker graph the Simple view uses.
import { Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Gen, Json } from '@/shared/material/gen'
import { listNodes, mmLibrary, PICTURE_TYPES } from '@/shared/material/library'
import { loadMaterial, MAPS, materialNode } from '@/shared/material/material'
import { type MaterialRenderer, toBytes } from '@/shared/material/render'

const T = {
  add: 'Add node',
  addHint: 'Space or right-click on the graph',
  search: 'Search nodes: name or what it does',
  del: 'Delete node',
  nothing: 'Click a node to change its settings. Drag from a dot on the right of a node to a dot on the left of another to connect them. Drag the background to move around, scroll to zoom.',
  later: 'This kind of setting can be changed in a later version.',
  noSettings: 'This node has no settings.',
  material: 'The finished material: whatever is plugged in here is what the preview shows and what gets saved.',
}

const W = 150
const ROW = 18
const HEAD = 24
const THUMB = 64
// Material Maker's nodes show their settings inside, so its graphs are packed tighter than our small boxes need
const SX = 1.25
const SY = 1.6

type Graph = Json
type Change = (fn: (g: Graph) => Graph, undoable: boolean) => void

interface Box {
  name: string
  title: string
  x: number
  y: number
  inputs: string[]
  outputs: string[]
  isMaterial: boolean
}

const nodeTitle = (n: Json): string => {
  if (MAT_TYPES.has(n.type)) return 'Material'
  const d = mmLibrary.get(n.type)
  return d?.shader_model?.name ?? d?.label ?? n.label ?? n.type ?? n.name
}
const MAT_TYPES = new Set(['material', 'material_unlit', 'material_dynamic'])
const portName = (p: Json) => p.shortdesc ?? p.label?.replace(/^\d+:/, '') ?? p.name ?? ''

/** Material Maker gives a node without a stored seed one from its position; keep it when the node is moved. */
function keepSeed(n: Json) {
  if (n.seed_int !== undefined || n.seed !== undefined || n.seed_value !== undefined) return
  n.seed = ((Math.trunc(n.node_position?.x ?? 0) * 0x1f1f1f1f) ^ Math.trunc(n.node_position?.y ?? 0)) % 65536
}

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const k = Math.max(40, Math.abs(x2 - x1) / 2)
  return `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`
}

/** A setting of the selected node. */
function Param({ def, value, onChange }: { def: Json; value: Json; onChange(v: Json, undoable: boolean): void }) {
  const label = def.shortdesc ?? def.label?.replace(/^\d+:/, '') ?? def.name
  const help = def.longdesc
  if (def.type === 'float') {
    const min = def.min ?? 0, max = def.max ?? 1, step = def.step ?? 0.01
    return (
      <label className="mat-slider" title={help}>
        <span>{label}</span>
        <span className="mat-row">
          <input type="range" min={min} max={max} step={step} value={+value} onChange={e => onChange(+e.target.value, false)} onPointerUp={e => onChange(+e.currentTarget.value, true)} />
          <input type="number" className="mat-num" step={step} value={+value} onChange={e => onChange(+e.target.value, true)} />
        </span>
      </label>
    )
  }
  if (def.type === 'enum' || def.type === 'size') {
    const values: { name: string; value: number }[] = def.type === 'size' ? Array.from({ length: (def.last ?? 12) - (def.first ?? 4) + 1 }, (_, i) => ({ name: `${2 ** ((def.first ?? 4) + i)} px`, value: (def.first ?? 4) + i })) : def.values.map((v: Json, i: number) => ({ name: v.name, value: i }))
    return (
      <label className="mat-row" title={help}>
        <span>{label}</span>
        <select value={+value} onChange={e => onChange(+e.target.value, true)}>
          {values.map(v => <option key={v.value} value={v.value}>{v.name}</option>)}
        </select>
      </label>
    )
  }
  if (def.type === 'boolean') {
    return (
      <label className="mat-row" title={help}>
        <span>{label}</span>
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked, true)} />
      </label>
    )
  }
  if (def.type === 'color') {
    const c = value ?? { r: 1, g: 1, b: 1, a: 1 }
    const hex = '#' + [c.r, c.g, c.b].map((v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
    return (
      <label className="mat-row" title={help}>
        <span>{label}</span>
        <input type="color" value={hex} onChange={e => onChange({ ...c, type: 'Color', r: parseInt(e.target.value.slice(1, 3), 16) / 255, g: parseInt(e.target.value.slice(3, 5), 16) / 255, b: parseInt(e.target.value.slice(5, 7), 16) / 255 }, true)} />
      </label>
    )
  }
  return (
    <p className="mat-muted mat-small" title={help}>
      {label}: {T.later}
    </p>
  )
}

/** The node search that Space or right-click opens. */
function AddMenu({ at, onPick, onClose }: { at: { x: number; y: number }; onPick(id: string): void; onClose(): void }) {
  const [q, setQ] = useState('')
  const all = useMemo(() => listNodes(), [])
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hits = all.filter(n => words.every(w => `${n.name} ${n.id} ${n.description}`.toLowerCase().includes(w))).slice(0, 60)
  return (
    <div className="mat-add" style={{ left: at.x, top: at.y }} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
      <label className="mat-search">
        <Search size={14} aria-hidden />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={T.search} aria-label={T.search}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            } else if (e.key === 'Enter' && hits[0]) onPick(hits[0].id)
          }} />
      </label>
      <div className="mat-add-list" role="listbox">
        {hits.map(n => (
          <button key={n.id} role="option" aria-selected={false} onClick={() => onPick(n.id)} title={n.description}>
            <strong>{n.name}</strong>
            <span className="mat-muted mat-small">{n.description.split(/(?<=\.)\s/)[0]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function GraphView({ graph, change, renderer, variation }: { graph: Graph; change: Change; renderer: () => MaterialRenderer; variation: number }) {
  const [view, setView] = useState({ x: 40, y: 40, k: 0.8 })
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; gx: number; gy: number } | null>(null)
  const [wire, setWire] = useState<{ from: string; port: number; x: number; y: number } | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: 'pan' | 'node'; name?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const [nodeDrag, setNodeDrag] = useState<{ name: string; x: number; y: number } | null>(null)

  // the node graph (without the Material node), for port lists and thumbnails
  const loaded = useMemo(() => {
    try {
      return loadMaterial(graph)
    } catch {
      return null
    }
  }, [graph])

  const boxes: Box[] = useMemo(() => (graph.nodes ?? []).map((n: Json): Box => {
    const isMaterial = n === materialNode(graph)
    const gen: Gen | undefined = loaded?.graph.child(n.name)
    const pos = nodeDrag && nodeDrag.name === n.name ? nodeDrag : { x: (n.node_position?.x ?? 0) * SX, y: (n.node_position?.y ?? 0) * SY }
    return {
      name: n.name, title: nodeTitle(n), x: pos.x, y: pos.y, isMaterial,
      inputs: isMaterial ? MAPS.map(m => m.name) : (gen?.getInputDefs() ?? []).map(portName),
      outputs: isMaterial ? [] : (gen?.getOutputDefs() ?? []).map(portName),
    }
  }), [graph, loaded, nodeDrag])
  const byName = useMemo(() => new Map(boxes.map(b => [b.name, b])), [boxes])
  const height = (b: Box) => HEAD + Math.max(b.inputs.length, b.outputs.length, 1) * ROW + (b.isMaterial ? 0 : THUMB + 8)
  const outAt = (b: Box, i: number) => ({ x: b.x + W, y: b.y + HEAD + i * ROW + ROW / 2 })
  const inAt = (b: Box, i: number) => ({ x: b.x, y: b.y + HEAD + i * ROW + ROW / 2 })

  // start with the whole graph in view
  useEffect(() => {
    const r = root.current?.getBoundingClientRect()
    if (!r || !boxes.length) return
    const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y))
    const x1 = Math.max(...boxes.map(b => b.x + W)), y1 = Math.max(...boxes.map(b => b.y + height(b)))
    const k = Math.max(0.3, Math.min(1, (r.width - 80) / (x1 - x0), (r.height - 100) / (y1 - y0)))
    setView({ k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: 60 + (r.height - 100 - (y1 - y0) * k) / 2 - y0 * k })
    // only when the view opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // small pictures of every node's first output, drawn one at a time after each change
  const key = useMemo(() => JSON.stringify(graph.nodes?.map((n: Json) => [n.name, n.type, n.parameters, n.seed, n.seed_int])) + JSON.stringify(graph.connections) + variation, [graph, variation])
  useEffect(() => {
    if (!loaded) return
    let stop = false
    const todo = [...loaded.graph.children].filter(g => g.getOutputDefs().some(o => PICTURE_TYPES.includes(o.type)))
    const step = () => {
      if (stop) return
      const gen = todo.shift()
      if (!gen) return
      try {
        const r = renderer()
        r.variation = variation
        const out = gen.getOutputDefs().findIndex(o => PICTURE_TYPES.includes(o.type))
        const res = r.render(gen, out, THUMB)
        const c = document.createElement('canvas')
        c.width = c.height = THUMB
        c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(toBytes(res)), THUMB, THUMB), 0, 0)
        const url = c.toDataURL()
        setThumbs(t => ({ ...t, [gen.name]: url }))
      } catch {
        // a node that can't be drawn keeps no picture
      }
      setTimeout(step, 0)
    }
    const t = setTimeout(step, 150)
    return () => {
      stop = true
      clearTimeout(t)
    }
    // loaded follows key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const toGraph = (cx: number, cy: number) => {
    const r = root.current!.getBoundingClientRect()
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k }
  }

  const addNode = (type: string, at: { x: number; y: number }) => {
    let i = 1
    const names = new Set((graph.nodes ?? []).map((n: Json) => n.name))
    while (names.has(`${type}_${i}`)) i++
    const name = `${type}_${i}`
    change(g => ({ ...g, nodes: [...g.nodes, { name, type, parameters: {}, node_position: { x: Math.round(at.x / SX), y: Math.round(at.y / SY) }, seed_int: Math.floor(Math.random() * 2 ** 31) }] }), true)
    setSelected(name)
    setMenu(null)
  }

  const remove = (name: string) => {
    if (name === materialNode(graph)?.name) return
    change(g => ({ ...g, nodes: g.nodes.filter((n: Json) => n.name !== name), connections: g.connections.filter((c: Json) => c.from !== name && c.to !== name) }), true)
    setSelected(null)
  }

  const connect = (from: string, fromPort: number, to: string, toPort: number) => {
    if (from === to) return
    change(g => ({ ...g, connections: [...g.connections.filter((c: Json) => !(c.to === to && c.to_port === toPort)), { from, from_port: fromPort, to, to_port: toPort }] }), true)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return
    if (e.key === ' ') {
      e.preventDefault()
      const r = root.current!.getBoundingClientRect()
      const g = toGraph(r.left + r.width / 2, r.top + r.height / 2)
      setMenu({ x: r.width / 2 - 150, y: 40, gx: g.x, gy: g.y })
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault()
      remove(selected)
    } else if (e.key === 'Escape' && (menu || selected)) {
      e.preventDefault()
      setMenu(null)
      setSelected(null)
    }
  }

  const sel = selected ? (graph.nodes ?? []).find((n: Json) => n.name === selected) : null
  const selGen = sel && loaded?.graph.child(sel.name)
  const selDesc = sel && (mmLibrary.get(sel.type)?.shader_model?.longdesc ?? mmLibrary.get(sel.type)?.longdesc ?? '')
  const setParam = (name: string, v: Json, undoable: boolean) =>
    change(g => ({ ...g, nodes: g.nodes.map((n: Json) => (n.name === selected ? { ...n, parameters: { ...(n.parameters ?? {}), [name]: v } } : n)) }), undoable)

  return (
    <div className="mat-graph-wrap">
      <div
        ref={root}
        className="mat-graph"
        tabIndex={0}
        aria-label="Node graph"
        onKeyDown={onKeyDown}
        onContextMenu={e => {
          e.preventDefault()
          const r = root.current!.getBoundingClientRect()
          const g = toGraph(e.clientX, e.clientY)
          setMenu({ x: e.clientX - r.left, y: e.clientY - r.top, gx: g.x, gy: g.y })
        }}
        onWheel={e => {
          const r = root.current!.getBoundingClientRect()
          const k = Math.max(0.2, Math.min(2.5, view.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
          const cx = e.clientX - r.left, cy = e.clientY - r.top
          setView({ k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k })
        }}
        onPointerDown={e => {
          if (e.button === 2) return
          root.current!.focus()
          setMenu(null)
          drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={e => {
          const d = drag.current
          if (wire) {
            const g = toGraph(e.clientX, e.clientY)
            setWire({ ...wire, x: g.x, y: g.y })
          }
          if (!d) return
          const dx = e.clientX - d.sx, dy = e.clientY - d.sy
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
          if (d.kind === 'pan') setView(v => ({ ...v, x: d.ox + dx, y: d.oy + dy }))
          else if (d.name) setNodeDrag({ name: d.name, x: Math.round(d.ox + dx / view.k), y: Math.round(d.oy + dy / view.k) })
        }}
        onPointerUp={e => {
          const d = drag.current
          drag.current = null
          if (d?.kind === 'pan' && !d.moved) setSelected(null)
          if (d?.kind === 'node' && d.moved && nodeDrag) {
            const { name, x, y } = nodeDrag
            change(g => ({ ...g, nodes: g.nodes.map((n: Json) => {
              if (n.name !== name) return n
              const c = structuredClone(n)
              keepSeed(c)
              c.node_position = { x: Math.round(x / SX), y: Math.round(y / SY) }
              return c
            }) }), true)
          }
          setNodeDrag(null)
          if (wire) {
            // dropped on an input dot?
            const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
            const to = el?.dataset.node, port = el?.dataset.in
            if (to && port !== undefined) connect(wire.from, wire.port, to, +port)
            setWire(null)
          }
        }}
      >
        <div className="mat-graph-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="mat-wires" aria-hidden>
            {(graph.connections ?? []).map((c: Json, i: number) => {
              const a = byName.get(c.from), b = byName.get(c.to)
              if (!a || !b) return null
              const p = outAt(a, c.from_port), q = inAt(b, c.to_port)
              return <path key={i} d={bezier(p.x, p.y, q.x, q.y)} />
            })}
            {wire && (() => {
              const a = byName.get(wire.from)
              if (!a) return null
              const p = outAt(a, wire.port)
              return <path className="mat-wire-new" d={bezier(p.x, p.y, wire.x, wire.y)} />
            })()}
          </svg>
          {boxes.map(b => (
            <div
              key={b.name}
              className={`mat-node${selected === b.name ? ' mat-node-on' : ''}${b.isMaterial ? ' mat-node-material' : ''}`}
              style={{ left: b.x, top: b.y, width: W, height: height(b) }}
              onPointerDown={e => {
                if (e.button !== 0) return
                e.stopPropagation()
                root.current!.focus()
                setSelected(b.name)
                setMenu(null)
                drag.current = { kind: 'node', name: b.name, sx: e.clientX, sy: e.clientY, ox: b.x, oy: b.y, moved: false }
                root.current!.setPointerCapture(e.pointerId)
              }}
            >
              <div className="mat-node-title" title={b.title}>{b.title}</div>
              {b.inputs.map((name, i) => (
                <div key={`i${i}`} className="mat-port mat-port-in" style={{ top: HEAD + i * ROW }}>
                  <span
                    className="mat-dot" data-node={b.name} data-in={i} title={name}
                    onPointerDown={e => {
                      // grab an existing wire off this input to move it
                      const c = (graph.connections ?? []).find((c: Json) => c.to === b.name && c.to_port === i)
                      if (!c) return
                      e.stopPropagation()
                      change(g => ({ ...g, connections: g.connections.filter((x: Json) => x !== c && !(x.to === b.name && x.to_port === i)) }), true)
                      const g = toGraph(e.clientX, e.clientY)
                      setWire({ from: c.from, port: c.from_port, x: g.x, y: g.y })
                      root.current!.setPointerCapture(e.pointerId)
                    }}
                  />
                  <span className="mat-port-name">{name}</span>
                </div>
              ))}
              {b.outputs.map((name, i) => (
                <div key={`o${i}`} className="mat-port mat-port-out" style={{ top: HEAD + i * ROW }}>
                  <span className="mat-port-name">{name}</span>
                  <span
                    className="mat-dot" title={name}
                    onPointerDown={e => {
                      e.stopPropagation()
                      const g = toGraph(e.clientX, e.clientY)
                      setWire({ from: b.name, port: i, x: g.x, y: g.y })
                      root.current!.setPointerCapture(e.pointerId)
                    }}
                  />
                </div>
              ))}
              {!b.isMaterial && (
                <div className="mat-node-thumb" style={{ top: HEAD + Math.max(b.inputs.length, b.outputs.length, 1) * ROW + 4 }}>
                  {thumbs[b.name] && <img src={thumbs[b.name]} alt="" width={THUMB} height={THUMB} />}
                </div>
              )}
            </div>
          ))}
        </div>
        {menu && <AddMenu at={menu} onPick={id => addNode(id, { x: menu.gx, y: menu.gy })} onClose={() => setMenu(null)} />}
        <button
          className="mat-graph-add"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => {
            const r = root.current!.getBoundingClientRect()
            const g = toGraph(r.left + r.width / 2, r.top + r.height / 2)
            setMenu({ x: 12, y: 48, gx: g.x, gy: g.y })
          }}
          title={T.addHint}
        >
          <Plus size={16} /> {T.add}
        </button>
      </div>
      <aside className="mat-graph-side">
        {!sel && <p className="mat-muted mat-small">{T.nothing}</p>}
        {sel && (
          <>
            <h4>{nodeTitle(sel)}</h4>
            {sel === materialNode(graph) ? <p className="mat-muted mat-small">{T.material}</p> : selDesc && <p className="mat-muted mat-small">{selDesc}</p>}
            {thumbs[sel.name] && <img className="mat-graph-big" src={thumbs[sel.name]} alt="" />}
            {sel !== materialNode(graph) && selGen && (
              <>
                {selGen.getParameterDefs().length === 0 && <p className="mat-muted mat-small">{T.noSettings}</p>}
                {selGen.getParameterDefs().map((d: Json) => (
                  <Param key={d.name} def={d} value={sel.parameters?.[d.name] ?? selGen.getParameter(d.name)} onChange={(v, u) => setParam(d.name, v, u)} />
                ))}
                <button onClick={() => remove(sel.name)}><Trash2 size={16} /> {T.del}</button>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  )
}
