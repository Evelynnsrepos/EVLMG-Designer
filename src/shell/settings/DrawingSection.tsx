import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { isTauri } from '@/core/fs'
import { BENCH_CASES, benchReport, gpuInfo, runBenchCase, type BenchResult, type GpuInfo } from '@/shared/sketch/benchmark'

const T = {
  title: 'Drawing speed',
  graphics: 'Graphics',
  software: 'Drawing without the graphics card: drawing on big pictures will be slow.',
  run: 'Run drawing test',
  running: (n: number, of: number) => `Testing ${n} of ${of}…`,
  hint: 'Paints the same stroke on three test pictures and times every pen move. Takes about a minute; nothing is saved or sent.',
  copy: 'Copy results',
  mode: 'Graphics card (Linux)',
  modeHint: 'Takes effect after restarting the app. Try "Older screen handover" if the window stays blank or drawing is very slow on your graphics driver.',
  modes: { auto: 'Use the graphics card', 'no-dmabuf': 'Older screen handover', software: 'No graphics card (slowest, for broken drivers)' } as Record<string, string>,
  restart: 'Restart the app to use it.',
}

const isLinux = /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent)

/** 0.24: Settings, General: which graphics card draws, a drawing speed test and (Linux) the graphics mode. */
export function DrawingSection() {
  const [gpu] = useState<GpuInfo>(() => gpuInfo())
  const [results, setResults] = useState<BenchResult[]>([])
  const [step, setStep] = useState(0)
  const [mode, setMode] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    if (isTauri() && isLinux) void invoke<string>('graphics_mode_get').then(setMode).catch(() => setMode(null))
  }, [])

  const run = async () => {
    const out: BenchResult[] = []
    setResults(out)
    for (const [i, c] of BENCH_CASES.entries()) {
      setStep(i + 1)
      out.push(await runBenchCase(c))
      setResults([...out])
    }
    setStep(0)
  }

  const pick = async (m: string) => {
    await invoke('graphics_mode_set', { mode: m })
    setMode(m)
    setChanged(true)
  }

  return (
    <section data-section="drawing">
      <h3>{T.title}</h3>
      <p>
        <span className="muted">{T.graphics}:</span> {gpu.renderer}
      </p>
      {gpu.software && <p className="settings-error">{T.software}</p>}
      <p className="muted settings-hint">{T.hint}</p>
      <div className="settings-row">
        <button className="btn" disabled={step > 0} onClick={() => void run()}>
          {step ? T.running(step, BENCH_CASES.length) : T.run}
        </button>
        {results.length > 0 && !step && (
          <button className="btn btn-ghost" onClick={() => void navigator.clipboard.writeText(benchReport(gpu, results))}>
            {T.copy}
          </button>
        )}
      </div>
      {results.map((r) => (
        <p key={r.name}>
          <strong>{r.name}</strong> <span className="muted">· {r.avgMs.toFixed(1)} ms average · {r.p95Ms.toFixed(1)} ms slowest 5% · {r.slow} of {r.moves} moves too slow</span>
        </p>
      ))}
      {mode && (
        <>
          <h4>{T.mode}</h4>
          {Object.entries(T.modes).map(([id, label]) => (
            <label key={id} className="settings-check">
              <input type="radio" name="graphics-mode" checked={mode === id} onChange={() => void pick(id)} />
              {label}
            </label>
          ))}
          <p className="muted settings-hint">{changed ? T.restart : T.modeHint}</p>
        </>
      )}
    </section>
  )
}
