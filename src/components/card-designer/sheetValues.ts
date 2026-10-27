import { HyperFormula } from 'hyperformula'
import type { SheetLike } from './model'

/**
 * A linked sheet with formula cells replaced by their results (`=B2*2` → `8`), so cards show what the
 * Spreadsheet shows. Other sheets of the workbook are loaded too, for formulas that point at them.
 * shortcut: the Spreadsheet's own CALC function and its date display aren't known here; dates come out as day numbers.
 */
export function evaluatedSheet(sheets: SheetLike[], sheet: SheetLike): SheetLike {
  if (!Object.values(sheet.cells).some((c) => c.v?.startsWith('='))) return sheet
  const grid = (s: SheetLike) => {
    const rows: string[][] = []
    for (const [a, c] of Object.entries(s.cells)) {
      const m = /^([A-Z]+)(\d+)$/.exec(a)
      if (!m) continue
      let col = 0
      for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
      ;(rows[Number(m[2]) - 1] ??= [])[col - 1] = c.v
    }
    return Array.from(rows, (r) => Array.from(r ?? [], (v) => v ?? null))
  }
  let hf: HyperFormula | null = null
  try {
    hf = HyperFormula.buildFromSheets(Object.fromEntries(sheets.map((s) => [s.name, grid(s)])), { licenseKey: 'gpl-v3' })
    const id = hf.getSheetId(sheet.name)
    if (id === undefined) return sheet
    const cells: SheetLike['cells'] = {}
    for (const [a, c] of Object.entries(sheet.cells)) {
      if (!c.v?.startsWith('=')) {
        cells[a] = c
        continue
      }
      const m = /^([A-Z]+)(\d+)$/.exec(a)!
      let col = 0
      for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
      const v = hf.getCellValue({ sheet: id, col: col - 1, row: Number(m[2]) - 1 })
      cells[a] = { v: typeof v === 'number' ? String(Number(v.toFixed(10))) : v === null ? '' : typeof v === 'object' ? String((v as { value?: unknown }).value ?? '') : String(v) }
    }
    return { ...sheet, cells }
  } catch {
    return sheet
  } finally {
    hf?.destroy()
  }
}
