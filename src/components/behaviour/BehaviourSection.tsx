import { ExternalLink, Workflow, X } from 'lucide-react'
import type { Id } from '@/core/model'
import { updateDocument, useDocumentsOfType, useProjectStore } from '@/core/state'
import { jumpTo, Section } from '@/shared/entityList'
import { useLang } from '@/shared/i18n'
import { createBehaviourDoc, type BehaviourDoc } from './model'
import { UI } from './ui'

/** On an Enemy or Character page: the behaviours it uses, to open, add or remove (the change is undone inside that behaviour). */
export function BehaviourSection({ type, id }: { type: 'enemy' | 'character'; id: Id }) {
  useLang()
  const root = useProjectStore((s) => s.root)
  const enabled = useProjectStore((s) => s.meta?.enabledComponents.includes('behaviour') ?? false)
  const docs = useDocumentsOfType<BehaviourDoc>('behaviour', createBehaviourDoc)
  if (!enabled && docs.length === 0) return null
  const uses = (d: BehaviourDoc) => d.users.some((u) => u.type === type && u.id === id)
  const mine = docs.filter((d) => uses(d.data))
  const others = docs.filter((d) => !uses(d.data))
  const change = (docId: Id, on: boolean) =>
    root &&
    updateDocument<BehaviourDoc>(root, 'behaviour', docId, (d) => ({ ...d, users: on ? [...d.users, { type, id }] : d.users.filter((u) => !(u.type === type && u.id === id)) }))
  return (
    <Section label={UI.behaviours} icon={<Workflow size={13} aria-hidden />}>
      <div className="elist-rows">
        {mine.length === 0 && <div className="elist-muted">{UI.noBehaviour}</div>}
        {mine.map((d) => (
          <div key={d.id} className="ld-inline">
            <button className="elist-link" onClick={() => jumpTo({ kind: 'document', type: 'behaviour', documentId: d.id })}>
              <ExternalLink size={12} aria-hidden /> {d.title || UI.untitled}
            </button>
            <button className="icon-btn" aria-label={UI.remove} title={UI.remove} onClick={() => change(d.id, false)}>
              <X size={13} />
            </button>
          </div>
        ))}
        {others.length > 0 && (
          <select className="input" value="" aria-label={UI.useBehaviour} onChange={(e) => e.target.value && change(e.target.value, true)}>
            <option value="">{UI.useBehaviour}</option>
            {others.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title || UI.untitled}
              </option>
            ))}
          </select>
        )}
      </div>
    </Section>
  )
}
