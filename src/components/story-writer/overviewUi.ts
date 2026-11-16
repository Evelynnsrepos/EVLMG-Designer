import type { StoryProblem, storyStats } from './model'

export const OVERVIEW_UI = {
  heading: 'Story',
  close: 'Close panel',
  stats: (s: ReturnType<typeof storyStats>) => [`${s.nodes} ${s.nodes === 1 ? 'node' : 'nodes'}`, `${s.choices} ${s.choices === 1 ? 'choice point' : 'choice points'}`, `${s.endings} ${s.endings === 1 ? 'ending' : 'endings'}`, `${s.words} words`],
  play: 'Play through',
  playHint: 'Read the story like a player and click the choices (P)',
  tidy: 'Tidy up',
  tidyHint: 'Lay the story out left to right, one column per step (undo with Ctrl+Z)',
  twine: 'Export for Twine',
  twineHint: 'Save a .twee file that Twine and other story engines open',
  check: 'Story check',
  allGood: 'Every line ends in an ending and every node can be reached.',
  problem: { 'dead-end': 'Stops here, but is not marked as an ending', unreachable: 'No path leads here from the start', untitled: 'Has no title' } as Record<StoryProblem['kind'], string>,
  tips: 'Tips',
  tipList: [
    'Click empty space with Create (C) to add a scene after the highlighted one.',
    'Select a node and press + Add next to continue or branch.',
    'Click an older node with Create to branch from it.',
    'Mark the start and the endings in a node’s details.',
  ],
}
