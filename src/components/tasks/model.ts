import { newId, type Id } from '@/core/model'
import { toCSV } from '@/shared/csv'

/** Task board data (v0.10; milestones, estimates and blockers 0.28). */

export const COLUMNS = [
  { id: 'todo', title: 'To do', color: '#9aa0a6' },
  { id: 'doing', title: 'Doing', color: '#3e8ef7' },
  { id: 'review', title: 'Review', color: '#f08c00' },
  { id: 'done', title: 'Done', color: '#2f9e44' },
]
export const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'] as const

export interface TaskLink {
  kind: string
  id: Id
}

export interface Task {
  id: Id
  title: string
  notes: string
  column: string
  assignee: string
  due: string
  priority: (typeof PRIORITIES)[number]
  links: TaskLink[]
  image?: string | null
  categoryIds?: Id[]
  /** 0.28: hours of work it should take. */
  estimate?: number | null
  /** 0.28: tasks that must be done first. */
  blockedBy?: Id[]
  /** 0.28: the milestone it belongs to. */
  milestone?: Id | null
}

export interface Column {
  id: string
  title: string
  color: string
}

export interface TaskCategory {
  id: Id
  name: string
  color: string
}

export interface Milestone {
  id: Id
  name: string
  /** YYYY-MM-DD, or empty. */
  date: string
}

export interface TasksDoc {
  items: Task[]
  /** Your own columns; the four defaults until changed. */
  columns?: Column[]
  /** Your own categories, like Art, Code, Sound (v0.10). */
  categories?: TaskCategory[]
  /** 0.28: Alpha, Beta, Launch… */
  milestones?: Milestone[]
}

export const createTasksDoc = (): TasksDoc => ({ items: [] })
export const newTask = (column: string): Task => ({ id: newId(), title: 'New task', notes: '', column, assignee: '', due: '', priority: 'Normal', links: [] })

const doneColumn = (d: TasksDoc) => (d.columns?.length ? d.columns : COLUMNS).at(-1)!.id

/** Blockers of a task that are not done yet. */
export function openBlockers(d: TasksDoc, t: Task): Task[] {
  const done = doneColumn(d)
  return (t.blockedBy ?? []).flatMap((id) => d.items.filter((x) => x.id === id && x.column !== done))
}

/** Per milestone: tasks, how many are done, and the estimated hours still open. */
export function milestoneProgress(d: TasksDoc): { milestone: Milestone; total: number; done: number; hoursLeft: number; late: boolean }[] {
  const done = doneColumn(d)
  const today = new Date().toISOString().slice(0, 10)
  return (d.milestones ?? []).map((m) => {
    const tasks = d.items.filter((t) => t.milestone === m.id)
    const open = tasks.filter((t) => t.column !== done)
    return { milestone: m, total: tasks.length, done: tasks.length - open.length, hoursLeft: open.reduce((a, t) => a + (t.estimate ?? 0), 0), late: !!m.date && m.date < today && open.length > 0 }
  })
}

/**
 * The board as CSV with the column names Jira's and Linear's CSV import know (Summary, Description, Status,
 * Assignee, Due date, Priority, Labels, Original estimate in hours, Fix version for the milestone, Blocked by).
 */
export function tasksCSV(d: TasksDoc): string {
  const columns = d.columns?.length ? d.columns : COLUMNS
  const title = (id: Id) => d.items.find((t) => t.id === id)?.title ?? ''
  return toCSV([
    ['Summary', 'Description', 'Status', 'Assignee', 'Due date', 'Priority', 'Labels', 'Original estimate', 'Fix version', 'Blocked by'],
    ...d.items.map((t) => [
      t.title,
      t.notes,
      columns.find((c) => c.id === t.column)?.title ?? '',
      t.assignee,
      t.due,
      t.priority === 'Urgent' ? 'Highest' : t.priority === 'Normal' ? 'Medium' : t.priority,
      (t.categoryIds ?? []).map((id) => d.categories?.find((c) => c.id === id)?.name.replace(/\s+/g, '_') ?? '').filter(Boolean).join(' '),
      t.estimate ? `${t.estimate}h` : '',
      d.milestones?.find((m) => m.id === t.milestone)?.name ?? '',
      (t.blockedBy ?? []).map(title).filter(Boolean).join('; '),
    ]),
  ])
}
