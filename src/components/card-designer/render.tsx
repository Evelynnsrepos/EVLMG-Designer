import type Konva from 'konva'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Group, Layer, Stage } from 'react-konva'
import { preloadImage, renderOrder, type CanvasTheme, type NodeTypes, type RenderContext, type Scene } from '@/shared/canvas'
import { cssFamily } from '@/shared/fontList'
import { mmToPx } from '@/shared/print'
import { MM, type CardDoc, type CardNode } from './model'

/** Wait until the fonts a scene uses are loaded, so canvas text isn't drawn in a fallback font. */
export async function loadSceneFonts(scenes: Scene<CardNode>[]) {
  const families = new Set<string>()
  for (const s of scenes) for (const n of s.nodes) if (n.kind === 'card-text') families.add(`${n.italic ? 'italic ' : ''}${n.bold ? 'bold ' : ''}16px ${cssFamily(n.fontFamily)}`)
  await Promise.all([...families].map((f) => document.fonts.load(f).catch(() => [])))
}

/**
 * Draw one card side, bleed included, at a print resolution, off screen. Images must be preloaded
 * (`preloadImages`) so the first draw already shows them.
 */
export function renderCard(doc: CardDoc, scene: Scene<CardNode>, types: NodeTypes, resolveImageSrc: (p: string) => string, dpi: number, withBleed = true): HTMLCanvasElement {
  const b = withBleed ? doc.bleedMm : 0
  const wMm = doc.widthMm + 2 * b
  const hMm = doc.heightMm + 2 * b
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;'
  document.body.append(host)
  const root = createRoot(host)
  const theme = { bg: '#fff', bgElevated: '#fff', bgSunken: '#fff', border: '#ccc', text: '#1c1d22', textMuted: '#666', accent: '#7c5cff', danger: '#e5484d', focus: '#7c5cff', font: 'sans-serif' } satisfies CanvasTheme
  const ctx: RenderContext = { theme, resolveImageSrc, getNode: () => undefined, getWorldBounds: () => null }
  let stage: Konva.Stage | null = null
  try {
    flushSync(() =>
      root.render(
        <Stage ref={(s) => void (stage = s)} width={wMm * MM} height={hMm * MM} x={b * MM} y={b * MM}>
          <Layer>
            {renderOrder(scene).map(({ layer, nodes }) =>
              layer.hidden ? null : (
                <Group key={layer.id}>
                  {nodes.map((n) => {
                    const t = types[n.kind]
                    if (!t || n.hidden) return null
                    return t.absolute ? (
                      <Group key={n.id}>{t.render(n, ctx)}</Group>
                    ) : (
                      <Group key={n.id} x={n.x} y={n.y} rotation={n.rotation ?? 0} scaleX={n.scaleX ?? 1} scaleY={n.scaleY ?? 1}>
                        {t.render(n, ctx)}
                      </Group>
                    )
                  })}
                </Group>
              ),
            )}
          </Layer>
        </Stage>,
      ),
    )
    if (!stage) throw new Error('Could not draw the card.')
    const px = mmToPx(wMm, dpi)
    return (stage as Konva.Stage).toCanvas({ pixelRatio: px / (wMm * MM) })
  } finally {
    root.unmount()
    host.remove()
  }
}

/** Load every picture the cards will show into the canvas image cache; returns a resolver for `renderCard`. */
export async function preloadImages(paths: string[], resolveUrl: (p: string) => Promise<string | null>): Promise<(p: string) => string> {
  const urls = new Map<string, string>()
  await Promise.all(
    [...new Set(paths.filter(Boolean))].map(async (p) => {
      const url = await resolveUrl(p).catch(() => null)
      if (!url) return
      urls.set(p, url)
      await preloadImage(url)
    }),
  )
  return (p) => urls.get(p) ?? (/^(data|blob|https?):/.test(p) ? p : '')
}
