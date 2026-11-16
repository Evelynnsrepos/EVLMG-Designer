import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'

/**
 * Combo mode: sparks at the cursor, a little shake, a combo counter and blips while typing.
 * Written from scratch for this app: no code, sounds or pictures from anywhere else (the blips are made
 * here with WebAudio). Off unless turned on; with "reduce motion" there is no shake and only a few sparks.
 */

export type EffectLevel = 'off' | 'subtle' | 'full'

/** The combo ends this long after the last key. */
export const COMBO_MS = 2000
const TITLES: [number, string][] = [
  [1000, 'Unstoppable'],
  [500, 'Legendary'],
  [250, 'Blazing'],
  [100, 'On fire'],
  [50, 'Nice'],
]

export const comboTitle = (count: number) => TITLES.find(([n]) => count >= n)?.[1] ?? ''

/** Counts keys; a pause of COMBO_MS starts again from zero. */
export class Combo {
  count = 0
  last = -Infinity
  /** Returns true when this key reached a new title (a flash). */
  hit(now: number): boolean {
    if (now - this.last > COMBO_MS) this.count = 0
    this.last = now
    const before = comboTitle(this.count)
    this.count++
    return comboTitle(this.count) !== before
  }
  alive(now: number) {
    return this.count > 0 && now - this.last <= COMBO_MS
  }
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
}

const MAX_SPARKS = 300
/** Too big to stay smooth; the effect rests in such files. */
const MAX_LINES = 5000

let audio: AudioContext | null = null
function blip(combo: number, kind: 'key' | 'delete' | 'enter') {
  try {
    audio ??= new AudioContext()
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = kind === 'delete' ? 'sawtooth' : 'square'
    // Higher with the combo, an octave at most.
    const base = kind === 'delete' ? 140 : kind === 'enter' ? 330 : 440
    osc.frequency.value = base * 2 ** (Math.min(combo, 240) / 240)
    gain.gain.setValueAtTime(0.03, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.07)
    osc.connect(gain).connect(audio.destination)
    osc.start()
    osc.stop(audio.currentTime + 0.08)
  } catch {
    // no sound device: stay silent
  }
}

/** The effect for one editor. `host` is the box around the editor that gets the canvas, the counter and the shake. */
export function comboMode(host: HTMLElement, settings: () => { level: EffectLevel; sound: boolean }) {
  return ViewPlugin.fromClass(
    class {
      canvas = document.createElement('canvas')
      label = document.createElement('div')
      sparks: Spark[] = []
      combo = new Combo()
      frame = 0
      shake = 0
      view: EditorView

      constructor(view: EditorView) {
        this.view = view
        this.canvas.className = 'code-combo-canvas'
        this.label.className = 'code-combo-label'
        host.append(this.canvas, this.label)
      }

      update(u: ViewUpdate) {
        const { level, sound } = settings()
        if (level === 'off' || !u.docChanged || u.state.doc.lines > MAX_LINES) return
        const typed = u.transactions.some((t) => t.isUserEvent('input.type') || t.isUserEvent('input.paste'))
        const deleted = u.transactions.some((t) => t.isUserEvent('delete'))
        if (!typed && !deleted) return // undo, the language server's edits, reloads: no fireworks
        const enter = typed && u.state.doc.lines > u.startState.doc.lines
        const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
        const flash = this.combo.hit(performance.now())
        const strength = (level === 'full' ? 1 : 0.4) * (calm ? 0.25 : 1)
        const head = u.state.selection.main.head
        // Measuring must wait until the editor has drawn the change.
        this.view.requestMeasure({
          read: (view) => view.coordsAtPos(head),
          write: (at) => {
            if (!at) return
            const box = host.getBoundingClientRect()
            const n = Math.round((flash ? 40 : enter ? 16 : deleted ? 10 : 6) * strength)
            // The canvas cannot read CSS variables itself.
            const color = deleted ? getComputedStyle(host).getPropertyValue('--code-spark-delete') : `hsl(${(this.combo.count * 7) % 360} 90% 65%)`
            for (let i = 0; i < n && this.sparks.length < MAX_SPARKS; i++) {
              const angle = Math.random() * Math.PI * 2
              const speed = (1 + Math.random() * 3) * (deleted ? 1.6 : 1)
              this.sparks.push({ x: at.left - box.left, y: at.top - box.top + 8, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.5, life: 1, color })
            }
            if (!calm) this.shake = Math.max(this.shake, (flash ? 6 : enter || deleted ? 3 : 1.5) * strength)
            this.label.textContent = `${this.combo.count}${comboTitle(this.combo.count) ? ` ${comboTitle(this.combo.count)}!` : ''}`
            this.label.classList.toggle('code-combo-flash', flash)
            this.label.style.opacity = '1'
            if (!this.frame) this.frame = requestAnimationFrame(this.tick)
          },
        })
        if (sound) blip(this.combo.count, deleted ? 'delete' : enter ? 'enter' : 'key')
      }

      tick = () => {
        this.frame = 0
        const { canvas } = this
        const w = host.clientWidth
        const h = host.clientHeight
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w
          canvas.height = h
        }
        const g = canvas.getContext('2d')!
        g.clearRect(0, 0, w, h)
        this.sparks = this.sparks.filter((s) => s.life > 0)
        for (const s of this.sparks) {
          s.x += s.vx
          s.y += s.vy
          s.vy += 0.15
          s.life -= 0.03
          g.globalAlpha = Math.max(0, s.life)
          g.fillStyle = s.color
          g.fillRect(s.x, s.y, 3, 3)
        }
        g.globalAlpha = 1
        // Shake the box, never the text layout, so the cursor does not jump.
        this.shake *= 0.85
        host.style.transform = this.shake > 0.3 ? `translate(${(Math.random() - 0.5) * this.shake}px, ${(Math.random() - 0.5) * this.shake}px)` : ''
        const alive = this.combo.alive(performance.now())
        if (!alive) {
          this.label.style.opacity = '0'
          this.combo.count = 0
        }
        if (this.sparks.length || this.shake > 0.3 || alive) this.frame = requestAnimationFrame(this.tick)
      }

      destroy() {
        cancelAnimationFrame(this.frame)
        host.style.transform = ''
        this.canvas.remove()
        this.label.remove()
      }
    },
  )
}
