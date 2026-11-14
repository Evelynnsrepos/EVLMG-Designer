import { brushTip, StrokeStamper, type BrushSettings, type Dab } from './brushes'
import { clip, rgb, type GpuPainter, type GpuSurface, type Tex } from './gpuPaint'

/** Wet stamps are capped at this size (as in brushWet.ts), so the brush's colour fits one texture. */
const CAP = 400

/**
 * Wet mix and the Smudge tool on the GPU (0.31): the same steps as WetStamper, stamp by stamp,
 * on a working copy of the layer that stays on the graphics card. Every stamp picks up the colour
 * under it into the brush and lays paint (or the picked-up colour) back down.
 */
export class GpuWetStamper extends StrokeStamper {
  /** The layer as it is being painted; it replaces the layer (inside the selection). */
  readonly work: Tex
  private gpu: GpuPainter
  private layer: Tex
  private smudge: boolean
  /** Colour carried by the brush, one per mirror copy, in the corner of a CAP×CAP texture. */
  private carried: ({ t: Tex; s: number } | null)[] = []

  constructor(surf: GpuSurface, brush: BrushSettings, mirror: ((p: { x: number; y: number }) => { x: number; y: number }[]) | undefined, seed: number | undefined, color: string, layer: Tex, smudge: boolean) {
    super(surf, { ...brush, tipAnimation: false, dual: null }, mirror, seed, color)
    this.gpu = surf.painter
    this.layer = layer
    this.smudge = smudge
    this.work = this.gpu.temp('wet-work')
    this.gpu.copy(layer, this.work, null)
  }

  protected restart() {
    super.restart()
    this.gpu.copy(this.layer, this.work, null)
    this.carried = []
  }

  protected drawDab(d: Dab) {
    const b = this.brush
    const gpu = this.gpu
    const s = Math.max(2, Math.ceil(Math.min(CAP, d.size)))
    const k = s / d.size
    const sample = gpu.temp('wet-sample', CAP, CAP)
    const spare = gpu.temp('wet-mix', CAP, CAP)
    const blur = gpu.temp('wet-blur')
    const main = this.main as GpuSurface
    this.mirror({ x: d.x, y: d.y }).forEach((m, i) => {
      const x0 = Math.round(m.x - s / 2)
      const y0 = Math.round(m.y - s / 2)
      const around = (pad: number) => clip({ x: x0 - pad, y: y0 - pad, w: s + 2 * pad, h: s + 2 * pad }, gpu.width, gpu.height)
      // What is under the stamp now.
      const sigma = (b.wetBlur * s) / 8
      const r = sigma > 0 ? around(Math.ceil(sigma * 3)) : null
      if (r) gpu.blurRgba(this.work, blur, r, sigma)
      gpu.region(r ? blur : this.work, sample, x0, y0, s, s)
      let carry = this.carried[i]
      if (!carry || carry.s !== s) {
        const t = gpu.temp(`wet-carry${i}`, CAP, CAP)
        if (carry) {
          gpu.region(carry.t, spare, 0, 0, s, s, carry.s / s)
          gpu.copy(spare, t, { x: 0, y: 0, w: s, h: s })
        } else gpu.copy(sample, t, { x: 0, y: 0, w: s, h: s })
        carry = this.carried[i] = { t, s }
      }
      let mode: 0 | 1 | 2 = this.smudge ? 1 : 0
      let fillA = 0
      if (this.smudge && b.smudgeMode === 'blur') {
        // Blur: soften what is under the stamp instead of dragging colour; Blur sets how much.
        const radius = Math.max(1, ((0.15 + b.wetBlur) * s) / 6)
        const rr = around(Math.ceil(radius * 3))
        if (rr) gpu.blurRgba(this.work, blur, rr, radius)
        mode = 2
      } else if (!this.smudge) {
        const left = b.charge >= 1 ? 1 : Math.exp(-d.at / (b.charge * 1500 + 20))
        const water = Math.min(1, b.dilution * (1 + (this.rand() - 0.5) * b.wetJitter))
        fillA = (1 - water * 0.9) * left
      }
      const alpha = this.smudge ? d.alpha : d.alpha * (0.1 + 0.9 * b.attack) * b.opacity
      gpu.wetStamp(this.work, gpu.temp('wet-spare'), carry.t, mode === 2 ? blur : null, brushTip(b), b.shapeFiltering, {
        x0,
        y0,
        s,
        k,
        rot: d.rot,
        sx: d.sx,
        sy: d.round * d.sy,
        size: d.size,
        mode,
        color: rgb(d.color ?? this.strokeColor),
        fillA,
        pull: b.pull,
        alpha,
        grade: this.smudge ? 0 : b.grade,
      })
      // 3D paint needs to know where the paint went: keep the stamps in the stroke mask too.
      if (b.height > 0) main.dab({ x: x0 + s / 2, y: y0 + s / 2, size: d.size, rot: d.rot, sx: d.sx, sy: d.round * d.sy, alpha: d.alpha, at: d.at, color: null })
      // The brush keeps part of what it carried and picks up the rest.
      gpu.mix(carry.t, sample, spare, s, this.smudge ? 1 - Math.min(0.97, b.opacity) : 0.35)
      gpu.copy(spare, carry.t, { x: 0, y: 0, w: s, h: s })
      main.mark({ x: x0, y: y0, w: s, h: s })
      this.touch(m.x, m.y, d.size, main)
    })
  }
}
