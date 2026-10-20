import { useCallback, useEffect, useMemo, useState } from 'react'
import { assetUrl, importAssetFromBlob, pickAndImportAssets } from '@/core/assets'
import { useProjectStore } from '@/core/state'
import type { ImageImporter } from './imageExtension'
import type { ImagePicker, RichTextDoc } from './types'

/**
 * Images stored in the project (F2): the picker copies the chosen file into
 * `assets/images/` and stores its relative path; `resolveImageSrc` turns that
 * path into a URL the editor can show. The editor needs URLs synchronously, so
 * paths are resolved ahead of time; wait for `ready` before mounting the editor.
 *
 *   const images = useProjectImages(doc.data?.body)
 *   if (!images.ready) return null
 *   <RichTextEditor pickImage={images.pickImage} importImages={images.importImages} resolveImageSrc={images.resolveImageSrc} ... />
 */
export interface ProjectImages {
  pickImage: ImagePicker
  /** Dropped or pasted image files, copied into the project. */
  importImages: ImageImporter
  resolveImageSrc: (src: string) => string
  /** True once every project image in the given document has a URL (or is known to be missing). */
  ready: boolean
}

/** root|path -> URL, or null when the file is missing. */
const urls = new Map<string, string | null>()

const isProjectPath = (src: string) => !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('/') && !src.startsWith('\\')

/** Every project-relative image path in a document. */
export function projectImagePaths(doc: RichTextDoc | null | undefined): string[] {
  const out = new Set<string>()
  const walk = (n: RichTextDoc) => {
    const src = n.type === 'image' ? n.attrs?.src : null
    if (typeof src === 'string' && src && isProjectPath(src)) out.add(src)
    n.content?.forEach(walk)
  }
  if (doc) walk(doc)
  return [...out]
}

async function resolveAll(root: string, paths: string[]) {
  await Promise.all(
    paths.map(async (p) => {
      const key = `${root}|${p}`
      if (urls.has(key)) return
      urls.set(key, await assetUrl(root, p).catch(() => null))
    }),
  )
}

export function useProjectImages(doc: RichTextDoc | null | undefined): ProjectImages {
  const root = useProjectStore((s) => s.root)
  const [, setVersion] = useState(0)
  const paths = projectImagePaths(doc)
  const missing = root ? paths.filter((p) => !urls.has(`${root}|${p}`)) : []
  const missingKey = missing.join('\n')

  useEffect(() => {
    if (!root || !missingKey) return
    let cancelled = false
    void resolveAll(root, missingKey.split('\n')).then(() => {
      if (!cancelled) setVersion((v) => v + 1)
    })
    return () => {
      cancelled = true
    }
  }, [root, missingKey])

  const pickImage = useCallback<ImagePicker>(async () => {
    if (!root) return null
    const [asset] = await pickAndImportAssets(root, 'image', 'Choose an image')
    if (!asset) return null
    await resolveAll(root, [asset.path])
    return { src: asset.path, alt: asset.name.replace(/\.[^.]+$/, '') }
  }, [root])

  const importImages = useCallback<ImageImporter>(
    async (files) => {
      if (!root) return []
      const assets = (await Promise.all(files.map((f) => importAssetFromBlob(root, f, 'image')))).filter((a) => !!a)
      await resolveAll(root, assets.map((a) => a.path))
      return assets.map((a) => ({ src: a.path, alt: a.name.replace(/\.[^.]+$/, '') }))
    },
    [root],
  )

  const resolveImageSrc = useCallback((src: string) => (root && urls.get(`${root}|${src}`)) || src, [root])

  // Once ready, stay ready: images added later are resolved by the picker before they are inserted.
  const [wasReady, setWasReady] = useState(false)
  const readyNow = !!root && missing.length === 0
  if (readyNow && !wasReady) setWasReady(true)

  return useMemo(() => ({ pickImage, importImages, resolveImageSrc, ready: readyNow || wasReady }), [pickImage, importImages, resolveImageSrc, readyNow, wasReady])
}
