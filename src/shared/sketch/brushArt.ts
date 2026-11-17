/**
 * Built-in brush pictures drawn in code (v0.35): ropes, chains, ribbons, hair, grass and leaves.
 * Each is drawn in greys on a 128-unit square: mid grey (128) keeps the brush colour, darker greys
 * shade it, lighter ones light it (when the brush keeps the image's light and dark). Strips for the
 * ribbon mode run along x and repeat every 128 units without a seam; y goes across the stroke.
 * All drawn from scratch here, no image files.
 */

export const ART_SHAPES = [
  { id: 'rope', label: 'Rope (strip)' },
  { id: 'cord', label: 'Twisted cord (strip)' },
  { id: 'chain', label: 'Chain (strip)' },
  { id: 'chain-flat', label: 'Flat chain (strip)' },
  { id: 'ball-chain', label: 'Ball chain (strip)' },
  { id: 'barbed', label: 'Barbed wire (strip)' },
  { id: 'satin', label: 'Satin ribbon (strip)' },
  { id: 'ribbon-twist', label: 'Twisting ribbon (strip)' },
  { id: 'ribbon-stitched', label: 'Stitched ribbon (strip)' },
  { id: 'ribbon-striped', label: 'Striped ribbon (strip)' },
  { id: 'vine', label: 'Vine (strip)' },
  { id: 'braid', label: 'Braid (strip)' },
  { id: 'braid-flat', label: 'Flat braid (strip)' },
  { id: 'twist', label: 'Two-strand twist (strip)' },
  { id: 'loc', label: 'Loc (strip)' },
  { id: 'strands', label: 'Straight strands (strip)' },
  { id: 'wave-strands', label: 'Wavy strands (strip)' },
  { id: 'coil', label: 'Coils' },
  { id: 'ringlet', label: 'Ringlet' },
  { id: 'knot', label: 'Knot' },
  { id: 'blade', label: 'Grass blade' },
  { id: 'reed', label: 'Reeds' },
  { id: 'oak-leaf', label: 'Oak leaf' },
  { id: 'maple-leaf', label: 'Maple leaf' },
  { id: 'round-leaf', label: 'Round leaf' },
  { id: 'fern', label: 'Fern' },
  { id: 'pine', label: 'Pine needles' },
] as const
export type ArtShape = (typeof ART_SHAPES)[number]['id']

const ART = new Set<string>(ART_SHAPES.map((s) => s.id))
export const isArtShape = (id: string): id is ArtShape => ART.has(id)

type G = CanvasRenderingContext2D
const grey = (v: number, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`
const TAU = Math.PI * 2

/** Draw `fn` at x - 128, x and x + 128 so strips repeat without a seam. */
const tiled = (g: G, fn: () => void) => {
  for (const dx of [-128, 0, 128]) {
    g.save()
    g.translate(dx, 0)
    fn()
    g.restore()
  }
}

/** A gradient across a band from y0 to y1: [position 0..1, grey] stops. */
function across(g: G, y0: number, y1: number, stops: [number, number][]) {
  const gr = g.createLinearGradient(0, y0, 0, y1)
  for (const [at, v] of stops) gr.addColorStop(at, grey(v))
  return gr
}

const TUBE: [number, number][] = [
  [0, 40],
  [0.3, 140],
  [0.45, 200],
  [0.7, 120],
  [1, 45],
]

/** A long rounded lobe (rope strand, braid section) at cx, cy turned by `angle`, shaded like a tube, with hair-fine lines. */
function lobe(g: G, cx: number, cy: number, rx: number, ry: number, angle: number, fibres: number, rnd: () => number) {
  g.save()
  g.translate(cx, cy)
  g.rotate(angle)
  g.beginPath()
  g.ellipse(0, 0, rx, ry, 0, 0, TAU)
  g.fillStyle = across(g, -ry, ry, TUBE)
  g.fill()
  g.clip()
  g.lineWidth = 0.7
  for (let i = 0; i < fibres; i++) {
    const y = (rnd() - 0.5) * ry * 1.7
    g.strokeStyle = grey(70 + rnd() * 90, 0.55)
    g.beginPath()
    g.moveTo(-rx, y)
    g.quadraticCurveTo(0, y + (rnd() - 0.5) * ry * 0.5, rx, y)
    g.stroke()
  }
  g.restore()
}

/** Strands twisted round each other (rope, cord, twist): `n` strands per 128 units at `angle`. */
function twisted(g: G, n: number, angle: number, y0: number, y1: number, fibres: number, rnd: () => number) {
  const step = 128 / n
  const ry = ((step * Math.sin(angle)) / 2) * 1.08
  const rx = ((y1 - y0) / Math.sin(angle)) * 0.62
  g.save()
  g.beginPath()
  g.rect(-200, y0, 600, y1 - y0)
  g.clip()
  for (let i = -n; i < n * 2; i++) lobe(g, i * step + step / 2, (y0 + y1) / 2, rx, ry, -angle, fibres, rnd)
  g.restore()
}

/** An oval chain link (ring) with a light top edge and dark outline. */
function ring(g: G, cx: number, cy: number, rx: number, ry: number, w: number) {
  const el = (r: number, s: number, lw: number, style: string, dy = 0) => {
    g.beginPath()
    g.ellipse(cx, cy + dy, rx + r, ry + r * (ry / rx) * s, 0, 0, TAU)
    g.lineWidth = lw
    g.strokeStyle = style
    g.stroke()
  }
  el(0, 1, w + 2, grey(25))
  el(0, 1, w, grey(130))
  el(-w * 0.15, 1, w * 0.3, grey(215), -w * 0.15)
}

/** A leaf outline (pointed both ends) from the stem at the bottom, `w` wide, `h` long. */
function leafPath(g: G, x: number, y: number, w: number, h: number) {
  g.beginPath()
  g.moveTo(x, y)
  g.bezierCurveTo(x + w, y - h * 0.25, x + w * 0.7, y - h * 0.85, x, y - h)
  g.bezierCurveTo(x - w * 0.7, y - h * 0.85, x - w, y - h * 0.25, x, y)
}

function veins(g: G, x: number, y: number, h: number, w: number, v: number) {
  g.strokeStyle = grey(v)
  g.lineWidth = 1.6
  g.beginPath()
  g.moveTo(x, y)
  g.lineTo(x, y - h * 0.95)
  for (let i = 1; i < 5; i++) {
    const yy = y - (h * i) / 5.5
    g.moveTo(x, yy)
    g.lineTo(x + w * 0.55, yy - h * 0.12)
    g.moveTo(x, yy)
    g.lineTo(x - w * 0.55, yy - h * 0.12)
  }
  g.stroke()
}

/** Paint one built-in picture in greys on a 128-unit square (the caller scales it to the tip size). */
export function drawArt(g: G, shape: ArtShape, rnd: () => number) {
  g.lineCap = 'round'
  g.lineJoin = 'round'
  switch (shape) {
    case 'rope':
      return twisted(g, 3, (55 * Math.PI) / 180, 10, 118, 6, rnd)
    case 'cord':
      return twisted(g, 2, (58 * Math.PI) / 180, 24, 104, 3, rnd)
    case 'twist':
      return twisted(g, 2, (48 * Math.PI) / 180, 12, 116, 14, rnd)
    case 'braid':
    case 'braid-flat': {
      const flat = shape === 'braid-flat'
      const [rx, ry, a, top, bottom] = flat ? [34, 13, 0.8, 54, 76] : [40, 18, 0.62, 46, 82]
      const fibres = flat ? 8 : 12
      tiled(g, () => {
        for (let i = 0; i < 6; i++) {
          const upper = i % 2 === 0
          lobe(g, (i * 128) / 6 + 10, upper ? top : bottom, rx, ry, upper ? a : -a, fibres, rnd)
        }
      })
      return
    }
    case 'loc': {
      // A thick, slightly uneven cylinder with matte texture and a little fuzz at the edges.
      const r = (x: number) => 44 + 4 * Math.sin((TAU * 2 * x) / 128 + 1) + 2.5 * Math.sin((TAU * 5 * x) / 128)
      g.fillStyle = across(g, 14, 114, TUBE)
      for (let x = 0; x < 128; x += 0.5) g.fillRect(x, 64 - r(x), 0.6, r(x) * 2)
      for (let i = 0; i < 1400; i++) {
        const x = rnd() * 128
        const y = 64 + (rnd() * 2 - 1) * r(x) * 0.95
        g.fillStyle = grey(rnd() < 0.5 ? 60 : 190, 0.25)
        g.fillRect(x, y, 1.2, 1.2)
      }
      g.lineWidth = 0.6
      for (let i = 0; i < 50; i++) {
        const x = rnd() * 128
        const side = rnd() < 0.5 ? -1 : 1
        const y = 64 + side * r(x)
        g.strokeStyle = grey(110, 0.7)
        g.beginPath()
        g.moveTo(x, y)
        g.quadraticCurveTo(x + (rnd() - 0.5) * 8, y + side * 4, x + (rnd() - 0.5) * 6, y + side * (3 + rnd() * 5))
        g.stroke()
      }
      return
    }
    case 'strands':
    case 'wave-strands': {
      // Fine hairs along the stroke; the straight ones get a light sheen band across them.
      const wave = shape === 'wave-strands'
      for (let i = 0; i < 70; i++) {
        const y0 = 8 + rnd() * 112
        const amp = wave ? 12 + rnd() * 4 : rnd() * 2
        const ph = wave ? rnd() * 0.5 : rnd() * TAU
        const base = 80 + rnd() * 70
        g.lineWidth = 0.5 + rnd() * 1.1
        for (let x = 0; x < 128; x += 4) {
          const yA = y0 + amp * Math.sin((TAU * x) / 128 + ph)
          const yB = y0 + amp * Math.sin((TAU * (x + 4)) / 128 + ph)
          const sheen = wave ? 50 * Math.max(0, Math.cos((TAU * x) / 128 + ph)) : 90 * Math.exp(-(((x - 64) / 16) ** 2))
          g.strokeStyle = grey(Math.min(250, base + sheen), 0.85)
          g.beginPath()
          g.moveTo(x, yA)
          g.lineTo(x + 4, yB)
          g.stroke()
        }
      }
      return
    }
    case 'satin':
    case 'ribbon-stitched':
    case 'ribbon-striped': {
      g.fillStyle = across(g, 14, 114, [
        [0, 60],
        [0.06, 150],
        [0.28, 215],
        [0.5, 165],
        [0.8, 115],
        [0.94, 95],
        [1, 55],
      ])
      g.fillRect(0, 14, 128, 100)
      if (shape === 'ribbon-striped') {
        g.globalCompositeOperation = 'multiply'
        g.fillStyle = grey(150)
        g.fillRect(0, 34, 128, 12)
        g.fillRect(0, 82, 128, 12)
        g.fillStyle = grey(110)
        g.fillRect(0, 58, 128, 12)
        g.globalCompositeOperation = 'source-over'
      }
      if (shape === 'ribbon-stitched') {
        g.setLineDash([6, 4])
        g.lineWidth = 1.8
        g.strokeStyle = grey(235)
        for (const y of [24, 104]) {
          g.beginPath()
          g.moveTo(0, y)
          g.lineTo(128, y)
          g.stroke()
        }
        g.setLineDash([])
      }
      return
    }
    case 'ribbon-twist':
      // The ribbon turns over every 128 units: wide and light on the front, narrow at the fold, darker on the back.
      for (let x = 0; x < 128; x += 0.5) {
        const c = Math.cos((TAU * x) / 128)
        const h = 50 * (0.1 + 0.9 * Math.abs(c))
        g.fillStyle = grey(c > 0 ? 70 + 150 * c : 60 + 70 * -c)
        g.fillRect(x, 64 - h, 0.6, h * 2)
        g.fillStyle = grey(30)
        g.fillRect(x, 64 - h, 0.6, 1.5)
        g.fillRect(x, 64 + h - 1.5, 0.6, 1.5)
      }
      return
    case 'chain':
      tiled(g, () => {
        ring(g, 32, 64, 34, 26, 11)
        const bar = across(g, 56, 72, TUBE)
        g.fillStyle = grey(25)
        g.beginPath()
        g.roundRect(60, 55, 72, 18, 9)
        g.fill()
        g.fillStyle = bar
        g.beginPath()
        g.roundRect(61, 56, 70, 16, 8)
        g.fill()
      })
      return
    case 'chain-flat':
      tiled(g, () => {
        ring(g, 0, 64, 40, 24, 9)
        ring(g, 64, 64, 40, 24, 9)
      })
      return
    case 'ball-chain':
      g.fillStyle = grey(110)
      g.fillRect(0, 62.5, 128, 3)
      tiled(g, () => {
        for (let i = 0; i < 2; i++) {
          const cx = 64 * i + 32
          const gr = g.createRadialGradient(cx - 8, 56, 1, cx, 64, 26)
          gr.addColorStop(0, grey(235))
          gr.addColorStop(0.45, grey(140))
          gr.addColorStop(1, grey(40))
          g.fillStyle = gr
          g.beginPath()
          g.arc(cx, 64, 26, 0, TAU)
          g.fill()
        }
      })
      return
    case 'barbed':
      for (const s of [1, -1]) {
        g.beginPath()
        for (let x = 0; x <= 128; x += 2) g.lineTo(x, 64 + s * 6 * Math.sin((TAU * x) / 64))
        g.lineWidth = 5.5
        g.strokeStyle = grey(30)
        g.stroke()
        g.lineWidth = 3.5
        g.strokeStyle = grey(165)
        g.stroke()
      }
      g.lineWidth = 2.6
      g.strokeStyle = grey(120)
      for (const x of [32, 96])
        for (const [dx, dy] of [
          [-10, -24],
          [10, 24],
          [10, -22],
          [-10, 22],
        ]) {
          g.beginPath()
          g.moveTo(x, 64)
          g.lineTo(x + dx, 64 + dy)
          g.stroke()
        }
      return
    case 'vine':
      tiled(g, () => {
        g.beginPath()
        for (let x = 0; x <= 128; x += 2) g.lineTo(x, 64 + 10 * Math.sin((TAU * x) / 128))
        g.lineWidth = 4
        g.strokeStyle = grey(90)
        g.stroke()
        for (const [x, up] of [
          [32, true],
          [96, false],
        ] as const) {
          g.save()
          g.translate(x, 64 + 10 * Math.sin((TAU * x) / 128))
          g.rotate(up ? -0.5 : Math.PI + 0.5)
          leafPath(g, 0, 0, 16, 46)
          g.fillStyle = across(g, 0, -46, [
            [0, 110],
            [0.5, 170],
            [1, 130],
          ])
          g.fill()
          veins(g, 0, 0, 44, 16, 95)
          g.restore()
        }
      })
      return
    case 'coil':
      // Tiny tight springs, several per stamp.
      for (let c = 0; c < 16; c++) {
        const cx = 24 + rnd() * 80
        const cy = 24 + rnd() * 80
        const a = rnd() * TAU
        const rad = 2.5 + rnd() * 2
        g.save()
        g.translate(cx, cy)
        g.rotate(a)
        g.lineWidth = 1.4
        g.strokeStyle = grey(90 + rnd() * 80)
        g.beginPath()
        for (let t = 0; t <= TAU * 4; t += 0.25) g.lineTo(-9 + t * 0.7 + rad * Math.cos(t), rad * Math.sin(t))
        g.stroke()
        g.restore()
      }
      return
    case 'ringlet':
      // One springy curl running down the stamp: lighter where the hair turns towards you.
      g.lineWidth = 7
      for (let t = 0; t < TAU * 5.5; t += 0.12) {
        const p = (u: number) => [64 + 20 * Math.cos(u), 8 + u * 3.2 + 7 * Math.sin(u)]
        const [x0, y0] = p(t)
        const [x1, y1] = p(t + 0.14)
        g.strokeStyle = grey(Math.sin(t) > 0 ? 170 : 75)
        g.beginPath()
        g.moveTo(x0, y0)
        g.lineTo(x1, y1)
        g.stroke()
      }
      return
    case 'knot': {
      // A coiled knot sitting on the head: a shaded dome with a spiral of hair.
      const gr = g.createRadialGradient(54, 52, 4, 64, 64, 54)
      gr.addColorStop(0, grey(190))
      gr.addColorStop(0.6, grey(120))
      gr.addColorStop(1, grey(50))
      g.fillStyle = gr
      g.beginPath()
      g.arc(64, 64, 54, 0, TAU)
      g.fill()
      g.beginPath()
      for (let t = 0; t < TAU * 3.3; t += 0.1) g.lineTo(64 + (3 + t * 2.5) * Math.cos(t), 64 + (3 + t * 2.5) * Math.sin(t))
      g.lineWidth = 3
      g.strokeStyle = grey(45)
      g.stroke()
      return
    }
    case 'blade': {
      g.beginPath()
      g.moveTo(56, 126)
      g.quadraticCurveTo(58, 60, 84, 4)
      g.quadraticCurveTo(66, 60, 72, 126)
      g.fillStyle = across(g, 0, 128, [
        [0, 170],
        [1, 100],
      ])
      g.fill()
      g.strokeStyle = grey(190)
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(64, 124)
      g.quadraticCurveTo(64, 64, 82, 8)
      g.stroke()
      return
    }
    case 'reed':
      for (const [x, lean, top, head] of [
        [50, -10, 6, true],
        [66, 8, 20, false],
        [78, 20, 30, true],
        [58, -22, 40, false],
      ] as const) {
        g.strokeStyle = grey(120 + lean)
        g.lineWidth = 3
        g.beginPath()
        g.moveTo(x, 126)
        g.quadraticCurveTo(x + lean * 0.2, (126 + top) / 2, x + lean, top)
        g.stroke()
        if (head) {
          g.fillStyle = grey(70)
          g.beginPath()
          g.ellipse(x + lean * 0.85, top + 16, 4.5, 13, lean * 0.01, 0, TAU)
          g.fill()
        }
      }
      return
    case 'oak-leaf': {
      g.fillStyle = grey(140)
      g.beginPath()
      g.ellipse(64, 66, 18, 50, 0, 0, TAU)
      g.fill()
      for (let i = 0; i < 4; i++) {
        const y = 32 + i * 21
        const rad = 14 - i
        for (const s of [-1, 1]) {
          g.beginPath()
          g.arc(64 + s * (18 + rad * 0.3), y + (s > 0 ? 5 : 0), rad, 0, TAU)
          g.fill()
        }
      }
      g.fillRect(62, 110, 4, 16)
      veins(g, 64, 116, 96, 34, 90)
      return
    }
    case 'maple-leaf': {
      g.fillStyle = grey(150)
      g.beginPath()
      const n = 160
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * TAU
        const lobes = 0.55 + 0.45 * Math.pow(Math.abs(Math.cos(2.5 * (t + Math.PI / 2))), 0.6)
        const teeth = 1 + 0.06 * Math.sin(t * 30)
        const rad = 54 * lobes * teeth * (Math.sin(t) > 0.85 ? 0.5 : 1)
        g.lineTo(64 + rad * Math.cos(t), 62 - rad * Math.sin(t))
      }
      g.fill()
      g.strokeStyle = grey(95)
      g.lineWidth = 1.6
      g.beginPath()
      for (const a of [Math.PI / 2, Math.PI / 2 + 1.26, Math.PI / 2 - 1.26, Math.PI / 2 + 2.3, Math.PI / 2 - 2.3]) {
        g.moveTo(64, 62)
        g.lineTo(64 + 48 * Math.cos(a), 62 - 48 * Math.sin(a))
      }
      g.moveTo(64, 62)
      g.lineTo(64, 126)
      g.stroke()
      return
    }
    case 'round-leaf': {
      leafPath(g, 64, 122, 62, 116)
      const gr = g.createRadialGradient(52, 50, 4, 64, 64, 64)
      gr.addColorStop(0, grey(200))
      gr.addColorStop(1, grey(85))
      g.fillStyle = gr
      g.fill()
      veins(g, 64, 122, 112, 48, 100)
      return
    }
    case 'fern': {
      g.strokeStyle = grey(100)
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(64, 126)
      g.quadraticCurveTo(58, 60, 70, 4)
      g.stroke()
      g.fillStyle = grey(145)
      for (let i = 0; i < 13; i++) {
        const t = i / 13
        const y = 120 - t * 112
        const x = 64 - 6 * Math.sin(t * Math.PI) + t * 6
        const len = 26 * (1 - t * 0.8)
        for (const s of [-1, 1]) {
          g.save()
          g.translate(x, y)
          g.rotate(s * 1.15)
          g.beginPath()
          g.ellipse(0, -len / 2, 3.2 * (1 - t * 0.5), len / 2, 0, 0, TAU)
          g.fill()
          g.restore()
        }
      }
      return
    }
    case 'pine':
      g.lineWidth = 1.4
      for (let i = 0; i < 26; i++) {
        const a = -Math.PI / 2 + (rnd() - 0.5) * 1.6
        const len = 50 + rnd() * 50
        g.strokeStyle = grey(90 + rnd() * 80)
        g.beginPath()
        g.moveTo(64, 120)
        g.lineTo(64 + Math.cos(a) * len, 120 + Math.sin(a) * len)
        g.stroke()
      }
      g.fillStyle = grey(70)
      g.fillRect(61, 112, 6, 14)
      return
  }
}
