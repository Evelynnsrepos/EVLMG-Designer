import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushAll, flushOn, hasPendingSaves, IDLE_SAVE_MS, onWriting, scheduleSave } from './autosave'
import { History } from './history'

describe('autosave', () => {
  afterEach(() => vi.useRealTimers())

  it('debounces repeated saves of the same key', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => {})
    scheduleSave('a', run)
    scheduleSave('a', run)
    await vi.advanceTimersByTimeAsync(999)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('flushAll writes immediately', async () => {
    const run = vi.fn(async () => {})
    scheduleSave('root|x', run)
    await flushAll('root|')
    expect(run).toHaveBeenCalledTimes(1)
    expect(hasPendingSaves()).toBe(false)
  })

  it('never writes the same key twice at once, and flushAll waits for writes already running', async () => {
    const order: string[] = []
    let active = 0
    const slow = (name: string) => async () => {
      active++
      expect(active).toBe(1)
      await new Promise((r) => setTimeout(r, 20))
      order.push(name)
      active--
    }
    scheduleSave('root|meta', slow('old'), 0)
    await new Promise((r) => setTimeout(r, 5)) // the timer has started the old write
    scheduleSave('root|meta', slow('new'))
    await flushAll('root|')
    expect(order).toEqual(['old', 'new'])
  })
})

describe('History', () => {
  it('undoes and redoes', () => {
    const h = new History<number>()
    h.record(1)
    h.record(2)
    expect(h.undo(3)).toBe(2)
    expect(h.undo(2)).toBe(1)
    expect(h.redo(1)).toBe(2)
    h.record(2)
    expect(h.canRedo).toBe(false)
  })
})

describe('saving at good moments (0.31)', () => {
  it('writes what waits for the safety-net timer when the window is left, and says when it writes', async () => {
    const leave = new EventTarget()
    const stop = flushOn(leave, ['blur'])
    const states: boolean[] = []
    const off = onWriting((w) => states.push(w))
    let saved = 0
    scheduleSave('test|moment', async () => void saved++, IDLE_SAVE_MS)
    expect(saved).toBe(0)
    leave.dispatchEvent(new Event('blur'))
    await flushAll('test|')
    expect(saved).toBe(1)
    expect(states).toEqual([true, false])
    off()
    stop()
  })
})

describe('drawing without a pause', () => {
  afterEach(() => vi.useRealTimers())
  it('still saves a minute after the first unsaved change', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => {})
    for (let t = 0; t < 59; t++) {
      scheduleSave('busy', run, IDLE_SAVE_MS)
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(run).not.toHaveBeenCalled()
    scheduleSave('busy', run, IDLE_SAVE_MS)
    await vi.advanceTimersByTimeAsync(1500)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
