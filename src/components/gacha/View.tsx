import { Plus, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import type { Enemy, Id, Item } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { LineChart, NumberInput, PresetHeader } from '@/shared/calculators'
import { DEFAULT_RARITY_STYLES, isRarity, isStyled } from '@/shared/categories'
import { formatNumber } from '@/shared/formulas'
import { createGachaDoc, lootChances, newLootEntry, newTier, normalizeGachaDoc, simulateBanner, type Banner, type GachaDoc, type Loot, type LootEntry, type Tier } from './logic'
import { createOffers, newOfferEntry, simulateOffers, type Offers } from './offers'
import './gacha.css'

const T = {
  kind: 'Gacha / loot',
  banner: 'Banner (pulls)',
  loot: 'Chest / drop table',
  tiers: 'Tiers and base rates',
  tierName: 'Tier',
  rate: 'Rate %',
  top: 'Wanted',
  rateSum: (n: number) => `Rates add up to ${formatNumber(n)}%`,
  addTier: 'Add tier',
  fromRarities: 'Use the project rarities',
  pity: 'Pity',
  hardPity: 'Guaranteed at pull',
  softStart: 'Soft pity from pull',
  softStep: '+% per pull after that',
  featured: 'Featured chance %',
  guarantee: 'Guaranteed featured after losing',
  secondPity: 'Second tier at least every … pulls',
  goal: 'Goal',
  copies: 'Featured copies wanted',
  startPity: 'Pulls already saved',
  cost: 'Cost per pull',
  currency: 'Currency',
  runs: 'Simulated players',
  results: 'Results',
  average: 'Average pulls',
  chance: (p: number) => `${p}% of players are done within`,
  pulls: 'pulls',
  topPer100: 'Top tier per 100 pulls',
  chart: '% of players done by pull',
  capped: 'Some runs stopped at 100 000 pulls: the goal may be impossible with these rates.',
  none: 'None',
  lootMode: 'How a chest is opened',
  weighted: 'One entry, picked by weight',
  independent: 'Each entry rolls its own chance %',
  entries: 'Contents',
  item: 'Item',
  value: (mode: Loot['mode']) => (mode === 'weighted' ? 'Weight' : 'Chance %'),
  amount: 'Amount',
  target: 'Target',
  addEntry: 'Add entry',
  fromEnemy: 'Load an enemy drop table…',
  perOpen: 'Chance per opening',
  opensFor: (p: number) => `Openings for a ${p}% chance`,
  expected: (n: number) => `Expected from ${n} openings`,
  opens: 'Openings',
  pickTarget: 'Mark an entry as the target to see its chances.',
}

/** Gacha & Loot Simulator (v0.7). */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<GachaDoc>('gacha', documentId!, createGachaDoc)
  useUndoRedoKeys(doc, active)
  const d = doc.data ? normalizeGachaDoc(doc.data) : null
  if (!d) return null
  const set = (patch: Partial<GachaDoc>) => doc.update((x) => ({ ...normalizeGachaDoc(x), ...patch }))
  return (
    <div className="calc-root gacha-root">
      <div className="calc-scroll">
        <PresetHeader documentId={documentId!} kind={T.kind} undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
        <div className="calc-segmented gacha-mode" role="tablist">
          <button className={d.kind === 'banner' ? 'on' : ''} onClick={() => set({ kind: 'banner' })}>
            {T.banner}
          </button>
          <button className={d.kind === 'loot' ? 'on' : ''} onClick={() => set({ kind: 'loot' })}>
            {T.loot}
          </button>
          <button className={d.kind === 'offers' ? 'on' : ''} onClick={() => set({ kind: 'offers' })} title="Show a few, pick one: shops, level-up choices, card drafts">
            Offers (pick 1 of N)
          </button>
        </div>
        {d.kind === 'offers' ? (
          <OffersView offers={d.offers ?? createOffers()} onChange={(offers) => set({ offers })} />
        ) : d.kind === 'banner' ? (
          <BannerView banner={d.banner} runs={d.runs} onChange={(banner) => set({ banner })} onRuns={(runs) => set({ runs })} />
        ) : (
          <LootView loot={d.loot} onChange={(loot) => set({ loot })} />
        )}
      </div>
    </div>
  )
}

function BannerView({ banner: b, runs, onChange, onRuns }: { banner: Banner; runs: number; onChange: (b: Banner) => void; onRuns: (n: number) => void }) {
  const categories = useProjectStore((s) => s.categories)
  const set = (patch: Partial<Banner>) => onChange({ ...b, ...patch })
  const setTier = (id: Id, patch: Partial<Tier>) => set({ tiers: b.tiers.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  const key = JSON.stringify(b) + runs
  // eslint-style note: the simulation only depends on the banner and the run count.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => simulateBanner(b, runs), [key])
  const sum = b.tiers.reduce((s, t) => s + t.rate, 0)
  const rarity = categories.find(isRarity) ?? categories.find(isStyled)
  const fromRarities = () => {
    if (!rarity) return
    const styles = rarity.styles ?? DEFAULT_RARITY_STYLES
    // Rarest last in the list becomes the wanted tier; rates start as a simple guess to edit.
    const names = [...rarity.options].reverse()
    const guess = [0.6, 5.1, 20, 30, 44.3]
    const tiers = names.map((n, i) => newTier(n, guess[i] ?? 1, styles[n]?.color ?? '#9aa0a6'))
    set({ tiers, topTierId: tiers[0].id, secondPity: tiers[1] ? { tierId: tiers[1].id, every: 10 } : null })
  }
  const max = result.pulls[result.pulls.length - 1] ?? 0
  const step = Math.max(1, Math.ceil(max / 120))
  const xs = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step)
  const cost = (pulls: number) => (b.costPerPull > 0 ? ` · ${formatNumber(pulls * b.costPerPull)} ${b.currency}` : '')

  return (
    <>
      <section className="calc-section">
        <h3>{T.tiers}</h3>
        <table className="calc-table gacha-tiers">
          <thead>
            <tr>
              <th>{T.top}</th>
              <th>{T.tierName}</th>
              <th>{T.rate}</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {b.tiers.map((t) => (
              <tr key={t.id}>
                <td>
                  <input type="radio" name="top" checked={b.topTierId === t.id} onChange={() => set({ topTierId: t.id })} />
                </td>
                <td>
                  <input className="input" value={t.name} style={{ color: t.color }} onChange={(e) => setTier(t.id, { name: e.target.value })} />
                </td>
                <td>
                  <NumberInput value={t.rate} min={0} max={100} onChange={(rate) => setTier(t.id, { rate })} />
                </td>
                <td>
                  <input type="color" className="gacha-color" value={t.color} onChange={(e) => setTier(t.id, { color: e.target.value })} />
                </td>
                <td>
                  <button className="icon-btn" title="Remove" disabled={b.tiers.length <= 1} onClick={() => set({ tiers: b.tiers.filter((x) => x.id !== t.id), topTierId: b.topTierId === t.id ? b.tiers.find((x) => x.id !== t.id)!.id : b.topTierId })}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="calc-row">
          <span className={Math.abs(sum - 100) > 0.01 ? 'calc-error' : 'calc-muted'}>{T.rateSum(sum)}</span>
          <span className="calc-spacer" />
          <button className="btn btn-ghost" onClick={() => set({ tiers: [...b.tiers, newTier()] })}>
            <Plus size={14} /> {T.addTier}
          </button>
          {rarity && (
            <button className="btn btn-ghost" onClick={fromRarities}>
              {T.fromRarities}
            </button>
          )}
        </div>
      </section>

      <section className="calc-section">
        <h3>{T.pity}</h3>
        <div className="gacha-grid">
          <OptionalNumber label={T.hardPity} value={b.hardPity} fallback={90} onChange={(hardPity) => set({ hardPity })} />
          <OptionalNumber label={T.softStart} value={b.softPityStart} fallback={74} onChange={(softPityStart) => set({ softPityStart })} />
          <label className="calc-field">
            {T.softStep}
            <NumberInput value={b.softPityStep} min={0} onChange={(softPityStep) => set({ softPityStep })} />
          </label>
          <label className="calc-field">
            {T.featured}
            <NumberInput value={b.featuredChance} min={0} max={100} onChange={(featuredChance) => set({ featuredChance })} />
          </label>
          <label className="gacha-check">
            <input type="checkbox" checked={b.guaranteeAfterLoss} onChange={(e) => set({ guaranteeAfterLoss: e.target.checked })} /> {T.guarantee}
          </label>
          <OptionalNumber
            label={T.secondPity}
            value={b.secondPity?.every ?? null}
            fallback={10}
            onChange={(every) => {
              const second = b.tiers.find((t) => t.id !== b.topTierId)
              set({ secondPity: every === null || !second ? null : { tierId: b.secondPity?.tierId ?? second.id, every } })
            }}
          />
        </div>
      </section>

      <section className="calc-section">
        <h3>{T.goal}</h3>
        <div className="gacha-grid">
          <label className="calc-field">
            {T.copies}
            <NumberInput value={b.copies} min={1} step={1} onChange={(copies) => set({ copies: Math.max(1, Math.floor(copies)) })} />
          </label>
          <label className="calc-field">
            {T.startPity}
            <NumberInput value={b.startPity} min={0} step={1} onChange={(startPity) => set({ startPity: Math.max(0, Math.floor(startPity)) })} />
          </label>
          <label className="calc-field">
            {T.cost}
            <NumberInput value={b.costPerPull} min={0} onChange={(costPerPull) => set({ costPerPull })} />
          </label>
          <label className="calc-field">
            {T.currency}
            <input className="input" value={b.currency} onChange={(e) => set({ currency: e.target.value })} />
          </label>
          <label className="calc-field">
            {T.runs}
            <NumberInput value={runs} min={100} max={200000} step={1000} onChange={(n) => onRuns(Math.max(100, Math.min(200000, Math.floor(n))))} />
          </label>
        </div>
      </section>

      <section className="calc-section">
        <h3>{T.results}</h3>
        {result.capped && <p className="calc-error">{T.capped}</p>}
        <div className="gacha-stats">
          <Stat label={T.average} value={`${formatNumber(Math.round(result.average * 10) / 10)} ${T.pulls}`} sub={cost(Math.round(result.average))} />
          {[50, 90, 99].map((p) => (
            <Stat key={p} label={T.chance(p)} value={`${result.percentile(p)} ${T.pulls}`} sub={cost(result.percentile(p))} />
          ))}
          <Stat label={T.topPer100} value={formatNumber(Math.round(result.topPer100 * 100) / 100)} />
        </div>
        <h4>{T.chart}</h4>
        <LineChart xs={xs} xLabel={T.pulls} series={[{ name: '%', values: xs.map((x) => Math.round(result.doneBy(x) * 1000) / 10) }]} />
      </section>
    </>
  )
}

function OptionalNumber({ label, value, fallback, onChange }: { label: string; value: number | null; fallback: number; onChange: (v: number | null) => void }) {
  return (
    <label className="calc-field">
      <span className="gacha-check">
        <input type="checkbox" checked={value !== null} onChange={(e) => onChange(e.target.checked ? fallback : null)} /> {label}
      </span>
      {value !== null ? <NumberInput value={value} min={1} step={1} onChange={(v) => onChange(Math.max(1, Math.floor(v)))} /> : <span className="calc-muted">{T.none}</span>}
    </label>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="gacha-stat">
      <span className="calc-muted">{label}</span>
      <span className="calc-big">{value}</span>
      {sub && <span className="calc-muted">{sub.replace(/^ · /, '')}</span>}
    </div>
  )
}

function LootView({ loot, onChange }: { loot: Loot; onChange: (l: Loot) => void }) {
  const items = useProjectStore((s) => s.entities.item) as Item[]
  const enemies = useProjectStore((s) => s.entities.enemy) as Enemy[]
  const set = (patch: Partial<Loot>) => onChange({ ...loot, ...patch })
  const setEntry = (id: Id, patch: Partial<LootEntry>) => set({ entries: loot.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
  const c = lootChances(loot)
  const nameOf = (e: LootEntry) => (e.itemId ? items.find((i) => i.id === e.itemId)?.name || '(deleted)' : e.name)
  const loadEnemy = (id: Id) => {
    const enemy = enemies.find((x) => x.id === id)
    if (!enemy) return
    set({
      mode: 'chance',
      entries: enemy.dropTable.map((r) => ({ ...newLootEntry(), itemId: r.itemId, value: r.chancePercent, amountMin: r.amountMin, amountMax: r.amountMax })),
      targetId: null,
    })
  }
  return (
    <>
      <section className="calc-section">
        <h3>{T.lootMode}</h3>
        <div className="calc-segmented">
          <button className={loot.mode === 'weighted' ? 'on' : ''} onClick={() => set({ mode: 'weighted' })}>
            {T.weighted}
          </button>
          <button className={loot.mode === 'chance' ? 'on' : ''} onClick={() => set({ mode: 'chance' })}>
            {T.independent}
          </button>
        </div>
      </section>
      <section className="calc-section">
        <h3>{T.entries}</h3>
        {loot.entries.length > 0 && (
          <table className="calc-table">
            <thead>
              <tr>
                <th>{T.target}</th>
                <th>{T.item}</th>
                <th>{T.value(loot.mode)}</th>
                <th>{T.amount}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loot.entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    <input type="radio" name="target" checked={loot.targetId === e.id} onChange={() => set({ targetId: e.id })} />
                  </td>
                  <td>
                    <span className="gacha-inline">
                      <select className="input" value={e.itemId ?? ''} onChange={(ev) => setEntry(e.id, { itemId: ev.target.value || null })}>
                        <option value="">Not an item:</option>
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name || 'Untitled'}
                          </option>
                        ))}
                      </select>
                      {!e.itemId && <input className="input" value={e.name} onChange={(ev) => setEntry(e.id, { name: ev.target.value })} />}
                    </span>
                  </td>
                  <td>
                    <NumberInput value={e.value} min={0} onChange={(value) => setEntry(e.id, { value })} />
                  </td>
                  <td>
                    <span className="gacha-inline">
                      <NumberInput value={e.amountMin} min={0} onChange={(amountMin) => setEntry(e.id, { amountMin })} />–
                      <NumberInput value={e.amountMax} min={0} onChange={(amountMax) => setEntry(e.id, { amountMax })} />
                    </span>
                  </td>
                  <td>
                    <button className="icon-btn" title="Remove" onClick={() => set({ entries: loot.entries.filter((x) => x.id !== e.id) })}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="calc-row">
          <button className="btn" onClick={() => set({ entries: [...loot.entries, newLootEntry()] })}>
            <Plus size={14} /> {T.addEntry}
          </button>
          {enemies.length > 0 && (
            <select className="input gacha-enemy" value="" onChange={(e) => loadEnemy(e.target.value)}>
              <option value="">{T.fromEnemy}</option>
              {enemies.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name || 'Untitled enemy'}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>
      <section className="calc-section">
        <h3>{T.results}</h3>
        {loot.targetId ? (
          <div className="gacha-stats">
            <Stat label={T.perOpen} value={`${formatNumber(Math.round(c.perOpen * 10000) / 100)}%`} />
            {[0.5, 0.9, 0.99].map((p) => (
              <Stat key={p} label={T.opensFor(p * 100)} value={Number.isFinite(c.opensFor(p)) ? String(c.opensFor(p)) : '∞'} />
            ))}
          </div>
        ) : (
          <p className="calc-muted">{T.pickTarget}</p>
        )}
        <label className="calc-field gacha-opens">
          {T.opens}
          <NumberInput value={loot.opens} min={1} step={1} onChange={(opens) => set({ opens: Math.max(1, Math.floor(opens)) })} />
        </label>
        {loot.entries.length > 0 && (
          <table className="calc-table">
            <thead>
              <tr>
                <th>{T.item}</th>
                <th>{T.expected(loot.opens)}</th>
              </tr>
            </thead>
            <tbody>
              {c.expected.map((x) => (
                <tr key={x.entry.id}>
                  <td>{nameOf(x.entry)}</td>
                  <td>{formatNumber(Math.round(x.amount * loot.opens * 100) / 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

function OffersView({ offers: o, onChange }: { offers: Offers; onChange: (o: Offers) => void }) {
  const items = useProjectStore((s) => s.entities.item) as Item[]
  const set = (patch: Partial<Offers>) => onChange({ ...o, ...patch })
  const r = useMemo(() => simulateOffers(o), [o])
  const nameOf = (e: Offers['entries'][number]) => (e.itemId ? items.find((i) => i.id === e.itemId)?.name || '(deleted)' : e.name)
  const target = o.entries.find((e) => e.id === o.targetId)
  const pct = (v: number) => `${formatNumber(Math.round(v * 1000) / 10)}%`
  return (
    <>
      <section className="calc-section">
        <h3>How offers work</h3>
        <div className="calc-row">
          <label className="calc-field">
            <span>Choices shown</span>
            <NumberInput value={o.shown} min={1} max={20} onChange={(shown) => set({ shown: Math.round(shown) })} />
          </label>
          <label className="calc-field">
            <span>Offers per run</span>
            <NumberInput value={o.rounds} min={1} max={200} onChange={(rounds) => set({ rounds: Math.round(rounds) })} />
          </label>
          <label className="calc-field">
            <span>
              <input type="checkbox" checked={o.takenLeaves} onChange={(e) => set({ takenLeaves: e.target.checked })} /> What you take leaves the pool
            </span>
          </label>
        </div>
      </section>
      <section className="calc-section">
        <h3>Pool</h3>
        <table className="calc-table">
          <thead>
            <tr>
              <th>{T.target}</th>
              <th>{T.item}</th>
              <th>Weight</th>
              <th>Shows in</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {o.entries.map((e) => (
              <tr key={e.id}>
                <td>
                  <input type="radio" name="offer-target" checked={o.targetId === e.id} onChange={() => set({ targetId: e.id })} aria-label="Target" />
                </td>
                <td>
                  {e.itemId ? (
                    nameOf(e)
                  ) : (
                    <input className="input" value={e.name} onChange={(x) => set({ entries: o.entries.map((y) => (y.id === e.id ? { ...y, name: x.target.value } : y)) })} />
                  )}
                </td>
                <td>
                  <NumberInput value={e.weight} min={0} onChange={(weight) => set({ entries: o.entries.map((y) => (y.id === e.id ? { ...y, weight } : y)) })} />
                </td>
                <td className="calc-muted">{pct(r.perOffer[e.id] ?? 0)} of offers</td>
                <td>
                  <button className="icon-btn" aria-label="Remove" onClick={() => set({ entries: o.entries.filter((y) => y.id !== e.id), targetId: o.targetId === e.id ? null : o.targetId })}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="calc-row">
          <button className="btn btn-ghost" onClick={() => set({ entries: [...o.entries, newOfferEntry()] })}>
            <Plus size={14} /> {T.addEntry}
          </button>
          {items.length > 0 && (
            <select className="input" value="" onChange={(e) => e.target.value && set({ entries: [...o.entries, { ...newOfferEntry(), itemId: e.target.value }] })}>
              <option value="">Add from the Item List…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name || 'Untitled'}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>
      <section className="calc-section">
        <h3>{T.results}</h3>
        {!target ? (
          <p className="calc-muted">{T.pickTarget}</p>
        ) : (
          <>
            <div className="gacha-stats">
              <Stat label={`Sees ${nameOf(target)} in the first offer`} value={pct(r.seenBy[0] ?? 0)} />
              <Stat label={`…by offer ${o.rounds}`} value={pct(r.seenBy.at(-1) ?? 0)} />
              <Stat label="First seen on average at offer" value={r.avgFirst === null ? 'never' : formatNumber(Math.round(r.avgFirst * 10) / 10)} />
            </div>
            <LineChart xs={r.seenBy.map((_, i) => i + 1)} series={[{ name: `% of runs that saw ${nameOf(target)}`, values: r.seenBy.map((v) => Math.round(v * 1000) / 10) }]} xLabel="Offer" />
            <p className="calc-muted">The player takes the target as soon as it shows up and otherwise picks one of the choices at random. 5 000 runs.</p>
          </>
        )}
      </section>
    </>
  )
}
