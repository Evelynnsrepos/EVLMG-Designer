import { Download, Trash2, X } from 'lucide-react'
import { zipSync, strToU8 } from 'fflate'
import { useState } from 'react'
import { saveBinaryFile, saveTextFile } from '@/core/export/saveTextFile'
import { toCSV } from '@/shared/csv'
import { FlowGraph } from '@/shared/graph'
import type { PanelProps } from '@/core/registry'
import { useUndoRedoKeys } from '@/core/state'
import { NumberInput } from '@/shared/calculators'
import { ImagePicker } from '@/shared/entityList'
import { PixelSprite, SpritePicker } from '@/shared/pixel/PixelSprite'
import { Field, ListDetail, useItems } from '@/shared/listDetail'
import { ProofTextarea } from '@/shared/spell'
import {
  ACHIEVEMENT_KINDS,
  createAchievementsDoc,
  kindColor,
  MC_FRAMES,
  minecraftPack,
  newAchievement,
  OVER_BUDGET,
  PLATFORMS,
  platformChecks,
  suggestApiName,
  summary,
  toRows,
  TROPHY_GRADES,
  UNLOCK_TYPES,
  wouldLoop,
  type Achievement,
  type AchievementKind,
  type AchievementsDoc,
  type McFrame,
  type Platform,
  type TrophyGrade,
  type UnlockType,
} from './model'
import './achievements.css'

/** Achievement list (v0.10). */
export default function View({ active }: PanelProps) {
  const list = useItems<Achievement, AchievementsDoc>('achievements', 'achievements', createAchievementsDoc)
  useUndoRedoKeys(list.doc, active)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const a = list.items.find((x) => x.id === selectedId)
  const s = summary(list.items)
  const edit = (p: Partial<Achievement>) => a && list.edit(a.id, p)
  const [view, setView] = useState<'list' | 'tree'>('list')
  const [loopMsg, setLoopMsg] = useState(false)
  const platforms = list.doc.data?.platforms ?? []
  const setDoc = (patch: Partial<AchievementsDoc>) => list.doc.update((d) => ({ ...d, ...patch }))
  const has = (p: Platform) => platforms.includes(p)
  const checks = platformChecks(list.items, platforms)
  const exportSheet = () => void saveTextFile({ title: 'Export achievements', defaultName: 'achievements.csv', text: toCSV(toRows(list.items)), filter: { name: 'CSV', extensions: ['csv'] } })
  const exportMinecraft = () => {
    const files = minecraftPack(list.items, list.doc.data?.mcNamespace || 'my_game')
    const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
    void saveBinaryFile({ title: 'Export Minecraft datapack', defaultName: 'advancements-datapack.zip', bytes, filter: { name: 'Zip', extensions: ['zip'] } })
  }
  const requires = a?.requires ?? []
  const others = a ? list.items.filter((o) => o.id !== a.id && !requires.includes(o.id)) : []

  const platformBar = (
    <div className="ach-platforms">
      <span className="muted">Made for</span>
      {PLATFORMS.map((p) => (
        <label key={p.id} className="ld-inline">
          <input type="checkbox" checked={has(p.id)} onChange={(e) => setDoc({ platforms: e.target.checked ? [...platforms, p.id] : platforms.filter((x) => x !== p.id) })} /> {p.label}
        </label>
      ))}
      {has('minecraft') && (
        <label className="ld-inline">
          <span className="muted">Namespace</span>
          <input className="input ach-ns" value={list.doc.data?.mcNamespace ?? ''} placeholder="my_game" onChange={(e) => setDoc({ mcNamespace: e.target.value })} />
        </label>
      )}
      <div className="calc-segmented" role="tablist">
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
          List
        </button>
        <button className={view === 'tree' ? 'on' : ''} onClick={() => setView('tree')}>
          Unlock tree
        </button>
      </div>
      <button className="btn btn-ghost" onClick={exportSheet} disabled={!list.items.length} title="A spreadsheet for Steam, Xbox or PlayStation">
        <Download size={14} /> CSV
      </button>
      {has('minecraft') && (
        <button className="btn btn-ghost" onClick={exportMinecraft} disabled={!list.items.length} title="A datapack zip with one advancement per achievement">
          <Download size={14} /> Minecraft datapack
        </button>
      )}
    </div>
  )
  const checkList = checks.length > 0 && (
    <ul className="ach-checks">
      {checks.map((c, i) => (
        <li key={i}>
          <strong>{PLATFORMS.find((p) => p.id === c.platform)?.label}:</strong> {c.text}
        </li>
      ))}
    </ul>
  )

  if (view === 'tree')
    return (
      <div className="ach-treeview">
        {platformBar}
        {checkList}
        <div className="ach-graph">
          {list.items.length ? (
            <FlowGraph
              nodes={list.items.map((x) => ({ id: x.id, label: x.name, sub: x.trophy ? TROPHY_GRADES.find((t) => t.id === x.trophy)?.label : `${x.points} pts`, color: kindColor(x.kind), muted: x.hidden }))}
              edges={list.items.flatMap((x) => (x.requires ?? []).map((r) => ({ from: r, to: x.id })))}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id)
                setView('list')
              }}
            />
          ) : (
            <p className="muted">No achievements yet.</p>
          )}
        </div>
      </div>
    )

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
        <>
        {platformBar}
        <span className={`muted${s.points > OVER_BUDGET ? ' ach-over' : ''}`}>
          {s.count} achievements · {s.points} points{s.points > OVER_BUDGET ? ` (over the usual ${OVER_BUDGET})` : ''} · {s.hidden} hidden · {s.rare} rare · {s.common} common
        </span>
        </>
      }
    >
      {checkList}
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
          <Field label="API name (Steam, Xbox, PlayStation id)">
            <div className="ld-inline">
              <input className="input" value={a.apiName ?? ''} placeholder={suggestApiName(a.name)} onChange={(e) => edit({ apiName: e.target.value })} />
              {!a.apiName && (
                <button className="btn btn-ghost" onClick={() => edit({ apiName: suggestApiName(a.name) })}>
                  Use
                </button>
              )}
            </div>
          </Field>
          {has('playstation') && (
            <Field label="Trophy grade">
              <select className="input" value={a.trophy ?? ''} onChange={(e) => edit({ trophy: (e.target.value || undefined) as TrophyGrade | undefined })}>
                <option value="">Not set</option>
                {TROPHY_GRADES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {has('minecraft') && (
            <>
              <Field label="Minecraft frame">
                <select className="input" value={a.frame ?? 'task'} onChange={(e) => edit({ frame: e.target.value as McFrame })}>
                  {MC_FRAMES.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Minecraft icon item">
                <input className="input" placeholder="minecraft:diamond" value={a.mcIcon ?? ''} onChange={(e) => edit({ mcIcon: e.target.value })} />
              </Field>
              <Field label="Minecraft trigger (empty = given by a command)" wide>
                <input className="input" placeholder="minecraft:inventory_changed" value={a.mcTrigger ?? ''} onChange={(e) => edit({ mcTrigger: e.target.value })} />
              </Field>
            </>
          )}
          <Field label="Description (what players see once unlocked)" wide>
            <ProofTextarea className="input" rows={2} value={a.description} onChange={(e) => edit({ description: e.target.value })} />
          </Field>
          <Field label={a.hidden ? 'Shown while locked (hidden achievements)' : 'Shown while locked (optional, else the description)'} wide>
            <input className="input" placeholder={a.hidden ? 'e.g. Keep playing to find out' : ''} value={a.lockedDescription ?? ''} onChange={(e) => edit({ lockedDescription: e.target.value })} />
          </Field>
          <Field label="Unlocks" wide>
            <select className="input" value={a.unlockType ?? (a.goal > 1 ? 'counter' : 'event')} onChange={(e) => edit({ unlockType: e.target.value as UnlockType })}>
              {UNLOCK_TYPES.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
          {(a.unlockType ?? (a.goal > 1 ? 'counter' : 'event')) === 'counter' && (
            <Field label="Counter (stat name)">
              <input className="input" placeholder="e.g. slimes_defeated" value={a.stat ?? ''} onChange={(e) => edit({ stat: e.target.value })} />
            </Field>
          )}
          <Field label="How it unlocks, in words" wide>
            <input className="input" placeholder="e.g. Defeat 100 slimes without taking damage" value={a.unlock} onChange={(e) => edit({ unlock: e.target.value })} />
          </Field>
          <Field label={has('minecraft') ? 'Needs first (the first one is the Minecraft parent)' : 'Needs first'} wide>
            <div className="ach-chips">
              {requires.map((r) => (
                <span key={r} className="ach-chip">
                  <button className="ach-link" onClick={() => setSelectedId(r)}>
                    {list.items.find((o) => o.id === r)?.name ?? '?'}
                  </button>
                  <button className="icon-btn" aria-label="Remove" onClick={() => edit({ requires: requires.filter((x) => x !== r) })}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              {others.length > 0 && (
                <select
                  className="input"
                  value=""
                  onChange={(e) => {
                    const id = e.target.value
                    if (!id) return
                    if (wouldLoop(list.items, a.id, id)) return setLoopMsg(true)
                    setLoopMsg(false)
                    edit({ requires: [...requires, id] })
                  }}
                >
                  <option value="">Add an achievement…</option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              )}
              {requires.length > 0 && (
                <button className="btn btn-ghost" onClick={() => setView('tree')}>
                  Show tree
                </button>
              )}
            </div>
            {loopMsg && <p className="ach-over">That would make a loop: it would need itself.</p>}
          </Field>
          <Field label="Reward" wide>
            <input className="input" placeholder="e.g. Title “Slime Bane”" value={a.reward} onChange={(e) => edit({ reward: e.target.value })} />
          </Field>
          <button
            className="btn btn-danger ld-danger"
            onClick={() => {
              // one undo step: remove it and drop it from every "needs first"
              list.doc.update((d) => ({ ...d, items: d.items.filter((x) => x.id !== a.id).map((x) => (x.requires?.includes(a.id) ? { ...x, requires: x.requires.filter((r) => r !== a.id) } : x)) }))
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
