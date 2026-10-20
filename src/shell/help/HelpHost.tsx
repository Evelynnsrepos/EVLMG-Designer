import { BookOpen, Bug, CircleDot, GraduationCap, MousePointerClick, Waypoints, Grid2x2, Map as MapIcon, Sparkles, CircleHelp, Compass, ExternalLink, FolderGit2, GitBranch, Keyboard, LayoutPanelLeft, Link2, Palette, Puzzle, Rocket, Save, Search, Settings, ShieldCheck, SpellCheck, Type, Users, Wrench, X, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { allManifests } from '@/core/registry'
import { isShortcut } from '@/core/shortcuts'
import { useAppStore } from '@/core/state'
import { openExternalUrl } from '@/shared/links/openUrl'
import { Modal } from '@/shared/ui'
import { openSettings } from '../settings/open'
import { ShortcutTable } from '../settings/ShortcutTable'
import { KeyList, toolShortcuts } from '../workspace/ToolHelp'
import { BASICS, COMMUNITY_LINKS, TOOL_GUIDE, type GuideTopic } from './guide'
import type { ComponentType } from '@/core/model'
import { placeCard, TOURS, useHelp } from './help'
import { Linkified } from '@/shared/links'
import './help.css'

// A topic without an icon here falls back to the book, so a new guide topic can never crash the guide.
const BASIC_ICONS: Record<string, LucideIcon> = {
  basics: MousePointerClick,
  course: GraduationCap,
  hotwheel: CircleDot,
  start: Rocket,
  shortcuts: Keyboard,
  jumps: Waypoints,
  pixel: Grid2x2,
  sprites: Sparkles,
  levels: MapIcon,
  workspace: LayoutPanelLeft,
  tools: Wrench,
  saving: Save,
  spelling: SpellCheck,
  typing: Type,
  plugins: Puzzle,
  settings: Settings,
  links: Link2,
  together: Users,
  gitsync: GitBranch,
  search: Search,
  look: Palette,
}

/** The first pages, in this order: Esc and Shift-click, the cheat sheet, the crash course. */
const START = ['basics', 'shortcuts', 'course', 'hotwheel']

export const REPO_URL = 'https://github.com/Evelynnsrepos/Evelopment-Games-Designer'

/** Mount once at the app root: user guide dialog, tours and the F1 shortcut. */
export function HelpHost() {
  const guide = useHelp((s) => s.guide)
  const tour = useHelp((s) => s.tour)
  const report = useHelp((s) => s.report)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e, 'app.help')) return
      e.preventDefault()
      useHelp.getState().openGuide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      {report && <HelpDialog />}
      {guide && <GuideDialog topic={guide} />}
      {tour && <Tour />}
    </>
  )
}

/** The Help button: how to report a problem, the repository and the user guide. */
function HelpDialog() {
  const help = useHelp.getState()
  return (
    <Modal onClose={help.closeReport}>
      <div className="help-report">
        <h3>
          <CircleHelp size={18} /> Help
        </h3>
        <p>Found a bug or have an idea? Tell us on GitHub by opening an issue:</p>
        <ol>
          <li>Click Report an issue below and sign in to GitHub (a free account).</li>
          <li>Give it a short title, like "Map Creator: cities vanish after undo".</li>
          <li>Describe what you did, what happened and what you expected. Add screenshots if you can.</li>
          <li>Mention your app version (in the window title) and your system (Windows, Mac or Linux).</li>
        </ol>
        <div className="help-report-actions">
          <button className="btn btn-primary" onClick={() => void openExternalUrl(`${REPO_URL}/issues/new`)}>
            <Bug size={15} /> Report an issue
          </button>
          <button className="btn" onClick={() => void openExternalUrl(REPO_URL)}>
            <FolderGit2 size={15} /> Open the repository
          </button>
          <button className="btn" onClick={() => help.openGuide()}>
            <BookOpen size={15} /> User guide (F1)
          </button>
          <button className="btn" onClick={() => void openExternalUrl(`${REPO_URL}/blob/main/PRIVACY.md`)}>
            <ShieldCheck size={15} /> Privacy policy
          </button>
        </div>
        <p className="help-report-url">
          <ExternalLink size={12} /> {REPO_URL}
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={help.closeReport}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}

function GuideDialog({ topic }: { topic: string }) {
  const help = useHelp.getState()
  const current: GuideTopic | undefined = BASICS[topic] ?? TOOL_GUIDE[topic as keyof typeof TOOL_GUIDE]
  const screen = useAppStore((s) => s.screen)
  const tour = screen === 'editor' ? 'editor' : 'launcher'
  const bodyRef = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  // v0.18: search the tool pages by name and by what they say.
  const tools = allManifests().filter((m) => {
    const t = TOOL_GUIDE[m.type]
    return !query || `${m.name} ${t?.title ?? ''} ${t?.body.join(' ') ?? ''} ${t?.tips?.join(' ') ?? ''}`.toLowerCase().includes(query)
  })
  const toolKeys = topic in TOOL_GUIDE ? toolShortcuts(topic as ComponentType).filter((g) => g.name !== 'Everywhere') : []
  const nav = (key: string) => {
    const Icon = BASIC_ICONS[key] ?? BookOpen
    return (
      <button key={key} className={key === topic ? 'active' : ''} onClick={() => help.openGuide(key)}>
        <Icon size={14} /> {BASICS[key].title}
      </button>
    )
  }
  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0)
  }, [topic])

  return (
    <Modal onClose={help.closeGuide}>
      <div className="help-guide">
        <header className="help-guide-header">
          <h3>
            <BookOpen size={18} /> User guide
          </h3>
          <button className="btn" onClick={() => help.startTour(tour)}>
            <Compass size={15} /> Take the tour
          </button>
          <button className="icon-btn" title="Close" onClick={help.closeGuide}>
            <X size={16} />
          </button>
        </header>
        <div className="help-guide-main">
          <nav className="help-guide-nav">
            <div className="help-guide-group">Start here</div>
            {START.map(nav)}
            <div className="help-guide-group">Topics</div>
            {Object.keys(BASICS)
              .filter((k) => !START.includes(k))
              .map(nav)}
            <div className="help-guide-group">Tools in detail</div>
            <input className="input help-guide-search" placeholder="Search tools…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the tool pages" />
            {!tools.length && <div className="muted help-guide-none">Nothing matches.</div>}
            {tools.map((m) => (
              <button key={m.type} className={m.type === topic ? 'active' : ''} onClick={() => help.openGuide(m.type)}>
                <m.icon size={14} /> {m.name}
              </button>
            ))}
            <div className="help-guide-group">Evelopment Games</div>
            {COMMUNITY_LINKS.map((l) => (
              <button key={l.url} title={l.url} onClick={() => void openExternalUrl(l.url)}>
                <l.icon size={14} /> {l.label}
              </button>
            ))}
            <div className="help-guide-credit">Free and open source under the GPL-3.0.</div>
          </nav>
          <div className="help-guide-body" ref={bodyRef}>
            {current && (
              <>
                <h2>{current.title}</h2>
                {current.body.map((p) =>
                  p.startsWith('## ') ? (
                    <h3 key={p}>{p.slice(3)}</h3>
                  ) : (
                    <p key={p}>
                      <Linkified text={p} />
                    </p>
                  ),
                )}
                {toolKeys.map((g) => (
                  <section key={g.name} className="help-guide-keys">
                    <h3>Shortcuts</h3>
                    <KeyList rows={g.rows} />
                  </section>
                ))}
                {topic === 'shortcuts' && (
                  <>
                    <button className="btn btn-primary" onClick={() => (help.closeGuide(), openSettings('shortcuts'))}>
                      <Keyboard size={15} /> Change shortcuts in Settings
                    </button>
                    <ShortcutTable />
                  </>
                )}
                {current.tips && (
                  <ul className="help-guide-tips">
                    {current.tips.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Tour() {
  const { tour, step, setStep, endTour } = useHelp()
  const steps = TOURS[tour!]
  const current = steps[Math.min(step, steps.length - 1)]
  const cardRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [pos, setPos] = useState({ left: -9999, top: -9999 })

  useLayoutEffect(() => {
    const measure = () => {
      const el = current.target ? document.querySelector(`[data-tour="${current.target}"]`) : null
      const r = el?.getBoundingClientRect() ?? null
      setRect(r && r.width > 0 ? r : null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [current])

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const place = () => setPos(placeCard(rect, { width: card.offsetWidth, height: card.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }))
    place()
    // The card's size can change after the first paint (styles or fonts arriving).
    const observer = new ResizeObserver(place)
    observer.observe(card)
    return () => observer.disconnect()
  }, [rect, current])

  const last = step >= steps.length - 1
  const next = () => (last ? endTour() : setStep(step + 1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault() // keep Esc from toggling Layout Mode (ED-7)
        e.stopPropagation()
        endTour()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft' && step > 0) setStep(step - 1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const pad = 6
  return (
    <div className="help-tour" role="dialog" aria-modal="true" aria-label="App tour">
      {rect ? (
        <div className="help-tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : (
        <div className="help-tour-dim" />
      )}
      <div className="help-tour-card" ref={cardRef} style={pos}>
        <div className="help-tour-count">
          {step + 1} / {steps.length}
        </div>
        <h3>{current.title}</h3>
        <p>{current.text}</p>
        <div className="help-tour-actions">
          <button className="btn btn-ghost" onClick={endTour}>
            Skip tour
          </button>
          <span style={{ flex: 1 }} />
          {step > 0 && (
            <button className="btn" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button className="btn btn-primary" autoFocus onClick={next}>
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
