import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { getFs, MemoryFs, setFs } from '../fs'
import { AssetSync, CHUNK_BYTES, referencedAssets } from './assetSync'
import { invalidate, writeTop } from './bridge'
import { MemoryHub, MemoryTransport } from './memoryTransport'
import { CollabNetwork } from './network'
import { newSecret } from './protocol'
import { CollabSession } from './session'

const IMG = 'assets/images/0b5a6d7e-1111-4222-8333-444455556666.png'
const MISSING = 'assets/audio/0b5a6d7e-1111-4222-8333-444455557777.mp3'

async function until(check: () => boolean, ms = 3000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('asset sync', () => {
  const stops: (() => unknown)[] = []
  beforeEach(() => setFs(new MemoryFs()))
  afterEach(async () => {
    for (const s of stops.splice(0)) await s()
  })

  it('finds asset paths anywhere in shared documents', () => {
    const doc = new Y.Doc()
    doc.on('afterTransaction', invalidate)
    doc.transact(() => writeTop(doc, 'doc:moodboard/1', undefined, { nodes: [{ id: 'n', src: IMG }], body: { content: [{ attrs: { src: MISSING } }] }, other: 'assets/../x' }))
    expect([...referencedAssets(doc)].sort()).toEqual([MISSING, IMG].sort())
  })

  it('downloads images a teammate has, in chunks', async () => {
    const fs = getFs()
    const big = new Uint8Array(CHUNK_BYTES * 2 + 123).map((_, i) => i % 251)
    await fs.mkdir('/host/assets/images')
    await fs.writeBinaryAtomic('/host/assets/images/0b5a6d7e-1111-4222-8333-444455556666.png', big)

    const secret = newSecret()
    const host = new CollabSession('/host')
    host.doc.transact(() => {
      writeTop(host.doc, 'share', undefined, { projectId: 'p', secret })
      writeTop(host.doc, 'members', undefined, [{ id: 'host', name: 'H', color: '', joinedAt: '' }])
      writeTop(host.doc, 'doc:moodboard/1', undefined, { nodes: [{ id: 'n', src: IMG }, { id: 'm', src: MISSING }] })
    })
    const hub = new MemoryHub()
    const hostNet = new CollabNetwork(new MemoryTransport(hub, 'host'), host.doc, { kind: 'member', session: host, onJoinRequest: async () => true }, { name: 'H', color: '' })
    const hostAssets = new AssetSync(hostNet, host.doc, '/host')
    await hostNet.start()

    const guestDoc = new Y.Doc()
    const guestNet = new CollabNetwork(
      new MemoryTransport(hub, 'guest'),
      guestDoc,
      { kind: 'join', invite: { projectId: 'p', projectName: '', address: 'host', secret } },
      { name: 'G', color: '' },
      { peers: () => guestAssets.scanSoon() },
    )
    const guestAssets = new AssetSync(guestNet, guestDoc, '/guest')
    stops.push(() => hostNet.stop(), () => guestNet.stop(), () => hostAssets.stop(), () => guestAssets.stop())
    await guestNet.start()

    await until(() => guestAssets.received.length === 1, 5000)
    expect(await fs.readBinary('/guest/assets/images/0b5a6d7e-1111-4222-8333-444455556666.png')).toEqual(big)
    expect(await fs.exists('/guest/assets/audio/0b5a6d7e-1111-4222-8333-444455557777.mp3')).toBe(false)
  }, 30_000)
})
