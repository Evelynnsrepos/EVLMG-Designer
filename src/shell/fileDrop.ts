import { isTauri } from '@/core/fs'
import { useAppStore } from '@/core/state'
import { openComponent } from './editor/actions'

/**
 * Dropping files from outside the app (0.19).
 *
 * Linux: WebKitGTK crashes when a file from the file manager is dropped on the page, so there the app takes
 * the drop itself (dragDropEnabled in tauri.linux.conf.json) and hands it to the page as a normal drop event
 * at the same spot. Every tool's own drop handling keeps working unchanged.
 *
 * Everywhere: .txt and .md files dropped where no tool takes them become new Writer documents.
 */

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  zip: 'application/zip',
}

const IMPORTABLE = /\.(md|markdown|txt)$/i

async function bridgeNativeDrops() {
  const [{ getCurrentWebview }, { readFile }] = await Promise.all([import('@tauri-apps/api/webview'), import('@tauri-apps/plugin-fs')])
  await getCurrentWebview().onDragDropEvent(async ({ payload }) => {
    if (payload.type !== 'drop' || !payload.paths.length) return
    const files: File[] = []
    for (const path of payload.paths) {
      const name = path.split(/[\\/]/).pop() ?? 'file'
      const ext = name.split('.').pop()?.toLowerCase() ?? ''
      try {
        files.push(new File([await readFile(path)], name, { type: TYPES[ext] ?? '' }))
      } catch (e) {
        console.error('Could not read dropped file', path, e)
      }
    }
    if (!files.length) return
    const x = payload.position.x / devicePixelRatio
    const y = payload.position.y / devicePixelRatio
    const target = document.elementFromPoint(x, y) ?? document.body
    // WebKitGTK may not keep a dataTransfer passed to `new DragEvent` (the drop then arrives empty), so attach it ourselves.
    const data = {
      files,
      items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
      types: ['Files'],
      getData: () => '',
      dropEffect: 'copy',
      effectAllowed: 'all',
    } as unknown as DataTransfer
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperties(drop, { dataTransfer: { value: data }, clientX: { value: x }, clientY: { value: y } })
    target.dispatchEvent(drop)
  })
}

/** Called once at startup. */
export function installFileDrop() {
  if (isTauri() && /linux/i.test(navigator.userAgent)) void bridgeNativeDrops()
  // Allow dropping files anywhere, instead of the page turning into the dropped file.
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
  })
  window.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files ?? [])]
    // A tool that took the drop already said so.
    if (!files.length || e.defaultPrevented) return
    e.preventDefault()
    const texts = files.filter((f) => IMPORTABLE.test(f.name))
    if (!texts.length || useAppStore.getState().screen !== 'editor') return
    void import('@/components/writer/importFiles').then(async ({ importTextFiles }) => {
      const [first] = await importTextFiles(texts)
      if (first) openComponent('writer', first)
    })
  })
}
