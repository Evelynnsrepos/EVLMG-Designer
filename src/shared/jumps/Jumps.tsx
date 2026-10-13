import { CornerDownRight, Plus, Waypoints, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { ENTITY_TYPES, newId, type ComponentType, type Entity, type Id, type LinkTarget } from '@/core/model'
import { getManifest } from '@/core/registry'
import { useProjectStore } from '@/core/state'
import { targetKey, useTargetName } from '@/shared/entityList/JumpBar'
import { TYPE_PLURAL } from '@/shared/entityList/links'
import { jumpTo } from '@/shared/entityList/navigation'
import { Modal } from '@/shared/ui'
import './jumps.css'

/**
 * Jump points (v0.17): a link from any tool (or a spot on a board) to any other tool, document or entry.
 * They live in the project file, so the place they point to can list them too ("Pointing here").
 */
export interface JumpPoint {
  id: Id
  from: LinkTarget
  to: LinkTarget
  /** Placed on a board (its id is the board node's id). */
  node?: boolean
}

/** Where a tool panel is, as a link target. */
export const placeOf = (type: ComponentType, documentId: Id | null | undefined): LinkTarget => ({ kind: 'document', type, documentId: documentId ?? null })
const same = (a: LinkTarget, b: LinkTarget) => targetKey(a) === targetKey(b)

export function addJump(from: LinkTarget, to: LinkTarget, id: Id = newId()) {
  const s = useProjectStore.getState()
  if (!s.meta) return
  s.updateMeta({ jumps: [...(s.meta.jumps ?? []).filter((j) => j.id !== id), { id, from, to }] })
}
export function removeJump(id: Id) {
  const s = useProjectStore.getState()
  if (s.meta) s.updateMeta({ jumps: (s.meta.jumps ?? []).filter((j) => j.id !== id) })
}

/** A target's name, outside React (for labels stored on boards). */
export function targetLabel(t: LinkTarget): string {
  const s = useProjectStore.getState()
  if (t.kind === 'entity') return ((s.entities[t.type] as Entity[]).find((e) => e.id === t.id)?.name || 'Untitled')
  const tool = getManifest(t.type)?.name ?? t.type
  const title = s.meta?.documents.find((d) => d.id === t.documentId)?.title
  return title ? `${tool}: ${title}` : tool
}

/** Keep the project's list of a board's jump points in step with the board (added, moved to a new target, deleted). */
export function syncBoardJumps(type: ComponentType, documentId: Id | null, nodes: { id: Id; target: LinkTarget }[]) {
  const s = useProjectStore.getState()
  if (!s.meta) return
  const here = placeOf(type, documentId)
  const all = s.meta.jumps ?? []
  const others = all.filter((j) => !(j.node && same(j.from, here)))
  const next = [...others, ...nodes.map((n) => ({ id: n.id, from: here, to: n.target, node: true }))]
  const key = (l: JumpPoint[]) => l.map((j) => `${j.id}${targetKey(j.from)}${targetKey(j.to)}`).sort().join()
  if (key(next) !== key(all)) s.updateMeta({ jumps: next })
}

// ---- Picking a target ------------------------------------------------------------

const usePick = create<{ open: { title: string; resolve(t: LinkTarget | null): void } | null }>()(() => ({ open: null }))

/** Ask where a jump point should go: a searchable window with every entry, document and tool. */
export function pickJumpTarget(title = 'Where should this jump point go?'): Promise<LinkTarget | null> {
  return new Promise((resolve) => usePick.setState({ open: { title, resolve } }))
}

/** Everything a jump point can go to, grouped. */
function useChoices() {
  const entities = useProjectStore((s) => s.entities)
  const meta = useProjectStore((s) => s.meta)
  return useMemo(() => {
    const tools = (meta?.enabledComponents ?? []).map((t) => ({ label: getManifest(t)?.name ?? t, target: placeOf(t, null) }))
    const docs = (meta?.documents ?? []).map((d) => ({ label: `${getManifest(d.type)?.name ?? d.type}: ${d.title}`, target: placeOf(d.type, d.id) }))
    const ents = ENTITY_TYPES.map((type) => ({
      group: TYPE_PLURAL[type],
      items: [...(entities[type] as Entity[])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((e) => ({ label: e.name || 'Untitled', target: { kind: 'entity', type, id: e.id } as LinkTarget })),
    }))
    return [{ group: 'Tools', items: tools }, { group: 'Documents', items: docs }, ...ents].filter((g) => g.items.length)
  }, [entities, meta])
}

/** Mount once: the window that pickJumpTarget opens. */
export function JumpPickerHost() {
  const open = usePick((s) => s.open)
  const [q, setQ] = useState('')
  const groups = useChoices()
  if (!open) return null
  const done = (t: LinkTarget | null) => {
    usePick.setState({ open: null })
    setQ('')
    open.resolve(t)
  }
  const query = q.trim().toLowerCase()
  const shown = groups.map((g) => ({ ...g, items: g.items.filter((i) => !query || i.label.toLowerCase().includes(query)) })).filter((g) => g.items.length)
  return (
    <Modal onClose={() => done(null)}>
      <div className="jump-pick">
        <h3>
          <Waypoints size={17} /> {open.title}
        </h3>
        <input className="input" autoFocus placeholder="Search tools, documents, characters, items…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && shown[0]?.items[0] && done(shown[0].items[0].target)} />
        <div className="jump-pick-list">
          {shown.map((g) => (
            <section key={g.group}>
              <h4>{g.group}</h4>
              {g.items.map((i) => (
                <button key={targetKey(i.target)} onClick={() => done(i.target)}>
                  {i.label}
                </button>
              ))}
            </section>
          ))}
          {!shown.length && <p className="muted">Nothing matches.</p>}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => done(null)}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ---- On every tool -----------------------------------------------------------------

/** The jump points button in every tool's header: where this tool jumps to, what points here, and adding one. */
export function PanelJumps({ type, documentId }: { type: ComponentType; documentId: Id | null }) {
  const jumps = useProjectStore((s) => s.meta?.jumps)
  const name = useTargetName()
  const [open, setOpen] = useState<DOMRect | null>(null)
  // Esc closes the list (and does not toggle Layout Mode).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])
  const here = placeOf(type, documentId)
  // A board's own jump points belong to its document; a tool without documents is just the tool.
  const out = (jumps ?? []).filter((j) => same(j.from, here))
  const into = (jumps ?? []).filter((j) => same(j.to, here) || (here.kind === 'document' && j.to.kind === 'document' && j.to.type === type && j.to.documentId === null))
  const count = out.length + into.length
  const add = async () => {
    setOpen(null)
    const to = await pickJumpTarget()
    if (to) addJump(here, to)
  }
  const go = (t: LinkTarget) => {
    setOpen(null)
    jumpTo(t)
  }
  return (
    <>
      <button className={`panel-jumps${count ? ' has' : ''}`} title="Jump points: jump to any tool, document or entry, and see what points here" onClick={(e) => setOpen(open ? null : e.currentTarget.getBoundingClientRect())}>
        <Waypoints size={13} />
        {count > 0 && <span>{count}</span>}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(null)} />
          <div className="menu jump-menu" style={{ position: 'fixed', top: open.bottom + 4, left: Math.max(8, Math.min(open.right - 280, window.innerWidth - 290)) }}>
            <div className="jump-menu-head">Jump to</div>
            {out.length === 0 && <div className="muted jump-menu-empty">No jump points here yet.</div>}
            {out.map((j) => (
              <div key={j.id} className="jump-menu-row">
                <button onClick={() => go(j.to)}>
                  <CornerDownRight size={13} /> {name(j.to)}
                </button>
                <button className="icon-btn" title="Remove this jump point" onClick={() => removeJump(j.id)}>
                  <X size={12} />
                </button>
              </div>
            ))}
            <button className="jump-menu-add" onClick={() => void add()}>
              <Plus size={13} /> Add a jump point…
            </button>
            {into.length > 0 && (
              <>
                <div className="jump-menu-head">Pointing here</div>
                {into.map((j) => (
                  <div key={j.id} className="jump-menu-row">
                    <button onClick={() => go(j.from)}>
                      <CornerDownRight size={13} style={{ transform: 'scaleX(-1)' }} /> {name(j.from)}
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}
