import { ChevronDown, ChevronRight, Ellipsis, Eye, EyeOff, Folder, FolderPlus, ListChecks, Lock, Merge, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Id } from '@/core/model'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { confirmDialog, promptDialog } from '../dialogs'
import { copiedPixels, copyPixels } from './clipboard'
import { toPng, type SketchEngine } from './engine'
import {
  addMask,
  combineDown,
  duplicateTree,
  groupLayers,
  hasPixels,
  insertAbove,
  isGroup,
  layerRows,
  maskOf,
  moveSibling,
  moveTo,
  removeTree,
  siblingBelow,
  subtreeIds,
  subtreeStack,
  ungroup,
} from './layers'
import './layers.css'
import { BLEND_MODES, newLayer, nextLayerName, updateLayer, type BlendMode, type SketchDoc, type SketchLayer } from './model'

const UI = {
  layers: 'Layers',
  addLayer: 'New layer',
  addGroup: 'New group (from the picked layers)',
  layerLimit: (n: number) => `This canvas holds at most ${n} layers in memory. Merge or delete layers to add more.`,
  show: 'Show',
  hide: 'Hide',
  open: 'Open group',
  close: 'Close group',
  more: 'Layer options',
  opacity: 'Opacity',
  picked: (n: number) => `${n} layers picked`,
  pickMany: 'Pick several layers: tap layers to add or remove them (or Ctrl-click, Shift-click)',
  mergePicked: 'Merge',
  groupPicked: 'Group',
  deletePicked: 'Delete',
  rename: 'Rename',
  selectContents: 'Select contents',
  copy: 'Copy',
  paste: 'Paste as new layer',
  fill: 'Fill with the colour',
  clear: 'Clear',
  invert: 'Invert colours',
  duplicate: 'Duplicate',
  alphaLock: 'Alpha lock',
  clip: 'Clipping mask',
  mask: 'Add layer mask',
  reference: 'Reference (fills look at its lines)',
  lock: 'Lock',
  private: 'Hide from export',
  mergeDown: 'Merge down',
  combineDown: 'Combine down (into a group)',
  group: 'Put in a group',
  ungroup: 'Ungroup',
  flatten: 'Flatten group',
  exportPng: 'Export as PNG',
  remove: 'Delete',
  maskOf: 'Layer mask: dark hides, light shows',
  locked: 'Locked',
  isReference: 'Reference layer',
  isPrivate: 'Hidden from export',
  dragHint: 'Drag to reorder. Drop outside the list to export as PNG.',
  groupName: 'Group',
  deleteTitle: (n: string) => `Delete ${n}?`,
  deleteMsg: 'The layer and its drawing are removed.',
  deleteMany: (n: number) => `Delete ${n} layers?`,
}

/** What the layer list needs from the editor. */
export interface LayerHost {
  doc: SketchDoc
  update(recipe: (d: SketchDoc) => SketchDoc): void
  engine: SketchEngine
  activeId: Id | undefined
  setActive(id: Id): void
  markDirty(id: Id | null): void
  /** A layer made in memory (not loaded from a file). */
  adopt(id: Id): void
  /** Layers removed from the document: stop saving them and delete their files. */
  discard(layers: SketchLayer[]): void
  limit: number
  title: string
  color: string
  /** Select where a canvas has pixels. */
  selectFrom(canvas: HTMLCanvasElement): void
}

/** The layer list (Sketch Pro): groups, masks, multi-pick, drag to reorder or out to export, and every layer action. */
export function LayersPanel({ host, headerExtra }: { host: LayerHost; headerExtra?: ReactNode }) {
  const { doc, update, engine } = host
  const [pickedRaw, setPicked] = useState<Set<Id>>(new Set())
  // Picks of layers that are gone are dropped.
  const picked = new Set([...pickedRaw].filter((id) => doc.layers.some((l) => l.id === id)))
  const [menu, setMenu] = useState<{ id: Id; x: number; y: number } | null>(null)
  const [drop, setDrop] = useState<{ id: Id; where: 'above' | 'below' | 'inside' } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rows = layerRows(doc.layers)
  const active = doc.layers.find((l) => l.id === host.activeId)
  const count = doc.layers.filter((l) => !isGroup(l)).length

  const set = (id: Id, patch: Partial<SketchLayer>) => update((d) => updateLayer(d, id, patch))

  /** A new pixel layer above `aboveId`, optionally filled by `paint`. */
  const addLayer = (paint?: (ctx: CanvasRenderingContext2D) => void, name = nextLayerName(doc)) => {
    if (count >= host.limit) return
    const layer = newLayer(name)
    host.adopt(layer.id)
    engine.setLayerImage(layer.id, null)
    if (paint) host.markDirty(engine.edit(layer.id, paint))
    update((d) => ({ ...d, layers: insertAbove(d.layers, layer, host.activeId) }))
    host.setActive(layer.id)
  }

  const addGroup = () => {
    const ids = picked.size ? [...picked] : host.activeId ? [host.activeId] : []
    if (!ids.length) return
    const r = groupLayers(doc.layers, ids, UI.groupName)
    update((d) => ({ ...d, layers: r.layers }))
    host.setActive(r.group.id)
    setPicked(new Set())
  }

  const remove = async (ids: Id[]) => {
    if (doc.layers.filter((l) => !isGroup(l)).length <= 1) return
    const one = ids.length === 1 ? doc.layers.find((l) => l.id === ids[0]) : null
    const ok = await confirmDialog({ title: one ? UI.deleteTitle(one.name) : UI.deleteMany(ids.length), message: UI.deleteMsg, confirmLabel: 'Delete', danger: true })
    if (!ok) return
    let layers = doc.layers
    for (const id of ids) layers = removeTree(layers, id)
    // Always keep one layer to paint on.
    if (!layers.some((l) => !isGroup(l))) return
    host.discard(doc.layers.filter((l) => !layers.includes(l)))
    update((d) => ({ ...d, layers }))
    host.setActive(layers.filter((l) => !isGroup(l) && l.kind !== 'mask').at(-1)?.id ?? layers[0].id)
    setPicked(new Set())
  }

  const duplicate = (id: Id) => {
    const r = duplicateTree(doc.layers, id)
    if (count + [...r.map.keys()].length > host.limit) return
    for (const [from, to] of r.map) {
      const l = doc.layers.find((x) => x.id === from)
      if (!l || !hasPixels(l)) continue
      host.adopt(to)
      engine.copyLayer(from, to)
      host.markDirty(to)
    }
    update((d) => ({ ...d, layers: r.layers }))
    if (r.top) host.setActive(r.top)
  }

  /** Merge `ids` (bottom to top, groups included) into the lowest pixel layer among them. */
  const mergeInto = (target: SketchLayer, ids: Id[]) => {
    const stack = [{ ...target, opacity: 1, blend: 'source-over' as BlendMode, clip: false, visible: true, parent: null }, ...ids.flatMap((id) => subtreeStack(doc.layers, id))]
    host.markDirty(engine.mergeInto(stack, target.id))
    let layers = doc.layers
    for (const id of ids) layers = removeTree(layers, id)
    host.discard(doc.layers.filter((l) => !layers.includes(l)))
    update((d) => ({ ...d, layers }))
    host.setActive(target.id)
    setPicked(new Set())
  }

  const mergeDown = (l: SketchLayer) => {
    const below = siblingBelow(doc.layers, l.id)
    if (below && hasPixels(below)) mergeInto(below, [l.id])
  }

  const mergePicked = () => {
    // Outermost picks only, in stack order; the lowest pixel layer receives the rest.
    const inside = (id: Id) => [...picked].some((p) => p !== id && subtreeIds(doc.layers, p).has(id))
    const order = doc.layers.filter((l) => picked.has(l.id) && !inside(l.id))
    const target = order.find((l) => hasPixels(l) && l.kind !== 'mask')
    if (!target) return
    mergeInto(target, order.filter((l) => l !== target).map((l) => l.id))
  }

  const flatten = (g: SketchLayer) => {
    const layer = { ...newLayer(g.name), parent: g.parent ?? null }
    host.adopt(layer.id)
    engine.setLayerImage(layer.id, null)
    host.markDirty(engine.mergeInto(subtreeStack(doc.layers, g.id).map((l) => (l.id === g.id ? { ...l, opacity: 1, blend: 'source-over' as BlendMode } : l)), layer.id))
    const layers = removeTree(insertAbove(doc.layers, layer, g.id), g.id)
    host.discard(doc.layers.filter((l) => !layers.includes(l)))
    update((d) => ({ ...d, layers }))
    host.setActive(layer.id)
  }

  const exportLayer = async (l: SketchLayer) => {
    const picture = engine.render({ layers: subtreeStack(doc.layers, l.id).map((x) => (x.id === l.id ? { ...x, opacity: 1 } : x)), backgroundColor: null }, false)
    await saveBinaryFile({
      title: UI.exportPng,
      defaultName: `${safeFileName(`${host.title} ${l.name}`)}.png`,
      bytes: new Uint8Array(await (await toPng(picture)).arrayBuffer()),
      filter: { name: 'PNG image', extensions: ['png'] },
    })
  }

  const addLayerMask = (l: SketchLayer) => {
    const r = addMask(doc.layers, l.id)
    if (!r.mask) return
    host.adopt(r.mask.id)
    engine.setLayerImage(r.mask.id, null)
    // A new mask shows everything: white.
    host.markDirty(
      engine.edit(r.mask.id, (ctx) => {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, doc.width, doc.height)
      }),
    )
    update((d) => ({ ...d, layers: r.layers }))
    host.setActive(r.mask.id)
  }

  const paste = () => {
    const src = copiedPixels()
    if (src) addLayer((ctx) => ctx.drawImage(src, 0, 0))
  }

  // v0.13: picking several layers without a keyboard (pens, touch).
  const [pickMany, setPickMany] = useState(false)
  const pick = (e: React.MouseEvent, id: Id) => {
    if (e.ctrlKey || e.metaKey || pickMany) {
      const next = new Set(picked)
      if (!next.size && host.activeId) next.add(host.activeId)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setPicked(next)
      return
    }
    if (e.shiftKey && host.activeId) {
      const ids = rows.map((r) => r.layer.id)
      const [a, b] = [ids.indexOf(host.activeId), ids.indexOf(id)].sort((x, y) => x - y)
      if (a >= 0) return setPicked(new Set(ids.slice(a, b + 1)))
    }
    setPicked(new Set())
    host.setActive(id)
  }

  type Item = { label: string; run: () => void; on?: boolean; off?: boolean; danger?: boolean }
  const menuItems = (l: SketchLayer): Item[] => {
    const group = isGroup(l)
    const mask = l.kind === 'mask'
    const below = siblingBelow(doc.layers, l.id)
    const items: (Item | false)[] = [
      { label: UI.rename, run: () => void promptDialog(UI.rename, l.name).then((n) => n?.trim() && set(l.id, { name: n.trim() })) },
      !group && { label: UI.selectContents, run: () => host.selectFrom(engine.layerCanvas(l.id)) },
      !group && { label: UI.copy, run: () => copyPixels(engine.layerCanvas(l.id)) },
      { label: UI.paste, run: paste, off: !copiedPixels() },
      !group && { label: UI.fill, run: () => host.markDirty(engine.fill(l.id, host.color, l.alphaLock)) },
      !group && { label: UI.clear, run: () => host.markDirty(engine.clear(l.id)) },
      !group && { label: UI.invert, run: () => host.markDirty(engine.invert(l.id)) },
      !mask && { label: UI.duplicate, run: () => duplicate(l.id) },
      !group && !mask && { label: UI.alphaLock, run: () => set(l.id, { alphaLock: !l.alphaLock }), on: l.alphaLock },
      !mask && { label: UI.clip, run: () => set(l.id, { clip: !l.clip }), on: l.clip },
      !mask && { label: UI.mask, run: () => addLayerMask(l), off: !!maskOf(doc.layers, l.id) },
      !group && !mask && {
        label: UI.reference,
        run: () => update((d) => ({ ...d, layers: d.layers.map((x) => ({ ...x, reference: x.id === l.id ? !l.reference : false })) })),
        on: !!l.reference,
      },
      { label: UI.lock, run: () => set(l.id, { locked: !l.locked }), on: !!l.locked },
      !mask && { label: UI.private, run: () => set(l.id, { private: !l.private }), on: !!l.private },
      !mask && { label: UI.mergeDown, run: () => mergeDown(l), off: !below || !hasPixels(below) },
      !mask && { label: UI.combineDown, run: () => update((d) => ({ ...d, layers: combineDown(d.layers, l.id, UI.groupName).layers })), off: !below },
      !mask && { label: UI.group, run: addGroup },
      group && { label: UI.ungroup, run: () => update((d) => ({ ...d, layers: ungroup(d.layers, l.id) })) },
      group && { label: UI.flatten, run: () => flatten(l) },
      { label: UI.exportPng, run: () => void exportLayer(l) },
      { label: UI.remove, run: () => void remove([l.id]), danger: true },
    ]
    return items.filter((x): x is Item => !!x)
  }

  const onDragOver = (e: React.DragEvent, l: SketchLayer) => {
    if (!e.dataTransfer.types.includes('application/x-sketch-layer')) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const t = (e.clientY - r.top) / r.height
    const where = isGroup(l) && t > 0.3 && t < 0.7 ? 'inside' : t < 0.5 ? 'above' : 'below'
    if (drop?.id !== l.id || drop.where !== where) setDrop({ id: l.id, where })
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('application/x-sketch-layer')
    if (id && drop) update((d) => ({ ...d, layers: moveTo(d.layers, id, drop.id, drop.where) }))
    setDrop(null)
  }

  const onDragEnd = (e: React.DragEvent, l: SketchLayer) => {
    setDrop(null)
    // Dropped outside the list (nowhere that takes it): export the layer.
    const box = listRef.current?.getBoundingClientRect()
    const outside = !box || e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom
    if (e.dataTransfer.dropEffect === 'none' && outside) void exportLayer(l)
  }

  const shownMenu = menu && doc.layers.find((l) => l.id === menu.id)

  return (
    <section className="sketch-layers">
      <div className="sketch-layers-head">
        <h4>{UI.layers}</h4>
        <span className="sketch-spacer" />
        {headerExtra}
        <button
          className={`icon-btn sketch-tool${pickMany ? ' is-active' : ''}`}
          title={UI.pickMany}
          aria-label={UI.pickMany}
          aria-pressed={pickMany}
          onClick={() => {
            if (pickMany) setPicked(new Set())
            setPickMany(!pickMany)
          }}
        >
          <ListChecks size={16} />
        </button>
        <button className="icon-btn sketch-tool" title={UI.addGroup} aria-label={UI.addGroup} onClick={addGroup}>
          <FolderPlus size={16} />
        </button>
        <button
          className="icon-btn sketch-tool"
          title={count >= host.limit ? UI.layerLimit(host.limit) : `${UI.addLayer} (${count} / ${host.limit})`}
          aria-label={UI.addLayer}
          onClick={() => addLayer()}
        >
          <Plus size={16} />
        </button>
      </div>
      {picked.size > 1 && (
        <div className="sketch-picked">
          <span>{UI.picked(picked.size)}</span>
          <button className="btn btn-ghost sketch-small" onClick={mergePicked}>
            <Merge size={12} /> {UI.mergePicked}
          </button>
          <button className="btn btn-ghost sketch-small" onClick={addGroup}>
            <Folder size={12} /> {UI.groupPicked}
          </button>
          <button className="btn btn-ghost sketch-small" onClick={() => void remove([...picked])}>
            <Trash2 size={12} /> {UI.deletePicked}
          </button>
        </div>
      )}
      <div ref={listRef} className="sketch-layer-list" title={UI.dragHint} onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}>
        {rows.map(({ layer: l, depth, mask }) => {
          const isActive = l.id === host.activeId || mask?.id === host.activeId
          const dropClass = drop?.id === l.id ? ` drop-${drop.where}` : ''
          return (
            <div
              key={l.id}
              className={`sketch-layer${isActive ? ' is-active' : ''}${picked.has(l.id) ? ' is-picked' : ''}${l.clip ? ' is-clip' : ''}${dropClass}`}
              style={{ paddingLeft: 4 + depth * 14 }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-sketch-layer', l.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => onDragOver(e, l)}
              onDrop={onDrop}
              onDragEnd={(e) => onDragEnd(e, l)}
              onClick={(e) => pick(e, l.id)}
              onDoubleClick={() => void promptDialog(UI.rename, l.name).then((n) => n?.trim() && set(l.id, { name: n.trim() }))}
            >
              <div className="sketch-layer-row">
                {isGroup(l) ? (
                  <button
                    className="icon-btn sketch-fold"
                    title={l.collapsed ? UI.open : UI.close}
                    onClick={(e) => {
                      e.stopPropagation()
                      set(l.id, { collapsed: !l.collapsed })
                    }}
                  >
                    {l.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </button>
                ) : null}
                <button
                  className="icon-btn"
                  title={l.visible ? UI.hide : UI.show}
                  onClick={(e) => {
                    e.stopPropagation()
                    set(l.id, { visible: !l.visible })
                  }}
                >
                  {l.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                {isGroup(l) ? <Folder size={18} className="sketch-group-icon" /> : <Thumb engine={engine} id={l.id} version={engine.version} />}
                {mask && (
                  <span
                    className={`sketch-mask-thumb${mask.id === host.activeId ? ' is-active' : ''}${mask.visible ? '' : ' is-off'}`}
                    title={UI.maskOf}
                    onClick={(e) => {
                      e.stopPropagation()
                      host.setActive(mask.id)
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      set(mask.id, { visible: !mask.visible })
                    }}
                  >
                    <Thumb engine={engine} id={mask.id} version={engine.version} />
                  </span>
                )}
                <span className="sketch-layer-name">{l.name}</span>
                {l.locked && <Lock size={11} aria-label={UI.locked} />}
                {l.reference && <span className="sketch-badge" title={UI.isReference}>R</span>}
                {l.private && <EyeOff size={11} aria-label={UI.isPrivate} className="sketch-private" />}
                <button
                  className="icon-btn"
                  title={UI.more}
                  onClick={(e) => {
                    e.stopPropagation()
                    const r = e.currentTarget.getBoundingClientRect()
                    setMenu({ id: mask?.id === host.activeId ? mask!.id : l.id, x: Math.max(8, r.right - 210), y: r.bottom + 2 })
                  }}
                >
                  <Ellipsis size={14} />
                </button>
              </div>
              {isActive && active && active.kind !== 'mask' && (
                <div className="sketch-layer-props" onClick={(e) => e.stopPropagation()}>
                  <label className="sketch-slider">
                    <span>{UI.opacity}</span>
                    <input type="range" min={0} max={1} step={0.01} value={l.opacity} onChange={(e) => set(l.id, { opacity: Number(e.target.value) })} />
                    <span className="sketch-slider-value">{Math.round(l.opacity * 100)}%</span>
                  </label>
                  <select className="input" value={l.blend} onChange={(e) => set(l.id, { blend: e.target.value as BlendMode })}>
                    {[...new Set(BLEND_MODES.map((m) => m.group))].map((g) => (
                      <optgroup key={g} label={g}>
                        {BLEND_MODES.filter((m) => m.group === g).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <div className="sketch-layer-actions">
                    <button className={`btn btn-ghost sketch-small${l.alphaLock ? ' is-active' : ''}`} disabled={isGroup(l)} title={UI.alphaLock} onClick={() => set(l.id, { alphaLock: !l.alphaLock })}>
                      Alpha
                    </button>
                    <button className={`btn btn-ghost sketch-small${l.clip ? ' is-active' : ''}`} title={UI.clip} onClick={() => set(l.id, { clip: !l.clip })}>
                      Clip
                    </button>
                    <button className={`btn btn-ghost sketch-small${l.locked ? ' is-active' : ''}`} title={UI.lock} onClick={() => set(l.id, { locked: !l.locked })}>
                      Lock
                    </button>
                    <button className="btn btn-ghost sketch-small" title="Move up" onClick={() => update((d) => ({ ...d, layers: moveSibling(d.layers, l.id, 1) }))}>
                      ↑
                    </button>
                    <button className="btn btn-ghost sketch-small" title="Move down" onClick={() => update((d) => ({ ...d, layers: moveSibling(d.layers, l.id, -1) }))}>
                      ↓
                    </button>
                    <button className="btn btn-ghost sketch-small" title={UI.mergeDown} onClick={() => mergeDown(l)}>
                      <Merge size={12} />
                    </button>
                    <button className="btn btn-ghost sketch-small" title={UI.remove} onClick={() => void remove([l.id])}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {shownMenu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)} />
          <div className="menu sketch-layer-menu" style={{ position: 'fixed', left: menu.x, top: Math.min(menu.y, window.innerHeight - 560) }}>
            {menuItems(shownMenu).map((it) => (
              <button
                key={it.label}
                className={`${it.danger ? 'danger' : ''}${it.on ? ' is-on' : ''}`}
                disabled={it.off}
                onClick={() => {
                  setMenu(null)
                  it.run()
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function Thumb({ engine, id, version }: { engine: SketchEngine; id: Id; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    const src = engine.layerCanvas(id)
    const s = Math.min(c.width / src.width, c.height / src.height)
    ctx.drawImage(src, (c.width - src.width * s) / 2, (c.height - src.height * s) / 2, src.width * s, src.height * s)
  }, [engine, id, version])
  return <canvas ref={ref} width={44} height={32} className="sketch-thumb" />
}

