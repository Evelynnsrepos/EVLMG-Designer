import { describe, expect, it } from 'vitest'
import type { RemotePresence } from '@/core/collab'
import { holderOf } from './drawLock'

const remote = (clientId: number, name: string, drawing: RemotePresence['drawing']): RemotePresence => ({
  clientId, id: name, name, color: '#f0f', location: null, pointer: null, selection: null, drawing, drawRequest: null,
})
const hold = (key: string, since: number) => ({ key, since, lastStroke: since })

describe('one artist at a time', () => {
  it('gives the drawing to whoever held it first', () => {
    const remotes = [remote(5, 'Mia', hold('sketch/a', 100)), remote(7, 'Jo', hold('sketch/b', 50))]
    expect(holderOf('sketch/a', { clientId: 1, hold: hold('sketch/a', 200) }, remotes)?.name).toBe('Mia')
    expect(holderOf('sketch/a', { clientId: 1, hold: hold('sketch/a', 90) }, remotes)?.clientId).toBe(1)
    expect(holderOf('sketch/c', { clientId: 1, hold: null }, remotes)).toBeNull()
  })

  it('breaks a tie by the lower id, so both devices agree', () => {
    const remotes = [remote(9, 'Mia', hold('sketch/a', 100))]
    expect(holderOf('sketch/a', { clientId: 3, hold: hold('sketch/a', 100) }, remotes)?.clientId).toBe(3)
  })
})
