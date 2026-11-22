import { ChevronDown, ChevronRight, CornerLeftUp, ImagePlus, Palette, Plus, Shuffle, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { pickAndImportAssets, useAssetUrls } from '@/core/assets'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { confirmDialog } from '@/shared/dialogs'
import {
  addBody,
  BODY_KINDS,
  CHILD_KIND,
  childrenOf,
  colorOf,
  createCosmos,
  findBody,
  ISO,
  KIND_LABEL,
  KIND_STYLE,
  moveBody,
  orbitLayout,
  pathTo,
  removeBody,
  showsOrbits,
  subtreeIds,
  treeLayout,
  updateBody,
  type Body,
  type BodyKind,
  type Cosmos,
} from './model'
import { ART_STYLES, artFor, lookCount, STYLE_LABEL, variantOf, type ArtStyle, type Layer } from './art'
import './cosmos.css'
import { ProofTextarea } from '@/shared/spell'

const UI = {
  top: 'Cosmos',
  add: 'Add',
  addInside: 'Add inside',
  open: 'Show inside',
  up: 'Up one level',
  name: 'Name',
  kind: 'Kind',
  color: 'Color',
  defaultColor: 'Default',
  notes: 'Notes',
  notesHint: 'Where it is, who lives there, what happened here…',
  delete: 'Delete',
  picture: 'Picture',
  choosePicture: 'Choose picture…',
  removePicture: 'Remove',
  empty: 'This cosmos is empty. Add a universe or a galaxy to begin, then add solar systems, planets and moons inside it.',
  emptyHere: 'Nothing inside yet. Use Add to place something here.',
  dropTop: 'Drop here to move to the top level',
  inside: (n: number) => `${n} inside`,
  style: 'Art style',
  yourSet: 'Your set',
  yourSetHint: 'Pick a picture for each kind. Kinds without one use the Painted look. Grey pictures tint best.',
  tint: 'Tint with each body\'s colour',
  nextLook: 'Next look',
  look: (i: number, n: number) => `Look ${i} of ${n}`,
  hint: 'Click to select, double-click to look inside. Drag in the list to move things.',
  graphHint: 'Click to select, double-click a galaxy or solar system to see its orbits. Drag in the list to move things.',
}

const DRAG = 'application/x-egd-cosmos-body'

export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument('cosmos', documentId!, createCosmos)
  useUndoRedoKeys(doc, active)
  const [focusId, setFocusId] = useState<Id | null>(null)
  const [selectedId, setSelectedId] = useState<Id | null>(null)
  const [addKind, setAddKind] = useState<BodyKind | ''>('')
  const [collapsed, setCollapsed] = useState<Record<Id, boolean>>({})
  const root = useProjectStore((s) => s.root)
  const [setOpen, setSetOpen] = useState(false)
  const urlOf = useAssetUrls([...(doc.data?.bodies.map((b) => b.image) ?? []), ...Object.values(doc.data?.customArt ?? {})])

  const cosmos = doc.data
  if (!cosmos) return null
  const edit = (fn: (c: Cosmos) => Cosmos) => doc.update(fn)
  const style: ArtStyle = cosmos.style ?? 'painted'
  const tint = style !== 'custom' || cosmos.customTint !== false
  const customUrl = (k: BodyKind) => (cosmos.customArt?.[k] ? urlOf(cosmos.customArt[k]) : '')

  // A body deleted (or undone away) elsewhere must not stay focused.
  const focus = findBody(cosmos, focusId) ?? null
  const selected = findBody(cosmos, selectedId) ?? null
  const shown = childrenOf(cosmos, focus?.id ?? null)

  const add = (parentId: Id | null, kind?: BodyKind) => {
    let created: Body | undefined
    edit((c) => {
      const r = addBody(c, parentId, kind)
      created = r.body
      return r.cosmos
    })
    if (created) setSelectedId(created.id)
  }

  const remove = async (b: Body) => {
    const inside = subtreeIds(cosmos, b.id).size - 1
    const ok = await confirmDialog({
      title: `Delete ${b.name}?`,
      message: inside ? `This also deletes the ${inside} things inside it. You can undo with Ctrl+Z.` : 'You can undo with Ctrl+Z.',
      confirmLabel: UI.delete,
      danger: true,
    })
    if (!ok) return
    if (selectedId && subtreeIds(cosmos, b.id).has(selectedId)) setSelectedId(null)
    edit((c) => removeBody(c, b.id))
  }

  const look = (id: Id | null) => {
    setFocusId(id)
    setSelectedId(id)
  }

  const onDrop = (e: React.DragEvent, parentId: Id | null) => {
    const id = e.dataTransfer.getData(DRAG)
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    edit((c) => moveBody(c, id, parentId))
  }
  const allowDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG)) e.preventDefault()
  }

  const renderTree = (parentId: Id | null, depth: number) =>
    childrenOf(cosmos, parentId).map((b) => {
      const kids = childrenOf(cosmos, b.id).length
      const open = !collapsed[b.id]
      return (
        <div key={b.id}>
          <div
            className={`cosmos-row${b.id === selectedId ? ' selected' : ''}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(DRAG, b.id)}
            onDragOver={allowDrop}
            onDrop={(e) => onDrop(e, b.id)}
            onClick={() => setSelectedId(b.id)}
            onDoubleClick={() => look(b.id)}
            title={KIND_LABEL[b.kind]}
          >
            <button
              className="icon-btn cosmos-twisty"
              style={{ visibility: kids ? 'visible' : 'hidden' }}
              onClick={(e) => {
                e.stopPropagation()
                setCollapsed({ ...collapsed, [b.id]: open })
              }}
            >
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            <span className="cosmos-dot" style={{ background: colorOf(b) }} />
            <span className="cosmos-row-name">{b.name}</span>
            <span className="cosmos-row-kind">{KIND_LABEL[b.kind]}</span>
          </div>
          {open && renderTree(b.id, depth + 1)}
        </div>
      )
    })

  const orbitView = showsOrbits(focus)
  // The first orbit clears the (doubled) center body.
  const orbits = orbitLayout(shown.length, (focus ? KIND_STYLE[focus.kind].size * 2 : 0) + 45)
  const select = (id: Id) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedId(id)
  }
  const mark = (b: Body, x: number, y: number, scale: number, label: boolean) => (
    <BodyMark
      body={b}
      x={x}
      y={y}
      scale={scale}
      selected={selectedId === b.id}
      label={label}
      inside={childrenOf(cosmos, b.id).length}
      image={b.image ? urlOf(b.image) : ''}
      art={artFor(style, b.kind, variantOf(b.id, b.look ?? undefined), customUrl(b.kind) || undefined)}
      tint={tint}
      pixel={style === 'pixel'}
    />
  )

  const pickPicture = async (b: Body) => {
    if (!root) return
    const [asset] = await pickAndImportAssets(root, 'image', UI.choosePicture)
    if (asset) edit((c) => updateBody(c, b.id, { image: asset.path }))
  }

  const pickKindPicture = async (k: BodyKind) => {
    if (!root) return
    const [asset] = await pickAndImportAssets(root, 'image', UI.choosePicture)
    if (asset) edit((c) => ({ ...c, customArt: { ...c.customArt, [k]: asset.path } }))
  }
  const removeKindPicture = (k: BodyKind) =>
    edit((c) => {
      const { [k]: _gone, ...rest } = c.customArt ?? {}
      return { ...c, customArt: rest }
    })
  const looks = selected ? lookCount(style, selected.kind) : 1

  return (
    <div className="cosmos-root">
      <aside className="cosmos-tree" onDragOver={allowDrop} onDrop={(e) => onDrop(e, null)} title={UI.dropTop}>
        <div className={`cosmos-row cosmos-top${selectedId === null ? ' selected' : ''}`} onClick={() => look(null)}>
          {UI.top}
        </div>
        {renderTree(null, 0)}
      </aside>

      <section className="cosmos-main">
        <div className="cosmos-toolbar">
          <button className="icon-btn" title={UI.up} disabled={!focus} onClick={() => look(focus?.parentId ?? null)}>
            <CornerLeftUp size={15} />
          </button>
          <nav className="cosmos-crumbs">
            <button onClick={() => look(null)}>{UI.top}</button>
            {pathTo(cosmos, focus?.id ?? null).map((b) => (
              <span key={b.id}>
                {' › '}
                <button onClick={() => look(b.id)}>{b.name}</button>
              </span>
            ))}
          </nav>
          <select className="input cosmos-kind" value={addKind} aria-label={UI.kind} onChange={(e) => setAddKind(e.target.value as BodyKind | '')}>
            <option value="">{KIND_LABEL[focus ? CHILD_KIND[focus.kind] : 'galaxy']}</option>
            {BODY_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={() => add(focus?.id ?? null, addKind || undefined)}>
            <Plus size={14} /> {UI.add}
          </button>
          <select
            className="input cosmos-kind"
            value={style}
            aria-label={UI.style}
            title={UI.style}
            onChange={(e) => {
              const next = e.target.value as ArtStyle
              edit((c) => ({ ...c, style: next }))
              setSetOpen(next === 'custom')
            }}
          >
            {ART_STYLES.map((st) => (
              <option key={st} value={st}>
                {STYLE_LABEL[st]}
              </option>
            ))}
          </select>
          {style === 'custom' && (
            <button className={`btn${setOpen ? ' btn-primary' : ''}`} onClick={() => setSetOpen(!setOpen)}>
              <Palette size={14} /> {UI.yourSet}
            </button>
          )}
        </div>
        {style === 'custom' && setOpen && (
          <div className="cosmos-set">
            <p className="cosmos-set-hint">{UI.yourSetHint}</p>
            <label className="cosmos-set-tint">
              <input type="checkbox" checked={cosmos.customTint !== false} onChange={(e) => edit((c) => ({ ...c, customTint: e.target.checked }))} />
              {UI.tint}
            </label>
            <div className="cosmos-set-grid">
              {BODY_KINDS.map((k) => (
                <div key={k} className="cosmos-set-item">
                  <svg viewBox="-40 -40 80 80" className="cosmos-set-preview">
                    <BodyMark
                      body={{ id: k, parentId: null, kind: k, name: '', notes: '', color: null }}
                      x={0}
                      y={0}
                      scale={18 / KIND_STYLE[k].size}
                      selected={false}
                      label={false}
                      image=""
                      art={artFor('custom', k, 0, customUrl(k) || undefined)}
                      tint={tint}
                      pixel={false}
                    />
                  </svg>
                  <span>{KIND_LABEL[k]}</span>
                  <button className="btn btn-ghost" title={UI.choosePicture} onClick={() => void pickKindPicture(k)}>
                    <ImagePlus size={14} />
                  </button>
                  <button className="btn btn-ghost" title={UI.removePicture} disabled={!cosmos.customArt?.[k]} onClick={() => removeKindPicture(k)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {orbitView ? (
          <svg className="cosmos-orbits" viewBox="-330 -190 660 380" onClick={() => setSelectedId(focus?.id ?? null)}>
            {orbits.map((o, i) => (
              <ellipse key={shown[i].id} rx={o.r} ry={o.r * ISO} className="cosmos-orbit" />
            ))}
            {/* Painter's order: things further back (higher on screen) first, so the center body hides what passes behind it. */}
            {[...(focus ? [{ body: focus, x: 0, y: 0, center: true }] : []), ...shown.map((body, i) => ({ body, x: orbits[i].x, y: orbits[i].y * ISO, center: false }))]
              .sort((p, q) => p.y - q.y)
              .map(({ body, x, y, center }) => {
                if (center) return <g key={body.id}>{mark(body, 0, 0, 2, false)}</g>
                const moons = childrenOf(cosmos, body.id)
                const base = KIND_STYLE[body.kind].size + 10
                return (
                  <g key={body.id} onClick={select(body.id)} onDoubleClick={() => look(body.id)}>
                    {moons.map((m, j) => {
                      const r = base + j * 8
                      const angle = j * 2.39996 - Math.PI / 3
                      return (
                        <g key={m.id} onClick={select(m.id)}>
                          <ellipse cx={x} cy={y} rx={r} ry={r * ISO} className="cosmos-orbit cosmos-moon-orbit" />
                          {mark(m, x + r * Math.cos(angle), y + r * ISO * Math.sin(angle), 0.6, false)}
                        </g>
                      )
                    })}
                    {mark(body, x, y, 1, true)}
                  </g>
                )
              })}
          </svg>
        ) : (
          <GraphView cosmos={cosmos} rootId={focus?.id ?? null} onBackground={() => setSelectedId(focus?.id ?? null)} select={select} look={look} mark={mark} />
        )}
        <p className="cosmos-hint">{cosmos.bodies.length === 0 ? UI.empty : shown.length === 0 ? UI.emptyHere : orbitView ? UI.hint : UI.graphHint}</p>
      </section>

      {selected && (
        <aside className="cosmos-details">
          <label>
            {UI.name}
            <input className="input" value={selected.name} onChange={(e) => edit((c) => updateBody(c, selected.id, { name: e.target.value }))} />
          </label>
          <label>
            {UI.kind}
            <select className="input" value={selected.kind} onChange={(e) => edit((c) => updateBody(c, selected.id, { kind: e.target.value as BodyKind }))}>
              {BODY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {UI.color}
            <span className="cosmos-color">
              <input type="color" value={colorOf(selected)} onChange={(e) => edit((c) => updateBody(c, selected.id, { color: e.target.value }))} />
              <button className="btn btn-ghost" disabled={!selected.color} onClick={() => edit((c) => updateBody(c, selected.id, { color: null }))}>
                {UI.defaultColor}
              </button>
            </span>
          </label>
          {looks > 1 && !selected.image && (
            <button
              className="btn"
              title={UI.look((variantOf(selected.id, selected.look ?? undefined) % looks) + 1, looks)}
              onClick={() => edit((c) => updateBody(c, selected.id, { look: (variantOf(selected.id, selected.look ?? undefined) % looks) + 1 }))}
            >
              <Shuffle size={14} /> {UI.nextLook} ({UI.look((variantOf(selected.id, selected.look ?? undefined) % looks) + 1, looks)})
            </button>
          )}
          <div className="cosmos-field">
            {UI.picture}
            <span className="cosmos-color">
              <button className="btn" onClick={() => void pickPicture(selected)}>
                <ImagePlus size={14} /> {UI.choosePicture}
              </button>
              <button className="btn btn-ghost" disabled={!selected.image} onClick={() => edit((c) => updateBody(c, selected.id, { image: null }))}>
                {UI.removePicture}
              </button>
            </span>
          </div>
          <label>
            {UI.notes}
            <ProofTextarea
              className="input cosmos-notes"
              placeholder={UI.notesHint}
              value={selected.notes}
              onChange={(e) => edit((c) => updateBody(c, selected.id, { notes: e.target.value }))}
            />
          </label>
          <div className="cosmos-actions">
            <button className="btn" onClick={() => add(selected.id)}>
              <Plus size={14} /> {UI.addInside}
            </button>
            <button className="btn" onClick={() => look(selected.id)}>
              {UI.open}
            </button>
            <button className="btn btn-ghost cosmos-delete" title={UI.delete} onClick={() => void remove(selected)}>
              <Trash2 size={14} />
            </button>
          </div>
        </aside>
      )}
    </div>
  )
}

function GraphView(p: {
  cosmos: Cosmos
  rootId: Id | null
  onBackground: () => void
  select: (id: Id) => (e: React.MouseEvent) => void
  look: (id: Id) => void
  mark: (b: Body, x: number, y: number, scale: number, label: boolean) => React.ReactNode
}) {
  // The tree lies on the isometric ground plane: across = x, deeper levels go back-right.
  const tree = treeLayout(p.cosmos, p.rootId)
  const iso = (n: { x: number; y: number }) => ({ x: (n.x - n.y) * 0.866, y: (n.x + n.y) * ISO })
  const nodes = tree.nodes.map((n) => ({ ...n, ...iso(n) })).sort((m, n) => m.y - n.y)
  const at = new Map(nodes.map((n) => [n.body.id, n]))
  const edges = tree.edges.map(([a, b]) => [at.get(a.body.id)!, at.get(b.body.id)!] as const)
  const xs = nodes.map((n) => n.x)
  const ys = nodes.map((n) => n.y)
  const pad = 70
  const minX = Math.min(0, ...xs) - pad
  const minY = Math.min(0, ...ys) - pad
  const w = Math.max(0, ...xs) - minX + pad
  const h = Math.max(0, ...ys) - minY + pad
  return (
    <svg className="cosmos-orbits" viewBox={`${minX} ${minY} ${Math.max(w, 400)} ${Math.max(h, 300)}`} onClick={p.onBackground}>
      {edges.map(([a, b]) => (
        <line key={`${a.body.id}-${b.body.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="cosmos-link" />
      ))}
      {nodes.map((n) => (
        <g key={n.body.id} onClick={p.select(n.body.id)} onDoubleClick={() => p.look(n.body.id)}>
          {p.mark(n.body, n.x, n.y, 1, true)}
        </g>
      ))}
    </svg>
  )
}

function BodyMark(p: {
  body: Body
  x: number
  y: number
  scale: number
  selected: boolean
  label: boolean
  inside?: number
  image: string
  art: Layer[] | null
  tint: boolean
  pixel: boolean
}) {
  const r = KIND_STYLE[p.body.kind].size * p.scale
  const color = colorOf(p.body)
  const diffuse = p.body.kind === 'galaxy' || p.body.kind === 'nebula' || p.body.kind === 'universe'
  const uid = `${p.body.id}-${p.scale}`
  const clip = `cosmos-clip-${uid}`
  const tintId = `cosmos-tint-${uid}`
  const layer = (l: Layer, i: number) => {
    const w = r * (l.s ?? 1)
    const at = `translate(${r * (l.x ?? 0)} ${r * (l.y ?? 0)})${l.flat ? ` scale(1 ${ISO})` : ''}${l.rot ? ` rotate(${l.rot})` : ''}`
    if (l.src.startsWith('#')) return <circle key={i} r={w} fill={l.src} transform={at} opacity={l.op} />
    return (
      <image
        key={i}
        href={l.src}
        x={-w}
        y={-w}
        width={w * 2}
        height={w * 2}
        transform={at}
        opacity={l.op}
        filter={p.tint && !l.plain ? `url(#${tintId})` : undefined}
        style={p.pixel ? { imageRendering: 'pixelated' } : undefined}
        preserveAspectRatio="xMidYMid meet"
      />
    )
  }
  return (
    <g transform={`translate(${p.x} ${p.y})`} className="cosmos-body">
      {p.selected && <circle r={r + 6} className="cosmos-selection" />}
      {p.image ? (
        <>
          <clipPath id={clip}>
            <circle r={r} />
          </clipPath>
          <image href={p.image} x={-r} y={-r} width={r * 2} height={r * 2} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />
        </>
      ) : p.art ? (
        <>
          {p.tint && (
            /* Grey picture -> body colour: dark greys darken it, light greys lighten it (overlay), shape kept from the picture. */
            <filter id={tintId} colorInterpolationFilters="sRGB">
              <feColorMatrix type="saturate" values="0" result="grey" />
              <feFlood floodColor={color} result="colour" />
              <feBlend in="colour" in2="grey" mode="overlay" result="tinted" />
              <feComposite in="tinted" in2="SourceAlpha" operator="in" />
            </filter>
          )}
          {p.art.map(layer)}
        </>
      ) : p.body.kind === 'asteroid-belt' ? (
        <ellipse rx={r} ry={r * ISO} fill="none" stroke={color} strokeWidth={3} strokeDasharray="2 3" />
      ) : diffuse ? (
        <>
          <ellipse rx={r * 1.4} ry={r * 0.8} fill={color} opacity={0.35} />
          <ellipse rx={r * 0.9} ry={r * 0.5} fill={color} opacity={0.6} />
          <ellipse rx={r * 0.35} ry={r * 0.2} fill="#fff" opacity={0.8} />
        </>
      ) : p.body.kind === 'black-hole' ? (
        <>
          <circle r={r * 1.25} fill="none" stroke={color} strokeWidth={r * 0.25} opacity={0.8} />
          <circle r={r} fill="#000" />
        </>
      ) : (
        <>
          {/* Flat disc with a shadow on the night side and a lit rim. */}
          <clipPath id={clip}>
            <circle r={r} />
          </clipPath>
          <circle r={r} fill={color} />
          <circle r={r} cx={r * 0.45} cy={r * 0.35} fill="#000" opacity={0.22} clipPath={`url(#${clip})`} />
          <circle r={r * 0.3} cx={-r * 0.35} cy={-r * 0.35} fill="#fff" opacity={0.25} />
        </>
      )}
      {p.label && (
        <text y={r + 14} className="cosmos-label">
          {p.body.name}
          {p.inside ? ` (${UI.inside(p.inside)})` : ''}
        </text>
      )}
    </g>
  )
}
