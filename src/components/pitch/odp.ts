import { strToU8, zipSync } from 'fflate'
import { H, paragraphsOf, placeImage, xmlEscape as esc, type ExportDeck, type Obj } from './model'

/**
 * 0.35: the deck as an .odp (OpenDocument Presentation), the open standard that LibreOffice Impress
 * and other free office apps use natively. Slides, transitions, hidden slides and speaker notes.
 * shortcut: builds are not written yet, same as the .pptx.
 */

type Box = Pick<Obj, 'x' | 'y' | 'w' | 'h'>
const IN = (px: number) => `${(px / 144).toFixed(4)}in` // 1920 px = 13.333 in
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:smil="urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0" xmlns:anim="urn:oasis:names:tc:opendocument:xmlns:animation:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3"'
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n'
const GEOM: Record<string, string> = { rect: 'rectangle', round: 'round-rectangle', ellipse: 'ellipse', triangle: 'isosceles-triangle' }
const TRANSITION: Record<string, string> = {
  fade: 'smil:type="fade" smil:subtype="crossfade"',
  push: 'smil:type="pushWipe" smil:subtype="fromRight"',
  zoom: 'smil:type="zoom" smil:subtype="rotateIn"',
  // shortcut: no Morph in .odp; it becomes a fade there.
  morph: 'smil:type="fade" smil:subtype="crossfade"',
}

/** Position, keeping rotation around the box centre (ODF rotates around the top left, counter-clockwise). */
function place(o: Obj, box: Box = o) {
  const size = `svg:width="${IN(Math.max(1, box.w))}" svg:height="${IN(Math.max(1, box.h))}"`
  if (!o.rot) return `${size} svg:x="${IN(box.x)}" svg:y="${IN(box.y)}"`
  const a = (o.rot * Math.PI) / 180
  const dx = -box.w / 2
  const dy = -box.h / 2
  const x = box.x + box.w / 2 + dx * Math.cos(a) - dy * Math.sin(a)
  const y = box.y + box.h / 2 + dx * Math.sin(a) + dy * Math.cos(a)
  return `${size} draw:transform="rotate(${(-a).toFixed(6)}) translate(${IN(x)} ${IN(y)})"`
}

export function deckToOdp(deck: ExportDeck): Uint8Array {
  const styles: string[] = []
  const style = (family: string, prefix: string, body: string) => {
    const name = `${prefix}${styles.length + 1}`
    styles.push(`<style:style style:name="${name}" style:family="${family}">${body}</style:style>`)
    return name
  }
  const media = new Map<string, string>()
  const fontOf = (o: Obj) => o.font || deck.theme.font
  const fonts = new Set<string>([deck.theme.font])

  const paragraphs = (o: Obj) => {
    fonts.add(fontOf(o))
    const p = style(
      'paragraph',
      'P',
      `<style:paragraph-properties fo:text-align="${o.align === 'center' ? 'center' : o.align === 'right' ? 'end' : 'start'}"${o.lineHeight ? ` fo:line-height="${Math.round(o.lineHeight * 100)}%"` : ''}/>`,
    )
    const t = style(
      'text',
      'T',
      `<style:text-properties fo:font-size="${((o.size ?? 40) / 2).toFixed(1)}pt" style:font-name="${esc(fontOf(o))}" fo:font-family="'${esc(fontOf(o))}'" fo:color="${o.color ?? '#000000'}"${o.bold ? ' fo:font-weight="bold"' : ''}${o.italic ? ' fo:font-style="italic"' : ''}${o.underline ? ' style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"' : ''}${o.caps ? ' fo:font-variant="small-caps"' : ''}/>`,
    )
    const ps = paragraphsOf(o).map((line) => `<text:p text:style-name="${p}"><text:span text:style-name="${t}">${esc(line)}</text:span></text:p>`)
    return o.bullets ? `<text:list text:style-name="L1">${ps.map((x) => `<text:list-item>${x}</text:list-item>`).join('')}</text:list>` : ps.join('')
  }

  const objXml = (o: Obj): string => {
    if (o.kind === 'image') {
      const img = o.image ? deck.images.get(o.image) : undefined
      if (!o.image || !img) return ''
      if (!media.has(o.image)) media.set(o.image, `Pictures/image${media.size + 1}.png`)
      const p = placeImage(o, img.w, img.h)
      const gr = style('graphic', 'gr', '<style:graphic-properties draw:stroke="none" draw:fill="none"/>')
      return `<draw:frame draw:style-name="${gr}" ${place(o, p)}><draw:image xlink:href="${media.get(o.image)}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`
    }
    const sw = o.strokeW ?? (o.kind === 'shape' ? 4 : 0)
    const stroke = sw > 0 && (o.stroke || o.shape === 'line' || o.shape === 'arrow') ? `draw:stroke="solid" svg:stroke-color="${o.stroke ?? '#000000'}" svg:stroke-width="${IN(sw)}"` : 'draw:stroke="none"'
    const fillC = o.fill ?? (o.kind === 'shape' ? '#cccccc' : undefined)
    const fill = fillC && fillC !== 'none' ? `draw:fill="solid" draw:fill-color="${fillC}"` : 'draw:fill="none"'
    if (o.kind === 'shape' && (o.shape === 'line' || o.shape === 'arrow')) {
      const gr = style('graphic', 'gr', `<style:graphic-properties ${stroke}${o.shape === 'arrow' ? ` draw:marker-end="Arrow" draw:marker-end-width="${IN(sw * 4)}"` : ''}/>`)
      return `<draw:line draw:style-name="${gr}" svg:x1="${IN(o.x)}" svg:y1="${IN(o.y)}" svg:x2="${IN(o.x + o.w)}" svg:y2="${IN(o.y + o.h)}"/>`
    }
    const text = o.text ? paragraphs(o) : ''
    const pad = 'fo:padding-top="0in" fo:padding-bottom="0in" fo:padding-left="0in" fo:padding-right="0in"'
    if (o.kind === 'text') {
      const gr = style('graphic', 'gr', `<style:graphic-properties ${stroke} ${fill} draw:textarea-vertical-align="top" draw:auto-grow-height="false" ${pad}/>`)
      return `<draw:frame draw:style-name="${gr}" ${place(o)}><draw:text-box>${text}</draw:text-box></draw:frame>`
    }
    const gr = style('graphic', 'gr', `<style:graphic-properties ${stroke} ${fill} draw:textarea-vertical-align="middle" draw:auto-grow-height="false" draw:auto-grow-width="false" ${pad}/>`)
    return `<draw:custom-shape draw:style-name="${gr}" ${place(o)}>${text}<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="${GEOM[o.shape ?? 'rect']}"/></draw:custom-shape>`
  }

  const pages = deck.slides
    .map((s, i) => {
      const dp = style(
        'drawing-page',
        'dp',
        `<style:drawing-page-properties draw:fill="solid" draw:fill-color="${s.bg}" presentation:background-visible="true" presentation:background-objects-visible="true"${s.hidden ? ' presentation:visibility="hidden"' : ''}${TRANSITION[s.transition] ? ` ${TRANSITION[s.transition]} presentation:transition-speed="medium"` : ''}/>`,
      )
      const notes = s.notes.trim()
        ? `<presentation:notes><draw:frame presentation:class="notes" svg:width="6.5in" svg:height="4.5in" svg:x="1in" svg:y="5in"><draw:text-box>${s.notes
            .split('\n')
            .map((l) => `<text:p>${esc(l)}</text:p>`)
            .join('')}</draw:text-box></draw:frame></presentation:notes>`
        : ''
      return `<draw:page draw:name="Slide ${i + 1}" draw:style-name="${dp}" draw:master-page-name="Default">${s.objs.map(objXml).join('')}${notes}</draw:page>`
    })
    .join('')

  const fontDecls = `<office:font-face-decls>${[...fonts].map((f) => `<style:font-face style:name="${esc(f)}" svg:font-family="'${esc(f)}'"/>`).join('')}</office:font-face-decls>`
  const list = `<text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:space-before="0in" text:min-label-width="0.3in"/></text:list-level-style-bullet></text:list-style>`
  const content = `${HEAD}<office:document-content ${NS}>${fontDecls}<office:automatic-styles>${styles.join('')}${list}</office:automatic-styles><office:body><office:presentation>${pages}</office:presentation></office:body></office:document-content>`
  const stylesXml = `${HEAD}<office:document-styles ${NS}>${fontDecls}<office:styles><draw:marker draw:name="Arrow" svg:viewBox="0 0 20 30" svg:d="M10 0l-10 30h20z"/><style:default-style style:family="graphic"><style:graphic-properties draw:stroke="none"/><style:text-properties fo:font-size="18pt" style:font-name="${esc(deck.theme.font)}" fo:color="${deck.theme.ink}"/></style:default-style></office:styles><office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:margin-top="0in" fo:margin-bottom="0in" fo:margin-left="0in" fo:margin-right="0in" fo:page-width="${IN(deck.width)}" fo:page-height="${IN(H)}" style:print-orientation="landscape"/></style:page-layout><style:style style:name="dpDefault" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="${deck.theme.bg}"/></style:style></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1" draw:style-name="dpDefault"/></office:master-styles></office:document-styles>`
  const meta = `${HEAD}<office:document-meta ${NS}><office:meta><meta:generator>EVLMG Designer</meta:generator><dc:title>${esc(deck.title)}</dc:title></office:meta></office:document-meta>`
  const manifest = `${HEAD}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.presentation"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${[...media.values()].map((p) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="image/png"/>`).join('')}</manifest:manifest>`

  // The mimetype file must come first and be stored uncompressed.
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { mimetype: [strToU8('application/vnd.oasis.opendocument.presentation'), { level: 0 }] }
  files['content.xml'] = strToU8(content)
  files['styles.xml'] = strToU8(stylesXml)
  files['meta.xml'] = strToU8(meta)
  for (const [path, file] of media) files[file] = deck.images.get(path)!.png
  files['META-INF/manifest.xml'] = strToU8(manifest)
  return zipSync(files)
}
