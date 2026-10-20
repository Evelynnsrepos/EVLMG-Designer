import { getSchema } from '@tiptap/core'
import { EditorState, type Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { ImageFiles, RichImage, type ImageImporter } from './imageExtension'

const schema = getSchema([StarterKit, RichImage])

/** The plugin with a fake view that only keeps state, enough for drop and paste. */
function setup(importer: ImageImporter | undefined) {
  const plugins = ImageFiles.config.addProseMirrorPlugins!.call({ options: { getImporter: () => importer } } as never) as Plugin[]
  const props = plugins[0].props
  const view = {
    state: EditorState.create({ schema, doc: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] }) }),
    editable: true,
    isDestroyed: false,
    dispatch(tr: Parameters<EditorView['dispatch']>[0]) {
      view.state = view.state.apply(tr)
    },
  }
  const paste = (files: File[]) => props.handlePaste!.call(plugins[0], view as unknown as EditorView, { clipboardData: { files, items: [], types: ['Files'] } } as unknown as ClipboardEvent, null as never)
  const images = () => {
    const out: unknown[] = []
    view.state.doc.descendants((n) => void (n.type.name === 'image' && out.push(n.attrs.src)))
    return out
  }
  return { paste, images }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('image drop and paste in rich text', () => {
  it('imports pasted pictures and inserts them', async () => {
    const t = setup(async (files) => files.map((f) => ({ src: `assets/images/${f.name}` })))
    expect(t.paste([new File(['x'], 'cat.png', { type: 'image/png' })])).toBe(true)
    await flush()
    expect(t.images()).toEqual(['assets/images/cat.png'])
  })

  it('leaves other files and editors without an importer alone', () => {
    expect(setup(async () => []).paste([new File(['x'], 'notes.txt', { type: 'text/plain' })])).toBe(false)
    expect(setup(undefined).paste([new File(['x'], 'cat.png', { type: 'image/png' })])).toBe(false)
  })
})
