import { Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SPELL_LANGUAGES, useSettings } from '@/core/state'
import { confirmDialog } from '@/shared/dialogs'
import { AI_MODELS, spellAvailable, useAiHelper } from '@/shared/spell'
import { Modal } from '@/shared/ui'
import { LANGS, localized, setLang, useLang, type Lang } from '@/shared/i18n'
import { PluginsSection } from '../plugins/PluginsSection'
import './settings.css'

import { useSettingsDialog } from './open'
import { ShortcutTable } from './ShortcutTable'
import { HotwheelSection } from '../hotwheel/HotwheelSettings'
import { GitSettingsSection } from './GitSettingsSection'
import { PresetsSection } from './PresetsSection'
import { DrawingSection } from './DrawingSection'
import { UpdatesSection } from '../updates/UpdatesSection'
import { setContrast, setGlass, setUiScale, UI_SCALES, useContrast, useGlass, useUiScale, type Glass } from '../theme'

const UI_EN = {
  title: 'Settings',
  spell: 'Spell check',
  spellOn: 'Underline misspelled words',
  spellAutoFix: 'Fix sure slips while I write (like "teh"). Ctrl+Z takes one back, and that word is then left alone',
  learned: (n: number) => `${n} fix${n === 1 ? '' : 'es'} learned from your clicks.`,
  forget: 'Forget them',
  spellCalm: 'Calm underlines: only show them in the paragraph I am writing in',
  writingHintsOff: (n: number) => `${n} kind${n === 1 ? '' : 's'} of writing hint turned off.`,
  writingHintsOn: 'Turn them back on',
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
  glass: 'Glass look',
  glassLevels: { full: 'Full glass', light: 'Light glass (no blur, fastest)', off: 'Off (solid, the classic look)' } as Record<Glass, string>,
  size: 'Interface size',
  sizeHint: 'Makes every menu, button and text bigger or smaller. Canvas tools keep their own zoom on top. Ctrl+0 in a canvas still fits the picture.',
  reset: 'Reset',
  contrast: 'Strong contrast',
  contrastOn: 'Plain, solid colours with darker text, clear lines and thick focus rings (turns the glass look off)',
  language: 'Interface language',
  languageHint: 'German is still being translated: so far the Settings are in German, the rest follows in parts. Some texts switch when you open them again.',
  glassHint: 'The app gets a glass look: rounded see-through menus, dialogs, toolbars and panels over a soft background in your project colours. Full glass also blurs what is behind the sidebar, dialogs and menus. Canvases always stay solid. Choose Light or Off if the app feels slower.',
  pixels: 'Pictures',
  sharp: 'Sharp pixel art',
  sharpHint: 'Small pictures, like pixel art tiles in Level Layout, are shown with hard square pixels instead of being smoothed. Turn it off for painted or photo tilesets.',
  keys: 'Keyboard shortcuts',
  search: 'Search settings',
  noMatch: (q: string) => `No setting matches "${q}".`,
  hints: 'Hotkey hint mode',
  hintsOn: 'Show each button\'s key in its corner',
  keysHint: 'Click Change and press the new key. Single-letter keys only work in the tool you clicked last. The user guide (F1) has the same list as a cheatsheet.',
}

/** German interface, part 1 (review: Evelynn). Terms: docs/GERMAN-TERMS.md. */
const UI_DE: Partial<typeof UI_EN> = {
  title: 'Einstellungen',
  spell: 'Rechtschreibprüfung',
  spellOn: 'Falsch geschriebene Wörter unterstreichen',
  spellAutoFix: 'Sichere Tippfehler beim Schreiben verbessern (wie „teh“). Strg+Z nimmt eine Verbesserung zurück, das Wort bleibt dann so',
  learned: (n: number) => `${n} ${n === 1 ? 'Verbesserung' : 'Verbesserungen'} aus deinen Klicks gelernt.`,
  forget: 'Vergessen',
  spellCalm: 'Ruhige Unterstreichungen: nur im Absatz zeigen, in dem ich gerade schreibe',
  writingHintsOff: (n: number) => `${n} ${n === 1 ? 'Art' : 'Arten'} von Schreibhinweisen ausgeschaltet.`,
  writingHintsOn: 'Wieder einschalten',
  spellDesktopOnly: 'Die Rechtschreibprüfung gibt es in der Desktop-App.',
  languages: 'Sprachen',
  words: 'Mein Wörterbuch',
  wordsHint: 'Wörter, die du mit „Zum Wörterbuch hinzufügen“ hinzugefügt hast. Die Namen deiner Gegenstände, Figuren, Orte und Gegner kennt die App immer.',
  noWords: 'Noch keine Wörter.',
  ai: 'KI-Hilfe',
  aiAbout: 'Ein KI-Modell, das auf diesem Computer läuft und beim Schreiben deine Grammatik und Rechtschreibung prüft. Klicke auf eine blaue Unterstreichung für seine Vorschläge. Es kann auch das Werkzeug „Frag dein Projekt“ zeigen, das in deinen eigenen Notizen nachschaut. Nichts wird ins Internet geschickt.',
  askProject: 'Das Werkzeug „Frag dein Projekt“ zeigen (schaut in deinen Notizen nach, schreibt nie für dich)',
  aiModels: 'Modell',
  aiDownload: 'Herunterladen',
  aiRemove: 'KI-Hilfe entfernen',
  aiRemoveAsk: 'Die heruntergeladene KI-Hilfe und ihre Modelle von diesem Computer löschen?',
  aiUse: 'Grammatik mit der KI-Hilfe prüfen',
  aiProgram: 'Programm wird geladen',
  aiModel: 'Modell wird geladen',
  close: 'Schließen',
  writer: 'Writer',
  writerSyntax: 'Neue Dokumente starten mit Markdown-Syntax an',
  writerSyntaxHint: 'Mit Markdown-Syntax formatierst du durch Zeichen, wie ==Markierung== oder > [!note], und eingefügtes Markdown wird zu Formatierung. Jedes Dokument hat seinen eigenen Schalter oben.',
  glass: 'Glas-Look',
  glassLevels: { full: 'Volles Glas', light: 'Leichtes Glas (ohne Unschärfe, am schnellsten)', off: 'Aus (einfarbig, der klassische Look)' },
  glassHint: 'Die App bekommt einen Glas-Look: runde, durchscheinende Menüs, Fenster, Werkzeugleisten und Bereiche über einem weichen Hintergrund in deinen Projektfarben. Volles Glas macht außerdem unscharf, was hinter der Seitenleiste, den Fenstern und Menüs liegt. Leinwände bleiben immer einfarbig. Wähle Leicht oder Aus, wenn sich die App langsamer anfühlt.',
  pixels: 'Bilder',
  sharp: 'Scharfe Pixel-Art',
  sharpHint: 'Kleine Bilder, wie Pixel-Art-Kacheln im Level Layout, werden mit harten, eckigen Pixeln gezeigt statt geglättet. Schalte es für gemalte Bilder oder Foto-Tilesets aus.',
  keys: 'Tastenkürzel',
  search: 'Einstellungen durchsuchen',
  noMatch: (q: string) => `Keine Einstellung passt zu „${q}“.`,
  hints: 'Tastenhinweise',
  hintsOn: 'Die Taste jedes Knopfs in seiner Ecke zeigen',
  keysHint: 'Klicke auf Ändern und drücke die neue Taste. Einzelne Buchstaben wirken nur im Werkzeug, das du zuletzt angeklickt hast. Das Handbuch (F1) hat dieselbe Liste als Spickzettel.',
  size: 'Größe der Oberfläche',
  sizeHint: 'Macht alle Menüs, Knöpfe und Texte größer oder kleiner. Zeichenwerkzeuge behalten ihren eigenen Zoom obendrauf. Strg+0 auf einer Leinwand passt das Bild weiterhin ein.',
  reset: 'Zurücksetzen',
  contrast: 'Starker Kontrast',
  contrastOn: 'Einfache, einfarbige Farben mit dunklerem Text, klaren Linien und dicken Fokusrahmen (schaltet den Glas-Look aus)',
  language: 'Sprache der Oberfläche',
  languageHint: 'Deutsch ist noch in Arbeit: Bisher sind die Einstellungen übersetzt, der Rest folgt Stück für Stück. Manche Texte wechseln erst, wenn du sie neu öffnest.',
}

const UI = localized(UI_EN, UI_DE)

/** v0.20: the tabs of the Settings window; each section says which tab it is on with data-tab. */
const TAB_NAMES = localized(
  { general: 'General', writing: 'Writing', keys: 'Keys & QuickSelect', presets: 'Project presets', git: 'Git', plugins: 'Plugins' },
  { general: 'Allgemein', writing: 'Schreiben', keys: 'Tasten & QuickSelect', presets: 'Projektvorlagen' },
)
const TABS = [
  { id: 'general' },
  { id: 'writing' },
  { id: 'keys' },
  { id: 'presets' },
  { id: 'git' },
  { id: 'plugins', desktop: true },
] as { id: keyof typeof TAB_NAMES; desktop?: boolean }[]

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`

/** App settings (v0.4; tabs and search since v0.20). */
export function SettingsHost() {
  const open = useSettingsDialog((s) => s.open)
  return open ? <SettingsDialog onClose={() => useSettingsDialog.setState({ open: false })} /> : null
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  useLang() // texts follow a language switch
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
                {TAB_NAMES[t.id]}
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
            <label className="settings-check">
              <input type="checkbox" checked={s.spellCalm} onChange={(e) => s.update({ spellCalm: e.target.checked })} />
              {UI.spellCalm}
            </label>
            <label className="settings-check">
              <input type="checkbox" checked={s.spellAutoFix} onChange={(e) => s.update({ spellAutoFix: e.target.checked })} />
              {UI.spellAutoFix}
            </label>
            {Object.keys(s.learnedFixes).length > 0 && (
              <p className="muted settings-hint">
                {UI.learned(Object.keys(s.learnedFixes).length)}{' '}
                <button className="btn" onClick={() => s.update({ learnedFixes: {} })}>
                  {UI.forget}
                </button>
              </p>
            )}
            {s.spellRulesOff.length > 0 && (
              <p className="muted settings-hint">
                {UI.writingHintsOff(s.spellRulesOff.length)}{' '}
                <button className="btn" onClick={() => s.update({ spellRulesOff: [] })}>
                  {UI.writingHintsOn}
                </button>
              </p>
            )}
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
          <GlassSection />
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
              <input type="checkbox" checked={s.hotkeyHints} onChange={(e) => s.update({ hotkeyHints: e.target.checked, hotkeyHintsChosen: true })} />
              {UI.writingHintsOn}
            </label>
          </section>
          </div>
          <div data-tab="general">
          <UpdatesSection />
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

/** Glass look (Liquid Glass style), per machine like light/dark; interface size and strong contrast too (pro fixes step 9). */
function GlassSection() {
  const glass = useGlass()
  const contrast = useContrast()
  const scale = useUiScale()
  return (
    <>
    <LanguageSection />
    <section data-section="size">
      <h3>{UI.size}</h3>
      <label className="settings-check">
        <input type="range" min={UI_SCALES.min} max={UI_SCALES.max} step={5} value={scale} onChange={(e) => setUiScale(Number(e.target.value))} aria-label={UI.size} />
        <span>{scale} %</span>
        {scale !== 100 && (
          <button className="btn btn-ghost" onClick={() => setUiScale(100)}>
            {UI.reset}
          </button>
        )}
      </label>
      <p className="muted settings-hint">{UI.sizeHint}</p>
    </section>
    <section data-section="contrast">
      <h3>{UI.contrast}</h3>
      <label className="settings-check">
        <input type="checkbox" checked={contrast} onChange={(e) => setContrast(e.target.checked)} />
        {UI.contrastOn}
      </label>
    </section>
    <section data-section="glass">
      <h3>{UI.glass}</h3>
      {(Object.keys(UI.glassLevels) as Glass[]).map((g) => (
        <label key={g} className="settings-check">
          <input type="radio" name="glass" checked={glass === g} onChange={() => setGlass(g)} />
          {UI.glassLevels[g]}
        </label>
      ))}
      <p className="muted settings-hint">{UI.glassHint}</p>
    </section>
    </>
  )
}

function LanguageSection() {
  const lang = useLang()
  return (
    <section data-section="language">
      <h3>{UI.language}</h3>
      <select className="input" value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={UI.language}>
        {LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <p className="muted settings-hint">{UI.languageHint}</p>
    </section>
  )
}
