import { Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SPELL_LANGUAGES, useSettings } from '@/core/state'
import { confirmDialog } from '@/shared/dialogs'
import { AI_MODELS, spellAvailable, useAiHelper } from '@/shared/spell'
import { Modal } from '@/shared/ui'
import { PluginsSection } from '../plugins/PluginsSection'
import './settings.css'

import { useSettingsDialog } from './open'
import { ShortcutTable } from './ShortcutTable'
import { HotwheelSection } from '../hotwheel/HotwheelSettings'
import { GitSettingsSection } from './GitSettingsSection'
import { PresetsSection } from './PresetsSection'
import { DrawingSection } from './DrawingSection'

const UI = {
  title: 'Settings',
  spell: 'Spell check',
  spellOn: 'Underline misspelled words',
  spellDesktopOnly: 'Spell check works in the desktop app.',
  languages: 'Languages',
  words: 'My dictionary',
  wordsHint: 'Words you added with "Add to dictionary". Names of your items, characters, towns and enemies are always known.',
  noWords: 'No words yet.',
  ai: 'AI helper',
  aiAbout: 'An AI model that runs on this computer and checks your grammar and spelling as you write. Click a blue underline for its suggestions. It can also show the Ask your project tool, which looks things up in your own notes. Nothing is sent to the internet.',
  aiModels: 'Model',
  aiDownload: 'Download',
  aiRemove: 'Remove AI helper',
  aiRemoveAsk: 'Delete the downloaded AI helper and its models from this computer?',
  aiUse: 'Check grammar with the AI helper',
  askProject: 'Show the Ask your project tool (looks things up in your notes, never writes for you)',
  aiProgram: 'Downloading program',
  aiModel: 'Downloading model',
  close: 'Close',
  writer: 'Writer',
  writerSyntax: 'New documents start with Markdown Syntax on',
  writerSyntaxHint: 'Markdown Syntax lets you format by typing symbols, like ==highlight== or > [!note], and turns pasted Markdown into formatting. Each document has its own switch in its header.',
  pixels: 'Pictures',
  sharp: 'Sharp pixel art',
  sharpHint: 'Small pictures, like pixel art tiles in Level Layout, are shown with hard square pixels instead of being smoothed. Turn it off for painted or photo tilesets.',
  keys: 'Keyboard shortcuts',
  search: 'Search settings',
  noMatch: (q: string) => `No setting matches "${q}".`,
  hints: 'Hotkey hint mode',
  hintsOn: 'Show each button\'s key in its corner (also a switch in the sidebar)',
  keysHint: 'Click Change and press the new key. Single-letter keys only work in the tool you clicked last. The user guide (F1) has the same list as a cheatsheet.',
}

/** v0.20: the tabs of the Settings window; each section says which tab it is on with data-tab. */
const TABS = [
  { id: 'general', name: 'General' },
  { id: 'writing', name: 'Writing' },
  { id: 'keys', name: 'Keys & Hotwheel' },
  { id: 'presets', name: 'Project presets' },
  { id: 'git', name: 'Git' },
  { id: 'plugins', name: 'Plugins', desktop: true },
]

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`

/** App settings (v0.4; tabs and search since v0.20). */
export function SettingsHost() {
  const open = useSettingsDialog((s) => s.open)
  return open ? <SettingsDialog onClose={() => useSettingsDialog.setState({ open: false })} /> : null
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useSettings()
  const section = useSettingsDialog((x) => x.section)
  const box = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState('general')
  const [query, setQuery] = useState('')
  const empty = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const el = section ? box.current?.querySelector<HTMLElement>(`[data-section="${section}"]`) : null
    const onTab = el?.closest<HTMLElement>('[data-tab]')?.dataset.tab
    if (onTab) setTab(onTab)
    requestAnimationFrame(() => el?.scrollIntoView({ block: 'start' }))
  }, [section])
  // Without a search only the open tab shows; with one, every section of any tab that has all the words.
  useLayoutEffect(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    let any = false
    for (const el of box.current?.querySelectorAll<HTMLElement>('.settings-body > [data-tab]') ?? []) {
      const text = (el.textContent ?? '').toLowerCase()
      el.hidden = words.length ? !words.every((w) => text.includes(w)) : el.dataset.tab !== tab
      any ||= !el.hidden
    }
    if (empty.current) empty.current.hidden = any || !words.length
  }, [query, tab])
  const ai = useAiHelper()
  const desktop = spellAvailable()

  useEffect(() => {
    void useAiHelper.getState().check()
  }, [])

  const toggleLang = (id: string, on: boolean) =>
    s.update({ spellLanguages: on ? [...s.spellLanguages, id] : s.spellLanguages.filter((l) => l !== id) })

  const removeAi = async () => {
    if (await confirmDialog({ title: UI.aiRemove, message: UI.aiRemoveAsk, confirmLabel: 'Remove', danger: true })) await ai.remove()
  }

  return (
    <Modal onClose={onClose}>
      <div className="settings" ref={box}>
        <header className="settings-header">
          <h2>{UI.title}</h2>
          <button className="icon-btn" title={UI.close} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="settings-bar">
          <div className="settings-tabs" role="tablist">
            {TABS.filter((t) => desktop || !t.desktop).map((t) => (
              <button key={t.id} role="tab" aria-selected={!query && tab === t.id} className={`settings-tab${!query && tab === t.id ? ' on' : ''}`} onClick={() => (setTab(t.id), setQuery(''))}>
                {t.name}
              </button>
            ))}
          </div>
          <label className="settings-search">
            <Search size={14} />
            <input className="input" type="search" placeholder={UI.search} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
        <p className="muted" ref={empty} hidden>
          {UI.noMatch(query)}
        </p>
        <div className="settings-body">
          <div data-tab="writing">
          <section>
            <h3>{UI.spell}</h3>
            {!desktop && <p className="muted">{UI.spellDesktopOnly}</p>}
            <label className="settings-check">
              <input type="checkbox" checked={s.spellCheck} onChange={(e) => s.update({ spellCheck: e.target.checked })} />
              {UI.spellOn}
            </label>
            <div className="settings-row">
              <span className="muted">{UI.languages}</span>
              {SPELL_LANGUAGES.map((l) => (
                <label key={l.id} className="settings-check">
                  <input type="checkbox" checked={s.spellLanguages.includes(l.id)} onChange={(e) => toggleLang(l.id, e.target.checked)} />
                  {l.name}
                </label>
              ))}
            </div>
            <h4>{UI.words}</h4>
            <p className="muted settings-hint">{UI.wordsHint}</p>
            <div className="settings-words">
              {s.personalWords.length === 0 && <span className="muted">{UI.noWords}</span>}
              {s.personalWords.map((w) => (
                <span key={w} className="settings-word">
                  {w}
                  <button title={`Remove ${w}`} onClick={() => s.update({ personalWords: s.personalWords.filter((x) => x !== w) })}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          </section>
          </div>
          <div data-tab="writing">
          {desktop && (
            <section>
              <h3>{UI.ai}</h3>
              <p className="muted settings-hint">{UI.aiAbout}</p>
              {ai.installed && (
                <>
                  <label className="settings-check">
                    <input type="checkbox" checked={s.aiHelper} onChange={(e) => s.update({ aiHelper: e.target.checked })} />
                    {UI.aiUse}
                  </label>
                  <label className="settings-check">
                    <input type="checkbox" checked={s.askProject} onChange={(e) => s.update({ askProject: e.target.checked })} />
                    {UI.askProject}
                  </label>
                </>
              )}
              <h4>{UI.aiModels}</h4>
              {AI_MODELS.map((m) => (
                <div key={m.id} className="settings-model">
                  <label className="settings-check">
                    <input
                      type="radio"
                      name="ai-model"
                      checked={s.aiModel === m.id}
                      disabled={!ai.models[m.id]}
                      onChange={() => s.update({ aiModel: m.id })}
                    />
                    <span>
                      <strong>{m.name}</strong> <span className="muted">· {m.size} · {m.about}</span>
                    </span>
                  </label>
                  {ai.downloading === m.id && ai.progress ? (
                    <div className="settings-progress">
                      <span>
                        {ai.progress.stage === 'program' ? UI.aiProgram : UI.aiModel}… {mb(ai.progress.done)}
                        {ai.progress.total > 0 && ` / ${mb(ai.progress.total)}`}
                      </span>
                      <progress value={ai.progress.done} max={ai.progress.total || undefined} />
                    </div>
                  ) : (
                    !ai.models[m.id] && (
                      <button className="btn btn-primary" disabled={!!ai.progress} onClick={() => void ai.install(m.id)}>
                        {UI.aiDownload} ({m.size})
                      </button>
                    )
                  )}
                </div>
              ))}
              {Object.values(ai.models).some(Boolean) && !ai.progress && (
                <button className="btn" onClick={() => void removeAi()}>
                  {UI.aiRemove}
                </button>
              )}
              {ai.error && <p className="settings-error">{ai.error}</p>}
            </section>
          )}
          </div>
          <div data-tab="writing">
          <section data-section="writer">
            <h3>{UI.writer}</h3>
            <label className="settings-check">
              <input type="checkbox" checked={s.writerMarkdownSyntax} onChange={(e) => s.update({ writerMarkdownSyntax: e.target.checked })} />
              {UI.writerSyntax}
            </label>
            <p className="muted settings-hint">{UI.writerSyntaxHint}</p>
          </section>
          </div>
          <div data-tab="general">
          <section data-section="pixels">
            <h3>{UI.pixels}</h3>
            <label className="settings-check">
              <input type="checkbox" checked={s.sharpPixels} onChange={(e) => s.update({ sharpPixels: e.target.checked })} />
              {UI.sharp}
            </label>
            <p className="muted settings-hint">{UI.sharpHint}</p>
          </section>
          </div>
          <div data-tab="general">
          <DrawingSection />
          </div>
          <div data-tab="general">
          <section data-section="hints">
            <h3>{UI.hints}</h3>
            <label className="settings-check">
              <input type="checkbox" checked={s.hotkeyHints} onChange={(e) => s.update({ hotkeyHints: e.target.checked })} />
              {UI.hintsOn}
            </label>
          </section>
          </div>
          <div data-tab="keys">
          <HotwheelSection />
          </div>
          <div data-tab="keys">
          <section data-section="shortcuts">
            <h3>{UI.keys}</h3>
            <p className="muted settings-hint">{UI.keysHint}</p>
            <ShortcutTable editable />
          </section>
          </div>
          <div data-tab="presets">
          <PresetsSection />
          </div>
          <div data-tab="git">
          <GitSettingsSection />
          </div>
          <div data-tab="plugins">
          {desktop && <PluginsSection />}
          </div>
        </div>
      </div>
    </Modal>
  )
}
