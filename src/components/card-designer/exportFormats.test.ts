import { describe, expect, it } from 'vitest'
import { atlasGrid, DEFAULT_EXPORT, exportBleed, exportKey, godotAtlasTexture, godotFolder, homePaper, logExport, nearestShopSize, recordCard, sameExport, settingLines, settingsFrom, shopById, shopSize } from './exportFormats'
import { createCardDoc } from './model'

describe('print shop presets', () => {
  it('gives the exact pixel sizes the shops ask for', () => {
    expect(shopSize(shopById('mpc'), { w: 63, h: 88 })).toMatchObject({ name: 'Poker', width: 822, height: 1122 })
    expect(shopSize(shopById('tgc'), { w: 63, h: 88 })).toMatchObject({ name: 'Poker', width: 825, height: 1125 })
    expect(shopSize(shopById('mpc'), { w: 70, h: 120 })).toMatchObject({ name: 'Tarot', width: 897, height: 1497 })
    expect(shopSize(shopById('mpc'), { w: 44, h: 63 })).toMatchObject({ name: 'Mini', width: 597, height: 822 })
  })

  it('turns the size for landscape cards and says when a shop has no such card', () => {
    expect(shopSize(shopById('mpc'), { w: 88, h: 63 })).toMatchObject({ width: 1122, height: 822 })
    expect(shopSize(shopById('mpc'), { w: 70, h: 70 })).toBeNull()
    expect(nearestShopSize(shopById('mpc'), { w: 62, h: 92 }).name).toBe('Poker')
  })
})

describe('export bleed', () => {
  const d = { ...createCardDoc(), bleedMm: 3 }
  it('adds to the card’s own bleed and can cut it down, never below nothing', () => {
    expect(exportBleed(d, { ...DEFAULT_EXPORT, addBleedMm: 2 })).toEqual({ cardMm: 3, totalMm: 5, addedMm: 2 })
    expect(exportBleed(d, { ...DEFAULT_EXPORT, addBleedMm: -1 })).toEqual({ cardMm: 3, totalMm: 2, addedMm: -1 })
    expect(exportBleed(d, { ...DEFAULT_EXPORT, addBleedMm: -9 }).totalMm).toBe(0)
  })
  it('takes the total from a print shop preset', () => {
    expect(exportBleed(d, { ...DEFAULT_EXPORT, target: 'shop', shop: 'pdf-in', addBleedMm: 5 }).totalMm).toBeCloseTo(3.175)
    expect(exportBleed(d, { ...DEFAULT_EXPORT, target: 'shop', shop: 'other', addBleedMm: 1 }).totalMm).toBe(4)
  })
  it('uses the picked paper or the custom size', () => {
    expect(homePaper({ ...DEFAULT_EXPORT, paper: 'a4' })).toEqual({ w: 210, h: 297 })
    expect(homePaper({ ...DEFAULT_EXPORT, paper: 'custom', paperW: 320, paperH: 450 })).toEqual({ w: 320, h: 450 })
  })
})

describe('Godot', () => {
  it('writes an AtlasTexture for one card of the sprite sheet', () => {
    const t = godotAtlasTexture('res://cards/cards.png', 512, 0, 512, 715)
    expect(t).toContain('[gd_resource type="AtlasTexture" load_steps=2 format=3]')
    expect(t).toContain('path="res://cards/cards.png"')
    expect(t).toContain('region = Rect2(512, 0, 512, 715)')
  })
  it('cleans up the folder and packs the sheet about square', () => {
    expect(godotFolder('cards')).toBe('res://cards/')
    expect(godotFolder(' res://art\\cards/ ')).toBe('res://art/cards/')
    expect(godotFolder('')).toBe('res://')
    expect(atlasGrid(10)).toEqual({ cols: 4, rows: 3 })
    expect(atlasGrid(1)).toEqual({ cols: 1, rows: 1 })
  })
})

describe('export memory', () => {
  const deck = (bleedMm: number) => ({ ...createCardDoc(), widthMm: 63, heightMm: 88, bleedMm })

  it('keeps the last export of each kind, newest first', () => {
    let d = deck(3)
    d = logExport(d, { ...DEFAULT_EXPORT, target: 'shop', shop: 'mpc' }, 5, 'a')
    d = logExport(d, { ...DEFAULT_EXPORT, target: 'shop', shop: 'tgc' }, 5, 'b')
    d = logExport(d, { ...DEFAULT_EXPORT, target: 'shop', shop: 'mpc', dpi: 600 }, 4, 'c')
    expect(d.exportLog!.map((r) => [r.key, r.at])).toEqual([['shop:mpc', 'c'], ['shop:tgc', 'b']])
    expect(exportKey({ ...DEFAULT_EXPORT, target: 'photo' })).toBe('photo')
  })

  it('makes another deck come out the same, even with a different card bleed', () => {
    const s = { ...DEFAULT_EXPORT, target: 'photo' as const, addBleedMm: 1, fill: 'mirror' as const, photo: '13x18' }
    const a = logExport(deck(3), s, 10)
    const r = a.exportLog![0]
    const b = deck(2)
    const cur = { ...DEFAULT_EXPORT, cards: 'this' as const, matchDeck: 'x' }
    const next = settingsFrom(r, b, cur)
    expect(next).toMatchObject({ target: 'photo', photo: '13x18', fill: 'mirror', addBleedMm: 2, cards: 'this', matchDeck: 'x' })
    expect(exportBleed(b, next).totalMm).toBe(4)
    expect(sameExport(next, b, r.settings, recordCard(r))).toBe(true)
    expect(sameExport({ ...next, photo: '10x15' }, b, r.settings, recordCard(r))).toBe(false)
    // Same card bleed: the fill counts too.
    expect(sameExport({ ...s, fill: 'edge' }, a, r.settings, recordCard(r))).toBe(false)
    expect(settingLines(s, a)).toContain('Bleed 4 mm in total')
    // A print shop sets its own bleed: the added bleed carried over stays what it was.
    const shop = logExport(a, { ...DEFAULT_EXPORT, target: 'shop', shop: 'mpc' }, 10).exportLog![0]
    expect(settingsFrom(shop, deck(3), cur).addBleedMm).toBe(0)
  })
})
