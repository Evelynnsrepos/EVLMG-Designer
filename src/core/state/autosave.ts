/**
 * Debounced auto-save (spec 3.5). Each file gets a key; scheduling the same
 * key again restarts its timer. `flush` writes immediately, used when a
 * component closes (ED-8) or the project/app closes.
 */
export const AUTOSAVE_DELAY_MS = 1000
/**
 * 0.31: heavy documents (Draw's pixels, Pixel Art) are not saved right after each stroke: they save at moments
 * where a short pause doesn't matter (a layer added or moved, another tool picked, leaving the window or the tool,
 * closing), and after this long without changes as a safety net.
 */
export const IDLE_SAVE_MS = 20_000
/** Drawing without a long pause still saves this long after the first unsaved change... */
export const MAX_SAVE_WAIT_MS = 60_000
/** ...but only once there is a short pause (no change for this long), never right after a stroke. */
export const PAUSE_SAVE_MS = 3000

type Job = { timer: ReturnType<typeof setTimeout>; run: () => Promise<void>; since: number }

const pending = new Map<string, Job>()
const listeners = new Set<(saving: boolean, error: unknown) => void>()
const savedListeners = new Set<(key: string) => void>()
const writingListeners = new Set<(writing: boolean) => void>()
const writing = (on: boolean) => writingListeners.forEach((fn) => fn(on))

export function scheduleSave(key: string, run: () => Promise<void>, delay = AUTOSAVE_DELAY_MS) {
  const existing = pending.get(key)
  if (existing) clearTimeout(existing.timer)
  const since = existing?.since ?? Date.now()
  // Long waits restart with every change; past MAX_SAVE_WAIT_MS since the first unsaved one, the next short pause.
  if (delay >= IDLE_SAVE_MS) delay = Math.max(PAUSE_SAVE_MS, Math.min(delay, since + MAX_SAVE_WAIT_MS - Date.now()))
  const timer = setTimeout(() => void flush(key), delay)
  pending.set(key, { timer, run, since })
  notify(true, null)
}

/** Saves of the same key that are being written right now; the next one waits, so an older write never lands last. */
const running = new Map<string, Promise<void>>()

export async function flush(key: string): Promise<void> {
  const job = pending.get(key)
  if (!job) return
  clearTimeout(job.timer)
  pending.delete(key)
  const before = running.get(key)
  const run = (async () => {
    await before?.catch(() => {})
    await job.run()
  })()
  running.set(key, run)
  writing(true)
  try {
    await run
    notify(pending.size > 0, null)
    for (const fn of savedListeners) fn(key)
  } catch (error) {
    console.error(`Auto-save failed for ${key}`, error)
    notify(pending.size > 0, error)
  } finally {
    if (running.get(key) === run) running.delete(key)
    if (!running.size) writing(false)
  }
}

/** Flush every key that starts with `prefix` (or all keys), including saves those saves schedule. */
export async function flushAll(prefix = ''): Promise<void> {
  // A save can schedule another (a drawing's pixels, then its document); a few rounds catch those.
  for (let round = 0; round < 4; round++) {
    const keys = [...pending.keys()].filter((k) => k.startsWith(prefix))
    // Writes a timer already started must finish too before the project or app closes.
    const busy = [...running].filter(([k]) => k.startsWith(prefix)).map(([, p]) => p.catch(() => {}))
    if (!keys.length && !busy.length) return
    await Promise.all([...keys.map(flush), ...busy])
  }
}

export function hasPendingSaves() {
  return pending.size > 0
}

/** Called with true when files start being written and false when all writes are done (the save bar). */
export function onWriting(fn: (writing: boolean) => void) {
  writingListeners.add(fn)
  return () => void writingListeners.delete(fn)
}

/** Save everything waiting when `target` fires one of `events` (the window losing focus or being hidden). */
export function flushOn(target: EventTarget, events: string[]) {
  const go = () => void flushAll()
  for (const e of events) target.addEventListener(e, go)
  return () => events.forEach((e) => target.removeEventListener(e, go))
}

/** Subscribe to save state for a status indicator. */
export function onSaveState(fn: (saving: boolean, error: unknown) => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** Called with the key after each successful write (keys start with `<project root>|`). Used by backups. */
export function onSaved(fn: (key: string) => void) {
  savedListeners.add(fn)
  return () => void savedListeners.delete(fn)
}

function notify(saving: boolean, error: unknown) {
  for (const fn of listeners) fn(saving, error)
}
