import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { loadDocumentNow, useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { createDamagePresetDoc, damagePresetFormula, type DamagePresetDoc } from '@/shared/calculators'
import { confirmDialog, promptDialog } from '@/shared/dialogs'
import { DRAG_MIME, type DragPayload } from '@/shell/editor/actions'
import { Engine, setCalcPresets } from './engine'
import {
  addr,
  colName,
  createWorkbook,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  fillSeries,
  formatValue,
  MIN_COLS,
  MIN_ROWS,
  newSheet,
  nextSheetName,
  normalizeWorkbook,
  normRange,
  parseAddr,
  rangeName,
  sheetRef,
  shiftFormula,
  usedSize,
  type Cell,
  type CellStyle,
  type Range,
  type Sheet,
  type Workbook,
} from './model'
import { CalcPanel, Toolbar } from './Toolbar'
import { ChartBox } from './Chart'
import { chartData } from './chartData'
import { parseCSV, toCSV } from '@/shared/csv'
import { parseRange } from './range'
import { saveTextFile, safeFileName } from '@/core/export'
import { newId } from '@/core/model'
import './spreadsheet.css'
import { pointIn, zoomOf } from '@/shared/zoom'

const HEAD_W = 46
const HEAD_H = 24

interface Pos {
  col: number
  row: number
}
interface Selection {
  anchor: Pos
  focus: Pos
}
interface Editing {
  /** The cell being edited; it stays the target while other sheets are clicked for references. */
  sheetId: Id
  key: string
  text: string
  /** Typed into the formula bar instead of the cell. */
  bar: boolean
  /** Where a clicked cell reference goes while writing a formula. */
  refAt: { start: number; end: number } | null
}
type Drag = { kind: 'select' } | { kind: 'fill'; to: Pos } | { kind: 'ref'; start: Pos } | { kind: 'resize'; axis: 'col' | 'row'; index: number; from: number; size: number }

/** Cumulative offsets of columns or rows, plus a lookup from pixel to index. */
function useAxis(count: number, sizes: Record<number, number>, fallback: number) {
  return useMemo(() => {
    const at = new Float64Array(count + 1)
    for (let i = 0; i < count; i++) at[i + 1] = at[i] + (sizes[i] ?? fallback)
    const index = (px: number) => {
      let lo = 0
      let hi = count - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (at[mid] <= px) lo = mid
        else hi = mid - 1
      }
      return Math.max(0, lo)
    }
    return { at, index, size: (i: number) => sizes[i] ?? fallback, total: at[count] }
  }, [count, sizes, fallback])
}

const ANCHOR_OPS = /[=(,+\-*/^&<>:;]\s*$/

/** Spreadsheet (v0.9): Excel-style grid with formulas, fill handle, formatting and several sheets. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<Workbook>('spreadsheet', documentId!, createWorkbook)
  useUndoRedoKeys(doc, active)
  const engine = useMemo(() => new Engine(), [])
  useEffect(() => () => engine.destroy(), [engine])
  const [, setTick] = useState(0)
  useCalcPresets(engine, active, () => setTick((t) => t + 1))

  const wb = useMemo(() => normalizeWorkbook(doc.data), [doc.data])
  engine.sync(wb)
  const sheet = wb.sheets.find((s) => s.id === wb.activeSheetId)!

  const [sel, setSel] = useState<Selection>({ anchor: { col: 0, row: 0 }, focus: { col: 0, row: 0 } })
  const [editing, setEditing] = useState<Editing | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [view, setView] = useState({ top: 0, left: 0, width: 800, height: 600 })
  const [menu, setMenu] = useState<{ x: number; y: number; axis: 'row' | 'col' | 'cell' | 'sheet'; sheetId?: Id } | null>(null)
  const clip = useRef<{ text: string; sheetId: Id; range: Range; cells: (Cell | undefined)[][]; cut: boolean } | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const editor = useRef<HTMLInputElement>(null)
  const barInput = useRef<HTMLInputElement>(null)

  const used = useMemo(() => usedSize(sheet), [sheet])
  const range = normRange(sel.anchor, sel.focus)
  const rowsCount = Math.max(MIN_ROWS, used.rows + 50, range.r2 + 50, Math.ceil((view.top + view.height) / DEFAULT_ROW_HEIGHT) + 20)
  const colsCount = Math.max(MIN_COLS, used.cols + 10, range.c2 + 10, Math.ceil((view.left + view.width) / DEFAULT_COL_WIDTH) + 5)
  const cols = useAxis(colsCount, sheet.colWidths, DEFAULT_COL_WIDTH)
  const rows = useAxis(rowsCount, sheet.rowHeights, DEFAULT_ROW_HEIGHT)
  /** Frozen rows and columns, and how much room they take at the top and left. */
  const fr = sheet.freeze?.rows ?? 0
  const fc = sheet.freeze?.cols ?? 0
  const frozenH = rows.at[fr]
  const frozenW = cols.at[fc]

  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    const measure = () => setView((v) => ({ ...v, width: el.clientWidth, height: el.clientHeight }))
    measure()
    const o = new ResizeObserver(measure)
    o.observe(el)
    return () => o.disconnect()
  }, [])

  // ---- writing -------------------------------------------------------------------

  const update = useCallback(
    (fn: (wb: Workbook) => Workbook) => doc.update((d) => fn(normalizeWorkbook(d))),
    [doc],
  )
  const updateSheet = useCallback(
    (fn: (s: Sheet) => Sheet) => update((w) => ({ ...w, sheets: w.sheets.map((s) => (s.id === w.activeSheetId ? fn(s) : s)) })),
    [update],
  )
  /** Write several cells (of the active sheet, or `sheetId`); empty text with no style removes the cell. */
  const writeCells = useCallback(
    (changes: Record<string, Partial<Cell> | null>, sheetId?: Id) =>
      update((w) => ({
        ...w,
        sheets: w.sheets.map((s) => {
          if (s.id !== (sheetId ?? w.activeSheetId)) return s
          const cells = { ...s.cells }
          for (const [k, c] of Object.entries(changes)) {
            const next = c === null ? undefined : { ...cells[k], v: '', ...c }
            if (!next || (next.v === '' && (!next.s || Object.keys(next.s).length === 0))) delete cells[k]
            else cells[k] = next as Cell
          }
          return { ...s, cells }
        }),
      })),
    [update],
  )
  const forRange = (r: Range, fn: (k: string, c: number, row: number) => void) => {
    for (let row = r.r1; row <= r.r2; row++) for (let c = r.c1; c <= r.c2; c++) fn(addr(c, row), c, row)
  }
  const setStyle = (patch: Partial<CellStyle> | ((s: CellStyle) => CellStyle)) => {
    const changes: Record<string, Partial<Cell>> = {}
    forRange(range, (k) => {
      const cur = sheet.cells[k]
      const s = typeof patch === 'function' ? patch(cur?.s ?? {}) : { ...cur?.s, ...patch }
      for (const key of Object.keys(s) as (keyof CellStyle)[]) if (s[key] === undefined) delete s[key]
      changes[k] = { v: cur?.v ?? '', s }
    })
    writeCells(changes)
  }

  // ---- selection and editing -----------------------------------------------------

  const activeKey = addr(sel.anchor.col, sel.anchor.row)
  const activeCell = sheet.cells[activeKey]

  const scrollTo = useCallback(
    (p: Pos) => {
      const el = body.current
      if (!el) return
      const x = cols.at[p.col]
      const y = rows.at[p.row]
      const w = cols.size(p.col)
      const h = rows.size(p.row)
      // Cells under the frozen area need to scroll a bit further.
      if (p.col >= fc) {
        if (x - frozenW < el.scrollLeft) el.scrollLeft = x - frozenW
        else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth
      }
      if (p.row >= fr) {
        if (y - frozenH < el.scrollTop) el.scrollTop = y - frozenH
        else if (y + h > el.scrollTop + el.clientHeight) el.scrollTop = y + h - el.clientHeight
      }
    },
    [cols, rows, fr, fc, frozenH, frozenW],
  )

  const select = (anchor: Pos, focus: Pos = anchor) => {
    setSel({ anchor, focus })
    scrollTo(focus)
  }

  const startEdit = (text: string, bar = false) => setEditing({ sheetId: sheet.id, key: activeKey, text, bar, refAt: null })
  const commit = (move?: { dc: number; dr: number }) => {
    if (!editing) return
    let text = editing.text
    // Close brackets the user left open, like Excel.
    if (text.startsWith('=')) {
      const open = (text.match(/\(/g)?.length ?? 0) - (text.match(/\)/g)?.length ?? 0)
      if (open > 0) text += ')'.repeat(open)
    }
    const target = wb.sheets.find((x) => x.id === editing.sheetId)
    const before = target?.cells[editing.key]
    if (target && text !== (before?.v ?? '')) writeCells({ [editing.key]: { v: text, s: before?.s } }, target.id)
    setEditing(null)
    grid.current?.focus()
    // Formulas that picked cells on another sheet go back to their own sheet.
    if (target && target.id !== sheet.id) {
      update((w) => ({ ...w, activeSheetId: target.id }))
      const p = parseAddr(editing.key)!
      setSel({ anchor: p, focus: p })
      return
    }
    if (move) {
      const p = { col: Math.max(0, sel.anchor.col + move.dc), row: Math.max(0, sel.anchor.row + move.dr) }
      select(p)
    }
  }
  const cancel = () => {
    setEditing(null)
    grid.current?.focus()
  }

  useEffect(() => {
    if (editing && !editing.bar) editor.current?.focus()
  }, [editing])

  // ---- pointer -------------------------------------------------------------------

  const cellAt = (e: { clientX: number; clientY: number }): Pos => {
    const { x, y } = pointIn(body.current!, e)
    // The frozen area does not scroll.
    return { col: cols.index(x < frozenW ? x : x + body.current!.scrollLeft), row: rows.index(y < frozenH ? y : y + body.current!.scrollTop) }
  }

  /** While writing a formula, a click on a cell puts its address in. */
  const canInsertRef = () => {
    if (!editing || !editing.text.startsWith('=')) return false
    if (editing.refAt) return true
    const input = editing.bar ? barInput.current : editor.current
    const caret = input?.selectionStart ?? editing.text.length
    return ANCHOR_OPS.test(editing.text.slice(0, caret))
  }
  const insertRef = (ref: string) => {
    setEditing((ed) => {
      if (!ed) return ed
      const input = ed.bar ? barInput.current : editor.current
      const caret = input?.selectionStart ?? ed.text.length
      const at = ed.refAt ?? { start: caret, end: caret }
      const full = ed.sheetId === sheet.id ? ref : `${sheetRef(sheet.name)}!${ref}`
      const text = ed.text.slice(0, at.start) + full + ed.text.slice(at.end)
      return { ...ed, text, refAt: { start: at.start, end: at.start + full.length } }
    })
  }

  const onBodyDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const p = cellAt(e)
    if (canInsertRef()) {
      e.preventDefault()
      insertRef(addr(p.col, p.row))
      setDrag({ kind: 'ref', start: p })
      return
    }
    if (editing) commit()
    grid.current?.focus()
    if (e.shiftKey) setSel((s) => ({ ...s, focus: p }))
    else setSel({ anchor: p, focus: p })
    setDrag({ kind: 'select' })
  }

  // Column and row resizing: shown live, saved once on release.
  const [liveSize, setLiveSize] = useState<{ axis: 'col' | 'row'; index: number; size: number } | null>(null)
  const updateSheetLive = (axis: 'col' | 'row', index: number, size: number) => setLiveSize({ axis, index, size })
  const commitResize = () => {
    if (!liveSize) return
    const { axis, index, size } = liveSize
    updateSheet((s) => (axis === 'col' ? { ...s, colWidths: { ...s.colWidths, [index]: Math.round(size) } } : { ...s, rowHeights: { ...s.rowHeights, [index]: Math.round(size) } }))
    setLiveSize(null)
  }
  const colW = (i: number) => (liveSize?.axis === 'col' && liveSize.index === i ? liveSize.size : cols.size(i))
  const rowH = (i: number) => (liveSize?.axis === 'row' && liveSize.index === i ? liveSize.size : rows.size(i))
  const colX = (i: number) => cols.at[i] + (liveSize?.axis === 'col' && i > liveSize.index ? liveSize.size - cols.size(liveSize.index) : 0)
  const rowY = (i: number) => rows.at[i] + (liveSize?.axis === 'row' && i > liveSize.index ? liveSize.size - rows.size(liveSize.index) : 0)

  // ---- fill handle ---------------------------------------------------------------

  /** The area a fill drag covers beyond the selection: down, up, right or left, whichever is further. */
  function fillTarget(r: Range, to: Pos): { dir: 'down' | 'up' | 'right' | 'left'; count: number } | null {
    const down = to.row - r.r2
    const up = r.r1 - to.row
    const right = to.col - r.c2
    const left = r.c1 - to.col
    const best = Math.max(down, up, right, left)
    if (best <= 0) return null
    if (best === down) return { dir: 'down', count: down }
    if (best === up) return { dir: 'up', count: up }
    if (best === right) return { dir: 'right', count: right }
    return { dir: 'left', count: left }
  }

  function fill(t: ReturnType<typeof fillTarget>) {
    if (!t) return
    const changes: Record<string, Partial<Cell> | null> = {}
    const vertical = t.dir === 'down' || t.dir === 'up'
    const lines = vertical ? range.c2 - range.c1 + 1 : range.r2 - range.r1 + 1
    const len = vertical ? range.r2 - range.r1 + 1 : range.c2 - range.c1 + 1
    for (let line = 0; line < lines; line++) {
      const srcPos = (i: number): Pos => (vertical ? { col: range.c1 + line, row: range.r1 + i } : { col: range.c1 + i, row: range.r1 + line })
      const src = Array.from({ length: len }, (_, i) => sheet.cells[addr(srcPos(i).col, srcPos(i).row)])
      const reversed = t.dir === 'up' || t.dir === 'left'
      const ordered = reversed ? [...src].reverse() : src
      const hasFormula = ordered.some((c) => c?.v.startsWith('='))
      const series = hasFormula ? [] : fillSeries(ordered.map((c) => c?.v ?? ''), t.count)
      for (let i = 0; i < t.count; i++) {
        const offset = reversed ? -(i + 1) : len + i
        const pos = vertical ? { col: range.c1 + line, row: range.r1 + offset } : { col: range.c1 + offset, row: range.r1 + line }
        if (pos.col < 0 || pos.row < 0) continue
        const from = ordered[i % len]
        const fromPos = srcPos(reversed ? len - 1 - (i % len) : i % len)
        const v = hasFormula ? shiftFormula(from?.v ?? '', pos.col - fromPos.col, pos.row - fromPos.row) : series[i]
        changes[addr(pos.col, pos.row)] = v === '' && !from?.s ? null : { v, s: from?.s }
      }
    }
    writeCells(changes)
    const end = t.dir === 'down' ? { col: range.c2, row: range.r2 + t.count } : t.dir === 'up' ? { col: range.c2, row: range.r1 - t.count } : t.dir === 'right' ? { col: range.c2 + t.count, row: range.r2 } : { col: range.c1 - t.count, row: range.r2 }
    const a = t.dir === 'up' ? { col: range.c1, row: range.r2 } : t.dir === 'left' ? { col: range.c2, row: range.r1 } : { col: range.c1, row: range.r1 }
    setSel({ anchor: a, focus: { col: Math.max(0, end.col), row: Math.max(0, end.row) } })
  }

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      if (drag.kind === 'resize') {
        const size = Math.max(drag.axis === 'col' ? 24 : 16, drag.size + ((drag.axis === 'col' ? e.clientX : e.clientY) - drag.from) / zoomOf(body.current))
        updateSheetLive(drag.axis, drag.index, size)
        return
      }
      const p = cellAt(e)
      if (drag.kind === 'select') setSel((s) => ({ ...s, focus: p }))
      else if (drag.kind === 'ref') {
        const r = normRange(drag.start, p)
        setEditing((ed) => {
          if (!ed?.refAt) return ed
          const ref = ed.sheetId === sheet.id ? rangeName(r) : `${sheetRef(sheet.name)}!${rangeName(r)}`
          return { ...ed, text: ed.text.slice(0, ed.refAt.start) + ref + ed.text.slice(ed.refAt.end), refAt: { start: ed.refAt.start, end: ed.refAt.start + ref.length } }
        })
      } else if (drag.kind === 'fill') setDrag({ ...drag, to: p })
    }
    const up = () => {
      if (drag.kind === 'fill') fill(fillTarget(range, drag.to))
      if (drag.kind === 'resize') commitResize()
      setDrag(null)
    }
    // Pointer events, not mouse events: a pen on Linux (WebKitGTK) may not send mouse moves while it touches.
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  })

  // ---- clipboard -----------------------------------------------------------------

  const shownText = (c: number, r: number) => {
    const cell = sheet.cells[addr(c, r)]
    if (!cell) return ''
    const s = engine.shown(sheet.id, c, r)
    return s.error ?? formatValue(s.value, cell.s, s.isDate)
  }
  const copy = (e: React.ClipboardEvent, cut: boolean) => {
    if (editing) return
    e.preventDefault()
    const lines: string[] = []
    const cells: (Cell | undefined)[][] = []
    for (let r = range.r1; r <= range.r2; r++) {
      const row: string[] = []
      const raw: (Cell | undefined)[] = []
      for (let c = range.c1; c <= range.c2; c++) {
        row.push(shownText(c, r))
        raw.push(sheet.cells[addr(c, r)])
      }
      lines.push(row.join('\t'))
      cells.push(raw)
    }
    const text = lines.join('\n')
    e.clipboardData.setData('text/plain', text)
    clip.current = { text, sheetId: sheet.id, range, cells, cut }
  }
  const paste = (e: React.ClipboardEvent) => {
    if (editing) return
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    const at = { col: range.c1, row: range.r1 }
    const changes: Record<string, Partial<Cell> | null> = {}
    const c = clip.current
    if (c && c.text === text) {
      c.cells.forEach((row, ri) =>
        row.forEach((cell, ci) => {
          const v = cell ? shiftFormula(cell.v, at.col - c.range.c1, at.row - c.range.r1) : ''
          changes[addr(at.col + ci, at.row + ri)] = cell ? { v, s: cell.s } : null
        }),
      )
      if (c.cut && c.sheetId === sheet.id) {
        for (let r = c.range.r1; r <= c.range.r2; r++)
          for (let cc = c.range.c1; cc <= c.range.c2; cc++) {
            const k = addr(cc, r)
            if (!(k in changes)) changes[k] = null
          }
        clip.current = null
      }
    } else {
      text
        .replace(/\r/g, '')
        .replace(/\n$/, '')
        .split('\n')
        .forEach((line, ri) => line.split('\t').forEach((v, ci) => (changes[addr(at.col + ci, at.row + ri)] = { v, s: sheet.cells[addr(at.col + ci, at.row + ri)]?.s })))
    }
    writeCells(changes)
  }

  // ---- keyboard ------------------------------------------------------------------

  /** Ctrl+arrow: jump to the edge of the data, like Excel. */
  const jump = (p: Pos, dc: number, dr: number): Pos => {
    const has = (q: Pos) => !!sheet.cells[addr(q.col, q.row)]?.v
    const max = { col: colsCount - 1, row: rowsCount - 1 }
    let q = { ...p }
    const step = () => ({ col: Math.min(max.col, Math.max(0, q.col + dc)), row: Math.min(max.row, Math.max(0, q.row + dr)) })
    const next = step()
    if (has(q) && has(next)) {
      while (true) {
        const n = step()
        if ((n.col === q.col && n.row === q.row) || !has(n)) return q
        q = n
      }
    }
    while (true) {
      const n = step()
      if (n.col === q.col && n.row === q.row) return q
      q = n
      if (has(q)) return q
      if (q.row > used.rows && q.col > used.cols) return { col: dc ? (dc > 0 ? max.col : 0) : q.col, row: dr ? (dr > 0 ? used.rows : 0) : q.row }
    }
  }

  const onGridKey = (e: React.KeyboardEvent) => {
    if (editing || e.target !== grid.current) return
    const ctrl = e.ctrlKey || e.metaKey
    const arrows: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
    if (arrows[e.key]) {
      e.preventDefault()
      const [dc, dr] = arrows[e.key]
      const from = e.shiftKey ? sel.focus : sel.anchor
      const to = ctrl ? jump(from, dc, dr) : { col: Math.max(0, from.col + dc), row: Math.max(0, from.row + dr) }
      if (e.shiftKey) {
        setSel({ anchor: sel.anchor, focus: to })
        scrollTo(to)
      } else select(to)
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const back = e.shiftKey ? -1 : 1
      select(e.key === 'Enter' ? { col: sel.anchor.col, row: Math.max(0, sel.anchor.row + back) } : { col: Math.max(0, sel.anchor.col + back), row: sel.anchor.row })
      return
    }
    if (e.key === 'F2') {
      e.preventDefault()
      startEdit(activeCell?.v ?? '')
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      const changes: Record<string, Partial<Cell> | null> = {}
      forRange(range, (k) => (changes[k] = sheet.cells[k]?.s ? { v: '', s: sheet.cells[k].s } : null))
      writeCells(changes)
      return
    }
    if (ctrl && !e.altKey) {
      const k = e.key.toLowerCase()
      const toggles: Record<string, keyof CellStyle> = { b: 'b', i: 'i', u: 'u' }
      if (toggles[k]) {
        e.preventDefault()
        const key = toggles[k]
        const on = !activeCell?.s?.[key]
        setStyle({ [key]: on || undefined })
        return
      }
      if (k === 'a') {
        e.preventDefault()
        setSel({ anchor: { col: 0, row: 0 }, focus: { col: Math.max(0, used.cols - 1), row: Math.max(0, used.rows - 1) } })
        return
      }
      if (k === 'd' || k === 'r') {
        e.preventDefault()
        // Ctrl+D fills down from the top row, Ctrl+R right from the left column.
        const src: Range = k === 'd' ? { ...range, r2: range.r1 } : { ...range, c2: range.c1 }
        const count = k === 'd' ? range.r2 - range.r1 : range.c2 - range.c1
        if (count > 0) {
          const changes: Record<string, Partial<Cell> | null> = {}
          forRange(range, (key, c, r) => {
            if ((k === 'd' && r === src.r1) || (k === 'r' && c === src.c1)) return
            const from = k === 'd' ? { col: c, row: src.r1 } : { col: src.c1, row: r }
            const cell = sheet.cells[addr(from.col, from.row)]
            changes[key] = cell ? { v: shiftFormula(cell.v, c - from.col, r - from.row), s: cell.s } : null
          })
          writeCells(changes)
        }
        return
      }
      return
    }
    if (e.key.length === 1 && !e.altKey) {
      e.preventDefault()
      startEdit(e.key)
    }
  }

  // ---- structure -----------------------------------------------------------------

  const structure = (axis: 'row' | 'col', at: number, count: number) => {
    update((w) => engine.structure(w, w.activeSheetId, { axis, at, count }))
    setMenu(null)
  }
  const clearRange = () => {
    const changes: Record<string, null> = {}
    forRange(range, (k) => (changes[k] = null))
    writeCells(changes)
    setMenu(null)
  }

  // ---- sheets --------------------------------------------------------------------

  const addSheet = () =>
    update((w) => {
      const s = newSheet(nextSheetName(w.sheets))
      return { ...w, sheets: [...w.sheets, s], activeSheetId: s.id }
    })
  const renameSheet = async (s: Sheet) => {
    const name = (await promptDialog('Rename sheet', s.name))?.trim()
    if (!name || name === s.name) return
    if (wb.sheets.some((o) => o.id !== s.id && o.name.toLowerCase() === name.toLowerCase())) return
    update((w) => engine.renameSheet(w, s.id, name))
  }
  const deleteSheet = async (s: Sheet) => {
    if (wb.sheets.length === 1) return
    if (!(await confirmDialog({ title: `Delete ${s.name}?`, message: 'Formulas that point at it show #REF!. You can undo with Ctrl+Z.', confirmLabel: 'Delete', danger: true }))) return
    update((w) => {
      const sheets = w.sheets.filter((o) => o.id !== s.id)
      return { ...w, sheets, activeSheetId: w.activeSheetId === s.id ? sheets[0].id : w.activeSheetId }
    })
  }
  const moveSheet = (id: Id, by: number) =>
    update((w) => {
      const i = w.sheets.findIndex((s) => s.id === id)
      const j = i + by
      if (j < 0 || j >= w.sheets.length) return w
      const sheets = [...w.sheets]
      ;[sheets[i], sheets[j]] = [sheets[j], sheets[i]]
      return { ...w, sheets }
    })
  const switchSheet = (id: Id) => {
    const picking = editing && canInsertRef()
    if (editing && !picking) commit()
    update((w) => ({ ...w, activeSheetId: id }))
    setSel({ anchor: { col: 0, row: 0 }, focus: { col: 0, row: 0 } })
    if (picking) setEditing((ed) => ed && { ...ed, bar: true })
  }

  // ---- calculator drop -----------------------------------------------------------

  const documents = useProjectStore((s) => s.meta?.documents)
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    const p = JSON.parse(raw) as DragPayload
    if (p.type !== 'damage-calculator') return
    e.preventDefault()
    e.stopPropagation()
    const title = documents?.find((d) => d.id === p.documentId)?.title
    if (!title) return
    const at = cellAt(e)
    writeCells({ [addr(at.col, at.row)]: { v: `=CALC("${title.replace(/"/g, '""')}")`, s: sheet.cells[addr(at.col, at.row)]?.s } })
    select(at)
  }

  // ---- render --------------------------------------------------------------------

  const c1 = cols.index(view.left)
  const c2 = Math.min(colsCount - 1, cols.index(view.left + view.width) + 1)
  const r1 = rows.index(view.top)
  const r2 = Math.min(rowsCount - 1, rows.index(view.top + view.height) + 1)
  const rect = (r: Range) => ({ left: colX(r.c1), top: rowY(r.r1), width: colX(r.c2) + colW(r.c2) - colX(r.c1), height: rowY(r.r2) + rowH(r.r2) - rowY(r.r1) })
  const fillPreview = drag?.kind === 'fill' ? fillTarget(range, drag.to) : null
  const previewRange: Range | null = fillPreview
    ? fillPreview.dir === 'down'
      ? { ...range, r1: range.r2 + 1, r2: range.r2 + fillPreview.count }
      : fillPreview.dir === 'up'
        ? { ...range, r2: range.r1 - 1, r1: Math.max(0, range.r1 - fillPreview.count) }
        : fillPreview.dir === 'right'
          ? { ...range, c1: range.c2 + 1, c2: range.c2 + fillPreview.count }
          : { ...range, c2: range.c1 - 1, c1: Math.max(0, range.c1 - fillPreview.count) }
    : null

  const renderCells = (ra: number, rb: number, ca: number, cb: number) => {
  const cellsShown: React.ReactNode[] = []
  for (let r = ra; r <= rb; r++) {
    for (let c = ca; c <= cb; c++) {
      const k = addr(c, r)
      const cell = sheet.cells[k]
      if (!cell) continue
      const s = cell.s ?? {}
      const shown = engine.shown(sheet.id, c, r)
      const text = shown.error ? String(shown.value) : formatValue(shown.value, s, shown.isDate)
      const numeric = typeof shown.value === 'number' || typeof shown.value === 'boolean'
      const align = s.align ?? (numeric ? 'right' : shown.error ? 'center' : 'left')
      const spill = !numeric && align === 'left' && !sheet.cells[addr(c + 1, r)]?.v
      const shadows = [
        s.top && `inset 0 ${s.top.w}px 0 ${s.top.color}`,
        s.bottom && `inset 0 -${s.bottom.w}px 0 ${s.bottom.color}`,
        s.left && `inset ${s.left.w}px 0 0 ${s.left.color}`,
        s.right && `inset -${s.right.w}px 0 0 ${s.right.color}`,
      ].filter(Boolean)
      const style: CSSProperties = {
        left: colX(c),
        top: rowY(r),
        width: colW(c),
        height: rowH(r),
        fontWeight: s.b ? 700 : undefined,
        fontStyle: s.i ? 'italic' : undefined,
        textDecoration: s.u ? 'underline' : undefined,
        color: shown.error ? 'var(--danger)' : s.color,
        background: s.bg,
        textAlign: align,
        justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
        boxShadow: shadows.length ? shadows.join(',') : undefined,
        overflow: spill && !s.bg ? 'visible' : 'hidden',
        zIndex: shadows.length ? 2 : spill ? 1 : undefined,
      }
      cellsShown.push(
        <div key={k} className="ss-cell" style={style} title={shown.error ?? undefined}>
          <span>{text}</span>
        </div>,
      )
    }
  }
  return cellsShown
  }

  const renderLines = (ra: number, rb: number, ca: number, cb: number) => {
    const out: React.ReactNode[] = []
    for (let c = ca; c <= cb + 1; c++) out.push(<div key={`v${c}`} className="ss-vline" style={{ left: colX(c) - 1, top: rowY(ra), height: rowY(rb + 1) - rowY(ra) }} />)
    for (let r = ra; r <= rb + 1; r++) out.push(<div key={`h${r}`} className="ss-hline" style={{ top: rowY(r) - 1, left: colX(ca), width: colX(cb + 1) - colX(ca) }} />)
    return out
  }

  const selRect = rect(range)
  const activeRect = rect({ c1: sel.anchor.col, r1: sel.anchor.row, c2: sel.anchor.col, r2: sel.anchor.row })
  const nums = engine.numbers(sheet.id, range.c1, range.r1, range.c2, range.r2)
  const isWhole = (axis: 'col' | 'row', i: number) => (axis === 'col' ? range.c1 <= i && i <= range.c2 && range.r1 === 0 && range.r2 >= rowsCount - 1 : range.r1 <= i && i <= range.r2 && range.c1 === 0 && range.c2 >= colsCount - 1)

  return (
    <div className="ss" onMouseDown={() => setMenu(null)}>
      <Toolbar
        style={activeCell?.s ?? {}}
        onStyle={setStyle}
        presets={documents?.filter((d) => d.type === 'damage-calculator').map((d) => d.title) ?? []}
        onInsertCalc={(name) => writeCells({ [activeKey]: { v: `=CALC("${name.replace(/"/g, '""')}")`, s: activeCell?.s } })}
        onChart={addChart}
        onExportCSV={() => void exportCSV()}
        onImportCSV={importCSV}
      />
      <div className="ss-bar">
        <span className="ss-namebox">{rangeName(range)}</span>
        <span className="ss-fx">fx</span>
        <input
          ref={barInput}
          className="ss-barinput"
          value={editing ? editing.text : (activeCell?.v ?? '')}
          onFocus={() => !editing && startEdit(activeCell?.v ?? '', true)}
          onChange={(e) => setEditing((ed) => ({ sheetId: ed?.sheetId ?? sheet.id, key: ed?.key ?? activeKey, text: e.target.value, bar: true, refAt: null }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit({ dc: 0, dr: 1 })
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
        />
      </div>
      <div className="ss-main">
        <div className="ss-corner" style={{ width: HEAD_W, height: HEAD_H }} onMouseDown={() => setSel({ anchor: { col: 0, row: 0 }, focus: { col: colsCount - 1, row: rowsCount - 1 } })} />
        <div className="ss-colhead" style={{ left: HEAD_W, height: HEAD_H }}>
          <div style={{ transform: `translateX(${-view.left}px)`, position: 'relative', height: '100%' }}>
            {[...new Set([...Array.from({ length: Math.min(fc, colsCount) }, (_, i) => i), ...Array.from({ length: c2 - c1 + 1 }, (_, i) => c1 + i)])].map((c) => (
              <div
                key={c}
                className={`ss-head${c >= range.c1 && c <= range.c2 ? ' on' : ''}${isWhole('col', c) ? ' whole' : ''}${c < fc ? ' frozen' : ''}`}
                style={{ left: c < fc ? colX(c) + view.left : colX(c), width: colW(c) }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  // The border between two columns resizes the left one, grabbed from either side.
                  const b = e.currentTarget.getBoundingClientRect()
                  const edge = e.clientX > b.right - 6 ? c : c > 0 && e.clientX < b.left + 4 ? c - 1 : -1
                  if (edge >= 0) {
                    e.stopPropagation()
                    setDrag({ kind: 'resize', axis: 'col', index: edge, from: e.clientX, size: colW(edge) })
                    return
                  }
                  if (editing && canInsertRef()) return insertRef(`${colName(c)}:${colName(c)}`)
                  if (editing) commit()
                  setSel(e.shiftKey ? { anchor: { col: sel.anchor.col, row: 0 }, focus: { col: c, row: rowsCount - 1 } } : { anchor: { col: c, row: 0 }, focus: { col: c, row: rowsCount - 1 } })
                  grid.current?.focus()
                }}
                onDoubleClick={(e) => {
                  if (e.clientX > e.currentTarget.getBoundingClientRect().right - 5) updateSheet((s) => {
                    const w = { ...s.colWidths }
                    delete w[c]
                    return { ...s, colWidths: w }
                  })
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (!isWhole('col', c)) setSel({ anchor: { col: c, row: 0 }, focus: { col: c, row: rowsCount - 1 } })
                  setMenu({ x: e.clientX, y: e.clientY, axis: 'col' })
                }}
              >
                {colName(c)}
              </div>
            ))}
          </div>
        </div>
        <div className="ss-rowhead" style={{ top: HEAD_H, width: HEAD_W }}>
          <div style={{ transform: `translateY(${-view.top}px)`, position: 'relative' }}>
            {[...new Set([...Array.from({ length: Math.min(fr, rowsCount) }, (_, i) => i), ...Array.from({ length: r2 - r1 + 1 }, (_, i) => r1 + i)])].map((r) => (
              <div
                key={r}
                className={`ss-head${r >= range.r1 && r <= range.r2 ? ' on' : ''}${isWhole('row', r) ? ' whole' : ''}${r < fr ? ' frozen' : ''}`}
                style={{ top: r < fr ? rowY(r) + view.top : rowY(r), height: rowH(r), width: HEAD_W }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  const b = e.currentTarget.getBoundingClientRect()
                  const edge = e.clientY > b.bottom - 5 ? r : r > 0 && e.clientY < b.top + 3 ? r - 1 : -1
                  if (edge >= 0) {
                    e.stopPropagation()
                    setDrag({ kind: 'resize', axis: 'row', index: edge, from: e.clientY, size: rowH(edge) })
                    return
                  }
                  if (editing && canInsertRef()) return insertRef(`${r + 1}:${r + 1}`)
                  if (editing) commit()
                  setSel(e.shiftKey ? { anchor: { col: 0, row: sel.anchor.row }, focus: { col: colsCount - 1, row: r } } : { anchor: { col: 0, row: r }, focus: { col: colsCount - 1, row: r } })
                  grid.current?.focus()
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (!isWhole('row', r)) setSel({ anchor: { col: 0, row: r }, focus: { col: colsCount - 1, row: r } })
                  setMenu({ x: e.clientX, y: e.clientY, axis: 'row' })
                }}
              >
                {r + 1}
              </div>
            ))}
          </div>
        </div>
        <div
          ref={grid}
          className="ss-gridwrap"
          style={{ left: HEAD_W, top: HEAD_H }}
          tabIndex={0}
          onKeyDown={onGridKey}
          onCopy={(e) => copy(e, false)}
          onCut={(e) => copy(e, true)}
          onPaste={paste}
        >
          <div
            ref={body}
            className="ss-body"
            onScroll={(e) => {
              const { scrollTop: top, scrollLeft: left } = e.currentTarget
              setView((v) => ({ ...v, top, left }))
            }}
            onMouseDown={onBodyDown}
            onDoubleClick={(e) => {
              if (drag?.kind === 'ref' || canInsertRef()) return
              const p = cellAt(e)
              setSel({ anchor: p, focus: p })
              startEdit(sheet.cells[addr(p.col, p.row)]?.v ?? '')
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              const p = cellAt(e)
              if (p.col < range.c1 || p.col > range.c2 || p.row < range.r1 || p.row > range.r2) setSel({ anchor: p, focus: p })
              setMenu({ x: e.clientX, y: e.clientY, axis: 'cell' })
            }}
            onDragOver={(e) => e.dataTransfer.types.includes(DRAG_MIME) && e.preventDefault()}
            onDrop={onDrop}
          >
            <div className="ss-canvas" style={{ width: colX(colsCount), height: rowY(rowsCount) }}>
              {renderLines(r1, r2, c1, c2)}
              {renderCells(r1, r2, c1, c2)}
              <div className="ss-sel" style={selRect} />
              <div className="ss-active" style={activeRect} />
              {(sheet.charts ?? []).map((c) => (
                <ChartBox
                  key={c.id}
                  chart={c}
                  data={chartData(chartGrid(c.range))}
                  onChange={(patch) => editChart(c.id, patch)}
                  onRemove={() => updateSheet((sh) => ({ ...sh, charts: (sh.charts ?? []).filter((o) => o.id !== c.id) }))}
                  onRename={() =>
                    void promptDialog('Chart title', c.title).then((t) => {
                      if (t !== null) editChart(c.id, { title: t.trim() })
                    })
                  }
                />
              ))}
              {previewRange && <div className="ss-fillpreview" style={rect(previewRange)} />}
              {!editing && (
                <div
                  className="ss-handle"
                  style={{ left: selRect.left + selRect.width - 4, top: selRect.top + selRect.height - 4 }}
                  title="Drag to fill"
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    setDrag({ kind: 'fill', to: sel.focus })
                  }}
                  onDoubleClick={(e) => {
                    // Double-click fills down as far as the column to the left goes, like Excel.
                    e.stopPropagation()
                    const leftCol = range.c1 - 1
                    let end = range.r2
                    while (leftCol >= 0 && sheet.cells[addr(leftCol, end + 1)]?.v) end++
                    if (end > range.r2) fill({ dir: 'down', count: end - range.r2 })
                  }}
                />
              )}
              {editing && !editing.bar && editing.sheetId === sheet.id && (
                <input
                  ref={editor}
                  className="ss-editor"
                  style={{ left: activeRect.left, top: activeRect.top, minWidth: activeRect.width, height: activeRect.height }}
                  value={editing.text}
                  size={Math.max(4, editing.text.length + 1)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => setEditing({ ...editing, text: e.target.value, refAt: null })}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    const moves: Record<string, [number, number]> = { Enter: [0, 1], Tab: [1, 0] }
                    if (moves[e.key]) {
                      e.preventDefault()
                      const [dc, dr] = moves[e.key]
                      commit(e.shiftKey ? { dc: -dc, dr: -dr } : { dc, dr })
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancel()
                    } else if (e.key.startsWith('Arrow') && !editing.text.startsWith('=') && editing.refAt === null && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                      e.preventDefault()
                      commit({ dc: 0, dr: e.key === 'ArrowUp' ? -1 : 1 })
                    }
                  }}
                />
              )}
            </div>
          </div>
          {fr > 0 && (
            <div className="ss-frozen ss-frozen-top" style={{ width: view.width, height: frozenH }}>
              <div style={{ transform: `translateX(${-view.left}px)` }}>
                {renderLines(0, fr - 1, c1, c2)}
                {renderCells(0, fr - 1, c1, c2)}
                <div className="ss-sel" style={selRect} />
                <div className="ss-active" style={activeRect} />
              </div>
            </div>
          )}
          {fc > 0 && (
            <div className="ss-frozen ss-frozen-left" style={{ width: frozenW, height: view.height }}>
              <div style={{ transform: `translateY(${-view.top}px)` }}>
                {renderLines(r1, r2, 0, fc - 1)}
                {renderCells(r1, r2, 0, fc - 1)}
                <div className="ss-sel" style={selRect} />
                <div className="ss-active" style={activeRect} />
              </div>
            </div>
          )}
          {fr > 0 && fc > 0 && (
            <div className="ss-frozen ss-frozen-corner" style={{ width: frozenW, height: frozenH }}>
              {renderLines(0, fr - 1, 0, fc - 1)}
              {renderCells(0, fr - 1, 0, fc - 1)}
              <div className="ss-sel" style={selRect} />
              <div className="ss-active" style={activeRect} />
            </div>
          )}
        </div>
      </div>

      {activeCell?.v.startsWith('=CALC(') && <CalcPanel formula={activeCell.v} onChange={(v) => writeCells({ [activeKey]: { v, s: activeCell.s } })} />}

      <div className="ss-footer">
        <div className="ss-tabs">
          {wb.sheets.map((s) => (
            <button
              key={s.id}
              className={`ss-tab${s.id === sheet.id ? ' on' : ''}`}
              onClick={() => switchSheet(s.id)}
              onDoubleClick={() => void renameSheet(s)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY - 70, axis: 'sheet', sheetId: s.id })
              }}
              title="Double-click to rename, right-click for more"
            >
              {s.name}
            </button>
          ))}
          <button className="ss-tab ss-addtab" title="New sheet" onClick={addSheet}>
            +
          </button>
        </div>
        {nums.length > 1 && (
          <div className="ss-status">
            Sum {nums.reduce((a, b) => a + b, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} · Average {(nums.reduce((a, b) => a + b, 0) / nums.length).toLocaleString(undefined, { maximumFractionDigits: 2 })} · Count {nums.length}
          </div>
        )}
      </div>

      {menu?.axis === 'sheet' && (
        <div className="ss-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {(() => {
            const s = wb.sheets.find((o) => o.id === menu.sheetId)
            if (!s) return null
            return (
              <>
                <button onClick={() => (setMenu(null), void renameSheet(s))}>Rename</button>
                <button onClick={() => (setMenu(null), moveSheet(s.id, -1))}>Move left</button>
                <button onClick={() => (setMenu(null), moveSheet(s.id, 1))}>Move right</button>
                <button disabled={wb.sheets.length === 1} onClick={() => (setMenu(null), void deleteSheet(s))}>
                  Delete
                </button>
              </>
            )
          })()}
        </div>
      )}
      {menu && menu.axis !== 'sheet' && (
        <div className="ss-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {menu.axis !== 'col' && (
            <>
              <button onClick={() => structure('row', range.r1, range.r2 - range.r1 + 1)}>Insert {range.r2 - range.r1 + 1 > 1 ? `${range.r2 - range.r1 + 1} rows` : 'row'} above</button>
              <button onClick={() => structure('row', range.r2 + 1, range.r2 - range.r1 + 1)}>Insert {range.r2 - range.r1 + 1 > 1 ? `${range.r2 - range.r1 + 1} rows` : 'row'} below</button>
              <button onClick={() => structure('row', range.r1, -(range.r2 - range.r1 + 1))}>Delete {range.r2 - range.r1 + 1 > 1 ? 'rows' : 'row'}</button>
            </>
          )}
          {menu.axis !== 'row' && (
            <>
              <button onClick={() => structure('col', range.c1, range.c2 - range.c1 + 1)}>Insert column left</button>
              <button onClick={() => structure('col', range.c2 + 1, range.c2 - range.c1 + 1)}>Insert column right</button>
              <button onClick={() => structure('col', range.c1, -(range.c2 - range.c1 + 1))}>Delete {range.c2 - range.c1 + 1 > 1 ? 'columns' : 'column'}</button>
            </>
          )}
          <button onClick={() => freeze({ rows: 1, cols: 0 })}>Freeze top row</button>
          <button onClick={() => freeze({ rows: 0, cols: 1 })}>Freeze first column</button>
          <button onClick={() => freeze({ rows: sel.anchor.row, cols: sel.anchor.col })}>Freeze above and left of {addr(sel.anchor.col, sel.anchor.row)}</button>
          {(fr > 0 || fc > 0) && <button onClick={() => freeze({ rows: 0, cols: 0 })}>Unfreeze</button>}
          <button onClick={() => (setMenu(null), addChart())}>Insert chart from selection</button>
          <button onClick={() => sortRange(true)}>Sort A → Z</button>
          <button onClick={() => sortRange(false)}>Sort Z → A</button>
          <button onClick={clearRange}>Clear contents and formatting</button>
        </div>
      )}
    </div>
  )

  function addChart() {
    const r = range.r1 === range.r2 && range.c1 === range.c2 ? { ...range, r2: Math.max(range.r1, used.rows - 1), c2: Math.max(range.c1, used.cols - 1) } : range
    const x = colX(r.c2 + 1) + 16
    const y = rowY(r.r1)
    updateSheet((sh) => ({ ...sh, charts: [...(sh.charts ?? []), { id: newId(), range: rangeName(r), type: 'bar', title: '', x, y, w: 420, h: 260 }] }))
  }
  function chartGrid(ref: string) {
    const r = parseRange(ref)
    if (!r) return []
    const out: unknown[][] = []
    for (let row = r.r1; row <= r.r2; row++) {
      const line: unknown[] = []
      for (let c = r.c1; c <= r.c2; c++) line.push(engine.shown(sheet.id, c, row).value)
      out.push(line)
    }
    return out
  }
  function editChart(id: Id, patch: Partial<NonNullable<Sheet['charts']>[number]>) {
    updateSheet((sh) => ({ ...sh, charts: (sh.charts ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
  }

  async function exportCSV() {
    const lines: string[][] = []
    for (let r = 0; r < used.rows; r++) {
      const line: string[] = []
      for (let c = 0; c < used.cols; c++) line.push(shownText(c, r))
      lines.push(line)
    }
    await saveTextFile({ title: 'Export sheet as CSV', defaultName: `${safeFileName(sheet.name)}.csv`, text: toCSV(lines), filter: { name: 'CSV', extensions: ['csv'] } })
  }
  function importCSV(text: string, fileName: string) {
    const rows = parseCSV(text)
    update((w) => {
      const base = fileName.replace(/\.[^.]+$/, '') || 'Import'
      let name = base
      for (let n = 2; w.sheets.some((s) => s.name.toLowerCase() === name.toLowerCase()); n++) name = `${base} ${n}`
      const sh = newSheet(name)
      rows.forEach((line, r) => line.forEach((v, c) => v !== '' && (sh.cells[addr(c, r)] = { v })))
      return { ...w, sheets: [...w.sheets, sh], activeSheetId: sh.id }
    })
    setSel({ anchor: { col: 0, row: 0 }, focus: { col: 0, row: 0 } })
  }

  function freeze(f: { rows: number; cols: number }) {
    setMenu(null)
    updateSheet((sh) => ({ ...sh, freeze: f.rows || f.cols ? f : undefined }))
    body.current?.scrollTo(0, 0)
  }

  /** Sort the selected rows by the selection's first column (values, not formulas). */
  function sortRange(asc: boolean) {
    setMenu(null)
    const r = { ...range, r2: Math.min(range.r2, Math.max(range.r1, used.rows - 1)), c2: Math.min(range.c2, Math.max(range.c1, used.cols - 1)) }
    const rowsData = []
    for (let row = r.r1; row <= r.r2; row++) {
      const key = engine.shown(sheet.id, r.c1, row).value
      const cells = []
      for (let c = r.c1; c <= r.c2; c++) cells.push(sheet.cells[addr(c, row)])
      rowsData.push({ key, cells, row })
    }
    const val = (v: unknown) => (v === null || v === undefined || v === '' ? null : v)
    rowsData.sort((a, b) => {
      const x = val(a.key)
      const y = val(b.key)
      if (x === null) return y === null ? 0 : 1
      if (y === null) return -1
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
      return asc ? cmp : -cmp
    })
    const changes: Record<string, Partial<Cell> | null> = {}
    rowsData.forEach((d, i) =>
      d.cells.forEach((cell, ci) => {
        const target = r.r1 + i
        changes[addr(r.c1 + ci, target)] = cell ? { v: shiftFormula(cell.v, 0, target - d.row), s: cell.s } : null
      }),
    )
    writeCells(changes)
  }
}

/** Keep CALC() up to date with the project's Damage Calculator presets. */
function useCalcPresets(engine: Engine, active: boolean, done: () => void) {
  const root = useProjectStore((s) => s.root)
  const docs = useProjectStore((s) => s.meta?.documents)
  const doneRef = useRef(done)
  useEffect(() => {
    doneRef.current = done
  })
  useEffect(() => {
    if (!root || !docs) return
    let stale = false
    const presets = docs.filter((d) => d.type === 'damage-calculator')
    void Promise.all(presets.map(async (d) => ({ name: d.title, ...damagePresetFormula(await loadDocumentNow<DamagePresetDoc>(root, 'damage-calculator', d.id, createDamagePresetDoc)) }))).then((list) => {
      if (stale) return
      setCalcPresets(list)
      engine.recalc()
      doneRef.current()
    })
    return () => {
      stale = true
    }
  }, [root, docs, active, engine])
}

