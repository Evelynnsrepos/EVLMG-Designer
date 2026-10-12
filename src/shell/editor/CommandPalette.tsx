import { isShortcut } from '@/core/shortcuts'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { allManifests, getManifest } from '@/core/registry'
import { useAppStore, useProjectStore } from '@/core/state'
import { openRarities } from '@/shared/categories'
import { combineRefProviders, rankRefItems, useEntityRefProvider, type RefItem } from '@/shared/richtext'
import { useArticleRefProvider } from '@/shared/wiki'
import { useHelp } from '../help/help'
import { openSettings } from '../settings/open'
import { openDesignBook } from '../designBook/open'
import { useEngineExport } from '../engineExport/open'
import { shownTool } from './optionalTools'
import { backToProjects, newDocument, openComponent, replaceWithComponent } from './actions'

/**
 * Ctrl+K (v0.7): find any tool, document, item, character, town, enemy or
 * wiki article by name, or run a command. Enter opens it alone (like a plain
 * click in the sidebar), Shift+Enter next to the open tools.
 */
interface Entry extends RefItem {
  run(beside: boolean): void
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcut(e, 'app.search')) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  return open ? <Palette onClose={() => setOpen(false)} /> : null
}

function Palette({ onClose }: { onClose(): void }) {
  const meta = useProjectStore((s) => s.meta)
  const entityRefs = useEntityRefProvider()
  const articleRefs = useArticleRefProvider()
  const refs = useMemo(() => combineRefProviders(entityRefs, articleRefs), [entityRefs, articleRefs])
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const commands = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    const tools = allManifests().filter((m) => meta?.enabledComponents.includes(m.type) && shownTool(m.type))
    for (const m of tools) {
      out.push({ kind: 'tool', id: m.type, label: m.name, hint: 'Tool', run: (b) => (b ? openComponent(m.type) : void replaceWithComponent(m.type)) })
      if (m.multiDocument) out.push({ kind: 'new', id: m.type, label: `New ${m.newDocumentTitle?.replace(/^Untitled /, '') ?? 'document'} (${m.name})`, hint: 'Create', run: () => newDocument(m.type) })
    }
    for (const d of meta?.documents ?? []) {
      const m = getManifest(d.type)
      if (m) out.push({ kind: 'doc', id: d.id, label: d.title, hint: m.name, run: (b) => (b ? openComponent(d.type, d.id) : void replaceWithComponent(d.type, d.id)) })
    }
    const cmd = (id: string, label: string, run: () => void) => out.push({ kind: 'cmd', id, label, hint: 'Command', run })
    cmd('settings', 'Settings', openSettings)
    cmd('rarities', 'Rarities', openRarities)
    cmd('book', 'Design Book (export as web page or PDF)', openDesignBook)
    cmd('engine', 'Export to a game engine (Godot, Unity, Unreal, JSON)', () => useEngineExport.setState({ open: true }))
    cmd('help', 'Help and user guide', () => useHelp.getState().openGuide())
    cmd('layout', 'Layout mode (move and close windows)', () => setTimeout(() => useAppStore.getState().setLayoutMode(true)))
    cmd('home', 'Back to projects', () => void backToProjects())
    return out
  }, [meta])

  const results = useMemo<Entry[]>(() => {
    const found = rankRefItems([...commands, ...refs.search(query).map((r) => ({ ...r, run: () => refs.open?.(r) }))], query, 40)
    return found as Entry[]
  }, [commands, refs, query])

  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const pick = (e: Entry | undefined, beside: boolean) => {
    if (!e) return
    onClose()
    e.run(beside)
  }

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Search">
        <div className="palette-input">
          <Search size={16} />
          <input
            autoFocus
            placeholder="Search tools, documents, entities and commands…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setIndex((i) => Math.min(results.length - 1, i + 1))
              else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1))
              else if (e.key === 'Enter') pick(results[index], e.shiftKey)
              else if (e.key === 'Escape') onClose()
              else return
              e.preventDefault()
              e.stopPropagation()
            }}
          />
        </div>
        <div className="palette-list" ref={list} role="listbox">
          {results.length === 0 && <div className="palette-empty">Nothing found.</div>}
          {results.map((r, i) => (
            <button
              key={`${r.kind}:${r.id}`}
              role="option"
              aria-selected={i === index}
              className={`palette-row${i === index ? ' on' : ''}`}
              onMouseMove={() => setIndex(i)}
              onClick={(e) => pick(r, e.shiftKey)}
            >
              <span style={r.color ? { color: r.color } : undefined}>{r.label}</span>
              <span className="palette-hint">{r.hint}</span>
            </button>
          ))}
        </div>
        <div className="palette-foot">Enter opens alone · Shift+Enter opens next to the others · Esc closes</div>
      </div>
    </div>
  )
}
