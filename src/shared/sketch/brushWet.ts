import { brushTip, StrokeStamper, type BrushSettings, type Dab } from './brushes'

/**
 * Wet mix and the Smudge tool (Sketch Pro). These strokes change the pixels
 * already on the layer, so they work on a copy of it: every stamp picks up
 * colour under it into the brush and lays paint (or the picked-up colour)
 * back down. The finished copy replaces the layer.
 *
 * Mixing is done with canvas operations on premultiplied pixels:
 * "destination-out" by k, then "lighter" with the other image × k, is a
 * blend of the two by k.
 */

type Ctx = CanvasRenderingContext2D

function makeCtx(w: number, h: number): Ctx {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c.getContext('2d')!
}

/** dst = dst × (1 - k) + src × k, inside the tip mask when given. */
function mix(dst: Ctx, src: CanvasImageSource, k: number, s: number) {
  dst.save()
  dst.globalCompositeOperation = 'destination-out'
  dst.globalAlpha = k
  dst.fillRect(0, 0, s, s)
  dst.globalCompositeOperation = 'lighter'
  dst.drawImage(src, 0, 0, s, s, 0, 0, s, s)
  dst.restore()
}

export class WetStamper extends StrokeStamper {
  /** The layer as it is being painted. */
  private work: Ctx
  private layer: HTMLCanvasElement
  private smudge: boolean
  /** Colour carried by the brush, one per mirror copy. */
  private carried: (Ctx | null)[] = []
  private tipC = makeCtx(2, 2)
  private sample = makeCtx(2, 2)
  private paint = makeCtx(2, 2)
  private blurC: Ctx | null = null

  constructor(ctx: Ctx, brush: BrushSettings, mirror: ((p: { x: number; y: number }) => { x: number; y: number }[]) | undefined, seed: number | undefined, color: string, layer: HTMLCanvasElement, smudge: boolean) {
    super(ctx, { ...brush, tipAnimation: false, dual: null }, mirror, seed, color)
    this.layer = layer
    this.smudge = smudge
    this.work = makeCtx(layer.width, layer.height)
    this.work.drawImage(layer, 0, 0)
  }

  protected restart() {
    this.work.globalCompositeOperation = 'copy'
    this.work.drawImage(this.layer, 0, 0)
    this.work.globalCompositeOperation = 'source-over'
    this.carried = []
  }

  /** The painted copy of the layer; it replaces the layer (inside the selection). */
  get result(): HTMLCanvasElement {
    return this.work.canvas
  }

  private fit(c: Ctx, s: number) {
    if (c.canvas.width !== s) c.canvas.width = c.canvas.height = s
    else c.clearRect(0, 0, s, s)
  }

  protected drawDab(d: Dab) {
    const b = this.brush
    // ponytail: stamps are capped at 400 px so big wet brushes stay fast.
    const s = Math.max(2, Math.ceil(Math.min(400, d.size)))
    const k = s / d.size
    // The stamp's shape, turned and squashed like a normal stamp.
    this.fit(this.tipC, s)
    const t = this.tipC
    t.save()
    t.translate(s / 2, s / 2)
    t.rotate(d.rot)
    t.scale(d.sx * k, d.round * d.sy * k)
    t.drawImage(brushTip(b), -d.size / 2, -d.size / 2, d.size, d.size)
    t.restore()
    const mirrors = this.mirror({ x: d.x, y: d.y })
    mirrors.forEach((m, i) => {
      const x0 = Math.round(m.x - s / 2)
      const y0 = Math.round(m.y - s / 2)
      // What is under the stamp now.
      this.fit(this.sample, s)
      this.sample.save()
      if (b.wetBlur > 0) this.sample.filter = `blur(${(b.wetBlur * s) / 8}px)`
      this.sample.drawImage(this.work.canvas, x0, y0, s, s, 0, 0, s, s)
      this.sample.restore()
      let carry = this.carried[i]
      if (!carry || carry.canvas.width !== s) {
        const old = carry
        carry = makeCtx(s, s)
        carry.drawImage(old ? old.canvas : this.sample.canvas, 0, 0, s, s)
        this.carried[i] = carry
      }
      // The paint this stamp lays down, masked by the stamp shape.
      this.fit(this.paint, s)
      const p = this.paint
      if (this.smudge && b.smudgeMode === 'blur') {
        // Blur: soften what is under the stamp instead of dragging colour; Blur sets how much.
        // Sample a margin around the stamp, so the blur does not fade into empty space at its edges.
        const r = Math.max(1, ((0.15 + b.wetBlur) * s) / 6)
        const pad = Math.ceil(r * 3)
        const big = (this.blurC ??= makeCtx(2, 2))
        this.fit(big, s + pad * 2)
        big.filter = `blur(${r}px)`
        big.drawImage(this.work.canvas, x0 - pad, y0 - pad, s + pad * 2, s + pad * 2, 0, 0, s + pad * 2, s + pad * 2)
        big.filter = 'none'
        p.drawImage(big.canvas, pad, pad, s, s, 0, 0, s, s)
      } else if (this.smudge) p.drawImage(carry.canvas, 0, 0)
      else {
        const left = b.charge >= 1 ? 1 : Math.exp(-d.at / (b.charge * 1500 + 20))
        const water = Math.min(1, b.dilution * (1 + (this.rand() - 0.5) * b.wetJitter))
        p.globalAlpha = (1 - water * 0.9) * left
        p.fillStyle = d.color ?? this.strokeColor
        p.fillRect(0, 0, s, s)
        p.globalAlpha = b.pull
        p.drawImage(carry.canvas, 0, 0)
        p.globalAlpha = 1
      }
      p.globalCompositeOperation = 'destination-in'
      p.drawImage(t.canvas, 0, 0)
      p.globalCompositeOperation = 'source-over'
      const w = this.work
      w.save()
      if (this.smudge) {
        // Replace what is there by the dragged colour, as far as the stamp reaches.
        w.globalAlpha = d.alpha
        w.globalCompositeOperation = 'destination-out'
        w.drawImage(t.canvas, x0, y0)
        w.globalCompositeOperation = 'lighter'
        w.drawImage(p.canvas, x0, y0)
      } else {
        w.globalAlpha = d.alpha * (0.1 + 0.9 * b.attack) * b.opacity
        w.drawImage(p.canvas, x0, y0)
        if (b.grade > 0) {
          w.globalCompositeOperation = 'multiply'
          w.globalAlpha *= b.grade * 0.5
          w.drawImage(p.canvas, x0, y0)
        }
      }
      w.restore()
      // 3D paint needs to know where the paint went: keep the stamps in the stroke mask too.
      if (b.height > 0) {
        const main = this.main as Ctx
        main.save()
        main.globalAlpha = d.alpha
        main.drawImage(t.canvas, x0, y0)
        main.restore()
      }
      // The brush keeps part of what it carried and picks up the rest.
      mix(carry, this.sample.canvas, this.smudge ? 1 - Math.min(0.97, b.opacity) : 0.35, s)
      this.touch(m.x, m.y, d.size, this.main)
    })
  }
}
