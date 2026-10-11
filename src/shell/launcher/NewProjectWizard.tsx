import { useEffect, useState } from 'react'
import { getFs } from '@/core/fs'
import type { ComponentType } from '@/core/model'
import { defaultProjectsDir } from '@/core/project'
import { allManifests } from '@/core/registry'
import { useAppStore, useProjectStore } from '@/core/state'
import { applyTemplate, TEMPLATES, type Template } from './templates'
import { shownTool } from '../editor/optionalTools'
import './launcher.css'

/** Three-step new project flow (spec 5, NP-1..NP-6). */
export function NewProjectWizard() {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [components, setComponents] = useState<ComponentType[]>([])
  const [template, setTemplate] = useState<Template | null>(null)
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const manifests = allManifests().filter((m) => shownTool(m.type))

  useEffect(() => {
    void defaultProjectsDir().then(setLocation)
  }, [])

  const cancel = () => useAppStore.getState().go('launcher')
  const canNext = step !== 0 || name.trim().length > 0

  const finish = async () => {
    setBusy(true)
    setError(null)
    try {
      await useProjectStore.getState().create({ name, description, components, parentDir: location || undefined })
      const root = useProjectStore.getState().root
      if (template && root) await applyTemplate(root, template)
      useAppStore.getState().go('editor')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const next = () => {
    if (!canNext) return
    if (step < 2) setStep(step + 1)
    else void finish()
  }

  return (
    <div className="wizard">
      <form
        className="wizard-card"
        onSubmit={(e) => {
          e.preventDefault()
          next()
        }}
      >
        <div className="wizard-steps" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i <= step ? 'done' : ''} />
          ))}
        </div>

        {step === 0 && (
          <>
            <h2>Name your project</h2>
            <input className="input" autoFocus placeholder="My Game" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="location-row">
              <span>Saved in</span>
              <code title={location}>{location}</code>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  const picked = await getFs().pickFolder('Choose where to save the project')
                  if (picked) setLocation(picked)
                }}
              >
                Change…
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2>Short description</h2>
            <p className="muted">Optional. Shown on the project card.</p>
            <textarea className="input" autoFocus rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </>
        )}

        {step === 2 && (
          <>
            <h2>Which tools does this project need?</h2>
            <p className="muted">Start from a preset (a genre, or just writing, drawing or worldbuilding) or pick tools yourself. You can add more later from the sidebar.</p>
            <div className="template-row">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.description}
                  className={`template-chip${template?.id === t.id ? ' on' : ''}`}
                  onClick={() => {
                    setTemplate(template?.id === t.id ? null : t)
                    if (template?.id !== t.id) setComponents(t.components.filter((c) => manifests.some((m) => m.type === c)))
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
            {template && <p className="muted">{template.description} The vision page starts with the genre and suggested pillars, and the task board with first steps.</p>}
            <div className="component-checklist">
              {manifests.map((m) => (
                <label key={m.type} title={m.description}>
                  <input
                    type="checkbox"
                    checked={components.includes(m.type)}
                    onChange={(e) =>
                      setComponents(e.target.checked ? [...components, m.type] : components.filter((c) => c !== m.type))
                    }
                  />
                  <m.icon size={16} />
                  <span>{m.name}</span>
                </label>
              ))}
            </div>
            <div>
              <button type="button" className="btn btn-ghost" onClick={() => setComponents(manifests.map((m) => m.type))}>
                Select all
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setComponents([])}>
                Clear
              </button>
            </div>
          </>
        )}

        {error && <div className="launcher-error">{error}</div>}

        <div className="wizard-footer">
          <button type="button" className="btn btn-ghost" onClick={cancel}>
            Cancel
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button type="button" className="btn" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={!canNext || busy}>
              {step < 2 ? 'Next' : busy ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
