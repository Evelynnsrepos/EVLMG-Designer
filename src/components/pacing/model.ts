import { newId, type Id } from '@/core/model'

/** Pacing / player journey (v0.10): beats along the game with intensity and other curves. */

export const BEAT_KINDS = ['Story', 'Combat', 'Exploration', 'Puzzle', 'Boss', 'Rest', 'Reward', 'Cutscene'] as const
export type BeatKind = (typeof BEAT_KINDS)[number]

export interface Curve {
  id: Id
  name: string
  color: string
}

export interface Beat {
  id: Id
  name: string
  kind: BeatKind
  /** Minutes into the game (or any unit you like). */
  at: number
  /** 0–10 per curve. */
  values: Record<Id, number>
  emotion: string
  notes: string
}

export interface PacingDoc {
  curves: Curve[]
  beats: Beat[]
  unit: string
  /** 0.35: hide what playtesters felt (from the Playtests tool) on this graph. */
  hideTests?: boolean
}

export function createPacingDoc(): PacingDoc {
  const intensity: Curve = { id: newId(), name: 'Intensity', color: '#e03131' }
  const story: Curve = { id: newId(), name: 'Story stakes', color: '#9c36b5' }
  const b = (name: string, kind: BeatKind, at: number, i: number, s: number, emotion: string): Beat => ({ id: newId(), name, kind, at, values: { [intensity.id]: i, [story.id]: s }, emotion, notes: '' })
  return {
    curves: [intensity, story],
    beats: [
      b('Opening', 'Cutscene', 0, 4, 3, 'Curious'),
      b('Tutorial fight', 'Combat', 10, 5, 2, 'Confident'),
      b('First town', 'Rest', 20, 2, 3, 'Safe'),
      b('The ambush', 'Combat', 35, 8, 6, 'Shocked'),
      b('First boss', 'Boss', 50, 9, 7, 'Triumphant'),
    ],
    unit: 'min',
  }
}

export const newBeat = (at: number, curves: Curve[]): Beat => ({ id: newId(), name: 'New beat', kind: 'Story', at, values: Object.fromEntries(curves.map((c) => [c.id, 5])), emotion: '', notes: '' })

/** Advice from the shape of a curve: long flat stretches and peaks without a breather. */
export function pacingNotes(beats: Beat[], curve: Curve): string[] {
  const list = [...beats].sort((a, b) => a.at - b.at)
  const v = (b: Beat) => b.values[curve.id] ?? 0
  const notes: string[] = []
  for (let i = 2; i < list.length; i++) {
    if (Math.abs(v(list[i]) - v(list[i - 1])) <= 0.5 && Math.abs(v(list[i - 1]) - v(list[i - 2])) <= 0.5) {
      notes.push(`${curve.name} stays flat from "${list[i - 2].name}" to "${list[i].name}"; players may get bored.`)
      i++
    }
  }
  for (let i = 1; i < list.length; i++) {
    if (v(list[i - 1]) >= 8 && v(list[i]) >= 8) notes.push(`"${list[i - 1].name}" and "${list[i].name}" are both very high ${curve.name.toLowerCase()} with no breather between.`)
  }
  return notes
}
