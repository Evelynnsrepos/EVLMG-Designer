import { CalendarRange, ExternalLink, Moon, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { PanelProps } from '@/core/registry'
import { useProjectStore, useUndoRedoKeys } from '@/core/state'
import { NumberInput } from '@/shared/calculators'
import {
  DAY_KINDS,
  dateNumber,
  dayKindColor,
  entriesOn,
  formatDate,
  formatYear,
  fromDayNumber,
  gameDay,
  isFullMoon,
  newDayEntry,
  newEra,
  nextDeadline,
  realMonths,
  REAL_WEEKDAYS,
  toDayNumber,
  useCalendar,
  weekdayOf,
  yearLength,
  type CalendarDate,
  type CalendarDoc,
  type DayEntry,
  type DayKind,
  type Era,
  type Month,
} from '@/shared/calendar'
import { newId } from '@/core/model'
import { confirmDialog } from '@/shared/dialogs'
import { openComponent } from '@/shell/editor/actions'
import '@/shared/listDetail/listDetail.css'
import './calendar.css'

/** Custom calendars and eras (v0.10). */
export default function View({ active }: PanelProps) {
  const doc = useCalendar()
  useUndoRedoKeys(doc, active)
  const [year, setYear] = useState(1)
  const [month, setMonth] = useState(0)
  const [calc, setCalc] = useState({ y: 1, m: 0, d: 1, add: 100 })
  const [picked, setPicked] = useState<number | null>(null)
  const [entryId, setEntryId] = useState<string | null>(null)
  const documents = useProjectStore((s) => s.meta?.documents ?? [])
  if (!doc.data) return null
  const c = doc.data
  const entries = c.entries ?? []
  const slots = c.timeSlots ?? []
  const editEntry = (id: string, patch: Partial<DayEntry>) => set({ entries: entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
  const addEntry = (date: CalendarDate) => {
    const e = newDayEntry(date)
    set({ entries: [...entries, e] })
    setEntryId(e.id)
  }
  const linked = (c.linkedTimelines ?? []).filter((id) => documents.some((d) => d.id === id))
  const makeTimeline = () => {
    const t = useProjectStore.getState().addDocument('timeline', 'Calendar timeline')
    set({ linkedTimelines: [...linked, t.id] })
    openComponent('timeline', t.id)
  }
  const applyRealCalendar = async () => {
    if (c.months.length && !(await confirmDialog({ title: 'Use real months and weekdays?', message: 'Your months and weekdays are replaced with January to December and Monday to Sunday. Entries keep their month number. You can undo with Ctrl+Z.', confirmLabel: 'Replace' }))) return
    set({ months: realMonths(), weekdays: REAL_WEEKDAYS })
  }
  const set = (patch: Partial<CalendarDoc>) => doc.update((x) => ({ ...x, ...patch }))
  const editMonth = (id: string, patch: Partial<Month>) => set({ months: c.months.map((m) => (m.id === id ? { ...m, ...patch } : m)) })
  const editEra = (id: string, patch: Partial<Era>) => set({ eras: c.eras.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
  const m = Math.min(month, c.months.length - 1)
  const first = c.months.length ? toDayNumber(c, year, m, 1) : 0
  const lead = weekdayOf(c, first)
  const days = c.months[m]?.days ?? 0
  const later = c.months.length ? fromDayNumber(c, toDayNumber(c, calc.y, Math.min(calc.m, c.months.length - 1), calc.d) + calc.add) : null
  const eras = [...c.eras].sort((a, b) => a.start - b.start)

  return (
    <div className="cal">
      <section className="cal-col">
        <h3>Months</h3>
        {c.months.map((mo) => (
          <div key={mo.id} className="ld-inline">
            <input className="input" value={mo.name} onChange={(e) => editMonth(mo.id, { name: e.target.value })} />
            <NumberInput value={mo.days} min={1} max={400} onChange={(v) => editMonth(mo.id, { days: Math.max(1, Math.round(v)) })} />
            <span className="muted">days</span>
            <button className="icon-btn" aria-label="Remove month" onClick={() => set({ months: c.months.filter((x) => x.id !== mo.id) })}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost cal-add" onClick={() => set({ months: [...c.months, { id: newId(), name: 'New month', days: 30 }] })}>
          <Plus size={14} /> Add month
        </button>
        <p className="muted">
          A year has {c.months.length} months and {yearLength(c)} days.
        </p>
        <h3>Weekdays</h3>
        <input className="input" value={c.weekdays.join(', ')} onChange={(e) => set({ weekdays: e.target.value.split(',').map((w) => w.trim()).filter(Boolean) })} />
        <label className="ld-field">
          <span>Year 1 starts on</span>
          <select className="input" value={c.firstWeekday} onChange={(e) => set({ firstWeekday: Number(e.target.value) })}>
            {c.weekdays.map((w, i) => (
              <option key={i} value={i}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="cal-col">
        <h3>Eras</h3>
        <p className="muted">Named ages. Each era counts its own years from 1, starting at an absolute year on your timelines.</p>
        {eras.map((e) => (
          <div key={e.id} className="cal-era">
            <input type="color" value={e.color} onChange={(ev) => editEra(e.id, { color: ev.target.value })} aria-label="Color" />
            <input className="input" value={e.name} onChange={(ev) => editEra(e.id, { name: ev.target.value })} aria-label="Era name" />
            <input className="input cal-abbr" value={e.abbr} onChange={(ev) => editEra(e.id, { abbr: ev.target.value })} aria-label="Short form" />
            <span className="muted">from year</span>
            <NumberInput value={e.start} onChange={(v) => editEra(e.id, { start: Math.round(v) })} />
            <button className="icon-btn" aria-label="Remove era" onClick={() => set({ eras: c.eras.filter((x) => x.id !== e.id) })}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost cal-add" onClick={() => set({ eras: [...c.eras, newEra(eras.length ? eras[eras.length - 1].start + 1000 : 1)] })}>
          <Plus size={14} /> Add era
        </button>
        {eras.length > 0 && (
          <div className="cal-bar">
            {eras.map((e, i) => (
              <div key={e.id} style={{ background: e.color, flex: i < eras.length - 1 ? eras[i + 1].start - e.start : 300 }} title={`${e.name}: from ${e.start}`}>
                {e.abbr}
              </div>
            ))}
          </div>
        )}
        <label className="ld-inline">
          <input type="checkbox" checked={c.useOnTimeline} onChange={(e) => set({ useOnTimeline: e.target.checked })} /> Show era years on timelines
        </label>
      </section>

      <section className="cal-col">
        <h3>Month view</h3>
        <div className="ld-inline">
          <select className="input" value={m} onChange={(e) => setMonth(Number(e.target.value))}>
            {c.months.map((mo, i) => (
              <option key={mo.id} value={i}>
                {mo.name}
              </option>
            ))}
          </select>
          <span>year</span>
          <NumberInput value={year} min={1} onChange={(v) => setYear(Math.max(1, Math.round(v)))} />
          <span className="muted">{formatYear(c, year)}</span>
        </div>
        <div className="cal-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, c.weekdays.length)}, 1fr)` }}>
          {c.weekdays.map((w) => (
            <div key={w} className="cal-wd">
              {w.slice(0, 3)}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`e${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const n = first + i
            const list = entriesOn(c, n)
            const inGame = !c.gameStart || !!gameDay(c, n)
            return (
              <button
                key={i}
                className={`cal-day${picked === n ? ' on' : ''}${inGame ? '' : ' out'}`}
                onClick={() => {
                  setPicked(n)
                  setEntryId(null)
                }}
                title={list.map((e) => e.title).join(', ') || undefined}
              >
                <span>
                  {i + 1}
                  {isFullMoon(c, n) && <Moon size={10} aria-label="Full moon" className="cal-moon" />}
                </span>
                <span className="cal-dots">
                  {list.slice(0, 4).map((e) => (
                    <i key={e.id} style={{ background: dayKindColor(e.kind) }} />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
        {picked !== null && <DayPanel c={c} n={picked} slots={slots} entryId={entryId} setEntryId={setEntryId} onAdd={addEntry} onEdit={editEntry} onRemove={(id) => set({ entries: entries.filter((e) => e.id !== id) })} />}
      </section>

      <section className="cal-col">
        <h3>Calendar game</h3>
        <p className="muted">For games that run day by day, like a school year: when the game starts and ends, the parts of each day, and a moon cycle.</p>
        <button className="btn btn-ghost cal-add" onClick={() => void applyRealCalendar()}>
          <CalendarRange size={14} /> Use real months and weekdays
        </button>
        <DateField label="Game starts" c={c} value={c.gameStart ?? null} onChange={(gameStart) => set({ gameStart })} />
        <DateField label="Game ends" c={c} value={c.gameEnd ?? null} onChange={(gameEnd) => set({ gameEnd })} />
        {c.gameStart && c.gameEnd && <p className="muted">The game lasts {dateNumber(c, c.gameEnd) - dateNumber(c, c.gameStart) + 1} days.</p>}
        <label className="ld-field">
          <span>Parts of a day (comma between)</span>
          <input className="input" value={slots.join(', ')} placeholder="Morning, After school, Evening" onChange={(e) => set({ timeSlots: e.target.value.split(',').map((w) => w.trim()).filter(Boolean) })} />
        </label>
        <div className="ld-inline">
          <span>Full moon every</span>
          <NumberInput value={c.moonCycle ?? 0} min={0} onChange={(v) => set({ moonCycle: Math.max(0, Math.round(v)) })} />
          <span className="muted">days (0 = off)</span>
        </div>
        {!!c.moonCycle && picked !== null && (
          <button className="btn btn-ghost cal-add" onClick={() => set({ fullMoonDay: picked })}>
            <Moon size={14} /> The picked day is a full moon
          </button>
        )}
        <h3>Timelines</h3>
        <p className="muted">A linked timeline shows the entries as events and follows every change you make here.</p>
        {linked.map((id) => (
          <div key={id} className="ld-inline">
            <button className="btn btn-ghost" onClick={() => openComponent('timeline', id)}>
              <ExternalLink size={14} /> {documents.find((d) => d.id === id)?.title ?? 'Timeline'}
            </button>
            <button className="icon-btn" aria-label="Stop following" title="Stop following the calendar" onClick={() => set({ linkedTimelines: linked.filter((x) => x !== id) })}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="btn btn-ghost cal-add" onClick={makeTimeline}>
          <Plus size={14} /> Make a linked timeline
        </button>
        <h3>Date calculator</h3>
        <div className="ld-inline">
          Day
          <NumberInput value={calc.d} min={1} onChange={(v) => setCalc({ ...calc, d: Math.max(1, Math.round(v)) })} />
          of
          <select className="input" value={calc.m} onChange={(e) => setCalc({ ...calc, m: Number(e.target.value) })}>
            {c.months.map((mo, i) => (
              <option key={mo.id} value={i}>
                {mo.name}
              </option>
            ))}
          </select>
          year
          <NumberInput value={calc.y} min={1} onChange={(v) => setCalc({ ...calc, y: Math.max(1, Math.round(v)) })} />
        </div>
        <div className="ld-inline">
          plus
          <NumberInput value={calc.add} onChange={(v) => setCalc({ ...calc, add: Math.round(v) })} />
          days is
        </div>
        {later && (
          <p className="cal-result">
            {c.weekdays[weekdayOf(c, toDayNumber(c, later.year, later.month, later.day))]}, {later.day} {c.months[later.month]?.name}, year {formatYear(c, later.year)}
          </p>
        )}
      </section>
    </div>
  )
}

function DateField({ label, c, value, onChange }: { label: string; c: CalendarDoc; value: CalendarDate | null; onChange(v: CalendarDate | null): void }) {
  if (!value)
    return (
      <div className="ld-inline">
        <span>{label}</span>
        <button className="btn btn-ghost" onClick={() => onChange({ year: 1, month: 0, day: 1 })}>
          Set
        </button>
      </div>
    )
  return (
    <div className="ld-inline">
      <span>{label}</span>
      <NumberInput value={value.day} min={1} max={c.months[value.month]?.days ?? 31} onChange={(v) => onChange({ ...value, day: Math.max(1, Math.round(v)) })} />
      <select className="input" value={value.month} onChange={(e) => onChange({ ...value, month: Number(e.target.value) })} aria-label="Month">
        {c.months.map((mo, i) => (
          <option key={mo.id} value={i}>
            {mo.name}
          </option>
        ))}
      </select>
      <NumberInput value={value.year} min={1} onChange={(v) => onChange({ ...value, year: Math.max(1, Math.round(v)) })} />
      <button className="icon-btn" aria-label={`Clear ${label}`} onClick={() => onChange(null)}>
        <X size={13} />
      </button>
    </div>
  )
}

/** The picked day: what happens in each part of it, plus the next deadline. */
function DayPanel({
  c,
  n,
  slots,
  entryId,
  setEntryId,
  onAdd,
  onEdit,
  onRemove,
}: {
  c: CalendarDoc
  n: number
  slots: string[]
  entryId: string | null
  setEntryId(id: string | null): void
  onAdd(d: CalendarDate): void
  onEdit(id: string, p: Partial<DayEntry>): void
  onRemove(id: string): void
}) {
  const date = fromDayNumber(c, n)
  const list = entriesOn(c, n)
  const gd = gameDay(c, n)
  const dl = nextDeadline(c, n)
  const e = list.find((x) => x.id === entryId)
  return (
    <div className="cal-daypanel">
      <strong>
        {c.weekdays[weekdayOf(c, n)]}, {formatDate(c, date)}
      </strong>
      <span className="muted">
        {gd && `Day ${gd.day}${gd.of ? ` of ${gd.of}` : ''}`}
        {gd && dl && ' · '}
        {dl && (dl.daysLeft === 0 ? `Deadline today: ${dl.entry.title}` : `${dl.daysLeft} days left: ${dl.entry.title}`)}
      </span>
      {list.map((x) => (
        <button key={x.id} className={`cal-entry${x.id === entryId ? ' on' : ''}`} style={{ borderLeftColor: dayKindColor(x.kind) }} onClick={() => setEntryId(x.id === entryId ? null : x.id)}>
          <span className="muted">{x.slot !== undefined && x.slot >= 0 ? slots[x.slot] ?? '?' : 'All day'}</span> {x.title}
          {x.repeat && x.repeat !== 'none' && <span className="muted"> · {x.repeat === 'weekly' ? 'every week' : 'every year'}</span>}
        </button>
      ))}
      <button className="btn btn-ghost cal-add" onClick={() => onAdd(date)}>
        <Plus size={14} /> Add to this day
      </button>
      {e && (
        <div className="cal-entry-edit">
          <input className="input" value={e.title} onChange={(ev) => onEdit(e.id, { title: ev.target.value })} aria-label="Title" autoFocus />
          <div className="ld-inline">
            <select className="input" value={e.kind} onChange={(ev) => onEdit(e.id, { kind: ev.target.value as DayKind })} aria-label="Type">
              {DAY_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <select className="input" value={e.slot ?? -1} onChange={(ev) => onEdit(e.id, { slot: Number(ev.target.value) })} aria-label="Part of the day">
              <option value={-1}>All day</option>
              {slots.map((sl, i) => (
                <option key={i} value={i}>
                  {sl}
                </option>
              ))}
            </select>
            <select className="input" value={e.repeat ?? 'none'} onChange={(ev) => onEdit(e.id, { repeat: ev.target.value as DayEntry['repeat'] })} aria-label="Repeats">
              <option value="none">Once</option>
              <option value="weekly">Every week</option>
              <option value="yearly">Every year</option>
            </select>
          </div>
          <textarea className="input" rows={2} placeholder="Notes" value={e.notes ?? ''} onChange={(ev) => onEdit(e.id, { notes: ev.target.value })} />
          <label className="ld-inline">
            <input type="checkbox" checked={e.onTimeline !== false} onChange={(ev) => onEdit(e.id, { onTimeline: ev.target.checked })} /> Show on linked timelines
          </label>
          <button
            className="btn btn-danger cal-add"
            onClick={() => {
              onRemove(e.id)
              setEntryId(null)
            }}
          >
            <Trash2 size={14} /> Delete entry
          </button>
        </div>
      )}
    </div>
  )
}
