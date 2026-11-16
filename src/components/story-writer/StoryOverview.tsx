import { AlertTriangle, CheckCircle2, Download, LayoutGrid, Play, X } from 'lucide-react'
import type { Id } from '@/core/model'
import type { Scene } from '@/shared/canvas'
import { storyNodes, storyProblems, storyStats, type StoryItem, type StoryProblem } from './model'
import { STORY_NODE_UI } from './storyNodeType'

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

/** The side panel when no node is selected: numbers, actions and the story check (v0.33). */
export function StoryOverview({ scene, onGoTo, onPlay, onTidy, onTwine, onClose }: { scene: Scene<StoryItem>; onGoTo(id: Id): void; onPlay(): void; onTidy(): void; onTwine(): void; onClose(): void }) {
  const stats = storyStats(scene)
  const problems = storyProblems(scene)
  const titleOf = (id: Id) => storyNodes(scene).find((n) => n.id === id)?.title || STORY_NODE_UI.untitled
  return (
    <aside className="story-details" aria-label={OVERVIEW_UI.heading} onKeyDown={(e) => e.stopPropagation()}>
      <header className="story-details-head">
        <span>{OVERVIEW_UI.heading}</span>
        <button className="icon-btn" title={OVERVIEW_UI.close} aria-label={OVERVIEW_UI.close} onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="story-stats">
        {OVERVIEW_UI.stats(stats).map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className="story-actions">
        <button className="btn btn-primary" title={OVERVIEW_UI.playHint} disabled={!stats.nodes} onClick={onPlay}>
          <Play size={14} /> {OVERVIEW_UI.play}
        </button>
        <button className="btn" title={OVERVIEW_UI.tidyHint} disabled={stats.nodes < 2} onClick={onTidy}>
          <LayoutGrid size={14} /> {OVERVIEW_UI.tidy}
        </button>
        <button className="btn" title={OVERVIEW_UI.twineHint} disabled={!stats.nodes} onClick={onTwine}>
          <Download size={14} /> {OVERVIEW_UI.twine}
        </button>
      </div>
      {stats.nodes > 0 && (
        <div className="story-field">
          <span>{OVERVIEW_UI.check}</span>
          {problems.length === 0 ? (
            <p className="story-note story-ok">
              <CheckCircle2 size={14} /> {OVERVIEW_UI.allGood}
            </p>
          ) : (
            <ul className="story-problems">
              {problems.map((p) => (
                <li key={p.kind + p.id}>
                  <button onClick={() => onGoTo(p.id)}>
                    <AlertTriangle size={13} />
                    <span>
                      <b>{titleOf(p.id)}</b>
                      <small>{OVERVIEW_UI.problem[p.kind]}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="story-field">
        <span>{OVERVIEW_UI.tips}</span>
        <ul className="story-tips">
          {OVERVIEW_UI.tipList.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
