/**
 * Keeps `--fill` on every slider (input type=range) at its value in percent, so the shared slider style
 * in index.css can colour the track up to the knob (v0.14). Sliders that set `--fill` themselves keep theirs.
 * ponytail: refreshed on input and whenever the page changes; a value changed by code without either keeps
 * its old fill until the next change.
 */
function fill(el: HTMLInputElement) {
  const min = Number(el.min || 0)
  const max = Number(el.max || 100)
  const pct = max > min ? ((Number(el.value) - min) / (max - min)) * 100 : 0
  el.style.setProperty('--fill', `${Math.max(0, Math.min(100, pct))}%`)
}

const all = () => document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(fill)

export function installRangeFill() {
  document.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement
    if (t?.type === 'range') fill(t)
  })
  let queued = false
  new MutationObserver(() => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      all()
    })
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'min', 'max'] })
  all()
}
