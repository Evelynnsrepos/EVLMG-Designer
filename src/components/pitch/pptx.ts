import { strToU8, zipSync } from 'fflate'
import { H, paragraphsOf, placeImage, xmlEscape as esc, type ExportDeck, type ExportSlide, type Obj } from './model'

/**
 * 0.35: the deck as a .pptx (Office Open XML). Opens in PowerPoint, Keynote, Google Slides
 * (import), LibreOffice Impress and OnlyOffice. Written by hand: no library needed.
 * shortcut: builds (objects coming in one by one) are not written yet; slides, transitions,
 * hidden slides and speaker notes are.
 */

type Box = Pick<Obj, 'x' | 'y' | 'w' | 'h'>
const EMU = 6350 // 1 slide pixel (1920 px = 13.333 in)
const e = (px: number) => Math.round(px * EMU)
const hex = (c: string | undefined, fallback = '000000') => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? '') ?? /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c ?? '')
  if (!m) return fallback
  return (m.length === 4 ? m[1] + m[1] + m[2] + m[2] + m[3] + m[3] : m[1]).toUpperCase()
}
const fill = (c: string | undefined) => (c && c !== 'none' ? `<a:solidFill><a:srgbClr val="${hex(c)}"/></a:solidFill>` : '<a:noFill/>')

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const rels = (list: [string, string, string][]) =>
  `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type.startsWith('http') ? type : `${REL}/${type}`}" Target="${target}"/>`).join('')}</Relationships>`

const PRESET: Record<string, string> = { rect: 'rect', round: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', line: 'line', arrow: 'line' }

function xfrm(o: Obj, box: Box = o) {
  const rot = o.rot ? ` rot="${Math.round((((o.rot % 360) + 360) % 360) * 60000)}"` : ''
  return `<a:xfrm${rot}><a:off x="${e(box.x)}" y="${e(box.y)}"/><a:ext cx="${Math.max(1, e(box.w))}" cy="${Math.max(1, e(box.h))}"/></a:xfrm>`
}

function textBody(o: Obj, fontOf: (o: Obj) => string) {
  const size = Math.round((o.size ?? 40) * 50) // px -> 1/100 pt (1 px = 0.5 pt)
  const algn = o.align === 'center' ? ' algn="ctr"' : o.align === 'right' ? ' algn="r"' : ''
  const ln = o.lineHeight ? `<a:lnSpc><a:spcPct val="${Math.round(o.lineHeight * 100000)}"/></a:lnSpc>` : ''
  const bu = o.bullets ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : '<a:buNone/>'
  const indent = o.bullets ? ` marL="${e((o.size ?? 40) * 1.1)}" indent="-${e((o.size ?? 40) * 1.1)}"` : ' marL="0" indent="0"'
  const rpr = `<a:rPr lang="en-US" sz="${size}"${o.bold ? ' b="1"' : ''}${o.italic ? ' i="1"' : ''}${o.underline ? ' u="sng"' : ''}${o.caps ? ' cap="small"' : ''} dirty="0">${fill(o.color ?? '#000000')}<a:latin typeface="${esc(fontOf(o))}"/></a:rPr>`
  const paras = paragraphsOf(o)
    .map((p) => `<a:p><a:pPr${algn}${indent}>${ln}${bu}</a:pPr>${p ? `<a:r>${rpr}<a:t>${esc(p)}</a:t></a:r>` : ''}<a:endParaRPr lang="en-US" sz="${size}" dirty="0"/></a:p>`)
    .join('')
  return `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="${o.kind === 'shape' ? 'ctr' : 't'}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody>`
}

function shapeXml(o: Obj, id: number, fontOf: (o: Obj) => string) {
  const kind = o.kind === 'text' ? 'rect' : (o.shape ?? 'rect')
  const isLine = kind === 'line' || kind === 'arrow'
  const sw = o.strokeW ?? (o.kind === 'shape' ? 4 : 0)
  const line = sw > 0 && (o.stroke || isLine) ? `<a:ln w="${e(sw)}">${fill(o.stroke ?? '#000000')}${kind === 'arrow' ? '<a:tailEnd type="triangle" w="med" len="med"/>' : ''}</a:ln>` : '<a:ln><a:noFill/></a:ln>'
  const bg = isLine ? '' : fill(o.fill ?? (o.kind === 'shape' ? '#cccccc' : undefined))
  // A line keeps its box; it runs from the top left to the bottom right corner (or flat when h is tiny).
  const hasText = o.kind === 'text' || !!o.text
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${o.kind} ${id}"/><p:cNvSpPr${o.kind === 'text' ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(o)}<a:prstGeom prst="${PRESET[kind]}"><a:avLst/></a:prstGeom>${bg}${line}</p:spPr>${hasText ? textBody(o, fontOf) : ''}</p:sp>`
}

function picXml(o: Obj, id: number, rid: string, iw: number, ih: number) {
  const p = placeImage(o, iw, ih)
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(o, p)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
}

const TRANSITION: Record<string, string> = { fade: '<p:fade/>', push: '<p:push dir="l"/>', zoom: '<p:zoom/>' }

function slideXml(s: ExportSlide, deck: ExportDeck, imageRid: (path: string) => string | null, fontOf: (o: Obj) => string) {
  let id = 2
  const shapes = s.objs
    .map((o) => {
      id++
      if (o.kind !== 'image') return shapeXml(o, id, fontOf)
      const img = o.image ? deck.images.get(o.image) : undefined
      const rid = o.image ? imageRid(o.image) : null
      return img && rid ? picXml(o, id, rid, img.w, img.h) : ''
    })
    .join('')
  const tr = TRANSITION[s.transition] ? `<p:transition spd="med">${TRANSITION[s.transition]}</p:transition>` : ''
  return `${HEAD}<p:sld ${NS}${s.hidden ? ' show="0"' : ''}><p:cSld><p:bg><p:bgPr>${fill(s.bg)}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${tr}</p:sld>`
}

const emptyTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>'
const CLRMAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'

function themeXml(deck: ExportDeck) {
  const t = deck.theme
  const c = (name: string, v: string) => `<a:${name}><a:srgbClr val="${hex(v)}"/></a:${name}>`
  const font = (f: string) => `<a:latin typeface="${esc(f)}"/><a:ea typeface=""/><a:cs typeface=""/>`
  const fills = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
  const lnS = (w: number) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`
  return `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${esc(t.name)}"><a:themeElements><a:clrScheme name="${esc(t.name)}">${c('dk1', t.ink)}${c('lt1', t.bg)}${c('dk2', t.soft)}${c('lt2', '#eeeeee')}${c('accent1', t.accent)}${c('accent2', '#ed7d31')}${c('accent3', '#a5a5a5')}${c('accent4', '#ffc000')}${c('accent5', '#5b9bd5')}${c('accent6', '#70ad47')}${c('hlink', t.accent)}${c('folHlink', t.soft)}</a:clrScheme><a:fontScheme name="${esc(t.name)}"><a:majorFont>${font(t.font)}</a:majorFont><a:minorFont>${font(t.font)}</a:minorFont></a:fontScheme><a:fmtScheme name="Plain"><a:fillStyleLst>${fills}${fills}${fills}</a:fillStyleLst><a:lnStyleLst>${lnS(6350)}${lnS(12700)}${lnS(19050)}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${fills}${fills}${fills}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
}

function notesXml(text: string) {
  const paras = text.split('\n').map((p) => `<a:p>${p ? `<a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(p)}</a:t></a:r>` : ''}</a:p>`).join('')
  return `${HEAD}<p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`
}

export function deckToPptx(deck: ExportDeck): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const put = (path: string, text: string) => (files[path] = strToU8(text))
  const W = deck.width
  const fontOf = (o: Obj) => o.font || deck.theme.font
  const n = deck.slides.length
  const media: string[] = []
  const mediaOf = new Map<string, number>()
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  deck.slides.forEach((s, i) => {
    const slideRels: [string, string, string][] = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]
    const ridOf = new Map<string, string>()
    const imageRid = (path: string) => {
      if (!deck.images.has(path)) return null
      if (!mediaOf.has(path)) {
        media.push(path)
        mediaOf.set(path, media.length)
      }
      if (!ridOf.has(path)) {
        const rid = `rId${slideRels.length + 1}`
        ridOf.set(path, rid)
        slideRels.push([rid, 'image', `../media/image${mediaOf.get(path)}.png`])
      }
      return ridOf.get(path)!
    }
    put(`ppt/slides/slide${i + 1}.xml`, slideXml(s, deck, imageRid, fontOf))
    if (s.notes.trim()) {
      slideRels.push([`rId${slideRels.length + 1}`, 'notesSlide', `../notesSlides/notesSlide${i + 1}.xml`])
      put(`ppt/notesSlides/notesSlide${i + 1}.xml`, notesXml(s.notes))
      put(`ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`, rels([['rId1', 'notesMaster', '../notesMasters/notesMaster1.xml'], ['rId2', 'slide', `../slides/slide${i + 1}.xml`]]))
    }
    put(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels(slideRels))
  })
  media.forEach((path, i) => (files[`ppt/media/image${i + 1}.png`] = deck.images.get(path)!.png))
  const hasNotes = deck.slides.some((s) => s.notes.trim())

  put(
    '[Content_Types].xml',
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${hasNotes ? '<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>' : ''}<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${deck.slides
      .map((s, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>${s.notes.trim() ? `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>` : ''}`)
      .join('')}</Types>`,
  )
  put('_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'], ['rId3', 'extended-properties', 'docProps/app.xml']]))
  put(
    'docProps/core.xml',
    `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(deck.title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  )
  put('docProps/app.xml', `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>EVLMG Designer</Application><Slides>${n}</Slides></Properties>`)

  const presRels: [string, string, string][] = [['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ['rId3', 'presProps', 'presProps.xml'], ['rId4', 'viewProps', 'viewProps.xml'], ['rId5', 'tableStyles', 'tableStyles.xml']]
  if (hasNotes) presRels.push(['rId6', 'notesMaster', 'notesMasters/notesMaster1.xml'])
  deck.slides.forEach((_, i) => presRels.push([`rId${100 + i}`, 'slide', `slides/slide${i + 1}.xml`]))
  put('ppt/_rels/presentation.xml.rels', rels(presRels))
  put(
    'ppt/presentation.xml',
    `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${hasNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rId6"/></p:notesMasterIdLst>' : ''}<p:sldIdLst>${deck.slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${100 + i}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${e(W)}" cy="${e(H)}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`,
  )
  put('ppt/presProps.xml', `${HEAD}<p:presentationPr ${NS}/>`)
  put('ppt/viewProps.xml', `${HEAD}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`)
  put('ppt/tableStyles.xml', `${HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`)
  put(
    'ppt/slideMasters/slideMaster1.xml',
    `${HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${emptyTree}</p:cSld>${CLRMAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
  )
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]))
  put('ppt/slideLayouts/slideLayout1.xml', `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${emptyTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]))
  put('ppt/theme/theme1.xml', themeXml(deck))
  if (hasNotes) {
    put('ppt/theme/theme2.xml', themeXml(deck))
    put('ppt/notesMasters/notesMaster1.xml', `${HEAD}<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${emptyTree}</p:cSld>${CLRMAP}</p:notesMaster>`)
    put('ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([['rId1', 'theme', '../theme/theme2.xml']]))
  }
  return zipSync(files)
}
