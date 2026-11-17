import { create } from 'zustand'
import { isTauri } from '@/core/fs'
import { useSettings } from '@/core/state'

/** How this install gets updates (src-tauri/src/updates.rs): the app itself, Flatpak, or the system (.deb, source build). */
export type UpdateKind = 'self' | 'flatpak' | 'system'

export interface UpdateInfo {
  kind: UpdateKind
  current: string
  /** null = already the newest version. */
  version: string | null
  notes: string
}

type Phase = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'

interface UpdateState {
  /** false on the phone app and in the browser: the update commands don't exist there. */
  available: boolean
  phase: Phase
  info: UpdateInfo | null
  /** 0..1 while downloading, -1 when the size is unknown. */
  progress: number
  error: string
  /** The card was closed with Later: hidden until the app starts again. */
  later: boolean
  lastCheck: number
}

export const useUpdates = create<UpdateState>()(() => ({ available: isTauri(), phase: 'idle', info: null, progress: 0, error: '', later: false, lastCheck: 0 }))

const DAY = 24 * 60 * 60 * 1000

async function invoke<T>(cmd: string): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd)
}

/** Ask GitHub for the newest version. Errors don't pop up: Settings → Updates shows them. */
export async function checkForUpdates(): Promise<void> {
  const st = useUpdates.getState()
  if (!st.available || st.phase === 'checking' || st.phase === 'downloading' || st.phase === 'ready') return
  useUpdates.setState({ phase: 'checking', error: '', lastCheck: Date.now() })
  try {
    const info = await invoke<UpdateInfo>('update_check')
    useUpdates.setState({ phase: 'idle', info })
  } catch (e) {
    // An app without the command (the phone app) never offers updates.
    const msg = String(e)
    if (/not found|unknown command/i.test(msg)) useUpdates.setState({ available: false, phase: 'idle' })
    else useUpdates.setState({ phase: 'error', error: msg })
  }
}

/** The automatic check: about 10 s after start, then at most once a day while the app stays open. */
export function startAutoCheck(): () => void {
  const tick = () => {
    const { updateCheck, loaded } = useSettings.getState()
    if (loaded && updateCheck && Date.now() - useUpdates.getState().lastCheck > DAY) void checkForUpdates()
  }
  const first = setTimeout(tick, 10_000)
  const daily = setInterval(tick, 60 * 60 * 1000)
  return () => {
    clearTimeout(first)
    clearInterval(daily)
  }
}

/** Download and install (signature checked in Rust). Restarting is a separate click. */
export async function installUpdate(): Promise<void> {
  useUpdates.setState({ phase: 'downloading', progress: 0, error: '' })
  const { listen } = await import('@tauri-apps/api/event')
  const stop = await listen<{ done: number; total: number | null }>('update-progress', (e) =>
    useUpdates.setState({ progress: e.payload.total ? e.payload.done / e.payload.total : -1 }),
  )
  try {
    await invoke('update_install')
    useUpdates.setState({ phase: 'ready' })
  } catch (e) {
    useUpdates.setState({ phase: 'error', error: String(e) })
  } finally {
    stop()
  }
}

export const restartApp = () => invoke('update_restart')

/** The version the card should offer, or null (newest already, skipped, or closed with Later). */
export function offeredVersion(st: UpdateState, skip: string): string | null {
  const v = st.info?.version
  if (!v || st.later || v === skip) return null
  return v
}
