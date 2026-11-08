import { beforeEach, describe, expect, it } from 'vitest'
import { COMPONENT_TYPES } from '@/core/model'
import { BASICS, TOOL_GUIDE } from './guide'
import { maybeStartTour, placeCard, TOURS, tourSeen, useHelp } from './help'

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
} as Storage

describe('user guide', () => {
  it('covers every tool and project theming', () => {
    for (const type of COMPONENT_TYPES) expect(TOOL_GUIDE[type]?.body.length, type).toBeGreaterThan(0)
    expect(BASICS.look.body.join(' ')).toMatch(/wallpaper/i)
  })
})

describe('tours', () => {
  beforeEach(() => {
    store.clear()
    useHelp.setState({ tour: null, step: 0, guide: null })
  })

  it('starts once on first launch and stays off after it ends', () => {
    maybeStartTour('launcher')
    expect(useHelp.getState().tour).toBe('launcher')
    useHelp.getState().endTour()
    expect(tourSeen('launcher')).toBe(true)
    maybeStartTour('launcher')
    expect(useHelp.getState().tour).toBeNull()
  })

  it('can be replayed from Help after it was seen', () => {
    store.set('egd-tour-editor-done', '1')
    useHelp.getState().openGuide()
    useHelp.getState().startTour('editor')
    expect(useHelp.getState()).toMatchObject({ tour: 'editor', step: 0, guide: null })
  })

  it('every step has text', () => {
    for (const steps of Object.values(TOURS)) for (const s of steps) expect(s.title && s.text).toBeTruthy()
  })
})

describe('placeCard', () => {
  const view = { width: 1000, height: 700 }
  const card = { width: 300, height: 150 }

  it('centers without a target', () => {
    expect(placeCard(null, card, view)).toEqual({ left: 350, top: 275 })
  })
  it('goes right of a target when there is room', () => {
    expect(placeCard({ left: 0, top: 100, width: 200, height: 40 }, card, view)).toEqual({ left: 212, top: 100 })
  })
  it('goes below a wide target and stays on screen', () => {
    const p = placeCard({ left: 900, top: 10, width: 90, height: 30 }, card, view)
    expect(p.top).toBe(52)
    expect(p.left + card.width).toBeLessThanOrEqual(view.width)
  })
  it('goes above a target at the bottom', () => {
    expect(placeCard({ left: 800, top: 650, width: 150, height: 40 }, card, view).top).toBe(488)
  })
})

describe('skipping the basics tours', () => {
  it('needs "I understand" typed in, nothing else', async () => {
    const { skipPhraseOk, GUARDED_TOURS } = await import('./help')
    expect(skipPhraseOk(' i UNDERSTAND ')).toBe(true)
    expect(skipPhraseOk('')).toBe(false)
    expect(skipPhraseOk('ok')).toBe(false)
    expect(GUARDED_TOURS).toEqual(['launcher', 'editor'])
  })
  it('the editor tour shows the Arrange button', () => {
    expect(TOURS.editor.some((s) => s.target === 'arrange')).toBe(true)
  })
})
