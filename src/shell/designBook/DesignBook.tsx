import { BookOpen, ChevronDown, ChevronRight, Globe, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { resolveAssetPath, mimeOf } from '@/core/assets'
import { saveTextFile, safeFileName } from '@/core/export'
import { getFs } from '@/core/fs'
import { ENTITY_TYPES, type Entity, type EntityType, type Id } from '@/core/model'
import { loadDocumentNow, useDocument, useProjectStore } from '@/core/state'
import { ENTITY_LABELS, entityLook, ratingText } from '@/shared/categories'
import { entityInfoRows } from '@/shared/entityList'
import { combineRefProviders, emptyRichText, escapeHtml, richTextToHtml, useEntityRefProvider, type RichTextDoc } from '@/shared/richtext'
import { Modal } from '@/shared/ui'
import { articleTitle, findSourceEntity, useArticleRefProvider, useWikiIndex, type WikiArticleDoc } from '@/shared/wiki'
import { buildBookHtml, type BookChapter, type BookEntry } from './book'
import type { CardDoc } from '@/components/card-designer/model'
import { useDesignBook } from './open'
import './designBook.css'


export function DesignBookHost() {
  const open = useDesignBook((s) => s.open)
  return open ? <DesignBookDialog onClose={() => useDesignBook.setState({ open: false })} /> : null
}

// Asset Pool and Card Designer data, only the parts the book shows.
interface AssetLite {
  id: Id
  name: string
  kind: string
  status: string
  notes: string
  images: string[]
  owner?: string
  due?: string
  priority?: string
}
const NO_ASSETS: AssetLite[] = []
// Quest Designer data, read here without importing the tool (it owns the full model).
interface QuestLite {
  id: Id
  name: string
  kind: string
  giverId: Id | null
  locationId: Id | null
  level: number | null
  summary: string
  objectives: { kind: string; targetId: Id | null; amount: number; text: string; optional: boolean }[]
  rewardItems: { itemId: Id; amount: number }[]
  rewardXp: number
  rewardGold: number
  requires: Id[]
}
const NO_QUESTS: QuestLite[] = []
const OBJECTIVE_VERB: Record<string, string> = { talk: 'Talk to', kill: 'Defeat', collect: 'Collect', reach: 'Go to' }

interface Section {
  id: string
  title: string
  entries: { id: Id; label: string }[]
}

function DesignBookDialog({ onClose }: { onClose(): void }) {
  const { root, meta, entities, categories } = useProjectStore()
  const wiki = useWikiIndex()
  const quests = useDocument<{ quests: QuestLite[] }>('quests', 'quests', () => ({ quests: [] })).data?.quests ?? NO_QUESTS
  const pool = useDocument<{ entries: AssetLite[] }>('asset-pool', 'pool', () => ({ entries: [] })).data?.entries ?? NO_ASSETS
  const entityRefs = useEntityRefProvider()
  const articleRefs = useArticleRefProvider()
  const refs = useMemo(() => combineRefProviders(entityRefs, articleRefs), [entityRefs, articleRefs])
  const all = entities as Record<EntityType, Entity[]>

  const docsOf = (type: string) => (meta?.documents ?? []).filter((d) => d.type === type).map((d) => ({ id: d.id, label: d.title }))
  const sections = useMemo<Section[]>(
    () =>
      [
        ...ENTITY_TYPES.map((t) => ({ id: t, title: ENTITY_LABELS[t].many, entries: all[t].map((e) => ({ id: e.id, label: e.name || 'Untitled' })) })),
        { id: 'wiki', title: 'Wiki', entries: (wiki?.articles ?? []).map((a) => ({ id: a.id, label: articleTitle(a, all) })) },
        { id: 'writer', title: 'Writing', entries: (meta?.documents ?? []).filter((d) => d.type === 'writer').map((d) => ({ id: d.id, label: d.title })) },
        { id: 'quests', title: 'Quests', entries: quests.map((q) => ({ id: q.id, label: q.name || 'Untitled quest' })) },
        { id: 'assets', title: 'Assets', entries: meta?.enabledComponents.includes('asset-pool') ? pool.map((a) => ({ id: a.id, label: a.name || 'Untitled' })) : [] },
        { id: 'card-designer', title: 'Cards', entries: docsOf('card-designer') },
        { id: 'vector', title: 'Icons', entries: docsOf('vector') },
      ].filter((s) => s.entries.length > 0),
    [all, wiki, meta, quests, pool],
  )

  const [title, setTitle] = useState(meta?.name ?? 'Design Book')
  const [subtitle, setSubtitle] = useState(meta?.description ?? '')
  const [off, setOff] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(off)
    for (const k of keys) {
      if (on) next.delete(k)
      else next.add(k)
    }
    setOff(next)
  }
  const picked = (s: Section) => s.entries.filter((en) => !off.has(`${s.id}:${en.id}`))
  const total = sections.reduce((n, s) => n + picked(s).length, 0)

  const build = async (): Promise<string> => {
    if (!root) throw new Error('No project open.')
    const fs = getFs()
    const urls = new Map<string, string | null>()
    const dataUrl = async (path: string | null | undefined) => {
      if (!path) return null
      if (!urls.has(path)) {
        const abs = await resolveAssetPath(root, path)
        urls.set(path, (await fs.exists(abs)) ? toDataUrl(await fs.readBinary(abs), mimeOf(path)) : null)
      }
      return urls.get(path) ?? null
    }
    const resolve = (t: { kind: string; id: string }) => refs.resolve(t)?.label
    const richHtml = async (body: RichTextDoc) => {
      for (const src of imageSources(body)) await dataUrl(src)
      return richTextToHtml(body, resolve, (src) => urls.get(src) ?? src)
    }
    const entityEntry = async (e: Entity): Promise<BookEntry> => {
      const look = entityLook(categories, e.type, e)
      const { rows, stats } = entityInfoRows(e, all, categories)
      return {
        title: e.name || 'Untitled',
        kind: look ? [look.value, ratingText(look.category, look.style)].filter(Boolean).join(' ') : undefined,
        color: look?.style.color,
        image: await dataUrl(e.image),
        info: rows,
        stats,
        html: paragraphs(e.description),
      }
    }
    const nameOf = (type: EntityType, id: Id | null) => (id ? all[type].find((x) => x.id === id)?.name || 'missing' : '')

    const chapters: BookChapter[] = []
    for (const s of sections) {
      const ids = new Set(picked(s).map((en) => en.id))
      if (!ids.size) continue
      const entries: BookEntry[] = []
      if ((ENTITY_TYPES as readonly string[]).includes(s.id)) {
        for (const e of all[s.id as EntityType]) if (ids.has(e.id)) entries.push(await entityEntry(e))
      } else if (s.id === 'wiki') {
        for (const a of wiki?.articles ?? []) {
          if (!ids.has(a.id)) continue
          const doc = await loadDocumentNow<WikiArticleDoc>(root, 'wiki', a.id, () => ({ body: emptyRichText() }))
          const source = findSourceEntity(a, all)
          const box = source ? await entityEntry(source) : null
          entries.push({ ...box, title: articleTitle(a, all), kind: source ? ENTITY_LABELS[source.type].one : undefined, html: await richHtml(doc.body as RichTextDoc) })
        }
      } else if (s.id === 'writer') {
        for (const d of meta?.documents ?? []) {
          if (d.type !== 'writer' || !ids.has(d.id)) continue
          const doc = await loadDocumentNow<{ body: RichTextDoc }>(root, 'writer', d.id, () => ({ body: emptyRichText() }))
          entries.push({ title: d.title, html: await richHtml(doc.body) })
        }
      } else if (s.id === 'assets') {
        for (const a of pool) {
          if (!ids.has(a.id)) continue
          const info = [
            { label: 'Status', value: a.status.replace('-', ' ') },
            { label: 'Who', value: a.owner ?? '' },
            { label: 'Due', value: a.due ?? '' },
            { label: 'Priority', value: a.priority ?? '' },
          ].filter((r) => r.value)
          entries.push({ title: a.name || 'Untitled', kind: a.kind, image: await dataUrl(a.images[0]), info, html: paragraphs(a.notes) })
        }
      } else if (s.id === 'card-designer') {
        // The tools are loaded only when a book really has cards or icons in it.
        const { cardPainter } = await import('@/components/card-designer/exporting')
        for (const m of meta?.documents ?? []) {
          if (m.type !== 'card-designer' || !ids.has(m.id)) continue
          const deck = await loadDocumentNow<CardDoc | null>(root, 'card-designer', m.id, () => null)
          const first = deck?.cards?.[0]
          if (!deck || !first) continue
          const { paint } = await cardPainter(deck, [first], root)
          entries.push({ title: m.title, kind: `${deck.cards.length} cards`, image: paint(first, 'front', 150).toDataURL('image/png') })
        }
      } else if (s.id === 'vector') {
        const { toSvg } = await import('@/components/vector/model')
        for (const m of meta?.documents ?? []) {
          if (m.type !== 'vector' || !ids.has(m.id)) continue
          const icon = await loadDocumentNow<Parameters<typeof toSvg>[0] | null>(root, 'vector', m.id, () => null)
          if (icon?.artboard) entries.push({ title: m.title, kind: 'Icon', image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toSvg(icon))}` })
        }
      } else if (s.id === 'quests') {
        for (const q of quests) {
          if (!ids.has(q.id)) continue
          const info = [
            { label: 'Quest giver', value: nameOf('character', q.giverId) },
            { label: 'Where', value: nameOf('town', q.locationId) },
            { label: 'Level', value: q.level === null ? '' : String(q.level) },
            { label: 'Requires', value: q.requires.map((id) => quests.find((x) => x.id === id)?.name ?? '').filter(Boolean).join(', ') },
          ].filter((r) => r.value)
          const target = (o: QuestLite['objectives'][number]) =>
            o.kind === 'talk' ? nameOf('character', o.targetId) : o.kind === 'kill' ? nameOf('enemy', o.targetId) : o.kind === 'collect' ? nameOf('item', o.targetId) : o.kind === 'reach' ? nameOf('town', o.targetId) : ''
          const objectives = q.objectives.map((o) => {
            const text = o.text.trim() || [OBJECTIVE_VERB[o.kind], o.amount > 1 ? `${o.amount}×` : '', target(o)].filter(Boolean).join(' ')
            return `<li>${escapeHtml(text)}${o.optional ? ' <em>(optional)</em>' : ''}</li>`
          })
          const rewards = [
            ...q.rewardItems.map((r) => `${r.amount}× ${nameOf('item', r.itemId)}`),
            q.rewardXp ? `${q.rewardXp} XP` : '',
            q.rewardGold ? `${q.rewardGold} gold` : '',
          ].filter(Boolean)
          entries.push({
            title: q.name || 'Untitled quest',
            kind: `${q.kind.charAt(0).toUpperCase()}${q.kind.slice(1)} quest`,
            info,
            html:
              paragraphs(q.summary) +
              (objectives.length ? `<h4>Objectives</h4><ol>${objectives.join('')}</ol>` : '') +
              (rewards.length ? `<p><strong>Rewards:</strong> ${escapeHtml(rewards.join(', '))}</p>` : ''),
          })
        }
      }
      chapters.push({ title: s.title, entries })
    }
    return buildBookHtml({ title: title.trim() || 'Design Book', subtitle: subtitle.trim(), date: new Date().toLocaleDateString(), chapters })
  }

  const run = async (how: 'html' | 'print') => {
    setBusy(true)
    setError('')
    try {
      const html = await build()
      if (how === 'html') {
        const saved = await saveTextFile({ title: 'Save Design Book', defaultName: `${safeFileName(title, 'Design Book')}.html`, text: html, filter: { name: 'Web page', extensions: ['html'] } })
        if (saved) onClose()
      } else printHtml(html)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="dbook">
        <h3>
          <BookOpen size={18} /> Design Book
        </h3>
        <p className="dbook-lead">One game design document from your project: cover, contents, images and info boxes. Save it as a web page or print it to PDF.</p>
        <label className="dbook-field">
          Title
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="dbook-field">
          Subtitle
          <input className="input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="e.g. Pitch draft, version 2" />
        </label>
        <div className="dbook-sections">
          {sections.length === 0 && <p className="dbook-lead">Nothing to put in the book yet.</p>}
          {sections.map((s) => {
            const n = picked(s).length
            const keys = s.entries.map((en) => `${s.id}:${en.id}`)
            return (
              <div key={s.id} className="dbook-section">
                <div className="dbook-row">
                  <button className="icon-btn" aria-label={expanded === s.id ? 'Collapse' : 'Expand'} onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                    {expanded === s.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={n === s.entries.length}
                      ref={(el) => {
                        if (el) el.indeterminate = n > 0 && n < s.entries.length
                      }}
                      onChange={(e) => toggle(keys, e.target.checked)}
                    />
                    {s.title}
                  </label>
                  <span className="dbook-count">
                    {n} of {s.entries.length}
                  </span>
                </div>
                {expanded === s.id && (
                  <div className="dbook-entries">
                    {s.entries.map((en) => {
                      const key = `${s.id}:${en.id}`
                      return (
                        <label key={en.id}>
                          <input type="checkbox" checked={!off.has(key)} onChange={(e) => toggle([key], e.target.checked)} />
                          {en.label}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {error && <p className="dbook-error">{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy || total === 0} onClick={() => void run('print')}>
            <Printer size={14} /> Print or save as PDF
          </button>
          <button className="btn btn-primary" disabled={busy || total === 0} onClick={() => void run('html')}>
            <Globe size={14} /> Save as web page
          </button>
        </div>
      </div>
    </Modal>
  )
}

const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')

function imageSources(doc: RichTextDoc): string[] {
  const out: string[] = []
  const walk = (n: RichTextDoc) => {
    if (n.type === 'image' && n.attrs?.src) out.push(n.attrs.src)
    n.content?.forEach(walk)
  }
  walk(doc)
  return out
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(bin)}`
}

/** The system print dialog, where "Save as PDF" is one of the printers. */
function printHtml(html: string) {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  frame.srcdoc = html
  frame.onload = () => {
    const win = frame.contentWindow
    if (!win) return
    // The print dialog may not block; remove the frame only once printing is done.
    win.addEventListener('afterprint', () => setTimeout(() => frame.remove()))
    win.focus()
    win.print()
  }
  document.body.appendChild(frame)
}
