import { escapeHtml } from '@/shared/richtext'

/**
 * Design Book (v0.7): picked tools and entries as one game design document, a
 * single HTML file with cover, table of contents, images and info boxes. The
 * same page prints to PDF.
 */

export interface BookEntry {
  title: string
  /** Small grey line under the title, e.g. "Side quest". */
  kind?: string
  /** Rarity color for the title and image frame. */
  color?: string
  /** Image src, ideally a data URL so the file works on its own. */
  image?: string | null
  info?: { label: string; value: string }[]
  stats?: [string, number][]
  /** Body HTML (already escaped). */
  html?: string
}

export interface BookChapter {
  title: string
  entries: BookEntry[]
}

export interface BookInput {
  title: string
  subtitle: string
  date: string
  chapters: BookChapter[]
}

const e = escapeHtml

function entryHtml(entry: BookEntry, id: string): string {
  const rows = [...(entry.info ?? []), ...(entry.stats ?? []).map(([k, v]) => ({ label: k, value: String(v) }))]
  const box =
    entry.image || rows.length
      ? `<aside class="info"${entry.color ? ` style="border-color:${e(entry.color)}"` : ''}>${entry.image ? `<img src="${e(entry.image)}" alt="">` : ''}${
          rows.length ? `<dl>${rows.map((r) => `<dt>${e(r.label)}</dt><dd>${e(r.value)}</dd>`).join('')}</dl>` : ''
        }</aside>`
      : ''
  return `<article class="entry" id="${id}"><h2${entry.color ? ` style="color:${e(entry.color)}"` : ''}>${e(entry.title)}</h2>${
    entry.kind ? `<div class="kind">${e(entry.kind)}</div>` : ''
  }${box}${entry.html ?? ''}</article>`
}

export function buildBookHtml(book: BookInput): string {
  const chapters = book.chapters.filter((c) => c.entries.length)
  const toc = chapters
    .map(
      (c, i) =>
        `<li><a href="#c${i}">${e(c.title)}</a><ol>${c.entries.map((en, j) => `<li><a href="#c${i}-${j}">${e(en.title)}</a></li>`).join('')}</ol></li>`,
    )
    .join('')
  const body = chapters
    .map((c, i) => `<section class="chapter"><h1 id="c${i}">${e(c.title)}</h1>${c.entries.map((en, j) => entryHtml(en, `c${i}-${j}`)).join('')}</section>`)
    .join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(book.title)}</title>
<style>${CSS}</style></head><body>
<header class="cover"><h1>${e(book.title)}</h1>${book.subtitle ? `<p class="sub">${e(book.subtitle)}</p>` : ''}<p class="date">${e(book.date)}</p></header>
<nav class="toc"><h1>Contents</h1><ol>${toc}</ol></nav>
${body}
<footer>Made with Eve.Lopment Games Designer</footer>
</body></html>`
}

const CSS = `
:root{--ink:#1d1d1f;--muted:#6b6b70;--line:#e3e3e8;--accent:#6b4eff}
*{box-sizing:border-box}
body{margin:0 auto;max-width:860px;padding:0 24px 48px;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:#fff}
.cover{min-height:90vh;display:flex;flex-direction:column;justify-content:center;border-bottom:4px solid var(--accent)}
.cover h1{font-size:56px;line-height:1.1;margin:0}
.cover .sub{font-size:22px;color:var(--muted);margin:12px 0 0}
.cover .date{color:var(--muted)}
.toc ol{padding-left:20px}.toc>ol>li{font-weight:600;margin-top:8px}.toc>ol>li ol{font-weight:normal}
a{color:var(--accent)}
.chapter>h1{margin-top:48px;padding-bottom:6px;border-bottom:2px solid var(--line)}
.entry{margin:28px 0;overflow:hidden}
.entry h2{margin:0}
.kind{color:var(--muted);font-size:14px;margin-bottom:8px}
.info{float:right;width:260px;margin:0 0 12px 20px;padding:10px;border:2px solid var(--line);border-radius:8px;background:#fafafc;font-size:14px}
.info img{width:100%;border-radius:4px;display:block}
.info dl{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:8px 0 0}
.info dt{color:var(--muted)}.info dd{margin:0}
.entry img{max-width:100%}
.ref{color:var(--accent);font-weight:500}
blockquote{margin:0;padding-left:12px;border-left:3px solid var(--line);color:var(--muted)}
pre{background:#f4f4f7;padding:8px;border-radius:6px;overflow:auto}
footer{margin-top:48px;color:var(--muted);font-size:12px;text-align:center}
@media (max-width:600px){.info{float:none;width:auto;margin:8px 0}}
@media print{.cover{min-height:auto;height:95vh;page-break-after:always}.toc{page-break-after:always}.chapter{page-break-before:always}a{color:inherit;text-decoration:none}}
`
