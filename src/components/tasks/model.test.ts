import { describe, expect, it } from 'vitest'
import { milestoneProgress, newTask, openBlockers, tasksCSV, type TasksDoc } from './model'

describe('task board (0.28)', () => {
  const a = { ...newTask('todo'), title: 'Model the sword', estimate: 4, milestone: 'm1', assignee: 'Eve', priority: 'Urgent' as const, categoryIds: ['c'] }
  const b = { ...newTask('done'), title: 'Concept', estimate: 2, milestone: 'm1' }
  const c = { ...newTask('todo'), title: 'Rig', blockedBy: [a.id, b.id] }
  const d: TasksDoc = { items: [a, b, c], milestones: [{ id: 'm1', name: 'Alpha', date: '2000-01-01' }], categories: [{ id: 'c', name: 'Art', color: '#000' }] }

  it('knows open blockers and milestone progress', () => {
    expect(openBlockers(d, c).map((t) => t.title)).toEqual(['Model the sword'])
    expect(milestoneProgress(d)[0]).toMatchObject({ total: 2, done: 1, hoursLeft: 4, late: true })
  })

  it('exports CSV with Jira and Linear column names', () => {
    const lines = tasksCSV(d).split('\r\n')
    expect(lines[0]).toBe('Summary,Description,Status,Assignee,Due date,Priority,Labels,Original estimate,Fix version,Blocked by')
    expect(lines[1]).toBe('Model the sword,,To do,Eve,,Highest,Art,4h,Alpha,')
    expect(lines[3]).toContain('Model the sword; Concept')
  })
})
