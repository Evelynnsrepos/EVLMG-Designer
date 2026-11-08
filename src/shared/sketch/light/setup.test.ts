import { describe, expect, it } from 'vitest'
import { anglesAt, applyPreset, defaultSetup, lampPosition, MAX_LAMPS, PRESET_IDS, restoreSetup, toneSteps } from './setup'

describe('light preview setup', () => {
  it('turns lamp angles into a position and back', () => {
    for (const l of [
      { azimuth: 0, elevation: 0, distance: 3 },
      { azimuth: 90, elevation: 30, distance: 5 },
      { azimuth: -135, elevation: -20, distance: 2 },
    ]) {
      const [x, y, z] = lampPosition(l)
      const back = anglesAt(x, y, z)
      expect(back.azimuth).toBeCloseTo(l.azimuth)
      expect(back.elevation).toBeCloseTo(l.elevation)
    }
    // In front, 0 degrees: straight towards the viewer side (+z).
    const [x, , z] = lampPosition({ azimuth: 0, elevation: 0, distance: 2 })
    expect(x).toBeCloseTo(0)
    expect(z).toBeCloseTo(2)
  })

  it('restores a broken or old setup safely', () => {
    expect(restoreSetup(null, new Set())).toEqual(defaultSetup())
    const s = restoreSetup(
      {
        lamps: Array.from({ length: 6 }, () => ({ strength: 99, color: 'red', elevation: 200, kind: 'laser' })),
        things: [{ shape: 'ball', x: 50 }, { shape: 'model', model: 'gone' }, { shape: 'model', model: 'here', name: 'Fox.glb' }, { shape: 'teapot' }, { shape: 'figure', pose: { lElbow: 999, bad: 'x' } }],
        room: -1,
        color: 'blue',
        shine: 7,
        view: 'nope',
      },
      new Set(['here']),
    )
    expect(s.lamps).toHaveLength(MAX_LAMPS)
    expect(s.lamps[0]).toMatchObject({ strength: 3, color: '#ffffff', elevation: 85, kind: 'sun', on: true })
    expect(s.things.map((t) => t.shape)).toEqual(['ball', 'model', 'figure'])
    expect(s.things[2].pose).toEqual({ lElbow: 180 })
    expect(s.grey).toBe(false)
    expect(s.contact).toBe(true)
    expect(s.things[0].x).toBe(4)
    expect(s.things[1].name).toBe('Fox.glb')
    expect(s.room).toBe(0)
    expect(s.view).toBe('clay')
    expect(s.color).toBe(defaultSetup().color)
    expect(s.shine).toBe(1)
  })

  it('puts the shadow line where a surface turns away from the lamp', () => {
    for (const v of ['two', 'three'] as const) {
      const steps = toneSteps(v)
      // Step i covers facing values -1 + 0.2 i .. -1 + 0.2 (i + 1).
      expect(steps.slice(0, 5).every((s) => s === 0)).toBe(true)
      expect(steps[5]).toBeGreaterThan(0)
      expect(steps[9]).toBe(1)
    }
  })

  it('presets change only the light', () => {
    const base = { ...defaultSetup(), color: '#123456' }
    for (const id of PRESET_IDS) {
      const s = applyPreset(base, id)
      expect(s.lamps.length).toBeGreaterThan(0)
      expect(s.lamps.length).toBeLessThanOrEqual(MAX_LAMPS)
      expect(new Set(s.lamps.map((l) => l.id)).size).toBe(s.lamps.length)
      expect(s.things).toBe(base.things)
      expect(s.color).toBe('#123456')
      // Every preset survives a round trip through storage.
      expect(restoreSetup(JSON.parse(JSON.stringify(s)), new Set())).toEqual(s)
    }
  })
})
