/**
 * Balance dashboard (v0.10): statistics over the Item and Enemy Lists to spot
 * numbers that stick out and a difficulty curve that jumps.
 */

export interface Point {
  id: string
  name: string
  value: number
  /** Group to compare within, e.g. the rarity. */
  group: string
  level?: number
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Values far from the others in their group, using the median and the median
 * distance to it (robust, so one huge value does not hide itself). `score` is
 * how many typical distances away it is; above 3 is flagged.
 */
export function outliers(points: Point[], threshold = 3): (Point & { score: number; typical: number })[] {
  const groups = new Map<string, Point[]>()
  for (const p of points) groups.set(p.group, [...(groups.get(p.group) ?? []), p])
  const out: (Point & { score: number; typical: number })[] = []
  for (const list of groups.values()) {
    if (list.length < 4) continue
    const values = list.map((p) => p.value)
    const med = median(values)
    const mad = median(values.map((v) => Math.abs(v - med))) || median(values.map((v) => Math.abs(v))) * 0.1 || 1
    for (const p of list) {
      const score = Math.abs(p.value - med) / (mad * 1.4826)
      if (score > threshold) out.push({ ...p, score, typical: med })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

/**
 * The difficulty curve: average value per level, and where it jumps or drops
 * a lot compared with the levels around it.
 */
export function curve(points: Point[]): { levels: number[]; avg: number[]; min: number[]; max: number[]; spikes: { level: number; change: number }[] } {
  const by = new Map<number, number[]>()
  for (const p of points) if (p.level !== undefined) by.set(p.level, [...(by.get(p.level) ?? []), p.value])
  const levels = [...by.keys()].sort((a, b) => a - b)
  const avg = levels.map((l) => by.get(l)!.reduce((a, b) => a + b, 0) / by.get(l)!.length)
  const growth = avg.slice(1).map((v, i) => (avg[i] > 0 ? v / avg[i] - 1 : 0))
  const typical = growth.length ? median(growth.map(Math.abs)) : 0
  const spikes = growth.map((g, i) => ({ level: levels[i + 1], change: g })).filter((x) => Math.abs(x.change) > Math.max(0.25, typical * 2.5))
  return { levels, avg, min: levels.map((l) => Math.min(...by.get(l)!)), max: levels.map((l) => Math.max(...by.get(l)!)), spikes }
}

export interface StripRow {
  group: string
  median: number
  dots: (Point & { flag: 'high' | 'low' | null })[]
}

/** One row per group for the dot chart: every value, the group's typical value, and which dots are flagged by `outliers`. */
export function strips(points: Point[]): StripRow[] {
  const flagged = new Map(outliers(points).map((o) => [o.id, o.value > o.typical ? ('high' as const) : ('low' as const)]))
  const groups = new Map<string, Point[]>()
  for (const p of points) groups.set(p.group, [...(groups.get(p.group) ?? []), p])
  return [...groups].map(([group, list]) => ({ group, median: median(list.map((p) => p.value)), dots: list.map((p) => ({ ...p, flag: flagged.get(p.id) ?? null })) }))
}
