import { strToU8, zipSync } from 'fflate'
import { normalizeRichText, type LabelResolver, type RichTextDoc } from '@/shared/richtext'
import { REF_CARD_NODE, REF_NODE, refLabel, targetLabel } from '@/shared/richtext/doc'
import type { WriterPage } from './document'

/**
 * A .docx file from a Writer document (0.35), written by hand: Office Open XML is a zip of a few
 * XML files. Opens in common word processors. Covers what the Writer has: styles,
 * fonts, colours, small caps, lists, tables with merged and coloured cells, page breaks, pictures,
 * header, footer and page numbers. Comments, hidden notes and crossed-out tracked text are left out.
 */

export interface DocxImage {
  bytes: Uint8Array
  /** 'png' | 'jpeg' | 'gif' */
  ext: string
  width: number
  height: number
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
// Control characters are not allowed in XML.
// oxlint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

/** '#rgb', '#rrggbb' or 'rgb(r, g, b)' to 'RRGGBB'; null when it is something else. */
export function hexColor(c: unknown): string | null {
  if (typeof c !== 'string') return null
  let m = /^#([0-9a-f]{3})$/i.exec(c)
  if (m) return m[1].split('').map((x) => x + x).join('').toUpperCase()
  m = /^#([0-9a-f]{6})$/i.exec(c)
  if (m) return m[1].toUpperCase()
  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(c)
  return m ? [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase() : null
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const DRAW_NS =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
/** Text width of an A4 page with 2.5 cm margins, in EMU. */
const TEXT_WIDTH_EMU = 5_760_000
const has = (n: RichTextDoc, type: string) => n.marks?.some((m) => m.type === type) ?? false
const mark = (n: RichTextDoc, type: string) => n.marks?.find((m) => m.type === type)

export function richTextToDocx(title: string, body: unknown, page: WriterPage, resolve: LabelResolver, images: Map<string, DocxImage> = new Map()): Uint8Array {
  const doc = normalizeRichText(body)
  const rels: string[] = []
  const media: Record<string, Uint8Array> = {}
  const notes: string[] = []
  const lists: string[] = []
  let picId = 0

  const run = (text: string, n: RichTextDoc, extra = '') => {
    const p: string[] = []
    const font = mark(n, 'font')?.attrs
    if (font?.family) p.push(`<w:rFonts w:ascii="${esc(font.family)}" w:hAnsi="${esc(font.family)}" w:cs="${esc(font.family)}"/>`)
    if (has(n, 'bold')) p.push('<w:b/>')
    if (has(n, 'italic')) p.push('<w:i/>')
    if (has(n, 'strike')) p.push('<w:strike/>')
    if (has(n, 'smallCaps')) p.push('<w:smallCaps/>')
    const color = hexColor(mark(n, 'textColor')?.attrs?.color) ?? (has(n, 'link') ? '2F6FDD' : null)
    if (color) p.push(`<w:color w:val="${color}"/>`)
    if (font?.size) p.push(`<w:sz w:val="${Math.round(font.size * 2)}"/>`)
    if (has(n, 'underline') || has(n, 'link')) p.push('<w:u w:val="single"/>')
    const hl = mark(n, 'highlight')
    if (hl) p.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hexColor(hl.attrs?.color) ?? 'FFF3A3'}"/>`)
    if (has(n, 'superscript')) p.push('<w:vertAlign w:val="superscript"/>')
    if (has(n, 'subscript')) p.push('<w:vertAlign w:val="subscript"/>')
    if (has(n, 'code')) p.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>')
    p.push(extra)
    const rpr = p.join('') ? `<w:rPr>${p.join('')}</w:rPr>` : ''
    return `<w:r>${rpr}<w:t xml:space="preserve">${esc(clean(text))}</w:t></w:r>`
  }

  const picture = (src: string, widthPct: number | null) => {
    const img = images.get(src)
    if (!img) return ''
    const id = `rIdImg${++picId}`
    const name = `image${picId}.${img.ext === 'jpeg' ? 'jpg' : img.ext}`
    media[`word/media/${name}`] = img.bytes
    rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`)
    const natural = img.width * 9525
    const cx = Math.round(widthPct ? (TEXT_WIDTH_EMU * widthPct) / 100 : Math.min(natural, TEXT_WIDTH_EMU))
    const cy = Math.round((cx * img.height) / Math.max(1, img.width))
    return `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${picId}" name="${name}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${picId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  }

  const inline = (nodes: RichTextDoc[] | undefined): string =>
    (nodes ?? [])
      .map((n) => {
        if (n.type === 'text') return has(n, 'comment') || has(n, 'deletion') ? '' : run(n.text ?? '', n)
        if (n.type === REF_NODE) return run(refLabel(n, resolve), n, '<w:u w:val="single"/>')
        if (n.type === 'hardBreak') return '<w:r><w:br/></w:r>'
        if (n.type === 'footnote') {
          notes.push(String(n.attrs?.note ?? ''))
          return run(String(notes.length), n, '<w:vertAlign w:val="superscript"/>')
        }
        if (n.type === 'image') return picture(n.attrs?.src, n.attrs?.width ?? null)
        return inline(n.content)
      })
      .join('')

  const para = (content: string, props: string[] = []) => `<w:p>${props.length ? `<w:pPr>${props.join('')}</w:pPr>` : ''}${content}</w:p>`
  /** Alignment, indent and line spacing of a paragraph or heading. */
  const blockProps = (n: RichTextDoc, extraIndent = 0) => {
    const p: string[] = []
    const indent = (n.attrs?.indent ?? 0) * 440 + extraIndent
    if (n.attrs?.lineHeight) p.push(`<w:spacing w:line="${Math.round(240 * n.attrs.lineHeight)}" w:lineRule="auto"/>`)
    if (indent) p.push(`<w:ind w:left="${indent}"/>`)
    const jc = { center: 'center', right: 'right', justify: 'both' }[n.attrs?.textAlign as string]
    if (jc) p.push(`<w:jc w:val="${jc}"/>`)
    return p
  }

  const headings: { level: number; text: string }[] = []
  const collect = (n: RichTextDoc) => {
    if (n.type === 'heading') headings.push({ level: n.attrs?.level ?? 1, text: plain(n) })
    else n.content?.forEach(collect)
  }
  const plain = (n: RichTextDoc): string => (n.type === 'text' ? (has(n, 'deletion') ? '' : (n.text ?? '')) : n.type === REF_NODE ? refLabel(n, resolve) : (n.content ?? []).map(plain).join(''))
  collect(doc)

  const block = (n: RichTextDoc, quote = 0): string => {
    const q = quote ? [`<w:ind w:left="${quote * 567}"/>`, '<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="999999"/></w:pBdr>'] : []
    switch (n.type) {
      case 'heading':
        return para(inline(n.content), [`<w:pStyle w:val="Heading${Math.min(6, n.attrs?.level ?? 1)}"/>`, ...blockProps(n)])
      case 'paragraph':
        return para(inline(n.content), quote ? q : blockProps(n))
      case 'blockquote':
        return (n.content ?? []).map((c) => block(c, quote + 1)).join('')
      case 'callout': {
        const title = String(n.attrs?.title ?? '') || String(n.attrs?.kind ?? 'note').replace(/^./, (c) => c.toUpperCase())
        return para(run(title, { type: 'text', marks: [{ type: 'bold' }] }), q.length ? q : ['<w:ind w:left="567"/>']) + (n.content ?? []).map((c) => block(c, quote + 1)).join('')
      }
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return list(n, 0)
      case 'codeBlock':
        return plain(n)
          .split('\n')
          .map((line) => para(run(line, { type: 'text', marks: [{ type: 'code' }] }), ['<w:spacing w:after="0"/>']))
          .join('')
      case 'horizontalRule':
        return para('', ['<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>'])
      case 'pageBreak':
        return para('<w:r><w:br w:type="page"/></w:r>')
      case 'tableOfContents':
        return headings.map((h) => para(run(h.text, { type: 'text' }), [`<w:ind w:left="${(h.level - 1) * 360}"/>`, '<w:spacing w:after="40"/>'])).join('')
      case 'image':
        return para(picture(n.attrs?.src, n.attrs?.width ?? null), n.attrs?.align === 'right' ? ['<w:jc w:val="right"/>'] : n.attrs?.align === 'left' ? [] : ['<w:jc w:val="center"/>'])
      case REF_CARD_NODE:
        return para(run(targetLabel(n, resolve), { type: 'text', marks: [{ type: 'bold' }] }))
      case 'table':
        return table(n)
      default:
        return n.content ? n.content.map((c) => block(c, quote)).join('') : ''
    }
  }

  const list = (n: RichTextDoc, level: number): string => {
    // Each list gets its own numbering, so numbered lists start at 1 again.
    const kind = n.type === 'orderedList' ? 'ordered' : 'bullet'
    lists.push(kind)
    const numId = lists.length
    return (n.content ?? [])
      .map((item) =>
        (item.content ?? [])
          .map((c, j) => {
            if (c.type === 'bulletList' || c.type === 'orderedList' || c.type === 'taskList') return list(c, level + 1)
            if (j > 0 || c.type !== 'paragraph') return block(c)
            const box = n.type === 'taskList' ? run(item.attrs?.checked ? '☑ ' : '☐ ', { type: 'text' }) : ''
            const num = n.type === 'taskList' ? [`<w:ind w:left="${(level + 1) * 360}"/>`] : [`<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`]
            return para(box + inline(c.content), [...num, ...blockProps(c).filter((p) => !p.startsWith('<w:ind'))])
          })
          .join(''),
      )
      .join('')
  }

  const table = (n: RichTextDoc) => {
    const rows = n.content ?? []
    const cols = Math.max(1, ...rows.map((r) => (r.content ?? []).reduce((s, c) => s + (c.attrs?.colspan ?? 1), 0)))
    const grid = `<w:tblGrid>${'<w:gridCol/>'.repeat(cols)}</w:tblGrid>`
    const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:color="999999"/>`
    const tblPr = `<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders></w:tblPr>`
    const body = rows
      .map((r) => {
        const cells = (r.content ?? []).map((c) => {
          const pr: string[] = []
          if ((c.attrs?.colspan ?? 1) > 1) pr.push(`<w:gridSpan w:val="${c.attrs!.colspan}"/>`)
          const fill = hexColor(c.attrs?.background) ?? (c.type === 'tableHeader' ? 'F0EFEC' : null)
          if (fill) pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`)
          const inner = (c.content ?? []).map((b) => block(b)).join('') || para('')
          return `<w:tc>${pr.length ? `<w:tcPr>${pr.join('')}</w:tcPr>` : ''}${inner}</w:tc>`
        })
        return `<w:tr>${cells.join('')}</w:tr>`
      })
      .join('')
    // Word processors need a paragraph after a table.
    return `<w:tbl>${tblPr}${grid}${body}</w:tbl>${para('')}`
  }

  let content = (doc.content ?? []).map((n) => block(n)).join('')
  if (notes.length) content += para(run('Notes', { type: 'text', marks: [{ type: 'bold' }] })) + notes.map((note, i) => para(run(`${i + 1}. ${note}`, { type: 'text' }))).join('')

  // Header and footer; the page number is a field word processors fill in on every page.
  const files: Record<string, Uint8Array> = {}
  const hdrFtr: string[] = []
  const pageField = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'
  const part = (kind: 'header' | 'footer', inner: string) => {
    const tag = kind === 'header' ? 'hdr' : 'ftr'
    files[`word/${kind}1.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${tag} ${W}>${inner}</w:${tag}>`)
    rels.push(`<Relationship Id="rId${kind}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${kind}1.xml"/>`)
    hdrFtr.push(`<w:${kind}Reference w:type="default" r:id="rId${kind}"/>`)
  }
  const small = (t: string) => run(t, { type: 'text', marks: [{ type: 'font', attrs: { size: 9 } }] })
  if (page.header) part('header', para(small(page.header)))
  if (page.footer || page.numbers) part('footer', para((page.footer ? small(page.footer) : '') + (page.numbers ? `<w:r><w:tab/></w:r>${pageField}` : ''), page.numbers ? ['<w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs>'] : []))

  const sect = `<w:sectPr>${hdrFtr.join('')}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`
  files['word/document.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W} ${DRAW_NS}><w:body>${content}${sect}</w:body></w:document>`)

  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}>${['bullet', 'ordered']
    .map(
      (kind, a) =>
        `<w:abstractNum w:abstractNumId="${a}">${Array.from({ length: 9 }, (_, l) => `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${kind === 'bullet' ? 'bullet' : 'decimal'}"/><w:lvlText w:val="${kind === 'bullet' ? ['•', '◦', '▪'][l % 3] : `%${l + 1}.`}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${(l + 1) * 360}" w:hanging="360"/></w:pPr></w:lvl>`).join('')}</w:abstractNum>`,
    )
    .join('')}${lists.map((k, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${k === 'bullet' ? 0 : 1}"/></w:num>`).join('')}</w:numbering>`
  files['word/numbering.xml'] = strToU8(numbering)
  rels.push('<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>')
  rels.push('<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>')

  const heading = (l: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${l}"><w:name w:val="heading ${l}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${l === 1 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${l - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[40, 32, 28, 24, 22, 22][l - 1]}"/></w:rPr></w:style>`
  files['word/styles.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${[1, 2, 3, 4, 5, 6].map(heading).join('')}</w:styles>`,
  )
  files['word/_rels/document.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`)
  files['_rels/.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
  )
  files['docProps/core.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title></cp:coreProperties>`,
  )
  const types = ['png', 'jpeg', 'gif'].map((e) => `<Default Extension="${e === 'jpeg' ? 'jpg' : e}" ContentType="image/${e}"/>`).join('')
  const overrides = [
    ['/word/document.xml', 'wordprocessingml.document.main'],
    ['/word/styles.xml', 'wordprocessingml.styles'],
    ['/word/numbering.xml', 'wordprocessingml.numbering'],
    ...(page.header ? [['/word/header1.xml', 'wordprocessingml.header']] : []),
    ...(page.footer || page.numbers ? [['/word/footer1.xml', 'wordprocessingml.footer']] : []),
  ]
    .map(([part, t]) => `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.${t}+xml"/>`)
    .join('')
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${types}${overrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  )
  return zipSync({ ...files, ...media })
}

/** Loads every picture of a document for the .docx: bytes plus pixel size. Pictures that fail are left out. */
export async function loadDocxImages(body: unknown, toUrl: (src: string) => string): Promise<Map<string, DocxImage>> {
  const srcs = new Set<string>()
  const walk = (n: RichTextDoc) => (n.type === 'image' && n.attrs?.src ? srcs.add(n.attrs.src) : n.content?.forEach(walk))
  walk(normalizeRichText(body))
  const out = new Map<string, DocxImage>()
  for (const src of srcs) {
    try {
      const blob = await (await fetch(toUrl(src))).blob()
      const ext = /png/.test(blob.type) ? 'png' : /gif/.test(blob.type) ? 'gif' : /jpe?g/.test(blob.type) ? 'jpeg' : null
      if (!ext) continue
      const bmp = await createImageBitmap(blob)
      out.set(src, { bytes: new Uint8Array(await blob.arrayBuffer()), ext, width: bmp.width, height: bmp.height })
      bmp.close()
    } catch {
      // Missing or unreadable picture: the .docx is still made without it.
    }
  }
  return out
}
