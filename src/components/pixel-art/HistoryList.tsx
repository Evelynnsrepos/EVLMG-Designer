import type { PixelDoc } from '@/shared/pixel/model'
import { stepLabel } from './docOps'

/** Every undo step as a list: click one to go back (or forward) to right after it. */
export function HistoryList({ past, future, current, undo, redo }: { past: readonly PixelDoc[]; future: readonly PixelDoc[]; current: PixelDoc; undo(): void; redo(): void }) {
  const states = [...past, current, ...[...future].reverse()]
  const at = past.length
  const go = (i: number) => {
    for (let n = at; n > i; n--) undo()
    for (let n = at; n < i; n++) redo()
  }
  return (
    <div className="px-panel">
      <strong>Undo history</strong>
      <div className="px-history">
        <button className={`px-history-step${at === 0 ? ' on' : ''}`} onClick={() => go(0)}>
          {past.length >= 100 ? 'Oldest kept step' : 'Start'}
        </button>
        {states.slice(1).map((s, i) => (
          <button key={i} ref={at === i + 1 ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined} className={`px-history-step${at === i + 1 ? ' on' : ''}${i + 1 > at ? ' redo' : ''}`} onClick={() => go(i + 1)}>
            {stepLabel(states[i], s)}
          </button>
        ))}
      </div>
    </div>
  )
}
