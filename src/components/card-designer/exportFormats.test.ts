import { describe, expect, it } from 'vitest'
import { atlasGrid, DEFAULT_EXPORT, exportBleed, godotAtlasTexture, godotFolder, homePaper, nearestShopSize, shopById, shopSize } from './exportFormats'
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
