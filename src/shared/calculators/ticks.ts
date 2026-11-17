/** Nice round tick values between lo and hi. */
export function ticks(lo: number, hi: number, count: number): number[] {
  if (hi === lo) return [lo]
  const raw = (hi - lo) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) out.push(Number(t.toPrecision(12)))
  return out
}
