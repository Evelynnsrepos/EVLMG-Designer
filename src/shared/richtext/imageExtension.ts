import { Extension } from '@tiptap/core'
import Image, { type ImageOptions } from '@tiptap/extension-image'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { filesFromDataTransfer } from '@/core/assets'
import { imageStyle } from './styles'

export interface RichImageOptions {
  /** Turns a stored path (e.g. `assets/images/<id>.png`) into something an <img> can show. */
  getResolveSrc: () => ((src: string) => string) | undefined
}

/** Where an image sits: on its own line (left, center, right) or with the text flowing around it. */
export const IMAGE_ALIGNS = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
  { id: 'right', label: 'Right' },
  { id: 'wrap-left', label: 'Left, text flows around it' },
  { id: 'wrap-right', label: 'Right, text flows around it' },
] as const
export type ImageAlign = (typeof IMAGE_ALIGNS)[number]['id']

const SIZES = [25, 50, 75, 100]
const ICONS: Record<ImageAlign, string> = {
  left: '<svg viewBox="0 0 16 16"><path d="M1 2h14M1 14h14"/><rect x="1" y="5" width="7" height="6" rx="1"/></svg>',
  center: '<svg viewBox="0 0 16 16"><path d="M1 2h14M1 14h14"/><rect x="4.5" y="5" width="7" height="6" rx="1"/></svg>',
  right: '<svg viewBox="0 0 16 16"><path d="M1 2h14M1 14h14"/><rect x="8" y="5" width="7" height="6" rx="1"/></svg>',
  'wrap-left': '<svg viewBox="0 0 16 16"><rect x="1" y="3" width="7" height="7" rx="1"/><path d="M10 4h5M10 7h5M10 10h5M1 13h14"/></svg>',
  'wrap-right': '<svg viewBox="0 0 16 16"><rect x="8" y="3" width="7" height="7" rx="1"/><path d="M1 4h5M1 7h5M1 10h5M1 13h14"/></svg>',
}

/**
 * Block image that stores the project-relative path and resolves it only for
 * display. A missing or broken image shows the pink/black placeholder (spec 10.6).
 * v0.12: a width (% of the text column) and a placement, set from a small bar on the
 * selected image or by dragging its corner.
 */
export const RichImage = Image.extend<ImageOptions & RichImageOptions>({
  addOptions() {
    return { ...this.parent!(), getResolveSrc: () => undefined }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: (el) => Number(el.getAttribute('data-width')) || null, renderHTML: (a) => (a.width ? { 'data-width': a.width } : {}) },
      align: { default: null, parseHTML: (el) => el.getAttribute('data-align'), renderHTML: (a) => (a.align ? { 'data-align': a.align } : {}) },
    }
  },

  addNodeView() {
    const getResolveSrc = this.options.getResolveSrc
    return ({ node: initial, editor, getPos }) => {
      let node = initial
      const dom = document.createElement('div')
      dom.className = 'richtext-image'
      const box = document.createElement('div')
      box.className = 'richtext-image-box'
      const img = document.createElement('img')
      img.draggable = false
      const placeholder = document.createElement('div')
      placeholder.className = 'richtext-image-missing'
      placeholder.setAttribute('role', 'img')
      const handle = document.createElement('div')
      handle.className = 'richtext-image-handle'
      handle.title = 'Drag to resize'
      const bar = document.createElement('div')
      bar.className = 'richtext-image-bar'
      bar.contentEditable = 'false'
      dom.append(box)

      const set = (attrs: Record<string, unknown>) => {
        const pos = getPos()
        if (typeof pos !== 'number' || !editor.isEditable) return
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }))
      }
      const button = (html: string, title: string, run: () => void) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'richtext-image-btn'
        b.title = title
        b.setAttribute('aria-label', title)
        b.innerHTML = html
        b.addEventListener('mousedown', (e) => e.preventDefault())
        b.addEventListener('click', run)
        return b
      }
      const alignButtons = IMAGE_ALIGNS.map((a) => button(ICONS[a.id], a.label, () => set({ align: a.id })))
      const sizeButtons = SIZES.map((s) => button(`${s}%`, `${s}% of the text width`, () => set({ width: s })))
      const sep = document.createElement('span')
      sep.className = 'richtext-image-sep'
      bar.append(...alignButtons, sep, ...sizeButtons)

      // Drag the corner: the width follows the pointer, saved once on release.
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const column = editor.view.dom.getBoundingClientRect().width || 1
        const start = box.getBoundingClientRect()
        const fromRight = node.attrs.align === 'right' || node.attrs.align === 'wrap-right'
        let width: number = node.attrs.width ?? Math.round((start.width / column) * 100)
        handle.setPointerCapture(e.pointerId)
        const move = (ev: PointerEvent) => {
          const px = fromRight ? start.right - ev.clientX : ev.clientX - start.left
          width = Math.max(10, Math.min(100, Math.round((px / column) * 100)))
          dom.style.cssText = imageStyle(width, node.attrs.align)
          dom.toggleAttribute('data-sized', true)
        }
        const up = () => {
          handle.removeEventListener('pointermove', move)
          handle.removeEventListener('pointerup', up)
          set({ width })
        }
        handle.addEventListener('pointermove', move)
        handle.addEventListener('pointerup', up)
      })

      const show = (ok: boolean) => {
        box.replaceChildren(ok ? img : placeholder, handle, bar)
      }
      img.addEventListener('error', () => show(false))
      img.addEventListener('load', () => show(true))

      const paint = () => {
        const src: string | null = node.attrs.src
        const alt: string = node.attrs.alt ?? ''
        img.alt = alt
        placeholder.setAttribute('aria-label', `${alt || 'Image'} (missing)`)
        dom.style.cssText = imageStyle(node.attrs.width, node.attrs.align)
        dom.toggleAttribute('data-sized', !!node.attrs.width)
        dom.dataset.align = node.attrs.align ?? 'center'
        alignButtons.forEach((b, i) => b.classList.toggle('is-active', (node.attrs.align ?? 'center') === IMAGE_ALIGNS[i].id))
        sizeButtons.forEach((b, i) => b.classList.toggle('is-active', node.attrs.width === SIZES[i]))
        if (!src) return show(false)
        const resolved = getResolveSrc()?.(src) ?? src
        if (img.getAttribute('src') !== resolved) img.src = resolved
        show(true)
      }
      paint()

      return {
        dom,
        update(next) {
          if (next.type !== node.type) return false
          node = next
          paint()
          return true
        },
        // The bar and the handle are ours; the editor should not treat clicks there as editing.
        stopEvent: (e) => bar.contains(e.target as Node) || e.target === handle,
        ignoreMutation: () => true,
      }
    }
  },
})

/** Copies dropped or pasted image files into the project; returns what to store. */
export type ImageImporter = (files: File[]) => Promise<{ src: string; alt?: string }[]>

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i
const isImageFile = (f: File) => f.type.startsWith('image/') || IMAGE_FILE.test(f.name)

/** Images dropped or pasted into the text become project images at that spot (0.20). */
export const ImageFiles = Extension.create<{ getImporter: () => ImageImporter | undefined }>({
  name: 'imageFiles',
  addOptions() {
    return { getImporter: () => undefined }
  },
  addProseMirrorPlugins() {
    const getImporter = this.options.getImporter
    const take = (view: EditorView, dt: DataTransfer | null, at: number | undefined) => {
      const files = filesFromDataTransfer(dt).filter(isImageFile)
      const importer = getImporter()
      if (!files.length || !importer || !view.editable) return false
      void importer(files).then((images) => {
        const type = view.state.schema.nodes.image
        if (view.isDestroyed || !type || !images.length) return
        const nodes = images.map((attrs) => type.create(attrs))
        const { tr, doc } = view.state
        // The text may have changed while the files were copied.
        if (at === undefined) view.dispatch(tr.replaceWith(tr.selection.from, tr.selection.to, nodes).scrollIntoView())
        else view.dispatch(tr.insert(Math.min(at, doc.content.size), nodes))
      })
      return true
    }
    return [
      new Plugin({
        props: {
          handleDrop: (view, event) => take(view, event.dataTransfer, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos),
          handlePaste: (view, event) => take(view, event.clipboardData, undefined),
        },
      }),
    ]
  },
})
