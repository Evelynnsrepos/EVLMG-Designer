import { describe, expect, it } from 'vitest'
import { Engine, entryTable, setCalcPresets, setLookupEntries, statOf, type LookupEntry } from './engine'
import { newSheet, type Workbook } from './model'

function book(): Workbook {
  const a = { ...newSheet('Sheet1'), cells: { A1: { v: '2' }, A2: { v: '3' }, A3: { v: '=SUM(A1:A2)' }, B1: { v: '03.10.2026' } } }
  const b = { ...newSheet('Loot'), cells: { A1: { v: '=Sheet1!A3*10' } } }
  return { sheets: [a, b], activeSheetId: a.id }
}

describe('spreadsheet engine', () => {
  it('works out formulas across sheets and recognises dates', () => {
    const e = new Engine()
    const wb = book()
    e.sync(wb)
    expect(e.shown(wb.sheets[0].id, 0, 2).value).toBe(5)
    expect(e.shown(wb.sheets[1].id, 0, 0).value).toBe(50)
    expect(e.shown(wb.sheets[0].id, 1, 0).isDate).toBe(true)
    const next = { ...wb, sheets: [{ ...wb.sheets[0], cells: { ...wb.sheets[0].cells, A1: { v: '10' } } }, wb.sheets[1]] }
    e.sync(next)
    expect(e.shown(wb.sheets[1].id, 0, 0).value).toBe(130)
    expect(e.shown(wb.sheets[0].id, 3, 3).value).toBe(null)
  })

  it('moves formulas when rows are inserted and sheets renamed', () => {
    const e = new Engine()
    let wb = book()
    wb = e.structure(wb, wb.sheets[0].id, { axis: 'row', at: 0, count: 1 })
    expect(wb.sheets[0].cells.A4.v).toBe('=SUM(A2:A3)')
    expect(wb.sheets[1].cells.A1.v).toBe('=Sheet1!A4*10')
    wb = e.renameSheet(wb, wb.sheets[0].id, 'Stats')
    expect(wb.sheets[1].cells.A1.v).toBe('=Stats!A4*10')
    e.sync(wb)
    expect(e.shown(wb.sheets[1].id, 0, 0).value).toBe(50)
  })

  it('runs calculator presets with CALC()', () => {
    setCalcPresets([{ name: 'Hit', expression: 'ATK * 2 - DEF', values: { ATK: 10, DEF: 4 } }])
    const e = new Engine()
    const s = { ...newSheet('Sheet1'), cells: { A1: { v: '50' }, B1: { v: '=CALC("Hit")' }, B2: { v: '=CALC("hit", "ATK", A1)' }, B3: { v: '=CALC("Nope")' } } }
    e.sync({ sheets: [s], activeSheetId: s.id })
    expect(e.shown(s.id, 1, 0).value).toBe(16)
    expect(e.shown(s.id, 1, 1).value).toBe(96)
    expect(e.shown(s.id, 1, 2).error).toMatch(/Nope/)
  })

  it('reads live entry values with STAT() and builds entry tables (0.28)', () => {
    const entries: LookupEntry[] = [
      { kind: 'item', name: 'Fire Sword', fields: { ATK: 12, Rarity: 'Rare' } },
      { kind: 'item', name: 'Bow', fields: { ATK: 8, Range: 30 } },
      { kind: 'enemy', name: 'Bow', fields: { HP: 5 } },
    ]
    setLookupEntries(entries)
    const e = new Engine()
    const s = { ...newSheet('Sheet1'), cells: { A1: { v: '=STAT("fire sword", "atk")*2' }, A2: { v: '=STAT("Fire Sword", "Rarity")' }, A3: { v: '=STAT("Bow", "HP")' }, A4: { v: '=STAT("Bow", "HP", "enemy")' }, A5: { v: '=STAT("Nope", "ATK")' }, A6: { v: '=STAT("Fire Sword", "Range")' } } }
    const wb = { sheets: [s], activeSheetId: s.id }
    e.sync(wb)
    const v = (row: number) => e.shown(s.id, 0, row)
    expect(v(0).value).toBe(24)
    expect(v(1).value).toBe('Rare')
    expect(v(2).error).toContain('enemy')
    expect(v(3).value).toBe(5)
    expect(v(4).error).toContain('No entry called')
    expect(v(5).value).toBe(0)
    setLookupEntries([...entries, { kind: 'item', name: 'Bow', fields: {} }])
    e.recalc()
    expect(e.shown(s.id, 0, 3).value).toBe(5)
    expect(statOf('Bow', 'ATK', 'item')).toBeInstanceOf(Object)
    expect(String((statOf('Bow', 'ATK', 'item') as { message?: string }).message)).toContain('2 entries are called "Bow"')
    setLookupEntries(entries)
    const t = entryTable(entries.filter((x) => x.kind === 'item'), 1, 0)
    expect(t.B1.v).toBe('Name')
    expect(t.C1.v).toBe('ATK')
    expect(t.C2.v).toBe('=STAT(B2, "ATK", "item")')
    const t2 = { ...newSheet('T'), cells: t }
    e.sync({ sheets: [t2], activeSheetId: t2.id })
    expect(e.shown(t2.id, 2, 2).value).toBe(8)
  })
})
