import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { PanelProps } from '@/core/registry'
import { useUndoRedoKeys } from '@/core/state'
import { NumberInput } from '@/shared/calculators'
import { ImagePicker } from '@/shared/entityList'
import { PixelSprite, SpritePicker } from '@/shared/pixel/PixelSprite'
import { Field, ListDetail, useItems } from '@/shared/listDetail'
import { ProofTextarea } from '@/shared/spell'
import { ACHIEVEMENT_KINDS, createAchievementsDoc, kindColor, newAchievement, OVER_BUDGET, summary, type Achievement, type AchievementKind, type AchievementsDoc } from './model'

/** Achievement list (v0.10). */
export default function View({ active }: PanelProps) {
  const list = useItems<Achievement, AchievementsDoc>('achievements', 'achievements', createAchievementsDoc)
  useUndoRedoKeys(list.doc, active)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const a = list.items.find((x) => x.id === selectedId)
  const s = summary(list.items)
  const edit = (p: Partial<Achievement>) => a && list.edit(a.id, p)

  return (
    <ListDetail
      rows={list.items.map((x) => ({ id: x.id, label: `${x.hidden ? '🔒 ' : ''}${x.name}`, sub: `${x.points} pts · ${x.expectedPercent}% of players`, color: kindColor(x.kind) }))}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onAdd={() => {
        const n = newAchievement()
        list.add(n)
        setSelectedId(n.id)
      }}
      addLabel="New achievement"
      empty="No achievements yet. Make one with New achievement."
      toolbar={
        <span className={`muted${s.points > OVER_BUDGET ? ' ach-over' : ''}`}>
          {s.count} achievements · {s.points} points{s.points > OVER_BUDGET ? ` (over the usual ${OVER_BUDGET})` : ''} · {s.hidden} hidden · {s.rare} rare · {s.common} common
        </span>
      }
    >
      {a && (
        <div className="ld-page">
          <div className="wide ld-inline">
            <div style={{ width: 72 }}>
              <>
            {a.sprite ? <PixelSprite sprite={a.sprite} size={96} /> : <ImagePicker path={a.image} alt={a.name} onChange={(image) => edit({ image })} />}
            <SpritePicker sprite={a.sprite} onChange={(sprite) => edit({ sprite })} />
          </>
            </div>
            <input className="input" style={{ flex: 1, fontSize: 18, fontWeight: 600 }} value={a.name} onChange={(e) => edit({ name: e.target.value })} aria-label="Name" />
          </div>
          <Field label="Type">
            <select className="input" value={a.kind} onChange={(e) => edit({ kind: e.target.value as AchievementKind })}>
              {ACHIEVEMENT_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Points">
            <NumberInput value={a.points} min={0} onChange={(points) => edit({ points })} />
          </Field>
          <Field label="Steps to finish (1 = one-off)">
            <NumberInput value={a.goal} min={1} onChange={(goal) => edit({ goal: Math.max(1, Math.round(goal)) })} />
          </Field>
          <Field label="Expected players who get it (%)">
            <NumberInput value={a.expectedPercent} min={0} max={100} onChange={(expectedPercent) => edit({ expectedPercent })} />
          </Field>
          <label className="ld-inline">
            <input type="checkbox" checked={a.hidden} onChange={(e) => edit({ hidden: e.target.checked })} /> Hidden until unlocked
          </label>
          <Field label="Description (what players see)" wide>
            <ProofTextarea className="input" rows={2} value={a.description} onChange={(e) => edit({ description: e.target.value })} />
          </Field>
          <Field label="How it unlocks" wide>
            <input className="input" placeholder="e.g. Defeat 100 slimes without taking damage" value={a.unlock} onChange={(e) => edit({ unlock: e.target.value })} />
          </Field>
          <Field label="Reward" wide>
            <input className="input" placeholder="e.g. Title “Slime Bane”" value={a.reward} onChange={(e) => edit({ reward: e.target.value })} />
          </Field>
          <button
            className="btn btn-danger ld-danger"
            onClick={() => {
              list.remove(a.id)
              setSelectedId(null)
            }}
          >
            <Trash2 size={14} /> Delete achievement
          </button>
        </div>
      )}
    </ListDetail>
  )
}
